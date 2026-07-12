/**
 * D2/R1 + D4/R4 ACCEPTANCE EXPERIMENT (2026-07-11 rethink, MASTER §4 D2+D4).
 * EXPERIMENT ONLY — no engine or published-number changes; shipping any of
 * these exit policies into lib/backtest is a separate owner decision.
 *
 * R1 hypothesis: the ATR/trailing stops are a design contradiction for dip
 * entries (buy weakness, then stop exactly where pullback noise lives). Exit
 * on time / regime repair instead, matching the label.
 * R4 hypothesis: the falling-knife SELL is anti-predictive (C6 CONFIRMED:
 * SELL bars beat the base rate forward in EVERY year) — retiring it as an
 * exit should not hurt.
 *
 * Variants (single-slot per instrument, 100% of the instrument's slot,
 * signal at close i → T+1 fill at open i+1, 11 bps/side — E-series
 * conventions from the red-team ablation):
 *   A  time-only:        exit after H=20 bars
 *   B  time + repair:    A, plus exit when the dip has repaired (close ≥ 200SMA)
 *   C  time + SELL exit: A, plus exit on the SSOT falling-knife SELL (the
 *      current engine's signal-exit behavior, WITHOUT its ATR/trailing stops)
 *
 * All signals come from the production SSOT (signalAtBarIndex) — no
 * reimplementation. The 200SMA for variant B's exit is computed locally (it
 * is an EXIT input under test, not a signal-parity claim). Entries are
 * label-window-guarded (no new entries in the final 21 bars) — conservative.
 *
 * Anchors (computed in this run — numbers must name their harness):
 *   - label net WR from the same SSOT pass (benchmark math)
 *   - committed engine: backtestInstrument(defaults) summed (trades, eq-weight
 *     avg total return) — the "current engine" for R1's ≥3× criterion
 *   - equal-weight B&H from bar 200 close (E-series base)
 *
 * Acceptance:
 *   R1: variant net trade WR within 2pp of label net WR AND eq-weight return
 *       ≥ 3× committed engine eq-weight return
 *   R4: retiring the SELL exit (A/B) does not regress vs keeping it (C) by
 *       more than 1pp avg-net-per-trade in any year (per-year table reported)
 *
 * Usage: npm run experiment:stop-removal
 * Output: workspace/optimization-runs/stop-removal-experiment.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'
import { signalAtBarIndex, LABEL_HOLD_DAYS, WARMUP_BARS } from '../../lib/backtest/benchmarkLabel'
import { backtestInstrument } from '../../lib/backtest/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const SIDE = 0.0011
const RT = 2 * SIDE
const H = LABEL_HOLD_DAYS // 20

interface Inst {
  ticker: string
  sector: string
  rows: OhlcvRow[]
  /** 1=BUY, -1=SELL, 0=HOLD at close i (production SSOT). */
  action: Int8Array
  /** close/200SMA − 1 (fraction); NaN before bar 199. */
  dev: Float64Array
  /** forward 20d net label for BUY bars (benchmark math); NaN elsewhere. */
  labelNet: Float64Array
}

function loadAndSignal(): Inst[] {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  const out: Inst[] = []
  for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as {
      sector?: string
      candles?: OhlcvRow[]
    }
    const ticker = f.replace('.json', '').replace(/-/g, '.')
    const rows = (data.candles ?? []).filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    if (rows.length < 252) continue
    const n = rows.length

    const action = new Int8Array(n)
    const labelNet = new Float64Array(n).fill(NaN)
    for (let i = WARMUP_BARS; i < n - H - 1; i++) {
      const out2 = signalAtBarIndex(rows, i, ticker, { productionPath: true })
      action[i] = out2.action === 'BUY' ? 1 : out2.action === 'SELL' ? -1 : 0
      if (out2.action === 'BUY' && out2.netReturn != null) labelNet[i] = out2.netReturn
    }

    const closes = rows.map((r) => r.close)
    const P = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + closes[i]
    const dev = new Float64Array(n).fill(NaN)
    for (let i = 199; i < n; i++) {
      const sma = (P[i + 1] - P[i - 199]) / 200
      dev[i] = closes[i] / sma - 1
    }

    out.push({ ticker, sector: data.sector ?? 'Unknown', rows, action, dev, labelNet })
  }
  return out
}

