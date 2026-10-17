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
   * Human-readable diagnostic when Yahoo reported no short-interest or
   * share-count figure (`hasShortOrShareData`), or why the fetch failed.
   * Q-149: the `hasRealData` flag that used to sit beside this had no reader
   * once the signal banner went, so it is not on the wire.
   */
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
 * How far `sharesShort / floatShares` may sit from `shortPercentOfFloat` before
 * the float is taken to be in different units from the short count. Measured
 * 2026-10-17: the ratio of the two was 1.00 (AAPL) and 0.99 (GME), and about
 * 0.001 for BRK-B, whose float Yahoo reports in Class-A-equivalent units
 * against a Class-B short count. A factor of 2 separates those by three orders
 * of magnitude either way.
 */
export const FLOAT_IDENTITY_TOLERANCE = 2

/**
 * The metrics this route can stand behind, from `defaultKeyStatistics` and the
 * quote. Pure: the route's only job is to fetch.
 *
 * The float is dropped when it cannot be the float of the shares it sits
 * beside:
 *   - it exceeds shares outstanding (the float is a subset of them; BRK-A
 *     reports about 1.2M against 0.49M out, 2026-10-17), or
 *   - with all three of short count, float and short % present, the identity
 *     short % = short count / float fails by more than FLOAT_IDENTITY_TOLERANCE
 *     (BRK-B). Yahoo computes the % against its own float, so the % stands.
 */
export function buildDarkPoolMetrics(
  keyStats: Record<string, unknown>,
  quote: Record<string, unknown>,
): DarkPoolMetric {
  const sharesOutstanding = positive(keyStats.sharesOutstanding)
  const rawFloat = positive(keyStats.floatShares)
  const rawShortFraction = finite(keyStats.shortPercentOfFloat)
  const shortFraction = rawShortFraction != null && rawShortFraction >= 0 ? rawShortFraction : null
  const rawShorted = finite(keyStats.sharesShort)
  const sharesShorted = rawShorted != null && rawShorted >= 0 ? rawShorted : null
  const daysToCover = finite(keyStats.shortRatio)
  return {
    sharesShorted,
    shortFloatPct: shortFraction != null ? shortFraction * SHORT_PERCENT_OF_FLOAT_SCALE : null,
    shortInterestAsOf: isoDateOrNull(keyStats.dateShortInterest),
    daysToCover: daysToCover != null && daysToCover >= 0 ? daysToCover : null,
    avgDailyVolume: positive(quote.averageDailyVolume10Day),
    sharesOutstanding,
    sharesFloat: floatIfConsistent(rawFloat, sharesOutstanding, sharesShorted, shortFraction),
  }
}

function floatIfConsistent(
  float: number | null,
  sharesOutstanding: number | null,
  sharesShorted: number | null,
  shortFraction: number | null,
): number | null {
  if (float == null) return null
  if (sharesOutstanding != null && float > sharesOutstanding) return null
  if (sharesShorted != null && sharesShorted > 0 && shortFraction != null && shortFraction > 0) {
    const ratio = sharesShorted / float / shortFraction
    if (ratio > FLOAT_IDENTITY_TOLERANCE || ratio < 1 / FLOAT_IDENTITY_TOLERANCE) return null
  }
  return float
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
