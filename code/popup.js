const symbolInput = document.getElementById('symbol-input')
const stockListEl = document.getElementById('stock-list')
const detailCodeEl = document.getElementById('detail-code')
const statusMsg = document.getElementById('status-msg')
const updateTime = document.getElementById('update-time')
const chartTitle = document.getElementById('chart-title')
const canvas = document.getElementById('sparkline')
const ctx = canvas.getContext('2d')
const hoverTip = document.getElementById('hover-tip')

let watchList = ['601899', '513650', 'sh000001', '603259', '600036']
let selectedSymbol = '601899'
let quotesCache = {}
let abbrCache = {}
let chartData = []
let prevClosePrice = 0
let isPluginBlurred = false
let chartMode = 'minute'

// 拼音首字母兜底
const PINYIN_BOUNDARIES = [['A', '啊'],['B', '芭'],['C', '擦'],['D', '搭'],['E', '蛾'],['F', '发'],['G', '噶'],['H', '哈'],['J', '击'],['K', '喀'],['L', '垃'],['M', '妈'],['N', '拿'],['O', '哦'],['P', '啪'],['Q', '期'],['R', '然'],['S', '撒'],['T', '塌'],['W', '挖'],['X', '昔'],['Y', '压'],['Z', '匝']]
const zhCollator = new Intl.Collator('zh-Hans-CN', { usage: 'sort', sensitivity: 'base' })

function getCharPinYinFirst(ch) {
  if (/[a-zA-Z0-9]/.test(ch)) return ch.toUpperCase()
  if (!/[\u4e00-\u9fa5]/.test(ch)) return ''
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
    if (zhCollator.compare(ch, PINYIN_BOUNDARIES[i][1]) >= 0) return PINYIN_BOUNDARIES[i][0]
  }
  return ''
}

function toPinYinAbbrFallback(str) {
  if (!str) return ''
  const cleaned = str.replace(/\s+/g, '')
  if (/^[a-zA-Z0-9\s.,&-]+$/.test(cleaned)) return cleaned.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
  return Array.from(cleaned).map(getCharPinYinFirst).join('')
}

async function resolveSymbolQuery(query) {
  const cleanQ = query.trim()
  if (!cleanQ) return null
  if (/^([a-zA-Z]{2})?\d{4,6}(\.[a-zA-Z]+)?$/.test(cleanQ)) return cleanQ.toUpperCase()

  try {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=${encodeURIComponent(cleanQ)}`
    const res = await fetch(url)
    const text = await res.text()
    const match = text.match(/="([^"]+)"/)
    if (match && match[1]) {
      const records = match[1].split('^')
      if (records.length > 0 && records[0]) {
        const parts = records[0].split('~')
        if (parts.length >= 3) {
          const market = parts[0], code = parts[1], name = parts[2]
          abbrCache[code] = parts[3] ? parts[3].toUpperCase() : toPinYinAbbrFallback(name)
          chrome.storage.local.set({ abbrCache })
          if (market === 'sh' || market === 'sz' || market === 'hk') return `${market}${code}`
          return code
        }
      }
    }
  } catch (e) {}
  return cleanQ.toUpperCase()
}

function toTencentSymbol(raw) {
  let s = raw.trim().toUpperCase()
  if (/^(SH|SZ|HK|US)[0-9A-Z.]+$/.test(s)) return s.toLowerCase()
  if (/^\d{6}$/.test(s)) return (s.startsWith('6') || s.startsWith('5')) ? `sh${s}` : `sz${s}`
  if (/^\d{4,5}$/.test(s)) return `hk${s.padStart(5, '0')}`
  if (s.endsWith('.SS')) return `sh${s.replace('.SS', '')}`
  if (s.endsWith('.SZ')) return `sz${s.replace('.SZ', '')}`
  if (s.endsWith('.HK')) return `hk${s.replace('.HK', '').padStart(5, '0')}`
  return `us${s}`
}

async function ensureSymbolAbbr(rawSym) {
  if (abbrCache[rawSym]) return abbrCache[rawSym]
  try {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&t=all&c=1&q=${encodeURIComponent(rawSym)}`
    const res = await fetch(url)
    const text = await res.text()
    const match = text.match(/="([^"]+)"/)
    if (match && match[1]) {
      const parts = match[1].split('^')[0].split('~')
      if (parts.length >= 4 && parts[3]) {
        abbrCache[rawSym] = parts[3].toUpperCase()
        chrome.storage.local.set({ abbrCache })
        return abbrCache[rawSym]
      }
    }
  } catch (e) {}
  return null
}

