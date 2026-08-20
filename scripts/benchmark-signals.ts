/**
 * Canonical CI benchmark — uses resolveBacktestSignal (production path) via benchmarkLabel SSOT.
 * Forces QUANTAN_USE_ENHANCED_SIGNAL=0 so WR matches Vercel production.
 *
 * Usage: npm run benchmark
 * Output: scripts/benchmark-results.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import {
  runInstrumentLabelBenchmark,
  roundTripCostPct,
  LABEL_HOLD_DAYS,
  WARMUP_BARS,
} from '../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../lib/backtest/executionModel'
import { probabilisticSharpe, deflatedSharpe, sampleStd } from '../lib/quant/deflatedSharpe'
import { readTrialCount } from '../lib/quant/trialRegistry'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')

function loadAllTickers(): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = readFileSync(join(dataDir, f), 'utf-8')
      const data = JSON.parse(raw) as { sector?: string; candles?: OhlcvRow[] }
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const rows = (data.candles ?? []).filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      return { ticker, sector: data.sector ?? 'Unknown', rows }
    })
    .filter((d) => d.rows.length >= 252)
}

console.log('Loading data (SSOT: resolveBacktestSignal, production path)...')
const allData = loadAllTickers()
console.log(`Loaded ${allData.length} instruments`)

const results = []
let totalBuySignals = 0
let totalWins = 0
let totalLosses = 0
let totalNetWins = 0

for (const { ticker, sector, rows } of allData) {
  const stats = runInstrumentLabelBenchmark(ticker, sector, rows, { productionPath: true })
  if (!stats) continue
  results.push(stats)
  totalBuySignals += stats.buySignals
  totalWins += stats.wins
  totalLosses += stats.losses
  if (stats.netWinRate != null && stats.buySignals > 0) {
    totalNetWins += Math.round(stats.netWinRate * stats.buySignals)
  }
}

const aggWinRate = totalBuySignals > 0 ? totalWins / totalBuySignals : 0
const aggNetWinRate = totalBuySignals > 0 ? totalNetWins / totalBuySignals : 0

const instrumentsWithTrades = results.filter((r) => r.buySignals > 0)
const avgWinRatePerInstrument =
  instrumentsWithTrades.length > 0
    ? instrumentsWithTrades.reduce((s, r) => s + (r.winRate ?? 0), 0) / instrumentsWithTrades.length
    : 0

const avgReturn =
  results.reduce((s, r) => s + (r.avgReturn20d ?? 0) * r.buySignals, 0) /
  Math.max(1, totalBuySignals)
const avgNetReturn =
  results.reduce((s, r) => s + (r.avgNetReturn20d ?? 0) * r.buySignals, 0) /
  Math.max(1, totalBuySignals)

const expectancyGross = avgReturn
const expectancyNet = avgNetReturn

// ── Q-065: PSR / Deflated Sharpe on pooled per-trade NET returns ─────────────
// CAVEAT (printed + persisted): label trades OVERLAP (daily signals, 20d holds),
// so the effective sample is smaller than nTrades and PSR/DSR are OPTIMISTIC
// upper bounds. DSR shown as a sensitivity band (N=10 / N=100 assumed trials)
// rather than a single invented trials count.
const allTrades = results.flatMap((r) => r.trades)
const netRets = allTrades.map((t) => t.netReturn)
const perTradeSharpe =
  netRets.length > 1 && sampleStd(netRets) > 0
    ? netRets.reduce((a, b) => a + b, 0) / netRets.length / sampleStd(netRets)
    : null

// ── Q-081 / Q-099: deflate against the HONEST sample and a COUNTED denominator
//
// Two bugs met here and either alone made the correction inert.
//
// (1) WRONG T. DSR was computed on `netRets`, the pooled OVERLAPPING series
//     (~10x the independent sample, because signals fire daily against a 20-day
//     hold). `expectedMaxSharpe` scales as 1/sqrt(T-1), so at T=3410 the
//     multiple-testing bar collapses and DSR saturates at 1.0000 — provably
//     unmoved by nTrials from 10 to 1e12. A headline that cannot move is not a
//     test. The greedy per-instrument non-overlapping sample below is what the
//     pooled win rate has always claimed to be; it is now what DSR is measured
//     on. The overlapping figure is retained, clearly labelled, as the
//     optimistic bound it always was.
//
// (2) INVENTED N. `nTrials` was hardcoded 10 and 100 — guesses, while
//     `.quantlab/TRIAL_REGISTRY.jsonl` sat unread with no reader anywhere in the
//     repo. It is now counted from the registry.
//
// Reported as a BAND, not a point, because T-0001 records declared_grid 1024
// against reported 16 and flags itself uncertain (Q-084). Both ends are lower
// bounds: configurations tried and discarded without a written record are, by
// construction, absent from the registry.
const nonOverlapTrades = results.flatMap((r) => {
  const kept: typeof r.trades = []
  let lastTaken = -Infinity
  for (const t of r.trades) {
    if (t.barIndex - lastTaken <= LABEL_HOLD_DAYS) continue
    lastTaken = t.barIndex
    kept.push(t)
  }
  return kept
})
const netRetsEffective = nonOverlapTrades.map((t) => t.netReturn)

const registryPath = join(__dirname, '..', '.quantlab', 'TRIAL_REGISTRY.jsonl')
if (!existsSync(registryPath)) {
  console.error('FAIL: .quantlab/TRIAL_REGISTRY.jsonl is missing — I5 requires a counted trial denominator, and guessing one is the defect this replaced.')
  process.exit(1)
}
const trials = readTrialCount(readFileSync(registryPath, 'utf8'))
if (trials.rows === 0) {
  console.error('FAIL: TRIAL_REGISTRY.jsonl parsed to zero rows.')
  process.exit(1)
}

const psr = probabilisticSharpe(netRetsEffective, 0)
const dsrLower = deflatedSharpe(netRetsEffective, trials.lower)
const dsrUpper = deflatedSharpe(netRetsEffective, trials.upper)
/** The headline: deflated against the LARGEST defensible trial count. */
const dsrHeadline = dsrUpper
// Retained only to show what the previous headline was measuring.
const dsrOverlappingOptimistic = deflatedSharpe(netRets, trials.upper)

