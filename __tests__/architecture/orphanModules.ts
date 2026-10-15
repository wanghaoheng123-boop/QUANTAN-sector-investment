/**
 * Dead-code sweep (2026-10-16) — which source modules nothing reaches.
 *
 * Pure function over a virtual file set, like its neighbours, so the escapes
 * become executable test cases. The resolver is imported from
 * `syntheticContainment.ts` rather than re-implemented; see `importGraph.ts`
 * for why a second resolver would re-open every hardened escape.
 *
 * ONE deliberate difference from `buildImportGraph`: type-only imports COUNT
 * here. That graph answers "what can execute", and an erased type import
 * reaches nothing at runtime. This one answers "what is used", and a module
 * whose types a live file relies on is used even though no byte of it ships.
 *
 * Entry points enumerate nothing (the Q-098 lesson): everything under `app/`
 * is one (`PUBLIC_SURFACE`), as are root config files the toolchain loads
 * (`next.config.js` requires `lib/pwa/precache.js`) and any file a
 * package.json script or a workflow names by path — the caller supplies those.
 */
import { extractSpecifiers, resolveSpecifier, type VirtualFile } from './syntheticContainment'
import { PUBLIC_SURFACE } from './importGraph'
import type { SourceFile } from './vendorEgress'

/** The directories this guard governs: product source, not scripts or tests. */
export const GOVERNED = /^(?:app|components|hooks|lib)\//

/** Root-level files the toolchain loads by convention. */
export const ROOT_CONFIG = /^[^/]+\.config\.[cm]?[jt]s$|^stryker\.conf\.[cm]?js$/

export const isTestFile = (p: string): boolean =>
  /^(?:__tests__|tests|e2e)\//.test(p) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p)

/** Every resolvable import edge, type-only ones included (see the header). */
export function buildUsageGraph(files: readonly SourceFile[]): Map<string, Set<string>> {
  const byPath = new Map<string, VirtualFile>(files.map((f) => [f.path, f]))
  const edges = new Map<string, Set<string>>()
  for (const file of files) {
    const targets = new Set<string>()
    for (const spec of extractSpecifiers(file.source)) {
      if (spec.raw === null) continue
      const target = resolveSpecifier(file.path, spec.raw, byPath)
      if (target !== null) targets.add(target)
    }
    edges.set(file.path, targets)
  }
  return edges
}

function reach(edges: ReadonlyMap<string, ReadonlySet<string>>, starts: Iterable<string>): Set<string> {
  const seen = new Set<string>()
  const stack = [...starts]
  while (stack.length > 0) {
    const f = stack.pop() as string
    if (seen.has(f)) continue
    seen.add(f)
    for (const g of edges.get(f) ?? []) stack.push(g)
  }
  return seen
}

export interface OrphanReport {
  /** Governed modules nothing reaches, not even a test. */
  unreachable: string[]
  /** Governed modules only tests reach: tested, and shipped nowhere. */
  testOnly: string[]
  /** The entry set actually used, so a caller can assert it is not empty. */
  entries: string[]
}

export function findOrphans(files: readonly SourceFile[], scriptEntries: readonly string[]): OrphanReport {
  const edges = buildUsageGraph(files)
  const paths = files.map((f) => f.path)
  const entries = paths.filter((p) => PUBLIC_SURFACE.test(p) || ROOT_CONFIG.test(p) || scriptEntries.includes(p))
  const live = reach(edges, entries)
  const withTests = reach(edges, [...entries, ...paths.filter(isTestFile)])
  const governed = paths.filter((p) => GOVERNED.test(p) && !isTestFile(p) && !PUBLIC_SURFACE.test(p))
  return {
    unreachable: governed.filter((p) => !withTests.has(p)).sort(),
    testOnly: governed.filter((p) => withTests.has(p) && !live.has(p)).sort(),
    entries: entries.sort(),
  }
}
