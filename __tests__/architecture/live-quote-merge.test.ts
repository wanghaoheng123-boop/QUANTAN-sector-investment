/**
 * Q-145 (red-team Q145-R1) — the pages DELEGATE their quote transitions, and no
 * product file turns a missing change back into a number.
 *
 * The first version of the fix had one call-site guard: a regex for
 * `resolveTickChange(old, q)` on app/page.tsx. A call whose result is thrown
 * away satisfies it, and the red-team reintroduced the exact defect the fix
 * named — keep the previous change, so a stale move shows as live — on all
 * three pages with every test green. Eleven simpler reverts (`?? 0` on the
 * ticker tape, the sector P/E, the heatmap and commodities tiles, the desk's
 * `hasChange`) were green too.
 *
 * Two properties, decided over the parse tree:
 *   1. Every `setQuote(...)` on the stock and sector pages is `null`, a value
 *      named elsewhere (the boot fetch's quote), or an updater whose body IS
 *      `mergeXTick(prev, tick)` with its own parameter as `prev`. Every
 *      `next[...] = ...` on the landing page IS `mergeLandingTick(...)`. The
 *      transitions themselves are tested in __tests__/lib/liveQuoteState.test.tsx.
 *   2. A TRIPWIRE, not a proof (red-team Q145-R2-2): no product file coalesces
 *      a change field to a number or a numeric string (`?? 0`, `|| '0.00'`),
 *      converts one with `Number(…)`, picks a numeric literal in a ternary that
 *      tests one, casts one to `number`, or writes a numeric literal into one.
 *      It decides by field NAME, so a local alias or a named constant passes; the
 *      behaviour itself is pinned by the page render tests
 *      (__tests__/components/LandingLiveTick, TickerPagesLiveTick).
 *   3. Each single-ticker page turns a MISSING boot verdict, and a failed
 *      request, into the missing state rather than an endless skeleton.
 *
 * Named residuals, each pinned below as a passing test so a green run is not
 * read as a proof: a quote built in a local and passed by name to `setQuote`; a
 * shadowed helper or an early return on the stock and sector pages (caught by
 * the render tests, not here); a change field read through a local alias or
 * coalesced to a named constant; and a zero produced from a field whose name is
 * not on the list (the BTC feed's Coinbase `open_24h` and CoinGecko
 * `usd_24h_change`). __tests__/lib/btcSnapshot.test.tsx pins those PARSERS, and
 * __tests__/hooks/useBtcPriceWs.test.ts pins the hook's three call sites (the
 * socket, the quote route and direct CoinGecko); this guard pins neither.
 * `lib/options/chain.ts` still turns a missing strike, last price, implied
 * volatility or spot into 0 on fields this list does not name (Q-160).
 *
 * Q-156 and Q-157 (2026-10-24) removed the two exemptions this guard shipped
 * with: the options contract `change` and the BTC feed's `change24h` /
 * `changePct24h` are null when missing, and those names are on the list.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function walk(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  ts.forEachChild(node, (c) => walk(c, fn))
}

const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e)

/** Is `e` an updater `(p) => helper(p, …)` — the helper's result, with the updater's own state? */
function isDelegatingUpdater(e: ts.Expression, helper: string): boolean {
  if (!ts.isArrowFunction(e) || e.parameters.length !== 1 || ts.isBlock(e.body)) return false
  const param = e.parameters[0].name
  if (!ts.isIdentifier(param)) return false
  const body = unwrap(e.body)
  return (
    ts.isCallExpression(body) &&
    ts.isIdentifier(body.expression) && body.expression.text === helper &&
    body.arguments.length >= 1 &&
    ts.isIdentifier(body.arguments[0]) && body.arguments[0].text === param.text
  )
}

export interface MergeReport { offenders: string[]; delegating: number }

/** Property 1 for a single-ticker page. */
export function setterOffenders(path: string, source: string, setter: string, helper: string): MergeReport {
  const sf = parse(path, source)
  const offenders: string[] = []
  let delegating = 0
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== setter) return
    const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    if (!arg) return void offenders.push(`${path}:${line} ${setter}() with no argument`)
    if (arg.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(arg) || ts.isPropertyAccessExpression(arg)) return
    if (isDelegatingUpdater(arg, helper)) return void delegating++
    offenders.push(`${path}:${line} ${n.getText(sf).slice(0, 100)}`)
  })
  return { offenders, delegating }
}

