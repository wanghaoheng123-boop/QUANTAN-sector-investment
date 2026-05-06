/**
 * Shared API helpers — Phase 13 S2.
 *
 * Centralizes patterns previously duplicated across multiple route handlers:
 *   - sanitizeError: production-safe error message (CWE-209)
 *   - normalizeTicker: US-index-aware ticker normalization
 *   - num: number-or-zero coercion that rejects non-finite values
 *
 * Each helper closes a finding from the Phase 13 S1 audit:
 *   F4.6 (num)            — fallback to 0 only on non-finite input.
 *   F4.8 (sanitizeError)  — strip stack traces / paths in production responses.
 *   F4.10 (normalizeTicker) — full US-index whitelist, not just VIX.
 *   F7.3                   — strict ticker character whitelist.
 */

/**
 * Yahoo expects `^`-prefixed symbols for US indices. Users frequently send
 * the plain form (`VIX`, `DJI`). This whitelist contains the indices we
 * support; everything else passes through unchanged.
 */
const US_INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  'VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX',
])

/**
 * Strict allowable ticker character set. Phase 13 F7.3 (Security): defense
 * against attempts to embed URL parameters or paths in the ticker token.
 *   AAPL, BRK-B, BRK.B, 9988.HK, GC=F, ^VIX, ^GSPC
 */
const TICKER_REGEX = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,15}$/

/**
 * Normalize a single ticker token from a user-supplied string.
 * Returns the normalized form, or null if the input fails validation.
 */
export function normalizeTicker(raw: string): string | null {
  const u = decodeURIComponent(raw.trim()).toUpperCase()
  if (!u) return null
  // Already prefixed with ^ — pass through if valid.
  if (u.startsWith('^')) return TICKER_REGEX.test(u) ? u : null
  // Known plain index → prepend ^ for Yahoo compatibility.
  const candidate = US_INDEX_SYMBOLS.has(u) ? `^${u}` : u
  return TICKER_REGEX.test(candidate) ? candidate : null
}

/**
 * Number-or-zero coercion. Returns 0 for non-finite inputs.
 * Use this instead of `value || 0` so that a legitimate 0 isn't conflated
 * with `undefined` / `null` / `NaN`.
 */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Production-safe error message for inclusion in API error responses.
 * - In production: returns `undefined` so the route's standard error envelope
 *   ships without leaking stack traces, file paths, or upstream URLs (CWE-209).
 * - In development: returns `error.message` for diagnosability.
 *
 * Server-side logs should still record the full error separately.
 */
export function sanitizeError(error: unknown): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined
  if (error instanceof Error) return error.message
  return String(error)
}
