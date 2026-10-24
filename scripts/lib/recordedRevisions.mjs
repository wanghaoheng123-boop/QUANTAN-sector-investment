/**
 * Q-144 (re-gate R2-1): the recorded way out of a quarantine.
 *
 * A refused bar used to have no exit: the fixture kept its value, every later
 * refresh disagreed with it again, and the instrument froze while the weekly run
 * went red (BTC for nine weeks; CAT from 2026-10-18). A row in
 * `scripts/lib/acceptedRevisions.json` lets the next run adopt the vendor's bar,
 * but only within limits the exit-path review (reviews/q144-exit-path-
 * data-integrity-2026-10-24.md) asked for:
 *
 *   - VOLUME ONLY (E-2). A moved open, high, low or close is the event design
 *     invariant I4 exists to catch, and no exit for it has been designed or
 *     reviewed, so a row cannot name a price field.
 *   - A BOUNDED BAND (E-2). Each row states the signed relative change it
 *     accepts as [low, high]: the interval excludes 0 (a direction is part of
 *     what was reviewed) and is at most MAX_BAND_WIDTH wide.
 *   - ONE FIXTURE VERSION, UNTIL A DATE (E-1). A row names the `fetchedAt` of
 *     the fixture the reviewer saw. Adopting rewrites the fixture with a new
 *     `fetchedAt`, so going forward a row fires once. Restoring the old fixture
 *     (a revert) restores that `fetchedAt`, and the row would fire again — so a
 *     row also carries `expires`, at most MAX_ROW_LIFETIME_DAYS after it was
 *     decided, after which it is ignored.
 *
 * Plain .mjs: read by scripts/fetchBacktestData.mjs without a build step.
 */
import { readFileSync } from 'node:fs'
import { keyDate } from './dataVintage.mjs'

/** The only field a row may adopt (exit-path review E-2). */
export const ADOPTABLE_FIELDS = new Set(['volume'])

/**
 * Widest band a row may state, as a difference of signed relative changes.
 * The band has to absorb the vendor's ordinary settle noise on top of the
 * revision it accepts: tail-bar volume revisions measured p99 3.9e-3 over 605
 * pairs (Q144-R2-1), and the 54 peers' 2026-10-09 volume moved at most 3.6e-3
 * between vintages (exit-path review §3). 0.05 is about 13x that p99 across the
 * whole band; anything wider is no longer "this revision".
 */
export const MAX_BAND_WIDTH = 0.05

/** A row expires at most this many days after it was decided (E-1). */
export const MAX_ROW_LIFETIME_DAYS = 31

const ROW_KEYS = ['ticker', 'date', 'fixtureFetchedAt', 'changes', 'decision', 'reason', 'evidence', 'decidedAt', 'decidedBy', 'expires']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const DAY_MS = 86_400_000

/**
 * @typedef {{ ticker: string, date: string, fixtureFetchedAt: string, changes: Record<string, [number, number]>, decision: 'adopt', reason: string, evidence: string, decidedAt: string, decidedBy: string, expires: string }} RecordedRevision
 */

/**
 * Why a row is malformed, or null when it is well formed. The committed file is
 * checked by a test; at run time a malformed row is ignored, which refuses the
 * bar it was meant to accept (fail closed). A row holds no vendor values:
 * dates, fields and signed relative bounds only (I8).
 */
export function recordedRevisionProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'not an object'
  const keys = Object.keys(row)
  if (keys.length !== ROW_KEYS.length || !ROW_KEYS.every((k) => Object.hasOwn(row, k))) return `keys must be exactly ${ROW_KEYS.join(', ')}`
  if (typeof row.ticker !== 'string' || !/^[A-Z][A-Z.-]{0,9}$/.test(row.ticker)) return 'ticker'
  if (typeof row.date !== 'string' || !ISO_DATE.test(row.date)) return 'date must be YYYY-MM-DD'
  if (typeof row.fixtureFetchedAt !== 'string' || !ISO_UTC.test(row.fixtureFetchedAt)) return "fixtureFetchedAt must be the fixture's ISO fetchedAt"
  if (row.decision !== 'adopt') return "decision must be 'adopt'"
  for (const k of ['reason', 'evidence', 'decidedBy']) if (typeof row[k] !== 'string' || row[k].trim().length < 10) return `${k} must say something`
  for (const k of ['decidedAt', 'expires']) if (typeof row[k] !== 'string' || !ISO_DATE.test(row[k]) || !Number.isFinite(Date.parse(row[k]))) return `${k} must be YYYY-MM-DD`
  const lifetimeDays = (Date.parse(row.expires) - Date.parse(row.decidedAt)) / DAY_MS
  if (!(lifetimeDays > 0 && lifetimeDays <= MAX_ROW_LIFETIME_DAYS)) return `expires must be after decidedAt and at most ${MAX_ROW_LIFETIME_DAYS} days later`
  const changes = row.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) return 'changes must name a field'
  for (const [f, bound] of Object.entries(changes)) {
    if (!ADOPTABLE_FIELDS.has(f)) return `changes: only ${[...ADOPTABLE_FIELDS].join(', ')} can be adopted, not ${f}`
    if (!Array.isArray(bound) || bound.length !== 2 || !bound.every((x) => typeof x === 'number' && Number.isFinite(x))) return `changes.${f} must be [low, high]`
    const [lo, hi] = bound
    if (!(lo < hi)) return `changes.${f}: low must be below high`
    if (lo <= 0 && hi >= 0) return `changes.${f}: the interval must exclude 0 (a direction is part of what was reviewed)`
    // 1e-12: [0.5, 0.55] is 0.05 wide on paper and 0.050000000000000044 in floating point.
    if (hi - lo > MAX_BAND_WIDTH + 1e-12) return `changes.${f}: a band wider than ${MAX_BAND_WIDTH} is not one reviewed revision`
    if (lo < -1) return `changes.${f}: a relative change below -1 is not a revision`
  }
  return null
}

