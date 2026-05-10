/**
 * Yahoo Finance symbol normalization for API routes.
 *
 * Phase 13 S2: expanded to cover the full US-index whitelist (was VIX only),
 * matching `lib/api/sanitize.ts:normalizeTicker`. Kept as a separate function
 * because callers expect a non-null string return — `normalizeTicker` returns
 * null on invalid input, which would force changes across many call sites.
 *
 * Behaviour:
 *   - 'VIX' / 'vix' / '^VIX' → '^VIX'
 *   - 'GSPC' → '^GSPC' (and similar for known indices)
 *   - 'AAPL' / 'BRK-B' → as-is, uppercased
 *   - Anything else → uppercased (permissive — caller is responsible for
 *     bounds-checking before passing to upstream APIs).
 */

const US_INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  'VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX',
])

export function yahooSymbolFromParam(raw: string): string {
  const u = raw.trim().toUpperCase()
  if (u.startsWith('^')) return u
  return US_INDEX_SYMBOLS.has(u) ? `^${u}` : u
}
