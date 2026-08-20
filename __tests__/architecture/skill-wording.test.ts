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

const ROOT = join(__dirname, '../..')
const UI_DIRS = ['app', 'components'] as const
/**
 * User-visible copy is not confined to `app/` and `components/`. The worst
 * violation found by this guard was a glossary TOOLTIP in `lib/` telling users
 * "Positive alpha = strategy adds value beyond beta exposure" — a skill claim
 * the platform's own numbers reject, in a file no UI-directory scan would reach.
 * Scanning only the obvious directories is the reachability defect again.
 */
const UI_COPY_FILES = ['lib/metricGlossary.ts'] as const

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const files = [
  ...UI_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...UI_COPY_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
].map((f) => ({
  path: rel(f),
  // Comments are stripped: several of these files now EXPLAIN why the word was
  // removed, and prose describing a banned pattern is not that pattern.
  source: readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'),
}))

/** Skill words, matched only inside a string literal or JSX text node. */
const BANNED = /\b(alpha|outperformance|outperforms?)\b/i

describe('I5 — the skill-wording ban is reachable', () => {
  it('scans a realistic number of UI files', () => {
    // Q-098's lesson: a guard whose scan is empty passes for the wrong reason.
    expect(files.length).toBeGreaterThan(30)
  })

  it('reaches the glossary, where user copy lives outside the UI directories', () => {
    expect(files.some((x) => x.path === 'lib/metricGlossary.ts')).toBe(true)
  })

  it('reaches the four files that violated the ban on landing', () => {
    for (const f of [
      'components/backtest/KeyMetricsStrip.tsx',
      'components/backtest/WalkForwardPanel.tsx',
      'components/backtest/InstrumentTable.tsx',
      'components/backtest/AnalysisTab.tsx',
    ]) {
      expect(files.some((x) => x.path === f)).toBe(true)
    }
  })

  it('detects the banned word when it IS present (positive control)', () => {
    // Without this, a broken matcher would look identical to a clean tree.
    expect(BANNED.test(`label="Alpha vs B&H"`)).toBe(true)
    expect(BANNED.test(`<div>Strategy Alpha</div>`)).toBe(true)
    expect(BANNED.test(`label="Excess vs B&H"`)).toBe(false)
  })
})

describe('I5 — no user-visible copy asserts skill', () => {
  it('no string literal or JSX text uses a skill word', () => {
    const offenders: string[] = []
    for (const f of files) {
      const strings = [
        ...(f.source.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) ?? []),
        // JSX text between tags, e.g. <div>Strategy Alpha</div>
        ...(f.source.match(/>[^<>{}]{2,80}</g) ?? []),
      ]
      if (strings.some((s) => BANNED.test(s))) offenders.push(f.path)
    }
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
