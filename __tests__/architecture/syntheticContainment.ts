/**
 * I3 containment analyser — a PURE function over a virtual file set.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT INLINE TEST CODE
 * ---------------------------------------------------------------------------
 * The Q-079 audit found the previous guard caught 1 of 7 adversarial mutations.
 * That result lived only in a review document: the mutations were applied to the
 * working tree and reverted, leaving nothing executable. A finding that cannot
 * be re-run is a finding that silently expires.
 *
 * Making the analyser a pure function of `VirtualFile[]` turns every mutation
 * into an ordinary test case: build a small in-memory repo, apply the mutation,
 * assert the analyser reports a violation. No files are written, nothing is
 * reverted, and the seven escapes are re-checked on every CI run.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SYNTHETIC TEST IS A PROPERTY, NOT A NAME
 * ---------------------------------------------------------------------------
 * The previous guard asked "does this file mention the string `mockData`?".
 * That is an opt-in registry of known-bad NAMES: renaming the fixture module,
 * or authoring a new one, walked straight through (mutation M-B). Its own header
 * claimed it tested "a property rather than a pattern match"; mutation M-D
 * (`'mock' + 'Data'`) falsified that sentence.
 *
 * A module is synthetic here because of what it IS:
 *   1. it lives in a test/fixture directory,
 *   2. it IMPORTS THE BRAND CONSTRUCTOR — tracked through aliases
 *      (`markSynthetic as mk`) and through re-export hops
 *      (`export { markSynthetic as brandIt } from './synthetic'`), or
 *   3. it constructs the marker shape directly (`__SYNTHETIC__: true`).
 *
 * Rule 2 is the load-bearing one, and it keys on the CONSTRUCTOR rather than on
 * a type annotation. An earlier draft of this file matched `: Synthetic<…>` in
 * the source text; red-team broke it in one line by letting TypeScript INFER the
 * return type (`export function demoRows() { return markSynthetic([]) }`), which
 * is the same false-header shape Q-079 struck at the old guard. Annotation text
 * is not the type.
 *
 * Round 2 of review broke the text-match version too: `/\bmarkSynthetic\s*\(/`
 * missed `import { markSynthetic as mk }`, a second-hop re-export, and
 * `const f = markSynthetic; f(...)`. Replacing one source-text match with
 * another source-text match is not a property. Rule 2 now RESOLVES the
 * constructor through the import graph, so the local name is irrelevant.
 *
 * Rule 3 exists because the same review showed the brand was STRUCTURAL:
 * `{ __SYNTHETIC__: true, value }` satisfied `Synthetic<T>` with no cast, so
 * `markSynthetic()` was never the only constructor and `brand-cast` never had to
 * fire. `lib/synthetic.ts` is now nominal (an unnameable `unique symbol`), which
 * makes that forgery a type error — rule 3 is the static backstop for it.
 *
 * None of this misclassifies a CONSUMER that merely holds a `Synthetic<…>` prop
 * or calls `assertNotSynthetic` (`components/DarkPoolPanel.tsx`,
 * `components/KLineChart.tsx`, `lib/backtest/core.ts`): importing a guard is not
 * importing the constructor.
 *
 * RESIDUAL LIMITS, stated rather than papered over:
 *  - A producer that returns raw fabricated values without the brand is invisible
 *    to rule 2. That is what `inline-fabrication` and `article-literal` narrow,
 *    and they are heuristics, not proofs.
 *  - This is static analysis over specifiers. It cannot decide whether prose is
 *    true, and it does not execute anything.
 */

export type Rule =
  | 'synthetic-import'
  | 'synthetic-reexport'
  | 'opaque-specifier'
  | 'inline-fabrication'
  | 'article-literal'
  | 'brand-cast'

export interface VirtualFile {
  /** Repo-relative, forward-slashed, e.g. `lib/mockData.ts`. */
  path: string
  source: string
}

export interface Violation {
  rule: Rule
  file: string
  detail: string
}

export interface AnalyseOptions {
  /**
   * Files permitted to import a synthetic module. Adding a row is a deliberate,
   * reviewable act — which is the point. It grants IMPORT permission only; it
   * never exempts a file from the fabrication or re-export rules.
   */
  allowlist: ReadonlySet<string>
  /** Directories whose contents ship or run as production/research code. */
  productionDirs: readonly string[]
  /** Paths where fabricated values would reach a chart, signal, or backtest. */
  liveDataPaths: readonly RegExp[]
  /** The brand's own definition module, which is machinery, not synthetic data. */
  brandModule: string
}

