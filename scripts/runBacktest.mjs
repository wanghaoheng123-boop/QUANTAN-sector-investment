/**
 * scripts/runBacktest.mjs
 *
 * Standalone CLI backtest runner — no build step required.
 * Usage: node --experimental-vm-modules scripts/runBacktest.mjs
 *
 * Runs the full backtest for all 11 sector stocks (55 tickers) + BTC
 * using Yahoo Finance + CoinGecko data.
 *
 * Output: JSON summary to stdout, detailed per-instrument results in
 *   scripts/backtest/results.json
 */

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Sector data (mirror of lib/sectors.ts — no imports allowed in .mjs)
// ---------------------------------------------------------------------------
const SECTORS = [
  { slug: 'technology',        name: 'Technology',        etf: 'XLK', topHoldings: ['NVDA','MSFT','AAPL','AVGO','AMD'] },
  { slug: 'energy',            name: 'Energy',            etf: 'XLE', topHoldings: ['XOM','CVX','COP','EOG','SLB'] },
  { slug: 'financials',        name: 'Financials',        etf: 'XLF', topHoldings: ['BRK.B','JPM','V','MA','BAC'] },
  { slug: 'healthcare',        name: 'Healthcare',        etf: 'XLV', topHoldings: ['LLY','UNH','JNJ','ABBV','MRK'] },
  { slug: 'consumer-discretionary', name: 'Consumer Disc.', etf: 'XLY', topHoldings: ['AMZN','TSLA','HD','MCD','NKE'] },
  { slug: 'industrials',       name: 'Industrials',       etf: 'XLI', topHoldings: ['GE','RTX','CAT','UNP','HON'] },
  { slug: 'communication',     name: 'Communication',     etf: 'XLC', topHoldings: ['META','GOOGL','NFLX','DIS','T'] },
  { slug: 'materials',        name: 'Materials',         etf: 'XLB', topHoldings: ['LIN','APD','FCX','NEM','DOW'] },
  { slug: 'utilities',         name: 'Utilities',         etf: 'XLU', topHoldings: ['NEE','SO','DUK','AEP','PCG'] },
  { slug: 'real-estate',       name: 'Real Estate',       etf: 'XLRE', topHoldings: ['PLD','AMT','EQIX','WELL','SPG'] },
  { slug: 'consumer-staples', name: 'Consumer Staples',  etf: 'XLP', topHoldings: ['PG','COST','WMT','PEP','KO'] },
]

// ---------------------------------------------------------------------------
// Data loading (reimplemented here to avoid TS imports in .mjs)
// ---------------------------------------------------------------------------

