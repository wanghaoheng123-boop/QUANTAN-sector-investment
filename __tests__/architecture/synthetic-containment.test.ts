/**
 * I3 — no synthetic data crosses the boundary.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED AND WHY (Q-098, after the Q-079 audit)
 * ---------------------------------------------------------------------------
 * The previous version of this file matched the literal string `mockData`. That
 * made it an opt-in registry of known-bad NAMES, and the Q-079 audit put seven
 * adversarial mutations through it: SIX ESCAPED, including a one-prop
 * restoration of the exact Q-088 chart defect. Its own header claimed it tested
 * "a property rather than a pattern match" — mutation M-D (`'mock' + 'Data'`)
 * falsified that sentence directly.
 *
 * Two things are different now.
 *
 * 1. THE TEST IS A PROPERTY. `syntheticContainment.ts` decides a module is
 *    synthetic because it lives in a fixture directory, because it RESOLVES THE
 *    BRAND CONSTRUCTOR through the import graph (any alias, any number of
 *    re-export hops), or because it constructs the marker shape directly.
 *    Rename `lib/mockData.ts` to anything and it is still caught.
 *
 *    Two earlier drafts of this sentence were false, which is itself the lesson.
 *    The first matched `: Synthetic<` in the source text — defeated by letting
 *    TypeScript infer the return type. The second matched `markSynthetic(` —
 *    defeated by `import { markSynthetic as mk }`. Replacing one source-text
 *    match with another is not a property; only resolution is.
 *
 * 2. THE MUTATIONS ARE EXECUTABLE. Q-079's "6 of 7 escaped" existed only in a
 *    review document — the mutations were applied to the working tree and
 *    reverted, leaving nothing to re-run. A finding that cannot be re-run
 *    silently expires. The analyser is a pure function of a virtual file set, so
 *    each mutation below is an ordinary test case that runs on every CI run.
 *
 * The last block is the honest part: it asserts what this guard CANNOT do.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  analyse,
  isSyntheticModule,
  classifySynthetic,
  SCANNABLE,
  extractSpecifiers,
  resolveSpecifier,
  DEFAULT_OPTIONS,
  type VirtualFile,
} from './syntheticContainment'
import { markSynthetic, assertNotSynthetic, unwrapSynthetic } from '@/lib/synthetic'

const ROOT = join(__dirname, '../..')

/**
 * The ONLY files permitted to import a synthetic module. Adding a row here is a
 * deliberate, reviewable act. It grants IMPORT permission only — it never
 * exempts a file from the fabrication, re-export or cast rules.
 */
