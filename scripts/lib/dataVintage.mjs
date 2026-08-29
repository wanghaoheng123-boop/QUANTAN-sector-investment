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

export function diffSeries(existing, incoming) {
  const prev = new Map((existing ?? []).map((c) => [KEY(c), c]))
  const next = new Map((incoming ?? []).map((c) => [KEY(c), c]))

  const appended = []
  const restated = []
  const missing = []
  const finalized = []

  // Recency is measured against the series ON DISK, by key order. A bar's age in
  // sessions is what distinguishes "the tape is still settling" from "the vendor
  // revised history", and nothing else does — magnitude alone would let a real
  // revision of an illiquid name through.
  const prevKeys = [...prev.keys()].sort()
  const ageOf = new Map(prevKeys.map((k, i) => [k, prevKeys.length - 1 - i]))

  for (const [k, c] of next) if (!prev.has(k)) appended.push(k)
  for (const [k, was] of prev) {
    const now = next.get(k)
    if (!now) {
      missing.push(k)
      continue
    }
    // PRICE first, and at any age. A moved open/high/low/close is the event I4
    // exists to catch, and it is never finalization.
    let priceMoved = false
    for (const field of ['open', 'high', 'low', 'close']) {
      if (!near(now[field], was[field])) {
        restated.push({ key: k, field, was: was[field], now: now[field] })
        priceMoved = true
        break
      }
    }
    if (priceMoved) continue

    if (near(now.volume, was.volume)) continue

    const recent = (ageOf.get(k) ?? Infinity) < FINALIZATION_SESSIONS
    const small = drift(was.volume, now.volume) <= FINALIZATION_MAX_VOLUME_DRIFT
    if (recent && small) {
      finalized.push({ key: k, field: 'volume', was: was.volume, now: now.volume })
    } else {
      restated.push({ key: k, field: 'volume', was: was.volume, now: now.volume })
    }
  }
  return { appended, restated, missing, finalized }
}

/**
 * Decide whether a refresh may be written.
 *
 * Appends are always fine. A restatement or a disappearing bar is a DATA event
 * that a human must see, so it fails closed (I2) rather than being absorbed
 * into the next benchmark run as signal drift.
 */
export function assessRefresh(existing, incoming) {
  const d = diffSeries(existing, incoming)
  // `finalized` deliberately does NOT block. It is reported so a human can see it
  // happening, which is the whole difference between absorbing a change silently
  // and accepting a known, named vendor behaviour.
  const ok = d.restated.length === 0 && d.missing.length === 0
  const reasons = []
  if (d.restated.length > 0) {
    const sample = d.restated
      .slice(0, 3)
      .map((r) => `${r.key} ${r.field} ${r.was} -> ${r.now}`)
      .join('; ')
    reasons.push(
      `VENDOR RESTATEMENT: ${d.restated.length} existing bar(s) changed value (${sample}). ` +
        'This is a data event, not signal drift. Investigate before overwriting.',
    )
  }
  if (d.missing.length > 0) {
    reasons.push(
      `HISTORY LOSS: ${d.missing.length} bar(s) present on disk are absent from the refresh ` +
        `(oldest ${d.missing[0]}). A pinned window should only ever append.`,
    )
  }
  return {
    ok,
    appended: d.appended.length,
    restated: d.restated.length,
    missing: d.missing.length,
    finalized: d.finalized.length,
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