/**
 * The rows that adopt this refresh's restated bars, or null when the refresh
 * must be refused. All of these must hold:
 *   - nothing is missing, and EVERY restated bar is covered by a row;
 *   - the row is well formed, for this ticker and this bar date, unexpired at
 *     `nowMs`, and names the fixture version on disk (`prevFetchedAt`);
 *   - the moved fields are exactly the row's fields, and each signed relative
 *     change lies inside the row's band (ends included).
 *
 * @param {{ ticker: string, prevFetchedAt: unknown, nowMs: number, verdict: { missing: number, restatedBars: Array<{ key: string, fields: string[], signedChanges: Record<string, number> }> }, acceptances: unknown[] }} args
 * @returns {RecordedRevision[] | null}
 */
export function matchRecordedRevisions({ ticker, prevFetchedAt, nowMs, verdict, acceptances }) {
  if (verdict.missing !== 0 || verdict.restatedBars.length === 0) return null
  const rows = (Array.isArray(acceptances) ? acceptances : []).filter(
    (r) => recordedRevisionProblem(r) === null && r.ticker === ticker && nowMs < Date.parse(r.expires),
  )
  const matched = []
  for (const bar of verdict.restatedBars) {
    const row = rows.find((r) => {
      if (r.date !== keyDate(bar.key) || r.fixtureFetchedAt !== prevFetchedAt) return false
      const fields = Object.keys(r.changes)
      if (fields.length !== bar.fields.length || !bar.fields.every((f) => fields.includes(f))) return false
      return fields.every((f) => {
        const c = bar.signedChanges[f]
        const [lo, hi] = r.changes[f]
        return Number.isFinite(c) && c >= lo && c <= hi
      })
    })
    if (!row || matched.includes(row)) return null
    matched.push(row)
  }
  return matched
}

/**
 * Why no row adopted this ticker's refusal, for the refusal message: a row for
 * the ticker that is malformed, expired, or for another version or revision.
 * Null when there is no row for the ticker at all.
 */
export function unmatchedRowNote({ ticker, nowMs, acceptances }) {
  const forTicker = (Array.isArray(acceptances) ? acceptances : []).filter((r) => r && typeof r === 'object' && r.ticker === ticker)
  if (forTicker.length === 0) return null
  const problems = forTicker.map((r) => recordedRevisionProblem(r)).filter(Boolean)
  if (problems.length > 0) return `A recorded row for ${ticker} is malformed and was ignored (${problems[0]}).`
  if (forTicker.every((r) => !(nowMs < Date.parse(r.expires)))) return `A recorded row for ${ticker} has expired and was ignored.`
  return `A recorded row for ${ticker} exists but does not match this fixture version and revision, so it is not applied.`
}

/**
 * The rows in the acceptances file. An unreadable or malformed FILE means no
 * rows — every revision is refused as before — never "accept", and never a
 * thrown error (that would turn one bad file into a failed run that discards
 * every clean refresh).
 *
 * @param {string} file
 * @param {(message: string) => void} [warn]
 * @returns {unknown[]}
 */
export function loadRecordedRevisions(file, warn = (m) => console.warn(m)) {
  try {
    const rows = JSON.parse(readFileSync(file, 'utf8'))?.rows
    if (!Array.isArray(rows)) throw new Error('no rows array')
    return rows
  } catch (e) {
    warn(`::warning title=Recorded revisions unreadable::${e instanceof Error ? e.message : String(e)}; no revision will be adopted this run`)
    return []
  }
}
