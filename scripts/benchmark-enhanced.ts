/**
 * scripts/benchmark-enhanced.ts
 *
 * Institutional-grade benchmark using Phase 2's enhancedCombinedSignal.
 * Research-only path; canonical CI gate is scripts/benchmark-signals.ts (SSOT).
 *
 * Usage: npm run benchmark:enhanced
 * Output: scripts/benchmark-results-enhanced.json
 *
 * Metrics per instrument:
 *   - Win rate (20-day forward return > 0)
 *   - Avg 20-day return per signal
 *   - Sharpe ratio (annualized, from daily equity curve)
 *   - Sortino ratio
 *   - Max drawdown (equity curve)
 *   - Profit factor
 *   - Signal frequency (trades per year)
 *
 * Sector-level aggregates are also produced.
 * Walk-forward split: IS = first 70% of bars, OOS = last 30%.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Use relative imports to avoid @/ alias issues with tsx
import { enhancedCombinedSignal, DEFAULT_CONFIG } from '../lib/backtest/signals'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import { getProfileForTicker } from '../lib/optimize/sectorProfiles'
import { sharpeRatio, sortinoRatio } from '../lib/quant/indicators'
import { getRiskFreeRateSync } from '../lib/quant/riskFreeRate'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')

// ─── Sector universe (mirrors lib/sectors.ts & runBacktest.mjs) ──────────────

const SECTORS_MAP: Record<string, string> = {
  NVDA: 'Technology', MSFT: 'Technology', AAPL: 'Technology', AVGO: 'Technology', AMD: 'Technology',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', EOG: 'Energy', SLB: 'Energy',
  'BRK.B': 'Financials', JPM: 'Financials', V: 'Financials', MA: 'Financials', BAC: 'Financials',
  LLY: 'Healthcare', UNH: 'Healthcare', JNJ: 'Healthcare', ABBV: 'Healthcare', MRK: 'Healthcare',
  AMZN: 'Consumer Disc.', TSLA: 'Consumer Disc.', HD: 'Consumer Disc.', MCD: 'Consumer Disc.', NKE: 'Consumer Disc.',
  GE: 'Industrials', RTX: 'Industrials', CAT: 'Industrials', UNP: 'Industrials', HON: 'Industrials',
  META: 'Communication', GOOGL: 'Communication', NFLX: 'Communication', DIS: 'Communication', T: 'Communication',
  LIN: 'Materials', APD: 'Materials', FCX: 'Materials', NEM: 'Materials', DOW: 'Materials',
  NEE: 'Utilities', SO: 'Utilities', DUK: 'Utilities', AEP: 'Utilities', PCG: 'Utilities',
  PLD: 'Real Estate', AMT: 'Real Estate', EQIX: 'Real Estate', WELL: 'Real Estate', SPG: 'Real Estate',
  PG: 'Consumer Staples', COST: 'Consumer Staples', WMT: 'Consumer Staples', PEP: 'Consumer Staples', KO: 'Consumer Staples',
  BTC: 'Crypto',
}

// ─── Data loading ─────────────────────────────────────────────────────────────

interface CandleFile {
  ticker: string
  sector?: string
  candles: OhlcvRow[]
}

function loadAllTickers(): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const raw = readFileSync(join(dataDir, f), 'utf-8')
      const data = JSON.parse(raw) as CandleFile
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const sector = SECTORS_MAP[ticker] ?? data.sector ?? 'Unknown'
      const rows: OhlcvRow[] = (data.candles ?? []).filter(
        c => Number.isFinite(c.time) && Number.isFinite(c.open) &&
             Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close),
      )
      return { ticker, sector, rows }
    })
    .filter(d => d.rows.length >= 252)
}

// ─── Convert rows to the formats signals.ts expects ──────────────────────────

function closesFromRows(rows: OhlcvRow[]): number[] {
  return rows.map(r => r.close)
}

function barsFromRows(rows: OhlcvRow[]): { open: number; high: number; low: number; close: number }[] {
  return rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
}

function ohlcvBarsFromRows(rows: OhlcvRow[]): { open: number; high: number; low: number; close: number; volume: number; time: number }[] {
  return rows.map(r => ({
    open: r.open, high: r.high, low: r.low, close: r.close,
    volume: r.volume ?? 0, time: r.time,
  }))
}

// ─── Per-instrument benchmark ─────────────────────────────────────────────────

interface InstrumentResult {
  ticker: string
  sector: string
  bars: number
  buySignals: number
  wins: number
  losses: number
  winRate: number | null
  avgReturn20d: number | null
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number
  profitFactor: number
  bnhReturn: number
  excessReturn: number | null
  signalsPerYear: number
  // Walk-forward split
  isWinRate: number | null
  oosWinRate: number | null
  overfitGap: number | null
}

function runInstrument(ticker: string, sector: string, rows: OhlcvRow[]): InstrumentResult {
  const closes = closesFromRows(rows)
  const bars = barsFromRows(rows)
  const ohlcv = ohlcvBarsFromRows(rows)

  const bnhReturn = closes.length > 0 ? (closes[closes.length - 1] - closes[0]) / closes[0] : 0
  const profile = getProfileForTicker(ticker)
  const cfg = {
    ...DEFAULT_CONFIG,
    confidenceThreshold: profile.confidenceThreshold,
  }

  // Walk-forward split
  const splitIdx = Math.floor(rows.length * 0.70)

  let isBuys = 0, isWins = 0
  let oosBuys = 0, oosWins = 0
  let totalBuys = 0, totalWins = 0, totalLosses = 0
  const returns20d: number[] = []

  // Simple equity curve for Sharpe/max-drawdown
  let equity = 100_000
  let peakEquity = equity
  const equityHistory: number[] = [equity]
  const dailyReturns: number[] = []
  let openPos: { entryPrice: number; idx: number } | null = null

  const ohlcvLookback = ohlcvBarsFromRows(rows)
  const sectorGates = getProfileForTicker(ticker)

  for (let i = 220; i < rows.length - 21; i++) {
    const lookback = closes.slice(0, i + 1)
    const barLookback = bars.slice(0, i + 1)
    const ohlcvSlice = ohlcvLookback.slice(0, i + 1)
    const price = closes[i]
    const date = new Date(rows[i].time * 1000).toISOString().split('T')[0]

    // Close open position at 20d (uniform hold period — sector-specific exit optimization in Loop 3)
    if (openPos && i >= openPos.idx + 20) {
      const exitPrice = closes[i]
      const ret = (exitPrice - openPos.entryPrice) / openPos.entryPrice
      equity *= (1 + ret * 0.15) // 15% position size (half-Kelly approx)
      openPos = null
    }

    const sig = enhancedCombinedSignal(ticker, date, price, lookback, barLookback, ohlcvSlice, cfg, sectorGates)

    if (sig.action === 'BUY' && !openPos) {
      const entryPrice = closes[i + 1] // next-day execution
      const exitPrice = closes[Math.min(i + 21, closes.length - 1)]
      const ret = (exitPrice - entryPrice) / entryPrice
      returns20d.push(ret)
      totalBuys++

      if (ret > 0) {
        totalWins++
        if (i < splitIdx) isWins++; else oosWins++
      } else {
        totalLosses++
      }
      if (i < splitIdx) isBuys++; else oosBuys++

      openPos = { entryPrice, idx: i + 1 }
    }

    // Track equity for Sharpe
    if (equityHistory.length > 0) {
      const prev = equityHistory[equityHistory.length - 1]
      const eq = equity
      if (prev > 0) dailyReturns.push((eq - prev) / prev)
    }
    equityHistory.push(equity)
    if (equity > peakEquity) peakEquity = equity
  }

  // Max drawdown
  let peak2 = 100_000, maxDd = 0
  for (const eq of equityHistory) {
    if (eq > peak2) peak2 = eq
    const dd = (peak2 - eq) / peak2
    if (dd > maxDd) maxDd = dd
  }

  // Win rate
  const winRate = totalBuys > 0 ? totalWins / totalBuys : null
  const avgReturn = returns20d.length > 0 ? returns20d.reduce((a, b) => a + b, 0) / returns20d.length : null

  // IS/OOS rates
  const isWinRate = isBuys > 0 ? isWins / isBuys : null
  const oosWinRate = oosBuys > 0 ? oosWins / oosBuys : null
  const overfitGap = isWinRate != null && oosWinRate != null ? isWinRate - oosWinRate : null

  // Profit factor
  const gross = returns20d.filter(r => r > 0).reduce((s, r) => s + r, 0)
  const loss = Math.abs(returns20d.filter(r => r < 0).reduce((s, r) => s + r, 0))
  const profitFactor = loss > 0 ? gross / loss : gross > 0 ? Infinity : 0

  // Sharpe
  let sharpe: number | null = null
  let sortino: number | null = null
  if (dailyReturns.length > 30) {
    // Same delegation for Sharpe, and for the same reason: this copy carried the
    // same hardcoded 0.04 and guarded `sd > 0` rather than the SSOT's 1e-10.
    //
    // MIND THE UNITS, and they are NOT the same for the two siblings:
    // `sharpeRatio` takes an ANNUAL rate and divides internally (`rfAnnual`,
    // indicators.ts:673), while `sortinoRatio` takes a DAILY one (`marDaily`,
    // :717). Passing the daily rate to both — which is what the first draft of
    // this delegation did — silently sets Sharpe's risk-free rate to 0.045/252,
    // i.e. effectively zero, and no type catches it because both are `number`.
    // Logged as Q110-Q4f.
    sharpe = sharpeRatio(dailyReturns, getRiskFreeRateSync(), 252)
    // Q110-Q4d (2026-09-06) — this was a FOURTH live Sortino implementation,
    // while `lib/quant/indicators.ts` claims to be the consolidated SSOT and
    // ledger row F1.16 records three divergent copies as merged. It was also
    // internally inconsistent: the shortfall filter used MAR = 0 (`x < 0`)
    // while the numerator used `mean − rfDaily`, so the two halves disagreed
    // about the target return. It had no `n_d ≥ 30` minimum (only
    // `neg.length > 0`), no dispersion guard — so it reproduced the degenerate
    // constant Q110-Q4 removed from the canonical one — and it hardcoded
    // `0.04 / 252` where the SSOT reads 0.045 from `getRiskFreeRateSync()`,
    // a magic number that also disagreed with the rest of the platform.
    //
    // Delegating is what HOUSE STYLE requires ("never duplicate RSI/EMA math"),
    // and it is why the same guards now apply here for free.
    sortino = sortinoRatio(dailyReturns, getRiskFreeRateSync() / 252, 252)
  }

  const years = rows.length / 252
  const signalsPerYear = years > 0 ? totalBuys / years : 0

  // Q110-Q5 (2026-09-06) — this was `avgReturn * 252 - bnhReturn`, which
  // subtracted a ~5-year CUMULATIVE buy-and-hold return from a per-trade mean
  // scaled by 252. Two different units over two different windows. `avgReturn`
  // is a mean 20-DAY return, so ×252 also assumed 252 independent such trades a
  // year — off by ~12.6× on its own terms, before the comparison even happens.
  //
  // The fix is the same one Q110-Q1 applied to the engine: compare like with
  // like. Convert buy-and-hold to a per-20-day rate over ITS OWN window and
  // difference the two per-20-day returns. This needs no annualisation and no
  // assumption about how often trades occur or whether they overlap — the two
  // guesses the old expression made silently.
  const HOLD_BARS = 20
  const bnhPer20d =
    rows.length > HOLD_BARS && bnhReturn > -1
      ? (1 + bnhReturn) ** (HOLD_BARS / rows.length) - 1
      : null
  const excessReturn =
    avgReturn != null && bnhPer20d != null ? avgReturn - bnhPer20d : null

  return {
    ticker, sector, bars: rows.length,
    buySignals: totalBuys, wins: totalWins, losses: totalLosses,
    winRate, avgReturn20d: avgReturn,
    sharpeRatio: sharpe, sortinoRatio: sortino,
    maxDrawdown: maxDd, profitFactor, bnhReturn, excessReturn,
    signalsPerYear, isWinRate, oosWinRate, overfitGap,
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════')
console.log('  QUANTAN ENHANCED BENCHMARK — Phase 8 Loop 2')
console.log('  enhancedCombinedSignal + full sector gate configs')
console.log('══════════════════════════════════════════════════\n')

const allData = loadAllTickers()
console.log(`Loaded ${allData.length} instruments\n`)

const results: InstrumentResult[] = []
let totalBuys = 0, totalWins = 0, totalLosses = 0

for (const { ticker, sector, rows } of allData) {
  process.stdout.write(`  [${sector.padEnd(18)}] ${ticker.padEnd(8)} `)
  const r = runInstrument(ticker, sector, rows)
  results.push(r)
  totalBuys += r.buySignals
  totalWins += r.wins
  totalLosses += r.losses

  const wr = r.winRate != null ? (r.winRate * 100).toFixed(1) + '%' : 'N/A   '
  const avg = r.avgReturn20d != null ? ((r.avgReturn20d * 100).toFixed(2) + '%').padStart(7) : '   N/A '
  const shp = r.sharpeRatio != null ? r.sharpeRatio.toFixed(2).padStart(5) : '  N/A'
  const oos = r.oosWinRate != null ? (r.oosWinRate * 100).toFixed(0) + '%' : 'N/A'
  const gap = r.overfitGap != null ? (r.overfitGap >= 0 ? '+' : '') + (r.overfitGap * 100).toFixed(0) + '%' : 'N/A'
  console.log(`WR: ${wr.padEnd(7)} AvgRet: ${avg} Sharpe: ${shp} | OOS: ${oos} Gap: ${gap} | Buys: ${r.buySignals}`)
}

// ─── Sector aggregates ────────────────────────────────────────────────────────

const sectorMap: Record<string, InstrumentResult[]> = {}
for (const r of results) {
  if (!sectorMap[r.sector]) sectorMap[r.sector] = []
  sectorMap[r.sector].push(r)
}

console.log('\n══════════════════════════════════════════════════')
console.log('  SECTOR SUMMARY')
console.log('══════════════════════════════════════════════════')

const sectorSummary: Record<string, {
  avgWinRate: number
  avgAvgReturn: number
  avgSharpe: number | null
  avgOOSWinRate: number | null
  tickers: string[]
  totalTrades: number
}> = {}

for (const [sector, sResults] of Object.entries(sectorMap)) {
  const hasWR = sResults.filter(r => r.winRate != null)
  const hasOOS = sResults.filter(r => r.oosWinRate != null)
  const hasSharpe = sResults.filter(r => r.sharpeRatio != null)
  const avgWR = hasWR.length > 0 ? hasWR.reduce((s, r) => s + (r.winRate ?? 0), 0) / hasWR.length : 0
  const avgRet = sResults.filter(r => r.avgReturn20d != null).reduce((s, r) => s + (r.avgReturn20d ?? 0), 0) / Math.max(1, sResults.filter(r => r.avgReturn20d != null).length)
  const avgShp = hasSharpe.length > 0 ? hasSharpe.reduce((s, r) => s + (r.sharpeRatio ?? 0), 0) / hasSharpe.length : null
  const avgOOS = hasOOS.length > 0 ? hasOOS.reduce((s, r) => s + (r.oosWinRate ?? 0), 0) / hasOOS.length : null
  const totalTrades = sResults.reduce((s, r) => s + r.buySignals, 0)
  sectorSummary[sector] = {
    avgWinRate: avgWR,
    avgAvgReturn: avgRet,
    avgSharpe: avgShp,
    avgOOSWinRate: avgOOS,
    tickers: sResults.map(r => r.ticker),
    totalTrades,
  }
  const oosStr = avgOOS != null ? (avgOOS * 100).toFixed(1) + '%' : 'N/A  '
  console.log(`  ${sector.padEnd(20)} WR: ${(avgWR * 100).toFixed(1)}% OOS: ${oosStr} Sharpe: ${avgShp?.toFixed(2) ?? 'N/A'} Trades: ${totalTrades}`)
}

// ─── Aggregate metrics ────────────────────────────────────────────────────────

const aggWinRate = totalBuys > 0 ? totalWins / totalBuys : 0
const instrumentsWithTrades = results.filter(r => r.buySignals > 0)
const avgWRPerInst = instrumentsWithTrades.length > 0
  ? instrumentsWithTrades.reduce((s, r) => s + (r.winRate ?? 0), 0) / instrumentsWithTrades.length
  : 0

const withOOS = results.filter(r => r.oosWinRate != null)
const avgOOS = withOOS.length > 0 ? withOOS.reduce((s, r) => s + (r.oosWinRate ?? 0), 0) / withOOS.length : 0

const withOverfit = results.filter(r => r.overfitGap != null)
const avgOverfitGap = withOverfit.length > 0 ? withOverfit.reduce((s, r) => s + (r.overfitGap ?? 0), 0) / withOverfit.length : 0

const sortedByWR = [...results].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
const bottom10 = [...results].filter(r => r.winRate != null).sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0)).slice(0, 10)

console.log('\n══════════════════════════════════════════════════')
console.log('  AGGREGATE RESULTS')
console.log('══════════════════════════════════════════════════')
console.log(`  Instruments:             ${results.length}`)
console.log(`  Instruments with trades: ${instrumentsWithTrades.length}`)
console.log(`  Total BUY signals:       ${totalBuys}`)
console.log(`  Aggregate Win Rate:      ${(aggWinRate * 100).toFixed(2)}%`)
console.log(`  Avg WR per Instrument:   ${(avgWRPerInst * 100).toFixed(2)}%`)
console.log(`  Avg OOS Win Rate:        ${(avgOOS * 100).toFixed(2)}%`)
console.log(`  Avg Overfit Gap (IS-OOS): ${(avgOverfitGap * 100).toFixed(2)}%`)
if (aggWinRate < 0.55) {
  console.warn(
    `\n⚠ Enhanced research WR ${(aggWinRate * 100).toFixed(2)}% < 55% — not production default (Q-009). No CI exit.`,
  )
}
console.log(`\n  BOTTOM 10 (need fixes):`)
for (const r of bottom10) {
  const wr = r.winRate != null ? (r.winRate * 100).toFixed(1) + '%' : 'N/A'
  console.log(`    ${r.ticker.padEnd(8)} ${r.sector.padEnd(18)} WR: ${wr} Buys: ${r.buySignals}`)
}

// ─── Save results ─────────────────────────────────────────────────────────────

const output = {
  timestamp: new Date().toISOString(),
  version: 'v3.0-phase8-loop2',
  // Q110-Q4g (2026-09-06) — the caveat travels WITH the number, because a
  // number in a JSON file gets quoted onward and a comment in the producer does
  // not. `dailyReturns` here is the STRATEGY EQUITY CURVE, which is flat on
  // ~94% of days because the strategy holds cash. With MAR = rf > 0 every flat
  // day is a shortfall of exactly MAR, so the ratio degenerates monotonically
  // toward −sqrt(252) ≈ −15.87 as trading frequency falls — and the values in
  // this file sit at −14 to −15.5. They are measuring TIME OUT OF MARKET, not
  // risk-adjusted return. The Q110-Q4 dispersion guard correctly does not fire
  // (there IS some dispersion); it catches the fully degenerate case, not this
  // near-degenerate one. Same finding as the backtest surface, fourth instance.
  sharpeSortinoCaveat:
    'sharpeRatio and sortinoRatio in byInstrument are computed on a strategy equity ' +
    'curve that is flat ~94% of days. Sortino degenerates toward -sqrt(252) as ' +
    'trading frequency falls and here measures time-out-of-market, not risk-adjusted ' +
    'return. DO NOT QUOTE. See findings-ledger Q110-Q4g.',
  strategy: 'combinedSignal + sector gate post-filters (goldenCross, momentum) + per-sector maxHoldDays',
  aggregate: {
    totalInstruments: results.length,
    instrumentsWithTrades: instrumentsWithTrades.length,
    totalBuySignals: totalBuys,
    totalWins,
    totalLosses,
    aggregateWinRate: Number((aggWinRate * 100).toFixed(2)),
    avgWinRatePerInstrument: Number((avgWRPerInst * 100).toFixed(2)),
    avgOOSWinRate: Number((avgOOS * 100).toFixed(2)),
    avgOverfitGap: Number((avgOverfitGap * 100).toFixed(2)),
    vsBaseline: {
      baselineWinRate: 56.35,
      baselineAvgWinRatePerInst: 58.97,
      improvement: Number((aggWinRate * 100 - 56.35).toFixed(2)),
    },
  },
  sectorSummary,
  byInstrument: sortedByWR,
}

const outPath = join(__dirname, 'benchmark-results-enhanced.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\n✓ Results saved to scripts/benchmark-results-enhanced.json`)