// ── Base rate (2026-07-11 rethink): the honest context for the headline WR ──
// Net-label outcome of "BUY every eligible bar" on the SAME universe/window/
// costs. On a survivor universe in a bull window this sits well above 50%
// (54.02% at introduction), so the KPI that matters is EDGE OVER BASE RATE,
// not distance from a coin flip. (Medallion's famous 50.75% is a short-horizon
// long/short figure with a ~50% base rate — not comparable to long-only 20d.)
let baseBuys = 0
let baseNetWins = 0
let baseSumNet = 0
const baseByYear = new Map<string, { n: number; wins: number }>()
for (const { rows } of allData) {
  for (let i = WARMUP_BARS; i < rows.length - LABEL_HOLD_DAYS - 1; i++) {
    const entry = rows[i + 1].close
    const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, rows.length - 1)].close
    if (!(entry > 0) || !(exit > 0)) continue
    const gross = (exit - entry) / entry
    const net = netReturnAfterCosts(gross, DEFAULT_EXECUTION_COSTS)
    baseBuys++
    baseSumNet += net
    if (net > 0) baseNetWins++
    const year = new Date(rows[i].time * 1000).toISOString().slice(0, 4)
    const by = baseByYear.get(year) ?? { n: 0, wins: 0 }
    by.n++
    if (net > 0) by.wins++
    baseByYear.set(year, by)
  }
}
const baseRateNetWR = baseBuys > 0 ? (baseNetWins / baseBuys) * 100 : 0
const baseRateAvgNet = baseBuys > 0 ? (baseSumNet / baseBuys) * 100 : 0

// ── Non-overlapping WR + Wilson CI (2026-07-11 red team, C2) ─────────────────
// Daily signals with 20d holds OVERLAP ~10×, inflating n from ~350 to 3,435.
// Greedy per-instrument sampling (next trade only after the prior label window
// closes) gives the honest effective sample; the Wilson interval on it is the
// error bar the pooled WR does not have. Gate-worthy form: CI lower bound vs
// the base rate — a raw-WR floor below the base rate certifies nothing.
function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.959963984540054
  const p = k / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}