async function fetchAllRealtimeQuotes() {
  if (watchList.length === 0) { renderUI(); return }
  watchList.forEach(sym => { if (!abbrCache[sym]) ensureSymbolAbbr(sym) })

  const tSymbols = watchList.map(toTencentSymbol)
  try {
    const res = await fetch(`https://qt.gtimg.cn/?_t=${Date.now()}&q=${tSymbols.join(',')}`, { cache: 'no-store' })
    const text = new TextDecoder('gbk').decode(await res.arrayBuffer())
    const lines = text.split(';')

    watchList.forEach((rawSym, idx) => {
      const match = (lines[idx] || '').match(/="([^"]+)"/)
      if (match && match[1]) {
        const parts = match[1].split('~')
        if (parts.length > 32) {
          const rawName = parts[1]
          quotesCache[rawSym] = {
            name: abbrCache[rawSym] || toPinYinAbbrFallback(rawName) || rawSym,
            fullName: (rawName || rawSym).replace(/\s+/g, ''),
            price: parseFloat(parts[3]) || 0,
            prevClose: parseFloat(parts[4]) || 0,
            diff: parseFloat(parts[31]) || 0,
            pct: parseFloat(parts[32]) || 0
          }
        }
      }
    })

    const now = new Date()
    updateTime.textContent = `sync ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    statusMsg.textContent = `nodes(${watchList.length}) [live]`
    renderUI()
  } catch (e) {
    statusMsg.textContent = 'net_err'
  }
}

function renderUI() {
  renderStockList()
  renderDetailPanel()
}

// 更新左侧列表渲染：加入极小的全称
function renderStockList() {
  stockListEl.innerHTML = ''
  watchList.forEach(sym => {
    const q = quotesCache[sym] || { pct: 0, name: abbrCache[sym] || sym, fullName: sym }
    const isSelected = sym === selectedSymbol
    
    const codeAbbr = abbrCache[sym] || q.name || sym
    const displayAbbr = isPluginBlurred ? '***' : codeAbbr
    const displayFullName = isPluginBlurred ? '***' : (q.fullName || codeAbbr)
    const displayPct = isPluginBlurred ? '...' : (q.pct >= 0 ? '+' : '') + q.pct.toFixed(2)

    const item = document.createElement('div')
    item.className = `stock-item ${isSelected ? 'selected' : ''}`
    item.dataset.symbol = sym
    item.innerHTML = `
      <div class="si-left">
        <span class="si-icon">▪</span>
        <div class="si-names">
          <span class="si-abbr">${displayAbbr}</span>
          <span class="si-fullname">${displayFullName}</span>
        </div>
      </div>
      <span class="si-pct">${displayPct}</span>
    `

    item.addEventListener('click', () => {
      if (selectedSymbol !== sym) {
        selectedSymbol = sym
        chrome.storage.local.set({ selectedSymbol })
        renderUI()
        fetchChartData(selectedSymbol)
      }
    })

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      watchList = watchList.filter(i => i !== sym)
      if (selectedSymbol === sym) selectedSymbol = watchList[0] || ''
      saveAndRefresh()
    })

    stockListEl.appendChild(item)
  })
}

// 更新右侧详情渲染：删除了 name 字段
function renderDetailPanel() {
  const sym = selectedSymbol
  const q = quotesCache[sym]
  if (!q) {
    detailCodeEl.innerHTML = `<div class="code-line cm">// select a module to trace</div>`
    return
  }

  const isUp = q.pct >= 0
  const sign = isUp ? '+' : ''
  const colorClass = isUp ? 'pct-up' : 'pct-down'

  const dId = isPluginBlurred ? '***' : sym
  const dPrice = isPluginBlurred ? '...' : q.price.toFixed(2)
  const dPct = isPluginBlurred ? '...' : `${sign}${q.pct.toFixed(2)}%`
  const dDiff = isPluginBlurred ? '...' : `${sign}${q.diff.toFixed(2)}`

  // 删除了 name 属性
  detailCodeEl.innerHTML = `
    <div class="code-line"><span class="kw">const</span> <span class="pr">activeNode</span> = {</div>
    <div class="code-line">&nbsp;&nbsp;<span class="pr">id</span>: <span class="str">'${dId}'</span>,</div>
    <div class="code-line">&nbsp;&nbsp;<span class="pr">price</span>: <span class="num">${dPrice}</span>,</div>
    <div class="code-line">&nbsp;&nbsp;<span class="pr">ofs</span>: <span class="str ${colorClass}">'${dPct}'</span>,</div>
    <div class="code-line">&nbsp;&nbsp;<span class="pr">diff</span>: <span class="num ${colorClass}">${dDiff}</span></div>
    <div class="code-line">};</div>
  `
}

