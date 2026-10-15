/**
 * Dead-code sweep (2026-10-16) — no product module may be unreachable, or
 * reachable only from tests, without a recorded decision.
 *
 * Measured when this guard was written: `components/SectorRotationPanel.tsx`
 * had had no importer since PR #41 (2026-06-02) yet was still edited as if it
 * rendered, and `lib/appUrl.ts` was read only by its own unit test. Both are
 * deleted. Seven research modules are reachable only from tests and are kept
 * pending an owner decision, named below with the reason.
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
