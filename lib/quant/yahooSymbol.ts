/**
 * Yahoo Finance symbol normalization for API routes.
 *
 * Phase 16 audit (2026-05-24, F7.3 hardening):
 * ─────────────────────────────────────────────
 * Prior version was DOCUMENTED as "permissive — caller is responsible for
 * bounds-checking before passing to upstream APIs." Three production routes
 * (options, fundamentals, analytics) forgot to do the upstream check, so a
 * crafted ticker path-param would propagate to `yahoo-finance2` and out to
 * the Yahoo HTTP client. Migrated those routes to `normalizeTicker` from
 * `@/lib/api/sanitize` and hardened this function to fail-closed too:
 * inputs that don't match the canonical character class now return `null`.
 *
 * For new code: prefer `normalizeTicker` directly — its `null` return type
 * forces the call site to handle the invalid-ticker path. This function is
 * retained for backward compatibility with the index-quote convenience
 * pattern (`yahooSymbolFromParam('VIX')` returns `'^VIX'`).
 *
 * Behaviour:
 *   - 'VIX' / 'vix' / '^VIX' → '^VIX'
 *   - 'GSPC' → '^GSPC' (and similar for known indices)
 *   - 'AAPL' / 'BRK-B' / 'BTC-USD' → as-is, uppercased
 *   - Anything outside the canonical character class → `null`
 *     (Phase 16 change — was previously a permissive pass-through.)
 */

import { normalizeTicker } from '@/lib/api/sanitize'

const US_INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  'VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX',
])

/**
 * Normalize a raw ticker token. Returns the normalized symbol, or `null`
 * when the input fails the canonical whitelist (see `normalizeTicker`).
 *
 * Phase 16 (2026-05-24): return type widened from `string` to `string | null`
 * so the fail-closed gate is honest. Existing callers must now handle the
 * `null` branch — at runtime, the prior pass-through behaviour would have
 * forwarded arbitrary input to yahoo-finance2, so any caller relying on the
 * old behaviour was already broken in the SSRF-risk sense.
 */
export function yahooSymbolFromParam(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const u = raw.trim().toUpperCase()
  if (!u) return null
  // Already prefixed with ^ — defer to normalizeTicker for the full check.
  if (u.startsWith('^')) return normalizeTicker(u)
  // Apply the US-index ^-prefix shortcut, then validate via the SSOT.
  const candidate = US_INDEX_SYMBOLS.has(u) ? `^${u}` : u
  return normalizeTicker(candidate)
}
