/**
 * Q-149 (data-integrity Q149-D7) — every field the dark-pool builder reads is a
 * DECLARED property of the vendor interface it reads it from.
 *
 * The defect Q-149 removed was reads of `offExchangeShares`, `marketStore` and
 * `ordinarySharesNumber`, none of which yahoo-finance2 declares. tsc never
 * objected and never would have: `DefaultKeyStatistics` carries a string index
 * signature (`[key: string]: unknown`), so any name compiles. The builder now
 * reads only through `KEY_STATISTICS_FIELDS` / `QUOTE_FIELDS`, and this test
 * parses the installed vendor declarations and checks each name against the
 * interface's declared members — the index signature does not count.
 *
 * A vendor rename (this repo is on 3.13.2) fails here instead of emptying a
 * card with every test green.
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