async function fetchChartData(rawSym) {
  if (!rawSym) { chartData = []; drawAreaChart(); return }
  const qInfo = quotesCache[rawSym]
  const abbr = abbrCache[rawSym] || (qInfo ? qInfo.name : rawSym)

  if (chartMode === 'minute') {
    chartTitle.textContent = `// STATS: ${rawSym}_${abbr} [Intraday]`
    await fetchMinuteChart(rawSym)
  } else {
    chartTitle.textContent = `// STATS: ${rawSym}_${abbr} [Daily]`
    await fetchDailyChart(rawSym)
  }
}

async function fetchMinuteChart(rawSym) {
  const qInfo = quotesCache[rawSym]
  let cleanSym = rawSym.trim().toUpperCase().replace(/^(SH|SZ|HK|US)/, '')
  let secid = ''
  if (/^6\d{5}$/.test(cleanSym) || rawSym.toLowerCase().startsWith('sh')) secid = `1.${cleanSym}`
  else if (/^\d{6}$/.test(cleanSym) || rawSym.toLowerCase().startsWith('sz')) secid = `0.${cleanSym}`

  try {
    if (secid) {
      const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58&_=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      if (json && json.data && json.data.trends) {
        prevClosePrice = json.data.preClose || (qInfo ? qInfo.prevClose : 0)
        chartData = json.data.trends.map(tStr => {
          const parts = tStr.split(',')
          return { timeStr: (parts[0].split(' ')[1] || parts[0]).slice(0, 5), price: parseFloat(parts[2]) }
        })
        drawAreaChart(); return
      }
    }
  } catch (err) {
    chartData = []; drawAreaChart();
  }
}

async function fetchDailyChart(rawSym) {
  let cleanSym = rawSym.trim().toUpperCase()
  if (/^SZ\d{6}$/.test(cleanSym)) cleanSym = `${cleanSym.replace('SZ', '')}.SZ`
  else if (/^SH\d{6}$/.test(cleanSym)) cleanSym = `${cleanSym.replace('SH', '')}.SS`
  else if (/^\d{6}$/.test(cleanSym)) cleanSym = cleanSym.startsWith('6') ? `${cleanSym}.SS` : `${cleanSym}.SZ`
  else if (/^\d{4,5}$/.test(cleanSym)) cleanSym = `${cleanSym.padStart(4, '0')}.HK`

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1d&range=2mo&_t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()
    const result = data.chart.result[0]
    prevClosePrice = result.meta.chartPreviousClose || result.meta.previousClose
    const timestamps = result.timestamp || []
    const closes = result.indicators.quote[0].close || []
    chartData = []
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined) {
        const d = new Date(timestamps[i] * 1000)
        chartData.push({
          timeStr: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          price: closes[i]
        })
      }
    }
    drawAreaChart()
  } catch (err) {
    chartData = []; drawAreaChart();
  }
}

