/**
 * Data vintage — reproducibility and restatement detection (design invariant I4).
 *
 * WHY (Q-102). `scripts/fetchBacktestData.mjs` rewrote the entire price history
 * IN PLACE every Sunday and pushed it to `main`, with the window re-anchored to
 * `Date.now()`. Two consequences, both live:
 *
 *   1. THE SAMPLE SLID. A fixed 1825-day lookback from "now" drops the oldest
 *      bars every week. Observed directly on 2026-08-21: regenerating the
 *      benchmark five days after the committed run moved `totalBuySignals`
 *      3410 -> 3394 and the effective sample 347 -> 345, with NO code change.
 *      Both floors in `reviews/invariants-baseline.md` are therefore measured
 *      against a sample that no longer exists.
 *   2. A RESTATEMENT WAS INVISIBLE. If the vendor revised a 2023 close, the
 *      overwrite absorbed it silently and the benchmark reported it as signal
 *      drift — the exact confusion I4 exists to prevent.
 *
 * This module is plain `.mjs` so the fetch script can use it without a TS build,
 * and every function here is PURE so the behaviour is unit-tested rather than
 * asserted in a comment.
 */

/**
 * Fixed window anchor. The start of the backtest window must NOT move.
 *
 * Pinning the start (while letting the end run to today) makes the history
 * APPEND-ONLY in practice: new bars arrive, old bars never vanish. That is what
 * makes a past benchmark run reproducible — you can always recompute over a
 * prefix, which a sliding window makes impossible.
 *
 * The date is not arbitrary: all 56 committed fixtures begin on exactly
 * 2021-08-17, so pinning here makes this change a NO-OP for the data already on
 * disk. A rounder date would have pulled in ~3 extra weeks of history on the
 * next refresh and moved every benchmark number — and the primary edge gate
 * currently sits 0.10pp above its floor, so that would likely have turned CI red
 * on a Sunday bot push that nobody was watching. Change this constant only
 * deliberately, and re-baseline the floors in the same PR when you do.
 */
export const WINDOW_START = '2021-08-17'

/** A bar is identified by its date; the OHLCV is the value that must not change. */
const KEY = (c) => String(c.time ?? c.date ?? '')

/** A bar key as a calendar date for messages: keys are epoch seconds. */
export const keyDate = (key) => {
  const n = Number(key)
  return Number.isFinite(n) && String(key).trim() !== '' ? new Date(n * 1000).toISOString().slice(0, 10) : String(key)
}

/** Seconds in a daily bar's period. */
export const DAY_SECONDS = 86_400

/**
 * How long after a daily bar's day has ENDED before it is stored.
 *
 * Q144-R2-4, measured 2026-10-18: the vendor's row for the just-finished BTC day
 * was all-null at every poll from 3.4 h to 5.0 h after the day ended, and
 * populated by 7.4 h. Whether the first published values equal the final ones
 * was not measured, and the same vendor has been seen changing every field of a
 * 22-hour-old bar, so the first hours after publication are not treated as
 * final. Twelve hours is above the measured publish delay with margin. At a
 * weekly cadence it costs one bar at most: the Sunday run (scheduled 22:00 UTC,
 * created 23:28-00:57 UTC over the last six runs) still stores the Friday
 * session and BTC's Saturday bar, and holds BTC's Sunday bar for a week.
 */
export const SETTLE_SECONDS = 12 * 3_600

/**
 * Q-144: is a daily bar FINISHED, and settled, at `nowSec`?
 *
 * A daily bar's timestamp is the START of its period. It is final only once a
 * whole day has passed, and stored only once SETTLE_SECONDS more have passed.
 * The weekly refresh asked Yahoo for daily bars through "now", so the last BTC
 * bar — BTC trades through the weekend and its daily bar spans the UTC day — was
 * a day still in progress: all 12 committed BTC vintages stored a tail fetched
 * 22.3-23.2 h into its own day (data-integrity Q144-D1). The next run found that
 * bar "restated" in every field and refused it, and BTC was refused in every
 * scheduled run from 2026-08-23 on; its fixture has not been written since
 * 2026-08-16. For an equity bar stamped at the 13:30 UTC open the rule is
 * conservative and waits until the evening of the next day, so a mid-week
 * dispatch never stores a session still in progress either.
 */
