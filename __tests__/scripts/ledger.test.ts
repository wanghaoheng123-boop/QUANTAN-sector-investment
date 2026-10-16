/** Q-095 — the rules scripts/ledger-append.mjs enforces, tested without a real append. */
import { describe, expect, it } from 'vitest'
import { appendText, formatRow, parseCsv, quoteField, validateNewRows } from '../../scripts/lib/ledger.mjs'

const HEADER = 'id,reviewer,severity,domain,file,line,one_line,citation,acceptance_test_id,assigned_engineer,target_sprint,status'
const LEDGER = `${HEADER}\nA-1,r,LOW,d,f.ts,1,thing,c,AT,e,s,open\n`
const row = (over: Record<string, string> = {}) => Object.fromEntries(HEADER.split(',').map((h) => [h, h === 'id' ? 'B-1' : 'x'])) as Record<string, string> & typeof over

describe('ledger append rules', () => {
  it('quotes what RFC 4180 requires, and nothing else', () => {
    expect(quoteField('plain')).toBe('plain')
    expect(quoteField('Record<string, unknown>')).toBe('"Record<string, unknown>"')
    expect(quoteField('say "no"')).toBe('"say ""no"""')
    expect(parseCsv(formatRow(['a, b', 'c"d', 'e\nf']))[0]).toEqual(['a, b', 'c"d', 'e\nf'])
  })

  it('refuses a row missing a column, with an unknown key, or reusing an id', () => {
    const { line: _line, ...noLine } = row()
    expect(validateNewRows(LEDGER, [noLine]).problems.join()).toMatch(/missing line/)
    expect(validateNewRows(LEDGER, [{ ...row(), extra: 'x' }]).problems.join()).toMatch(/unknown extra/)
    expect(validateNewRows(LEDGER, [{ ...row(), id: 'A-1' }]).problems.join()).toMatch(/A-1 already exists/)
    expect(validateNewRows(LEDGER, [row(), row()]).problems.join()).toMatch(/B-1 already exists/)
    expect(validateNewRows(LEDGER, [row()]).problems).toEqual([])
  })

  it('never glues a new row onto a file that lost its trailing newline', () => {
    const noNewline = LEDGER.trimEnd()
    const out = noNewline + appendText(noNewline, HEADER.split(','), [row()])
    const rows = parseCsv(out)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.length === 12)).toBe(true)
  })

  it('a field with commas survives the round trip as ONE field', () => {
    const r = { ...row(), one_line: 'Record<string, unknown> losing types' }
    const rows = parseCsv(LEDGER + appendText(LEDGER, HEADER.split(','), [r]))
    expect(rows[2]).toHaveLength(12)
    expect(rows[2][6]).toBe('Record<string, unknown> losing types')
  })
})
