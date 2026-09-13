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
import { classifyFreshness } from '@/lib/data/freshness'

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

  /**
   * Q-101 (2026-09-13) — this was `src.indexOf('if (cached)') <
   * src.indexOf('ageSec < 10')`, an assertion about where two strings sit in a
   * component's source. It broke the moment the decision moved to a pure
   * module, which is the tell: it was measuring layout, not behaviour. A
   * reformat could break it and a genuinely wrong answer could pass it.
   *
   * Replaced with the property itself, called. Strictly stronger — swapping the
   * branches in `lib/data/freshness.ts` fails these, and no amount of moving
   * lines around passes them.
   */
  it('cached OUTRANKS live: a stored copy stamped one second ago is not live', () => {
    const now = Date.parse('2026-09-14T15:00:00Z') // Monday 11:00 ET, session open
    expect(classifyFreshness({ quoteTime: now - 1_000, now, cached: true }).kind).toBe('cached')
  })

  it('and outranks it under the equity calendar too', () => {
    const now = Date.parse('2026-09-14T15:00:00Z')
    expect(
      classifyFreshness({ quoteTime: now - 1_000, now, cached: true, calendar: 'us-equity' }).kind,
    ).toBe('cached')
  })

  it('a vendor-delayed feed is not live either, for the same reason', () => {
    // The age of a fetch says nothing about the age of a price the vendor holds
    // back by 15 minutes. Same lie, different cause, same branch ordering.
    const now = Date.parse('2026-09-14T15:00:00Z')
    expect(classifyFreshness({ quoteTime: now - 1_000, now, delayedMinutes: 15 }).kind)
      .toBe('delayed')
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

/* ========================================================================== *
 * Q-101 (2026-09-13) — the same property, one level up.
 *
 * `_cached` was never the only data-state fact this codebase emits and drops.
 * The Q-079 audit named two more in the same breath and only the first was ever
 * closed. Measured on the committed tree before this block existed:
 *
 *   dataProvenance  1 occurrence repo-wide — the producer. Zero consumers.
 *   provenance      built per field on every /api/prices row. Zero consumers.
 *
 * A flag with no consumer is indistinguishable from no flag, whatever it is
 * called, so the assertion below is the generalisation rather than a second
 * copy of the one above.
 *
 * ON THE SHAPE OF THE PRODUCER SET, because that is where the last six of these
 * guards died. Here the antecedent is "declares the fact" and the consequent is
 * "someone reads it" — the antecedent is legitimately the declaration, unlike
 * the `_cached` case above where it had to be "serves a stored value" and was
 * wrongly written as "sets the flag". The analogous hole HERE is a route that
 * serves vendor-delayed data and never declares it at all, which no source
 * property can see. It is asserted as a CANNOT-do below rather than implied
 * closed.
 * ========================================================================== */

/** An emitted key that makes a claim about the STATE of the data, not its value. */
const DATA_STATE_FACTS = [
  { key: 'dataProvenance', what: 'vendor delay and realtime claim' },
  { key: 'provenance', what: 'per-field vendor attribution' },
] as const

/** A user-facing surface: somewhere a human can actually see the fact rendered. */
const isSurface = (path: string) =>
  (path.startsWith('app/') && !path.startsWith('app/api/')) ||
  path.startsWith('components/') ||
  path.startsWith('hooks/')

/** Matches the key in emitting position, and does not let `provenance` match `dataProvenance`. */
const emits = (source: string, key: string) =>
  new RegExp(`(^|[^A-Za-z_$.])${key}\\s*:`).test(source)

/**
 * Declared exceptions. Each needs a reason and an owning ticket, asserted
 * below — so an exemption cannot be added as a silent one-word edit, which is
 * the only way an allowlist stays honest.
 */
const EXEMPT: { key: string; producer: string; ticket: string; reason: string }[] = [
  {
    key: 'provenance',
    producer: 'lib/data/mergeQuotes.ts',
    ticket: 'Q-108',
    reason:
      'Per-field yahoo-vs-bloomberg attribution. The Bloomberg bridge is unwired ' +
      '(.env.example leaves BLOOMBERG_BRIDGE_URL commented out), so every row is ' +
      'uniformly yahoo today and rendering the field would add noise, not ' +
      'information. It becomes user-visible the moment a row can be mixed, which ' +
      'is exactly what Q-108 governs. NOT closed here — deliberately deferred to ' +
      'the ticket that owns the Bloomberg surface.',
  },
]

describe('I1/I2 — a declared data-state fact must have a consumer', () => {
  const producersFor = (key: string) =>
    files.filter((f) => emits(f.source, key) && f.path !== 'lib/data/freshness.ts')

  it.each(DATA_STATE_FACTS)('the scan actually finds producers of $key', ({ key }) => {
    // Reachability first. A zero producer count would make every assertion in
    // this block pass while saying nothing — the failure mode this repo has now
    // hit in six packages.
    expect(producersFor(key).length).toBeGreaterThan(0)
  })

  it('finds the known producer of the options vendor delay', () => {
    // Positive control. If a refactor moves or renames this, the block must go
    // red rather than quietly dropping to zero instances.
    expect(producersFor('dataProvenance').map((f) => f.path))
      .toContain('app/api/options/[ticker]/route.ts')
  })

  it('finds the known producer of per-field attribution', () => {
    expect(producersFor('provenance').map((f) => f.path)).toContain('lib/data/mergeQuotes.ts')
  })

  it('does NOT treat every file as a producer', () => {
    // Negative control: without one, "everything emits it" also satisfies the
    // positive controls above.
    expect(producersFor('dataProvenance').length).toBeLessThan(files.length)
  })

  it.each(DATA_STATE_FACTS)('$key is read by a surface, or exempted with a reason', ({ key }) => {
    const producers = producersFor(key)
    const exemptPaths = EXEMPT.filter((e) => e.key === key).map((e) => e.producer)
    const unconsumed: string[] = []
    for (const prod of producers) {
      if (exemptPaths.includes(prod.path)) continue
      const readers = files.filter(
        (f) => f.path !== prod.path && isSurface(f.path) && new RegExp(`\\b${key}\\b`).test(f.source),
      )
      if (readers.length === 0) unconsumed.push(prod.path)
    }
    expect(unconsumed).toEqual([])
  })

  /**
   * CAUGHT BY MUTATION, NOT BY READING — and it was my own, in the file that
   * warns about it.
   *
   * The first version of this test filtered readers by
   * `!/DataFreshnessIndicator/.test(f.source)`, i.e. "does this file MENTION the
   * component anywhere". The stock page already mounts that component for the
   * chart-cache badge, so deleting the delayed badge entirely left the string
   * behind and the test stayed green. Verified: mutation M2 survived 82 passing
   * tests. That is the same "matches something near the behaviour rather than
   * the behaviour" defect the `stripComments` note at the top of this file was
   * written about, committed while extending it.
   *
   * The property is that the FACT reaches the component, so the assertion is on
   * the prop.
   */
  const rendersFact = (source: string, prop: string) =>
    new RegExp(`<DataFreshnessIndicator[^>]*\\b${prop}\\s*=`).test(source)

  it('the delay reaches the indicator as a prop, not merely the same file', () => {
    // A UI surface, not the module that DEFINES the parser — `lib/data/freshness.ts`
    // naming its own export is not a consumer, and counting it would let the
    // whole assertion pass with nothing rendered anywhere.
    const readers = files.filter(
      (f) => isSurface(f.path) && /parseDelayedMinutes/.test(f.source),
    )
    expect(readers.map((f) => f.path)).not.toEqual([])
    const silent = readers.filter((f) => !rendersFact(f.source, 'delayedMinutes')).map((f) => f.path)
    expect(silent).toEqual([])
  })

  it('the prop matcher is not vacuously true', () => {
    // Negative control for the matcher itself. Without this, a regex that never
    // matches anything would make the assertion above pass for every input —
    // which is how the version it replaced failed.
    expect(rendersFact('<DataFreshnessIndicator quoteTime={t} />', 'delayedMinutes')).toBe(false)
    expect(rendersFact('<DataFreshnessIndicator delayedMinutes={m} />', 'delayedMinutes')).toBe(true)
    expect(rendersFact('const delayedMinutes = 15 // no component here', 'delayedMinutes')).toBe(false)
  })

  it('every exemption carries a reason and an owning ticket', () => {
    for (const e of EXEMPT) {
      // `length > 60` alone was too weak: a mutation that emptied one line of a
      // multi-line concatenated reason left the rest above the bar and survived.
      // An exemption has to say what it is exempting and why it is safe today.
      expect(e.reason.length).toBeGreaterThan(120)
      expect(e.reason).toMatch(/\bQ-?\d+\b/)
      expect(e.reason.toLowerCase()).toContain('not closed here')
      expect(e.ticket).toMatch(/^Q-?\d+/)
      expect(files.map((f) => f.path)).toContain(e.producer)
    }
  })
})

describe('I1/I2 — what this block CANNOT do', () => {
  it('cannot see a route that serves vendor-delayed data and never says so', () => {
    // The delay is a fact about a vendor entitlement, not about the code. There
    // is no source property that distinguishes a route returning a real-time
    // feed from one returning a delayed feed, so a route that simply omits
    // `dataProvenance` is invisible here and always will be. The compensating
    // control is the vendor-licence register, which enumerates egress.
    const undeclared = files.filter(
      (f) => f.path.startsWith('app/api/') && !emits(f.source, 'dataProvenance'),
    )
    expect(undeclared.length).toBeGreaterThan(0)
  })

  it('cannot tell whether a rendered indicator is the right one for the surface', () => {
    // `calendar="us-equity"` on a 24/7 feed, or its absence on an equity feed,
    // both typecheck and both render. The default is the loud one on purpose
    // (see lib/data/freshness.ts), but the choice itself is unguarded.
    const equitySurfaces = files.filter((f) => /calendar="us-equity"/.test(f.source))
    expect(equitySurfaces.map((f) => f.path).sort()).toEqual([
      'app/desk/page.tsx',
      'app/sector/[slug]/page.tsx',
    ])
  })
})