export const DEFAULT_OPTIONS: Omit<AnalyseOptions, 'allowlist'> = {
  productionDirs: ['app', 'components', 'lib', 'hooks', 'scripts'],
  liveDataPaths: [/^app\/api\//, /^lib\/data\//, /^lib\/backtest\//, /^lib\/quant\//, /^scripts\//],
  brandModule: 'lib/synthetic.ts',
}

const SYNTHETIC_DIR = /(^|\/)(__tests__|tests|__fixtures__|__mocks__)\//

/**
 * Comments stripped. The house lesson from `signinEnvNames.test.tsx`: a comment
 * DESCRIBING a pattern is not that pattern. `lib/synthetic.ts` documents the
 * inverted intersection it replaced, and several files narrate the Q-088
 * removals in prose, so a naive scan matches the explanation and fails on
 * correct code.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** A module is synthetic because of what it is, not what it is called. */
export function isSyntheticModule(file: VirtualFile, brandModule: string): boolean {
  if (SYNTHETIC_DIR.test(file.path)) return true
  if (file.path === brandModule) return false // defines the brand; is not branded data
  // Rule 3: the marker key ANYWHERE outside the brand module. A colon match
  // missed `o.__SYNTHETIC__ = true`, `o['__SYNTHETIC__'] = true` and the JSON
  // key form — all of which yield runtime-branded values. Presence is the
  // property; the position is not.
  return /__SYNTHETIC__/.test(stripComments(file.source))
}

/**
 * Modules that re-publish the brand CONSTRUCTOR, and the names they publish it
 * under. Seeded with the brand module, then closed over re-export hops, so
 * `export { markSynthetic as brandIt } from './synthetic'` makes the bridge a
 * provider of `brandIt`. Without this, one re-export hop laundered the
 * constructor and every producer downstream became invisible.
 */
export function brandProviders(
  files: readonly VirtualFile[],
  brandModule: string,
): Map<string, Set<string>> {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const providers = new Map<string, Set<string>>([[brandModule, new Set(['markSynthetic'])]])
  for (let pass = 0; pass < 10; pass++) {
    let changed = false
    for (const f of files) {
      const code = stripComments(f.source)
      for (const m of code.matchAll(/\bexport\b([\s\S]{0,800}?)\bfrom\s*['"]([^'"]+)['"]/g)) {
        const target = resolveSpecifier(f.path, m[2], byPath)
        if (target === null) continue
        const src = providers.get(target)
        if (!src) continue
        const cur = providers.get(f.path) ?? new Set<string>()
        const before = cur.size
        if (/\*/.test(m[1]) && !/\{/.test(m[1])) for (const n of src) cur.add(n)
        for (const n of parseClause(m[1]).named) if (src.has(n.exported)) cur.add(n.local)
        if (cur.size > before) {
          providers.set(f.path, cur)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return providers
}

/**
 * Does this module obtain the brand constructor, under ANY local name and via
 * any number of re-export hops? This is rule 2, and it is why the local name is
 * irrelevant: `markSynthetic as mk`, `const f = markSynthetic`, and a second-hop
 * `brandIt` all resolve to the same exported binding. Importing a GUARD
 * (`assertNotSynthetic`, `unwrapSynthetic`) is not importing the constructor, so
 * consumers are not swept up.
 */
export function importsConstructor(
  file: VirtualFile,
  byPath: ReadonlyMap<string, VirtualFile>,
  providers: ReadonlyMap<string, Set<string>>,
): boolean {
  const code = stripComments(file.source)
  for (const spec of extractSpecifiers(code)) {
    if (spec.raw === null) continue
    const target = resolveSpecifier(file.path, spec.raw, byPath)
    if (target === null) continue
    const names = providers.get(target)
    if (!names) continue
    const parsed = parseClause(spec.clause)
    if (parsed.named.some((n) => names.has(n.exported))) return true
    if (parsed.namespaceAs) {
      const ns = parsed.namespaceAs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${ns}\\s*\\.\\s*(?:${[...names].join('|')})\\b`).test(code)) return true
    }
  }
  return false
}

interface Specifier {
  raw: string | null // null ⇒ not statically resolvable
  reexport: boolean
  /** Text of the import clause, e.g. `{ a, b as c }` — used to trace re-exports. */
  clause: string
}

/** Every specifier form: static import/export-from, dynamic import(), require(). */
export function extractSpecifiers(code: string): Specifier[] {
  const out: Specifier[] = []

  const staticRe = /\b(import|export)\b([\s\S]{0,800}?)\bfrom\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(staticRe)) {
    out.push({ raw: m[3], reexport: m[1] === 'export', clause: m[2] })
  }
  // bare side-effect import: `import 'x'`
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    out.push({ raw: m[1], reexport: false, clause: '' })
  }
  // `const { markSynthetic } = await import('./synthetic')` — the destructuring
  // sits OUTSIDE the import() call, so the clause was empty and constructor
  // resolution saw no names.
  for (const m of code.matchAll(
    /(?:const|let|var)\s*(\{[^}]*\})\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    out.push({ raw: m[2], reexport: false, clause: m[1] })
  }
  // dynamic import()/require() — a non-literal argument is UNRESOLVABLE, which
  // is itself the finding (mutation M-D concatenated the specifier at runtime).
  for (const m of code.matchAll(/\b(?:import|require)\s*\(([^)]*)\)/g)) {
    const arg = m[1].trim()
    if (arg === '') continue
    const literal = /^(['"])([^'"]*)\1$/.exec(arg) ?? /^`([^`$]*)`$/.exec(arg)
    if (literal) out.push({ raw: literal[2] ?? literal[1], reexport: false, clause: '' })
    else out.push({ raw: null, reexport: false, clause: '' })
  }
  return out
}

/**
 * Every extension that can carry a module OR data. `.json` matters
 * specifically: `lib/backtest/dataLoader.ts` loads the entire backtest price
 * universe from one, and an unresolvable target is SILENTLY DROPPED — the same
 * silent-skip that made rule 1 unreachable in round 1.
 */
const CODE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx', '.json'] as const
export const SCANNABLE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|json)$/
const EXTS = ['', ...CODE_EXTS, '/index.ts', '/index.tsx', '/index.js']

/** Resolve `@/…` and relative specifiers against the virtual file set. */
export function resolveSpecifier(
  fromPath: string,
  spec: string,
  byPath: ReadonlyMap<string, VirtualFile>,
): string | null {
  let base: string
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) {
    const dir = fromPath.split('/').slice(0, -1)
    const parts = spec.split('/')
    for (const p of parts) {
      if (p === '.') continue
      else if (p === '..') dir.pop()
      else dir.push(p)
    }
    base = dir.join('/')
  } else return null // bare specifier ⇒ external package

  for (const ext of EXTS) if (byPath.has(base + ext)) return base + ext
  return null
}

/** `{ a, b as c }` → [{exported:'a',local:'a'},{exported:'b',local:'c'}]; `* as M` → namespace. */
export function parseClause(clause: string): {
  named: { exported: string; local: string }[]
  namespaceAs: string | null
  typeOnly: boolean
} {
  const typeOnly = /^\s*type\s/.test(clause)
  const ns = /\*\s+as\s+(\w+)/.exec(clause)
  const named: { exported: string; local: string }[] = []
  const braced = /\{([^}]*)\}/.exec(clause)
  if (braced) {
    for (const part of braced[1].split(',')) {
      const t = part.trim()
      if (!t || /^type\s/.test(t)) continue
      const as = /^(\w+)\s+as\s+(\w+)$/.exec(t)
      if (as) named.push({ exported: as[1], local: as[2] })
      else named.push({ exported: t, local: t })
    }
  }
  return { named, namespaceAs: ns ? ns[1] : null, typeOnly }
}

/** Local binding names introduced by an import clause, e.g. `{ a, b as c }` → [a, c]. */
export function clauseBindings(clause: string): string[] {
  const names: string[] = []
  const braced = /\{([^}]*)\}/.exec(clause)
  if (braced) {
    for (const part of braced[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '')
      if (!t) continue
      const as = /\bas\s+(\w+)$/.exec(t)
      names.push(as ? as[1] : t.split(/\s+/)[0])
    }
  }
  const def = /^\s*(\w+)\s*(?:,|$)/.exec(clause.replace(/\{[^}]*\}/, ''))
  if (def && def[1] && def[1] !== 'type') names.push(def[1])
  return names.filter(Boolean)
}

/**
 * Exports that leak a synthetic binding out of the module's public surface.
 *
 * Covers the bare `export { B }` re-export AND the derived form
 * `export const X = B(...)`, which red-team used to walk synthetic prints
 * straight out of an ALLOWLISTED page. The allowlist grants permission to
 * IMPORT, never permission to re-publish.
 *
 * RESIDUAL, named rather than implied: a value returned from deep inside an
 * exported function body is not tracked — that needs real data-flow analysis,
 * not regex. The runtime assertions are the layer for that.
 */
/**
 * Join lines while brackets are unbalanced, so a multi-line statement becomes
 * one line. Leak detection matched `([^\n]*)`, so simply reformatting
 * `export const X = { rows: gen(...) }` across three lines defeated it — and 13
 * files already use that idiom with no formatter pinning it. Declarations
 * (`export default function`, `export function/class`) are deliberately NOT
 * treated as value exports downstream: a component that USES synthetic data
 * internally is the sanctioned allowlisted pattern; exporting the VALUE is not.
 */
export function collapseStatements(code: string): string {
  const out: string[] = []
  let buf = ''
  let depth = 0
  for (const line of code.split('\n')) {
    buf = buf ? `${buf} ${line.trim()}` : line
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
    }
    if (depth <= 0) {
      out.push(buf)
      buf = ''
      depth = 0
    }
  }
  if (buf) out.push(buf)
  return out.join('\n')
}

export function exportedLeaks(rawCode: string, bindings: readonly string[]): string[] {
  const code = collapseStatements(rawCode)
  const leaks = new Set<string>()
  if (bindings.length === 0) return []
  const esc = (b: string) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Taint propagation through local intermediates. `const PRINTS = gen(...)`
  // followed by `export default PRINTS` laundered the value with neither
  // statement naming both sides — so matching the imported binding alone missed
  // it. Two passes cover a short alias chain; chains of three or more escape,
  // and that residual IS asserted in the containment test's "what this guard
  // CANNOT do" block. (An earlier version of this comment claimed the same and
  // the block did not contain it — a false cross-reference, which is the sin
  // this package exists to remove. Check the block before editing this line.)
  const tainted = new Set(bindings)
  for (let pass = 0; pass < 2; pass++) {
    const cur = new RegExp(`\\b(?:${[...tainted].map(esc).join('|')})\\b`)
    for (const m of code.matchAll(/\b(?:const|let|var)\s+(\w+)[^=\n]*=\s*([^\n]*)/g)) {
      if (cur.test(m[2])) tainted.add(m[1])
    }
  }
  const refs = new RegExp(`\\b(?:${[...tainted].map(esc).join('|')})\\b`)
  const bare = bareExportedNames(code)
  for (const b of tainted) if (bare.has(b)) leaks.add(b)
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+(\w+)[^=\n]*=\s*([^\n]*)/g)) {
    if (refs.test(m[2])) leaks.add(m[1])
  }
  // `export default <expr>` — round 2 walked prints out this way. Excludes
  // declarations: `export default function Page() { … }` legitimately USES
  // synthetic data inside an allowlisted page; that is the sanctioned pattern.
  for (const m of code.matchAll(/\bexport\s+default\s+(?!(?:async\s+)?function\b|class\b)([^\n]*)/g)) {
    if (refs.test(m[1])) leaks.add('default')
  }
  return [...leaks]
}

/** Names re-exported by a bare `export { … }` clause (no `from`). */
export function bareExportedNames(code: string): Set<string> {
  const out = new Set<string>()
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}\s*(?!\s*from)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '')
      if (t) out.add(t.split(/\s+/)[0])
    }
  }
  return out
}

