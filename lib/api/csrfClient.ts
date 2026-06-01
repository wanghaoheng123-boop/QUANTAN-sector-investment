/**
 * Client-side companion to lib/api/csrf.ts (double-submit cookie CSRF guard).
 *
 * middleware.ts issues the `quantan_csrf` cookie with httpOnly:false precisely
 * so browser code can read it and echo it back as the `x-quantan-csrf` header
 * on same-origin POSTs. Server routes call `validateCsrf()`, which requires the
 * header to equal the cookie. Any browser POST to a CSRF-guarded route
 * (e.g. /api/trading-agents/[ticker], /api/backtest) must spread
 * `csrfHeaders()` into its fetch headers, or the request is rejected with
 * 403 csrf_invalid before it reaches the handler.
 *
 * Cookie/header names are imported from lib/api/csrf.ts so they remain a single
 * source of truth shared with the server-side validator.
 */

import { csrfCookieName, csrfHeaderName } from '@/lib/api/csrf'

/**
 * Read the double-submit CSRF token from the (non-HttpOnly) cookie. Returns ''
 * when unavailable — during SSR (`document` is undefined) or before middleware
 * has issued the cookie. Callers still send the request; the server's 403 then
 * surfaces a "reload and retry" message rather than the client throwing.
 */
export function readCsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const name = csrfCookieName()
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  if (!entry) return ''
  // Mirror the server's parseCookie() decode so header and cookie compare equal.
  return decodeURIComponent(entry.slice(name.length + 1))
}

/**
 * Header map carrying the double-submit CSRF token, ready to spread into a
 * fetch `headers` object for same-origin POSTs to CSRF-guarded routes. Empty
 * when no token is available (the request then fails closed at the server).
 */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfToken()
  return token ? { [csrfHeaderName()]: token } : {}
}
