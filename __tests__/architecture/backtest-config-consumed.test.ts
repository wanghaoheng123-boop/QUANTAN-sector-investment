import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { blankNonCode } from './sourceText'

/**
 * Q-127 — `PortfolioConfig.monthlyRebalance` was declared, defaulted to false,
 * and read by nothing. A backtest config that advertises "rebalance based on
 * sector rotation monthly" tells its reader the reported results model monthly
 * rebalancing. They never did.
 *
 * That is the same defect family as `_cached` set by three routes and consumed
 * by none (I2), and the DELAYED badge declared and rendered by nobody (I1): a
 * DECLARED FACT WITH NO CONSUMER. The declaration is the claim; without a
 * reader the claim is false.
 *
 * This guards the shape rather than the single instance — the next inert knob
 * fails here instead of being discovered by a red team two months later.
 *
 * Q-105 — THIS GUARD WAS GREEN WHILE `BacktestConfig.stopLossPct` WAS INERT,
 * for two independent reasons, and either alone would have hidden it:
 *
 *   1. It parsed only the body of `PortfolioConfig`. `stopLossPct` was declared
 *      on `BacktestConfig`, which `PortfolioConfig` EXTENDS — inherited fields
 *      were never visited. Guard reachability, in the shape of an `extends`
 *      clause: the scan read one interface and the field lived in its parent.
 *   2. It counted `\bfield\s*:` as consumption, so `stopLossPct: cfg.stopLossPct`
 *      — the line that ECHOED the value into every result — was a "read". An
 *      echo into the output is how an inert knob reaches the user looking live;
 *      counting it as consumption made the guard certify the defect it exists
 *      to find.
 *
 * Both are closed: every declaration in DECLS is parsed, an `extends` naming an
 * interface outside DECLS fails, and a read is a member access with echoes
 * removed first.
 *
 * RED-TEAM ROUND 1 broke that rule two further ways, and both were the Q-105
 * defect itself:
 *   - A DISPLAY module counts as a reader. Deleting every `cfg.maxDrawdownCap`
 *     read from the engine left the guard green, because the only remaining
 *     reader was lib/backtest/strategyDescription.ts — the file that PRINTS
 *     "25% drawdown breaker". A knob nothing branches on, shown to the user,
 *     certified live. Consumption is now searched in ENGINE sources only:
 *     `lib/` and `scripts/` minus DISPLAY_MODULES, and never `app/` or
 *     `components/`.
 *   - Wrapped and assigned echoes (`field: Number(cfg.field)`,
 *     `out.field = cfg.field`) counted as reads. Both forms are now echoes.
 *
 * RED-TEAM ROUND 2 showed both round-1 fixes were narrower than claimed:
 *   - The echo rule stopped at the first comma, so `field: Math.max(0,
 *     cfg.field)`, a property split across lines, `out['field'] = cfg.field`,
 *     a trailing `// was cfg.field` comment and a string mentioning
 *     `config.field` all still counted as reads. Echo spans are now found by a
 *     balanced-bracket scan, and comments and string literals are blanked by a
 *     tokenizer before anything is matched.
 *   - DISPLAY_MODULES was a hand-picked list of two files, so the NEXT copy
 *     module to print a config value would re-arm R4. It is now DERIVED: any
 *     module a UI file (components/, or app/ outside app/api) value-imports is
 *     a display module. A module that is BOTH a UI import and a real engine
 *     reader would have its reads ignored — the LOUD direction, which fails CI.
 */

interface Decl { file: string; iface: string; defaults: string }

const DECLS: readonly Decl[] = [
  { file: 'lib/backtest/portfolioBacktest.ts', iface: 'PortfolioConfig', defaults: 'DEFAULT_PORTFOLIO_CONFIG' },
  { file: 'lib/backtest/signalTypes.ts', iface: 'BacktestConfig', defaults: 'DEFAULT_CONFIG' },
]
/** Engine roots only: a render is not a read (red-team R4). */
const ROOTS = ['lib', 'scripts']
/** Where UI files live; `app/api` is server code that CALLS the engine. */
const UI_ROOTS = ['components', 'app']
const SKIP = new Set(['node_modules', '.next', '__tests__', 'backtestData', 'claude'])

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * From `start`, the end of the expression that ends at a depth-0 `,` `;` or an
 * unmatched closer — i.e. one property value or one assignment right-hand side,
 * however many lines or nested commas it spans.
 */
