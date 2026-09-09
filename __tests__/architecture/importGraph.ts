/**
 * Q107-S9 — the I8 egress detector is per-file and TEXTUAL, so it cannot see a
 * public surface that reaches a vendor through an import.
 *
 * `detectEgress` answers "does this repository reach a vendor?" It does not
 * answer "which surfaces expose that vendor to an end user?", and I8's trigger
 * condition is the second question: *"Before any feature exposes vendor data to
 * end users, confirm the licence permits it and record the finding."*
 *
 * Measured before this file existed: `app/api/prices/route.ts`,
 * `app/api/fundamentals/[ticker]/route.ts`, `app/api/bloomberg-bridge/health/route.ts`
 * and `app/api/trading-agents/health/route.ts` contain **no host literal, no
 * host-bearing env read and no dependency**. Every detector kind was blind to all
 * four. Three of them are in the register only because a human typed the routes
 * into a prose finding, and the fourth —
 * `app/api/trading-agents/health/route.ts`, which fetches an operator origin at
 * `:41` — appeared in **no register row's evidence across all 93 rows**. A new
 * route importing `bridgeClient` and serving Bloomberg on a new public surface
 * shipped green.
 *
 * ## This is the SEVENTH instance of the same defect, not a new kind
 *
 * The guard was correct and never visited the thing it governed. The previous six
 * were an unvisited fixture directory, an unvisited top-level directory, an
 * unvisited file extension, an unvisited language, a producer set defined in terms
 * of the property under test, and a positive control that exercised the decider
 * rather than the visitor. Here the walker visited every file and the *edges
 * between them* were never traversed. **When a guard is green, ask what it
 * visited before you ask what it decided.**
 *
 * ## The resolver is imported, not re-implemented
 *
 * `resolveSpecifier`, `extractSpecifiers` and `parseClause` live in
 * `syntheticContainment.ts` and were hardened across three adversarial rounds
 * against aliases, multi-hop re-exports, namespace and default laundering,
 * non-literal dynamic specifiers, and an extension allowlist that silently
 * dropped `.json`. Writing a second resolver here would re-open every one of
 * those escapes, and CLAUDE.md's one-home rule exists for exactly this. It is
 * imported instead — the layering points from the newer guard to the older one,
 * which is the direction that leaves the hardened file untouched.
 *
 * ## Pure function over a virtual file set
 *
 * No `fs`, like its two neighbours, so every escape anyone thinks of becomes an
 * executable test case rather than a paragraph in a review document.
 */
import {
  extractSpecifiers,
  parseClause,
  resolveSpecifier,
  type VirtualFile,
} from './syntheticContainment'
import type { EgressPoint, SourceFile } from './vendorEgress'

/**
 * A file the Next.js runtime invokes in response to an end-user request.
 *
 * Deliberately broader than `app/api/**`. `hooks/useBtcCandles.ts` reaches
 * CoinGecko **browser-direct** and is not in an API route at all — it is imported
 * by a component imported by a page, so the page is the surface that exposes it.
 * Restricting this to API routes would have been blind to every client-side
 * vendor call, which is the half of the platform I8's audit named first.
 *
 * `layout.tsx` is included because a root layout renders on every request, and
 * `middleware.ts` because it runs before all of them.
 */
export const PUBLIC_SURFACE =
  /^(middleware\.(?:ts|js)|app\/(?:.*\/)?(?:route|page|layout)\.(?:tsx?|jsx?))$/

/**
 * Egress kinds that are attributable to a FILE, and therefore to whatever imports
 * that file.
 *
 * `npm-package` is attributed separately, from bare import specifiers, because
 * `detectEgress` records its `where` as `package.json#<block>` — the manifest, not
 * a source file. Leaving packages out would have left **Yahoo** untracked, and
 * Yahoo is both the largest vendor surface in the repository and the one whose
 * unrecorded exposure (PR #147) is the reason I8's process half was rated
 * VIOLATED. It resolves to 17 public surfaces.
 *
 * `pip-package` and `published-data` are absent because this graph structurally
 * cannot see them: Python modules are not reachable through TypeScript import
 * specifiers, and a workflow that republishes data is not imported by anything.
 * That blindness is asserted as a test rather than assumed.
 */
const FILE_BORNE: ReadonlySet<string> = new Set(['http-host', 'dynamic-host', 'env-host'])