async function loadYahooHistory(ticker, days = 1825) {
  const endMs = Date.now()
  const startMs = endMs - days * 86_400_000
  const period1 = Math.floor(startMs / 1000)
  const period2 = Math.floor(endMs / 1000)
  const url =
    `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv' }, cache: 'no-store' })
  if (!res.ok) { console.warn(`[${ticker}] Yahoo HTTP ${res.status}`); return [] }
  const text = await res.text()
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  return lines.slice(1).map(line => {
    const [dateStr, openStr, highStr, lowStr, closeStr, , volumeStr] = line.split(',')
    return {
      time: Math.floor(new Date(dateStr).getTime() / 1000),
      open: parseFloat(openStr),
      high: parseFloat(highStr),
      low: parseFloat(lowStr),
      close: parseFloat(closeStr),
      volume: parseFloat(volumeStr),
    }
  }).filter(r =>
    Number.isFinite(r.time) && Number.isFinite(r.open) &&
    Number.isFinite(r.high) && Number.isFinite(r.low) &&
    Number.isFinite(r.close) && r.volume >= 0
  ).sort((a, b) => a.time - b.time)
}

async function loadBtcHistory(days = 1825) {
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) { console.warn(`[BTC] CoinGecko HTTP ${res.status}`); return [] }
  const rows = await res.json()
  return (Array.isArray(rows) ? rows : []).map(([t, o, h, l, c]) => ({
    time: Math.floor(t / 1000),
    open: o, high: h, low: l, close: c, volume: 0,
  })).sort((a, b) => a.time - b.time)
}

// ---------------------------------------------------------------------------
// Indicator math (pure JS reimplementation)
// ---------------------------------------------------------------------------

function sma(values, period) {
  if (values.length < period) return null
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

function ema(values, period) {
  const k = 2 / (period + 1)
  const out = [values[0]]
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k))
  return out
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return out
  let ag = 0, al = 0
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i-1]; if (d >= 0) ag += d; else al -= d }
  ag /= period; al /= period
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1]
    ag = (ag * (period - 1) + Math.max(0, d)) / period
    al = (al * (period - 1) + Math.max(0, -d)) / period
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow)
  const line = closes.map((_, i) => ef[i] - es[i])
  const sig = ema(line.slice(slow - 1), signal)
  const outSig = new Array(closes.length).fill(NaN)
  for (let i = 0; i < sig.length; i++) outSig[i + slow - 1] = sig[i]
  const hist = line.map((l, i) => {
    const s = outSig[i]
    return Number.isFinite(l) && Number.isFinite(s) ? l - s : NaN
  })
  return { line, signal: outSig, histogram: hist }
}

function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(NaN)
  if (bars.length < period + 1) return out
  const trs = []
  for (let i = 1; i < bars.length; i++)
    trs.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i-1].close), Math.abs(bars[i].low - bars[i-1].close)))
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period] = avg
  for (let i = period; i < trs.length; i++) { avg = (avg * (period - 1) + trs[i]) / period; out[i + 1] = avg }
  return out
}

function sma200Slope(closes) {
  if (closes.length < 221) return null
  const now = sma(closes, 200), prev = sma(closes.slice(0, closes.length - 20), 200)
  if (now == null || prev == null || prev === 0) return null
  return (now - prev) / prev
}

function sma200Dev(price, sma200) {
  if (!Number.isFinite(sma200) || sma200 <= 0 || !Number.isFinite(price)) return null
  return ((price - sma200) / sma200) * 100
}

// ---------------------------------------------------------------------------
// Regime classifier (mirrors signals.ts)
// ---------------------------------------------------------------------------

function regimeSignal(price, closes, rsi14) {
  if (closes.length < 200) return { action: 'HOLD', confidence: 0, dipSignal: 'INSUFFICIENT_DATA', label: 'Insufficient Data', deviationPct: null, slopePct: null }
  const s200 = sma(closes, 200)
  if (!s200) return { action: 'HOLD', confidence: 0, dipSignal: 'INSUFFICIENT_DATA', label: 'Insufficient Data', deviationPct: null, slopePct: null }
  const dev = sma200Dev(price, s200)
  const slope = sma200Slope(closes)
  const slopePos = slope != null ? slope > 0 : null

  let zone, action, confidence, dipSignal
  if (dev > 20)       { zone = 'EXTREME_BULL'; action = 'HOLD'; confidence = 40; dipSignal = 'OVERBOUGHT' }
  else if (dev > 10)  { zone = 'EXTENDED_BULL'; action = 'HOLD'; confidence = 45; dipSignal = 'OVERBOUGHT' }
  else if (dev >= 0)  { zone = 'HEALTHY_BULL'; action = 'HOLD'; confidence = 55; dipSignal = 'IN_TREND' }
  else if (dev >= -10) {
    if (slopePos === true) { zone = 'FIRST_DIP'; action = 'BUY'; confidence = rsi14 != null && rsi14 < 35 ? 88 : 72; dipSignal = 'STRONG_DIP' }
    else                   { zone = 'FIRST_DIP'; action = 'HOLD'; confidence = 45; dipSignal = 'WATCH_DIP' }
  } else if (dev >= -20) {
    if (slopePos === true) { zone = 'DEEP_DIP'; action = 'HOLD'; confidence = 55; dipSignal = 'WATCH_DIP' }
    else                   { zone = 'DEEP_DIP'; action = 'SELL'; confidence = 80; dipSignal = 'FALLING_KNIFE' }
  } else if (dev >= -30) {
    if (slopePos === true) { zone = 'BEAR_ALERT'; action = 'HOLD'; confidence = 50; dipSignal = 'WATCH_DIP' }
    else                   { zone = 'BEAR_ALERT'; action = 'SELL'; confidence = 85; dipSignal = 'FALLING_KNIFE' }
  } else {
    if (slopePos === true) { zone = 'CRASH_ZONE'; action = 'BUY'; confidence = 78; dipSignal = 'STRONG_DIP' }
    else                   { zone = 'CRASH_ZONE'; action = 'SELL'; confidence = 92; dipSignal = 'FALLING_KNIFE' }
  }
  return { zone, action, confidence, dipSignal, label: zone, deviationPct: dev, slopePct: slope }
}

function combinedSignal(ticker, date, price, closes, bars, cfg) {
  const rsiVals = rsi(closes)
  const macdVals = macd(closes)
  const atrVals = atr(bars)
  const lastRsi = rsiVals[rsiVals.length - 1]
  const regime = regimeSignal(price, closes, lastRsi)
  const hist = macdVals.histogram[macdVals.histogram.length - 1]
  const lastAtr = atrVals[atrVals.length - 1]
  const bullishCount = (lastRsi < 40 ? 1 : 0) + (hist > 0 ? 1 : 0) + (lastAtr < 60 ? 1 : 0)
  const confidence = Math.min(100, regime.confidence + Math.round((bullishCount / 3) * 20))
  let action = regime.action
  if (confidence < (cfg?.confidenceThreshold ?? 60) && action !== 'SELL') action = 'HOLD'
  const kellyFrac = action === 'BUY' ? (regime.dipSignal === 'STRONG_DIP' ? 0.25 : 0.15) : (action === 'SELL' ? 1.0 : 0)
  return { ticker, date, price, regime, action, confidence, KellyFraction: kellyFrac, reason: `${regime.dipSignal}: ${regime.label}. Conf ${confidence}%.` }
}

// ---------------------------------------------------------------------------
// Backtest engine (standalone JS reimplementation)
// ---------------------------------------------------------------------------

function backtestInstrument(ticker, sector, rows, cfg = {}) {
  const initialCapital = cfg.initialCapital ?? 100_000
  const confidenceThreshold = cfg.confidenceThreshold ?? 60
  const maxDdCap = cfg.maxDrawdownCap ?? 0.25
  const halfKelly = cfg.halfKelly ?? true
  const TX_COST_BPS = 0.0011        // 11bps per side
  const ENTRY_SLIPPAGE_BPS = 0.0002 // 2bps entry slippage

  if (rows.length < 252) return { ticker, sector, totalReturn: 0, annualizedReturn: 0, sharpeRatio: null, sortinoRatio: null, maxDrawdown: 0, winRate: 0, profitFactor: 0, avgTradeReturn: 0, totalTrades: 0, closedTrades: [], equityCurve: [initialCapital], days: 0, confidenceAvg: 0, bnhReturn: 0, excessReturn: 0 }

  let capital = initialCapital
  let position = 0
  let avgCost = 0
  let peakEquity = initialCapital
  let equityHistory = [initialCapital]
  let dailyReturns = []
  let closedTrades = []
  let openTrade = null
  let confidenceSum = 0, confidenceCount = 0
  let tradeWins = 0, tradeLosses = 0

  for (let i = 200; i < rows.length; i++) {
    const row = rows[i]
    const date = new Date(row.time * 1000).toISOString().split('T')[0]
    const price = row.close
    // Execution price: next-day open (avoids lookahead bias of using signal-day close)
    const execPrice = i + 1 < rows.length ? rows[i + 1].open : rows[i].close
    const lookback = rows.slice(0, i + 1).map(r => r.close)
    const barLookback = rows.slice(0, i + 1)

    // ATR-adaptive stop-loss check
    if (openTrade) {
      const sl = openTrade.action === 'BUY' ? openTrade.entryPrice * (1 - openTrade.stopPct) : openTrade.entryPrice * (1 + openTrade.stopPct)
      if ((openTrade.action === 'BUY' && price <= sl) || (openTrade.action === 'SELL' && price >= sl)) {
        const netExecPrice = execPrice * (1 - TX_COST_BPS)
        capital += position * netExecPrice
        const pnlPct = (netExecPrice - openTrade.entryPrice) / openTrade.entryPrice
        openTrade.pnlPct = pnlPct
        openTrade.exitPrice = netExecPrice
        closedTrades.push({ ...openTrade })
        if (pnlPct > 0) tradeWins++; else tradeLosses++
        position = 0; openTrade = null
        equityHistory.push(capital)
        continue
      }
    }

    // Max drawdown circuit breaker
    const eq = capital + position * avgCost
    if (eq > peakEquity) peakEquity = eq
    const dd = (peakEquity - eq) / peakEquity
    if (dd >= maxDdCap && openTrade) {
      const netExecPrice = execPrice * (1 - TX_COST_BPS)
      capital += position * netExecPrice
      const pnlPct = (netExecPrice - openTrade.entryPrice) / openTrade.entryPrice
      openTrade.pnlPct = pnlPct; openTrade.exitPrice = netExecPrice
      closedTrades.push({ ...openTrade })
      if (pnlPct > 0) tradeWins++; else tradeLosses++
      position = 0; openTrade = null
      equityHistory.push(capital)
      continue
    }

    const signal = combinedSignal(ticker, date, price, lookback, barLookback, cfg)

    if (signal.action === 'BUY' && !openTrade) {
      const entryPrice = execPrice * (1 + ENTRY_SLIPPAGE_BPS)
      // ATR-adaptive stop: clamp(atrPct * 1.5, 0.05, 0.15)
      const atrVals = atr(barLookback)
      const lastAtrVal = atrVals[atrVals.length - 1]
      const lastCloseRow = barLookback[barLookback.length - 1]
      const atrPctEntry = lastCloseRow && lastCloseRow.close > 0 ? (lastAtrVal / lastCloseRow.close) * 100 : 2
      const stopPct = Math.min(0.15, Math.max(0.05, (atrPctEntry / 100) * 1.5))
      const kf = Math.min(signal.KellyFraction, 0.50)
      const allocation = capital * kf
      const shares = Math.floor(allocation / entryPrice)
      if (shares <= 0) { equityHistory.push(capital); continue }
      const cost = shares * entryPrice
      const txCost = cost * TX_COST_BPS
      capital -= (cost + txCost)
      position += shares
      avgCost = entryPrice
      openTrade = { date, ticker, sector, action: 'BUY', price: entryPrice, entryPrice, stopPct, shares, value: cost, regime: signal.regime.label, dipSignal: signal.regime.dipSignal, confidence: signal.confidence, pnlPct: null, reason: signal.reason }
      confidenceSum += signal.confidence; confidenceCount++
    } else if (signal.action === 'SELL' && openTrade) {
      const netExecPrice = execPrice * (1 - TX_COST_BPS)
      const proceeds = position * netExecPrice
      const pnlPct = (netExecPrice - openTrade.entryPrice) / openTrade.entryPrice
      if (pnlPct > 0) tradeWins++; else tradeLosses++
      capital += proceeds
      openTrade.pnlPct = pnlPct; openTrade.exitPrice = netExecPrice
      closedTrades.push({ ...openTrade })
      position = 0; avgCost = 0; openTrade = null
    } else {
      equityHistory.push(capital + position * avgCost)
    }
  }

  // Close remaining position
  const finalPrice = rows[rows.length - 1].close
  if (openTrade) {
    const netFinalPrice = finalPrice * (1 - TX_COST_BPS)
    const pnlPct = (netFinalPrice - openTrade.entryPrice) / openTrade.entryPrice
    if (pnlPct > 0) tradeWins++; else tradeLosses++
    capital += position * netFinalPrice
    openTrade.pnlPct = pnlPct; openTrade.exitPrice = netFinalPrice
    closedTrades.push({ ...openTrade })
    position = 0
  }

  const finalEquity = capital
  const totalReturn = (finalEquity - initialCapital) / initialCapital
  const years = rows.length / 252
  const annualizedReturn = (1 + totalReturn) ** (1 / years) - 1
  const initialPrice = rows[0].close
  const bnhReturn = (finalPrice - initialPrice) / initialPrice

  // Max drawdown
  let peak = initialCapital, maxDd = 0
  for (const eq of equityHistory) { if (eq > peak) peak = eq; const d = (peak - eq) / peak; if (d > maxDd) maxDd = d }

  // Win rate
  const winRate = closedTrades.length > 0 ? tradeWins / closedTrades.length : 0

  // Profit factor
  const grossProfit = closedTrades.filter(t => (t.pnlPct ?? 0) > 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(closedTrades.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Average trade return
  const avgTradeReturn = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closedTrades.length : 0

  // Sharpe
  let sharpe = null
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const v = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / (dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(v, 0))
    if (sd > 0) { const rfD = 0.04 / 252; sharpe = ((mean - rfD) / sd) * Math.sqrt(252) }
  }

  return {
    ticker, sector,
    initialPrice, finalPrice,
    totalReturn, annualizedReturn,
    sharpeRatio: sharpe,
    sortinoRatio: null,
    maxDrawdown: maxDd,
    winRate, profitFactor, avgTradeReturn,
    totalTrades: closedTrades.length,
    closedTrades,
    equityCurve: equityHistory,
    dailyReturns,
    days: rows.length,
    confidenceAvg: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
    bnhReturn, excessReturn: totalReturn - bnhReturn,
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

const INITIAL_CAPITAL = 100_000
const BACKTEST_DAYS = 1825  // ~5 years

console.log('\n========================================')
console.log('  INSTITUTIONAL BACKTEST — 5Y LONG ONLY')
console.log(`  Initial Capital: $${INITIAL_CAPITAL.toLocaleString()}`)
console.log(`  Period: ${BACKTEST_DAYS} days`)
console.log('========================================\n')

const allResults = []
const sectorSummary = {}

for (const sector of SECTORS) {
  console.log(`\n[${sector.name}]`)
  sectorSummary[sector.name] = { return: 0, tickers: [], annReturn: 0 }

  for (const ticker of sector.topHoldings) {
    process.stdout.write(`  Loading ${ticker}... `)
    const rows = await loadYahooHistory(ticker, BACKTEST_DAYS)
    if (rows.length === 0) { console.log('SKIP (no data)'); continue }
    process.stdout.write(`${rows.length} bars — backtesting... `)
    const result = backtestInstrument(ticker, sector.name, rows, {
      initialCapital: INITIAL_CAPITAL,
      confidenceThreshold: 60,
      maxDrawdownCap: 0.25,
      halfKelly: true,
    })
    const retPct = (result.totalReturn * 100).toFixed(2)
    const annPct = (result.annualizedReturn * 100).toFixed(2)
    const shp = result.sharpeRatio?.toFixed(2) ?? 'N/A'
    const ddPct = (result.maxDrawdown * 100).toFixed(1)
    console.log(`Return: ${retPct}% | Ann: ${annPct}% | Sharpe: ${shp} | MaxDD: ${ddPct}% | Trades: ${result.totalTrades}`)
    allResults.push(result)
    sectorSummary[sector.name].return += result.totalReturn
    sectorSummary[sector.name].annReturn += result.annualizedReturn
    sectorSummary[sector.name].tickers.push(ticker)
  }
}

// BTC
process.stdout.write('\n  Loading BTC... ')
const btcRows = await loadBtcHistory(BACKTEST_DAYS)
if (btcRows.length > 0) {
  process.stdout.write(`${btcRows.length} bars — backtesting... `)
  const btcResult = backtestInstrument('BTC', 'Crypto', btcRows, {
    initialCapital: INITIAL_CAPITAL,
    stopLossPct: 0.10,
    confidenceThreshold: 60,
    maxDrawdownCap: 0.25,
    halfKelly: true,
  })
  const retPct = (btcResult.totalReturn * 100).toFixed(2)
  const annPct = (btcResult.annualizedReturn * 100).toFixed(2)
  console.log(`Return: ${retPct}% | Ann: ${annPct}% | Sharpe: ${btcResult.sharpeRatio?.toFixed(2) ?? 'N/A'} | MaxDD: ${(btcResult.maxDrawdown*100).toFixed(1)}%`)
  allResults.push(btcResult)
  sectorSummary['Crypto'] = { return: btcResult.totalReturn, tickers: ['BTC'], annReturn: btcResult.annualizedReturn }
} else {
  console.log('SKIP (no data)')
}

// Portfolio-level summary
const avgReturn = allResults.reduce((s, r) => s + r.totalReturn, 0) / allResults.length
const avgAnnReturn = allResults.reduce((s, r) => s + r.annualizedReturn, 0) / allResults.length
const totalTrades = allResults.reduce((s, r) => s + r.totalTrades, 0)
const winningTrades = allResults.flatMap(r => r.closedTrades).filter(t => (t.pnlPct ?? 0) > 0).length
const allClosed = allResults.flatMap(r => r.closedTrades).length
const winRate = allClosed > 0 ? winningTrades / allClosed : 0
const maxPortfolioDd = Math.max(...allResults.map(r => r.maxDrawdown))
const bnhAvg = allResults.reduce((s, r) => s + r.bnhReturn, 0) / allResults.length

console.log('\n========================================')
console.log('  PORTFOLIO SUMMARY')
console.log('========================================')
console.log(`  Instruments:        ${allResults.length}`)
console.log(`  Total Trades:       ${totalTrades}`)
console.log(`  Win Rate:           ${(winRate * 100).toFixed(1)}%`)
console.log(`  Avg Return:         ${(avgReturn * 100).toFixed(2)}%`)
console.log(`  Avg Ann. Return:     ${(avgAnnReturn * 100).toFixed(2)}%`)
console.log(`  Avg B&H Return:      ${(bnhAvg * 100).toFixed(2)}%`)
console.log(`  Avg Alpha:           ${((avgAnnReturn - bnhAvg) * 100).toFixed(2)}%`)
console.log(`  Max Portfolio DD:   ${(maxPortfolioDd * 100).toFixed(1)}%`)
console.log('\n  SECTOR RETURNS (Ann. %):')
for (const [sector, data] of Object.entries(sectorSummary)) {
  const annPct = (data.annReturn / data.tickers.length * 100).toFixed(2)
  const barLen = Math.max(2, Math.round(parseFloat(annPct) / 2))
  const bar = '█'.repeat(Math.min(barLen, 50))
  console.log(`    ${sector.padEnd(20)} ${annPct}% ${bar}  [${data.tickers.join(', ')}]`)
}
console.log('\n========================================')

// Save to results.json
const outputPath = resolve(__dirname, 'backtest', 'results.json')
try {
  const summary = {
    computedAt: new Date().toISOString(),
    config: { initialCapital: INITIAL_CAPITAL, stopLossPct: 0.10, confidenceThreshold: 60, maxDrawdownCap: 0.25, halfKelly: true, days: BACKTEST_DAYS },
    instruments: allResults.map(r => ({
      ticker: r.ticker, sector: r.sector,
      initialPrice: r.initialPrice, finalPrice: r.finalPrice,
      totalReturn: r.totalReturn, annualizedReturn: r.annualizedReturn,
      sharpeRatio: r.sharpeRatio, maxDrawdown: r.maxDrawdown,
      winRate: r.winRate, profitFactor: r.profitFactor,
      avgTradeReturn: r.avgTradeReturn, totalTrades: r.totalTrades,
      confidenceAvg: r.confidenceAvg,
      bnhReturn: r.bnhReturn, excessReturn: r.excessReturn,
    })),
    sectorSummary: Object.fromEntries(
      Object.entries(sectorSummary).map(([k, v]) => [k, { return: v.return / Math.max(v.tickers.length, 1), annReturn: v.annReturn / Math.max(v.tickers.length, 1), tickers: v.tickers }])
    ),
    portfolio: {
      avgReturn, avgAnnReturn, totalTrades, winRate,
      maxPortfolioDd, bnhAvg, alpha: avgAnnReturn - bnhAvg,
    }
  }
  writeFileSync(outputPath, JSON.stringify(summary, null, 2))
  console.log(`\nResults saved to scripts/backtest/results.json`)
} catch (e) {
  console.warn('Could not write results.json:', e.message)
}
