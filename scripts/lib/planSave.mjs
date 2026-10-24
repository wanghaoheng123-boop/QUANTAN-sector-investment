/**
 * What the weekly refresh writes for one instrument — a PURE function of the
 * fixture on disk, the fetched bars and the clock.
 *
 * Q144-R2-5 (data-integrity re-gate, 2026-10-18). These decisions used to be
 * made inline in `saveResult` in `scripts/fetchBacktestData.mjs`, which fetches
 * and writes on import, so no test could reach them. Of twenty one-line
 * mutations, a clock in milliseconds where seconds were meant, a hold-back that
 * returned the unfiltered bars, and a stale or epoch `fetchedAt` all passed every
 * vintage test — the first two silently reinstate the stored-partial-bar defect
 * Q-144 closed. The script now reads the file, calls this with `Date.now()`, and
 * writes or throws; the hold-back and the `fetchedAt` stamp come from the SAME
 * clock value, so they cannot disagree.
 */
import { WINDOW_START, assessRefresh, dropUnfinishedBars, keyDate, seriesFingerprint } from './dataVintage.mjs'

/**
 * Fixture integrity floors (R2 mitigation). The benchmark needs >= 252 rows per
 * instrument (200-bar warmup + signal window). A degraded response (rate limit,
 * partial outage) can return a short series; without a floor it would overwrite
 * a good five-year fixture, the benchmark's `>= 252` filter would drop the
 * instrument, and the loss would read as signal drift instead of data corruption.
 */
export const MIN_ABSOLUTE_ROWS = 252
/** Refuse a refresh more than 5% shorter than the fixture it replaces. */
export const MAX_SHRINK_PCT = 0.05

/**
 * The clock must be milliseconds since the epoch and not before the window
 * starts. A clock in SECONDS (~1.8e9) reads as January 1970 in milliseconds, and
 * the epoch is 0; both are below this floor and refused, instead of stamping the
 * fixture with a `fetchedAt` that misdates every bar on the next run.
 */
const MIN_PLAUSIBLE_NOW_MS = Date.parse(`${WINDOW_START}T00:00:00Z`)

/**
 * @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number, dividend?: number }} Bar
 * @typedef {{ appended: number, restated: number, missing: number, finalized: number, superseded: number, accepted: number }} Vintage
 * @typedef {{ ticker: string, date: string, fixtureFetchedAt: string, changes: Record<string, [number, number]>, decision: 'adopt', reason: string, evidence: string, decidedAt: string, decidedBy: string }} RecordedRevision
 * @typedef {{ ticker: string, sector: string, fetchedAt: string, windowStart: string, fingerprint: string, rows: number, vintage: Vintage, candles: Bar[] }} FixtureDoc
 */

/** @returns {{ ok: false, reason: string }} */
const refuse = (ticker, why) => ({ ok: false, reason: `REFUSED to save ${ticker}: ${why}` })

const BAR_FIELDS = new Set(['open', 'high', 'low', 'close', 'volume'])
const ROW_KEYS = ['ticker', 'date', 'fixtureFetchedAt', 'changes', 'decision', 'reason', 'evidence', 'decidedAt', 'decidedBy']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * Why a recorded-revision row is malformed, or null when it is well formed.
 * The committed file is checked by a test; at run time a malformed row is
 * ignored, which refuses the bar it was meant to accept (fail closed). A row
 * holds no vendor values: dates, fields and signed relative bounds only (I8).
 */
