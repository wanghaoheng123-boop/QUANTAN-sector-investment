/**
 * Lightweight, permissive ticker canonicalization for local-state callers
 * (watchlist, recent searches) that must NOT reject user-saved tickers.
 *
 * Phase 14 wave 24 rename — was `normalizeTicker`, which collided in name
 * with the strict char-whitelisted version in `lib/api/sanitize.ts`. Two
 * functions sharing the same name but very different rejection semantics is
 * an SSOT footgun; this one now has a distinct name (`canonicalizeTickerCase`)
 * so the import site is unambiguous.
 *
 * - This function only uppercases / trims / fixes the VIX prefix.
 * - For ANY API input from a request body / URL, use the strict
 *   `normalizeTicker` from `@/lib/api/sanitize`.
 */
export function canonicalizeTickerCase(ticker: string): string {
  const s = ticker.trim().toUpperCase()
  if (s === 'VIX' || s === '^VIX') return '^VIX'
  return s
}
