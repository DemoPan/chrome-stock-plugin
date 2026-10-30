const symbolInput = document.getElementById('symbol-input')
const stockListEl = document.getElementById('stock-list')
const statusMsg = document.getElementById('status-msg')
const updateTime = document.getElementById('update-time')
const chartTitle = document.getElementById('chart-title')
const canvas = document.getElementById('sparkline')
const ctx = canvas.getContext('2d')
const hoverTip = document.getElementById('hover-tip')

let watchList = [
  '601899',
  '513650',
  'sh000001',
  '600825',
  '002343',
  '688825',
  '603259',
  '000807',
  '000933',
  '000792'
]
let selectedSymbol = '601899'
let quotesCache = {}
let abbrCache = {}
let chartData = []
let prevClosePrice = 0
let isPluginBlurred = false
let chartMode = 'minute' // 'minute' 或 'daily'

// 拼音首字母兜底
const PINYIN_BOUNDARIES = [
  ['A', '啊'],
  ['B', '芭'],
  ['C', '擦'],
  ['D', '搭'],
  ['E', '蛾'],
  ['F', '发'],
  ['G', '噶'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '啪'],
  ['Q', '期'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '塌'],
  ['W', '挖'],
  ['X', '昔'],
  ['Y', '压'],
  ['Z', '匝']
]
const zhCollator = new Intl.Collator('zh-Hans-CN', { usage: 'sort', sensitivity: 'base' })

function getCharPinYinFirst(ch) {
  if (/[a-zA-Z0-9]/.test(ch)) return ch.toUpperCase()
  if (!/[\u4e00-\u9fa5]/.test(ch)) return ''
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
    if (zhCollator.compare(ch, PINYIN_BOUNDARIES[i][1]) >= 0) {
      return PINYIN_BOUNDARIES[i][0]
    }
  }
  return ''
}

function toPinYinAbbrFallback(str) {
  if (!str) return ''
  const cleaned = str.replace(/\s+/g, '')
  if (/^[a-zA-Z0-9\s.,&-]+$/.test(cleaned)) {
    return cleaned
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 6)
      .toUpperCase()
  }
  return Array.from(cleaned).map(getCharPinYinFirst).join('')
}