type Variant = 'A_timeOnly' | 'B_timeRepair' | 'C_timeSellExit'
const VARIANTS: Variant[] = ['A_timeOnly', 'B_timeRepair', 'C_timeSellExit']

interface TradeRec {
  netRet: number
  exitYear: string
}
interface VariantAgg {
  trades: TradeRec[]
  instReturns: number[]
  inMktBars: number
  totalBars: number
}

function runVariant(inst: Inst, variant: Variant): { trades: TradeRec[]; totalReturn: number; inMkt: number; bars: number } {
  const { rows, action, dev } = inst
  const n = rows.length
  let cash = 1
  let shares = 0
  let entryPx = 0
  let entryBar = -1
  const trades: TradeRec[] = []
  let inMkt = 0
  let bars = 0

  const yearAt = (i: number) => new Date(rows[i].time * 1000).toISOString().slice(0, 4)

  for (let i = WARMUP_BARS; i < n - 1; i++) {
    bars++
    if (shares > 0) {
      inMkt++
      const held = i - entryBar
      const timeExit = held >= H
      const repairExit = variant === 'B_timeRepair' && Number.isFinite(dev[i]) && dev[i] >= 0
      const sellExit = variant === 'C_timeSellExit' && action[i] === -1
      if (timeExit || repairExit || sellExit) {
        const px = rows[i + 1].open
        if (px > 0) {
          cash = shares * px * (1 - SIDE)
          shares = 0
          const gross = px / entryPx
          trades.push({ netRet: gross - 1 - RT, exitYear: yearAt(i + 1) })
        }
      }
    }
    if (shares === 0 && action[i] === 1) {
      const px = rows[i + 1].open
      if (px > 0) {
        entryPx = px
        entryBar = i + 1
        shares = (cash * (1 - SIDE)) / px
        cash = 0
      }
    }
  }
  if (shares > 0) {
    const last = rows[n - 1].close
    cash = shares * last * (1 - SIDE)
    const gross = last / entryPx
    trades.push({ netRet: gross - 1 - RT, exitYear: yearAt(n - 1) })
    shares = 0
  }
  return { trades, totalReturn: cash - 1, inMkt, bars }
}

console.log('Loading instruments + SSOT actions (production path)…')
const insts = loadAndSignal()
console.log(`Loaded ${insts.length} instruments`)

// ── Anchor 1: label net WR from the same pass ────────────────────────────────
let labelN = 0
let labelWins = 0
for (const inst of insts)
  for (let i = 0; i < inst.labelNet.length; i++) {
    const v = inst.labelNet[i]
    if (Number.isFinite(v)) {
      labelN++
      if (v > 0) labelWins++
    }
  }
const labelNetWR = labelN > 0 ? (labelWins / labelN) * 100 : NaN
console.log(`Label anchor: ${labelN} BUY labels, net WR ${labelNetWR.toFixed(2)}%`)

// ── Anchor 2: committed engine (backtestInstrument defaults, summed) ─────────
console.log('Running committed engine anchor (backtestInstrument defaults)…')
let engTrades = 0
let engWins = 0
const engReturns: number[] = []
for (const inst of insts) {
  const r = backtestInstrument(inst.ticker, inst.sector, inst.rows)
  engTrades += r.totalTrades
  engWins += r.closedTrades.filter((t) => (t.pnlPct ?? 0) > 0).length
  engReturns.push(r.totalReturn)
}
const engEqWeight = (engReturns.reduce((a, b) => a + b, 0) / engReturns.length) * 100
console.log(
  `Engine anchor: ${engTrades} trades, WR ${engTrades > 0 ? ((engWins / engTrades) * 100).toFixed(1) : '—'}%, eq-weight total return ${engEqWeight.toFixed(2)}%`,
)