let noN = 0
let noWins = 0
for (const r of results) {
  let lastTaken = -Infinity
  for (const t of r.trades) {
    if (t.barIndex - lastTaken <= LABEL_HOLD_DAYS) continue
    lastTaken = t.barIndex
    noN++
    if (t.netReturn > 0) noWins++
  }
}
const [noLo, noHi] = wilson95(noWins, noN)

// ── Per-year edge over base rate (red team C4: pooled WR hides decay) ───────
const signalByYear = new Map<string, { n: number; wins: number }>()
for (const t of results.flatMap((r) => r.trades)) {
  const year = t.date.slice(0, 4)
  const sy = signalByYear.get(year) ?? { n: 0, wins: 0 }
  sy.n++
  if (t.netReturn > 0) sy.wins++
  signalByYear.set(year, sy)
}
const perYearEdge = Array.from(baseByYear.keys())
  .sort()
  .map((year) => {
    const base = baseByYear.get(year)!
    const sig = signalByYear.get(year) ?? { n: 0, wins: 0 }
    const sigWR = sig.n > 0 ? (sig.wins / sig.n) * 100 : null
    const baseWR = base.n > 0 ? (base.wins / base.n) * 100 : null
    return {
      year,
      signalTrades: sig.n,
      signalNetWR: sigWR == null ? null : Number(sigWR.toFixed(2)),
      baseNetWR: baseWR == null ? null : Number(baseWR.toFixed(2)),
      edgePp: sigWR == null || baseWR == null ? null : Number((sigWR - baseWR).toFixed(2)),
    }
  })

// ── Q-066: regime-bucketed WR (zone at the signal bar) ───────────────────────
const bucketMap = new Map<string, { n: number; netWins: number; sumNet: number }>()
for (const t of allTrades) {
  const b = bucketMap.get(t.zone) ?? { n: 0, netWins: 0, sumNet: 0 }
  b.n++
  if (t.netReturn > 0) b.netWins++
  b.sumNet += t.netReturn
  bucketMap.set(t.zone, b)
}
const regimeBuckets = Array.from(bucketMap.entries())
  .map(([zone, b]) => ({
    zone,
    trades: b.n,
    netWinRate: Number(((b.netWins / b.n) * 100).toFixed(2)),
    avgNetReturn20d: Number(((b.sumNet / b.n) * 100).toFixed(4)),
  }))
  .sort((a, b) => b.trades - a.trades)