/** Property 1 for the landing page: every `next[...] = …` IS the helper's result. */
export function landingOffenders(path: string, source: string, helper: string): MergeReport {
  const sf = parse(path, source)
  const offenders: string[] = []
  let delegating = 0
  walk(sf, (n) => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return
    if (!ts.isElementAccessExpression(n.left) || !ts.isIdentifier(n.left.expression) || n.left.expression.text !== 'next') return
    const rhs = unwrap(n.right)
    if (ts.isCallExpression(rhs) && ts.isIdentifier(rhs.expression) && rhs.expression.text === helper) return void delegating++
    offenders.push(`${path}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf).slice(0, 100)}`)
  })
  return { offenders, delegating }
}

/**
 * Red-team Q145-R2: the boot fetch of each single-ticker page must turn a
 * MISSING verdict into the missing state. Mutation testing removed
 * `setQuoteMissing(boot.reason)` from either page with every test green, which
 * put back the pulsing skeleton for a quote that is never coming.
 *
 * Decided on the parse tree: an `if (boot.kind === 'priced')` whose `else`
 * calls `setQuoteMissing(boot.reason)`, and a call `setQuoteMissing(FAILED_REASON)`
 * somewhere (the request-failure path).
 */
export function bootMissingProblems(path: string, source: string): string[] {
  const sf = parse(path, source)
  let wired = 0
  let failed = 0
  const isCall = (n: ts.Node, arg: (a: ts.Expression) => boolean) =>
    ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'setQuoteMissing' &&
    n.arguments.length === 1 && arg(n.arguments[0])
  walk(sf, (n) => {
    if (isCall(n, (a) => ts.isIdentifier(a) && a.text === 'FAILED_REASON')) failed++
    if (!ts.isIfStatement(n) || !n.elseStatement) return
    const c = unwrap(n.expression)
    const isPricedTest = ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(c.left) && c.left.getText(sf) === 'boot.kind' &&
      ts.isStringLiteralLike(c.right) && c.right.text === 'priced'
    if (!isPricedTest) return
    let found = false
    walk(n.elseStatement, (m) => {
      if (isCall(m, (a) => ts.isPropertyAccessExpression(a) && a.getText(sf) === 'boot.reason')) found = true
    })
    if (found) wired++
  })
  const problems: string[] = []
  if (wired !== 1) problems.push(`${path}: expected one "else setQuoteMissing(boot.reason)" after boot.kind === 'priced', found ${wired}`)
  if (failed < 1) problems.push(`${path}: the request-failure path never calls setQuoteMissing(FAILED_REASON)`)
  return problems
}

const ZERO_FIELDS = new Set(['change', 'changePct', 'pe', 'high52w', 'low52w', 'change24h', 'changePct24h', 'percentChange', 'high24h', 'low24h', 'volume24h'])
const CHANGE_FIELDS = new Set(['change', 'changePct', 'change24h', 'changePct24h', 'percentChange'])
const isNumber = (e: ts.Expression): boolean => {
  const u = unwrap(e)
  if (ts.isNumericLiteral(u) || (ts.isPrefixUnaryExpression(u) && ts.isNumericLiteral(u.operand))) return true
  // A numeric STRING is the same zero, rendered: `?? '0.00'` (R2-2, N11).
  return ts.isStringLiteralLike(u) && /^[+-]?\d+(?:\.\d+)?%?$/.test(u.text)
}
/** The change field an expression reads, looking through calls on it: `q.changePct?.toFixed(2)` → changePct. */
const fieldName = (e: ts.Expression): string | null => {
  let u = unwrap(e)
  for (;;) {
    if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression)) { u = unwrap(u.expression.expression); continue }
    if (ts.isNonNullExpression(u)) { u = unwrap(u.expression); continue }
    break
  }
  if (ts.isPropertyAccessExpression(u)) return u.name.text
  if (ts.isElementAccessExpression(u) && ts.isStringLiteralLike(u.argumentExpression)) return u.argumentExpression.text
  return null
}
/** Does `e` read a change field anywhere inside it? */
const readsChangeField = (e: ts.Node): boolean => {
  let found = false
  walk(e, (n) => {
    if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && ZERO_FIELDS.has(fieldName(n as ts.Expression) ?? '')) found = true
  })
  return found
}

