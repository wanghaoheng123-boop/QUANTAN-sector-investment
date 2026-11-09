/**
 * Q-149 (data-integrity Q149-D7, Q149-R2-5) — every field the dark-pool code
 * READS from a vendor object is a DECLARED property of the interface it reads it
 * from.
 *
 * The defect Q-149 removed was reads of `offExchangeShares`, `marketStore` and
 * `ordinarySharesNumber`, none of which yahoo-finance2 declares. tsc never
 * objected and never would have: `DefaultKeyStatistics` carries a string index
 * signature (`[key: string]: unknown`), so any name compiles. Two layers here:
 *
 *  1. The builder's field lists (`KEY_STATISTICS_FIELDS` / `QUOTE_FIELDS`) are
 *     checked against the installed vendor declarations; the index signature does
 *     not count as a member.
 *  2. The READS themselves. A list is a convention; a read outside it compiles.
 *     `scanVendorReads` parses `lib/darkpool.ts` and the route as TypeScript and
 *     reports every property, element, destructuring and accessor read on the
 *     vendor-typed names, and the test checks each name against the declared
 *     members. It is a pure function of source text, so the plants below
 *     (Q149-R2-5 D7a/D7b/D7c, taken from the round-2 review) run in CI on the real
 *     files and must make it fail.
 *
 * A vendor rename (this repo is on 3.13.2) fails here instead of emptying a
 * card with every test green.
 *
 * WHAT THIS CANNOT SEE. A vendor object passed to a function whose parameter has
 * a new name is asserted below as a passing test, so a green run is not read as a
 * proof. A vendor object bound to a name that is not in the per-file binding table
 * is not asserted, and cannot be: the test checks that each bound name is actually
 * read in its file, which catches a rename and not a new variable.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { KEY_STATISTICS_FIELDS, QUOTE_FIELDS } from '@/lib/darkpool'

const ROOT = join(__dirname, '..', '..')
const VENDOR = join(ROOT, 'node_modules/yahoo-finance2/esm/src/modules')

/** Declared property names of `interfaceName`, plus those of the interfaces it extends in the same file. */
export function declaredMembers(source: string, interfaceName: string): Set<string> {
  const sf = ts.createSourceFile('vendor.d.ts', source, ts.ScriptTarget.Latest, true)
  const decls = new Map<string, ts.InterfaceDeclaration>()
  sf.forEachChild((n) => { if (ts.isInterfaceDeclaration(n)) decls.set(n.name.text, n) })
  const out = new Set<string>()
  const visit = (name: string, seen: Set<string>) => {
    const d = decls.get(name)
    if (!d || seen.has(name)) return
    seen.add(name)
    for (const m of d.members) {
      // A PropertySignature only — an IndexSignature (`[key: string]: unknown`) has no name to match.
      if (ts.isPropertySignature(m) && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) out.add(m.name.text)
    }
    for (const h of d.heritageClauses ?? []) for (const t of h.types) if (ts.isIdentifier(t.expression)) visit(t.expression.text, seen)
  }
  visit(interfaceName, new Set())
  return out
}

const keyStatsSource = readFileSync(join(VENDOR, 'quoteSummary-iface.d.ts'), 'utf8')
const quoteSource = readFileSync(join(VENDOR, 'quote.d.ts'), 'utf8')
const keyStats = declaredMembers(keyStatsSource, 'DefaultKeyStatistics')
const quoteBase = declaredMembers(quoteSource, 'QuoteBase')

// ─── The read scanner ────────────────────────────────────────────────────────

/** How a vendor member was read. `computed` and `rest` name no member and are never allowed. */
type ReadKind = 'property' | 'element' | 'destructure' | 'accessor' | 'computed-in-accessor' | 'computed' | 'rest'

export interface VendorRead {
  /** The root binding the read goes through (an alias resolves to its root). */
  object: string
  name: string
  kind: ReadKind
  line: number
}

export interface ScanConfig {
  /** Identifier -> the interface key its value is typed as in this file. */
  names: Readonly<Record<string, string>>
  /**
   * Accessor functions called with a string literal, `ks('floatShares')`:
   * identifier -> the vendor-typed name it reads from, and the field-union type its
   * parameter must carry. A computed read `obj[f]` is allowed only inside the
   * accessor whose parameter is typed with that union, which is what ties it to the
   * checked field list.
   */
  accessors?: Readonly<Record<string, { objectName: string; fieldType: string }>>
}