async function resolveSymbolQuery(query) {
  const cleanQ = query.trim()
  if (!cleanQ) return null

  if (/^([a-zA-Z]{2})?\d{4,6}(\.[a-zA-Z]+)?$/.test(cleanQ)) {
    return cleanQ.toUpperCase()
  }

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
          const market = parts[0]
          const code = parts[1]
          const name = parts[2]
          const abbr = parts[3] ? parts[3].toUpperCase() : toPinYinAbbrFallback(name)

          abbrCache[code] = abbr
          chrome.storage.local.set({ abbrCache })

          if (market === 'sh' || market === 'sz' || market === 'hk') {
            return `${market}${code}`
          }
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
  if (/^\d{6}$/.test(s)) {
    if (s.startsWith('6') || s.startsWith('5')) return `sh${s}`
    return `sz${s}`
  }
  if (/^\d{4,5}$/.test(s)) {
    return `hk${s.padStart(5, '0')}`
  }
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
      const firstRecord = match[1].split('^')[0]
      const parts = firstRecord.split('~')
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
  if (watchList.length === 0) {
    renderStockList()
    return
  }

  watchList.forEach(sym => {
    if (!abbrCache[sym]) ensureSymbolAbbr(sym)
  })

  const tSymbols = watchList.map(toTencentSymbol)
  const url = `https://qt.gtimg.cn/?_t=${Date.now()}&q=${tSymbols.join(',')}`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    const buffer = await res.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buffer)
    const lines = text.split(';')

    watchList.forEach((rawSym, idx) => {
      const line = lines[idx] || ''
      const match = line.match(/="([^"]+)"/)
      if (match && match[1]) {
        const parts = match[1].split('~')
        if (parts.length > 32) {
          const rawName = parts[1]
          const price = parseFloat(parts[3])
          const prevClose = parseFloat(parts[4])
          const diff = parseFloat(parts[31])
          const pct = parseFloat(parts[32])
          const high = parseFloat(parts[33])
          const low = parseFloat(parts[34])

          const abbrName = abbrCache[rawSym] || toPinYinAbbrFallback(rawName) || rawSym
          const cleanFullName = (rawName || rawSym).replace(/\s+/g, '')

          quotesCache[rawSym] = {
            name: abbrName,
            fullName: cleanFullName,
            price: isNaN(price) ? 0 : price,
            prevClose: isNaN(prevClose) ? 0 : prevClose,
            diff: isNaN(diff) ? 0 : diff,
            pct: isNaN(pct) ? 0 : pct,
            high: isNaN(high) ? 0 : high,
            low: isNaN(low) ? 0 : low
          }
        }
      }
    })

    const now = new Date()
    updateTime.textContent = `sync ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    statusMsg.textContent = `nodes(${watchList.length}) [live]`
    renderStockList()
  } catch (e) {
    statusMsg.textContent = 'net_err'
  }
}

function renderStockList() {
  stockListEl.innerHTML = ''
  let lineNum = 3

  watchList.forEach(sym => {
    const q = quotesCache[sym] || {
      price: 0,
      pct: 0,
      diff: 0,
      name: abbrCache[sym] || sym,
      fullName: sym
    }
    const isUp = q.pct >= 0
    const sign = isUp ? '+' : ''
    const colorClass = isUp ? 'up-color' : 'down-color'
    const isSelected = sym === selectedSymbol
    const codeAbbr = abbrCache[sym] || q.name || sym
    const fullName = q.fullName || codeAbbr

    const displayId = isPluginBlurred ? '...' : sym
    const displayAbbr = isPluginBlurred ? '...' : codeAbbr
    const displayFull = isPluginBlurred ? '...' : fullName
    const displayPrice = isPluginBlurred ? '...' : q.price.toFixed(2)
    const displayPct = isPluginBlurred ? '...' : `${sign}${q.pct.toFixed(2)}%`
    const displayDiff = isPluginBlurred ? '...' : `${sign}${q.diff.toFixed(2)}`

    const row = document.createElement('div')
    row.className = `line stock-row ${isSelected ? 'selected' : ''}`
    row.innerHTML = `<span class="ln">${lineNum++}</span><span>&nbsp;&nbsp;{ <span class="pr">id</span>: <span class="str">'${displayId}'</span>, <span class="pr">name</span>: <span class="nm" title="${fullName}"><span class="nm-abbr">'${displayAbbr}'</span><span class="nm-full">'${displayFull}'</span></span>, <span class="pr">v</span>: <span class="num">${displayPrice}</span>, <span class="pr">ofs</span>: <span class="str ${colorClass}">'${displayPct}'</span> },</span><span class="cm ${colorClass}">// ${displayDiff}</span><span class="del-btn" data-sym="${sym}" title="移除该股票">/*rm*/</span>`

    row.addEventListener('click', e => {
      if (e.target.classList.contains('del-btn')) return
      selectedSymbol = sym
      chrome.storage.local.set({ selectedSymbol })
      renderStockList()
      fetchChartData(selectedSymbol)
    })

    row.querySelector('.del-btn').addEventListener('click', e => {
      e.stopPropagation()
      watchList = watchList.filter(item => item !== sym)
      if (selectedSymbol === sym) {
        selectedSymbol = watchList[0] || ''
      }
      saveAndRefresh()
    })

    stockListEl.appendChild(row)
  })

  document.getElementById('ln-after-list').textContent = lineNum++
  document.getElementById('ln-chart-comment').textContent = lineNum++
  document.getElementById('ln-chart-canvas').textContent = lineNum++
}

async function fetchChartData(rawSym) {
  if (!rawSym) {
    chartData = []
    drawSparkline()
    return
  }

  const qInfo = quotesCache[rawSym]
  const abbr = abbrCache[rawSym] || (qInfo ? qInfo.name : rawSym)

  if (chartMode === 'minute') {
    chartTitle.textContent = `// TRACE_NODE: ${rawSym}_${abbr} [Intraday]`
    await fetchMinuteChart(rawSym)
  } else {
    chartTitle.textContent = `// TRACE_NODE: ${rawSym}_${abbr} [Daily Trend]`
    await fetchDailyChart(rawSym)
  }
}