const benchmark = {
  timestamp: new Date().toISOString(),
  version: 'v2.0-ssot-regime-production',
  strategy: 'resolveBacktestSignal (regime-only, QUANTAN_USE_ENHANCED_SIGNAL=0)',
  metricNote: `Label win rate: ${LABEL_HOLD_DAYS}d forward return after BUY; entry next close; gross and net after round-trip costs`,
  executionCosts: {
    ...DEFAULT_EXECUTION_COSTS,
    roundTripPct: Number((roundTripCostPct() * 100).toFixed(4)),
  },
  aggregate: {
    totalInstruments: results.length,
    instrumentsWithTrades: instrumentsWithTrades.length,
    totalBuySignals,
    totalWins,
    totalLosses,
    aggregateWinRate: Number((aggWinRate * 100).toFixed(2)),
    aggregateNetWinRate: Number((aggNetWinRate * 100).toFixed(2)),
    avgWinRatePerInstrument: Number((avgWinRatePerInstrument * 100).toFixed(2)),
    avgReturn20d: Number((avgReturn * 100).toFixed(4)),
    avgNetReturn20d: Number((avgNetReturn * 100).toFixed(4)),
    expectancyGrossPct: Number((expectancyGross * 100).toFixed(4)),
    expectancyNetPct: Number((expectancyNet * 100).toFixed(4)),
    avgHoldDays: LABEL_HOLD_DAYS,
  },
  // Q-065, corrected by Q-081/Q-099: per-trade Sharpe + PSR/DSR.
  //
  // THE HEADLINE IS `deflatedSharpe`, computed on the NON-OVERLAPPING sample
  // against the LARGEST defensible trial count. I5 says report the deflated
  // number, never the raw one.
  tradeStats: {
    // The pooled overlapping count, kept because per-trade Sharpe is computed
    // on it and because the previous headline was. It is NOT the DSR sample.
    nTrades: netRets.length,
    nTradesEffective: netRetsEffective.length,
    perTradeSharpe: perTradeSharpe == null ? null : Number(perTradeSharpe.toFixed(4)),
    psrGtZero: psr == null ? null : Number(psr.toFixed(4)),
    deflatedSharpe: dsrHeadline == null ? null : Number(dsrHeadline.toFixed(4)),
    deflatedSharpeBand:
      dsrLower == null || dsrUpper == null
        ? null
        : [Number(dsrUpper.toFixed(4)), Number(dsrLower.toFixed(4))],
    nTrials: { lower: trials.lower, upper: trials.upper, registryRows: trials.rows, uncertainTrials: trials.uncertain },
    deflatedSharpeOverlappingOptimistic:
      dsrOverlappingOptimistic == null ? null : Number(dsrOverlappingOptimistic.toFixed(4)),
    note:
      'Bailey-Lopez de Prado PSR/DSR. HEADLINE (deflatedSharpe) is computed on the NON-OVERLAPPING per-instrument sample (n=' +
      netRetsEffective.length +
      ') against nTrials=' +
      trials.upper +
      ' counted from .quantlab/TRIAL_REGISTRY.jsonl. Band spans the registry interval [' +
      trials.lower +
      ', ' +
      trials.upper +
      '] — both LOWER BOUNDS, since discarded-without-record configurations are absent by construction; T-0001 is flagged uncertain (Q-084). deflatedSharpeOverlappingOptimistic is the SAME statistic on the pooled overlapping series and is the number this benchmark published before Q-081: it saturates at 1.0000 and is insensitive to nTrials, which is why it was replaced.',
  },
  // 2026-07-11 rethink (additive): "BUY every bar" base rate on the same
  // universe/window/costs — the honest yardstick for the headline WR.
  alwaysBuyBaseline: {
    nBars: baseBuys,
    netWinRatePct: Number(baseRateNetWR.toFixed(2)),
    avgNetReturn20dPct: Number(baseRateAvgNet.toFixed(4)),
    note:
      'Unconditional long exposure on this survivor universe/bull window. The strategy KPI is EDGE OVER THIS BASE RATE; note the CI net-WR floor (53.29) sits BELOW it — floor re-baseline is an owner decision tracked in the 2026-07-11 rethink.',
  },
  edgeOverBaseRatePp: Number((Number((aggNetWinRate * 100).toFixed(2)) - Number(baseRateNetWR.toFixed(2))).toFixed(2)),
  // 2026-07-11 rethink wave 2 (red team C2/C4): the honest effective sample +
  // decay visibility. nonOverlapStats is the number the pooled WR pretends to
  // be; perYearEdge shows whether the edge persists (pooled aggregates hide
  // multi-year decay).
  nonOverlapStats: {
    nTrades: noN,
    netWinRatePct: noN > 0 ? Number(((noWins / noN) * 100).toFixed(2)) : null,
    wilson95Pct: [Number((noLo * 100).toFixed(2)), Number((noHi * 100).toFixed(2))],
    note:
      'Greedy per-instrument non-overlapping sample (one trade per closed 20d window). This is the honest effective n behind the pooled WR; compare the Wilson CI to the always-buy base rate, not to 50%.',
  },
  perYearEdge,
  // Q-066 (additive): WR bucketed by the regime zone at the signal bar.
  regimeBuckets,
  // byInstrument keeps its EXACT pre-Q-065 shape: strip the per-trade detail.
  byInstrument: results
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .map(({ trades: _trades, ...rest }) => rest),
}

const outPath = join(__dirname, 'benchmark-results.json')
writeFileSync(outPath, JSON.stringify(benchmark, null, 2))

