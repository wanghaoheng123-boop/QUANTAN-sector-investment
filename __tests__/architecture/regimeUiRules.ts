/**
 * Q-153 (compliance Q153-R2-2, R2-5, R2-8) — the structural rules behind
 * `regime-copy.test.ts`. Every function is pure over (path, source) so the test
 * can run it on the real files, on the real files with a regression planted into
 * their text, and on synthetic sources.
 *
 * Why these exist. Round 1's BLOCKING and HIGH findings (C1 the class badge, C2
 * the legend's classification column, C5 "Risk: low", C6 the traffic-light
 * colours) were closed by REMOVING things, and the word lists cannot see them
 * come back: the C1 badge, with its emerald background and its 🟢, passed the
 * advice decider because its labels ("Below a rising average") are honest words
 * and its colour lives in a `className` expression. What the removed things had
 * in common is not vocabulary but STRUCTURE — they read the classifier's
 * `dipSignal`, `riskLevel` and `color`, or they named its classes. Two rules
 * ban the structure, and both have zero hits on the committed surfaces.
 */
import { posix } from 'node:path'
import ts from 'typescript'
import { isInCodeAttribute, parseSource } from './adviceWords'

export interface Hit { line: number; text: string }

const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

// ─── Rule (a): no UI surface reads the classifier's dipSignal / riskLevel / color ───

/** Fields no UI surface may read from anything: the classifier's class and risk. */
const BANNED_ANY_RECEIVER = new Set(['dipSignal', 'riskLevel'])
/** `color` is read legitimately off other objects (a signals-grid cell), so only the regime's is banned. */
const BANNED_REGIME_ONLY = new Set(['color'])
/** The names the regime object travels under. */
const REGIME_NAMES = new Set(['regime', 'ma200Regime'])
/** A parameter or variable annotated with the regime's type is the regime, whatever it is called. */
const REGIME_TYPE = /\bMA200Regime\b/

const unwrap = (e: ts.Expression): ts.Expression => {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression
  return x
}

/**
 * Reads of `.dipSignal`, `.riskLevel` (any receiver) and `.color` (on the
 * regime) in `source`, by property access, element access (`regime['color']`,
 * and a non-literal key on the regime, which cannot be resolved so it fails
 * closed), object destructuring (`const { color: zc } = regime`, nested
 * `{ regime: { color } }`, a parameter typed `MA200Regime`), destructuring
 * assignment, and one level of aliasing (`const r = regime; r.color`).
 *
 * Property NAMES are matched exactly: `dipSignalExplained` is the measured
 * sentence and is allowed.
 */