// 核心修复：采用东方财富高可用稳定分时接口，彻底摆脱 501 报错
async function fetchMinuteChart(rawSym) {
  const qInfo = quotesCache[rawSym]
  let cleanSym = rawSym
    .trim()
    .toUpperCase()
    .replace(/^(SH|SZ|HK|US)/, '')

  // 判断市场代码：1 代表沪市，0 代表深市
  let secid = ''
  if (/^6\d{5}$/.test(cleanSym) || rawSym.toLowerCase().startsWith('sh')) {
    secid = `1.${cleanSym}`
  } else if (/^\d{6}$/.test(cleanSym) || rawSym.toLowerCase().startsWith('sz')) {
    secid = `0.${cleanSym}`
  }

  try {
    if (secid) {
      // 东方财富高可用极速分时数据源（无跨域无501限制）
      const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11&fields2=f51,f52,f53,f54,f55,f56,f57,f58&_=${Date.now()}`
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()

      if (json && json.data && json.data.trends) {
        prevClosePrice = json.data.preClose || (qInfo ? qInfo.prevClose : 0)
        chartData = json.data.trends.map(tStr => {
          const parts = tStr.split(',')
          // parts[0]: "2026-06-05 09:30", parts[2]: 当前价格
          const time = parts[0].split(' ')[1] || parts[0]
          return {
            timeStr: time.slice(0, 5),
            price: parseFloat(parts[2])
          }
        })
        drawSparkline()
        return
      }
    }

    // 备用兜底（港美股走势）
    let yahooSym = cleanSym
    if (/^\d{6}$/.test(cleanSym)) {
      yahooSym = cleanSym.startsWith('6') ? `${cleanSym}.SS` : `${cleanSym}.SZ`
    } else if (/^\d{4,5}$/.test(cleanSym)) {
      yahooSym = `${cleanSym.padStart(4, '0')}.HK`
    }
    const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=2m&range=1d&_t=${Date.now()}`
    const yRes = await fetch(yUrl, { cache: 'no-store' })
    const yData = await yRes.json()
    const result = yData.chart.result[0]
    prevClosePrice = result.meta.chartPreviousClose || result.meta.previousClose
    const timestamps = result.timestamp || []
    const closes = result.indicators.quote[0].close || []

    chartData = []
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined) {
        const d = new Date(timestamps[i] * 1000)
        chartData.push({
          timeStr: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          price: closes[i]
        })
      }
    }
    drawSparkline()
  } catch (err) {
    chartData = []
    drawSparkline()
  }
}

async function fetchDailyChart(rawSym) {
  let cleanSym = rawSym.trim().toUpperCase()
  if (/^SZ\d{6}$/.test(cleanSym)) {
    cleanSym = `${cleanSym.replace('SZ', '')}.SZ`
  } else if (/^SH\d{6}$/.test(cleanSym)) {
    cleanSym = `${cleanSym.replace('SH', '')}.SS`
  } else if (/^\d{6}$/.test(cleanSym)) {
    cleanSym = cleanSym.startsWith('6') ? `${cleanSym}.SS` : `${cleanSym}.SZ`
  } else if (/^\d{4,5}$/.test(cleanSym)) {
    cleanSym = `${cleanSym.padStart(4, '0')}.HK`
  }

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
        const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        chartData.push({
          timeStr,
          price: closes[i]
        })
      }
    }
    drawSparkline()
  } catch (err) {
    chartData = []
    drawSparkline()
  }
}

chartTitle.addEventListener('click', () => {
  chartMode = chartMode === 'minute' ? 'daily' : 'minute'
  fetchChartData(selectedSymbol)
})

