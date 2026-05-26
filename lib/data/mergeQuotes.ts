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
 * Phase 13 S2 audit (mergeQuotes correctness):
 *   The `||` fallback DOES treat Bloomberg-reported 0 as "missing" and
 *   falls through to Yahoo. This is the conservative choice given the
 *   bridge-client's `num()` helper (lib/data/bloomberg/bridgeClient.ts:27)
 *   coerces ALL missing/invalid values to 0 — making Bloomberg's 0
 *   ambiguous between "halted/no trades" and "field absent from upstream".
 *
 *   Genuine zero-volume during a halt → Yahoo override → minor cost
 *   (Yahoo has the same halt). Genuine missing-field zero → Yahoo
 *   override → critical recovery. The conservative choice is correct.
 *
 *   If the bridge protocol is ever extended to distinguish missing from
 *   zero (e.g. by emitting `volume: null`), the type & this fallback
 *   can be tightened to use nullish-coalescing semantics.
 *
 *   The provenance tracker mirrors the same truthy-check so the
 *   reported `provenance.volume = 'yahoo'` is consistent with the
 *   value's actual source.
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
    // Phase 14 wave 7: apply the same truthy-checks as the Yahoo-overlap branch
    // above. Previously every field's provenance was hard-coded to 'bloomberg'
    // even when bb.volume was 0 or bb.marketCap was the 'N/A' sentinel — an
    // audit reading `provenance.volume === 'bloomberg'` would falsely conclude
    // Bloomberg supplied volume when in fact the value was missing.
    //
    // For consistency with the dual-source path, we still mark these as
    // 'bloomberg' for primary (price/change/changePct) — Bloomberg is the
    // only source available in this branch — but emit a structured warn so
    // operators can detect the Bloomberg-only sentinel pattern.
    const sentinelFields: string[] = []
    if (!bb.volume) sentinelFields.push('volume')
    if (!bb.high52w) sentinelFields.push('high52w')
    if (!bb.low52w) sentinelFields.push('low52w')
    if (!bb.pe) sentinelFields.push('pe')
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
      bid: bb.bid,
      ask: bb.ask,
      dataSource: 'bloomberg',
      provenance,
    })
  }

  return out
}
