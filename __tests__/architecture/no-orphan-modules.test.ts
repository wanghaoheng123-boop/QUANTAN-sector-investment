/**
 * Dead-code sweep (2026-10-16) — no product module may be unreachable, or
 * reachable only from tests, without a recorded decision.
 *
 * Measured when this guard was written: `components/SectorRotationPanel.tsx`
 * had had no importer since PR #41 (2026-06-02) yet was still edited as if it
 * rendered, and `lib/appUrl.ts` was read only by its own unit test. Both are
 * deleted. Eight research modules are reachable only from tests and are kept
 * pending an owner decision, named below with the reason.
 *
 * What this guard CANNOT see (each is a way to stay green with dead code):
 * - a module loaded through a non-literal specifier;
 * - a reference inside a STRING literal that looks like an import;
 * - a module reached only through a re-export whose names nobody imports
 *   (red-team D3 found one; the barrel was deleted, the class remains);
 * - unused exports inside a live file (Q-118's territory).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findOrphans, isTestFile } from './orphanModules'
import type { SourceFile } from './vendorEgress'

const ROOT = join(__dirname, '..', '..')
const SOURCE = /\.(?:tsx?|jsx?|mjs|cjs)$/

// TRACKED files only: next-pwa writes public/sw.js at build time, and an
// untracked file is not source.
const tracked = execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0')
  .filter((p) => SOURCE.test(p) && !p.endsWith('.d.ts') && !p.startsWith('node_modules/'))
const files: SourceFile[] = tracked.map((path) => ({ path, source: readFileSync(join(ROOT, path), 'utf8') }))

/** Files a package.json script or a workflow names by path are entry points. */
const workflowText = execSync('git ls-files -z .github/workflows', { cwd: ROOT }).toString().split('\0')
  .filter(Boolean).map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n')
const scriptText = readFileSync(join(ROOT, 'package.json'), 'utf8') + '\n' + workflowText
const scriptEntries = tracked.filter((p) => scriptText.includes(p))

/**
 * Reachable only from tests, kept on purpose. Each needs an owner decision:
 * wire it to a surface, or delete it with its tests.
 */
const TEST_ONLY_PENDING: Record<string, string> = {
  'lib/portfolio/diversification.ts': 'portfolio analytics with no portfolio input yet; /portfolio pages describe them as unwired',
  'lib/portfolio/factorAttribution.ts': 'cited by app/portfolio/factor-attribution/page.tsx as the real regression awaiting a return series',
  'lib/portfolio/greeks.ts': 'portfolio analytics with no portfolio input yet',
  'lib/portfolio/stressTest.ts': 'portfolio analytics with no portfolio input yet',
  'lib/portfolio/tracker.ts': 'portfolio analytics with no portfolio input yet',
  'lib/portfolio/var.ts': 'portfolio analytics with no portfolio input yet',
  'lib/quant/intermarket.ts': 'listed in AGENTS.md as a feature module; no surface computes it',
  // Red-team D3: was reached only through a re-export in lib/backtest/engine.ts
  // whose names no product file imported, so the guard counted it live. The
  // barrel is deleted and the tests import the module directly.
  'lib/backtest/walkForward.ts': 'embargo-0 walk-forward (CLAUDE.md I4: every invocation is in __tests__); the live OOS path is lib/optimize/gridSearch.ts',
}

const report = findOrphans(files, scriptEntries)

describe('dead-code guard: what it visited', () => {
  it('walked the real tree and found its entry points', () => {
    expect(files.length).toBeGreaterThan(300)
    expect(report.entries).toContain('app/page.tsx')
    expect(report.entries).toContain('next.config.js')
    expect(report.entries).toContain('scripts/benchmark-signals.ts')
  })

  it('follows next/dynamic imports (positive control on the real tree)', () => {
    // components/stock/QuantLabPanel.tsx is imported ONLY through dynamic(() => import(...)).
    const importers = files.filter((f) => !isTestFile(f.path) && f.source.includes("'@/components/stock/QuantLabPanel'"))
    expect(importers.map((f) => f.path)).toEqual(['app/stock/[ticker]/page.tsx'])
    expect(importers[0].source).toMatch(/dynamic\(\(\) => import\('@\/components\/stock\/QuantLabPanel'\)/)
    expect(report.unreachable).not.toContain('components/stock/QuantLabPanel.tsx')
    // testOnly excludes it, so a NON-test path reaches it: the dynamic import.
    expect(report.testOnly).not.toContain('components/stock/QuantLabPanel.tsx')
  })

  it('flags a planted orphan and a planted test-only module (positive controls)', () => {
    const planted = findOrphans([
      ...files,
      { path: 'lib/__orphan_probe.ts', source: 'export const x = 1\n' },
      { path: 'lib/__testonly_probe.ts', source: 'export const y = 2\n' },
      { path: '__tests__/__probe.test.ts', source: "import { y } from '@/lib/__testonly_probe'\n" },
    ], scriptEntries)
    expect(planted.unreachable).toContain('lib/__orphan_probe.ts')
    expect(planted.testOnly).toContain('lib/__testonly_probe.ts')
  })

  it('governs ordinary app/ modules: only Next special files are entry points (red-team D1)', () => {
    // Real tree: a component living under app/ is governed, not an entry.
    expect(report.entries).not.toContain('app/briefs/BriefCard.tsx')
    expect(report.entries).toContain('app/briefs/page.tsx')
    expect(report.entries).toContain('middleware.ts')
    const r = findOrphans([
      { path: 'app/x/page.tsx', source: 'export default function P() { return null }\n' },
      { path: 'app/x/Orphan.tsx', source: 'export const O = 1\n' },
    ], [])
    expect(r.unreachable).toEqual(['app/x/Orphan.tsx'])
  })

  it('a governed module a workflow merely names is not an entry point (red-team D2)', () => {
    // stryker-weekly.yml names lib/quant files as mutation targets.
    const r = findOrphans([
      { path: 'lib/__named.ts', source: 'export const n = 1\n' },
      { path: 'scripts/run.ts', source: 'export {}\n' },
    ], ['lib/__named.ts', 'scripts/run.ts'])
    expect(r.unreachable).toEqual(['lib/__named.ts'])
    expect(r.entries).toEqual(['scripts/run.ts'])
  })

  it('a commented-out import does not keep a dead module alive (red-team D4)', () => {
    const r = findOrphans([
      { path: 'app/page.tsx', source: "// const M = dynamic(() => import('@/lib/__dead'))\n/* import { x } from '@/lib/__dead' */\nexport default function P() { return null }\n" },
      { path: 'lib/__dead.ts', source: 'export const x = 1\n' },
    ], [])
    expect(r.unreachable).toEqual(['lib/__dead.ts'])
  })

  it('counts a type-only import as use', () => {
    const r = findOrphans([
      { path: 'app/page.tsx', source: "import type { T } from '@/lib/__types_probe'\nexport default function P() { return null }\n" },
      { path: 'lib/__types_probe.ts', source: 'export interface T { a: number }\n' },
    ], [])
    expect(r.unreachable).toEqual([])
    expect(r.testOnly).toEqual([])
  })
})

describe('dead-code guard: what it decided', () => {
  it('no product module is unreachable', () => {
    expect(report.unreachable).toEqual([])
  })

  it('no product module is reachable only from tests, except the recorded ones', () => {
    expect(report.testOnly).toEqual(Object.keys(TEST_ONLY_PENDING).sort())
  })
})