chartTitle.addEventListener('click', () => {
  chartMode = chartMode === 'minute' ? 'daily' : 'minute'
  fetchChartData(selectedSymbol)
})

function drawAreaChart(highlightIndex = -1) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (chartData.length < 2) return

  const pad = { top: 10, right: 10, bottom: 20, left: 40 }
  const chartW = canvas.width - pad.left - pad.right
  const chartH = canvas.height - pad.top - pad.bottom

  const prices = chartData.map(d => d.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1

  // Y 轴网格
  const ySteps = 4
  ctx.fillStyle = '#555'
  ctx.strokeStyle = '#333'
  ctx.font = '10px Consolas'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  for (let i = 0; i <= ySteps; i++) {
    const val = min + (range / ySteps) * i
    const y = pad.top + chartH - (i / ySteps) * chartH
    ctx.fillText(val.toFixed(2), pad.left - 6, y)
    ctx.beginPath()
    ctx.setLineDash([2, 2])
    ctx.moveTo(pad.left, y)
    ctx.lineTo(canvas.width - pad.right, y)
    ctx.stroke()
  }

  // X 轴网格
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const xSteps = 4
  for (let i = 0; i <= xSteps; i++) {
    const dataIdx = Math.floor((i / xSteps) * (chartData.length - 1))
    const x = pad.left + (dataIdx / (chartData.length - 1)) * chartW
    const timeStr = chartData[dataIdx].timeStr
    ctx.fillText(timeStr, x, canvas.height - pad.bottom + 4)
    if (i > 0 && i < xSteps) {
      ctx.beginPath()
      ctx.setLineDash([2, 2])
      ctx.moveTo(x, pad.top)
      ctx.lineTo(x, pad.top + chartH)
      ctx.stroke()
    }
  }
  ctx.setLineDash([])

  // 面积图
  ctx.beginPath()
  chartData.forEach((pt, idx) => {
    const x = pad.left + (idx / (chartData.length - 1)) * chartW
    const y = pad.top + chartH - ((pt.price - min) / range) * chartH
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  const lastX = pad.left + chartW
  const firstX = pad.left
  const bottomY = pad.top + chartH
  ctx.lineTo(lastX, bottomY)
  ctx.lineTo(firstX, bottomY)
  ctx.closePath()
  ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'
  ctx.fill()

  // 边框线
  ctx.beginPath()
  chartData.forEach((pt, idx) => {
    const x = pad.left + (idx / (chartData.length - 1)) * chartW
    const y = pad.top + chartH - ((pt.price - min) / range) * chartH
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.strokeStyle = '#8a8a8a'
  ctx.lineWidth = 1
  ctx.stroke()

  // 昨收参考线
  if (chartMode === 'minute' && prevClosePrice > 0) {
    let yClose = pad.top + chartH - ((prevClosePrice - min) / range) * chartH
    yClose = Math.max(pad.top, Math.min(bottomY, yClose))
    ctx.beginPath()
    ctx.strokeStyle = '#7a7a7a'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.moveTo(pad.left, yClose)
    ctx.lineTo(canvas.width - pad.right, yClose)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 悬停指示器
  if (highlightIndex >= 0 && highlightIndex < chartData.length) {
    const pt = chartData[highlightIndex]
    const x = pad.left + (highlightIndex / (chartData.length - 1)) * chartW
    const y = pad.top + chartH - ((pt.price - min) / range) * chartH
    
    ctx.beginPath()
    ctx.strokeStyle = '#569cd6'
    ctx.setLineDash([3, 3])
    ctx.moveTo(x, pad.top)
    ctx.lineTo(x, bottomY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.fillStyle = '#9cdcfe'
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

// 更新悬停提示：mem 显示涨跌幅
canvas.addEventListener('mousemove', e => {
  if (chartData.length < 2) return
  const rect = canvas.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  
  const pad = { left: 40, right: 10 }
  const chartW = canvas.width - pad.left - pad.right
  
  let relativeX = mouseX - pad.left
  if (relativeX < 0) relativeX = 0
  if (relativeX > chartW) relativeX = chartW
  
  const idx = Math.round((relativeX / chartW) * (chartData.length - 1))
  const item = chartData[idx]
  
  if (item) {
    if (chartMode === 'minute') {
      // 计算相对于昨收的涨跌幅
      const pct = prevClosePrice ? (((item.price - prevClosePrice) / prevClosePrice) * 100).toFixed(2) : '0.00'
      const sign = pct >= 0 ? '+' : ''
      hoverTip.textContent = `/* [${item.timeStr}] addr:0x${item.price.toFixed(2)} mem:${sign}${pct}% */`
    } else {
      // 计算相对于前一日收盘的涨跌幅
      let dailyPct = '0.00%'
      if (idx > 0) {
        const p = ((item.price - chartData[idx - 1].price) / chartData[idx - 1].price) * 100
        dailyPct = `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
      }
      hoverTip.textContent = `/* [${item.timeStr}] addr:0x${item.price.toFixed(2)} mem:${dailyPct} */`
    }
    drawAreaChart(idx)
  }
})

canvas.addEventListener('mouseleave', () => { 
  hoverTip.textContent = ''; 
  drawAreaChart() 
})

window.addEventListener('blur', () => { isPluginBlurred = true; renderUI(); })
window.addEventListener('focus', () => { isPluginBlurred = false; renderUI(); fetchAllRealtimeQuotes(); })

symbolInput.addEventListener('keydown', async e => {
  if (e.key === 'Enter') {
    const rawVal = symbolInput.value.trim()
    if (rawVal) {
      const parts = rawVal.split(/[,，\s]+/).filter(Boolean)
      for (let p of parts) {
        statusMsg.textContent = 'resolving...'
        const resolvedSymbol = await resolveSymbolQuery(p)
        if (resolvedSymbol && !watchList.includes(resolvedSymbol)) {
          watchList.push(resolvedSymbol)
          selectedSymbol = resolvedSymbol
          await ensureSymbolAbbr(resolvedSymbol)
        }
      }
      symbolInput.value = ''
      symbolInput.blur()
      saveAndRefresh()
    }
  }
})

function saveAndRefresh() {
  chrome.storage.local.set({ watchList, selectedSymbol })
  fetchAllRealtimeQuotes().then(() => fetchChartData(selectedSymbol))
}

document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT') return;

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (watchList.length === 0) return;
    e.preventDefault();
    let idx = watchList.indexOf(selectedSymbol);
    if (idx === -1) idx = 0;
    if (e.key === 'ArrowUp') {
      idx = idx > 0 ? idx - 1 : watchList.length - 1;
    } else if (e.key === 'ArrowDown') {
      idx = idx < watchList.length - 1 ? idx + 1 : 0;
    }
    if (watchList[idx] !== selectedSymbol) {
      selectedSymbol = watchList[idx];
      chrome.storage.local.set({ selectedSymbol });
      renderUI();
      fetchChartData(selectedSymbol);
      const selectedEl = document.querySelector('.stock-item.selected');
      if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    toggleBossMode();
  }
})

function toggleBossMode() {
  document.getElementById('main-editor').classList.toggle('hidden')
  document.getElementById('boss-editor').classList.toggle('hidden')
}
document.getElementById('boss-key').addEventListener('click', toggleBossMode)
document.getElementById('fake-tab').addEventListener('click', toggleBossMode)

document.getElementById('refresh-btn').addEventListener('click', () => {
  fetchAllRealtimeQuotes(); fetchChartData(selectedSymbol)
})

chrome.storage.local.get(['watchList', 'selectedSymbol', 'abbrCache'], res => {
  if (res.watchList && Array.isArray(res.watchList) && res.watchList.length > 0) watchList = res.watchList
  if (res.abbrCache) abbrCache = res.abbrCache
  selectedSymbol = res.selectedSymbol || watchList[0] || ''

  fetchAllRealtimeQuotes().then(() => fetchChartData(selectedSymbol))
  setInterval(fetchAllRealtimeQuotes, 3000)
  setInterval(() => fetchChartData(selectedSymbol), 15000)
})