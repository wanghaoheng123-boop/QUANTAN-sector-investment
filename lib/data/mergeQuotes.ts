import type { BloombergQuoteNormalized } from './bloomberg/bridgeClient'

export type FieldSource = 'bloomberg' | 'yahoo'

/**
 * Phase 13 S2 fix (F4.2): per-field source attribution.
 *
 * The previous merge labelled the row `dataSource: 'bloomberg'` even when
 * fields like volume/52w/pe/marketCap fell back to yahoo (because bloomberg
 * returned 0 or 'N/A'). For institutional audit trails we need to know
 * which feed produced each field. Audit code can read `provenance.volume`
 * to verify the line of sight.
 *
 * Backwards compatible: existing consumers still see `dataSource` (the
 * row-level attribution that reflects the *primary* feed used for the
 * row's price) and ignore `provenance` if they don't need it.
 */
export interface QuoteProvenance {
  price: FieldSource
  change: FieldSource
  changePct: FieldSource
  volume: FieldSource
  high52w: FieldSource
  low52w: FieldSource
  pe: FieldSource
  marketCap: FieldSource
  bid?: FieldSource
  ask?: FieldSource
}

/**
 * Q-145 (I2: missing displays as MISSING). A Yahoo field it did not supply is
 * null, not 0: `price` is always present (a row without one is not a quote and
 * is dropped by the producer), every other number may be null and renders "—".
 * The previous `num()` turned a missing change into a measured "0.00%" and a
 * missing price into "$0.00".
 */
export type UnifiedQuote = {
  ticker: string
  price: number
  change: number | null
  changePct: number | null
  volume: number | null
  high52w: number | null
  low52w: number | null
  pe: number | null
  marketCap: string
  /** Vendor last trade / regular session time when available (ISO). */
  quoteTime?: string | null
  bid?: number
  ask?: number
  /** Row-level primary feed for the price (highest-priority field). */
  dataSource: 'bloomberg' | 'yahoo' | 'mixed'
  /** F4.2: per-field source attribution for institutional audit trail. */
  provenance?: QuoteProvenance
}

export type YahooQuoteLike = Omit<UnifiedQuote, 'dataSource' | 'provenance'> & { dataSource?: 'yahoo' }

const ALL_YAHOO: QuoteProvenance = {
  price: 'yahoo',
  change: 'yahoo',
  changePct: 'yahoo',
  volume: 'yahoo',
  high52w: 'yahoo',
  low52w: 'yahoo',
  pe: 'yahoo',
  marketCap: 'yahoo',
}

/**
 * Prefer Bloomberg for overlapping tickers; fall back to Yahoo per field when
 * Bloomberg did not supply one (null, or the 'N/A' market-cap sentinel).
 * Per-field provenance records which feed produced each value.
 *
 * Q145-R3: the bridge used to turn every missing field into 0, so this merge
 * read 0 as "absent" with `||` for the secondary fields — but took Bloomberg's
 * change and percent unconditionally. A bridge row with no change therefore
 * emitted a measured "0.00%" FLAT, overwrote Yahoo's real change, and
 * attributed it to Bloomberg in `provenance`. The bridge now says null for a
 * missing field, so every field merges with `??` and a genuine Bloomberg 0
 * (zero volume in a halt) is kept as Bloomberg's.
 */
