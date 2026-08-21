/**
 * I4 — fundamentals must not reach a backtest or a signal path.
 *
 * The Q-079 audit established an AFFIRMATIVE NEGATIVE that is easy to lose:
 * fundamentals reach no backtest and no signal path today. They are UI-only
 * (`app/api/fundamentals/[ticker]/route.ts`, `lib/briefs/sectorBrief.ts`).
 *
 * That matters because fundamentals are the worst point-in-time offender the
 * platform could acquire: reported figures are RESTATED months later, so a
 * backtest consuming today's values would silently use numbers that did not
 * exist at the simulated timestamp — the exact thing I4 forbids. The audit's
 * recommendation was therefore a TRIPWIRE, not a bitemporal migration: keep the
 * negative true rather than build machinery for a problem the repo does not yet
 * have. This is that tripwire.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'
import { extractSpecifiers, resolveSpecifier, stripComments, SCANNABLE, type VirtualFile } from './syntheticContainment'

const ROOT = join(__dirname, '../..')
const IGNORED = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.git'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SCANNABLE.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')
const files: VirtualFile[] = readdirSync(ROOT)
  .filter((e) => !e.startsWith('.') && !IGNORED.has(e))
  .flatMap((e) => {
    const full = join(ROOT, e)
    return statSync(full).isDirectory() ? walk(full) : SCANNABLE.test(e) ? [full] : []
  })
  .map((f) => ({ path: rel(f), source: readFileSync(f, 'utf8') }))
const byPath = new Map(files.map((f) => [f.path, f]))

/** Paths whose output is a backtest result or a trading signal. */
const RESEARCH_PATHS = [/^lib\/backtest\//, /^lib\/quant\//, /^lib\/optimize\//, /^scripts\/benchmark/]
const isResearch = (p: string) => RESEARCH_PATHS.some((re) => re.test(p)) && !/(^|\/)__tests__\//.test(p)
const isFundamentals = (p: string) => /fundamental/i.test(p)

describe('I4 — the tripwire is reachable', () => {
  it('scans the tree and finds the research paths it governs', () => {
    // An empty scan would pass every assertion below for the wrong reason.
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((f) => isResearch(f.path))).toBe(true)
  })

  it('a fundamentals module actually exists to be imported', () => {
    // If the module were renamed away, the tripwire would go green by
    // vacuity rather than by compliance.
    expect(files.some((f) => isFundamentals(f.path))).toBe(true)
  })

  it('detects the violation when it IS present (positive control)', () => {
    const probe: VirtualFile = {
      path: 'lib/backtest/__probe.ts',
      source: `import { getFundamentals } from '@/app/api/fundamentals/[ticker]/route'`,
    }
    const spec = extractSpecifiers(stripComments(probe.source))[0]
    expect(spec.raw).toBeTruthy()
    expect(isFundamentals(resolveSpecifier(probe.path, spec.raw!, byPath) ?? '')).toBe(true)
  })
})

describe('I4 — fundamentals reach no backtest or signal path', () => {
  it('no research module imports a fundamentals module', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (!isResearch(f.path)) continue
      for (const spec of extractSpecifiers(stripComments(f.source))) {
        if (!spec.raw) continue
        const target = resolveSpecifier(f.path, spec.raw, byPath)
        if (target && isFundamentals(target)) offenders.push(`${f.path} -> ${target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('fundamentals stay UI-only, and this records where they are consumed', () => {
    // Not a constraint — a witness. If this list grows a research path, the
    // assertion above fires; if it empties entirely, someone deleted the
    // feature and this test should be revisited rather than silently passing.
    const consumers = files
      .filter((f) => !isFundamentals(f.path) && !f.path.startsWith('__tests__/'))
      .filter((f) =>
        extractSpecifiers(stripComments(f.source)).some((s) => {
          if (!s.raw) return false
          const t = resolveSpecifier(f.path, s.raw, byPath)
          return t != null && isFundamentals(t)
        }),
      )
      .map((f) => f.path)
    expect(consumers.every((p) => !isResearch(p))).toBe(true)
  })
})
