/**
 * I5 — user-visible copy must not assert skill the measurement does not support.
 *
 * CLAUDE.md I5 bans "skill / edge / alpha / outperformance" from user-visible
 * claims, because the platform's own numbers do not support them: the excess
 * over an equal-weight hold of the same universe is t ~ 0.17 against a bar of
 * 3.0, and PBO is unimplemented, so I5 is unmet by construction.
 *
 * That ban was VIOLATED ON LANDING by four labels calling the raw
 * return-difference "Alpha" (Q-103). A ban stated only in prose is a ban that
 * comes back the next time someone needs a column header, so it is executable
 * here.
 *
 * NO EXEMPTION LIST, deliberately. During development this guard flagged
 * `metricKey: 'alpha'` and the glossary key `alpha:`. Both were internal
 * identifiers and the tempting fix was a carve-out; they were RENAMED instead,
 * so the matcher needs no special cases. An exemption list is how a ban rots —
 * the next violation arrives as a new entry rather than a failure.
 *
 * SCOPE, stated so nobody reads it wider than it is: this governs user-visible
 * STRINGS. It deliberately does not police internal identifiers — `portfolio.alpha`
 * and `edgeOverBaseRatePp` are quantities, and renaming them would churn a CI
 * gate without changing a claim.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import { renderedPhrases } from './sourceText'

const ROOT = join(__dirname, '../..')

/**
 * Scan every source directory, not a hand-picked list of UI folders.
 *
 * The first version scanned `app/**.tsx` + `components/**.tsx` + one named
 * glossary file, and it was GREEN while three live "Alpha" surfaces remained.
 */
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'] as const
/**
 * Static pages are product surface too. `public/launcher.html` is SERVED at
 * /launcher.html and carried "Cyan / outperform — alpha vs B&H" through the
 * whole of Q-103, because the scan looked only at TypeScript. Whether an
 * unlinked static page "counts" is exactly the judgement call that leaves a
 * guard with a hole in it — so it counts.
 */
const STATIC_DIRS = ['public'] as const

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|html)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = [...SCAN_DIRS, ...STATIC_DIRS].flatMap((d) => walk(join(ROOT, d))).map((f) => ({
  path: rel(f),
  source: stripComments(readFileSync(f, 'utf8')),
}))

/**
 * Skill words. `outperform` needs its inflections: the first version used
 * `outperforms?`, which sailed past a live "Outperforming SPY in window".
 */
const BANNED = /\b(alpha|outperform(?:s|ed|ing)?|outperformance)\b/i

// `renderedPhrases` lives in ./sourceText so other copy guards can share it
// without importing (and re-registering) this test file.

describe('I5 — the skill-wording ban is REACHABLE (the guard must visit the text)', () => {
  it('scans a realistic number of source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('spans every source directory, not a hand-picked UI list', () => {
    const dirs = new Set(files.map((f) => f.path.split('/')[0]))
    for (const d of [...SCAN_DIRS, ...STATIC_DIRS]) expect(dirs.has(d)).toBe(true)
  })

  it('reaches served static pages, not only TypeScript', () => {
    expect(files.some((f) => f.path.endsWith('.html'))).toBe(true)
  })

  it('EXTRACTS long JSX text — the sr-only captions the first version skipped', () => {
    // This is the visitor test the first version lacked. `{2,80}` meant both
    // accessible table captions were never looked at, so sighted users read
    // "Excess" while screen-reader users read "alpha".
    const long = `<caption className="sr-only">Per-instrument results: annualised return, drawdown, Sharpe, Sortino, win rate, and alpha vs buy-and-hold</caption>`
    expect(renderedPhrases(long).some((p) => BANNED.test(p))).toBe(true)
  })

  it('EXTRACTS JSX text containing an interpolation', () => {
    const interpolated = `<p className="x">Alpha (daily): {attr.alpha.toFixed(5)} · done</p>`
    expect(renderedPhrases(interpolated).some((p) => BANNED.test(p))).toBe(true)
  })

  it('EXTRACTS prose containing a semicolon', () => {
    // Punctuation-based rejection hid a live disclaimer for a whole round.
    const prose = `<p>Indicators are simplified heuristics — not tested alpha, not execution logic; always verify before trading.</p>`
    expect(renderedPhrases(prose).some((p) => BANNED.test(p))).toBe(true)
  })

  it('EXTRACTS template literals', () => {
    expect(renderedPhrases('const d = `Outperforming SPY in window (+2%).`').some((p) => BANNED.test(p))).toBe(true)
  })

  it('catches the -ing and -ed inflections the first matcher missed', () => {
    expect(BANNED.test('Outperforming SPY')).toBe(true)
    expect(BANNED.test('outperformed the benchmark')).toBe(true)
  })

  it('does NOT flag legitimate statistical identifiers', () => {
    // `alpha` is a significance level in var.ts and a regression intercept in
    // factorAttribution.ts. Renaming real statistics to satisfy a copy ban would
    // be the tail wagging the dog.
    expect(renderedPhrases("const alpha = 1 - confidenceLevel").some((p) => BANNED.test(p))).toBe(false)
    expect(renderedPhrases("Record<'alpha' | keyof FactorReturns, number>").some((p) => BANNED.test(p))).toBe(false)
  })
})

describe('I5 — no user-visible copy asserts skill', () => {
  it('no rendered phrase anywhere in app, components, lib or hooks uses a skill word', () => {
    const offenders = files
      .filter((f) => renderedPhrases(f.source).some((p) => BANNED.test(p)))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('the metric formerly labelled "Sharpe Ratio" is no longer misnamed', () => {
    // It computes annReturn / maxDD — a MAR/Calmar ratio. The file's own comment
    // said so while the label claimed otherwise.
    const src = readFileSync(join(ROOT, 'components/backtest/KeyMetricsStrip.tsx'), 'utf8')
    expect(src).not.toMatch(/label="Sharpe Ratio"/)
    expect(src).toMatch(/label="Return \/ Max DD"/)
  })

  it('a losing portfolio shows its ratio instead of an em dash', () => {
    // The `avgAnnReturn > 0` guard made the negative branch unreachable, so the
    // worst outcome rendered as "no data". Only the denominator may be guarded.
    const src = readFileSync(join(ROOT, 'components/backtest/KeyMetricsStrip.tsx'), 'utf8')
    expect(src).not.toMatch(/portfolio\.avgAnnReturn > 0 &&/)
  })
})