/** Property 2: a change field coalesced to a number, cast to number, or written as a literal. */
export function zeroOffenders(path: string, source: string): string[] {
  const sf = parse(path, source)
  const out: string[] = []
  const at = (n: ts.Node) => `${path}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf).slice(0, 90)}`
  walk(sf, (n) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      if ((op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) && isNumber(n.right)) {
        const f = fieldName(n.left)
        if (f && ZERO_FIELDS.has(f)) out.push(at(n))
      }
    }
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && n.type.kind === ts.SyntaxKind.NumberKeyword) {
      const f = fieldName(n.expression)
      if (f && CHANGE_FIELDS.has(f)) out.push(at(n))
    }
    if (ts.isNonNullExpression(n)) {
      const f = fieldName(n.expression)
      if (f && CHANGE_FIELDS.has(f)) out.push(at(n))
    }
    // `Number(q.changePct)` is 0 for null (R2-2, N7/N8/N18).
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Number' && n.arguments.length === 1) {
      const f = fieldName(n.arguments[0])
      if (f && ZERO_FIELDS.has(f)) out.push(at(n))
    }
    // `q.changePct == null ? 0 : q.changePct` (R2-2, N12).
    if (ts.isConditionalExpression(n) && readsChangeField(n.condition) && (isNumber(n.whenTrue) || isNumber(n.whenFalse))) {
      out.push(at(n))
    }
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && ZERO_FIELDS.has(n.name.text)) {
      // `change: 0`, and `changePct24h: Number(x) || 0` / `high24h: x ?? 0`
      // whatever x reads (red-team F3 on Q-156/Q-157: only the bare literal was caught).
      const init = unwrap(n.initializer)
      const coalescedToNumber = ts.isBinaryExpression(init)
        && (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || init.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        && isNumber(init.right)
      if ((CHANGE_FIELDS.has(n.name.text) && isNumber(n.initializer)) || coalescedToNumber) out.push(at(n))
    }
  })
  return out
}

const PAGES = [
  { path: 'app/stock/[ticker]/page.tsx', setter: 'setQuote', helper: 'mergeStockTick' },
  { path: 'app/sector/[slug]/page.tsx', setter: 'setQuote', helper: 'mergeSectorTick' },
]
const LANDING = { path: 'app/page.tsx', helper: 'mergeLandingTick' }

const productFiles = execSync('git ls-files -z app components hooks lib', { cwd: ROOT }).toString().split('\0')
  .filter((p) => /\.(?:tsx?|jsx?|mjs)$/.test(p) && !p.endsWith('.d.ts'))

