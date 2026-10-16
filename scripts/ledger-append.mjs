#!/usr/bin/env node
/**
 * Q-095 — append findings to reviews/findings-ledger.csv safely.
 *
 *   node scripts/ledger-append.mjs rows.json     # an array of objects keyed by the header
 *   npm run ledger:append -- rows.json
 *
 * Refuses unless the existing ledger parses cleanly; validates every row (all
 * 12 columns as text, a known severity, a new unique id); guarantees the file
 * ends with a newline before appending; takes an exclusive lock so two agents
 * appending at once cannot interleave — the failure that once swallowed a
 * CRITICAL finding; and after writing, confirms each new id is a row of its
 * own. Every refusal happens before the write.
 */
import { appendFileSync, closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { appendText, validateNewRows, verifyAppended } from './lib/ledger.mjs'

const LEDGER = join(process.cwd(), 'reviews/findings-ledger.csv')
const LOCK = `${LEDGER}.lock`
// Overridable so the test of a held lock need not wait the full ten seconds.
const LOCK_WAIT_MS = Number(process.env.LEDGER_LOCK_WAIT_MS ?? 10_000)

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/ledger-append.mjs <rows.json>')
  process.exit(2)
}
let rows
try {
  rows = JSON.parse(readFileSync(input, 'utf8'))
} catch (e) {
  console.error(`refused — nothing written: cannot read ${input} as JSON (${e.message})`)
  process.exit(1)
}

/** Who holds the lock, from what it says about itself. */
function describeHolder() {
  let info
  try {
    info = JSON.parse(readFileSync(LOCK, 'utf8'))
  } catch {
    return 'the lock file names no holder (written by an older version of this script)'
  }
  let alive = 'unknown'
  if (info.host === hostname() && Number.isInteger(info.pid)) {
    try { process.kill(info.pid, 0); alive = 'running' } catch (e) { alive = e.code === 'ESRCH' ? 'NOT running' : 'unknown' }
  }
  return `held by pid ${info.pid} on ${info.host} since ${info.startedAt} (process ${alive})`
}

let fd = null
const until = Date.now() + LOCK_WAIT_MS
while (fd === null) {
  try {
    fd = openSync(LOCK, 'wx')
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    if (Date.now() > until) {
      // L3: say whose lock it is. The lock is never removed automatically — two
      // processes that both judge it stale would each delete the other's fresh
      // lock — so this names the evidence and leaves the decision to a person.
      console.error(
        `ledger is locked: ${LOCK}\n  ${describeHolder()}\n` +
        '  Remove the lock only if that process is NOT running; nothing was written.',
      )
      process.exit(1)
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
}
writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }))

let released = false
const release = () => {
  if (released) return
  released = true
  closeSync(fd)
  unlinkSync(LOCK)
}
// A handled signal waits for the synchronous append below to finish, so the
// `finally` releases the lock; SIGKILL cannot be handled, which is why the lock
// names its holder.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { release(); process.exit(130) })

try {
  const text = readFileSync(LEDGER, 'utf8')
  const { header, problems } = validateNewRows(text, rows)
  if (problems.length) {
    console.error(`refused — nothing written:\n  ${problems.join('\n  ')}`)
    process.exitCode = 1
  } else {
    appendFileSync(LEDGER, appendText(text, header, rows))
    const ids = rows.map((r) => String(r.id).trim())
    const after = verifyAppended(readFileSync(LEDGER, 'utf8'), ids)
    if (after.length) {
      console.error(`post-append check FAILED — the rows were written; inspect the ledger now:\n  ${after.join('\n  ')}`)
      process.exitCode = 1
    } else console.log(`appended ${rows.length} row(s): ${ids.join(', ')}`)
  }
} finally {
  release()
}
