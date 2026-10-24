/**
 * Shared types for the dark pool analytics API — the ONE definition.
 * Imported by the route, DarkPoolPanel and the sector/stock pages. (Q-140: the
 * route declared its own structurally identical copy; one definition means a
 * nullable field cannot be widened in one place and not the other.)
 *
 * Q-149: what this source actually carries. The route used to read
 * `offExchangeShares`, `marketStore`, `ordinarySharesNumber` and
 * `financialData.sharesOutstanding`. None of them is a declared property of the
 * yahoo-finance2 3.13.2 interfaces it read them from — those interfaces carry a
 * string index signature, so the reads compiled — and off-exchange share, float
 * and the shares-out fallback were null on every request while the panel
 * credited "Finra BATS" for them. Yahoo publishes no off-exchange volume at all.
 * What it does publish is short interest and share counts on
 * `defaultKeyStatistics` for equities, and a share count on the quote for most
 * ETFs. The field lists below are the only names the builder can read, and
 * `__tests__/architecture/darkpool-vendor-fields.test.ts` checks each against the
 * vendor's declared interfaces.
 */

/** Why a float the vendor reported is not shown as the float. */
export type FloatWithheldReason = 'exceeds-shares-out' | 'inconsistent-with-short-interest'

export interface DarkPoolMetric {
  sharesShorted: number | null
  /** Percent of float sold short, in PERCENT units (0.71 means 0.71%). */
  shortFloatPct: number | null
  /** Settlement date the short interest figure is as of (YYYY-MM-DD), or null. */
  shortInterestAsOf: string | null
  /** Whole days from that settlement date to the fetch, or null. */
  shortInterestAgeDays: number | null
  /** True when the settlement date is older than a missed reporting cycle. */
  shortInterestStale: boolean
  daysToCover: number | null
  /** 10-day average daily volume, from the quote. */
  avgDailyVolume: number | null
  sharesOutstanding: number | null
  sharesFloat: number | null
  /** Set when the vendor reported a float and it was withheld (Q149-D2). */
  floatWithheld: FloatWithheldReason | null
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
   * Why a figure is absent: Yahoo has no quote for the ticker, it reports no
   * short interest for it, or a fetch failed. Q-149: the `hasRealData` flag that
   * used to sit beside this had no reader once the signal banner went, so it is
   * not on the wire.
   */
  statusNote: string | null
  /** Q-140: set when a Yahoo FETCH failed — distinct from "no data exists". */
  degraded?: boolean
}

/** The `defaultKeyStatistics` fields the builder reads — and the only ones it can. */
export const KEY_STATISTICS_FIELDS = [
  'sharesOutstanding',
  'floatShares',
  'shortPercentOfFloat',
  'sharesShort',
  'shortRatio',
  'dateShortInterest',
] as const

/** The quote fields the builder reads — and the only ones it can. */
export const QUOTE_FIELDS = ['sharesOutstanding', 'averageDailyVolume10Day'] as const

type KeyStatisticsField = (typeof KEY_STATISTICS_FIELDS)[number]
type QuoteField = (typeof QUOTE_FIELDS)[number]

/**
 * Yahoo's `shortPercentOfFloat` is a FRACTION (0.0071 means 0.71%). Measured
 * 2026-10-17: a fraction on every one of 128 equities that carried it. Where the
 * float is kept it is typically within 5-15% of `sharesShort / floatShares`, not
 * equal to it: measured 2026-10-24 over the 102 kept floats whose identity could
 * be checked, 31 were within 1%, 51 within 5% and 73 within 10%, with a median
 * deviation of 4.6% and a 90th percentile of 15%. The panel printed it with a
 * `%` sign unscaled, so every stock's short interest read 100 times too small.
 * The scale is unconditional; a vendor switch to percent form would make every
 * figure 100 times too large, and nothing here would notice (Q149-D14, to be
 * logged).
 */
export const SHORT_PERCENT_OF_FLOAT_SCALE = 100

/**
 * How far the identity short % = short count / float may fail before the float
 * is taken to be in different units from the short count. The builder computes
 * `sharesShort / float / shortFraction`: measured 2026-10-17 it was about 1.0 for
 * single-class names and about 1000 for a dual-class name whose float is in
 * other-class-equivalent units. A factor of 2 drops the latter. It is not a clean
 * separation everywhere: a single-class small cap sat just past it (2.1), and two
 * names were kept at 1.5 and 1.7 — the bound catches unit errors, not every
 * inconsistency in the vendor's figures.
 */
export const FLOAT_IDENTITY_TOLERANCE = 2

/**
 * How far a float may exceed shares outstanding and still be shown. The float is
 * a subset of the shares, so a float above them is in other units — but the two
 * fields can carry different as-of dates, and buybacks move the share count
 * between them, so a correct float can overshoot by a few percent and the
 * overshoot drifts from week to week.
 *
 * Why 5% and not 1%. At 1% the rule held on 2026-10-17 and did not a week
 * later. Measured 2026-10-24 over 131 equities: two single-class US large caps
 * (float / shares outstanding of 1.02 and 1.01), whose short-interest identity
 * held, were withheld six days after being kept; a single-class ADR at 1.01 was
 * kept. The next ratios above 1.02 were 1.06, 1.08, 1.10 and 1.14 (three ADRs
 * and one dual-class name), each a float in other units that must stay withheld.
 *
 * That makes 5% the width of ONE sample's gap, between 1.02 and 1.06, not a
 * derived constant. It is expected to need revisiting; the measurement to repeat
 * is the distribution of float / shares outstanding over the kept names.
 */