/** `kind|id`, matching `distinctIds` so a surface list keys the same as a register row. */
export type EgressKey = string

/**
 * Forward import edges, VALUE ONLY.
 *
 * A type-only import is erased by the compiler and reaches nothing at runtime, so
 * it must not create an edge: `lib/data/mergeQuotes.ts:1` imports
 * `BloombergQuoteNormalized` from the bridge client as a type, and counting that
 * would attribute a live Bloomberg exposure to every surface that merges quotes —
 * a false exposure claim in the one artifact whose purpose is an auditable trail.
 *
 * The filter is `typeOnly` and nothing more. `import { type A, foo }` and a
 * default import both stay edges; an import whose braces contain only inline
 * `type` members is also kept, because distinguishing it costs precision in the
 * UNSAFE direction. An edge too many over-records an exposure; an edge too few is
 * a blind spot, and this file exists because of a blind spot.
 */
export function buildImportGraph(files: readonly SourceFile[]): Map<string, Set<string>> {
  const byPath = new Map<string, VirtualFile>(files.map((f) => [f.path, f]))
  const edges = new Map<string, Set<string>>()
  for (const file of files) {
    const targets = new Set<string>()
    for (const spec of extractSpecifiers(file.source)) {
      if (spec.raw === null) continue // non-literal specifier: unresolvable by construction
      if (parseClause(spec.clause).typeOnly) continue
      const target = resolveSpecifier(file.path, spec.raw, byPath)
      if (target !== null) targets.add(target)
    }
    edges.set(file.path, targets)
  }
  return edges
}

/** The package a bare specifier belongs to: `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('/')) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Which public surfaces reach each recorded egress point.
 *
 * The package set is derived from `points` rather than re-read from the manifest,
 * so the two can never disagree about what counts as a vendor package.
 *
 * Returns sorted paths, and omits any egress point no surface reaches — an empty
 * list and an absent key must not be confused, because the register rule keys on
 * exactly that difference.
 */
export function attributeSurfaces(
  files: readonly SourceFile[],
  points: readonly EgressPoint[],
): Map<EgressKey, string[]> {
  const edges = buildImportGraph(files)

  const perFile = new Map<string, Set<EgressKey>>()
  const add = (file: string, key: EgressKey) => {
    const bucket = perFile.get(file)
    if (bucket) bucket.add(key)
    else perFile.set(file, new Set([key]))
  }

  const packages = new Set<string>()
  for (const p of points) {
    if (p.kind === 'npm-package') packages.add(p.id)
    if (!FILE_BORNE.has(p.kind)) continue
    // `where` is `path:line` or `path:line:col`; repo paths carry no colon.
    add(p.where.split(':')[0], `${p.kind}|${p.id}`)
  }

  for (const file of files) {
    for (const spec of extractSpecifiers(file.source)) {
      if (spec.raw === null) continue
      if (parseClause(spec.clause).typeOnly) continue
      const pkg = packageOf(spec.raw)
      if (pkg !== null && packages.has(pkg)) add(file.path, `npm-package|${pkg}`)
    }
  }

  const bySurface = new Map<EgressKey, Set<string>>()
  for (const file of files) {
    if (!PUBLIC_SURFACE.test(file.path)) continue
    for (const key of reachable(file.path, edges, perFile)) {
      const bucket = bySurface.get(key)
      if (bucket) bucket.add(file.path)
      else bySurface.set(key, new Set([file.path]))
    }
  }

  return new Map([...bySurface].map(([k, v]) => [k, [...v].sort()]))
}

/**
 * Every egress point reachable from `start` through value imports, transitively.
 *
 * Iterative with a visited set: the module graph has cycles, and a recursive walk
 * would not survive one. One hop is not enough — `app/stock/[ticker]/page.tsx`
 * reaches `TRADING_AGENTS_BASE` through a component and a hook, and the ledger
 * row that proposed "a one-hop import-edge pass" would have missed it.
 */
function reachable(
  start: string,
  edges: ReadonlyMap<string, Set<string>>,
  perFile: ReadonlyMap<string, Set<EgressKey>>,
): Set<EgressKey> {
  const seen = new Set<string>([start])
  const stack = [start]
  const found = new Set<EgressKey>()
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const key of perFile.get(current) ?? []) found.add(key)
    for (const next of edges.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return found
}