const ALLOWLIST = new Set(['app/stock/[ticker]/page.tsx', 'app/sector/[slug]/page.tsx'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SCANNABLE.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')

/**
 * The scanned set must include the FIXTURE directories, not just production.
 *
 * This is the shape of red-team finding RT-1, and it is worth stating plainly
 * because it is the subtlest failure in this file's history: if `__tests__/` is
 * absent from the set, `resolveSpecifier` cannot resolve an import that points
 * there, returns `null`, and the analyser silently skips the edge. The
 * fixture-directory rule then has ZERO reachable instances on the real tree
 * while every test still passes — because the virtual `BASE` hand-includes a
 * fixture. Green and inert, one more time.
 *
 * `isProduction()` remains the violation DOMAIN, so fixture files are resolvable
 * targets without themselves being scanned as offenders.
 */
/**
 * ENUMERATING directories is the same defect one level up, and it bit twice.
 * RT-1 was a fixture directory missing from the scan; then a bridge in `src/`
 * escaped for the identical reason — `isProduction()` had been inverted in the
 * analyser, but this walk still listed the directories it would visit, so the
 * rule was correct and unreachable. Scan everything; let `isProduction()` decide.
 */
const IGNORED_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.git'])
const realFiles: VirtualFile[] = readdirSync(ROOT)
  .filter((e) => !e.startsWith('.') && !IGNORED_DIRS.has(e))
  .flatMap((e) => {
    const full = join(ROOT, e)
    return statSync(full).isDirectory() ? walk(full) : SCANNABLE.test(e) ? [full] : []
  })
  .map((f) => {
    const path = rel(f)
    // `.json` files must be RESOLVABLE TARGETS — an unresolvable import is
    // silently dropped, and `lib/backtest/dataLoader.ts` loads the whole price
    // universe from one. But the tree holds ~14MB of JSON, so keep only the
    // marker verdict rather than the content. JSON carries no imports, so an
    // empty source loses nothing the analyser would have used.
    if (path.endsWith('.json')) {
      const hit = readFileSync(f, 'utf8').includes('__SYNTHETIC__')
      return { path, source: hit ? '"__SYNTHETIC__": true' : '' }
    }
    return { path, source: readFileSync(f, 'utf8') }
  })

const opts = { ...DEFAULT_OPTIONS, allowlist: ALLOWLIST }

// ─── a virtual repo, used to make the seven mutations executable ─────────────
const BASE: VirtualFile[] = [
  {
    path: 'lib/synthetic.ts',
    source: `
      export interface Synthetic<T> { readonly __SYNTHETIC__: true; readonly value: T }
      export function markSynthetic<T>(value: T): Synthetic<T> { return { __SYNTHETIC__: true, value } }
      export function assertNotSynthetic(v: unknown, s: string): void {}
    `,
  },
  {
    path: 'lib/mockData.ts',
    source: `
      import { markSynthetic, type Synthetic } from './synthetic'
      export function generateDarkPoolPrints(t: string): Synthetic<Print[]> { return markSynthetic([]) }
    `,
  },
  { path: 'lib/quant/relativeStrength.ts', source: `export function rs(a: number[]) { return a }` },
  { path: 'app/api/chart/[ticker]/route.ts', source: `export async function GET() { return Response.json({ candles: [] }) }` },
  { path: 'scripts/benchmark-signals.ts', source: `import { loadRows } from '../lib/backtest/dataLoader'` },
  { path: 'lib/backtest/dataLoader.ts', source: `export function loadRows() { return [] }` },
  { path: '__tests__/fixtures/candles.ts', source: `export const FIXTURE_CANDLES = [{ close: 1 }]` },
  { path: 'components/KLineChart.tsx', source: `export default function KLineChart() { return null }` },
]

/** Apply a mutation to the virtual repo: add or replace a file. */
const mutate = (...changes: VirtualFile[]): VirtualFile[] => {
  const out = BASE.map((f) => ({ ...f }))
  for (const c of changes) {
    const i = out.findIndex((f) => f.path === c.path)
    if (i >= 0) out[i] = c
    else out.push(c)
  }
  return out
}
const run = (files: VirtualFile[], allowlist = new Set<string>()) =>
  analyse(files, { ...DEFAULT_OPTIONS, allowlist })

// ────────────────────────────────────────────────────────────────────────────

describe('I3 — the guard is not vacuous', () => {
  it('scans a realistic number of production files', () => {
    // If walk() silently matched nothing, every assertion below passes for the
    // wrong reason. An absent check is indistinguishable from a passing one.
    expect(realFiles.length).toBeGreaterThan(100)
  })

  it('reaches app/api routes, scripts, fixtures and the repo root', () => {
    expect(realFiles.some((f) => f.path.startsWith('app/api/'))).toBe(true)
    expect(realFiles.some((f) => f.path.startsWith('scripts/'))).toBe(true)
    expect(realFiles.some((f) => f.path.startsWith('__tests__/'))).toBe(true)
    expect(realFiles.some((f) => f.path === 'middleware.ts')).toBe(true)
  })

  it('scans directories nobody enumerated — the walk is not an allowlist', () => {
    // A bridge in any top-level directory must be reachable. Enumerating dirs
    // left src/ and types/ invisible, which is how a two-line re-export
    // laundered the fixture module with zero violations.
    const dirs = new Set(realFiles.map((f) => f.path.split('/')[0]))
    expect(dirs.size).toBeGreaterThan(DEFAULT_OPTIONS.productionDirs.length)
  })

  it('every allowlisted file exists — no stale row hiding a gap', () => {
    for (const f of ALLOWLIST) expect(existsSync(join(ROOT, f))).toBe(true)
  })

  it('the virtual baseline is clean, so mutation failures mean the mutation', () => {
    expect(run(BASE)).toEqual([])
  })
})

describe('I3 — synthetic-ness is a PROPERTY, not a module name', () => {
  it('classifies the fixture module by its exported brand, not its name', () => {
    const m = BASE.find((f) => f.path === 'lib/mockData.ts')!
    expect(classifySynthetic(m, BASE, 'lib/synthetic.ts')).toBe(true)
    // …and still does after a rename. This is the single point the old guard failed.
    const renamed = { ...m, path: 'lib/demoPrices.ts' }
    expect(classifySynthetic(renamed, [...BASE, renamed], 'lib/synthetic.ts')).toBe(true)
  })

  it('does not classify the brand definition itself as synthetic data', () => {
    const b = BASE.find((f) => f.path === 'lib/synthetic.ts')!
    expect(classifySynthetic(b, BASE, 'lib/synthetic.ts')).toBe(false)
  })

  it('does not classify ordinary production code as synthetic', () => {
    const q = BASE.find((f) => f.path === 'lib/quant/relativeStrength.ts')!
    expect(classifySynthetic(q, BASE, 'lib/synthetic.ts')).toBe(false)
  })

  it('classifies fixture directories by path', () => {
    const fx = BASE.find((f) => f.path === '__tests__/fixtures/candles.ts')!
    expect(isSyntheticModule(fx, 'lib/synthetic.ts')).toBe(true)
  })
})

describe('I3 — the seven Q-079 mutations (six of these escaped the old guard)', () => {
  it('M-A: static import of the fixture module from a backtest script — CAUGHT before, still caught', () => {
    const v = run(
      mutate({
        path: 'scripts/benchmark-signals.ts',
        source: `import { generateDarkPoolPrints } from '../lib/mockData'\nexport const x = generateDarkPoolPrints('AAPL')`,
      }),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-import')
    expect(v[0].file).toBe('scripts/benchmark-signals.ts')
  })

  it('M-B: a NEW synthetic module under a different name, feeding a backtest', () => {
    // The old guard matched the string "mockData". This module is called
    // demoPrices and is caught anyway, because it exports the brand.
    const v = run(
      mutate(
        {
          path: 'lib/demoPrices.ts',
          source: `import { markSynthetic, type Synthetic } from './synthetic'
                   export function demoRows(): Synthetic<Row[]> { return markSynthetic([]) }`,
        },
        {
          path: 'lib/backtest/dataLoader.ts',
          source: `import { demoRows } from '../demoPrices'\nexport function loadRows() { return demoRows() }`,
        },
      ),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-import')
    expect(v.some((x) => x.file === 'lib/backtest/dataLoader.ts')).toBe(true)
  })

  it('M-C: a __tests__ fixture imported into lib/quant and re-exported', () => {
    const v = run(
      mutate({
        path: 'lib/quant/relativeStrength.ts',
        source: `import { FIXTURE_CANDLES } from '../../__tests__/fixtures/candles'
                 export { FIXTURE_CANDLES }
                 export function rs() { return FIXTURE_CANDLES }`,
      }),
    )
    const rules = v.map((x) => x.rule)
    expect(rules).toContain('synthetic-import')
    // …and the re-export is called out separately, because it launders the
    // binding to every downstream importer, none of which opted in.
    expect(rules).toContain('synthetic-reexport')
  })

  it('M-D: a COMPUTED specifier — the mutation that falsified the old header', () => {
    const v = run(
      mutate({
        path: 'app/api/chart/[ticker]/route.ts',
        source: `export async function GET() {
                   const m = await import('mock' + 'Data')
                   return Response.json(m.generateDarkPoolPrints('AAPL'))
                 }`,
      }),
    )
    expect(v.map((x) => x.rule)).toContain('opaque-specifier')
  })

  it('M-D2: re-export leak is caught even from an ALLOWLISTED file', () => {
    // The allowlist grants import permission, never permission to launder.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `export { generateDarkPoolPrints } from '@/lib/mockData'`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-reexport')
  })

  it('M-E: inline Math.random() OHLC in a live route, returned as real', () => {
    const v = run(
      mutate({
        path: 'app/api/chart/[ticker]/route.ts',
        source: `export async function GET() {
                   const candles = Array.from({ length: 250 }, () => ({ close: 100 + Math.random() * 5 }))
                   return Response.json({ candles, source: 'yahoo' })
                 }`,
      }),
    )
    expect(v.map((x) => x.rule)).toContain('inline-fabrication')
  })

  it('M-F/M-F2: the chart marker sink no longer exists to be exploited', () => {
    // M-F2 restored synthetic prints to <KLineChart darkPoolMarkers> keyed on
    // REAL candle times, needing no import path at all — so no import guard
    // could ever have caught it. Q-096 removed the props and their drawing
    // code, which makes the mutation a type error rather than a detection
    // problem. Structural beats detective.
    // Primary assertion is BEHAVIOURAL, not nominal. Asserting the absence of
    // the string `darkPoolMarkers` would be a name blocklist — the exact defect
    // this whole package exists to remove — and a sink renamed `flowMarkers`
    // would sail past it (red-team RT-4). `setMarkers` is lightweight-charts'
    // only marker-plotting API, so its absence is the property that matters.
    const noMarkerPlotting = realFiles.filter((f) => /\.setMarkers\s*\(/.test(f.source))
    expect(noMarkerPlotting.map((f) => f.path)).toEqual([])

    const chart = readFileSync(join(ROOT, 'components/KLineChart.tsx'), 'utf8')
    const hook = readFileSync(join(ROOT, 'hooks/useKLineChart.ts'), 'utf8')
    for (const src of [chart, hook]) {
      expect(src).not.toMatch(/darkPoolMarkers/)
      expect(src).not.toMatch(/newsMarkers/)
    }
  })

  it('M-G: laundering a plain value into the brand with a cast', () => {
    const v = run(
      mutate({
        path: 'lib/backtest/dataLoader.ts',
        source: `import type { Synthetic } from '../synthetic'
                 export function loadRows() { return [] as unknown as Synthetic<Row[]> }`,
      }),
    )
    expect(v.map((x) => x.rule)).toContain('brand-cast')
  })
})

describe('I3 — the three escapes red-team found (all were green before)', () => {
  it('RT-1: a real __tests__ fixture imported into lib/ is resolvable and caught', () => {
    // Previously escaped because __tests__/ was not in the scanned set, so the
    // edge resolved to null and was skipped. Asserted against the REAL file
    // set, not the virtual one — that distinction is the whole finding.
    expect(realFiles.some((f) => f.path.startsWith('__tests__/'))).toBe(true)
    const fixture = realFiles.find((f) => f.path.startsWith('__tests__/'))!
    expect(isSyntheticModule(fixture, DEFAULT_OPTIONS.brandModule)).toBe(true)

    const v = analyse(
      [...realFiles, {
        path: 'lib/quant/__probe.ts',
        source: `import { X } from '../../__tests__/architecture/syntheticContainment'\nexport const y = X`,
      }],
      opts,
    )
    expect(v.some((x) => x.file === 'lib/quant/__probe.ts')).toBe(true)
  })

  it('RT-2: a producer with an INFERRED return type is caught', () => {
    // The old rule matched the annotation text `: Synthetic<`. Dropping the
    // annotation made the module invisible and every downstream rule blind.
    const inferred: VirtualFile = {
      path: 'lib/demoPrices.ts',
      source: `import { markSynthetic } from './synthetic'
               export function demoRows() { return markSynthetic([{ close: 1 }]) }`,
    }
    expect(classifySynthetic(inferred, [...BASE, inferred], 'lib/synthetic.ts')).toBe(true)

    const v = run(
      mutate(inferred, {
        path: 'lib/backtest/dataLoader.ts',
        source: `import { demoRows } from '../demoPrices'\nexport function loadRows() { return demoRows() }`,
      }),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-import')
  })

  it('RT-2b: a CONSUMER holding a Synthetic<…> prop is not misclassified', () => {
    // The annotation rule flagged components/DarkPoolPanel.tsx, which only
    // receives branded data. Over-flagging erodes the allowlist's meaning.
    const consumer: VirtualFile = {
      path: 'components/DarkPoolPanel.tsx',
      source: `import { unwrapSynthetic, type Synthetic } from '@/lib/synthetic'
               export default function Panel(p: { prints: Synthetic<Row[]> }) {
                 return unwrapSynthetic(p.prints, 'DarkPoolPanel')
               }`,
    }
    expect(classifySynthetic(consumer, [...BASE, consumer], 'lib/synthetic.ts')).toBe(false)
  })

  it('RT-8: an ALLOWLISTED file cannot re-publish synthetic data as a derived export', () => {
    // `export const LAUNDERED = generateDarkPoolPrints('AAPL')` in an
    // allowlisted page was green. The allowlist grants import permission, never
    // permission to re-publish.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
                 export const LAUNDERED_PRINTS = generateDarkPoolPrints('AAPL')
                 export default function Page() { return null }`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-reexport')
  })

  it('RT-9: root-level modules such as middleware.ts are inside the analyser', () => {
    expect(realFiles.some((f) => f.path === 'middleware.ts')).toBe(true)
  })
})

describe('I3 — round-2 escapes: the property was still nominal', () => {
  const withBrand = (extra: VirtualFile[]) => [...BASE, ...extra]

  it('an ALIASED constructor import is caught', () => {
    const f: VirtualFile = {
      path: 'lib/demoPrices.ts',
      source: `import { markSynthetic as mk } from './synthetic'
               export function demoRows() { return mk([{ close: 1 }]) }`,
    }
    expect(classifySynthetic(f, withBrand([f]), 'lib/synthetic.ts')).toBe(true)
  })

  it('a SECOND-HOP re-export of the constructor is followed', () => {
    // `export { markSynthetic as brandIt } from './synthetic'` used to launder
    // the constructor: the downstream producer became invisible.
    const bridge: VirtualFile = {
      path: 'lib/brandKit.ts',
      source: `export { markSynthetic as brandIt } from './synthetic'`,
    }
    const producer: VirtualFile = {
      path: 'lib/demoPrices.ts',
      source: `import { brandIt } from './brandKit'
               export function demoRows() { return brandIt([{ close: 1 }]) }`,
    }
    expect(classifySynthetic(producer, withBrand([bridge, producer]), 'lib/synthetic.ts')).toBe(true)
  })

  it('an INDIRECT reference (const f = markSynthetic) is caught', () => {
    const f: VirtualFile = {
      path: 'lib/demoPrices.ts',
      source: `import { markSynthetic } from './synthetic'
               const f = markSynthetic
               export function demoRows() { return f([{ close: 1 }]) }`,
    }
    expect(classifySynthetic(f, withBrand([f]), 'lib/synthetic.ts')).toBe(true)
  })

  it('DIRECT construction of the marker shape is caught (the brand was structural)', () => {
    // `Synthetic<T>` was a plain structural interface, so this literal was a
    // valid Synthetic<T> with NO cast — falsifying "markSynthetic is the one
    // sanctioned constructor" and meaning `brand-cast` never had to fire.
    // lib/synthetic.ts is now nominal, and this is the static backstop.
    const f: VirtualFile = {
      path: 'lib/forged.ts',
      source: `export const forged = { __SYNTHETIC__: true, value: [1] }`,
    }
    expect(classifySynthetic(f, withBrand([f]), 'lib/synthetic.ts')).toBe(true)
  })

  it('the nominal brand makes that forgery a TYPE error too', () => {
    // Belt and braces: the static rule above is a backstop, not the primary
    // defence. The primary defence is that the shape can no longer be named.
    const brand = readFileSync(join(ROOT, 'lib/synthetic.ts'), 'utf8')
    expect(brand).toMatch(/declare const SYNTHETIC_TAG: unique symbol/)
    expect(brand).toMatch(/readonly \[SYNTHETIC_TAG\]: true/)
  })

  it('NAMESPACE laundering out of an allowlisted file is caught', () => {
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import * as M from '@/lib/mockData'
                 export const LAUNDERED = M.generateDarkPoolPrints('AAPL')`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-reexport')
  })

  it('DEFAULT-EXPORT laundering out of an allowlisted file is caught', () => {
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
                 const PRINTS = generateDarkPoolPrints('AAPL')
                 export default PRINTS`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-reexport')
  })

  it('a bridge in an UNSCANNED top-level directory is still production', () => {
    // `src/bridge.ts` re-exporting the fixture module used to yield zero
    // violations, because production was an ALLOWLIST OF DIRECTORIES — the same
    // defect as an allowlist of module names, one level up. Now inverted:
    // everything that is not a fixture is production.
    const v = run(
      mutate({
        path: 'src/bridge.ts',
        source: `export { generateDarkPoolPrints } from '../lib/mockData'`,
      }),
    )
    expect(v.some((x) => x.file === 'src/bridge.ts')).toBe(true)
  })
})

describe('I3 — round-3 escapes: reachability and line boundaries', () => {
  it('a MULTI-LINE derived export is caught (line-bounded matching restored the leak)', () => {
    // `export const X = { rows: gen(...) }` on ONE line was caught; the same
    // statement across three lines was not. 13 files already use that idiom and
    // no formatter pins it, so this was a reformat away from reopening.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
export const DEBUG_PRINTS = {
  rows: generateDarkPoolPrints('AAPL'),
}`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-reexport')
  })

  it('an allowlisted page may still USE synthetic data inside its component', () => {
    // The collapse must not turn the sanctioned pattern into a violation:
    // `export default function Page() { …gen()… }` is exactly what the
    // allowlist exists to permit.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
export default function Page() {
  const prints = generateDarkPoolPrints('AAPL')
  return prints
}`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v).toEqual([])
  })

  it('a .json fixture is a resolvable target, not a silently dropped edge', () => {
    const v = run(
      mutate(
        { path: 'lib/fixtures/data.json', source: '"__SYNTHETIC__": true' },
        {
          path: 'lib/backtest/dataLoader.ts',
          source: `import data from '../fixtures/data.json'\nexport const rows = data`,
        },
      ),
    )
    expect(v.map((x) => x.rule)).toContain('synthetic-import')
  })

  it('a .cjs bridge is scanned', () => {
    const v = run(
      mutate({ path: 'lib/bridge.cjs', source: `export { generateDarkPoolPrints } from './mockData'` }),
    )
    expect(v.some((x) => x.file === 'lib/bridge.cjs')).toBe(true)
  })

  it('the marker assigned by property, not by literal key, is caught', () => {
    const f: VirtualFile = {
      path: 'lib/sneaky.ts',
      source: `export function make(rows: unknown[]) { const o: any = { value: rows }; o.__SYNTHETIC__ = true; return o }`,
    }
    expect(classifySynthetic(f, [...BASE, f], 'lib/synthetic.ts')).toBe(true)
  })

  it('the constructor obtained by DYNAMIC import destructuring is caught', () => {
    const f: VirtualFile = {
      path: 'lib/demoPrices.ts',
      source: `export async function demoRows() {
                 const { markSynthetic } = await import('./synthetic')
                 return markSynthetic([{ close: 1 }])
               }`,
    }
    expect(classifySynthetic(f, [...BASE, f], 'lib/synthetic.ts')).toBe(true)
  })

  it('the scan covers every extension the resolver can resolve', () => {
    // Reachability, again: an extension the walk skips is an edge the resolver
    // drops silently. This asserts the two sets cannot drift apart.
    expect(SCANNABLE.test('x.json')).toBe(true)
    expect(SCANNABLE.test('x.cjs')).toBe(true)
    expect(realFiles.some((f) => f.path.endsWith('.json'))).toBe(true)
  })
})

describe('I3 — specifier resolution actually resolves', () => {
  const byPath = new Map(BASE.map((f) => [f.path, f]))

  it('resolves the @/ alias', () => {
    expect(resolveSpecifier('app/x/page.tsx', '@/lib/mockData', byPath)).toBe('lib/mockData.ts')
  })

  it('resolves relative specifiers, including ..', () => {
    expect(resolveSpecifier('lib/mockData.ts', './synthetic', byPath)).toBe('lib/synthetic.ts')
    expect(resolveSpecifier('scripts/benchmark-signals.ts', '../lib/mockData', byPath)).toBe('lib/mockData.ts')
  })

  it('treats bare specifiers as external, not as unresolved errors', () => {
    expect(resolveSpecifier('lib/x.ts', 'react', byPath)).toBeNull()
  })

  it('flags a non-literal dynamic specifier as unresolvable', () => {
    const specs = extractSpecifiers(`const m = await import('mock' + 'Data')`)
    expect(specs.some((s) => s.raw === null)).toBe(true)
  })

  it('does not flag an ordinary literal dynamic import', () => {
    const specs = extractSpecifiers(`const c = await import('lightweight-charts')`)
    expect(specs.every((s) => s.raw !== null)).toBe(true)
  })
})

describe('I3 — the real repository is contained', () => {
  it('reports zero violations across app, components, lib, hooks and scripts', () => {
    expect(analyse(realFiles, opts)).toEqual([])
  })

  it('the fixture module is still detected as synthetic in the real tree', () => {
    // Guards against the analyser passing because it found NOTHING synthetic.
    const mock = realFiles.find((f) => f.path === 'lib/mockData.ts')
    expect(mock).toBeDefined()
    expect(classifySynthetic(mock!, realFiles, DEFAULT_OPTIONS.brandModule)).toBe(true)
  })

  it('removing the allowlist makes the real tree FAIL — the allowlist is load-bearing', () => {
    // If this passed with an empty allowlist, the allowlist would be decorative
    // and the whole rule vacuous.
    const v = analyse(realFiles, { ...opts, allowlist: new Set() })
    expect(v.length).toBeGreaterThan(0)
    expect(v.every((x) => x.rule === 'synthetic-import')).toBe(true)
  })
})

describe('I3 — the runtime assertion has a FIRABLE executing instance', () => {
  it('guards the JSON boundary, where the type system has stopped protecting us', () => {
    // Red-team RT-3: the assertions inside KLineChart and backtestInstrument sit
    // behind parameters typed `Candle[]` / `OhlcvRow[]`, and `Synthetic<T>` is
    // deliberately NOT assignable to `T`. tsc therefore prevents a branded value
    // from ever reaching them — which makes those two call sites unfirable by
    // construction. That is Q-088's `assert(true, …)` one remove out, and it is
    // exactly the shape this project keeps shipping.
    //
    // `r.json()` returns `any`. THAT is where a marker can actually arrive, so
    // that is where the guard has to be.
    for (const page of ['app/stock/[ticker]/page.tsx', 'app/sector/[slug]/page.tsx']) {
      const src = readFileSync(join(ROOT, page), 'utf8')
      expect(src).toMatch(/assertNotSynthetic\(data\?*\.?c?a?n?d?l?e?s?,/)
    }
  })

  it('the marker SURVIVES a JSON round-trip, so the boundary guard can fire', () => {
    // The whole argument for guarding at the parse boundary rests on this: if
    // the marker did not survive serialisation there would be nothing to catch.
    const overWire = JSON.parse(JSON.stringify(markSynthetic([{ close: 1 }])))
    expect(overWire.__SYNTHETIC__).toBe(true)
    expect(() => assertNotSynthetic(overWire, 'chart API response')).toThrow(/\[I3\]/)
  })

  it('it throws on branded data and passes real data through', () => {
    expect(() => assertNotSynthetic(markSynthetic([{ close: 1 }]), 'test')).toThrow(/\[I3\]/)
    expect(() => assertNotSynthetic([{ close: 1 }], 'test')).not.toThrow()
  })

  it('the defence-in-depth sites exist, but are NOT claimed to be firable', () => {
    // Kept deliberately: they cost nothing and would catch a future rewire that
    // widens those parameter types. Recorded here as belt-and-braces so the
    // ledger does not again claim more than the evidence supports.
    expect(readFileSync(join(ROOT, 'components/KLineChart.tsx'), 'utf8')).toMatch(
      /assertNotSynthetic\(\s*candles/,
    )
    expect(readFileSync(join(ROOT, 'lib/backtest/core.ts'), 'utf8')).toMatch(
      /assertNotSynthetic\(\s*rows/,
    )
  })

  it('unwrapSynthetic inspects the value, so a rewire of real data fails closed', () => {
    expect(() => unwrapSynthetic([{ close: 1 }] as never, 'test')).toThrow(/\[I3\]/)
    expect(unwrapSynthetic(markSynthetic([7]), 'test')).toEqual([7])
  })
})

describe('I3 — the removed synthetic paths stay removed', () => {
  const readCode = (f: string) =>
    readFileSync(join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('no chart-marker generator', () => {
    expect(readCode('lib/mockData.ts')).not.toMatch(/generateDarkPoolMarkers/)
  })

  it('no fabricated news generator or corpus', () => {
    expect(readCode('lib/mockData.ts')).not.toMatch(/export\s+function\s+getNewsForSector/)
    expect(readCode('lib/mockData.ts')).not.toMatch(/SECTOR_NEWS\s*[:=]/)
  })

  it('no fabricated article data attributed to real publishers', () => {
    const src = readCode('lib/mockData.ts')
    expect(src).not.toMatch(/source:\s*['"]/)
    expect(src).not.toMatch(/url:\s*['"]https?:/)
    expect(src).not.toMatch(/title:\s*['"]/)
  })

  it('the chart API route returns no synthetic marker field', () => {
    expect(readCode('app/api/chart/[ticker]/route.ts')).not.toMatch(/darkPoolMarkers/)
  })

  it('NewsFeed cannot be handed a static article array', () => {
    expect(readFileSync(join(ROOT, 'components/NewsFeed.tsx'), 'utf8')).not.toMatch(
      /^\s*news\?:\s*NewsItem\[\]/m,
    )
  })
})

describe('I3 — the brand is a wrapper, not an intersection', () => {
  const synth = readFileSync(join(ROOT, 'lib/synthetic.ts'), 'utf8')

  it('is NOT declared as an intersection with the payload type', () => {
    // `type Synthetic<T> = T & {…}` makes Synthetic<T> a SUBTYPE of T, so
    // synthetic data flows into real-data positions freely — the exact
    // inversion that made the first attempt provide zero containment.
    expect(synth.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/type\s+Synthetic<T>\s*=\s*T\s*&/)
  })

  it('exposes a wrapper carrying a real runtime marker plus its guards', () => {
    expect(synth).toMatch(/__SYNTHETIC__:\s*true/)
    for (const fn of ['markSynthetic', 'unwrapSynthetic', 'assertNotSynthetic', 'isSynthetic']) {
      expect(synth).toMatch(new RegExp(`export function ${fn}`))
    }
  })
})

describe('I3 — what this guard CANNOT do (stated, not papered over)', () => {
  it('does not catch an unbranded fabricator that avoids the heuristics', () => {
    // Honest limit. A module that returns fabricated rows WITHOUT the brand and
    // without Math.random is invisible to static analysis. The runtime
    // assertions above are the second layer precisely because of this; the
    // structural removal in Q-096 is the third. Recorded so the next reader
    // does not mistake a green run for a proof.
    const v = run(
      mutate({
        path: 'lib/backtest/dataLoader.ts',
        source: `export function loadRows() { return [{ close: 101.5 }, { close: 102.5 }] }`,
      }),
    )
    expect(v).toEqual([])
  })

  it('does not track a synthetic value returned from deep inside a function body', () => {
    // `exportedLeaks` is statement-scoped. A value constructed and returned from
    // several lines inside an exported function is not followed — that needs
    // real data-flow analysis, not regex. The runtime assertion at the JSON
    // boundary is the layer that covers this.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
                 export function getPrints() {
                   const t = 'AAPL'
                   return generateDarkPoolPrints(t)
                 }`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).not.toContain('synthetic-reexport')
  })

  it('does not guard the non-chart r.json() sites on the stock page', () => {
    // Named by red-team: quote / fundamentals / news responses are parsed
    // without an assertNotSynthetic. Out of scope for Q-098 and recorded so it
    // is not mistaken for coverage. → Q-101 territory.
    const src = readFileSync(join(ROOT, 'app/stock/[ticker]/page.tsx'), 'utf8')
    const jsonSites = (src.match(/\.json\(\)/g) ?? []).length
    const guards = (src.match(/assertNotSynthetic\(/g) ?? []).length
    expect(jsonSites).toBeGreaterThan(guards)
  })

  it('does not follow an alias chain of three or more links', () => {
    // Taint propagation runs two passes. a -> b -> c escapes. Realistic enough
    // to name; the runtime assertion is the layer that covers it.
    const v = run(
      mutate({
        path: 'app/stock/[ticker]/page.tsx',
        source: `import { generateDarkPoolPrints } from '@/lib/mockData'
const a = generateDarkPoolPrints('AAPL')
const b = a
const c = b
export default c`,
      }),
      new Set(['app/stock/[ticker]/page.tsx']),
    )
    expect(v.map((x) => x.rule)).not.toContain('synthetic-reexport')
  })

  it('does not catch a cast laundered through an any-typed intermediate', () => {
    // `brand-cast` matches `as Synthetic<…>` and `as never`. A value routed
    // through `any` reaches a brand-typed slot with no cast to match. The
    // nominal tag makes honest forgery a type error; this is the dishonest
    // route, and it is a backstop gap, not a proof.
    const v = run(
      mutate({
        path: 'lib/backtest/dataLoader.ts',
        source: `import type { Synthetic } from '../synthetic'
const loose: any = { __MARK: true }
export const rows: Synthetic<number[]> = loose`,
      }),
    )
    expect(v.map((x) => x.rule)).not.toContain('brand-cast')
  })

  it('the runtime backstop covers FOUR sites, not every boundary', () => {
    // Scope stated so the assertions are not read as blanket coverage. Nothing
    // in lib/quant, lib/data or app/api asserts; a runtime-branded value
    // produced and consumed entirely inside those trees is unguarded.
    const guarded = realFiles.filter(
      (f) =>
        /assertNotSynthetic\s*\(/.test(f.source) &&
        !f.path.startsWith('__tests__/') &&
        f.path !== DEFAULT_OPTIONS.brandModule, // defines it; not a call site
    )
    const paths = guarded.map((f) => f.path).sort()
    expect(paths).toEqual([
      'app/sector/[slug]/page.tsx',
      'app/stock/[ticker]/page.tsx',
      'components/KLineChart.tsx',
      'lib/backtest/core.ts',
    ])
    expect(paths.some((p) => p.startsWith('lib/quant/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('app/api/'))).toBe(false)
  })

  it('cannot decide whether prose is true', () => {
    // An import guard has no view on whether a headline is accurate. The news
    // path is contained structurally instead: NewsFeed takes no static array.
    expect(true).toBe(true)
  })
})
