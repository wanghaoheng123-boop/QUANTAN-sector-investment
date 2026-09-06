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
import { findCacheProducers, firstArgument, referencesBinding, silentProducers } from './cacheSubstitution'

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

/**
 * Comments stripped, and this is load-bearing rather than tidiness.
 *
 * The first version of this file matched `_cached` against RAW source. Every
 * page that consumes the flag also carries a comment EXPLAINING the flag — so
 * deleting the actual read (`data._cached` -> `false`) left the comment behind
 * and the guard stayed green. Verified by mutation: it did not fail until this
 * was added. A guard that matches prose about the behaviour instead of the
 * behaviour is the same defect this repo has now hit in four packages.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = ['app', 'components', 'hooks', 'lib']
  .flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: rel(f), source: stripComments(readFileSync(f, 'utf8')) }))

/**
 * Routes that CAN serve a stored copy, detected structurally.
 *
 * Q110-P2 (2026-09-05) — this was `files.filter(f => /_cached:\s*true/)`, i.e.
 * "routes that already set the flag". A route that serves a stored value WITHOUT
 * the flag was therefore not a producer, and the exact violation this file
 * exists to catch was the one input it could not see. Three such routes existed
 * (`ma-deviation`, `backtest`, `backtest/live`) while every assertion below
 * passed. The rule was right; the universe it quantified over was defined by the
 * property under test.
 *
 * The detector lives in `./cacheSubstitution` as pure functions so its own
 * behaviour — and its limits — are executable.
 */
const detected = findCacheProducers(files)
const producers = detected
/** Anything that READS the flag, i.e. can act on it. */
const consumers = files.filter(
  (f) => !f.path.startsWith('app/api/') && /_cached/.test(f.source),
)

describe('I2 — the matcher reads behaviour, not prose about behaviour', () => {
  it('a file that only MENTIONS the flag in a comment is not a consumer', () => {
    const commentOnly = stripComments(`// we should read _cached here one day\nexport const x = 1`)
    expect(/_cached/.test(commentOnly)).toBe(false)
  })

  it('a file that actually reads the flag is a consumer', () => {
    expect(/_cached/.test(stripComments('const c = data._cached === true'))).toBe(true)
  })
})

describe('I2 — the detector finds the substitution, not the flag', () => {
  // POSITIVE CONTROLS. These three routes serve a stored value and say so, and
  // they are the only reason the detector is trusted at all. Two of them were
  // MISSED by its first draft, which matched `json(IDENT` but not
  // `json({ ...IDENT, _cached: true })` — the spread's trailing dot read as a
  // member access. If a refactor breaks that match the detector goes quietly
  // back to a near-zero instance count and this file loses the same way the
  // guards in Q-098 and Q-100 lost. So the controls are asserted, not eyeballed.
  it.each([
    'app/api/chart/[ticker]/route.ts',
    'app/api/crypto/btc/metrics/route.ts',
    'app/api/crypto/btc/liquidations/route.ts',
  ])('detects the known compliant producer %s', (path) => {
    expect(producers.map((p) => p.path)).toContain(path)
  })

  it('does NOT call a route without a module-level store a producer', () => {
    // Negative control: without one, "everything is a producer" would also pass
    // every positive control above.
    const notProducers = files
      .filter((f) => f.path.startsWith('app/api/') && /\/route\.tsx?$/.test(f.path))
      .map((f) => f.path)
      .filter((p) => !producers.some((q) => q.path === p))
    expect(notProducers.length).toBeGreaterThan(0)
    expect(notProducers).toContain('app/api/prices/route.ts')
  })

  it('every producer names the binding it serves', () => {
    for (const p of producers) expect(p.servedVia.length).toBeGreaterThan(0)
  })
})

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


describe('I2 — a route that serves a stored value must SAY it did (Q110-P2)', () => {
  it('no route substitutes silently', () => {
    // Named, not counted: `toEqual([])` prints the offenders, `.length === 0`
    // prints nothing you can act on. Same reason the vendor register lists rows.
    expect(silentProducers(files)).toEqual([])
  })
})