export function isBarComplete(bar, nowSec) {
  const t = Number(bar?.time)
  return Number.isFinite(t) && Number.isFinite(nowSec) && t + DAY_SECONDS + SETTLE_SECONDS <= nowSec
}

/**
 * Drop every bar that is not finished and settled at `nowSec`, wherever it sits
 * (Q144-R2-9: trimming only the tail kept an unfinished bar from an unsorted
 * response). A non-finite time is treated as unfinished rather than stored.
 */
export function dropUnfinishedBars(candles, nowSec) {
  const all = candles ?? []
  const kept = all.filter((c) => isBarComplete(c, nowSec))
  return { candles: kept, dropped: all.length - kept.length }
}

/** An ISO-8601 UTC timestamp as `new Date().toISOString()` writes it. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * Keys of the bars ON DISK that were unfinished when that file was written —
 * judged from the file's own `fetchedAt`, not from today.
 *
 * Such a bar was never a value of the finished bar: it was a 22-hour snapshot
 * of a 24-hour bar. Comparing the finished bar against it calls the bar
 * completing a "restatement". So a provisional bar is REPLACED by the vendor's
 * finished bar and reported as superseded, never compared.
 *
 * Q144-R2-2: this EXEMPTS bars from the restatement check, so it needs positive
 * evidence and fails to the strict check on anything else. A bar is provisional
 * only if it began at or before the write and its day had not ended at the
 * write, and only the LAST bar on disk can be: a file is written from one fetch,
 * and only its newest day can have been in progress. A `fetchedAt` that is not
 * an ISO timestamp, that makes a bar other than the last qualify, or that makes
 * no bar qualify, yields no provisional bars. The first version used
 * `!isBarComplete`, which also answers true for a bar it cannot evaluate: a
 * `fetchedAt` of "2026" or the epoch, or disk times in milliseconds, exempted
 * every bar on disk and let a refresh that doubled every price through.
 */
export function provisionalKeys(existing, fetchedAtIso) {
  const fetchedMs = typeof fetchedAtIso === 'string' && ISO_UTC.test(fetchedAtIso) ? Date.parse(fetchedAtIso) : NaN
  if (!Number.isFinite(fetchedMs)) return new Set()
  const fetchedSec = fetchedMs / 1000
  const bars = existing ?? []
  const unfinishedAtWrite = (c) => {
    const t = Number(c?.time)
    return Number.isFinite(t) && t <= fetchedSec && fetchedSec < t + DAY_SECONDS
  }
  const qualifying = bars.filter(unfinishedAtWrite)
  const last = bars[bars.length - 1]
  const lastIsNewest = last != null && bars.every((c) => Number(c?.time) <= Number(last.time))
  if (qualifying.length !== 1 || qualifying[0] !== last || !lastIsNewest) return new Set()
  return new Set([KEY(last)])
}

/** Round to the precision the vendor actually delivers, to avoid float noise. */
const near = (a, b) => {
  if (typeof a !== 'number' || typeof b !== 'number') return a === b
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b)
  return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9)
}

/**
 * Compare an incoming series against the one on disk.
 *
 * Returns the three categories that matter, kept separate ON PURPOSE: appended
 * bars are normal and expected, missing bars and restated bars are not, and
 * collapsing them into one "changed" count is how a restatement gets read as
 * drift.
 */
