/**
 * Edge middleware (Phase 15).
 *
 * Two responsibilities:
 *
 *   1. CSP nonce (Q-040-NEW partial): per-request nonce for future strict
 *      script-src. Currently emitted on requests for downstream components
 *      that need it via `headers().get('x-nonce')`. Enforcing CSP header is
 *      added only when QUANTAN_CSP_ENFORCE=1; next.config.js keeps the
 *      Report-Only header in place by default so observability is unchanged
 *      until a 7-day clean-Report window has been verified.
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
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  // ── CSP (Q-040-NEW) — only when explicitly opted in ────────────────────
  if (process.env.QUANTAN_CSP_ENFORCE === '1') {
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: https:",
        "connect-src 'self' https: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    )
  }

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