describe('the pages delegate their quote transitions (property 1)', () => {
  it('visits the three pages that merge a live tick', () => {
    for (const p of [...PAGES.map((x) => x.path), LANDING.path]) expect(productFiles).toContain(p)
  })

  for (const { path, setter, helper } of PAGES) {
    it(`${path}: every ${setter}() is null, a named value, or ${helper}(prev, tick)`, () => {
      const r = setterOffenders(path, read(path), setter, helper)
      expect(r.offenders).toEqual([])
      expect(r.delegating).toBeGreaterThanOrEqual(1) // the live-tick updater was found, not skipped
    })
  }

  it(`${LANDING.path}: every next[…] = … is ${LANDING.helper}(…)`, () => {
    const r = landingOffenders(LANDING.path, read(LANDING.path), LANDING.helper)
    expect(r.offenders).toEqual([])
    expect(r.delegating).toBe(1)
  })

  it('flags the red-team reproducers and their paraphrases (positive controls)', () => {
    const bad = [
      'setQuote((prev) => ({ ...mergeStockTick(prev, tick), change: prev?.change ?? null }))',
      'setQuote((prev) => { mergeStockTick(prev, tick); return { ...prev!, price: tick.price } })',
      'setQuote((prev) => mergeStockTick(null, tick))',
      'setQuote((prev) => tick.change == null && prev ? prev : mergeStockTick(prev, tick))',
      'setQuote({ price: 1, change: 0, changePct: 0, marketCap: "" })',
      'setQuote((p) => ({ price: tick.price, change: tick.change ?? p?.change ?? null, changePct: null, marketCap: "" }))',
      'setQuote()',
    ]
    for (const s of bad) expect(setterOffenders('probe.tsx', s, 'setQuote', 'mergeStockTick').offenders, s).not.toEqual([])
    const good = ['setQuote(null)', 'setQuote(boot.quote)', 'setQuote(q)', 'setQuote((prev) => mergeStockTick(prev, tick))', 'setQuote((p) => (mergeStockTick(p, live.quote!)))']
    for (const s of good) expect(setterOffenders('probe.tsx', s, 'setQuote', 'mergeStockTick').offenders, s).toEqual([])

    const landingBad = [
      'next[ticker] = { ...mergeLandingTick(ticker, q), change: old?.change ?? null }',
      'next[ticker] = q.change == null && old ? old : mergeLandingTick(ticker, q)',
      'next[ticker] = { ticker, price: q.price, change: q.change, changePct: q.changePct }',
    ]
    for (const s of landingBad) expect(landingOffenders('probe.tsx', s, 'mergeLandingTick').offenders, s).not.toEqual([])
    expect(landingOffenders('probe.tsx', 'next[ticker] = mergeLandingTick(ticker, q)', 'mergeLandingTick').offenders).toEqual([])
  })

  for (const { path } of PAGES) {
    it(`${path}: a missing or failed boot quote sets the missing state (red-team R2)`, () => {
      expect(bootMissingProblems(path, read(path))).toEqual([])
    })
  }

  it('flags a boot handler that drops the missing verdict (positive controls)', () => {
    const ok = "if (boot.kind === 'priced') { setQuote(boot.quote) } else { setQuoteMissing(boot.reason) }\n.catch(() => setQuoteMissing(FAILED_REASON))"
    expect(bootMissingProblems('probe.tsx', ok)).toEqual([])
    const bad = [
      "if (boot.kind === 'priced') { setQuote(boot.quote) }\n.catch(() => setQuoteMissing(FAILED_REASON))",
      "if (boot.kind === 'priced') { setQuote(boot.quote) } else { setQuoteMissing(null) }\n.catch(() => setQuoteMissing(FAILED_REASON))",
      "if (boot.kind === 'priced') { setQuote(boot.quote) } else { console.log(boot.reason) }\n.catch(() => setQuoteMissing(FAILED_REASON))",
      "if (boot.kind === 'priced') { setQuote(boot.quote) } else { setQuoteMissing(boot.reason) }\n.catch(() => setQuoteError('x'))",
    ]
    for (const s of bad) expect(bootMissingProblems('probe.tsx', s), s).not.toEqual([])
  })

  it('RESIDUAL: a quote built in a local and passed by name is not seen', () => {
    const s = 'const q = { ...boot.quote, changePct: prevPct }; setQuote(q)'
    expect(setterOffenders('probe.tsx', s, 'setQuote', 'mergeStockTick').offenders).toEqual([])
  })
})