/**
 * Consolidated-tape volume finalization window, in trading sessions.
 *
 * THIS CONSTANT EXISTS BECAUSE THE GUARD BROKE THE PIPELINE. Shipped with zero
 * tolerance, the first live run after `Q-102` (`refresh-data.yml` run
 * 32670176978, 2026-08-23) refused **36 of 56 tickers** and the weekly refresh
 * failed silently for 13 days, leaving `scripts/backtestData/` stale while CI and
 * the benchmark went on reading it.
 *
 * Every single refusal had the same shape: the SAME most-recent bar, the VOLUME
 * field only, and a tiny upward revision — NVDA 75,504,000 -> 75,680,900 (+0.23%),
 * MSFT +0.08%, XOM +0.03%, largest observed +0.35%. That is not a restatement. US
 * consolidated tape volume is revised upward for a few sessions after the close as
 * late and off-exchange prints settle; every vendor exhibits it, and Yahoo is no
 * exception. A guard that refuses it refuses normal operation.
 *
 * Five sessions is a trading week — comfortably beyond the T+1/T+2 window in which
 * tape corrections actually settle, and still short enough that a genuine revision
 * of last month's volume is refused.
 */
export const FINALIZATION_SESSIONS = 5

/**
 * Upper bound on a volume revision that may be called finalization.
 *
 * Measured before it was set, per the house rule about floors: the largest drift
 * across all 36 refusals in the broken run was **0.35%**. This bound is ~14x that,
 * so routine finalization sits nowhere near the edge, while a volume that doubles
 * on a recent bar is still refused — that is a bad fetch or the wrong security,
 * not the tape settling.
 */
export const FINALIZATION_MAX_VOLUME_DRIFT = 0.05

/** Fractional change, safe for zero and non-finite inputs. */
const drift = (was, now) => {
  if (typeof was !== 'number' || typeof now !== 'number') return Infinity
  if (!Number.isFinite(was) || !Number.isFinite(now)) return Infinity
  if (was === 0) return now === 0 ? 0 : Infinity
  return Math.abs(now - was) / Math.abs(was)
}

/** Signed fractional change, NaN where it is undefined (a zero or non-numeric value). */
const signedChange = (was, now) =>
  typeof was === 'number' && typeof now === 'number' && Number.isFinite(was) && Number.isFinite(now) && was !== 0
    ? (now - was) / Math.abs(was)
    : Number.NaN

/**
 * Every moved field of a bar, the largest relative move among them, and each
 * field's signed relative change (what a recorded acceptance is matched on).
 * Q144-D3: the guard used to stop at the FIRST moved price field, so a bar whose
 * open moved 1.9e-5 was reported as that, while the same bar's low had moved
 * 2.4e-3 and its volume 5.2e-2.
 */
function movedFields(was, now) {
  const fields = ['open', 'high', 'low', 'close', 'volume'].filter((f) => !near(now[f], was[f]))
  const maxRelativeChange = fields.reduce((m, f) => Math.max(m, drift(was[f], now[f])), 0)
  const signedChanges = Object.fromEntries(fields.map((f) => [f, signedChange(was[f], now[f])]))
  return { fields, maxRelativeChange, signedChanges }
}