console.log('\n=== BENCHMARK RESULTS (SSOT) ===')
console.log(`Instruments: ${benchmark.aggregate.totalInstruments}`)
console.log(`Instruments with trades: ${benchmark.aggregate.instrumentsWithTrades}`)
console.log(`Total BUY signals: ${benchmark.aggregate.totalBuySignals}`)
console.log(`Wins: ${benchmark.aggregate.totalWins} | Losses: ${benchmark.aggregate.totalLosses}`)
console.log(`Aggregate Win Rate (gross label): ${benchmark.aggregate.aggregateWinRate}%`)
console.log(`Aggregate Win Rate (net after costs): ${benchmark.aggregate.aggregateNetWinRate}%`)
console.log(`Avg 20d return (gross): ${benchmark.aggregate.avgReturn20d}%`)
console.log(`Avg 20d return (net): ${benchmark.aggregate.avgNetReturn20d}%`)
console.log(`Expectancy gross/net: ${benchmark.aggregate.expectancyGrossPct}% / ${benchmark.aggregate.expectancyNetPct}%`)
console.log(
  `Per-trade Sharpe (net): ${benchmark.tradeStats.perTradeSharpe} | PSR(>0): ${benchmark.tradeStats.psrGtZero}`,
  `DEFLATED Sharpe (headline): ${benchmark.tradeStats.deflatedSharpe} — non-overlapping n=${benchmark.tradeStats.nTradesEffective}, nTrials=${benchmark.tradeStats.nTrials.upper} counted from the trial registry`,
  `  band over registry interval [${benchmark.tradeStats.nTrials.lower}, ${benchmark.tradeStats.nTrials.upper}]: ${JSON.stringify(benchmark.tradeStats.deflatedSharpeBand)} (both ends are LOWER bounds on trials tried)`,
  `  same statistic on the OVERLAPPING series (what this benchmark published before Q-081): ${benchmark.tradeStats.deflatedSharpeOverlappingOptimistic} — saturated, insensitive to nTrials`,
)
console.log(
  `Always-buy base rate (net): ${benchmark.alwaysBuyBaseline.netWinRatePct}% over ${benchmark.alwaysBuyBaseline.nBars} bars | strategy edge over base: ${benchmark.edgeOverBaseRatePp}pp`,
)
console.log(
  `Non-overlapping (effective n): ${benchmark.nonOverlapStats.nTrades} trades, net WR ${benchmark.nonOverlapStats.netWinRatePct}% (Wilson 95% [${benchmark.nonOverlapStats.wilson95Pct[0]}, ${benchmark.nonOverlapStats.wilson95Pct[1]}])`,
)
console.log('Per-year edge over base (net WR pp):')
for (const y of benchmark.perYearEdge) {
  console.log(`  ${y.year}  signal ${String(y.signalNetWR).padStart(6)}% (n=${String(y.signalTrades).padStart(4)})  base ${String(y.baseNetWR).padStart(6)}%  edge ${y.edgePp == null ? '—' : (y.edgePp >= 0 ? '+' : '') + y.edgePp}pp`,
  )
}
console.log('Regime buckets (net WR / avg net 20d):')
for (const b of benchmark.regimeBuckets) {
  console.log(`  ${b.zone.padEnd(14)} n=${String(b.trades).padStart(4)}  WR ${b.netWinRate}%  avg ${b.avgNetReturn20d}%`)
}
console.log(`\nSaved to: ${outPath}`)

/** Frozen 2026-05-26 SSOT re-baseline (50 bps tolerance). See reviews/invariants-baseline.md §1b. */
const FLOOR_GROSS_WR = 54.27
const FLOOR_NET_WR = 53.29

/**
 * D1 gate re-founding (2026-07-11 rethink, MASTER §4 D1 — see
 * reviews/invariants-baseline.md §1b amendment). The raw net-WR floor (53.29)
 * sits BELOW the always-buy base rate (54.02 at freeze), so passing it
 * certifies nothing about selection skill. The PRIMARY gate is now the EDGE
 * OVER THE BASE RATE, frozen 2026-07-11 at +2.31pp with the established
 * 50 bps tolerance convention → hard floor +1.81pp. The raw WR floors are
 * retained as SECONDARY regression guards (they still catch code breakage
 * independent of base-rate drift). Significance (non-overlap Wilson lower
 * bound vs the base rate) is reported as WARN, not FAIL — it is EXPECTED to
 * warn until the edge becomes significant at honest sample sizes; hardening
 * it into a failure is a future owner decision.
 */
const FLOOR_EDGE_PP = 1.81