function exprEnd(code: string, start: number): number {
  let depth = 0
  for (let k = start; k < code.length; k++) {
    const ch = code[k]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) return k; depth-- }
    else if (depth === 0 && (ch === ',' || ch === ';')) return k
  }
  return code.length
}

/**
 * Blank the value of every same-named echo: a property `field: <expr>` or an
 * assignment `x.field = <expr>` / `x['field'] = <expr>` whose value mentions
 * `.field`. A key preceded by `.` (a ternary branch `cfg.field : x`) is a read,
 * not a key.
 */
export function stripEchoes(code: string, field: string): string {
  const read = new RegExp(`\\.${field}\\b`)
  const heads = new RegExp(
    `(?<![.\\w$])${field}\\s*:(?!:)|(?:\\.${field}|\\[\\s*${field}\\s*\\])\\s*=(?![=>])`, 'g')
  let out = code
  for (const m of code.matchAll(heads)) {
    const from = m.index! + m[0].length
    const to = exprEnd(code, from)
    if (read.test(code.slice(from, to))) {
      out = out.slice(0, m.index!) + ' '.repeat(to - m.index!) + out.slice(to)
    }
  }
  return out
}

function interfaceBody(src: string, iface: string): string | null {
  const m = stripComments(src).match(new RegExp(`export interface ${iface}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`))
  return m ? m[1] : null
}

/** Field names declared directly on the named interface. */
export function declaredFields(src: string, iface = 'PortfolioConfig'): string[] {
  const body = interfaceBody(src, iface)
  if (body == null) return []
  return [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1])
}

/** Interfaces named in the `extends` clause of the named interface. */
export function extendsOf(src: string, iface: string): string[] {
  const m = stripComments(src).match(new RegExp(`export interface ${iface}\\s+extends\\s+([^{]+)\\{`))
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().replace(/<[\s\S]*$/, '')).filter(Boolean)
}

/**
 * A field is consumed when some source READS it as a member — `.field` — after
 * same-named echoes (`field: <expr>.field`) are deleted. An echo copies the
 * value into an output object; nothing branches on it.
 */
export function isConsumed(field: string, sources: readonly string[]): boolean {
  const read = new RegExp(`\\.${field}\\b`)
  // Blank comments and strings first; an identifier-only string survives
  // unquoted, so `out['field'] = …` reads as `out[ field ] = …`, which
  // stripEchoes recognises as an assignment echo.
  return sources.some((src) => read.test(stripEchoes(blankNonCode(src), field)))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))

/** `@/lib/...` modules value-imported (not `import type`) by the given sources. */
export function uiValueImports(uiSources: readonly string[]): Set<string> {
  const out = new Set<string>()
  const re = /^import\s+(?!type\b)((?:(?!\nimport\b)[\s\S])*?)\s+from\s+['"]@\/(lib\/[^'"]+)['"]/gm
  for (const src of uiSources) {
    for (const m of src.matchAll(re)) {
      for (const cand of [`${m[2]}.ts`, `${m[2]}.tsx`, `${m[2]}/index.ts`]) {
        if (files.includes(cand)) out.add(cand)
      }
    }
  }
  return out
}

const uiFiles = UI_ROOTS.flatMap((r) => walk(r)).filter((f) => !f.startsWith('app/api/'))
/** Modules that describe the engine to users rather than run it — derived, not listed. */
const DISPLAY_MODULES = uiValueImports(uiFiles.map((f) => readFileSync(f, 'utf8')))
const engineFiles = files.filter((f) => !DISPLAY_MODULES.has(f))
const sources = engineFiles.map((f) => readFileSync(f, 'utf8'))
const fieldsByDecl = DECLS.map((d) => ({ d, fields: declaredFields(readFileSync(d.file, 'utf8'), d.iface) }))
const allFields = fieldsByDecl.flatMap(({ fields }) => fields)

