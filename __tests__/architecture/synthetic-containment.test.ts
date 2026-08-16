/**
 * Architecture guard — design invariant I3 (synthetic data containment).
 *
 * Q-088. The first version of this guard was defeated by three mutations that
 * all reintroduced the original defect while it stayed green:
 *
 *   M1  dynamic import  — `await import('@/lib/mockData')`  (regex required `from`)
 *   M2b relative path   — `from '../../../../lib/mockData'` (regex required the @ alias)
 *   M4  no import at all — fabricated headlines written inline in a page
 *
 * It also scanned only `app/api/**`, so `scripts/` was invisible — and every
 * backtest in this repo lives there, while I3 names *backtest* first.
 *
 * This version is an ALLOWLIST over every production directory: a file either
 * appears in SYNTHETIC_CONSUMERS or it must not reference the fixture module by
 * any specifier form. That is a property, not a pattern match, so it survives
 * import syntax the author never thought of.
 *
 * KNOWN LIMIT, stated rather than papered over: an import guard cannot catch
 * fabricated content authored inline in a new file (M4). The heuristic in the
 * final block narrows that gap for the specific shape — article objects with
 * publisher/source and url literals — but it is a heuristic, not a proof.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../..')

/** Every directory whose contents ship or run as production/research code. */
const SCANNED_DIRS = ['app', 'components', 'lib', 'hooks', 'scripts'] as const

/**
 * The ONLY files permitted to reference `lib/mockData`. Adding a row here is a
 * deliberate, reviewable act — which is the point.
 */
const SYNTHETIC_CONSUMERS = new Set([
  'lib/mockData.ts',
  'components/DarkPoolPanel.tsx',
  'app/stock/[ticker]/page.tsx',
  'app/sector/[slug]/page.tsx',
])

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

const allFiles = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))
const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const read = (f: string) => readFileSync(f, 'utf8')

/**
 * Source with comments removed. The house lesson from `signinEnvNames.test.tsx`
 * applies here: a comment DESCRIBING a removed pattern is not that pattern.
 * `lib/synthetic.ts` documents the inverted intersection it replaced, so a
 * naive grep matches the explanation and fails on correct code.
 */
const readCode = (f: string) =>
  readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * Any specifier form: static `from`, dynamic `import()`, `require()`, aliased
 * or relative. Applied to COMMENT-STRIPPED source — several files legitimately
 * describe the fixture module in prose (this guard's own rationale, NewsFeed's
 * history note), and prose naming a module is not an import of it.
 */
const MENTIONS_MOCKDATA = /['"][^'"]*mockData['"]|\bmockData\b/

describe('I3 — the guard itself is not vacuous', () => {
  it('scans a realistic number of production files', () => {
    // If walk() silently matched nothing, every assertion below would pass for
    // the wrong reason. An absent check is indistinguishable from a passing one.
    expect(allFiles.length).toBeGreaterThan(100)
  })

  it('actually reaches app/api routes and scripts', () => {
    expect(allFiles.some((f) => rel(f).startsWith('app/api/'))).toBe(true)
    expect(allFiles.some((f) => rel(f).startsWith('scripts/'))).toBe(true)
  })

  it('every allowlisted file exists (no stale entries hiding a gap)', () => {
    for (const f of SYNTHETIC_CONSUMERS) {
      expect(existsSync(join(ROOT, f))).toBe(true)
    }
  })
})

