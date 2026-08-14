// @vitest-environment jsdom
/**
 * Regression tests for the 2026-08-14 interface review.
 *
 * F-IA-1 — `/portfolio`, `/portfolio/factor-attribution` and `/risk/scenarios`
 *   shipped with ZERO inbound links: a link-graph sweep over `app/` and
 *   `components/` found no `href` reaching `/portfolio`, and the other two were
 *   linked only from it. All three returned 200 and rendered correctly — they
 *   were finished features that no user could click their way to.
 *
 *   The guard below is deliberately written against the ROUTE FILESYSTEM, not
 *   against a hand-maintained list: it reads `app/**\/page.tsx` and asserts
 *   every static top-level route has a nav entry. A future page that ships
 *   without one fails this test instead of silently becoming an orphan.
 *
 * F-A11Y-2 — the price marquee renders its item list twice so the CSS loop is
 *   seamless. Without `aria-hidden` on the second copy, assistive tech reads
 *   every price twice.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NAV_ALL, isActivePath } from '@/components/SiteNav'
import PriceTicker from '@/components/PriceTicker'

/** Routes intentionally absent from the nav, with the reason. */
const NAV_EXEMPT = new Set([
  '/',                    // the logo is the Markets link; NAV_ALL lists it anyway
  '/auth/signin',         // reached from the Sign in control, not the nav
  '/crypto',              // server redirect() -> /crypto/btc
])

function staticPageRoutes(appDir: string): string[] {
  const routes: string[] = []
  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry === 'api') continue
        // Skip dynamic segments — [ticker], [sector], [slug] are reached from
        // the content that lists them, not from global navigation.
        if (entry.startsWith('[')) continue
        walk(full, `${urlPath}/${entry}`)
      } else if (entry === 'page.tsx') {
        routes.push(urlPath === '' ? '/' : urlPath)
      }
    }
  }
  walk(appDir, '')
  return routes
}

describe('F-IA-1 — every shipped page is reachable from the navigation', () => {
  const appDir = join(process.cwd(), 'app')
  const routes = staticPageRoutes(appDir)
  const navHrefs = new Set(NAV_ALL.map((i) => i.href))

  it('discovers the app router pages', () => {
    // Sanity: if this ever finds nothing, the guard below would vacuously pass.
    expect(routes.length).toBeGreaterThanOrEqual(10)
    expect(routes).toContain('/portfolio')
  })

  it.each(
    staticPageRoutes(join(process.cwd(), 'app')).filter((r) => !NAV_EXEMPT.has(r)),
  )('%s has a navigation entry', (route) => {
    expect(navHrefs.has(route)).toBe(true)
  })

  it('specifically covers the three routes that were orphaned', () => {
    for (const href of ['/portfolio', '/portfolio/factor-attribution', '/risk/scenarios']) {
      expect(navHrefs.has(href)).toBe(true)
    }
  })

  it('exposes no duplicate destinations', () => {
    expect(navHrefs.size).toBe(NAV_ALL.length)
  })
})

describe('isActivePath', () => {
  it('matches the root only exactly', () => {
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/desk', '/')).toBe(false)
  })

  it('matches a route exactly', () => {
    expect(isActivePath('/desk', '/desk')).toBe(true)
  })

  it('matches descendants that are not themselves nav destinations', () => {
    expect(isActivePath('/briefs/sector/technology', '/briefs')).toBe(true)
  })

  it('does NOT light up the parent when a child destination is active', () => {
    // Both /portfolio and /portfolio/factor-attribution are nav entries; only
    // the child should read as the current page.
    expect(isActivePath('/portfolio/factor-attribution', '/portfolio')).toBe(false)
    expect(isActivePath('/portfolio/factor-attribution', '/portfolio/factor-attribution')).toBe(true)
  })

  it('does not match a prefix that is not a path segment', () => {
    expect(isActivePath('/desktop', '/desk')).toBe(false)
  })
})

describe('F-A11Y-2 — the price marquee is not announced twice', () => {
  const items = [
    { ticker: 'XLK', name: 'Technology', price: 191, changePct: 1.13 },
    { ticker: 'XLE', name: 'Energy', price: 60.85, changePct: -0.29 },
  ]
  const html = renderToStaticMarkup(<PriceTicker items={items} />)

  it('renders the list twice for the seamless CSS loop', () => {
    expect(html.split('XLK').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('marks the duplicated half aria-hidden', () => {
    // One aria-hidden row wrapper per duplicated item.
    const hiddenRows = html.match(/aria-hidden="true" class="flex items-center gap-1\.5 shrink-0"/g)
      ?? html.match(/class="flex items-center gap-1\.5 shrink-0" aria-hidden="true"/g)
    expect(hiddenRows?.length ?? 0).toBe(items.length)
  })

  it('exposes a real pause control (WCAG 2.2.2), not just :hover', () => {
    expect(html).toContain('aria-label="Pause the price ticker"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('labels the marquee as a region', () => {
    expect(html).toContain('aria-label="Sector ETF price ticker"')
  })
})
