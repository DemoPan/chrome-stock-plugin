const symbolInput = document.getElementById('symbol-input')
const stockListEl = document.getElementById('stock-list')
const statusMsg = document.getElementById('status-msg')
const updateTime = document.getElementById('update-time')
const chartTitle = document.getElementById('chart-title')
const canvas = document.getElementById('sparkline')
const ctx = canvas.getContext('2d')
const hoverTip = document.getElementById('hover-tip')

let watchList = ['601899', '513650', 'sh000001', '600825', '002343', '09988', '00700', '688825']
let selectedSymbol = '601899'
let quotesCache = {}
let abbrCache = {}
let chartData = []
let prevClosePrice = 0
let isPluginBlurred = false
let chartMode = 'minute' // 'minute' 代表分时图, 'daily' 代表日线图

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
    const sign = q.pct >= 0 ? '+' : ''
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
    row.innerHTML = `
      <span class="ln">${lineNum++}</span>
      <span>&nbsp;&nbsp;{ <span class="pr">id</span>: <span class="str">'${displayId}'</span>, <span class="pr">name</span>: <span class="nm" title="${fullName}"><span class="nm-abbr">'${displayAbbr}'</span><span class="nm-full">'${displayFull}'</span></span>, <span class="pr">v</span>: <span class="num">${displayPrice}</span>, <span class="pr">ofs</span>: <span class="str">'${displayPct}'</span> },</span>
      <span class="cm">// ${displayDiff}</span>
      <span class="del-btn" data-sym="${sym}" title="移除该股票">/*rm*/</span>
    `

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

// 统一调度：根据当前图表模式（分时图 or 日线图）抓取对应数据
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

// 抓取分时图数据
async function fetchMinuteChart(rawSym) {
  const tSym = toTencentSymbol(rawSym)
  const qInfo = quotesCache[rawSym]

  try {
    if (tSym.startsWith('sh') || tSym.startsWith('sz') || tSym.startsWith('hk')) {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?_t=${Date.now()}&code=${tSym}`
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json()
      const stockNode = json.data[tSym]
      const minData = stockNode.data.data || []
      prevClosePrice = parseFloat(stockNode.qt[tSym][4]) || (qInfo ? qInfo.prevClose : 0)

      chartData = minData.map(item => {
        const parts = item.split(' ')
        const rawTime = parts[0]
        const timeStr = `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}`
        return {
          timeStr,
          price: parseFloat(parts[1])
        }
      })
      drawSparkline()
    } else {
      const yahooSym = rawSym.trim().toUpperCase()
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=2m&range=1d&_t=${Date.now()}`
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
            timeStr: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            price: closes[i]
          })
        }
      }
      drawSparkline()
    }
  } catch (err) {}
}

// 抓取日线图数据（最近 30/60 个交易日收盘价趋势）
async function fetchDailyChart(rawSym) {
  const yahooSym = rawSym.trim().toUpperCase()
  try {
    // 兼容A股在 Yahoo 上的代码格式
    let ySymbol = yahooSym
    if (/^\d{6}$/.test(yahooSym)) {
      ySymbol = yahooSym.startsWith('6') ? `${yahooSym}.SS` : `${yahooSym}.SZ`
    } else if (/^\d{4,5}$/.test(yahooSym)) {
      ySymbol = `${yahooSym.padStart(4, '0')}.HK`
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=2mo&_t=${Date.now()}`
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
  } catch (err) {}
}

// 点击图表标题切换模式
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

  // 如果是分时图，绘制昨收虚线基准线
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

  // 绘制折线
  ctx.beginPath()
  ctx.strokeStyle = chartMode === 'minute' ? '#566c73' : '#4ec9b0' // 日线用青色区分
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
    hoverTip.textContent = `/* ${item.timeStr} -> ${item.price.toFixed(2)} (${pct}%) */`
  } else {
    hoverTip.textContent = `/* ${item.timeStr} -> ${item.price.toFixed(2)} */`
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

symbolInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const rawVal = symbolInput.value.trim().toUpperCase()
    if (rawVal) {
      const newSyms = rawVal.split(/[,，\s]+/).filter(Boolean)
      newSyms.forEach(s => {
        if (!watchList.includes(s)) {
          watchList.push(s)
        }
        selectedSymbol = s
        ensureSymbolAbbr(s)
      })
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