describe('I3 — only allowlisted files may reference the fixture module', () => {
  it('no unlisted production file references lib/mockData, by any import form', () => {
    const offenders = allFiles
      .filter((f) => !SYNTHETIC_CONSUMERS.has(rel(f)))
      .filter((f) => MENTIONS_MOCKDATA.test(readCode(f)))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('no API route references it, stated separately because routes are the live path', () => {
    const offenders = allFiles
      .filter((f) => rel(f).startsWith('app/api/') && rel(f).endsWith('route.ts'))
      .filter((f) => MENTIONS_MOCKDATA.test(readCode(f)))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('no backtest or research script references it (I3 names backtest first)', () => {
    const offenders = allFiles
      .filter((f) => rel(f).startsWith('scripts/'))
      .filter((f) => MENTIONS_MOCKDATA.test(readCode(f)))
      .map(rel)

    expect(offenders).toEqual([])
  })
})

describe('I3 — the removed synthetic paths stay removed', () => {
  const mock = () => readCode(join(ROOT, 'lib/mockData.ts'))

  it('no chart-marker generator', () => {
    expect(mock()).not.toMatch(/generateDarkPoolMarkers/)
  })

  it('no fabricated news generator or corpus', () => {
    expect(mock()).not.toMatch(/export\s+function\s+getNewsForSector/)
    expect(mock()).not.toMatch(/SECTOR_NEWS\s*[:=]/)
  })

  it('no fabricated article data attributed to real publishers', () => {
    // Field syntax, not prose: the header comment names the publishers to
    // record what was removed.
    const src = mock()
    expect(src).not.toMatch(/source:\s*['"]/)
    expect(src).not.toMatch(/url:\s*['"]https?:/)
    expect(src).not.toMatch(/title:\s*['"]/)
  })

  it('the chart API route returns no synthetic marker field', () => {
    expect(readCode(join(ROOT, 'app/api/chart/[ticker]/route.ts'))).not.toMatch(/darkPoolMarkers/)
  })

  it('NewsFeed cannot be handed a static article array', () => {
    expect(read(join(ROOT, 'components/NewsFeed.tsx'))).not.toMatch(/^\s*news\?:\s*NewsItem\[\]/m)
  })
})

describe('I3 — the brand is a wrapper, not an intersection', () => {
  const synth = () => readCode(join(ROOT, 'lib/synthetic.ts'))

  it('lives outside the fixture module so consumers do not trip the allowlist', () => {
    expect(existsSync(join(ROOT, 'lib/synthetic.ts'))).toBe(true)
  })

  it('is NOT declared as an intersection with the payload type', () => {
    // `type Synthetic<T> = T & {…}` makes Synthetic<T> a SUBTYPE of T, so
    // synthetic data flows into real-data positions freely — the exact
    // inversion that made the first attempt provide zero containment.
    expect(synth()).not.toMatch(/type\s+Synthetic<T>\s*=\s*T\s*&/)
  })

  it('exposes a wrapper carrying a real runtime marker plus its guards', () => {
    const src = synth()
    expect(src).toMatch(/__SYNTHETIC__:\s*true/)
    expect(src).toMatch(/export\s+function\s+markSynthetic/)
    expect(src).toMatch(/export\s+function\s+unwrapSynthetic/)
    expect(src).toMatch(/export\s+function\s+assertNotSynthetic/)
  })

  it('the synthetic surface unwraps by inspecting the value, not a literal flag', () => {
    const panel = readCode(join(ROOT, 'components/DarkPoolPanel.tsx'))
    expect(panel).toMatch(/unwrapSynthetic\(/)
    // The previous no-op took a hardcoded boolean and could never fire.
    expect(panel).not.toMatch(/assertSyntheticAccepted\(\s*true/)
  })
})

describe('I3 — fabricated article literals (heuristic, narrows the inline-authoring gap)', () => {
  it('NO production file defines article-shaped literals — allowlist does not apply here', () => {
    // Targets M4: fabricated headlines authored inline with no mockData import.
    //
    // SYNTHETIC_CONSUMERS is deliberately NOT consulted. That allowlist governs
    // which files may IMPORT the fixture module; it must not also excuse them
    // from fabricating content in place. Conflating the two let M4 through on
    // the first attempt, because the page it was planted in happened to be an
    // allowlisted mockData consumer.
    //
    // Requires BOTH a substantial title/headline literal AND a capitalised
    // source/publisher literal in the same file — a shape ordinary UI copy
    // does not have.
    const hasTitle = /\b(title|headline):\s*['"][^'"]{15,}['"]/
    const hasAttribution = /\b(source|publisher):\s*['"][A-Z][^'"]{2,}['"]/

    const offenders = allFiles
      .filter((f) => {
        const src = readCode(f)
        return hasTitle.test(src) && hasAttribution.test(src)
      })
      .map(rel)

    expect(offenders).toEqual([])
  })
})