// ── Anchor 3: equal-weight B&H from bar 200 close ────────────────────────────
const bnhEqWeight =
  (insts.reduce((s, x) => {
    const c = x.rows.map((r) => r.close)
    return s + (c[c.length - 1] - c[200]) / c[200]
  }, 0) /
    insts.length) *
  100

// ── Variants ─────────────────────────────────────────────────────────────────
const aggs: Record<Variant, VariantAgg> = {
  A_timeOnly: { trades: [], instReturns: [], inMktBars: 0, totalBars: 0 },
  B_timeRepair: { trades: [], instReturns: [], inMktBars: 0, totalBars: 0 },
  C_timeSellExit: { trades: [], instReturns: [], inMktBars: 0, totalBars: 0 },
}
for (const inst of insts) {
  for (const v of VARIANTS) {
    const r = runVariant(inst, v)
    aggs[v].trades.push(...r.trades)
    aggs[v].instReturns.push(r.totalReturn)
    aggs[v].inMktBars += r.inMkt
    aggs[v].totalBars += r.bars
  }
}

interface VariantSummary {
  variant: Variant
  trades: number
  netWinRatePct: number | null
  avgNetPerTradePct: number | null
  eqWeightReturnPct: number
  timeInMarketPct: number
  wrVsLabelPp: number | null
  returnMultipleVsEngine: number | null
  r1WrPass: boolean
  r1ReturnPass: boolean
  perYear: { year: string; trades: number; netWR: number | null; avgNetPct: number | null }[]
}

function summarize(v: Variant): VariantSummary {
  const a = aggs[v]
  const n = a.trades.length
  const wins = a.trades.filter((t) => t.netRet > 0).length
  const wr = n > 0 ? (wins / n) * 100 : null
  const avg = n > 0 ? (a.trades.reduce((s, t) => s + t.netRet, 0) / n) * 100 : null
  const eq = (a.instReturns.reduce((s, x) => s + x, 0) / a.instReturns.length) * 100
  const years = new Map<string, { n: number; wins: number; sum: number }>()
  for (const t of a.trades) {
    const y = years.get(t.exitYear) ?? { n: 0, wins: 0, sum: 0 }
    y.n++
    if (t.netRet > 0) y.wins++
    y.sum += t.netRet
    years.set(t.exitYear, y)
  }
  const perYear = Array.from(years.keys())
    .sort()
    .map((year) => {
      const y = years.get(year)!
      return {
        year,
        trades: y.n,
        netWR: y.n > 0 ? Number(((y.wins / y.n) * 100).toFixed(2)) : null,
        avgNetPct: y.n > 0 ? Number(((y.sum / y.n) * 100).toFixed(4)) : null,
      }
    })
  const wrVsLabel = wr != null ? Number((wr - labelNetWR).toFixed(2)) : null
  const mult = engEqWeight > 0 ? Number((eq / engEqWeight).toFixed(2)) : null
  return {
    variant: v,
    trades: n,
    netWinRatePct: wr == null ? null : Number(wr.toFixed(2)),
    avgNetPerTradePct: avg == null ? null : Number(avg.toFixed(4)),
    eqWeightReturnPct: Number(eq.toFixed(2)),
    timeInMarketPct: Number(((a.inMktBars / a.totalBars) * 100).toFixed(1)),
    wrVsLabelPp: wrVsLabel,
    returnMultipleVsEngine: mult,
    r1WrPass: wrVsLabel != null && Math.abs(wrVsLabel) <= 2,
    r1ReturnPass: mult != null && mult >= 3,
    perYear,
  }
}

const summaries = VARIANTS.map(summarize)