describe('Q-127 — every declared backtest config field has a consumer', () => {
  it('finds every declaration and the files that could consume it', () => {
    // Reachability. A scan that reads no fields would pass the next test
    // vacuously — the failure mode this repo keeps rediscovering.
    for (const { d, fields } of fieldsByDecl) {
      expect(fields.length, `${d.iface} in ${d.file}`).toBeGreaterThan(3)
      expect(files).toContain(d.file)
    }
    expect(files.length).toBeGreaterThan(50)
  })

  it('R4: display modules are walked but excluded — and the exclusion is live', () => {
    // Without this, dropping a path from DISPLAY_MODULES (or renaming the file)
    // would silently re-admit the copy module as a "reader".
    //
    // Named explicitly, not only looped: the first version iterated
    // DISPLAY_MODULES itself, so EMPTYING the set made the loop vacuous and the
    // test green — caught by mutation R4b.
    expect([...DISPLAY_MODULES]).toContain('lib/backtest/strategyDescription.ts')
    expect([...DISPLAY_MODULES]).toContain('lib/metricGlossary.ts')
    expect(engineFiles).not.toContain('lib/backtest/strategyDescription.ts')
    // The derivation sees UI files, and never a server route.
    expect(uiFiles.length).toBeGreaterThan(50)
    expect(uiFiles.some((f) => f.startsWith('app/api/'))).toBe(false)
    // No module that DECIDES on a config field is classified as display.
    for (const engine of ['lib/backtest/core.ts', 'lib/backtest/signals.ts', 'lib/backtest/portfolioBacktest.ts']) {
      expect(DISPLAY_MODULES.has(engine), engine).toBe(false)
    }
    for (const m of DISPLAY_MODULES) {
      expect(files, `${m} is not walked, so its exclusion proves nothing`).toContain(m)
      expect(engineFiles).not.toContain(m)
    }
    // The copy module really does mention these fields; excluding it matters.
    const copy = readFileSync('lib/backtest/strategyDescription.ts', 'utf8')
    expect(isConsumed('maxDrawdownCap', [copy])).toBe(true)
    expect(isConsumed('initialCapital', [copy])).toBe(true)
    expect(files.some((f) => f.startsWith('app/') || f.startsWith('components/'))).toBe(false)
  })

  it('Q-105: every interface a declaration EXTENDS is itself visited', () => {
    // The shape that hid stopLossPct: the field lived in the parent.
    const visited = new Set(DECLS.map((d) => d.iface))
    for (const d of DECLS) {
      for (const parent of extendsOf(readFileSync(d.file, 'utf8'), d.iface)) {
        expect(visited.has(parent), `${d.iface} extends ${parent}, which DECLS does not parse`).toBe(true)
      }
    }
  })

  it('no field is declared and then read by nobody', () => {
    const inert = allFields.filter((f) => !isConsumed(f, sources))
    expect(inert).toEqual([])
  })

  it('monthlyRebalance and stopLossPct specifically are gone, not merely unread', () => {
    // Removing the reader while leaving the knob would pass the test above
    // only if the knob were also removed. Assert the knobs themselves.
    expect(allFields).not.toContain('monthlyRebalance')
    expect(allFields).not.toContain('stopLossPct')
    for (const d of DECLS) {
      expect(stripComments(readFileSync(d.file, 'utf8'))).not.toMatch(/^\s*(monthlyRebalance|stopLossPct)\s*:/m)
    }
  })

  it('POSITIVE CONTROL: the detector can actually find an inert field', () => {
    const fake = `export interface PortfolioConfig extends BacktestConfig {
  realOne: number
  neverRead: boolean
}`
    expect(declaredFields(fake)).toEqual(['realOne', 'neverRead'])
    expect(extendsOf(fake, 'PortfolioConfig')).toEqual(['BacktestConfig'])
    // and it does not mistake a comment for a declaration
    expect(declaredFields(`export interface PortfolioConfig {
  // ghost: boolean
  realOne: number
}`)).toEqual(['realOne'])
  })

  it('POSITIVE CONTROL: an echo into the output is NOT a read (the Q-105 defect)', () => {
    const echoOnly = 'return { days, stopLossPct: cfg.stopLossPct, bnhReturn }'
    expect(isConsumed('stopLossPct', [echoOnly])).toBe(false)
    // Red-team R4: wrapped and assigned echoes.
    expect(isConsumed('stopLossPct', ['return { stopLossPct: Number(cfg.stopLossPct) }'])).toBe(false)
    expect(isConsumed('stopLossPct', ['return { stopLossPct: (cfg.stopLossPct) }'])).toBe(false)
    expect(isConsumed('stopLossPct', ['result.stopLossPct = cfg.stopLossPct'])).toBe(false)
    // A comparison is not an assignment.
    expect(isConsumed('stopLossPct', ['if (x.stopLossPct == cfg.stopLossPct) y()'])).toBe(true)
    const optionalEcho = 'return { stopLossPct: config?.stopLossPct }'
    expect(isConsumed('stopLossPct', [optionalEcho])).toBe(false)
    // An object-literal KEY is not a read either — the old rule counted this.
    expect(isConsumed('stopLossPct', ['const DEFAULTS = { stopLossPct: 0.10 }'])).toBe(false)
  })

  it('POSITIVE CONTROL: the round-2 escapes are echoes or non-code, not reads', () => {
    const inert = (src: string) => expect(isConsumed('stopLossPct', [src]), src).toBe(false)
    inert('return { stopLossPct: Math.max(0, cfg.stopLossPct), days }')   // comma inside the value
    inert('return {\n  stopLossPct:\n    cfg.stopLossPct,\n}')           // split across lines
    inert("out['stopLossPct'] = cfg.stopLossPct")                          // bracket assignment
    inert('const days = 5 // was cfg.stopLossPct')                         // trailing comment
    inert("const note = 'config.stopLossPct is retired'")                  // string literal
    inert('const note = `retired: ${"x"} cfg.stopLossPct`')               // template text
    // ...but an interpolation is code: a read inside `${…}` still counts.
    expect(isConsumed('maxDrawdownCap', ['log(`cap ${cfg.maxDrawdownCap}`)'])).toBe(true)
    // ...while a real decision in the same shapes still counts.
    expect(isConsumed('maxDrawdownCap', ['const cap = dd >= cfg.maxDrawdownCap ? 1 : 0'])).toBe(true)
    expect(isConsumed('maxDrawdownCap', ['const x = on ? cfg.maxDrawdownCap : 0.25; use(x)'])).toBe(true)
    expect(isConsumed('maxDrawdownCap', ["fetch('https://x.test/a'); if (dd > cfg.maxDrawdownCap) stop()"])).toBe(true)
  })

  it('POSITIVE CONTROL: display modules are derived from UI imports, type imports excluded', () => {
    const got = uiValueImports([
      "import { ENGINE_RULES } from '@/lib/backtest/strategyDescription'",
      "import type { BacktestResult } from '@/lib/backtest/engine'",
      "import {\n  getMetric,\n  type MetricMeta,\n} from '@/lib/metricGlossary'",
    ])
    expect([...got].sort()).toEqual(['lib/backtest/strategyDescription.ts', 'lib/metricGlossary.ts'])
  })

  it('POSITIVE CONTROL: a member read that drives a decision IS a read', () => {
    expect(isConsumed('maxDrawdownCap', ['if (dd >= cfg.maxDrawdownCap && open) close()'])).toBe(true)
    // An echo beside a real read does not hide the real read.
    expect(isConsumed('maxDrawdownCap', ['const r = { maxDrawdownCap: cfg.maxDrawdownCap }; if (dd > cfg.maxDrawdownCap) x()'])).toBe(true)
  })

  it('CANNOT DO: it matches names, not types — a same-named member elsewhere counts as a read', () => {
    // `ExitStats.stopLossPct` (fraction of exits that were stops) would have
    // satisfied this detector for `BacktestConfig.stopLossPct` had anything read
    // it as `stats.stopLossPct`. Resolving the receiver's type needs the
    // compiler, not a regex. Asserted so a green run is not read as a proof.
    expect(isConsumed('stopLossPct', ['const share = stats.stopLossPct * 100'])).toBe(true)
  })

  it('CANNOT DO: destructuring is not recognised — a LIVE field read that way looks inert', () => {
    // This direction is loud: a false "inert" fails CI and is fixed in a minute.
    expect(isConsumed('halfKelly', ['const { halfKelly } = cfg; if (halfKelly) x()'])).toBe(false)
  })

  it('CANNOT DO: it errs in the SILENT direction too — these inert uses count as reads', () => {
    // CORRECTION (red-team R4). The first version of this file said the guard
    // "errs toward calling a live field inert, which is the loud direction".
    // False: every case below is a field NOTHING branches on, scored as
    // consumed. A member read cannot be told from a decision by a regex; that
    // needs the compiler and a notion of which expressions reach control flow.
    expect(isConsumed('stopLossPct', ['return { ...r, slPct: cfg.stopLossPct }'])).toBe(true) // renamed echo
    expect(isConsumed('stopLossPct', ['console.debug(cfg.stopLossPct)'])).toBe(true)             // logged, not used
    expect(isConsumed('stopLossPct', ['const unused = cfg.stopLossPct'])).toBe(true)            // bound, never read
  })
})
