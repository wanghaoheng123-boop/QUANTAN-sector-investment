/**
 * Shared risk-free rate helper (Phase 15 Q-004 + Q-052-NEW completion).
 *
 * Tenor-matched FRED series (Federal Reserve Economic Data):
 *   - DGS3MO — 3-month Treasury, used for options ≤ 90d
 *   - DGS1   — 1-year Treasury, used for backtest Sharpe / Sortino and options 91–365d
 *   - DGS2   — 2-year Treasury, used for options 366–730d
 *   - DGS10  — 10-year Treasury, used for options > 730d
 *
 * Falls back to `lib/quant/constants` static defaults when FRED is unreachable
 * (e.g. CI with no internet, intermittent outage, etc.).
 *
 * Phase 15 Q-052-NEW changes (2026-05-24):
 *   1. Cache is now keyed by FRED `seriesId` (not by `tenorDays`) so a single
 *      DGS1 fetch serves every tenor that routes to DGS1 (e.g. 200d and 350d
 *      both use the same cached value). Prior single-slot cache thrashed
 *      whenever a backtest mixed multiple tenors.
 *   2. Opt-in module-init prewarm via `QUANTAN_FRED_PREWARM=1`. Off by default
 *      so that (a) tests/CI without internet don't see hangs or stale leaks
 *      from in-flight async fetches, and (b) the canonical benchmark output
 *      stays reproducible byte-for-byte unless explicitly opted in. In a
 *      production Next.js process, set the env var at boot to prewarm
 *      DGS3MO + DGS1 + DGS2 + DGS10 in parallel.
 *   3. Reset hook `_resetRiskFreeRateCache()` exported for tests.
 *
 * Citation:
 *   • Hull, J. (2017) "Options, Futures and Other Derivatives," §15.4 —
 *     tenor-matched RFR is the textbook default for Black-Scholes pricing.
 *   • Bacon, C. (2008) "Practical Portfolio Performance Measurement," p43 —
 *     Sharpe ratio assumes RFR matched to the return horizon.
 */

import { BACKTEST_RFR_ANNUAL, OPTIONS_RFR_ANNUAL } from './constants'

interface SeriesRoute {
  maxDays: number
  seriesId: string
  fallback: number
}

const SERIES_BY_TENOR: SeriesRoute[] = [
  { maxDays: 90, seriesId: 'DGS3MO', fallback: OPTIONS_RFR_ANNUAL },
  { maxDays: 365, seriesId: 'DGS1', fallback: BACKTEST_RFR_ANNUAL },
  { maxDays: 730, seriesId: 'DGS2', fallback: BACKTEST_RFR_ANNUAL },
  { maxDays: Infinity, seriesId: 'DGS10', fallback: BACKTEST_RFR_ANNUAL },
]

interface CachedEntry {
  annual: number
  fetchedAt: number
}

const cache = new Map<string, CachedEntry>()
const CACHE_MS = 24 * 60 * 60 * 1000

function seriesForTenor(tenorDays: number): SeriesRoute {
  // Defensive: clamp negative / NaN to the shortest series, very long to DGS10.
  const t = Number.isFinite(tenorDays) ? Math.max(0, tenorDays) : 365
  for (const row of SERIES_BY_TENOR) {
    if (t <= row.maxDays) return row
  }
  return SERIES_BY_TENOR[SERIES_BY_TENOR.length - 1]
}

async function fetchFredLatestPercent(seriesId: string): Promise<number | null> {
  const from = new Date()
  from.setFullYear(from.getFullYear() - 1)
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${from.toISOString().slice(0, 10)}`
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } } as RequestInit)
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.trim().split('\n').slice(1)
    // Walk backwards to find the most recent non-missing value (FRED uses "."
    // for missing observations on weekends/holidays).
    for (let i = lines.length - 1; i >= 0; i--) {
      const val = parseFloat(lines[i].split(',')[1]?.trim() ?? '')
      if (Number.isFinite(val) && val > 0) return val / 100
    }
  } catch {
    /* network / parse error → null → caller uses static fallback */
  }
  return null
}

/**
 * Annualized risk-free rate (decimal) for a given tenor in calendar days.
 *
 * Synchronous accessor — returns the cached FRED value when fresh (< 24h),
 * otherwise the static fallback from `lib/quant/constants`. Use this in any
 * hot path (per-bar in backtest, per-contract in options chain enrichment)
 * where awaiting an HTTP fetch is not acceptable.
 *
 * To populate the cache, either:
 *   1. Set `QUANTAN_FRED_PREWARM=1` at process start (production Next.js).
 *   2. Call `await getRiskFreeRate(tenorDays)` once before the hot path runs.
 *   3. Call `await prewarmRiskFreeRates()` (warms all 4 series in parallel).
 *
 * Default behaviour with no prewarm: every call returns the static constant.
 * This is intentional — it keeps tests deterministic and the canonical
 * benchmark output byte-reproducible across runs.
 */
export function getRiskFreeRateSync(tenorDays = 365): number {
  const route = seriesForTenor(tenorDays)
  const entry = cache.get(route.seriesId)
  if (entry && Date.now() - entry.fetchedAt < CACHE_MS) {
    return entry.annual
  }
  return route.fallback
}

/**
 * Async accessor — checks the cache, otherwise fetches FRED and updates the
 * cache. Returns the static fallback on FRED error (never throws).
 *
 * Suitable for one-time initialization in API routes or at app boot. For
 * hot-path access (per-bar / per-contract), use `getRiskFreeRateSync()`
 * after prewarming.
 */
export async function getRiskFreeRate(tenorDays = 365): Promise<number> {
  const route = seriesForTenor(tenorDays)
  const cached = cache.get(route.seriesId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.annual
  }
  const fromFred = await fetchFredLatestPercent(route.seriesId)
  const annual = fromFred ?? route.fallback
  cache.set(route.seriesId, { annual, fetchedAt: Date.now() })
  return annual
}

/**
 * Fire-and-forget prewarm of all four series in parallel. Errors are
 * swallowed — the cache simply stays empty for any series whose fetch
 * failed, and subsequent sync calls use the static fallback. Safe to call
 * at module init in production; tests / CI / canonical benchmarks should
 * NOT call this (it would leak network fetches into deterministic runs).
 */
export async function prewarmRiskFreeRates(): Promise<void> {
  try {
    await Promise.allSettled(
      SERIES_BY_TENOR.map((row) =>
        // tenorDays = maxDays for the route lookup to bind to this series
        getRiskFreeRate(Number.isFinite(row.maxDays) ? row.maxDays : 9_999),
      ),
    )
  } catch {
    /* never throw from a prewarm */
  }
}

/**
 * Module-init prewarm — only when the operator explicitly opts in via
 * `QUANTAN_FRED_PREWARM=1`. Default is off so:
 *   - vitest runs are deterministic (NODE_ENV=test always skips the flag)
 *   - `npm run benchmark` produces byte-identical output across runs
 *   - CI does not need outbound internet access for FRED
 *
 * To enable in production: set `QUANTAN_FRED_PREWARM=1` in Vercel env.
 */
if (process.env.QUANTAN_FRED_PREWARM === '1' && process.env.NODE_ENV !== 'test') {
  void prewarmRiskFreeRates()
}

/** Test hook — reset module cache between specs */
export function _resetRiskFreeRateCache(): void {
  cache.clear()
}

/** Test hook — inspect cache state */
export function _peekRiskFreeRateCache(): ReadonlyMap<string, Readonly<CachedEntry>> {
  return new Map(cache)
}
