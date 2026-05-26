/**
 * URL safety primitives — single source of truth for any code path that
 * forwards externally-sourced URLs into the DOM (anchor href, image src,
 * iframe src, etc.).
 *
 * Phase 13 S2 hardening:
 *   The platform aggregates Yahoo Finance news, Bloomberg-bridge data,
 *   and other third-party feeds. Any third-party-provided URL that
 *   reaches `<a href={…}>` or similar is a potential XSS supply-chain
 *   vector — `javascript:`, `data:`, `vbscript:`, and other non-http
 *   schemes execute script in the user's session on click.
 *
 *   The defence is a strict http(s) scheme allow-list. URL parsing
 *   normalises the input and rejects anything that doesn't have one
 *   of the two safe schemes.
 *
 * Citation: OWASP XSS Prevention Cheat Sheet, "Output Encoding for
 *           HTML Attribute Contexts" — disallow non-http schemes in
 *           href values regardless of upstream trust level.
 *           CWE-79 Cross-site Scripting.
 */

/** Reasonable upper bound. URLs longer than this are almost certainly malicious or broken. */
const MAX_URL_LENGTH = 2048

/**
 * Returns true iff `raw` is a non-empty string ≤ MAX_URL_LENGTH chars and
 * parses as an http: or https: URL. Returns false for any other scheme
 * (javascript:, data:, vbscript:, file:, ftp:, mailto:, etc.), null/undefined,
 * empty string, oversized input, and unparseable strings.
 *
 * Stable contract: the same input always returns the same result. Pure.
 */
export function isSafeHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return false
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Returns `raw` when it passes isSafeHttpUrl, else returns the supplied
 * fallback (default '#'). Convenience for `<a href={safeHref(item.link)}>`.
 */
export function safeHref(raw: unknown, fallback = '#'): string {
  return isSafeHttpUrl(raw) ? (raw as string) : fallback
}