describe('no product file turns a missing change into a number (property 2)', () => {
  it('flags every spelling of the old zeros (positive controls)', () => {
    const bad = [
      'const x = quotes[t]?.changePct ?? 0', // the ticker tape, red-team M4
      'const pe = prev?.pe ?? 0', // the sector page, M15
      'const up = (q?.changePct ?? 0) >= 0', // heatmap / commodities, M6/M7
      'const c = q.change || 0',
      'const c = q["changePct"] ?? -0',
      'const c = (q.changePct as number) >= 0', // the desk's cast, M8
      'const c = <number>q.change',
      'const c = q.changePct! >= 0',
      'const row = { price: 1, change: 0, changePct: 0 }',
      'const row = { "changePct": 0.0 }',
      // Round 2 (R2-2): the re-gate's spellings.
      'const pct = quote ? Number(quote.changePct) : null', // N8 / N18
      'const s = `${Number(q.change).toFixed(2)}`', // N7
      "const s = q?.changePct?.toFixed(2) ?? '0.00'", // N11
      'const pct = quote.changePct == null ? 0 : quote.changePct', // N12
      "const s = q.change || '0'",
    ]
    for (const s of bad) expect(zeroOffenders('probe.ts', s), s).not.toEqual([])
    const good = [
      'const x = quotes[t]?.changePct ?? null',
      'const v = c.volume ?? 0', // candle volume is not a quote change
      'const p = quotes[t]?.price ?? 0', // dropped by the price > 0 filter
      'const c = q.change ?? y.change',
      'const row = { change: null, changePct: delta }',
      'const pct = q.changePct == null ? null : q.changePct',
      'const v = Number(c.volume)',
    ]
    for (const s of good) expect(zeroOffenders('probe.ts', s), s).toEqual([])
  })

  it('visits the product tree, including every quote consumer', () => {
    expect(productFiles.length).toBeGreaterThan(200)
    for (const p of ['app/heatmap/page.tsx', 'app/commodities/page.tsx', 'app/desk/page.tsx', 'components/PriceTicker.tsx', 'components/SectorCard.tsx', 'lib/liveQuoteState.ts', 'lib/data/mergeQuotes.ts', 'lib/data/bloomberg/bridgeClient.ts',
      'lib/options/chain.ts', 'lib/btcSnapshot.ts', 'components/crypto/hooks/useBtcPriceWs.ts', 'components/crypto/BtcHeader.tsx', 'app/api/crypto/btc/quote/route.ts']) {
      expect(productFiles).toContain(p)
    }
  })

  it('no product file does it', () => {
    const offenders = productFiles.flatMap((p) => zeroOffenders(p, read(p)))
    expect(offenders).toEqual([])
  })

  it('RESIDUAL: a local alias or a named constant passes (the render tests pin the behaviour)', () => {
    expect(zeroOffenders('probe.ts', 'const raw = q?.changePct; const pct = q ? (raw ?? 0) : null')).toEqual([])
    expect(zeroOffenders('probe.ts', 'const FLAT_PCT = 0; const x = quotes[t]?.changePct ?? FLAT_PCT')).toEqual([])
  })

  it('the BTC feed and options-contract change names are on the list (Q-156, Q-157 positive controls)', () => {
    for (const bad of [
      'const s = { change24h: d.change24h ?? 0 }',
      'const s = { changePct24h: d.changePct24h ?? 0 }',
      'const s = { change24h: 0 }',
      'const isUp = (btcPrice?.changePct24h ?? 0) >= 0',
      'const c = { change: Number(raw.change ?? 0) }',
      'const c = { percentChange: Number(raw.percentChange) }',
    ]) expect(zeroOffenders('probe.ts', bad), bad).not.toEqual([])
  })

  it('a listed field initialised from ANY expression coalesced to a number is caught (red-team F3)', () => {
    for (const bad of [
      'const s = { changePct24h: Number(q.bitcoin?.usd_24h_change) || 0 }',
      'const s = { high24h: parseFloat(d.high_24h) ?? 0 }',
      'const s = { volume24h: v || 0 }',
    ]) expect(zeroOffenders('probe.ts', bad), bad).not.toEqual([])
    expect(zeroOffenders('probe.ts', 'const s = { high24h: positive(d.high_24h) }')).toEqual([])
  })

  it('RESIDUAL: a zero produced into a local from a field name not on the list passes (the parser and hook tests pin the BTC sources)', () => {
    expect(zeroOffenders('probe.ts', 'const chg = open24 > 0 ? price - open24 : 0')).toEqual([])
    expect(zeroOffenders('probe.ts', 'const pct = Number(q.bitcoin?.usd_24h_change) || 0')).toEqual([])
    expect(zeroOffenders('probe.ts', 'const c = { lastPrice: Number(raw.lastPrice ?? 0) }')).toEqual([]) // Q-160
  })
})