if (benchmark.edgeOverBaseRatePp < FLOOR_EDGE_PP) {
  console.error(
    `\nREGRESSION (primary gate): edge over base rate ${benchmark.edgeOverBaseRatePp}pp below floor ${FLOOR_EDGE_PP}pp ` +
      `(net WR ${benchmark.aggregate.aggregateNetWinRate}% vs base ${benchmark.alwaysBuyBaseline.netWinRatePct}%)`,
  )
  process.exit(1)
}
/**
 * I5 gate (Q-099). Until now the ONLY executing performance gate read the RAW
 * edge, which is precisely the number I5 forbids as a headline — so a run could
 * pass with DSR null, the trial registry deleted, and no OOS run ever performed.
 *
 * READ WHAT THIS GATE IS AND IS NOT.
 *
 * It is a REGRESSION guard on the deflated statistic. It is NOT a certification
 * that the strategy has skill, and it must never be quoted as one:
 *
 *  - The measured DSR is ~0.49. A conventional bar is 0.95. **The shipped result
 *    does not come close to clearing it**, and this gate does not pretend
 *    otherwise — it freezes the current value so the number cannot silently get
 *    worse while nobody is reading it.
 *  - I5's full bar additionally requires PBO/CSCV, which has NO implementation
 *    (`Q-085`). No strategy in this repo has ever met I5. Passing this gate
 *    leaves that untouched.
 *
 * Per CLAUDE.md: a PR must not regress an invariant, but closing an existing gap
 * is backlog work, not a merge blocker. Hence a floor at the frozen value rather
 * than at the conventional bar — setting 0.95 today would fail every run and be
 * learned-ignored within a week, which is how a constitution becomes decoration.
 *
 * Tolerance is wider than the WR convention (50 bps) because the price history
 * is rewritten in place weekly and the universe is re-anchored to Date.now()
 * (`Q-102`), so the sample genuinely moves between runs. Observed first-hand:
 * regenerating this benchmark five days after the committed run moved the trade
 * count 3410 -> 3394 and the effective sample 347 -> 345 with no code change.
 */
const FLOOR_DEFLATED_SHARPE = 0.43
const CONVENTIONAL_DSR_BAR = 0.95

const dsrPublished = benchmark.tradeStats.deflatedSharpe
if (dsrPublished == null) {
  console.error(
    '\nFAIL (I5): tradeStats.deflatedSharpe is null. I5 requires the deflated number as the headline; ' +
      'a missing statistic is a failure, not a pass.',
  )
  process.exit(1)
}
if (benchmark.tradeStats.nTrials.registryRows === 0) {
  console.error('\nFAIL (I5): the trial registry contributed zero rows, so nTrials is not counted.')
  process.exit(1)
}
if (dsrPublished < FLOOR_DEFLATED_SHARPE) {
  console.error(
    `\nREGRESSION (I5 gate): deflated Sharpe ${dsrPublished} below floor ${FLOOR_DEFLATED_SHARPE} ` +
      `(non-overlapping n=${benchmark.tradeStats.nTradesEffective}, nTrials=${benchmark.tradeStats.nTrials.upper})`,
  )
  process.exit(1)
}
console.log(
  `\nI5 gate: deflated Sharpe ${dsrPublished} >= floor ${FLOOR_DEFLATED_SHARPE} — REGRESSION GUARD ONLY.\n` +
    `  This is NOT a skill certification: ${dsrPublished} is far below the conventional ${CONVENTIONAL_DSR_BAR} bar,\n` +
    `  and I5 also requires PBO/CSCV, which has no implementation (Q-085). No strategy here has met I5.`,
)

if (benchmark.aggregate.aggregateNetWinRate < FLOOR_NET_WR) {
  console.error(
    `\nREGRESSION (secondary guard): net aggregate WR ${benchmark.aggregate.aggregateNetWinRate}% below floor ${FLOOR_NET_WR}%`,
  )
  process.exit(1)
}
if (benchmark.aggregate.aggregateWinRate < FLOOR_GROSS_WR) {
  console.warn(
    `WARN: gross aggregate WR ${benchmark.aggregate.aggregateWinRate}% below gross floor ${FLOOR_GROSS_WR}%`,
  )
}
const wilsonLowPct = benchmark.nonOverlapStats.wilson95Pct[0]
if (wilsonLowPct != null && wilsonLowPct < benchmark.alwaysBuyBaseline.netWinRatePct) {
  console.warn(
    `WARN (expected until significance): non-overlap Wilson 95% lower bound ${wilsonLowPct}% is below the ` +
      `always-buy base rate ${benchmark.alwaysBuyBaseline.netWinRatePct}% — the selection edge is not yet ` +
      `statistically significant at effective n=${benchmark.nonOverlapStats.nTrades}.`,
  )
}
