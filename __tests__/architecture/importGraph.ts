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
 * ## It is RELATED to the reachability family, and the first draft overclaimed
 *
 * That draft called this "the seventh instance of the guard-reachability defect".
 * Red-team was right that it is not the same thing, and the correction matters
 * because inflated framing is what this project's tier discipline exists to
 * punish. In the priors an EXISTING rule sat at zero reachable instances. Here
 * rules 1-7 all fire correctly on their own terms; what was missing is a
 * capability nobody built, and a hand-typed field that drifted because nothing
 * read it — closer to `_cached` and `QuoteProvenance` than to the unvisited
 * fixture directory. The shared lesson survives the correction, and is the reason
 * the block below exists: **when a guard is green, ask what it visited before you
 * ask what it decided.** Here the walker visited every file and the *edges
 * between them* were never traversed.
 *
 * ## The resolver is imported, not re-implemented — and importing it found a P0
 *
 * `resolveSpecifier`, `extractSpecifiers` and `parseClause` live in
 * `syntheticContainment.ts` and were hardened across three adversarial rounds
 * against aliases, multi-hop re-exports, namespace and default laundering,
 * non-literal dynamic specifiers, and an extension allowlist that silently
 * dropped `.json`. Writing a second resolver here would re-open every one of
 * those escapes, and CLAUDE.md's one-home rule exists for exactly this.
 *
 * **But "the hardening carries over" was false for the part this hinges on.**
 * `typeOnly` had ZERO readers before this file, and red-team broke it
 * immediately: `staticRe` anchored on any occurrence of the word `import` or
 * `export`, so a preceding `export type Row = { close: number }` swallowed the
 * next real import and returned it as type-only, dropping the edge. The same bug
 * corrupted `.named`, which switched off `importsConstructor` — **I3's only
 * surviving detector** — and that one WAS exercised. Reusing a hardened module is
 * still right; assuming its hardening covers a field nobody had ever read was
 * not. Both are fixed at the source, in `syntheticContainment.ts`.
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
 * A file the Next.js runtime can invoke in response to an end-user request.
 *
 * **This enumerates nothing, and the first version did.** It listed
 * `route|page|layout`, and red-team found five files already in the tree that it
 * missed — `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`,
 * `app/briefs/error.tsx`, `app/briefs/sector/[sector]/error.tsx`. Each is
 * convention-discovered with **no importer**, exactly like `page.tsx`, so its
 * whole import subtree was unattributed: a component under `app/briefs/error.tsx`
 * importing `yahoo-finance2` and `bridgeClient` left the suite green. Beyond
 * those there are `default`, `template`, `sitemap`, `opengraph-image`,
 * `instrumentation` and whatever convention Next.js adds next — and "there are
 * none of those right now" is the reasoning Q-098 rejected for `.json`, one level
 * up. An allowlist of filenames is the same defect as an allowlist of directories.
 *
 * So: **everything under `app/`**, plus the two root files the runtime invokes
 * outside it. Of the 53 files in `app/` today, 50 are entry points and 3 are
 * colocated components — and those three are imported by pages, so they were
 * already covered transitively. Naming them as surfaces costs at most three
 * redundant register entries and is not even wrong: a component that reaches a
 * vendor is part of the exposure path.
 *
 * Breadth is the point elsewhere too. `hooks/useBtcCandles.ts` reaches CoinGecko
 * **browser-direct** and is in no API route at all; it is imported by a component
 * imported by a page, so the page is the surface. Restricting this to
 * `app/api/**` would have been blind to every client-side vendor call, which is
 * the half of the platform I8's audit names first.
 */
export const PUBLIC_SURFACE = /^(?:app\/.+\.(?:tsx?|jsx?)|(?:middleware|instrumentation)\.(?:tsx?|jsx?))$/

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

/** The file an egress point cites. `where` is `path:line` or `path:line:col`. */
const evidenceFile = (p: EgressPoint): string => p.where.split(':')[0]

/**
 * Egress evidence whose file the walker never visited.
 *
 * Such a point attaches to a graph node with no edges, so it reaches zero
 * surfaces and rule 8 can never fire for it — a green result meaning "nothing
 * exposes this" when the truth is "we never looked". That is the seventh-defect
 * shape reappearing inside the fix for the seventh defect, so it is measured
 * rather than assumed: zero instances today, asserted by the caller.
 */
export function orphanedEvidence(
  files: readonly SourceFile[],
  points: readonly EgressPoint[],
): string[] {
  const known = new Set(files.map((f) => f.path))
  return points
    .filter((p) => FILE_BORNE.has(p.kind) && !known.has(evidenceFile(p)))
    .map((p) => p.where)
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
    add(evidenceFile(p), `${p.kind}|${p.id}`)
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