export function diffSeries(existing, incoming, { provisional = new Set() } = {}) {
  const prev = new Map((existing ?? []).map((c) => [KEY(c), c]))
  const next = new Map((incoming ?? []).map((c) => [KEY(c), c]))

  const appended = []
  const restated = []
  const missing = []
  const finalized = []
  const superseded = []

  // Recency is measured against the series ON DISK, by key order. A bar's age in
  // sessions is what distinguishes "the tape is still settling" from "the vendor
  // revised history", and nothing else does — magnitude alone would let a real
  // revision of an illiquid name through.
  const prevKeys = [...prev.keys()].sort()
  const ageOf = new Map(prevKeys.map((k, i) => [k, prevKeys.length - 1 - i]))

  for (const k of next.keys()) if (!prev.has(k)) appended.push(k)
  for (const [k, was] of prev) {
    const now = next.get(k)
    // Q-144: a bar that was unfinished when it was stored is replaced, not
    // compared (see provisionalKeys) — and if the refresh no longer carries it
    // (still unfinished), it was never history, so its absence is not a loss.
    if (!now && provisional.has(k)) {
      superseded.push({ key: k, fields: [], maxRelativeChange: 0, dropped: true })
      continue
    }
    if (!now) {
      missing.push(k)
      continue
    }
    if (provisional.has(k)) {
      const m = movedFields(was, now)
      if (m.fields.length > 0) superseded.push({ key: k, ...m })
      continue
    }
    // PRICE first, and at any age. A moved open/high/low/close is the event I4
    // exists to catch, and it is never finalization.
    const field = ['open', 'high', 'low', 'close'].find((f) => !near(now[f], was[f]))
    if (field) {
      restated.push({ key: k, field, was: was[field], now: now[field], ...movedFields(was, now) })
      continue
    }

    if (near(now.volume, was.volume)) continue

    const recent = (ageOf.get(k) ?? Infinity) < FINALIZATION_SESSIONS
    const small = drift(was.volume, now.volume) <= FINALIZATION_MAX_VOLUME_DRIFT
    if (recent && small) {
      finalized.push({ key: k, field: 'volume', was: was.volume, now: now.volume })
    } else {
      restated.push({ key: k, field: 'volume', was: was.volume, now: now.volume, ...movedFields(was, now) })
    }
  }
  return { appended, restated, missing, finalized, superseded }
}

/**
 * Decide whether a refresh may be written.
 *
 * Appends are always fine. A restatement or a disappearing bar is a DATA event
 * that a human must see, so it fails closed (I2) rather than being absorbed
 * into the next benchmark run as signal drift.
 */
export function assessRefresh(existing, incoming, { existingFetchedAt } = {}) {
  const d = diffSeries(existing, incoming, { provisional: provisionalKeys(existing, existingFetchedAt) })
  // `finalized` deliberately does NOT block. It is reported so a human can see it
  // happening, which is the whole difference between absorbing a change silently
  // and accepting a known, named vendor behaviour.
  const ok = d.restated.length === 0 && d.missing.length === 0
  const reasons = []
  if (d.restated.length > 0) {
    // Q144-D9 (I8): this printed raw `was -> now` vendor values into a PUBLIC
    // repository's workflow logs. It prints which fields moved and how far.
    const sample = d.restated
      .slice(0, 3)
      .map((r) => `${keyDate(r.key)} ${r.fields.join('/')} moved up to ${r.maxRelativeChange.toExponential(1)}`)
      .join('; ')
    reasons.push(
      `VENDOR RESTATEMENT: ${d.restated.length} existing bar(s) changed value (${sample}). ` +
        'This is a data event, not signal drift. Investigate before overwriting.',
    )
  }
  if (d.missing.length > 0) {
    reasons.push(
      `HISTORY LOSS: ${d.missing.length} bar(s) present on disk are absent from the refresh ` +
        `(oldest ${keyDate(d.missing[0])}). A pinned window should only ever append.`,
    )
  }
  return {
    ok,
    appended: d.appended.length,
    restated: d.restated.length,
    missing: d.missing.length,
    finalized: d.finalized.length,
    superseded: d.superseded.length,
    supersededBars: d.superseded,
    // Key, moved fields and relative sizes only: the raw `was`/`now` values
    // stay inside diffSeries, so no caller can print them (I8; exit-path E-6).
    restatedBars: d.restated.map(({ key, fields, maxRelativeChange, signedChanges }) => ({ key, fields, maxRelativeChange, signedChanges })),
    reasons,
  }
}

/** Stable content fingerprint of a series — the vintage identity of a fixture. */
export function seriesFingerprint(candles) {
  let h = 0x811c9dc5
  for (const c of candles ?? []) {
    const s = `${KEY(c)}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  return h.toString(16).padStart(8, '0')
}
