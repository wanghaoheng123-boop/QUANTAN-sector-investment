/**
 * C6 VERIFICATION (2026-07-11 rethink, MASTER §2) — red-team claim:
 * "Bars where the SSOT emits SELL: forward 20d net WR 60.12%, avg +2.67%
 * (n=7,280) — better than the BUY signal; as a long-only exit it sells
 * before rebounds."
 *
 * This script measures the claim DIRECTLY on the SSOT (signalAtBarIndex —
 * production regime path; no fast-array reimplementation, no parity risk):
 * for every eligible bar, record the action and the 20d forward net label
 * (entry next close, exit close+H, round-trip costs — identical math to the
 * benchmark). Reports pooled + per-year forward stats for SELL vs BUY vs
 * ALL (base rate).
 *
 * Research measurement only — no engine or published-number changes.
 *
 * Usage: npm run experiment:sell-check
 * Output: workspace/optimization-runs/sell-forward-check.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'
import { signalAtBarIndex, LABEL_HOLD_DAYS, WARMUP_BARS } from '../../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../../lib/backtest/executionModel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

function loadAll(): Array<{ ticker: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const data = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as { candles?: OhlcvRow[] }
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const rows = (data.candles ?? []).filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      return { ticker, rows }
    })
    .filter((d) => d.rows.length >= 252)
}

interface Bucket {
  n: number
  netWins: number
  sumNet: number
}
const mkBucket = (): Bucket => ({ n: 0, netWins: 0, sumNet: 0 })
const add = (b: Bucket, net: number) => {
  b.n++
  b.sumNet += net
  if (net > 0) b.netWins++
}
const stats = (b: Bucket) =>
  b.n === 0
    ? { n: 0, netWinRatePct: null as number | null, avgNetPct: null as number | null }
    : {
        n: b.n,
        netWinRatePct: Number(((b.netWins / b.n) * 100).toFixed(2)),
        avgNetPct: Number(((b.sumNet / b.n) * 100).toFixed(4)),
      }

console.log('Loading instruments + running SSOT over every eligible bar…')
const insts = loadAll()
console.log(`Loaded ${insts.length} instruments`)

const pooled: Record<'SELL' | 'BUY' | 'ALL', Bucket> = {
  SELL: mkBucket(),
  BUY: mkBucket(),
  ALL: mkBucket(),
}
const byYear = new Map<string, Record<'SELL' | 'BUY' | 'ALL', Bucket>>()

for (const { ticker, rows } of insts) {
  for (let i = WARMUP_BARS; i < rows.length - LABEL_HOLD_DAYS - 1; i++) {
    const entry = rows[i + 1].close
    const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, rows.length - 1)].close
    if (!(entry > 0) || !(exit > 0)) continue
    const net = netReturnAfterCosts((exit - entry) / entry, DEFAULT_EXECUTION_COSTS)
    const { action } = signalAtBarIndex(rows, i, ticker, { productionPath: true })
    const year = new Date(rows[i].time * 1000).toISOString().slice(0, 4)
    let y = byYear.get(year)
    if (!y) {
      y = { SELL: mkBucket(), BUY: mkBucket(), ALL: mkBucket() }
      byYear.set(year, y)
    }
    add(pooled.ALL, net)
    add(y.ALL, net)
    if (action === 'SELL') {
      add(pooled.SELL, net)
      add(y.SELL, net)
    } else if (action === 'BUY') {
      add(pooled.BUY, net)
      add(y.BUY, net)
    }
  }
}

const sellPooled = stats(pooled.SELL)
const buyPooled = stats(pooled.BUY)
const allPooled = stats(pooled.ALL)

const perYear = Array.from(byYear.keys())
  .sort()
  .map((year) => {
    const y = byYear.get(year)!
    const sell = stats(y.SELL)
    const all = stats(y.ALL)
    return {
      year,
      sell,
      buy: stats(y.BUY),
      base: all,
      sellMinusBasePp:
        sell.netWinRatePct != null && all.netWinRatePct != null
          ? Number((sell.netWinRatePct - all.netWinRatePct).toFixed(2))
          : null,
    }
  })

// C6 verdict: the claim is CONFIRMED if SELL-bar forward net WR exceeds the
// base rate (SELL bars are anti-predictive for a long-only exit) — with the
// red-team's own bull-window caveat carried forward.
const claimConfirmed =
  sellPooled.netWinRatePct != null &&
  allPooled.netWinRatePct != null &&
  sellPooled.netWinRatePct > allPooled.netWinRatePct

const payload = {
  timestamp: new Date().toISOString(),
  purpose:
    'C6 verification (2026-07-11 rethink): forward 20d NET outcomes of bars where the production SSOT emits SELL, vs BUY bars and the all-bars base rate.',
  method:
    'signalAtBarIndex (production path) on every eligible bar of all instruments; forward label entry next close, exit close+20, net of round-trip costs — identical math to the benchmark.',
  claim: 'Red team C6: SELL bars forward 20d net WR 60.12%, avg +2.67%, n=7,280',
  pooled: { sell: sellPooled, buy: buyPooled, base: allPooled },
  perYear,
  verdict: claimConfirmed ? 'CONFIRMED' : 'NOT CONFIRMED',
  caveat:
    'Survivor universe, predominantly bull window (red-team caveat carried forward). Per-year table shows whether SELL anti-predictiveness holds outside 2022–23.',
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'sell-forward-check.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== C6 SELL-FORWARD CHECK (20d net label) ===')
console.log(
  `SELL bars: n=${sellPooled.n}  net WR ${sellPooled.netWinRatePct}%  avg ${sellPooled.avgNetPct}%`,
)
console.log(
  `BUY  bars: n=${buyPooled.n}  net WR ${buyPooled.netWinRatePct}%  avg ${buyPooled.avgNetPct}%`,
)
console.log(
  `ALL  bars: n=${allPooled.n}  net WR ${allPooled.netWinRatePct}%  avg ${allPooled.avgNetPct}%`,
)
console.log('\nyear   SELL-n  SELL-WR  SELL-avg   base-WR   SELL-base')
for (const y of perYear) {
  console.log(
    `${y.year}  ${String(y.sell.n).padStart(6)}  ${String(y.sell.netWinRatePct).padStart(6)}%  ${String(y.sell.avgNetPct).padStart(8)}%  ${String(y.base.netWinRatePct).padStart(7)}%  ${y.sellMinusBasePp == null ? '   —' : ((y.sellMinusBasePp >= 0 ? '+' : '') + y.sellMinusBasePp).padStart(7)}pp`,
  )
}
console.log(`\nVerdict: ${payload.verdict} — ${payload.caveat}`)
console.log(`Saved to: ${outPath}`)
