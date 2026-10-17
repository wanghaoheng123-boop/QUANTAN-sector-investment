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
 * Entry points are what a RUNTIME loads by convention, not a directory: the
 * files Next.js itself routes (`NEXT_ENTRY` — page, layout, route, …), root
 * config files the toolchain loads (`next.config.js` requires
 * `lib/pwa/precache.js`), and scripts a package.json script or a workflow
 * names by path — the caller supplies those.
 *
 * Red-team D1 (2026-10-17): the first version used `PUBLIC_SURFACE`, which
 * matches EVERY file under `app/`, so `app/briefs/BriefCard.tsx` could lose its
 * last importer and stay green. Only Next's special files are entry points;
 * every other `app/` file is governed like `components/`.
 */
import { extractSpecifiers, resolveSpecifier, stripComments, type VirtualFile } from './syntheticContainment'
import type { SourceFile } from './vendorEgress'

/**
 * The files Next.js loads by name (App Router file conventions, plus the two
 * root-level ones). Anything else under `app/` is an ordinary module that must
 * be imported to run.
 */
export const NEXT_ENTRY =
  /^app\/(?:.+\/)?(?:page|layout|template|loading|error|global-error|not-found|forbidden|unauthorized|route|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:tsx?|jsx?)$|^(?:middleware|instrumentation)\.(?:tsx?|jsx?)$/

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
    // Red-team D4: comments masked first, so a commented-out import does not
    // keep a dead module alive.
    for (const spec of extractSpecifiers(stripComments(file.source))) {
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
  // Red-team D2: a governed module a workflow merely NAMES is not thereby run.
  // stryker-weekly.yml names four lib/quant files as mutation targets, which
  // exempted them; being mutated is not being executed. Only scripts and root
  // files can be entry points by being named.
  const named = new Set(scriptEntries.filter((p) => !GOVERNED.test(p)))
  const entries = paths.filter((p) => NEXT_ENTRY.test(p) || ROOT_CONFIG.test(p) || named.has(p))
  const live = reach(edges, entries)
  const withTests = reach(edges, [...entries, ...paths.filter(isTestFile)])
  const governed = paths.filter((p) => GOVERNED.test(p) && !isTestFile(p) && !NEXT_ENTRY.test(p))
  return {
    unreachable: governed.filter((p) => !withTests.has(p)).sort(),
    testOnly: governed.filter((p) => withTests.has(p) && !live.has(p)).sort(),
    entries: entries.sort(),
  }
}
