/**
 * I2 — a cached value must never be served as if it were live.
 *
 * I2: "Never substitute a cached value for a live one without a visible flag."
 * The Q-079 audit rated I2 **VIOLATED** on this clause alone: `_cached: true`
 * was set by three API routes and read by NOBODY. The substitution happened and
 * the flag died in the JSON.
 *
 * A flag with no consumer is indistinguishable from no flag, so this asserts the
 * consumption, not the emission.
 *
 * REACHABILITY FIRST. This file was written after a guard in the immediately
 * preceding package went green because its extractor never visited the text, so
 * every claim below is preceded by a check that the thing being scanned was
 * actually found.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../..')
const IGNORED = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.git'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const files = ['app', 'components', 'hooks', 'lib']
  .flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: rel(f), source: readFileSync(f, 'utf8') }))

/** Routes that SET the flag — i.e. can serve a stored copy in place of a fetch. */
const producers = files.filter(
  (f) => f.path.startsWith('app/api/') && /_cached:\s*true/.test(f.source),
)
/** Anything that READS the flag, i.e. can act on it. */
const consumers = files.filter(
  (f) => !f.path.startsWith('app/api/') && /_cached/.test(f.source),
)

describe('I2 — the scan is reachable', () => {
  it('finds the API routes that can serve a cached value', () => {
    // If this were empty every assertion below would pass vacuously — which is
    // precisely how the flag went unread for as long as it did.
    expect(producers.length).toBeGreaterThan(0)
  })

  it('finds the indicator component that renders the flag', () => {
    expect(files.some((f) => f.path === 'components/DataFreshnessIndicator.tsx')).toBe(true)
  })
})

describe('I2 — the cache flag has consumers', () => {
  it('at least one non-route surface reads _cached', () => {
    expect(consumers.map((f) => f.path)).not.toEqual([])
  })

  it('every consumer that reads _cached also renders a freshness indicator', () => {
    // Reading the flag and doing nothing visible with it is the same defect
    // wearing a busier disguise.
    const silent = consumers
      .filter((f) => !/DataFreshnessIndicator/.test(f.source))
      .map((f) => f.path)
    expect(silent).toEqual([])
  })
})

describe('I2 — EVERY route that can serve a cached value has a consumer that shows it', () => {
  /** `app/api/crypto/btc/metrics/route.ts` -> `/api/crypto/btc/metrics` */
  const routeUrl = (p: string) =>
    '/' + p.replace(/^app\//, '').replace(/\/route\.tsx?$/, '')

  it('maps every producer to a URL a client could actually call', () => {
    // Reachability: a broken mapping would make the assertion below vacuous.
    for (const prod of producers) {
      expect(routeUrl(prod.path)).toMatch(/^\/api\//)
    }
  })

  it('each producer URL is fetched by a surface that reads _cached', () => {
    // The earlier version of this file only asserted that SOME consumer existed
    // anywhere, which one wired route would satisfy while two others still
    // served stored copies silently. This is the property: per producer.
    const unconsumed: string[] = []
    for (const prod of producers) {
      const url = routeUrl(prod.path)
      // Dynamic segments are template holes in the caller, so compare on the
      // static prefix before the first bracket.
      const prefix = url.split('/[')[0]
      const callers = files.filter(
        (f) => !f.path.startsWith('app/api/') && f.source.includes(prefix),
      )
      if (callers.length === 0) continue // nothing calls it; not this test's business
      if (!callers.some((f) => /_cached/.test(f.source))) unconsumed.push(prod.path)
    }
    expect(unconsumed).toEqual([])
  })
})

describe('I2 — cached must outrank every freshness state, including Live', () => {
  const src = readFileSync(join(ROOT, 'components/DataFreshnessIndicator.tsx'), 'utf8')

  it('the component accepts a cached flag', () => {
    expect(src).toMatch(/cached\?:\s*boolean/)
  })

  it('the cached branch is evaluated BEFORE the age-based states', () => {
    // A cached value with a recent timestamp would otherwise render green and
    // pulsing — actively telling the user it is live. That is worse than showing
    // nothing, so ordering is the property that matters, not mere presence.
    const cachedBranch = src.indexOf('if (cached)')
    const liveBranch = src.indexOf('ageSec < 10')
    expect(cachedBranch).toBeGreaterThan(-1)
    expect(liveBranch).toBeGreaterThan(-1)
    expect(cachedBranch).toBeLessThan(liveBranch)
  })

  it('the cached state says so to assistive technology, not just in colour', () => {
    expect(src).toMatch(/Value served from cache, not fetched live/)
  })
})
