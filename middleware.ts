/**
 * Edge middleware (Phase 15).
 *
 * Two responsibilities:
 *
 *   1. CSP nonce (Q-040-NEW, completed by A6-1 2026-07-06): a per-request
 *      nonce'd strict CSP. The policy is set on the REQUEST headers so
 *      Next.js App Router reads the nonce and stamps it onto its own inline
 *      bootstrap/hydration <script> tags during SSR (the documented Next CSP
 *      pattern). Previously only `x-nonce` was set — nothing consumed it, so
 *      flipping enforcement would have blocked every framework script (the
 *      A6-1 landmine). The RESPONSE header is Report-Only by default;
 *      QUANTAN_CSP_ENFORCE=1 switches it to enforcing — flip only after a
 *      clean report-only window (violations appear in the browser console;
 *      no report-uri collector is wired yet).
 *
 *   2. CSRF cookie issuance (Q-055-NEW, 2026-05-24): the double-submit
 *      cookie pattern in `lib/api/csrf.ts` requires both a cookie AND a
 *      matching `x-quantan-csrf` header on POSTs. Without server-side
 *      issuance, the cookie never exists and every CSRF-protected POST
 *      would 403. We set the cookie on the first request that doesn't
 *      have it (HttpOnly:false so client-side helpers can read it,
 *      SameSite:Strict so cross-site forms can't trigger it, Path:/ so it
 *      covers all routes). Once set, subsequent requests pass it through.
 *
 *      Client-side helper pattern (for components issuing POSTs):
 *        ```ts
 *        const csrf = document.cookie
 *          .split('; ')
 *          .find(c => c.startsWith('quantan_csrf='))
 *          ?.split('=')[1]
 *        await fetch('/api/backtest', {
 *          method: 'POST',
 *          headers: { 'x-quantan-csrf': csrf ?? '' },
 *        })
 *        ```
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CSRF_COOKIE = 'quantan_csrf'

function generateCsrfTokenEdge(): string {
  // Web Crypto is available in the Edge runtime (no Node `crypto` import).
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  // ── CSP (Q-040-NEW / A6-1) ──────────────────────────────────────────────
  // One strict nonce'd policy, used in BOTH modes. 'strict-dynamic' lets the
  // nonce'd Next bootstrap scripts load their chunk children. Dev needs
  // 'unsafe-eval' (react-refresh); it is never emitted in production.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` +
      (process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // A6-1: Next.js reads the nonce from the REQUEST CSP header during SSR and
  // stamps it onto its inline scripts. The request header never reaches the
  // browser, so this is observation-safe regardless of the response mode.
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // Report-Only by default; enforcing only on explicit owner opt-in AFTER a
  // clean report-only window. (next.config.js no longer sets a CSP header —
  // this middleware is the single source of truth for CSP.)
  response.headers.set(
    process.env.QUANTAN_CSP_ENFORCE === '1'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only',
    csp,
  )

  // ── CSRF cookie issuance (Q-055-NEW) ───────────────────────────────────
  // Only set the cookie if it's missing — re-issuing on every request would
  // invalidate the user's in-flight tokens and break legitimate POSTs.
  if (!request.cookies.get(CSRF_COOKIE)) {
    response.cookies.set({
      name: CSRF_COOKIE,
      value: generateCsrfTokenEdge(),
      // httpOnly:false intentionally — client-side helpers need to read the
      // cookie to construct the matching x-quantan-csrf header (double-submit
      // pattern). The "secret" comes from the request-origin matching the
      // server origin, not from cookie opacity.
      httpOnly: false,
      // Strict prevents cross-site forms from triggering authenticated POSTs.
      sameSite: 'strict',
      // Cover all routes so any POST endpoint can validate.
      path: '/',
      // Secure in production (Vercel always serves HTTPS); off in dev so
      // localhost without HTTPS works.
      secure: process.env.NODE_ENV === 'production',
      // 24h — long enough for typical sessions; short enough that a stolen
      // cookie expires before causing meaningful harm.
      maxAge: 86_400,
    })
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
