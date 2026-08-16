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
 * KNOWN DEBT, asserted rather than hidden: 7 rows are malformed on `main` and
 * predate this guard. They are pinned below so the count cannot grow. Repairing
 * them is Q-095; letting new ones appear is what this test prevents.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const LEDGER = join(__dirname, '../../reviews/findings-ledger.csv')

/** Minimal RFC4180-ish parser: handles quoted fields containing commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const rows = parseCsv(readFileSync(LEDGER, 'utf8'))
const header = rows[0]
const dataRows = rows.slice(1)

/**
 * Rows malformed on `main` before this guard existed. Pinned by ID so the debt
 * is visible and cannot silently grow. Do not add to this list to make a new
 * failure pass — fix the row.
 */
const KNOWN_MALFORMED_IDS = new Set([
  'F4.5',   // 11 cols — status cell blank
  'F5.4',   // 11 cols — status cell blank
  'F5.9',   // 13 cols — unescaped comma
  'F6.2',   // 15 cols — unescaped commas
  'F6.3',   // 14 cols — unescaped commas
  'F6.4',   // 16 cols — unescaped commas
  'WSA-FG', // 11 cols — status cell blank
])

describe('findings-ledger.csv — the risk register stays parseable', () => {
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

  it('has no NEW rows whose column count differs from the header', () => {
    const offenders = dataRows
      .filter((r) => r.length !== header.length)
      .map((r) => `${r[0]} (${r.length} cols, expected ${header.length})`)
      .filter((desc) => !KNOWN_MALFORMED_IDS.has(desc.split(' ')[0]))

    expect(offenders).toEqual([])
  })

  it('the known-malformed debt has not grown', () => {
    const malformed = dataRows.filter((r) => r.length !== header.length)
    expect(malformed.length).toBeLessThanOrEqual(KNOWN_MALFORMED_IDS.size)
  })

  it('every row has a non-empty id, and ids are unique', () => {
    const ids = dataRows.map((r) => r[0]?.trim()).filter(Boolean)
    expect(ids.length).toBe(dataRows.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no row is a glued concatenation of two rows', () => {
    // The corruption signature: roughly double the header width in one row.
    const glued = dataRows
      .filter((r) => r.length >= 2 * header.length - 1)
      .map((r) => r[0])

    expect(glued).toEqual([])
  })

  it('the file ends with a newline so the next append cannot glue onto it', () => {
    // This is the actual root cause of the swallowed CRITICAL finding.
    expect(readFileSync(LEDGER, 'utf8').endsWith('\n')).toBe(true)
  })

  it('retains the CRITICAL Q-088 brand-inversion finding as its own row', () => {
    // The specific row that was lost. Named explicitly: a register that can
    // drop its most severe entry is not a register.
    const ids = dataRows.map((r) => r[0])
    expect(ids).toContain('Q088-1')
  })
})