function drawSparkline(highlightIndex = -1) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (chartData.length < 2) return

  const prices = chartData.map(d => d.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const pad = 4
  const w = canvas.width
  const h = canvas.height - pad * 2

  if (chartMode === 'minute' && prevClosePrice > 0) {
    const prevY = pad + h - ((prevClosePrice - min) / range) * h
    ctx.beginPath()
    ctx.strokeStyle = '#333333'
    ctx.setLineDash([2, 2])
    ctx.moveTo(0, prevY)
    ctx.lineTo(w, prevY)
    ctx.stroke()
    ctx.setLineDash([])
  }

  const qInfo = quotesCache[selectedSymbol]
  const isUp = qInfo ? qInfo.pct >= 0 : true

  ctx.beginPath()
  if (chartMode === 'minute') {
    ctx.strokeStyle = isUp ? '#d16969' : '#4ec9b0'
  } else {
    ctx.strokeStyle = '#4ec9b0'
  }
  ctx.lineWidth = 1.2

  chartData.forEach((pt, idx) => {
    const x = (idx / (chartData.length - 1)) * w
    const y = pad + h - ((pt.price - min) / range) * h
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  if (highlightIndex >= 0 && highlightIndex < chartData.length) {
    const pt = chartData[highlightIndex]
    const x = (highlightIndex / (chartData.length - 1)) * w
    const y = pad + h - ((pt.price - min) / range) * h
    ctx.fillStyle = '#9cdcfe'
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
}

canvas.addEventListener('mousemove', e => {
  if (chartData.length < 2) return
  const rect = canvas.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const idx = Math.min(
    chartData.length - 1,
    Math.max(0, Math.round((mouseX / canvas.width) * (chartData.length - 1)))
  )
  const item = chartData[idx]

  if (chartMode === 'minute') {
    const pct = prevClosePrice
      ? (((item.price - prevClosePrice) / prevClosePrice) * 100).toFixed(2)
      : '0.00'
    const sign = pct >= 0 ? '+' : ''
    hoverTip.textContent = `/* ${item.timeStr} -> ${item.price.toFixed(2)} (${sign}${pct}%) */`
  } else {
    let dailyPct = '0.00%'
    if (idx > 0) {
      const prevPrice = chartData[idx - 1].price
      const diff = item.price - prevPrice
      const p = (diff / prevPrice) * 100
      const sign = p >= 0 ? '+' : ''
      dailyPct = `${sign}${p.toFixed(2)}%`
    }
    hoverTip.textContent = `/* ${item.timeStr} -> ${item.price.toFixed(2)} (${dailyPct}) */`
  }
  drawSparkline(idx)
})

canvas.addEventListener('mouseleave', () => {
  hoverTip.textContent = ''
  drawSparkline()
})

window.addEventListener('blur', () => {
  isPluginBlurred = true
  renderStockList()
})

window.addEventListener('focus', () => {
  isPluginBlurred = false
  renderStockList()
  fetchAllRealtimeQuotes()
})

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
      saveAndRefresh()
    }
  }
})

function saveAndRefresh() {
  chrome.storage.local.set({ watchList, selectedSymbol })
  fetchAllRealtimeQuotes().then(() => {
    fetchChartData(selectedSymbol)
  })
}

function toggleBossMode() {
  document.getElementById('main-editor').classList.toggle('hidden')
  document.getElementById('boss-editor').classList.toggle('hidden')
}

document.getElementById('boss-key').addEventListener('click', toggleBossMode)
document.getElementById('fake-tab').addEventListener('click', toggleBossMode)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault()
    toggleBossMode()
  }
})

document.getElementById('refresh-btn').addEventListener('click', () => {
  fetchAllRealtimeQuotes()
  fetchChartData(selectedSymbol)
})

chrome.storage.local.get(['watchList', 'selectedSymbol', 'abbrCache'], res => {
  if (res.watchList && Array.isArray(res.watchList) && res.watchList.length > 0) {
    watchList = res.watchList
  }
  if (res.abbrCache) {
    abbrCache = res.abbrCache
  }
  selectedSymbol = res.selectedSymbol || watchList[0] || ''

  fetchAllRealtimeQuotes().then(() => {
    fetchChartData(selectedSymbol)
  })

  setInterval(fetchAllRealtimeQuotes, 3000)
  setInterval(() => fetchChartData(selectedSymbol), 15000)
})