/**
 * Full classification: the three rules together, resolved against a file set.
 * `isSyntheticModule` alone answers only rules 1 and 3 — it cannot see rule 2,
 * which needs the import graph. Use this when asking "is this module synthetic".
 */
export function classifySynthetic(
  file: VirtualFile,
  files: readonly VirtualFile[],
  brandModule: string,
): boolean {
  if (isSyntheticModule(file, brandModule)) return true
  if (file.path === brandModule) return false
  const byPath = new Map(files.map((f) => [f.path, f]))
  if (!byPath.has(file.path)) byPath.set(file.path, file)
  return importsConstructor(file, byPath, brandProviders([...byPath.values()], brandModule))
}

export function analyse(files: readonly VirtualFile[], opts: AnalyseOptions): Violation[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const violations: Violation[] = []

  const providers = brandProviders(files, opts.brandModule)
  const synthetic = new Set(
    files
      .filter(
        (f) =>
          isSyntheticModule(f, opts.brandModule) ||
          (f.path !== opts.brandModule && importsConstructor(f, byPath, providers)),
      )
      .map((f) => f.path),
  )
  // INVERTED deliberately: everything that is not a fixture is production.
  // Enumerating production directories left `src/`, `types/` and any new
  // top-level directory outside the analyser, where a two-line re-export bridge
  // laundered the fixture module with zero violations reported. An allowlist of
  // directories has the same defect as an allowlist of module names.
  const isProduction = (p: string) => !SYNTHETIC_DIR.test(p) && SCANNABLE.test(p)

  for (const f of files) {
    if (!isProduction(f.path)) continue
    const code = stripComments(f.source)
    const allowed = opts.allowlist.has(f.path)

    for (const spec of extractSpecifiers(code)) {
      if (spec.raw === null) {
        violations.push({
          rule: 'opaque-specifier',
          file: f.path,
          detail:
            'dynamic import/require with a non-literal specifier — it cannot be ' +
            'statically resolved, so containment cannot be proven for this edge',
        })
        continue
      }
      const target = resolveSpecifier(f.path, spec.raw, byPath)
      if (target === null || !synthetic.has(target)) continue

      // Re-export leaks containment even from an allowlisted file: it hands the
      // synthetic binding to every downstream importer, none of which opted in.
      if (spec.reexport) {
        violations.push({
          rule: 'synthetic-reexport',
          file: f.path,
          detail: `re-exports from synthetic module '${target}', laundering it to every importer`,
        })
      } else {
        // Two-step launder: import a binding from a synthetic module, then
        // re-export it by name with a bare `export { … }`. There is no `from`
        // clause to match, so a specifier-only rule never sees it — this is the
        // shape mutation M-C used.
        const parsed = parseClause(spec.clause)
        const bindings = [
          ...parsed.named.map((n) => n.local),
          ...(parsed.namespaceAs ? [parsed.namespaceAs] : []),
        ]
        const leaked = exportedLeaks(code, bindings)
        if (leaked.length > 0) {
          violations.push({
            rule: 'synthetic-reexport',
            file: f.path,
            detail: `exports ${leaked.join(', ')}, derived from synthetic module '${target}' — the allowlist grants import permission, not permission to re-publish`,
          })
        }
        if (!allowed) {
          violations.push({
            rule: 'synthetic-import',
            file: f.path,
            detail: `imports synthetic module '${target}' without being on the allowlist`,
          })
        }
      }
    }

    // Fabrication in a path that feeds a chart, signal or backtest. The
    // allowlist deliberately does NOT apply: it governs which files may IMPORT
    // the fixture module, and must not also excuse them from fabricating in
    // place. Conflating the two is what let M4 through during Q-088.
    if (opts.liveDataPaths.some((re) => re.test(f.path)) && /\bMath\s*\.\s*random\s*\(/.test(code)) {
      violations.push({
        rule: 'inline-fabrication',
        file: f.path,
        detail: 'Math.random() in a live data path — values reaching a chart, signal or backtest must be measured, not generated',
      })
    }

    // Fabricated article literals: a substantial title/headline AND a
    // capitalised source/publisher in the same file — a shape ordinary UI copy
    // does not have. Heuristic, and the allowlist does not apply here either.
    if (
      /\b(title|headline):\s*['"][^'"]{15,}['"]/.test(code) &&
      /\b(source|publisher):\s*['"][A-Z][^'"]{2,}['"]/.test(code)
    ) {
      violations.push({
        rule: 'article-literal',
        file: f.path,
        detail: 'defines article-shaped literals (long title + capitalised publisher)',
      })
    }

    // The wrapper makes honest construction impossible outside markSynthetic(),
    // which makes a cast the natural bypass.
    // `as never` and `as unknown as Synthetic<…>` are both routes into a
    // brand-typed slot. An `any`-typed intermediate needs no cast at all and is
    // named as a residual rather than pretended away.
    if (
      f.path !== opts.brandModule &&
      /\bSynthetic\s*</.test(code) &&
      /\bas\s+(?:unknown\s+as\s+)?(?:Synthetic\s*<|never\b)/.test(code)
    ) {
      violations.push({
        rule: 'brand-cast',
        file: f.path,
        detail: 'casts a plain value into the Synthetic brand instead of using markSynthetic()',
      })
    }
  }
  return violations
}