export function regimeReads(path: string, source: string): Hit[] {
  const sf = parseSource(path, source)
  const hits: Hit[] = []
  const aliases = new Set(REGIME_NAMES)
  const keyOf = (el: ts.BindingElement): string | undefined => {
    const k = el.propertyName ?? el.name
    return ts.isIdentifier(k) || ts.isStringLiteralLike(k) ? k.text : undefined
  }
  const isRegimeExpr = (e: ts.Expression): boolean => {
    const x = unwrap(e)
    if (ts.isIdentifier(x)) return aliases.has(x.text)
    if (ts.isPropertyAccessExpression(x)) return REGIME_NAMES.has(x.name.text)
    if (ts.isElementAccessExpression(x)) return ts.isStringLiteralLike(x.argumentExpression) && REGIME_NAMES.has(x.argumentExpression.text)
    if (ts.isCallExpression(x)) {
      const callee = unwrap(x.expression)
      return (ts.isIdentifier(callee) && REGIME_NAMES.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && REGIME_NAMES.has(callee.name.text))
    }
    // `regime ?? fallback`, `regime || {}`, `cond ? regime : other` are the regime as far as a read is concerned.
    if (ts.isBinaryExpression(x) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(x.operatorToken.kind)) {
      return isRegimeExpr(x.left) || isRegimeExpr(x.right)
    }
    if (ts.isConditionalExpression(x)) return isRegimeExpr(x.whenTrue) || isRegimeExpr(x.whenFalse)
    return false
  }
  const typedAsRegime = (type: ts.TypeNode | undefined) => type != null && REGIME_TYPE.test(type.getText(sf))

  // Pass 1 — aliases, to a fixpoint.
  for (let changed = true; changed;) {
    changed = false
    const collect = (n: ts.Node) => {
      const add = (id: ts.BindingName) => {
        if (ts.isIdentifier(id) && !aliases.has(id.text)) { aliases.add(id.text); changed = true }
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && ((n.initializer && isRegimeExpr(n.initializer)) || typedAsRegime(n.type))) add(n.name)
      if (ts.isParameter(n) && ts.isIdentifier(n.name) && typedAsRegime(n.type)) add(n.name)
      if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
        const key = keyOf(n)
        if (key != null && REGIME_NAMES.has(key)) add(n.name)
      }
      ts.forEachChild(n, collect)
    }
    collect(sf)
  }

  // Is the object being destructured the regime?
  const patternIsRegime = (pattern: ts.ObjectBindingPattern): boolean => {
    const owner = pattern.parent
    if (ts.isVariableDeclaration(owner)) return (owner.initializer != null && isRegimeExpr(owner.initializer)) || typedAsRegime(owner.type)
    if (ts.isParameter(owner)) return typedAsRegime(owner.type)
    if (ts.isBindingElement(owner)) { const key = keyOf(owner); return key != null && REGIME_NAMES.has(key) }
    return false
  }
  const banned = (name: string, onRegime: boolean) => BANNED_ANY_RECEIVER.has(name) || (onRegime && BANNED_REGIME_ONLY.has(name))

  // Pass 2 — reads.
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n)) {
      if (banned(n.name.text, isRegimeExpr(n.expression))) hits.push({ line: lineOf(sf, n), text: n.getText(sf) })
    } else if (ts.isElementAccessExpression(n)) {
      const onRegime = isRegimeExpr(n.expression)
      const key = n.argumentExpression
      if (ts.isStringLiteralLike(key)) {
        if (banned(key.text, onRegime)) hits.push({ line: lineOf(sf, n), text: n.getText(sf) })
      } else if (onRegime) {
        hits.push({ line: lineOf(sf, n), text: n.getText(sf) }) // a computed key on the regime: unresolvable, so refused
      }
    } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const key = keyOf(n)
      if (key != null && banned(key, patternIsRegime(n.parent))) hits.push({ line: lineOf(sf, n), text: n.getText(sf) })
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(n.left)) {
      const onRegime = isRegimeExpr(n.right)
      for (const p of n.left.properties) {
        if ((ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name) && banned(p.name.text, onRegime)) {
          hits.push({ line: lineOf(sf, p), text: p.getText(sf) })
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

// ─── Rule (b): no dip-specific enum value outside a type position ───

/**
 * The classifier's class names that mean something only for the dip. OVERBOUGHT
 * is excluded because it is also the RSI and stochastic state label
 * (BtcQuantLab). Round 1's legend, badge and colour maps all named these.
 */
const DIP_ENUM_VALUES = ['STRONG_DIP', 'WATCH_DIP', 'FALLING_KNIFE', 'IN_TREND']
const DIP_ENUM = new RegExp(`\\b(?:${DIP_ENUM_VALUES.join('|')})\\b`)

/**
 * Every occurrence of a dip enum value in a value position: a string literal, a
 * template piece, JSX text, an identifier (`{ STRONG_DIP: 'text-emerald-300' }`
 * — the natural shape of a dip-keyed colour map), anywhere including inside a
 * `className` expression. A dedicated walk, NOT `renderedText`, because round 1's
 * `dipSignal === 'STRONG_DIP'` sat in a className expression that `renderedText`
 * skips. Type positions (`type X = 'STRONG_DIP'`, interfaces) are not occurrences.
 */
export function dipLiterals(path: string, source: string): Hit[] {
  const sf = parseSource(path, source)
  const hits: Hit[] = []
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return
    const text = ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
      ? n.text
      : ts.isIdentifier(n) ? n.text : undefined
    if (text != null && DIP_ENUM.test(text)) hits.push({ line: lineOf(sf, n), text: text.trim().slice(0, 80) })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

// ─── Rule (c): no bare percentage as a string literal ───

/** "+3.6%", "-4.1%", "68%": a literal that is nothing but a percentage. */
const BARE_PERCENT = /^\s*[+\-−–]?\s*\d+(?:\.\d+)?\s*%\s*$/

/**
 * String literals that are only a percentage. The removed "Empirical Forward
 * Return Reference" held its 26 unsourced medians and hit rates as exactly these
 * (`'+3.6%'`, `'68%'`); an earlier note called them "undetectable as text", and
 * they were never undetectable — they are string literals (Q153-R2-5). JSX text
 * is excluded: the deviation chart's axis ticks (`-35%`) are scale marks. The
 * values of code attributes (`style={{ width: '0%' }}`) are excluded too.
 */
export function bareFigureLiterals(path: string, source: string): Hit[] {
  const sf = parseSource(path, source)
  const hits: Hit[] = []
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && BARE_PERCENT.test(n.text) && !isInCodeAttribute(n, sf)) {
      hits.push({ line: lineOf(sf, n), text: n.text })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

// ─── Rule (d): the slope is formatted by formatSlopePct, not by the surface ───

/**
 * A slope scaled to a percentage on a surface: `slopePct * 100`, `(regime.slope
 * * 100)`. The 20-day slope has one formatter, `formatSlopePct`, because two
 * decimals print +0.504% and +0.496% both as "+0.50%" (Q153-R2-14); a surface
 * that rounds on its own puts the same number beside two different states. The
 * board's quick-stats cell did, until it was moved to the formatter, and no test
 * noticed. Matched by the NAME of the operand: a slope held in a variable called
 * `s` is not seen (the CANNOT block says so).
 */
export function slopeArithmetic(path: string, source: string): Hit[] {
  const sf = parseSource(path, source)
  const hits: Hit[] = []
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const mentionsSlope = (e: ts.Expression) => /slope/i.test(e.getText(sf))
      const isHundred = (e: ts.Expression) => ts.isNumericLiteral(e) && Number(e.text) === 100
      if ((mentionsSlope(n.left) && isHundred(n.right)) || (isHundred(n.left) && mentionsSlope(n.right))) hits.push({ line: lineOf(sf, n), text: n.getText(sf) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

// ─── Scope: the import closure of the surfaces ───

const PARSED_EXTENSIONS = /\.(?:tsx?|mts|jsx?|mjs)$/
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js']

/** Module specifiers a file imports, re-exports or `require`s with a literal; and the opaque ones. */
export function moduleSpecifiers(path: string, source: string): { specifiers: string[]; opaque: string[] } {
  if (!PARSED_EXTENSIONS.test(path)) return { specifiers: [], opaque: [] }
  const sf = parseSource(path, source)
  const specifiers: string[] = []
  const opaque: string[] = []
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && n.importClause?.isTypeOnly) return // types carry no copy
    if (ts.isExportDeclaration(n) && n.isTypeOnly) return
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) specifiers.push(n.moduleSpecifier.text)
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) && n.arguments.length > 0) {
      const arg = n.arguments[0]
      if (ts.isStringLiteralLike(arg)) specifiers.push(arg.text)
      else opaque.push(`${path}:${lineOf(sf, n)}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { specifiers, opaque }
}

/** Repo-relative path a specifier names, or null for a package (`react`, `next/link`). */
export function resolveSpecifier(from: string, specifier: string, read: (path: string) => string | undefined): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = specifier.slice(2)
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), specifier))
  else return null
  for (const suffix of RESOLVE_SUFFIXES) if (read(base + suffix) !== undefined) return base + suffix
  return null
}

/**
 * Every file reachable from `roots` by static imports, re-exports and literal
 * `require`/`import()`. Copy IMPORTED INTO a surface is part of the surface
 * (Q153-R2-8: the old scope was the importers of the regime module, so a dead
 * BUY/SELL/HOLD generator one re-export hop from BtcQuantLab was never read).
 * `opaque` lists dynamic imports whose specifier is not a literal: the closure
 * cannot follow them, and the test refuses them rather than ignoring them.
 */
export function importClosure(roots: string[], read: (path: string) => string | undefined): { files: string[]; opaque: string[] } {
  const seen = new Set(roots)
  const queue = [...roots]
  const opaque: string[] = []
  while (queue.length > 0) {
    const file = queue.pop() as string
    const source = read(file)
    if (source === undefined) continue
    const found = moduleSpecifiers(file, source)
    opaque.push(...found.opaque)
    for (const spec of found.specifiers) {
      const target = resolveSpecifier(file, spec, read)
      if (target != null && !seen.has(target)) { seen.add(target); queue.push(target) }
    }
  }
  return { files: [...seen].sort(), opaque: opaque.sort() }
}