/** Strips the wrappers that hide the object from a naive scan: `(x as T)`, `x!`, `<T>x`, `x satisfies T`. */
function unwrap(e: ts.Expression): ts.Expression {
  let cur = e
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) {
      cur = cur.expression
    } else {
      return cur
    }
  }
}

const isStringLike = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)

/**
 * Every read of a member on the configured vendor-typed names in `source`:
 * `x.name`, `x?.name`, `x['name']`, `(x as T).name`, `const { name } = x`, an
 * alias `const y = x; y.name`, and `accessor('name')`. A pure function of the text.
 */
export function scanVendorReads(source: string, config: ScanConfig): VendorRead[] {
  const sf = ts.createSourceFile('scanned.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const roots = new Map<string, string>(Object.keys(config.names).map((n) => [n, n]))

  // Aliases: `const y = x` (through any wrapper) binds y to x's root. Iterate to a fixpoint.
  const aliasDecls: ts.VariableDeclaration[] = []
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) aliasDecls.push(n)
    ts.forEachChild(n, collect)
  }
  collect(sf)
  for (let changed = true; changed; ) {
    changed = false
    for (const d of aliasDecls) {
      const name = (d.name as ts.Identifier).text
      const init = unwrap(d.initializer as ts.Expression)
      if (ts.isIdentifier(init) && roots.has(init.text) && !roots.has(name)) {
        roots.set(name, roots.get(init.text) as string)
        changed = true
      }
    }
  }
  const rootOf = (e: ts.Expression): string | null => {
    const u = unwrap(e)
    return ts.isIdentifier(u) ? (roots.get(u.text) ?? null) : null
  }

  const reads: VendorRead[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const push = (object: string, name: string, kind: ReadKind, n: ts.Node) => reads.push({ object, name, kind, line: lineOf(n) })

  /** The accessor whose body encloses `n`, if the accessor's parameter carries the expected field union. */
  const enclosingAccessor = (n: ts.Node): string | null => {
    for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
      if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
        const decl = cur.parent
        if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
          const acc = config.accessors?.[decl.name.text]
          const param = cur.parameters[0]
          if (acc && param?.type && param.type.getText(sf) === acc.fieldType) return decl.name.text
        }
        return null
      }
    }
    return null
  }

  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n)) {
      const root = rootOf(n.expression)
      if (root) push(root, n.name.text, 'property', n)
    } else if (ts.isElementAccessExpression(n)) {
      const root = rootOf(n.expression)
      if (root) {
        const arg = unwrap(n.argumentExpression)
        if (isStringLike(arg)) push(root, arg.text, 'element', n)
        else {
          const acc = enclosingAccessor(n)
          const ok = acc != null && ts.isIdentifier(arg) && config.accessors?.[acc]?.objectName === root
          push(root, '[computed]', ok ? 'computed-in-accessor' : 'computed', n)
        }
      }
    } else if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      const root = rootOf(n.initializer)
      if (root) {
        for (const el of n.name.elements) {
          if (el.dotDotDotToken) push(root, '[rest]', 'rest', el)
          else if (el.propertyName && (ts.isIdentifier(el.propertyName) || isStringLike(el.propertyName))) push(root, el.propertyName.text, 'destructure', el)
          else if (!el.propertyName && ts.isIdentifier(el.name)) push(root, el.name.text, 'destructure', el)
          else push(root, '[computed]', 'computed', el)
        }
      }
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const acc = config.accessors?.[n.expression.text]
      if (acc && n.arguments.length > 0) {
        const arg = unwrap(n.arguments[0])
        push(acc.objectName, isStringLike(arg) ? arg.text : '[computed]', isStringLike(arg) ? 'accessor' : 'computed', n)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return reads
}

/** Reads that name a member the vendor interface does not declare, or name no member at all. */
export function undeclaredReads(reads: readonly VendorRead[], declared: Readonly<Record<string, ReadonlySet<string>>>, config: ScanConfig): VendorRead[] {
  return reads.filter((r) => {
    if (r.kind === 'computed-in-accessor') return false
    if (r.kind === 'computed' || r.kind === 'rest') return true
    const iface = config.names[r.object]
    return !(iface != null && declared[iface]?.has(r.name))
  })
}

