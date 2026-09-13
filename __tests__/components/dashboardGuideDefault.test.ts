/**
 * Q-115 — the guide's first-visit default, which is only observable through a
 * hydration effect and would otherwise change unnoticed.
 *
 * Measured on production 2026-09-13 at 375x812: the panel was 2453px tall on
 * /desk, putting the first quote row 1.21 screens down; 1.56 screens on
 * /sector/[slug]. That is why the narrow case differs from the wide one.
 */
import { describe, it, expect } from 'vitest'
import { shouldStartCollapsed, NARROW_VIEWPORT_MAX_PX } from '@/components/DashboardGuide'

/** Minimal window stand-in: matchMedia is the only thing the decision reads. */
const win = (matches: boolean) => ({
  matchMedia: (q: string) => ({ matches, media: q }) as MediaQueryList,
})

describe('DashboardGuide first-visit default', () => {
  it('starts collapsed on a narrow viewport', () => {
    expect(shouldStartCollapsed(win(true))).toBe(true)
  })

  it('starts OPEN on a wide viewport — the Phase 12 decision is preserved', () => {
    expect(shouldStartCollapsed(win(false))).toBe(false)
  })

  it('queries the sm breakpoint the rest of the repo is written against', () => {
    // If this drifts from Tailwind's `sm`, the guide collapses at a width where
    // the layout has already gone wide (or the reverse), and nothing else would
    // catch it.
    let asked = ''
    shouldStartCollapsed({
      matchMedia: (q: string) => {
        asked = q
        return { matches: false, media: q } as MediaQueryList
      },
    })
    expect(asked).toBe(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`)
    expect(NARROW_VIEWPORT_MAX_PX).toBe(639)
  })

  it.each([undefined, {} as Window])(
    'fails OPEN when matchMedia is unavailable (%s)',
    (w) => {
      // jsdom and older browsers have no matchMedia. Showing the explanation to
      // someone who did not need it is a smaller harm than hiding it from
      // someone who did, so the fallback is deliberately the noisy one.
      expect(shouldStartCollapsed(w as Window | undefined)).toBe(false)
    },
  )

  it('a throwing matchMedia also fails OPEN rather than crashing the page', () => {
    expect(
      shouldStartCollapsed({
        matchMedia: () => {
          throw new Error('unsupported media query')
        },
      }),
    ).toBe(false)
  })
})