export function recordedRevisionProblem(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'not an object'
  const keys = Object.keys(row).sort()
  if (keys.join() !== [...ROW_KEYS].sort().join()) return `keys must be exactly ${ROW_KEYS.join(', ')}`
  if (typeof row.ticker !== 'string' || !/^[A-Z][A-Z.-]{0,9}$/.test(row.ticker)) return 'ticker'
  if (typeof row.date !== 'string' || !ISO_DATE.test(row.date)) return 'date must be YYYY-MM-DD'
  if (typeof row.fixtureFetchedAt !== 'string' || !ISO_UTC.test(row.fixtureFetchedAt)) return 'fixtureFetchedAt must be the fixture\'s ISO fetchedAt'
  if (row.decision !== 'adopt') return "decision must be 'adopt'"
  for (const k of ['reason', 'evidence', 'decidedBy']) if (typeof row[k] !== 'string' || row[k].trim().length < 10) return `${k} must say something`
  if (typeof row.decidedAt !== 'string' || !ISO_DATE.test(row.decidedAt)) return 'decidedAt must be YYYY-MM-DD'
  const changes = row.changes
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) return 'changes must name at least one field'
  for (const [f, bound] of Object.entries(changes)) {
    if (!BAR_FIELDS.has(f)) return `changes: ${f} is not a bar field`
    if (!Array.isArray(bound) || bound.length !== 2 || !bound.every((x) => typeof x === 'number' && Number.isFinite(x))) return `changes.${f} must be [low, high]`
    const [lo, hi] = bound
    if (!(lo < hi)) return `changes.${f}: low must be below high`
    if (lo <= 0 && hi >= 0) return `changes.${f}: the interval must exclude 0 (a direction is part of what was reviewed)`
    if (lo < -1 || hi > 10) return `changes.${f}: a relative change outside [-1, 10] is not a revision`
  }
  return null
}

/**
 * Q-144 (re-gate R2-1): the recorded way out of a quarantine.
 *
 * A refused bar used to have no exit: the fixture kept its value, every later
 * refresh disagreed with it again, and the instrument froze while the run went
 * red every week (BTC for nine weeks; CAT from 2026-10-18). A human now reviews
 * the event and records a row; the next run adopts the vendor's bar if, and
 * only if, the revision is exactly the one reviewed:
 *
 *   - same ticker and bar date, and the fixture on disk is the very version the
 *     reviewer saw (`fixtureFetchedAt` equals its `fetchedAt`). Adopting rewrites
 *     the fixture with a new `fetchedAt`, so a row can fire once and never again;
 *   - the moved fields are exactly the row's fields, and each field's signed
 *     relative change lies inside the row's interval, which excludes 0;
 *   - nothing is missing, and EVERY restated bar is covered by a row.
 *
 * Anything else refuses as before. Returns the rows that matched, or null.
 *
 * @param {{ ticker: string, prevFetchedAt: unknown, verdict: { missing: number, restatedBars: Array<{ key: string, fields: string[], signedChanges: Record<string, number> }> }, acceptances: unknown[] }} args
 * @returns {RecordedRevision[] | null}
 */
