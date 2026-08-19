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
 *    synthetic because it lives in a fixture directory or because it EXPORTS a
 *    binding annotated `Synthetic<…>`. Rename `lib/mockData.ts` to anything at
 *    all and it is still caught, because the brand is in the type.
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
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const realFiles: VirtualFile[] = DEFAULT_OPTIONS.productionDirs
  .flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: rel(f), source: readFileSync(f, 'utf8') }))

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

  it('reaches app/api routes and scripts', () => {
    expect(realFiles.some((f) => f.path.startsWith('app/api/'))).toBe(true)
    expect(realFiles.some((f) => f.path.startsWith('scripts/'))).toBe(true)
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
    expect(isSyntheticModule(m, 'lib/synthetic.ts')).toBe(true)
    // …and still does after a rename. This is the single point the old guard failed.
    expect(isSyntheticModule({ ...m, path: 'lib/demoPrices.ts' }, 'lib/synthetic.ts')).toBe(true)
  })

  it('does not classify the brand definition itself as synthetic data', () => {
    const b = BASE.find((f) => f.path === 'lib/synthetic.ts')!
    expect(isSyntheticModule(b, 'lib/synthetic.ts')).toBe(false)
  })

  it('does not classify ordinary production code as synthetic', () => {
    const q = BASE.find((f) => f.path === 'lib/quant/relativeStrength.ts')!
    expect(isSyntheticModule(q, 'lib/synthetic.ts')).toBe(false)
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
    const chart = readFileSync(join(ROOT, 'components/KLineChart.tsx'), 'utf8')
    const hook = readFileSync(join(ROOT, 'hooks/useKLineChart.ts'), 'utf8')
    for (const src of [chart, hook]) {
      expect(src).not.toMatch(/darkPoolMarkers/)
      expect(src).not.toMatch(/newsMarkers/)
      expect(src).not.toMatch(/interface\s+DarkPoolMarker/)
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
    expect(isSyntheticModule(mock!, DEFAULT_OPTIONS.brandModule)).toBe(true)
  })

  it('removing the allowlist makes the real tree FAIL — the allowlist is load-bearing', () => {
    // If this passed with an empty allowlist, the allowlist would be decorative
    // and the whole rule vacuous.
    const v = analyse(realFiles, { ...opts, allowlist: new Set() })
    expect(v.length).toBeGreaterThan(0)
    expect(v.every((x) => x.rule === 'synthetic-import')).toBe(true)
  })
})

describe('I3 — the runtime assertion has executing instances', () => {
  it('assertNotSynthetic is called at the chart boundary and the backtest boundary', () => {
    // Q-079 found this function exported with ZERO production call sites, so
    // I3's "add a runtime assertion, not just a comment" clause had no
    // executing instance anywhere. These are the instances.
    const chart = readFileSync(join(ROOT, 'components/KLineChart.tsx'), 'utf8')
    const core = readFileSync(join(ROOT, 'lib/backtest/core.ts'), 'utf8')
    expect(chart).toMatch(/assertNotSynthetic\(\s*candles/)
    expect(core).toMatch(/assertNotSynthetic\(\s*rows/)
  })

  it('it actually throws on branded data — verified by calling it', () => {
    expect(() => assertNotSynthetic(markSynthetic([{ close: 1 }]), 'test')).toThrow(/\[I3\]/)
  })

  it('it passes real data through untouched', () => {
    expect(() => assertNotSynthetic([{ close: 1 }], 'test')).not.toThrow()
  })

  it('unwrapSynthetic inspects the value, so a rewire of real data fails closed', () => {
    // The previous assertSyntheticAccepted(true, …) took a hardcoded literal
    // and could never fire.
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

  it('cannot decide whether prose is true', () => {
    // An import guard has no view on whether a headline is accurate. The news
    // path is contained structurally instead: NewsFeed takes no static array.
    expect(true).toBe(true)
  })
})
