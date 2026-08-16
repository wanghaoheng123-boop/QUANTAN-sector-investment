/**
 * SYNTHETIC DATA — production-reachable, deliberately narrow.
 *
 * Design invariant I3: mock/fixture/synthetic data must not reach a backtest,
 * a chart, or a signal, and whatever remains must be tagged `__SYNTHETIC__` at
 * the type level with a runtime assertion at the boundary — not a comment.
 *
 * Q-088 (2026-08-16) removed two exports from this file outright rather than
 * labeling them:
 *
 *   - `generateDarkPoolMarkers()` — plotted synthetic block prints as markers
 *     on the REAL price series in `/api/chart/[ticker]`, indistinguishable
 *     from genuine data.
 *   - `getNewsForSector()` / `SECTOR_NEWS` — fabricated headlines making
 *     specific factual claims about real, named, publicly-traded issuers,
 *     attributed to real publishers and government agencies (Bloomberg,
 *     Reuters, FT, NEJM, EIA, DOE, CMS) and linking to their genuine domains.
 *     These rendered unlabeled in the news feed AND were plotted on the price
 *     chart at arbitrary candle indices. The live route
 *     `/api/news/ticker/[ticker]` replaces them.
 *
 * What remains is `generateDarkPoolPrints`, which feeds the dark-pool prints
 * table, flow gauge and aggregate tiles. There is no real per-print data
 * source in the current stack, so this is a PRODUCT decision (keep the
 * illustrative panel, or delete the surface) rather than a swap — tracked as
 * Q-089. Until that is decided the value is branded so the compiler can keep
 * it out of chart and signal paths.
 *
 * Determinism: seeded Mulberry32 — same inputs produce the same outputs, so
 * SSR and client render agree (house style requires this).
 */


import { DarkPoolPrint } from './sectors'
import { markSynthetic, type Synthetic } from './synthetic'

// ─── Seeded PRNG (Mulberry32) — deterministic, no hydration mismatch ─────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

// ─── Seed prices (shared by the demo generators below) ───────────────────────
const SEED_PRICES: Record<string, number> = {
  XLK: 218.40,
  XLE: 84.20,
  XLF: 41.80,
  XLV: 138.90,
  XLY: 196.50,
  XLI: 132.40,
  XLC: 83.70,
  XLB: 89.10,
  XLU: 72.30,
  XLRE: 38.50,
  XLP: 79.20,
  SPY: 548.30,
  QQQ: 461.70,
}

// ─── Dark Pool Print Generator ──────────────────────────────────────────────
export function generateDarkPoolPrints(ticker: string, count: number = 12): Synthetic<DarkPoolPrint[]> {
  const rng = mulberry32(ticker.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + 777)
  const base = SEED_PRICES[ticker] || 100
  const types: DarkPoolPrint['type'][] = ['BLOCK', 'SWEEP', 'CROSS']
  const now = new Date('2026-03-23T15:00:00')

  const rows = Array.from({ length: count }, (_, i) => {
    const minutesAgo = i * 18 + Math.round(rng() * 15)
    const time = new Date(now.getTime() - minutesAgo * 60000)
    const size = Math.round((50000 + rng() * 500000) / 100) * 100
    const price = parseFloat((base + (rng() - 0.5) * 2).toFixed(2))
    const premium = parseFloat(((rng() - 0.45) * 1.2).toFixed(3))
    const type = types[Math.floor(rng() * types.length)]
    const bullishBias = type === 'SWEEP' ? 0.6 : 0.45
    const r2 = rng()
    const sentiment: DarkPoolPrint['sentiment'] = r2 < bullishBias ? 'BULLISH' : r2 < 0.75 ? 'BEARISH' : 'NEUTRAL'

    return {
      time: time.toTimeString().slice(0, 8),
      ticker,
      size,
      price,
      premium,
      type,
      sentiment
    }
  }).sort((a, b) => b.time.localeCompare(a.time))

  // Wrapped, not cast. `markSynthetic` is the one sanctioned constructor, and
  // the wrapper is NOT assignable to DarkPoolPrint[] — so this value cannot
  // reach a chart, signal or backtest without an explicit unwrapSynthetic()
  // call naming the surface that accepted it.
  return markSynthetic(rows)
}
