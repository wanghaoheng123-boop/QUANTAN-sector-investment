/**
 * Integrity guard for the risk register (Q-095).
 *
 * `CLAUDE.md` states plainly: "Known unfixed dangers | reviews/findings-ledger.csv
 * | this IS the risk register." So a silent corruption there is not a formatting
 * nit — it is the loss of a recorded danger.
 *
 * This exists because it happened. During the Q-088 review two agents appended
 * concurrently; one write left no trailing newline, the next row glued onto the
 * previous row's last field, and the resulting 23-column row SWALLOWED AN ENTIRE
 * CRITICAL FINDING. It was invisible to every CSV reader, including the checks
 * that were supposed to be watching, and it survived several passes before being
 * spotted by column-count audit rather than by reading.
 *
 * The seven rows that predated this guard (missing `line` fields, an unquoted
 * comma, backslash "escapes" CSV does not have) were repaired under Q-095, so
 * no malformed row is tolerated now. Append through `npm run ledger:append`
 * (scripts/ledger-append.mjs), which validates, locks and newline-terminates.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
// ONE reader for the guard and the append script. This file used to carry its
// own lenient copy, which read a quote left open at end of file as a valid
// 12-column row — so a swallowed CRITICAL finding passed (red-team L1).
import { ledgerProblems } from '../../scripts/lib/ledger.mjs'

const LEDGER = join(__dirname, '../../reviews/findings-ledger.csv')
const TEXT = readFileSync(LEDGER, 'utf8')
const { header: parsedHeader, rows: dataRows, problems } = ledgerProblems(TEXT)
// null only when the file does not parse, which the first test reports by name.
const header: string[] = parsedHeader ?? []

describe('findings-ledger.csv — the risk register stays parseable', () => {
  it('parses as strict RFC 4180 with every row at the header width', () => {
    // An open quote, a quote mid-field, or text after a closing quote each
    // swallow or split rows; ledgerProblems reports all three and short rows.
    expect(problems).toEqual([])
  })

  it('has the expected header', () => {
    expect(header[0]).toBe('id')
    expect(header).toContain('severity')
    expect(header).toContain('status')
    expect(header.length).toBeGreaterThan(8)
  })

  it('holds a realistic number of rows (guard against a vacuous pass)', () => {
    // If the parser silently returned nothing, every assertion below would pass
    // for the wrong reason.
    expect(dataRows.length).toBeGreaterThan(100)
  })

  it('every row has exactly the header\'s column count', () => {
    const offenders = dataRows
      .filter((r: string[]) => r.length !== header.length)
      .map((r: string[]) => `${r[0]} (${r.length} cols, expected ${header.length})`)
    expect(offenders).toEqual([])
  })

  it('every row has a non-empty id, and ids are unique', () => {
    const ids = dataRows.map((r: string[]) => r[0]?.trim()).filter(Boolean)
    expect(ids.length).toBe(dataRows.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no row is a glued concatenation of two rows', () => {
    // The corruption signature: roughly double the header width in one row.
    const glued = dataRows
      .filter((r: string[]) => r.length >= 2 * header.length - 1)
      .map((r: string[]) => r[0])

    expect(glued).toEqual([])
  })

  it('the file ends with a newline so the next append cannot glue onto it', () => {
    // This is the actual root cause of the swallowed CRITICAL finding.
    expect(TEXT.endsWith('\n')).toBe(true)
  })

  it('retains the CRITICAL Q-088 brand-inversion finding as its own row', () => {
    // The specific row that was lost. Named explicitly: a register that can
    // drop its most severe entry is not a register.
    const ids = dataRows.map((r: string[]) => r[0])
    expect(ids).toContain('Q088-1')
  })
})