export function mergeYahooAndBloomberg(
  yahoo: YahooQuoteLike[],
  bloomberg: Map<string, BloombergQuoteNormalized> | null
): UnifiedQuote[] {
  if (!bloomberg || bloomberg.size === 0) {
    return yahoo.map((q) => ({ ...q, dataSource: 'yahoo' as const, provenance: { ...ALL_YAHOO } }))
  }

  const out: UnifiedQuote[] = []
  const seen = new Set<string>()

  for (const y of yahoo) {
    const bb = bloomberg.get(y.ticker)
    if (bb) {
      // Per-field merge with provenance tracking. Bloomberg's price always
      // wins; every other field falls back to Yahoo when Bloomberg has none.
      const provenance: QuoteProvenance = {
        price: 'bloomberg',
        change: bb.change != null ? 'bloomberg' : 'yahoo',
        changePct: bb.changePct != null ? 'bloomberg' : 'yahoo',
        volume: bb.volume != null ? 'bloomberg' : 'yahoo',
        high52w: bb.high52w != null ? 'bloomberg' : 'yahoo',
        low52w: bb.low52w != null ? 'bloomberg' : 'yahoo',
        pe: bb.pe != null ? 'bloomberg' : 'yahoo',
        marketCap: bb.marketCap !== 'N/A' ? 'bloomberg' : 'yahoo',
        bid: bb.bid != null ? 'bloomberg' : undefined,
        ask: bb.ask != null ? 'bloomberg' : undefined,
      }

      out.push({
        ticker: y.ticker,
        price: bb.price,
        change: bb.change ?? y.change,
        changePct: bb.changePct ?? y.changePct,
        volume: bb.volume ?? y.volume,
        high52w: bb.high52w ?? y.high52w,
        low52w: bb.low52w ?? y.low52w,
        pe: bb.pe ?? y.pe,
        marketCap: bb.marketCap !== 'N/A' ? bb.marketCap : y.marketCap,
        // Q-129: the price on this row is Bloomberg's, so the timestamp must be
        // Bloomberg's too. It previously carried `y.quoteTime` — Yahoo's clock
        // — which presented a possibly stale bridge price as freshly stamped:
        // a stalled bridge at 100 alongside a live Yahoo at 200 emitted
        // price=100 with Yahoo's time and dataSource='bloomberg'.
        //
        // Null when the bridge gave no usable time. That renders as `—` rather
        // than a number, which is I2's "missing displays as MISSING": borrowing
        // another vendor's clock to avoid a blank is the failure, not the fix.
        quoteTime: bb.quoteTime ?? null,
        bid: bb.bid,
        ask: bb.ask,
        dataSource: 'bloomberg',
        provenance,
      })
      seen.add(y.ticker)
    } else {
      out.push({ ...y, dataSource: 'yahoo', provenance: { ...ALL_YAHOO } })
      seen.add(y.ticker)
    }
  }

  for (const [t, bb] of bloomberg) {
    if (seen.has(t)) continue
    // Phase 14 wave 7: Bloomberg is the only source in this branch, so every
    // field's provenance is 'bloomberg' — and a field it did not supply is
    // null (Q145-R3), which renders "—". The structured warn lets operators
    // see which fields a Bloomberg-only row is missing.
    const sentinelFields: string[] = []
    if (bb.change == null) sentinelFields.push('change')
    if (bb.changePct == null) sentinelFields.push('changePct')
    if (bb.volume == null) sentinelFields.push('volume')
    if (bb.high52w == null) sentinelFields.push('high52w')
    if (bb.low52w == null) sentinelFields.push('low52w')
    if (bb.pe == null) sentinelFields.push('pe')
    if (bb.marketCap === 'N/A') sentinelFields.push('marketCap')
    if (sentinelFields.length > 0) {
      console.warn(JSON.stringify({
        event: 'mergeQuotes.bloomberg_sentinel_fields',
        ticker: t,
        fields: sentinelFields,
        message: 'Bloomberg-only quote has sentinel values for these fields; downstream audits may be misled by provenance=bloomberg.',
      }))
    }
    const provenance: QuoteProvenance = {
      price: 'bloomberg',
      change: 'bloomberg',
      changePct: 'bloomberg',
      volume: 'bloomberg',
      high52w: 'bloomberg',
      low52w: 'bloomberg',
      pe: 'bloomberg',
      marketCap: 'bloomberg',
      bid: bb.bid != null ? 'bloomberg' : undefined,
      ask: bb.ask != null ? 'bloomberg' : undefined,
    }
    out.push({
      ticker: t,
      price: bb.price,
      change: bb.change,
      changePct: bb.changePct,
      volume: bb.volume,
      high52w: bb.high52w,
      low52w: bb.low52w,
      pe: bb.pe,
      marketCap: bb.marketCap,
      // Q-129: Bloomberg-only rows carried no timestamp at all, so every
      // consumer saw `undefined` and had nothing to age the price against.
      quoteTime: bb.quoteTime ?? null,
      bid: bb.bid,
      ask: bb.ask,
      dataSource: 'bloomberg',
      provenance,
    })
  }

  return out
}