describe('the dark-pool builder reads only declared vendor fields', () => {
  it('parsed the vendor interfaces (the declarations were visited, not skipped)', () => {
    expect(keyStats.size).toBeGreaterThan(20)
    expect(quoteBase.size).toBeGreaterThan(40)
    // The index signature is present in the vendor file, and it is not a member here.
    expect(keyStatsSource).toMatch(/interface DefaultKeyStatistics \{\s*\[key: string\]: unknown;/)
  })

  it.each(KEY_STATISTICS_FIELDS)('defaultKeyStatistics.%s is declared', (f) => {
    expect(keyStats.has(f)).toBe(true)
  })

  it.each(QUOTE_FIELDS)('quote.%s is declared', (f) => {
    expect(quoteBase.has(f)).toBe(true)
  })

  it('the fields the old route read are NOT declared (negative controls)', () => {
    for (const f of ['offExchangeShares', 'marketStore', 'ordinarySharesNumber']) expect(keyStats.has(f), f).toBe(false)
    expect(declaredMembers(keyStatsSource, 'FinancialData').has('sharesOutstanding')).toBe(false)
    expect(keyStats.has('averageDailyVolume10Day')).toBe(false) // a quote field, read from the quote
  })
})

// ─── The reads, on the real files ────────────────────────────────────────────

const DECLARED: Record<string, ReadonlySet<string>> = {
  DefaultKeyStatistics: keyStats,
  QuoteBase: quoteBase,
  QuoteSummaryResult: declaredMembers(keyStatsSource, 'QuoteSummaryResult'),
}

/** Per-file binding tables: the same name means different things in different files. */
const LIB_CONFIG: ScanConfig = {
  names: { keyStats: 'DefaultKeyStatistics', quote: 'QuoteBase' },
  accessors: {
    ks: { objectName: 'keyStats', fieldType: 'KeyStatisticsField' },
    q: { objectName: 'quote', fieldType: 'QuoteField' },
  },
}
const ROUTE_CONFIG: ScanConfig = {
  names: { keyStats: 'DefaultKeyStatistics', rawQuote: 'QuoteBase', q: 'QuoteBase', summary: 'QuoteSummaryResult' },
}

const libSource = readFileSync(join(ROOT, 'lib/darkpool.ts'), 'utf8')
const routeSource = readFileSync(join(ROOT, 'app/api/darkpool/[ticker]/route.ts'), 'utf8')
const libReads = scanVendorReads(libSource, LIB_CONFIG)
const routeReads = scanVendorReads(routeSource, ROUTE_CONFIG)
const names = (reads: readonly VendorRead[], object: string) => new Set(reads.filter((r) => r.object === object).map((r) => r.name))

describe('the dark-pool code reads only declared vendor members (Q149-R2-5)', () => {
  it('lib/darkpool.ts: no read is undeclared, computed outside an accessor, or a rest', () => {
    expect(undeclaredReads(libReads, DECLARED, LIB_CONFIG)).toEqual([])
  })

  it('the route: no read is undeclared, computed or a rest', () => {
    expect(undeclaredReads(routeReads, DECLARED, ROUTE_CONFIG)).toEqual([])
  })

  // What did it VISIT? A scan that finds nothing is green too.
  it('visited the reads it governs, not an empty set', () => {
    // Every bound name is read in its file; a rename would blind the scan and fail here.
    for (const n of Object.keys(LIB_CONFIG.names)) expect(libReads.some((r) => r.object === n), `lib ${n}`).toBe(true)
    for (const n of Object.keys(ROUTE_CONFIG.names)) expect(routeReads.some((r) => r.object === n), `route ${n}`).toBe(true)
    // The accessor reads in the builder are exactly the two field lists.
    expect(names(libReads, 'keyStats').has('[computed]')).toBe(true) // keyStats[f] inside ks
    expect([...names(libReads, 'keyStats')].filter((n) => n !== '[computed]').sort()).toEqual([...KEY_STATISTICS_FIELDS].sort())
    expect([...names(libReads, 'quote')].filter((n) => n !== '[computed]').sort()).toEqual([...QUOTE_FIELDS].sort())
    // The route's own reads, named.
    for (const n of ['regularMarketPrice', 'regularMarketChange', 'regularMarketChangePercent', 'regularMarketTime']) {
      expect(names(routeReads, 'q').has(n), `q.${n}`).toBe(true)
    }
    expect(names(routeReads, 'rawQuote').has('quoteType')).toBe(true)
    expect(names(routeReads, 'keyStats')).toEqual(new Set(['floatShares', 'sharesOutstanding']))
    expect(names(routeReads, 'summary')).toEqual(new Set(['defaultKeyStatistics']))
  })

  it('the route no longer reads the undeclared q.currentPrice', () => {
    expect(quoteBase.has('currentPrice')).toBe(false)
    expect(names(routeReads, 'q').has('currentPrice')).toBe(false)
  })
})

/**
 * Positive controls. Each plant is applied to the REAL file text (the target must
 * occur exactly once, so a refactor that moves it fails here instead of silently
 * planting nothing) and the scan must report the planted name.
 */
describe('the read scanner fails on the review\'s plants (Q149-R2-5 D7a, D7b, D7c)', () => {
  const plant = (source: string, target: string, replacement: string): string => {
    expect(source.split(target).length - 1, `plant target occurs once: ${target}`).toBe(1)
    const out = source.replace(target, replacement)
    expect(out).not.toBe(source)
    expect(out).toContain(replacement)
    return out
  }
  const bad = (source: string, config: ScanConfig) => undeclaredReads(scanVendorReads(source, config), DECLARED, config).map((r) => `${r.object}.${r.name}`)

  it('D7a: a new undeclared read added to the builder', () => {
    const planted = plant(
      libSource,
      "positive(ks('sharesOutstanding')) ?? positive(q('sharesOutstanding'))",
      "positive(ks('sharesOutstanding')) ?? positive(q('sharesOutstanding')) ?? positive(keyStats.freeFloatEstimate)",
    )
    expect(bad(planted, LIB_CONFIG)).toEqual(['keyStats.freeFloatEstimate'])
  })

  it('D7b: an undeclared field swapped into the route\'s drift log', () => {
    const planted = plant(
      routeSource,
      'keyStatsHasSharesOutstanding: keyStats.sharesOutstanding !== undefined,',
      'keyStatsHasSharesOutstanding: keyStats.offExchangeShares !== undefined,',
    )
    expect(bad(planted, ROUTE_CONFIG)).toEqual(['keyStats.offExchangeShares'])
  })

  it('D7c: the original undeclared price fallbacks, restored on the route\'s quote', () => {
    const planted = plant(
      routeSource,
      'safeNum(q.regularMarketPrice)',
      'safeNum(q.regularMarketPrice ?? q.currentPrice ?? q.lastTradePrice)',
    )
    expect(bad(planted, ROUTE_CONFIG).sort()).toEqual(['q.currentPrice', 'q.lastTradePrice'])
  })

  it('an accessor called with an undeclared name, and a computed read outside the accessors', () => {
    expect(bad(plant(libSource, "ks('shortRatio')", "ks('offExchangeShares')"), LIB_CONFIG)).toEqual(['keyStats.offExchangeShares'])
    expect(bad(plant(libSource, "positive(q('averageDailyVolume10Day'))", "positive(quote[String(nowMs)])"), LIB_CONFIG)).toEqual(['quote.[computed]'])
  })
})

describe('the read scanner sees the forms a naive grep misses', () => {
  const CONFIG: ScanConfig = { names: { k: 'DefaultKeyStatistics', qt: 'QuoteBase' } }
  const bad = (source: string) => undeclaredReads(scanVendorReads(source, CONFIG), DECLARED, CONFIG).map((r) => `${r.object}.${r.name}`)

  it('property, optional-chain, element, cast, non-null and angle-bracket forms', () => {
    expect(bad('const a = k.bogus1; const b = k?.bogus2; const c = k["bogus3"]; const d = (k as Record<string, unknown>).bogus4; const e = k!.bogus5')).toEqual([
      'k.bogus1', 'k.bogus2', 'k.bogus3', 'k.bogus4', 'k.bogus5',
    ])
    expect(bad('const f = (<Record<string, unknown>>qt).bogus6; const g = (qt satisfies object).bogus7')).toEqual(['qt.bogus6', 'qt.bogus7'])
  })

  it('destructuring, a rename, and a rest', () => {
    expect(bad('const { floatShares, bogus8 } = k')).toEqual(['k.bogus8'])
    expect(bad('const { bogus9: renamed } = k')).toEqual(['k.bogus9'])
    expect(bad('const { floatShares, ...others } = k')).toEqual(['k.[rest]'])
  })

  it('an alias, and an alias of an alias', () => {
    expect(bad('const a = k; const b = (a as object); b.bogus10')).toEqual(['k.bogus10'])
  })

  it('declared members pass; an unrelated object of the same member name is not scanned', () => {
    expect(bad('const x = k.floatShares; const y = qt.regularMarketPrice; const z = other.bogus')).toEqual([])
  })

  it('a computed read with a non-literal key is reported', () => {
    expect(bad('const key = "x"; const v = k[key]')).toEqual(['k.[computed]'])
  })

  // CANNOT SEE — asserted so a green run is not read as a proof.
  it('CANNOT see a read through a function parameter with a new name', () => {
    expect(bad('function leak(p: Record<string, unknown>) { return p.bogus11 }; leak(k)')).toEqual([])
  })
})
