/**
 * Architecture guard — design invariant I3 (synthetic data containment).
 *
 * Q-088 (2026-08-16). Synthetic dark-pool markers were being generated inside
 * `app/api/chart/[ticker]/route.ts` and returned alongside real OHLC, and
 * fabricated news headlines about real named issuers — attributed to real
 * publishers — were rendered unlabeled and plotted on the price chart.
 *
 * Neither was caught by review: the chart-route call sites were actively
 * maintained (an `as any` was removed from them in Phase 14 wave 29) while the
 * invariant violation went unnoticed. A reviewer looked directly at these
 * lines. That is why the guard is executable rather than a convention.
 *
 * These assertions FAIL on the pre-Q-088 tree — verified by reverting the
 * imports in a scratch run, not assumed.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const MOCK_IMPORT = /from\s+['"]@\/lib\/mockData['"]/

describe('I3 — synthetic data must not reach an API route', () => {
  const routeFiles = walk(join(ROOT, 'app', 'api')).filter((f) => f.endsWith('route.ts'))

  it('finds API route files to check (guard against a vacuous pass)', () => {
    // If the glob silently matched nothing, every assertion below would pass
    // for the wrong reason. Absence of a check is not a passing check.
    expect(routeFiles.length).toBeGreaterThan(5)
  })

  for (const file of routeFiles) {
    const rel = file.slice(ROOT.length + 1)
    it(`${rel} does not import lib/mockData`, () => {
      expect(readFileSync(file, 'utf8')).not.toMatch(MOCK_IMPORT)
    })
  }
})

describe('I3 — the removed synthetic paths stay removed', () => {
  it('lib/mockData no longer exports a chart-marker generator', () => {
    const src = read('lib/mockData.ts')
    expect(src).not.toMatch(/export\s+function\s+generateDarkPoolMarkers/)
  })

  it('lib/mockData no longer exports fabricated news', () => {
    const src = read('lib/mockData.ts')
    expect(src).not.toMatch(/export\s+function\s+getNewsForSector/)
    expect(src).not.toMatch(/SECTOR_NEWS\s*[:=]/)
  })

  it('no fabricated article data is attributed to real publishers', () => {
    const src = read('lib/mockData.ts')
    // Data shape, not prose: the header comment names these publishers to
    // record what was removed, so match on the literal field syntax only.
    expect(src).not.toMatch(/source:\s*['"]/)
    expect(src).not.toMatch(/url:\s*['"]https?:/)
    expect(src).not.toMatch(/title:\s*['"]/)
  })

  it('the chart API route returns no synthetic marker field', () => {
    const src = read('app/api/chart/[ticker]/route.ts')
    expect(src).not.toMatch(/darkPoolMarkers/)
  })

  it('NewsFeed cannot be handed a static article array', () => {
    const src = read('components/NewsFeed.tsx')
    // The `news` prop was how fabricated articles reached the feed.
    expect(src).not.toMatch(/^\s*news\?:\s*NewsItem\[\]/m)
  })
})

describe('I3 — the synthetic brand exists and has one definition site', () => {
  it('exports the __SYNTHETIC__ brand and its runtime assertion', () => {
    const src = read('lib/mockData.ts')
    expect(src).toMatch(/__SYNTHETIC__/)
    expect(src).toMatch(/export\s+type\s+Synthetic</)
    expect(src).toMatch(/export\s+function\s+assertSyntheticAccepted/)
  })

  it('lib/mockData is the only file that confers the brand', () => {
    const offenders = walk(join(ROOT, 'app'))
      .concat(walk(join(ROOT, 'components')), walk(join(ROOT, 'lib')), walk(join(ROOT, 'hooks')))
      .filter((f) => !f.endsWith(join('lib', 'mockData.ts')))
      .filter((f) => /as\s+Synthetic</.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1))

    expect(offenders).toEqual([])
  })

  it('the synthetic surface asserts acceptance at its props boundary', () => {
    expect(read('components/DarkPoolPanel.tsx')).toMatch(/assertSyntheticAccepted\(/)
  })
})
