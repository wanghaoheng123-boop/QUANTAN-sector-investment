/**
 * Sector color SSOT.
 *
 * Phase 14 (R5-M-2): Color mappings were previously duplicated across
 * `app/backtest/page.tsx` and `app/api/briefs/route.ts`, with subtle drift
 * (Materials/Utilities/Real Estate/Consumer Staples differed between the two
 * tables). This module re-exports the canonical palette from `lib/sectors.ts`
 * and exposes two views:
 *
 *   - `SECTOR_COLORS_BY_NAME`: keyed by display name (e.g. "Technology",
 *     "Consumer Disc.") — what the backtest page needs since it joins on
 *     sector names returned by the portfolio summary.
 *   - `SECTOR_COLORS_BY_SLUG`: keyed by slug (e.g. "technology",
 *     "consumer-discretionary") — what the briefs API and route handlers
 *     need.
 *
 * The Crypto pseudo-sector (`#f7931a`) is added by name-view only — BTC is
 * not a GICS sector and lives outside `SECTORS`, but the backtest renders it
 * alongside the 11 equity sectors.
 */

import { SECTORS } from './sectors'

export const SECTOR_COLORS_BY_NAME: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const s of SECTORS) map[s.name] = s.color
  // Crypto is rendered alongside GICS sectors in the backtest UI.
  map['Crypto'] = '#f7931a'
  return map
})()

export const SECTOR_COLORS_BY_SLUG: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const s of SECTORS) map[s.slug] = s.color
  return map
})()

/** Default fallback for an unknown sector (slate-500). */
export const DEFAULT_SECTOR_COLOR = '#64748b'

/** Convenience helper: look up a sector color by display name, with fallback. */
export function sectorColorByName(name: string | undefined | null): string {
  if (!name) return DEFAULT_SECTOR_COLOR
  return SECTOR_COLORS_BY_NAME[name] ?? DEFAULT_SECTOR_COLOR
}
