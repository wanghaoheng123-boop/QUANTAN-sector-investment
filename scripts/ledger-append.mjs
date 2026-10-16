#!/usr/bin/env node
/**
 * Q-095 — append findings to reviews/findings-ledger.csv safely.
 *
 *   node scripts/ledger-append.mjs rows.json     # an array of objects keyed by the header
 *   npm run ledger:append -- rows.json
 *
 * Validates every row (all 12 columns, no unknown keys, a new unique id),
 * guarantees the file ends with a newline before appending, and takes an
 * exclusive lock so two agents appending at once cannot interleave — the
 * failure that once swallowed a CRITICAL finding. Writes nothing on any error.
 */
import { appendFileSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { appendText, parseCsv, validateNewRows } from './lib/ledger.mjs'

const LEDGER = join(process.cwd(), 'reviews/findings-ledger.csv')
const LOCK = `${LEDGER}.lock`
const LOCK_WAIT_MS = 10_000

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/ledger-append.mjs <rows.json>')
  process.exit(2)
}
const rows = JSON.parse(readFileSync(input, 'utf8'))

let fd = null
const until = Date.now() + LOCK_WAIT_MS
while (fd === null) {
  try {
    fd = openSync(LOCK, 'wx')
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    if (Date.now() > until) {
      console.error(`ledger is locked (${LOCK}); another append is running, or a stale lock needs removing`)
      process.exit(1)
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
}
try {
  const text = readFileSync(LEDGER, 'utf8')
  const { header, problems } = validateNewRows(text, rows)
  if (problems.length) {
    console.error(`refused — nothing written:\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
  } else {
    appendFileSync(LEDGER, appendText(text, header, rows))
    const after = parseCsv(readFileSync(LEDGER, 'utf8'))
    const bad = after.filter((r) => r.length !== header.length)
    if (bad.length) {
      console.error(`post-append check: ${bad.length} malformed row(s) — inspect the ledger now`)
      process.exitCode = 1
    } else console.log(`appended ${rows.length} row(s): ${rows.map((r) => r.id).join(', ')}`)
  }
} finally {
  closeSync(fd)
  unlinkSync(LOCK)
}
