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
 * @typedef {{ appended: number, restated: number, missing: number, finalized: number, superseded: number }} Vintage
 * @typedef {{ ticker: string, sector: string, fetchedAt: string, windowStart: string, fingerprint: string, rows: number, vintage: Vintage, candles: Bar[] }} FixtureDoc
 */

/** @returns {{ ok: false, reason: string }} */
const refuse = (ticker, why) => ({ ok: false, reason: `REFUSED to save ${ticker}: ${why}` })

/**
 * @param {object} args
 * @param {string} args.ticker
 * @param {string} args.sector
 * @param {unknown} args.prev    the parsed fixture on disk, or undefined when there is none
 * @param {Bar[]} args.candles   every finite bar the vendor returned
 * @param {number} args.nowMs    the clock, in milliseconds
 * @returns {{ ok: true, doc: FixtureDoc, log: string[] } | { ok: false, reason: string }}
 *   On success, `doc` is the fixture to write and `log` the lines to print
 *   (relative sizes and dates only: the workflow log is public, I8).
 */
export function planSave({ ticker, sector, prev, candles, nowMs }) {
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

  let vintage = { appended: kept.length, restated: 0, missing: 0, finalized: 0, superseded: 0 }
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
    if (!verdict.ok) return refuse(ticker, verdict.reasons.join(' | '))
    vintage = {
      appended: verdict.appended,
      restated: verdict.restated,
      missing: verdict.missing,
      finalized: verdict.finalized,
      superseded: verdict.superseded,
    }
    if (verdict.appended > 0 || verdict.finalized > 0 || verdict.superseded > 0) {
      const fin = verdict.finalized > 0 ? `, ${verdict.finalized} volume finalization(s)` : ''
      const sup = verdict.superseded > 0 ? `, ${verdict.superseded} unfinished bar(s) replaced by the finished bar` : ''
      log.push(`[${ticker}] +${verdict.appended} new bar(s), 0 restated${fin}${sup}`)
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
