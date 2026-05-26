/**
 * Double-submit cookie CSRF guard (Phase 15 Q-036).
 */

const CSRF_COOKIE = 'quantan_csrf'
const CSRF_HEADER = 'x-quantan-csrf'

export function csrfCookieName(): string {
  return CSRF_COOKIE
}

export function csrfHeaderName(): string {
  return CSRF_HEADER
}

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function validateCsrf(request: Request): boolean {
  const header = request.headers.get(CSRF_HEADER)
  const cookie = parseCookie(request.headers.get('cookie') ?? '')[CSRF_COOKIE]
  if (!header || !cookie) return false
  return header === cookie
}

function parseCookie(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k) out[k] = decodeURIComponent(rest.join('='))
  }
  return out
}
