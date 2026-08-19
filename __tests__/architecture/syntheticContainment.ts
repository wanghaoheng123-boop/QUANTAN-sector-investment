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
 *   1. it lives in a test/fixture directory, or
 *   2. it EXPORTS a binding annotated `Synthetic<…>` — i.e. it is a producer of
 *      branded synthetic values.
 *
 * Rule 2 is the load-bearing one. `lib/mockData.ts` qualifies via
 * `export function generateDarkPoolPrints(…): Synthetic<DarkPoolPrint[]>`, and
 * it still qualifies after any rename, because the brand is in the type.
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
  const code = stripComments(file.source)
  return /\bexport\b/.test(code) && /:\s*Synthetic\s*</.test(code)
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

  const staticRe = /\b(import|export)\b([\s\S]{0,400}?)\bfrom\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(staticRe)) {
    out.push({ raw: m[3], reexport: m[1] === 'export', clause: m[2] })
  }
  // bare side-effect import: `import 'x'`
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) {
    out.push({ raw: m[1], reexport: false, clause: '' })
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

const EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx']

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

export function analyse(files: readonly VirtualFile[], opts: AnalyseOptions): Violation[] {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const violations: Violation[] = []

  const synthetic = new Set(
    files.filter((f) => isSyntheticModule(f, opts.brandModule)).map((f) => f.path),
  )
  const isProduction = (p: string) =>
    opts.productionDirs.some((d) => p === d || p.startsWith(d + '/')) && !SYNTHETIC_DIR.test(p)

  for (const f of files) {
    if (!isProduction(f.path)) continue
    const code = stripComments(f.source)
    const allowed = opts.allowlist.has(f.path)
    const bareExports = bareExportedNames(code)

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
        const leaked = clauseBindings(spec.clause).filter((n) => bareExports.has(n))
        if (leaked.length > 0) {
          violations.push({
            rule: 'synthetic-reexport',
            file: f.path,
            detail: `re-exports ${leaked.join(', ')} sourced from synthetic module '${target}'`,
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
    if (f.path !== opts.brandModule && /as\s+(unknown\s+as\s+)?Synthetic\s*</.test(code)) {
      violations.push({
        rule: 'brand-cast',
        file: f.path,
        detail: 'casts a plain value into the Synthetic brand instead of using markSynthetic()',
      })
    }
  }
  return violations
}
