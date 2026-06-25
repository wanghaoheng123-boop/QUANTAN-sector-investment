/**
 * Stable, collision-free id for a news brief, derived from its link.
 *
 * B-1 (program cell A4, 2026-06-25): the `/api/briefs` route previously used
 *
 *     Buffer.from(link).toString('base64').slice(0, 16)
 *
 * Because base64 encodes the input in independent 3-byte groups, the first 16
 * base64 characters encode *exactly* the first 12 bytes of `link` (12 bytes =
 * 96 bits = 16 chars on a clean group boundary). Every Yahoo Finance news link
 * shares a 12-byte prefix — `"https://fina"` for `finance.yahoo.com/...` and
 * `"https://www."` for the rest — so the truncated id collapsed to one value
 * per domain. The client renders briefs with `key={brief.id}` (app/briefs/
 * page.tsx), so duplicate ids meant duplicate React keys → dropped / mis-keyed
 * cards and a console error.
 *
 * Fix: encode the *full* link with base64url. base64url is a bijection over the
 * input bytes (URL-safe alphabet, no `+`/`/`/`=` padding), so distinct links —
 * which the route already deduplicates by `link` — always get distinct ids, and
 * the same link always maps to the same id (stable across requests). The id is
 * only used as a React key, never persisted or shown, so length is irrelevant.
 */
export function newsBriefId(link: string): string {
  return Buffer.from(link, 'utf8').toString('base64url')
}
