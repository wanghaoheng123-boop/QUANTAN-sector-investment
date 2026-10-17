/**
 * Shared types for the dark pool analytics API — the ONE definition.
 * Imported by the route, DarkPoolPanel and the sector/stock pages. (Q-140: the
 * route declared its own structurally identical copy; one definition means a
 * nullable field cannot be widened in one place and not the other.)
 *
 * Q-149: what this source actually carries. The route used to read
 * `offExchangeShares`, `marketStore`, `ordinarySharesNumber` and
 * `financialData.sharesOutstanding`, none of which yahoo-finance2 3.13.2 types
 * on those modules, so off-exchange share, float and the shares-out fallback
 * were null on every request while the panel credited "Finra BATS" for them.
 * Yahoo publishes no off-exchange volume at all. What it does publish, on
 * `defaultKeyStatistics` for equities, is short interest and share counts —
 * and for ETFs it publishes none of them (probe 2026-10-17: 0 of these fields
 * on all 11 sector ETFs).
 */

export interface DarkPoolMetric {
  sharesShorted: number | null
  /** Percent of float sold short, in PERCENT units (0.71 means 0.71%). */
  shortFloatPct: number | null
  /** Settlement date the short interest figure is as of (YYYY-MM-DD), or null. */
  shortInterestAsOf: string | null
  daysToCover: number | null
  /** 10-day average daily volume, from the quote. */
  avgDailyVolume: number | null
  sharesOutstanding: number | null
  sharesFloat: number | null
}

/**
 * Q-140 (I2): the quote is nullable. The route used to fall back to "an
 * explicit 0 (never NaN)" when Yahoo failed — a measured-looking zero on the
 * wire. Unknown is null.
 */
export interface PricePoint {
  price: number | null
  change: number | null
  changePct: number | null
  quoteTime: string | null
}

export interface DarkPoolAnalysis {
  ticker: string
  fetchedAt: string
  quote: PricePoint
  metrics: DarkPoolMetric
  /**
   * Whether Yahoo reported any short-interest or share-count figure. The
   * 10-day volume does not count: it comes from the quote, which every ETF
   * has, so counting it made all 11 sector ETFs claim data they do not have.
   */
  hasRealData: boolean
  /** Human-readable diagnostic when no real data, or why the fetch failed */
  statusNote: string | null
  /** Q-140: set when a Yahoo FETCH failed — distinct from "no data exists". */
  degraded?: boolean
}

/**
 * Yahoo's `shortPercentOfFloat` is a FRACTION (0.0071 means 0.71%). Measured
 * 2026-10-17: for AAPL and GME it equals `sharesShort / floatShares` to within
 * 1% as a fraction. The panel printed it with a `%` sign unscaled, so every
 * stock's short interest read 100 times too small — GME's as a fraction of a
 * percent.
 */
export const SHORT_PERCENT_OF_FLOAT_SCALE = 100

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** A positive count, or null: a share count of 0 or below is not a measurement. */
const positive = (v: unknown): number | null => {
  const n = finite(v)
  return n != null && n > 0 ? n : null
}

/** A vendor Date (or ISO string) as its UTC calendar date, or null. */
export function isoDateOrNull(v: unknown): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
  if (!d || !Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * The metrics this route can stand behind, from `defaultKeyStatistics` and the
 * quote. Pure: the route's only job is to fetch.
 *
 * Float is dropped when it exceeds shares outstanding: the float is a subset of
 * the shares outstanding, so a larger float means the two counts are in
 * different units (BRK-A reports a float of about 1.2M against 0.49M shares out,
 * 2026-10-17) and neither can be shown as the float. A dual-class float smaller
 * than shares out (BRK-B) is not caught — that residual is named in the PR.
 */
export function buildDarkPoolMetrics(
  keyStats: Record<string, unknown>,
  quote: Record<string, unknown>,
): DarkPoolMetric {
  const sharesOutstanding = positive(keyStats.sharesOutstanding)
  const rawFloat = positive(keyStats.floatShares)
  const sharesFloat =
    rawFloat != null && sharesOutstanding != null && rawFloat > sharesOutstanding ? null : rawFloat
  const rawShortFraction = finite(keyStats.shortPercentOfFloat)
  const shortFloatPct =
    rawShortFraction != null && rawShortFraction >= 0 ? rawShortFraction * SHORT_PERCENT_OF_FLOAT_SCALE : null
  const sharesShorted = finite(keyStats.sharesShort)
  const daysToCover = finite(keyStats.shortRatio)
  return {
    sharesShorted: sharesShorted != null && sharesShorted >= 0 ? sharesShorted : null,
    shortFloatPct,
    shortInterestAsOf: isoDateOrNull(keyStats.dateShortInterest),
    daysToCover: daysToCover != null && daysToCover >= 0 ? daysToCover : null,
    avgDailyVolume: positive(quote.averageDailyVolume10Day),
    sharesOutstanding,
    sharesFloat,
  }
}

/** True when Yahoo reported any short-interest or share-count figure. */
export function hasShortOrShareData(m: DarkPoolMetric): boolean {
  return (
    m.sharesShorted !== null ||
    m.shortFloatPct !== null ||
    m.daysToCover !== null ||
    m.sharesOutstanding !== null ||
    m.sharesFloat !== null
  )
}

export const NO_SHORT_DATA_NOTE =
  'Yahoo Finance reports no short-interest or share-count figures for this ticker.'
