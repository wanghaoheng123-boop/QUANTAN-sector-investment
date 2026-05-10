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

export type UnifiedQuote = {
  ticker: string
  price: number
  change: number
  changePct: number
  volume: number
  high52w: number
  low52w: number
  pe: number
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
 * Prefer Bloomberg for overlapping tickers; fall back to Yahoo per-field
 * when Bloomberg returns 0 / 'N/A'. Per-field provenance is recorded so
 * downstream audit code can verify which feed produced each value.
 *
 * Note: F4.2 also preserved the `||` fallback at the field level so that
 * Bloomberg-reported zeros DON'T silently fall through to yahoo (a 0
 * volume during a halt is meaningful). Use nullish-coalescing semantics
 * only for fields where 0 is genuinely missing.
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
      // Per-field merge with provenance tracking. Bloomberg primary fields
      // (price/change/changePct) always win; quantitative fields fall back
      // to yahoo when bloomberg reports 0 or sentinel values.
      const provenance: QuoteProvenance = {
        price: 'bloomberg',
        change: 'bloomberg',
        changePct: 'bloomberg',
        volume: bb.volume ? 'bloomberg' : 'yahoo',
        high52w: bb.high52w ? 'bloomberg' : 'yahoo',
        low52w: bb.low52w ? 'bloomberg' : 'yahoo',
        pe: bb.pe ? 'bloomberg' : 'yahoo',
        marketCap: bb.marketCap !== 'N/A' ? 'bloomberg' : 'yahoo',
        bid: bb.bid != null ? 'bloomberg' : undefined,
        ask: bb.ask != null ? 'bloomberg' : undefined,
      }

      out.push({
        ticker: y.ticker,
        price: bb.price,
        change: bb.change,
        changePct: bb.changePct,
        volume: bb.volume || y.volume,
        high52w: bb.high52w || y.high52w,
        low52w: bb.low52w || y.low52w,
        pe: bb.pe || y.pe,
        marketCap: bb.marketCap !== 'N/A' ? bb.marketCap : y.marketCap,
        quoteTime: y.quoteTime ?? null,
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
      bid: bb.bid,
      ask: bb.ask,
      dataSource: 'bloomberg',
      provenance,
    })
  }

  return out
}
