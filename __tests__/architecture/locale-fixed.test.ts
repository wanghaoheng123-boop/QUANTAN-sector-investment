/**
 * Red-team H1 (2026-10-17) — every number and date formats in ONE locale, and
 * every viewer-zone time renders through <LocalTime>.
 *
 * A bare `toLocaleString()` formats in the locale of whatever process runs it.
 * `/portfolio` server-renders `TailRiskBanner`, which printed
 * `portfolioVegaUsd.toLocaleString()`: "-600,000" from the en-US server, then
 * "-600.000" in a German browser at hydration — React #418, the class Q-142
 * fixed for time zones.
 *
 * ROUND 2 (R2-243-1): the first version was a regex for the EMPTY argument
 * list, so `toLocaleString(undefined, { maximumFractionDigits: 0 })` — H1 again,
 * on the same component — passed it, as did `Intl.NumberFormat()` without
 * `new`, `([], …)`, `'default'`, `?.()`, `.call(n)` and `localeCompare`. It is
 * now an ALLOWLIST over the parsed source: every locale-sensitive call must
 * name its locale as a string literal or `UI_LOCALE`, and anything else —
 * including a locale-sensitive method that is referenced rather than called —
 * fails.
 *
 * ROUND 2 (R2-243-2): `formatLocalTime` / `formatLocalDateTime` format in the
 * viewer's ZONE, which is the same #418 class on any server-rendered path. They
 * may be called only inside `components/LocalTime.tsx` (which renders "—" until
 * mounted) or as the argument of a `set…` state setter (which runs in an effect
 * or an event handler, never during render).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

const LOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toLocaleUpperCase', 'toLocaleLowerCase'])
const INTL_CTORS = new Set(['NumberFormat', 'DateTimeFormat', 'Collator', 'ListFormat', 'PluralRules', 'RelativeTimeFormat', 'Segmenter', 'DisplayNames'])
const VIEWER_ZONE_HELPERS = new Set(['formatLocalTime', 'formatLocalDateTime'])
const LOCAL_TIME_HOME = 'components/LocalTime.tsx'

/** A locale argument this guard accepts: a named, non-default literal, or UI_LOCALE. */
function isFixedLocale(arg: ts.Expression | undefined): boolean {
  if (!arg) return false
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text !== '' && arg.text.toLowerCase() !== 'default'
  }
  return ts.isIdentifier(arg) && arg.text === 'UI_LOCALE'
}

/** The call whose callee is `node` (through optional chaining), if any. */
function callOf(node: ts.Node): ts.CallExpression | ts.NewExpression | null {
  const p = node.parent
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === node) return p
  return null
}

export function localeOffenders(path: string, source: string): string[] {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const at = (n: ts.Node) => `${path}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text
      if (LOCALE_METHODS.has(name)) {
        const call = callOf(node)
        if (!call || !isFixedLocale(call.arguments?.[0])) out.push(`${at(node)} ${node.getText(sf)}`)
      } else if (name === 'localeCompare') {
        const call = callOf(node)
        if (!call || !isFixedLocale(call.arguments?.[1])) out.push(`${at(node)} ${node.getText(sf)}`)
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'Intl' && INTL_CTORS.has(name)) {
        const call = callOf(node)
        if (!call || !isFixedLocale(call.arguments?.[0])) out.push(`${at(node)} Intl.${name}`)
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && VIEWER_ZONE_HELPERS.has(node.expression.text) && path !== LOCAL_TIME_HOME) {
      const p = node.parent
      const inSetter = ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^set[A-Z]/.test(p.expression.text)
      if (!inSetter) out.push(`${at(node)} ${node.expression.text}(…) outside <LocalTime> or a state setter`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const files = execSync('git ls-files -z app components hooks lib', { cwd: ROOT }).toString().split('\0')
  .filter((p) => /\.(?:tsx?|jsx?|mjs)$/.test(p) && !p.endsWith('.d.ts') && p !== 'lib/format.ts')
const offenders = files.flatMap((p) => localeOffenders(p, readFileSync(join(ROOT, p), 'utf8')))

describe('UI formatting uses a fixed locale, and viewer-zone times render after mount', () => {
  it('visited the product tree, including the components that failed', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('components/risk/TailRiskBanner.tsx')
    expect(files).toContain('lib/portfolio/tailRiskAlerts.ts')
    expect(files).toContain(LOCAL_TIME_HOME)
  })

  it('flags every viewer-locale spelling the red-team found (positive controls)', () => {
    const bad = [
      'n.toLocaleString()',
      'n.toLocaleString(undefined, { maximumFractionDigits: 0 })', // H1, written back by R2-243-1
      'n.toLocaleString([], {})',
      'n.toLocaleString(void 0)',
      "d.toLocaleDateString('default', { month: 'long' })",
      'const loc = undefined; new Intl.NumberFormat(loc)',
      'Intl.NumberFormat().format(n)',
      'n?.toLocaleString?.()',
      'Number.prototype.toLocaleString.call(n)',
      'new Intl.Collator()',
      'new Intl.ListFormat()',
      's.toLocaleUpperCase()',
      'a.localeCompare(b)',
      'Intl.DateTimeFormat().resolvedOptions().timeZone',
      'const x = <p>{formatLocalTime(t)}</p>',
      'const s = `Updated ${formatLocalDateTime(t)}`',
    ]
    for (const s of bad) expect(localeOffenders('probe.tsx', s), s).not.toEqual([])
    const good = [
      "n.toLocaleString('en-US')",
      'd.toLocaleTimeString(UI_LOCALE, { timeZoneName: "short" })',
      "new Intl.NumberFormat('en-US')",
      "Intl.DateTimeFormat('en-CA', {})",
      'a.localeCompare(b, UI_LOCALE)',
      'setLastFetched(formatLocalTime(new Date()))',
    ]
    for (const s of good) expect(localeOffenders('probe.tsx', s), s).toEqual([])
  })

  it('no product file formats in the viewer\'s locale, or in the viewer\'s zone during render', () => {
    expect(offenders).toEqual([])
  })
})
