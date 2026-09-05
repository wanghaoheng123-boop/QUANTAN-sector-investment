/**
 * I2 — which API routes can serve a STORED copy in place of a live fetch.
 *
 * This exists because the guard it feeds had the defect this repo keeps
 * hitting, in its sixth shape. `cache-flag-consumed.test.ts` defined its
 * producer set as:
 *
 *     files.filter(f => f.path.startsWith('app/api/') && /_cached:\s*true/)
 *
 * — "routes that already set the flag". A route that serves a stored value and
 * does NOT set the flag is invisible to that set BY CONSTRUCTION, so the exact
 * violation the guard exists to catch is the one input it cannot see. The rule
 * was right, the per-producer loop was right, and the universe it looped over
 * was defined by the property under test. Measured 2026-09-05: six routes serve
 * a stored copy; three set the flag; three did not, and the suite was green.
 *
 * So: detect the SUBSTITUTION structurally, then assert the flag separately.
 *
 * The evidence a substitution leaves in a route's source is a module-level
 * MUTABLE STORE that is (a) declared at top level, (b) written, and (c)
 * referenced inside the first argument of a `NextResponse.json(...)` call —
 * directly, through a spread, or through a local bound to it. All three forms
 * occur in this repo and two of them were missed by the first draft of this
 * detector, which is why the positive controls in the test are not decoration.
 *
 * Pure functions over a virtual file set, so every claim about the detector —
 * including its limits — is an executable test rather than a paragraph.
 */

export interface SourceFile {
  path: string
  /** Comment-stripped source. Comments describing the behaviour are not the behaviour. */
  source: string
}

export interface CacheProducer {
  path: string
  /** Module-level mutable stores found in the file. */
  stores: string[]
  /** Locals bound to a store (`const cached = _cache.get(k)`). */
  aliases: string[]
  /** The binding names actually referenced inside a `NextResponse.json(...)` argument. */
  servedVia: string[]
  /** Whether the route marks such a response `_cached: true`. */
  declaresFlag: boolean
}

/**
 * A module-level mutable store: `let x = null`, `let x: T | null = null`,
 * `const m = new Map<...>()`. Anchored to column 0 — a store declared inside a
 * handler is per-request and cannot outlive it, so it cannot substitute.
 */
const STORE_DECL =
  /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:null|new\s+(?:Map|WeakMap)\s*(?:<[\s\S]*?>)?\s*\()/gm

/**
 * The first argument of a call, by brace/paren balance rather than by regex.
 * `openIdx` points at the `(`. Formatting-independent, so a payload split over
 * five lines reads the same as one on a single line — the line-bounded matcher
 * in an earlier package of this project was defeated by exactly that.
 */
export function firstArgument(src: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    } else if (c === ',' && depth === 1) return src.slice(openIdx + 1, i)
  }
  return ''
}

/**
 * True when `name` is referenced as a VALUE in `expr` — not as a property of
 * something else. `...store` counts (the spread's dots are not a member access);
 * `other.store` does not. Missing the spread form is what hid two of this
 * repo's three compliant routes from the first draft.
 */
export function referencesBinding(expr: string, name: string): boolean {
  const esc = name.replace(/[$]/g, '\\$')
  return new RegExp(`(?:^|\\.\\.\\.|[^.\\w$])${esc}\\b`).test(expr)
}

/** Routes that can return a stored value. */
export function findCacheProducers(files: SourceFile[]): CacheProducer[] {
  const out: CacheProducer[] = []

  for (const f of files) {
    if (!f.path.startsWith('app/api/') || !/\/route\.tsx?$/.test(f.path)) continue

    const stores: string[] = []
    for (const m of f.source.matchAll(STORE_DECL)) stores.push(m[1])
    if (stores.length === 0) continue

    // A store that is never written cannot hold a previous response.
    const written = stores.filter((s) => {
      const esc = s.replace(/[$]/g, '\\$')
      return new RegExp(`(?:^|[^.=!<>\\w$])${esc}\\s*=[^=]|${esc}\\.set\\s*\\(`, 'm').test(f.source)
    })
    if (written.length === 0) continue

    const aliases: string[] = []
    for (const s of written) {
      const esc = s.replace(/[$]/g, '\\$')
      const re = new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${esc}\\b`, 'g')
      for (const m of f.source.matchAll(re)) aliases.push(m[1])
    }

    const names = [...new Set([...written, ...aliases])]
    const servedVia = new Set<string>()
    const call = /NextResponse\.json\s*\(/g
    let m: RegExpExecArray | null
    while ((m = call.exec(f.source)) !== null) {
      const arg = firstArgument(f.source, m.index + m[0].length - 1)
      for (const n of names) if (referencesBinding(arg, n)) servedVia.add(n)
    }
    if (servedVia.size === 0) continue

    out.push({
      path: f.path,
      stores: written,
      aliases,
      servedVia: [...servedVia],
      declaresFlag: /_cached:\s*true/.test(f.source),
    })
  }

  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Producers that substitute a stored value with nothing in the payload saying so. */
export const silentProducers = (files: SourceFile[]): string[] =>
  findCacheProducers(files)
    .filter((p) => !p.declaresFlag)
    .map((p) => p.path)