describe('I2 — what this detector CANNOT do, asserted so a green run is not a proof', () => {
  const mk = (source: string) => [{ path: 'app/api/x/route.ts', source }]

  it('MISSES a local assigned to the store AFTER its declaration', () => {
    // The alias rule binds `const x = store…` at the declaration. Split the
    // declaration from the assignment and the textual link is gone, so nothing
    // inside the `json(` argument names a store. Dataflow analysis is the wrong
    // depth for an architecture test; this is the price, stated rather than
    // discovered later.
    //
    // The FIRST draft of this test asserted a miss the detector does NOT have
    // (`const payload = store?.data ?? await compute()` — the alias regex reads
    // straight through `?.`). It failed, which is the only reason the overclaim
    // was caught. A "cannot do" test that understates the guard is the same
    // defect as one that overstates it: both teach the reader something false.
    const escaped = mk(`
let store: { data: unknown } | null = null
export async function GET() {
  let payload
  if (store) payload = store.data
  else { payload = await compute(); store = { data: payload } }
  return NextResponse.json(payload)
}`)
    expect(findCacheProducers(escaped)).toEqual([])
  })

  it('MISSES a response assembled by a same-module helper', () => {
    const escaped = mk(`
let store: { data: unknown } | null = null
function build() { return { ...(store?.data ?? {}) } }
export async function GET() {
  store = { data: 1 }
  return NextResponse.json(build())
}`)
    expect(findCacheProducers(escaped)).toEqual([])
  })

  it('DOES see through an optional chain and a nullish default', () => {
    // Recording what it CAN do next to what it cannot, because the boundary is
    // the useful information and this one surprised me.
    const caught = mk(`
let store: { data: unknown } | null = null
export async function GET() {
  const payload = store?.data ?? (await compute())
  store = { data: payload }
  return NextResponse.json(payload)
}`)
    expect(findCacheProducers(caught)).toHaveLength(1)
  })

  it('MISSES a store served from the second argument onward', () => {
    // firstArgument stops at the first comma at depth 1 — the payload position.
    const escaped = mk(`
let store: unknown = null
export async function GET() {
  store = 1
  return NextResponse.json({ ok: true }, { headers: {}, extra: store })
}`)
    expect(findCacheProducers(escaped)).toEqual([])
  })

  it('MISSES a cache that lives outside the route module', () => {
    // A shared helper in `lib/` that memoises and is awaited here leaves no
    // module-level store in the route at all.
    const escaped = mk(`
import { memoisedFetch } from '@/lib/cacheHelper'
export async function GET() {
  return NextResponse.json(await memoisedFetch())
}`)
    expect(findCacheProducers(escaped)).toEqual([])
  })

  it('DOES catch the three forms this repo actually uses', () => {
    // Positive controls for the detector itself, at the unit level: direct,
    // spread, and via a local bound to a Map read.
    const direct = mk('let c: any = null\nexport async function GET(){ c = 1; return NextResponse.json(c) }')
    const spread = mk('let c: any = null\nexport async function GET(){ c = 1; return NextResponse.json({ ...c.data, _cached: true }) }')
    const alias = mk('const c = new Map<string, any>()\nexport async function GET(){ c.set("k", 1); const hit = c.get("k"); return NextResponse.json(hit.data) }')
    expect(findCacheProducers(direct)).toHaveLength(1)
    expect(findCacheProducers(spread)).toHaveLength(1)
    expect(findCacheProducers(spread)[0].declaresFlag).toBe(true)
    expect(findCacheProducers(alias)).toHaveLength(1)
  })

  it('does not treat a per-request local as a store', () => {
    const local = mk('export async function GET(){ let c: any = null; c = 1; return NextResponse.json(c) }')
    expect(findCacheProducers(local)).toEqual([])
  })

  it('firstArgument is balance-based, so formatting cannot defeat it', () => {
    const src = 'NextResponse.json(\n  {\n    a: 1,\n    b: [2, 3],\n  },\n  { headers: {} },\n)'
    const arg = firstArgument(src, src.indexOf('(' ))
    expect(arg).toContain('b: [2, 3]')
    expect(arg).not.toContain('headers')
  })

  it('referencesBinding accepts a spread and rejects a member access', () => {
    expect(referencesBinding('{ ...store.data }', 'store')).toBe(true)
    expect(referencesBinding('{ x: other.store }', 'store')).toBe(false)
    expect(referencesBinding('store', 'store')).toBe(true)
  })
})
