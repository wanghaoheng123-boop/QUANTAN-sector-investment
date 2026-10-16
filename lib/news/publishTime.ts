/**
 * When a Yahoo news item was published, as ISO-8601 — or null.
 *
 * Yahoo's search news carries `providerPublishTime`, NOT `publishedAt`
 * (measured 2026-10-16: item keys are uuid, title, publisher, link,
 * providerPublishTime, type, thumbnail, relatedTickers). yahoo-finance2 hands
 * it over as a Date even with `validateResult: false`. Q088-4 fixed this on
 * the ticker route only; the sector and landing-page routes kept reading
 * `publishedAt`, so every headline they served was undated (Q-140 red-team
 * L12). One reader now, for all three.
 *
 * A number is accepted as Unix SECONDS when it is below 1e12 (that is before
 * 2001 in milliseconds), otherwise milliseconds — so a raw API value cannot
 * silently land in January 1970.
 */
const SECONDS_CUTOFF = 1e12

export function newsPublishTime(item: Record<string, unknown>): string | null {
  const raw = item.providerPublishTime ?? item.publishedAt
  let d: Date | null = null
  if (raw instanceof Date) d = raw
  else if (typeof raw === 'number' && Number.isFinite(raw)) d = new Date(raw < SECONDS_CUTOFF ? raw * 1000 : raw)
  else if (typeof raw === 'string' && raw.trim() !== '') d = new Date(raw)
  return d && Number.isFinite(d.getTime()) ? d.toISOString() : null
}
