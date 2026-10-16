/** Q-095 — the rules scripts/ledger-append.mjs enforces, and the script itself. */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { appendText, formatRow, ledgerProblems, parseCsv, quoteField, validateNewRows, verifyAppended } from '../../scripts/lib/ledger.mjs'

const HEADER = 'id,reviewer,severity,domain,file,line,one_line,citation,acceptance_test_id,assigned_engineer,target_sprint,status'
const LEDGER = `${HEADER}\nA-1,r,LOW,d,f.ts,1,thing,c,AT,e,s,open\n`
const row = (over: Record<string, string> = {}) => Object.fromEntries(HEADER.split(',').map((h) => [h, h === 'id' ? 'B-1' : h === 'severity' ? 'LOW' : 'x'])) as Record<string, string> & typeof over
/** The red-team L1 reproducer: a quote opened in the last field and never closed. */
const OPEN_QUOTE = `${LEDGER}Z-1,r,LOW,d,f.ts,1,thing,c,AT,e,s,"open (see note\nZ-2,r,CRITICAL,d,f.ts,1,swallowed,c,AT,e,s,open\n`

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

  // ── red-team 2026-10-17 (L1–L5) ──────────────────────────────────────────

  it('L1: a quote left open at end of file is an error, not a 12-column row', () => {
    // The swallowed row still has the header's width, so no column check sees it.
    expect(() => parseCsv(OPEN_QUOTE)).toThrow(/opened on line 3 is never closed/)
    expect(ledgerProblems(OPEN_QUOTE).problems.join()).toMatch(/never closed/)
  })

  it('L1: a quote mid-field, or text after a closing quote, is an error too', () => {
    expect(() => parseCsv(`${HEADER}\nA-1,r,LOW,d,f.ts,1,say "no",c,AT,e,s,open\n`)).toThrow(/middle of an unquoted field/)
    expect(() => parseCsv(`${HEADER}\nA-1,r,LOW,d,f.ts,1,"x"y,c,AT,e,s,open\n`)).toThrow(/after a closing quote/)
  })

  it('L1: the append refuses a ledger with an open quote, and the post-check names a missing id', () => {
    expect(validateNewRows(OPEN_QUOTE, [row()]).problems.join()).toMatch(/existing ledger: .*never closed/)
    expect(verifyAppended(LEDGER, ['A-1'])).toEqual([])
    expect(verifyAppended(LEDGER, ['A-1', 'Z-2']).join()).toMatch(/Z-2 is not in the ledger/)
  })

  it('L2: a malformed EXISTING row refuses the append before anything is written', () => {
    const short = `${LEDGER}BAD-1,r,LOW,d,f.ts,1,thing,c,AT,e,open\n`
    expect(validateNewRows(short, [row()]).problems.join()).toMatch(/existing ledger: row BAD-1: 11 columns/)
  })

  it('L4: ids are compared and written trimmed', () => {
    expect(validateNewRows(LEDGER, [{ ...row(), id: ' A-1 ' }]).problems.join()).toMatch(/A-1 already exists/)
    expect(validateNewRows(LEDGER, [{ ...row(), id: ' C-1 ' }, { ...row(), id: 'C-1' }]).problems.join()).toMatch(/C-1 already exists/)
    const out = parseCsv(LEDGER + appendText(LEDGER, HEADER.split(','), [{ ...row(), id: ' C-1 ' }]))
    expect(out[2][0]).toBe('C-1')
  })

  it('L5: input that is not an array of objects is refused cleanly', () => {
    for (const bad of [{}, 'x', 3, null]) {
      expect(validateNewRows(LEDGER, bad as unknown as Record<string, string>[]).problems.join()).toMatch(/must be a JSON array/)
    }
    expect(validateNewRows(LEDGER, [null as unknown as Record<string, string>]).problems.join()).toMatch(/not an object/)
  })

  it('L5: values must be text, required columns non-empty, severity from the scale', () => {
    expect(validateNewRows(LEDGER, [{ ...row(), severity: null as unknown as string }]).problems.join()).toMatch(/severity must be a string, got null/)
    expect(validateNewRows(LEDGER, [{ ...row(), one_line: { a: 1 } as unknown as string }]).problems.join()).toMatch(/one_line must be a string, got object/)
    expect(validateNewRows(LEDGER, [{ ...row(), severity: ' ' }]).problems.join()).toMatch(/empty severity/)
    expect(validateNewRows(LEDGER, [{ ...row(), severity: 'SEVERE' }]).problems.join()).toMatch(/not one of CRITICAL/)
    expect(validateNewRows(LEDGER, [{ ...row(), status: '' }]).problems.join()).toMatch(/empty status/)
  })
})

// ── the script itself (red-team A1's lesson: test the runner, not only the rules) ──
describe('scripts/ledger-append.mjs, run as a process against a temp ledger', () => {
  const SCRIPT = join(__dirname, '../../scripts/ledger-append.mjs')
  const setup = (ledgerText: string, rowsJson: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
    mkdirSync(join(dir, 'reviews'))
    writeFileSync(join(dir, 'reviews/findings-ledger.csv'), ledgerText)
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rowsJson))
    return dir
  }
  const run = (dir: string) => {
    try {
      const env = { ...process.env, LEDGER_LOCK_WAIT_MS: '300' }
      return { code: 0, out: execFileSync(process.execPath, [SCRIPT, 'rows.json'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }) }
    } catch (e) {
      const err = e as { status: number; stderr: string }
      return { code: err.status, out: err.stderr }
    }
  }

  it('appends a valid row, and the row is there afterwards', () => {
    const dir = setup(LEDGER, [row()])
    expect(run(dir)).toMatchObject({ code: 0 })
    expect(parseCsv(readFileSync(join(dir, 'reviews/findings-ledger.csv'), 'utf8')).map((r) => r[0])).toEqual(['id', 'A-1', 'B-1'])
    expect(existsSync(join(dir, 'reviews/findings-ledger.csv.lock'))).toBe(false)
  })

  it('L1+L2: refuses, exits 1 and writes NOTHING when the existing ledger has an open quote', () => {
    const dir = setup(OPEN_QUOTE, [row()])
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/refused — nothing written[\s\S]*never closed/)
    expect(readFileSync(join(dir, 'reviews/findings-ledger.csv'), 'utf8')).toBe(OPEN_QUOTE)
  })

  it('L3: a lock left by a dead process names its holder and is not removed', () => {
    const dir = setup(LEDGER, [row()])
    const lock = join(dir, 'reviews/findings-ledger.csv.lock')
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, host: hostname(), startedAt: '2026-10-17T00:00:00.000Z' }))
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/held by pid 4194311 .* since 2026-10-17T00:00:00.000Z \(process NOT running\)/)
    expect(existsSync(lock)).toBe(true)
    expect(readFileSync(join(dir, 'reviews/findings-ledger.csv'), 'utf8')).toBe(LEDGER)
  })
})