export function matchRecordedRevisions({ ticker, prevFetchedAt, verdict, acceptances }) {
  if (verdict.missing !== 0 || verdict.restatedBars.length === 0) return null
  const rows = (acceptances ?? []).filter((r) => recordedRevisionProblem(r) === null && r.ticker === ticker)
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
 * @param {object} args
 * @param {string} args.ticker
 * @param {string} args.sector
 * @param {unknown} args.prev    the parsed fixture on disk, or undefined when there is none
 * @param {Bar[]} args.candles   every finite bar the vendor returned
 * @param {number} args.nowMs    the clock, in milliseconds
 * @param {unknown[]} [args.acceptances]  recorded revisions (scripts/lib/acceptedRevisions.json)
 * @returns {{ ok: true, doc: FixtureDoc, log: string[] } | { ok: false, reason: string }}
 *   On success, `doc` is the fixture to write and `log` the lines to print
 *   (relative sizes and dates only: the workflow log is public, I8).
 */
export function planSave({ ticker, sector, prev, candles, nowMs, acceptances = [] }) {
  if (!Number.isFinite(nowMs) || nowMs < MIN_PLAUSIBLE_NOW_MS) {
    throw new Error(`planSave(${ticker}): clock ${nowMs} is not milliseconds since the epoch after ${WINDOW_START}`)
  }
  const log = []
  const { candles: kept, dropped: heldBack } = dropUnfinishedBars(candles, Math.floor(nowMs / 1000))
  if (heldBack > 0) {
    log.push(`[${ticker}] held back ${heldBack} unfinished or unsettled bar(s); they are stored once their day has ended and settled`)
  }

  if (kept.length < MIN_ABSOLUTE_ROWS) {
    return refuse(ticker, `${kept.length} rows < absolute floor ${MIN_ABSOLUTE_ROWS} (degraded fetch — keeping existing fixture)`)
  }

  let vintage = { appended: kept.length, restated: 0, missing: 0, finalized: 0, superseded: 0, accepted: 0 }
  if (prev !== undefined) {
    // Valid JSON of the WRONG SHAPE is the residual fail-open: assessRefresh
    // called with `undefined` reports every incoming bar as an append and
    // returns ok, so a fixture whose `candles` key was lost would be silently
    // overwritten by a guard that believes it checked something.
    const prevCandles = prev && typeof prev === 'object' ? prev.candles : undefined
    if (!Array.isArray(prevCandles) || prevCandles.length === 0) {
      return refuse(
        ticker,
        'existing fixture has no usable candles array, so a refresh cannot be proven to be append-only. Repair or delete the fixture deliberately.',
      )
    }
    if (kept.length < prevCandles.length * (1 - MAX_SHRINK_PCT)) {
      return refuse(
        ticker,
        `${kept.length} rows is >${MAX_SHRINK_PCT * 100}% below existing ${prevCandles.length} (likely a degraded fetch — keeping existing fixture)`,
      )
    }
    // Q-102: a restatement is a DATA EVENT, not signal drift. Appends pass; a
    // changed or vanished historical bar fails closed (I2). Q-144: the file's
    // own fetchedAt says which of its bars was unfinished when it was written;
    // that bar is replaced by the finished bar, not compared against it.
    const verdict = assessRefresh(prevCandles, kept, { existingFetchedAt: prev.fetchedAt })
    const accepted = verdict.ok ? [] : matchRecordedRevisions({ ticker, prevFetchedAt: prev.fetchedAt, verdict, acceptances })
    if (accepted === null) {
      const recorded = (acceptances ?? []).some((r) => r && typeof r === 'object' && r.ticker === ticker)
      const note = recorded ? ` | A recorded acceptance exists for ${ticker} but does not match this revision exactly, so it is not applied.` : ''
      return refuse(ticker, verdict.reasons.join(' | ') + note)
    }
    vintage = {
      appended: verdict.appended,
      restated: verdict.restated,
      missing: verdict.missing,
      finalized: verdict.finalized,
      superseded: verdict.superseded,
      accepted: accepted.length,
    }
    for (const row of accepted) {
      const sizes = Object.entries(row.changes).map(([f, [lo, hi]]) => `${f} within [${lo}, ${hi}]`).join(', ')
      log.push(`::notice title=${ticker} recorded revision adopted::${row.date} adopted under the row decided ${row.decidedAt} (${sizes})`)
    }
    if (verdict.appended > 0 || verdict.finalized > 0 || verdict.superseded > 0 || accepted.length > 0) {
      const fin = verdict.finalized > 0 ? `, ${verdict.finalized} volume finalization(s)` : ''
      const sup = verdict.superseded > 0 ? `, ${verdict.superseded} unfinished bar(s) replaced by the finished bar` : ''
      const acc = accepted.length > 0 ? ' (adopted under a recorded acceptance)' : ''
      log.push(`[${ticker}] +${verdict.appended} new bar(s), ${verdict.restated} restated${acc}${fin}${sup}`)
    }
    for (const b of verdict.supersededBars) {
      const what = b.dropped
        ? 'no longer served (still unfinished)'
        : `${b.fields.join('/')} moved up to ${b.maxRelativeChange.toExponential(1)}`
      log.push(`::notice title=${ticker} unfinished bar replaced::${keyDate(b.key)} was stored before its day ended; ${what}`)
    }
  }

  return {
    ok: true,
    log,
    doc: {
      ticker,
      sector,
      fetchedAt: new Date(nowMs).toISOString(),
      // Vintage identity: the window this series claims to cover and a
      // fingerprint of its contents. Without these a "reproducible" run is a
      // claim nobody can check.
      windowStart: WINDOW_START,
      fingerprint: seriesFingerprint(kept),
      rows: kept.length,
      vintage,
      candles: kept,
    },
  }
}