// ── R4: per-year regression check (A/B vs C, avg net per trade, 1pp tol) ────
const cByYear = new Map(summaries[2].perYear.map((y) => [y.year, y]))
const r4 = (['A_timeOnly', 'B_timeRepair'] as const).map((v) => {
  const s = summaries.find((x) => x.variant === v)!
  const regressions = s.perYear
    .map((y) => {
      const c = cByYear.get(y.year)
      if (!c || y.avgNetPct == null || c.avgNetPct == null) return null
      return { year: y.year, deltaAvgNetPp: Number((y.avgNetPct - c.avgNetPct).toFixed(4)) }
    })
    .filter((x): x is { year: string; deltaAvgNetPp: number } => x != null)
  return {
    variant: v,
    vsC_perYearDeltaAvgNetPp: regressions,
    noRegression: regressions.every((r) => r.deltaAvgNetPp >= -1),
  }
})

const payload = {
  timestamp: new Date().toISOString(),
  experiment:
    'D2/R1 stop-removal + D4/R4 SELL-retirement acceptance experiment (2026-07-11 rethink). EXPERIMENT ONLY.',
  conventions:
    'Single-slot per instrument, signal at close → T+1 open fill, 11 bps/side; entries label-window-guarded (none in final 21 bars); win = net of 22 bps round trip.',
  anchors: {
    labelNetWRPct: Number(labelNetWR.toFixed(2)),
    labelN,
    committedEngine: {
      harness: 'backtestInstrument(defaults) summed over universe (this run)',
      trades: engTrades,
      winRatePct: engTrades > 0 ? Number(((engWins / engTrades) * 100).toFixed(2)) : null,
      eqWeightReturnPct: Number(engEqWeight.toFixed(2)),
    },
    bnhEqWeightPct: Number(bnhEqWeight.toFixed(2)),
  },
  acceptance: {
    r1: 'net trade WR within 2pp of label net WR AND eq-weight return ≥ 3× committed engine',
    r4: 'retiring SELL exit (A/B) does not regress vs keeping it (C) by >1pp avg-net-per-trade in any year',
  },
  variants: summaries,
  r1Verdicts: summaries.map((s) => ({
    variant: s.variant,
    wrPass: s.r1WrPass,
    returnPass: s.r1ReturnPass,
    pass: s.r1WrPass && s.r1ReturnPass,
  })),
  r4Verdicts: r4,
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'stop-removal-experiment.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== D2/R1 + D4/R4 STOP-REMOVAL EXPERIMENT ===')
console.log(
  `Anchors: label net WR ${payload.anchors.labelNetWRPct}% (n=${labelN}) | engine ${engTrades} trades, eq-weight ${payload.anchors.committedEngine.eqWeightReturnPct}% | B&H eq-weight ${payload.anchors.bnhEqWeightPct}%`,
)
for (const s of summaries) {
  console.log(
    `\n${s.variant}: trades=${s.trades}  netWR=${s.netWinRatePct}% (label${s.wrVsLabelPp != null && s.wrVsLabelPp >= 0 ? '+' : ''}${s.wrVsLabelPp}pp)  avg/trade=${s.avgNetPerTradePct}%  eqWeightReturn=${s.eqWeightReturnPct}% (${s.returnMultipleVsEngine}× engine)  inMkt=${s.timeInMarketPct}%`,
  )
  console.log(
    `  R1: WR-within-2pp=${s.r1WrPass}  return≥3×=${s.r1ReturnPass} → ${s.r1WrPass && s.r1ReturnPass ? 'PASS' : 'fail'}`,
  )
  console.log(
    '  per-year: ' +
      s.perYear.map((y) => `${y.year} n=${y.trades} WR=${y.netWR}% avg=${y.avgNetPct}%`).join(' | '),
  )
}
console.log('\nR4 (SELL-exit retirement, per-year avg-net delta vs variant C):')
for (const r of r4) {
  console.log(
    `  ${r.variant}: ${r.vsC_perYearDeltaAvgNetPp.map((d) => `${d.year} ${d.deltaAvgNetPp >= 0 ? '+' : ''}${d.deltaAvgNetPp}pp`).join('  ')} → noRegression=${r.noRegression}`,
  )
}
console.log(`\nSaved to: ${outPath}`)