export const FLOAT_SHARES_OUT_SLACK = 0.05

/**
 * The age past which a short-interest figure is STALE. Short interest is
 * reported twice a month as of a settlement date and published roughly a week
 * and a half later, so in a healthy feed the newest figure is under about 30
 * days old. 35 days means at least one reporting cycle was missed.
 */
export const SHORT_INTEREST_STALE_DAYS = 35

const DAY_MS = 86_400_000

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** A positive count, or null: a share count of 0 or below is not a measurement. */
const positive = (v: unknown): number | null => {
  const n = finite(v)
  return n != null && n > 0 ? n : null
}

/** Zero or above, or null. */
const nonNegative = (v: unknown): number | null => {
  const n = finite(v)
  return n != null && n >= 0 ? n : null
}

/** A vendor Date (or ISO string) as its UTC calendar date, or null. */
export function isoDateOrNull(v: unknown): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null
  if (!d || !Number.isFinite(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * The metrics this route can stand behind, from `defaultKeyStatistics` and the
 * quote, as of `nowMs`. Pure: the route's only job is to fetch.
 *
 * Shares outstanding come from the key statistics, else from the quote, which
 * carries a share count for most ETFs (Q149-D1).
 *
 * The float is withheld — and says so — when it cannot be the float of the
 * shares it sits beside: it exceeds shares outstanding by more than
 * FLOAT_SHARES_OUT_SLACK, or, with short count, float and short % all present,
 * the identity fails by more than FLOAT_IDENTITY_TOLERANCE. The short % is the
 * vendor's own figure on its own denominator, which for dual-class names tracks
 * shares outstanding rather than a float, so it is shown either way.
 */
export function buildDarkPoolMetrics(
  keyStats: Record<string, unknown>,
  quote: Record<string, unknown>,
  nowMs: number,
): DarkPoolMetric {
  const ks = (f: KeyStatisticsField) => keyStats[f]
  const q = (f: QuoteField) => quote[f]
  const sharesOutstanding = positive(ks('sharesOutstanding')) ?? positive(q('sharesOutstanding'))
  const shortFraction = nonNegative(ks('shortPercentOfFloat'))
  const sharesShorted = nonNegative(ks('sharesShort'))
  const asOf = isoDateOrNull(ks('dateShortInterest'))
  const ageDays = asOf != null && Number.isFinite(nowMs) ? Math.floor((nowMs - Date.parse(asOf)) / DAY_MS) : null
  const float = judgeFloat(positive(ks('floatShares')), sharesOutstanding, sharesShorted, shortFraction)
  return {
    sharesShorted,
    shortFloatPct: shortFraction != null ? shortFraction * SHORT_PERCENT_OF_FLOAT_SCALE : null,
    shortInterestAsOf: asOf,
    shortInterestAgeDays: ageDays,
    shortInterestStale: ageDays != null && ageDays > SHORT_INTEREST_STALE_DAYS,
    daysToCover: nonNegative(ks('shortRatio')),
    avgDailyVolume: positive(q('averageDailyVolume10Day')),
    sharesOutstanding,
    sharesFloat: float.value,
    floatWithheld: float.withheld,
  }
}

function judgeFloat(
  float: number | null,
  sharesOutstanding: number | null,
  sharesShorted: number | null,
  shortFraction: number | null,
): { value: number | null; withheld: FloatWithheldReason | null } {
  if (float == null) return { value: null, withheld: null }
  if (sharesOutstanding != null && float > sharesOutstanding * (1 + FLOAT_SHARES_OUT_SLACK)) {
    return { value: null, withheld: 'exceeds-shares-out' }
  }
  if (sharesShorted != null && sharesShorted > 0 && shortFraction != null && shortFraction > 0) {
    const ratio = sharesShorted / float / shortFraction
    if (ratio > FLOAT_IDENTITY_TOLERANCE || ratio < 1 / FLOAT_IDENTITY_TOLERANCE) {
      return { value: null, withheld: 'inconsistent-with-short-interest' }
    }
  }
  return { value: float, withheld: null }
}

/** True when Yahoo reported any short-interest figure. A share count alone is not one. */
export function hasShortInterestData(m: DarkPoolMetric): boolean {
  return m.sharesShorted !== null || m.shortFloatPct !== null || m.daysToCover !== null
}

/**
 * Security types for which Yahoo publishes no short interest, so a failed key
 * statistics fetch is an absence, not an outage (Q149-D5: BTC-USD and EURUSD=X
 * were told to "try again shortly").
 */
export const NO_SHORT_INTEREST_TYPES = new Set(['CRYPTOCURRENCY', 'CURRENCY', 'INDEX', 'MUTUALFUND', 'FUTURE'])

export const NO_SHORT_INTEREST_NOTE = 'Yahoo Finance reports no short-interest figures for this ticker.'
export const NO_QUOTE_NOTE = 'Yahoo Finance has no quote for this ticker.'
