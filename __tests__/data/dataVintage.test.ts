import { describe, it, expect } from 'vitest'
// Plain .mjs so the fetch script can import it without a TS build step.
import {
  diffSeries,
  assessRefresh,
  seriesFingerprint,
  WINDOW_START,
  FINALIZATION_SESSIONS,
  FINALIZATION_MAX_VOLUME_DRIFT,
  DAY_SECONDS,
  isBarComplete,
  dropUnfinishedBars,
  provisionalKeys,
  keyDate,
  SETTLE_SECONDS,
} from '../../scripts/lib/dataVintage.mjs'
import { planSave, MIN_ABSOLUTE_ROWS, MAX_SHRINK_PCT } from '../../scripts/lib/planSave.mjs'

const bar = (time: number, close: number, extra: Record<string, number> = {}) => ({
  time, open: close, high: close + 1, low: close - 1, close, volume: 100, ...extra,
})

describe('diffSeries — appends, restatements and losses are kept SEPARATE', () => {
  it('an appended bar is an append, not a change', () => {
    const d = diffSeries([bar(1, 10)], [bar(1, 10), bar(2, 11)])
    expect(d).toMatchObject({ appended: ['2'], restated: [], missing: [] })
  })

  it('a changed historical close is a RESTATEMENT', () => {
    // Vary ONLY the close: the helper ties open to close, and the detector
    // reports the first differing field, so a lazier fixture would have
    // asserted 'open' and taught nothing.
    const was = { time: 1, open: 5, high: 20, low: 1, close: 10, volume: 100 }
    const now = { ...was, close: 99 }
    const d = diffSeries([was], [now])
    expect(d.restated).toHaveLength(1)
    expect(d.restated[0]).toMatchObject({ key: '1', field: 'close', was: 10, now: 99 })
  })

  it('a vanished historical bar is a LOSS', () => {
    expect(diffSeries([bar(1, 10), bar(2, 11)], [bar(2, 11)]).missing).toEqual(['1'])
  })

  it('detects a restatement in any OHLCV field, not just close', () => {
    expect(diffSeries([bar(1, 10)], [bar(1, 10, { volume: 999 })]).restated).toHaveLength(1)
  })

  it('does not report float noise as a restatement', () => {
    // Vendor round-trips through JSON; a bit of representation drift must not
    // masquerade as a revision or the guard becomes noise and gets ignored.
    expect(diffSeries([bar(1, 10)], [bar(1, 10 + 1e-12)]).restated).toEqual([])
  })
})

describe('assessRefresh — appends pass, data events FAIL CLOSED', () => {
  it('passes a pure append', () => {
    expect(assessRefresh([bar(1, 10)], [bar(1, 10), bar(2, 11)])).toMatchObject({ ok: true, appended: 1 })
  })

  it('refuses a restatement and says it is not signal drift', () => {
    const v = assessRefresh([bar(1, 10)], [bar(1, 99)])
    expect(v.ok).toBe(false)
    expect(v.reasons[0]).toMatch(/RESTATEMENT/)
    expect(v.reasons[0]).toMatch(/not signal drift/)
  })

  it('refuses history loss — a pinned window may only ever append', () => {
    const v = assessRefresh([bar(1, 10), bar(2, 11)], [bar(2, 11)])
    expect(v.ok).toBe(false)
    expect(v.reasons[0]).toMatch(/HISTORY LOSS/)
  })

  it('treats a first-ever save (no existing series) as all-append', () => {
    expect(assessRefresh(undefined, [bar(1, 10)])).toMatchObject({ ok: true, appended: 1 })
  })
})

describe('seriesFingerprint — vintage identity', () => {
  it('is stable for identical series', () => {
    expect(seriesFingerprint([bar(1, 10)])).toBe(seriesFingerprint([bar(1, 10)]))
  })

  it('changes when any value changes', () => {
    expect(seriesFingerprint([bar(1, 10)])).not.toBe(seriesFingerprint([bar(1, 10.01)]))
  })

  it('changes when a bar is appended', () => {
    expect(seriesFingerprint([bar(1, 10)])).not.toBe(seriesFingerprint([bar(1, 10), bar(2, 11)]))
  })
})

describe('I4 — the backtest window start is PINNED, not re-anchored', () => {
  it('WINDOW_START is a fixed date', () => {
    expect(WINDOW_START).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('the fetch script anchors on it and never on Date.now()', async () => {
    // The defect this closes: `period1: new Date(Date.now() - PERIOD_DAYS * 86400000)`
    // slid the window forward every run, dropping the oldest bars, so no past
    // benchmark run could be reproduced. Observed 2026-08-21: five days moved
    // totalBuySignals 3410 -> 3394 with no code change.
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(join(__dirname, '../../scripts/fetchBacktestData.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(src).not.toMatch(/period1:\s*new Date\(\s*Date\.now\(\)/)
    expect(src).toMatch(/period1:\s*new Date\(WINDOW_START\)/)
  })
})

/**
 * Volume finalization — the calibration that broke the pipeline.
 *
 * Shipped with zero tolerance, this guard refused **36 of 56 tickers** on its
 * first live run (`refresh-data.yml` run 32670176978, 2026-08-23) and the weekly
 * refresh then failed silently for 13 days while CI and the benchmark went on
 * reading the frozen fixtures.
 *
 * Every refusal had the same shape: the SAME most-recent bar, the VOLUME field
 * only, revised slightly upward. US consolidated tape volume settles for a few
 * sessions after the close as late and off-exchange prints report. That is normal
 * vendor behaviour, and a guard that refuses normal behaviour is not strict, it is
 * broken — and worse, it DEADLOCKS: a refused ticker keeps its stale value, so the
 * next week's fetch disagrees with it again, forever.
 *
 * The numbers below are the real ones from that run.
 */
describe('volume finalization is not a restatement — the defect that deadlocked the refresh', () => {
  /** A series long enough that "recent" and "old" are meaningfully different. */
  const series = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      time: 1000 + i, open: 10, high: 11, low: 9, close: 10, volume: 1_000_000,
    }))

  it('accepts the exact NVDA revision that refused the real run', () => {
    const disk = series(300)
    disk[disk.length - 1].volume = 75_504_000
    const incoming = disk.map((c) => ({ ...c }))
    incoming[incoming.length - 1].volume = 75_680_900 // +0.23%, the observed delta

    const v = assessRefresh(disk, incoming)
    expect(v.ok).toBe(true)
    expect(v.finalized).toBe(1)
    expect(v.restated).toBe(0)
  })

  it('still REFUSES a moved close on the very same recent bar', () => {
    // Price is what I4 exists to protect. Recency buys volume nothing here.
    const disk = series(300)
    const incoming = disk.map((c) => ({ ...c }))
    incoming[incoming.length - 1].close = 10.5

    const v = assessRefresh(disk, incoming)
    expect(v.ok).toBe(false)
    expect(v.restated).toBe(1)
    expect(v.reasons[0]).toMatch(/VENDOR RESTATEMENT/)
  })

  it('still REFUSES a volume revision on an OLD bar', () => {
    // A 2023 volume revision is a genuine data event. Only the settling window
    // is forgiven, and this is the assertion that keeps the window meaningful.
    const disk = series(300)
    const incoming = disk.map((c) => ({ ...c }))
    incoming[0].volume = 1_002_000 // +0.2%, tiny — but ~300 sessions old

    const v = assessRefresh(disk, incoming)
    expect(v.ok).toBe(false)
    expect(v.restated).toBe(1)
  })

  it('still REFUSES an absurd volume change on a recent bar', () => {
    // Tripling is a bad fetch or the wrong security, not the tape settling.
    const disk = series(300)
    const incoming = disk.map((c) => ({ ...c }))
    incoming[incoming.length - 1].volume *= 3

    expect(assessRefresh(disk, incoming).ok).toBe(false)
  })

  it('draws the age boundary where it says it does', () => {
    const disk = series(300)
    const at = (ageFromEnd: number) => {
      const incoming = disk.map((c) => ({ ...c }))
      incoming[incoming.length - 1 - ageFromEnd].volume = 1_001_000 // +0.1%
      return assessRefresh(disk, incoming)
    }
    expect(at(FINALIZATION_SESSIONS - 1).ok).toBe(true)  // inside the window
    expect(at(FINALIZATION_SESSIONS).ok).toBe(false)     // one session past it
  })

  it('draws the magnitude boundary where it says it does', () => {
    const disk = series(300)
    const at = (frac: number) => {
      const incoming = disk.map((c) => ({ ...c }))
      incoming[incoming.length - 1].volume = 1_000_000 * (1 + frac)
      return assessRefresh(disk, incoming)
    }
    expect(at(FINALIZATION_MAX_VOLUME_DRIFT * 0.9).ok).toBe(true)
    expect(at(FINALIZATION_MAX_VOLUME_DRIFT * 1.1).ok).toBe(false)
  })

  it('the observed drift sits far from the bound, not on its edge', () => {
    // Measured before the bound was set: the largest drift across all 36
    // refusals was 0.35%. A floor a hair above the null is one this project has
    // shipped before, and it does not survive contact with normal variation.
    const OBSERVED_MAX_DRIFT = 0.0035
    expect(FINALIZATION_MAX_VOLUME_DRIFT).toBeGreaterThan(OBSERVED_MAX_DRIFT * 10)
  })

  it('reports finalization rather than hiding it', () => {
    // The difference between absorbing a change silently and accepting a named,
    // known vendor behaviour is that the second one is COUNTED.
    const disk = series(300)
    const incoming = disk.map((c) => ({ ...c }))
    incoming[incoming.length - 1].volume = 1_001_000
    expect(assessRefresh(disk, incoming).finalized).toBe(1)
  })

  it('a missing bar is still HISTORY LOSS, untouched by any of this', () => {
    const disk = series(300)
    const v = assessRefresh(disk, disk.slice(0, -1))
    expect(v.ok).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/HISTORY LOSS/)
  })
})

/**
 * Q-144 — the bar BTC was frozen on was its own unfinished tail.
 *
 * Data-integrity review of #250 (Q144-D1..D9): the refresh fetched daily bars
 * through "now", so every BTC vintage stored a tail 22.3-23.2 h into its UTC
 * day. The next week the finished bar differed in EVERY field and the guard
 * called it a restatement; BTC was refused in every scheduled run from
 * 2026-08-23 (nine by 2026-10-18) and its fixture has not been written since
 * 2026-08-16. The first fix tolerated small "restatements", which froze the
 * partial bar permanently and failed again by week 4. The cause fix: never store
 * an unfinished bar, and replace — not compare — a stored bar that was
 * unfinished when it was written. Bar shapes below are synthetic; the relative
 * sizes are the measured ones.
 */
describe('Q-144 — an unfinished bar is neither stored nor compared', () => {
  const DAY = DAY_SECONDS
  const H = 3_600
  const T0 = 1_786_838_400 - 299 * DAY // daily bars at 00:00 UTC, the BTC shape; bar 299 is 2026-08-16
  const daily = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ time: T0 + i * DAY, open: 100, high: 101, low: 99, close: 100, volume: 1_000 }))
  const iso = (sec: number) => new Date(sec * 1000).toISOString()
  /** The finished version of a bar stored 22.3 h in: every field moved (Evidence 3 sizes). */
  const finished = (c: ReturnType<typeof daily>[number]) => ({
    ...c, open: c.open * (1 + 1.9e-5), high: c.high * (1 + 3.3e-4), low: c.low * (1 - 2.4e-3), close: c.close * (1 + 3.7e-4), volume: c.volume * (1 + 5.2e-2),
  })
  /** Every price doubled and the 50 oldest bars deleted: the re-gate's "wrecked" refresh. */
  const wrecked = (disk: ReturnType<typeof daily>) => disk.map((b) => ({ ...b, open: 200, high: 202, low: 198, close: 200 })).slice(50)

  it('keyDate renders an epoch-seconds key as its UTC date (a literal, not keyDate checked against itself)', () => {
    expect(keyDate('1786838400')).toBe('2026-08-16')
    expect(keyDate(String(T0 + 299 * DAY))).toBe('2026-08-16')
    expect(keyDate('')).toBe('')
  })

  it('isBarComplete: a daily bar is stored a whole day plus the settle margin after it begins', () => {
    expect(SETTLE_SECONDS).toBe(12 * H)
    const bar = { time: T0 }
    expect(isBarComplete(bar, T0 + DAY + SETTLE_SECONDS)).toBe(true)
    expect(isBarComplete(bar, T0 + DAY + SETTLE_SECONDS - 1)).toBe(false)
    expect(isBarComplete(bar, T0 + DAY)).toBe(false) // finished, not yet settled
    expect(isBarComplete(bar, T0 + Math.round(22.3 * H))).toBe(false) // the BTC fetch
    expect(isBarComplete({ time: Number.NaN }, T0 + 10 * DAY)).toBe(false)
    // An equity bar stamped at the 13:30 UTC open, seen on the Sunday run (59.5 h later), is stored.
    expect(isBarComplete({ time: T0 + 13.5 * H }, T0 + 13.5 * H + Math.round(59.5 * H))).toBe(true)
  })

  it('at the real scheduled run times, BTC\'s Saturday bar and the Friday session are stored and BTC\'s Sunday bar is held (R2-4)', () => {
    // 2026-10-18 is a Sunday. The last six scheduled runs were created at 23:28,
    // 23:52, 23:50, 00:17, 00:25 and 00:57 UTC.
    const sunday = Date.parse('2026-10-18T00:00:00Z') / 1000
    const saturday = sunday - DAY
    const fridaySession = sunday - 2 * DAY + 13.5 * H
    for (const [h, m] of [[23, 28], [23, 52], [23, 50], [24, 17], [24, 25], [24, 57]]) {
      const now = sunday + h * H + m * 60
      expect(isBarComplete({ time: saturday }, now), `${h}:${m} Saturday`).toBe(true)
      expect(isBarComplete({ time: fridaySession }, now), `${h}:${m} Friday`).toBe(true)
      expect(isBarComplete({ time: sunday }, now), `${h}:${m} Sunday`).toBe(false)
    }
  })

  it('dropUnfinishedBars drops every unfinished bar, wherever it sits (R2-9)', () => {
    const s = daily(10)
    const now = s[9].time + Math.round(22.3 * H) // the bar before the tail is 46.3 h old: stored
    const r = dropUnfinishedBars(s, now)
    expect(r.dropped).toBe(1)
    expect(r.candles).toHaveLength(9)
    expect(r.candles[8].time).toBe(s[8].time)
    expect(dropUnfinishedBars(s, s[9].time + DAY + SETTLE_SECONDS).dropped).toBe(0)
    expect(dropUnfinishedBars([], now)).toEqual({ candles: [], dropped: 0 })
    // An unsorted response with the unfinished bar FIRST, and a non-finite time mid-series.
    const unsorted = [s[9], ...s.slice(0, 4), { ...s[4], time: Number.NaN }, ...s.slice(5, 9)]
    const u = dropUnfinishedBars(unsorted, now)
    expect(u.dropped).toBe(2)
    expect(u.candles.map((c: { time: number }) => c.time)).toEqual([...s.slice(0, 4), ...s.slice(5, 9)].map((c) => c.time))
  })

  it('provisionalKeys reads the FILE\'s fetchedAt: only the last bar, and only while its day was in progress', () => {
    const s = daily(300)
    const tail = s[299].time
    expect([...provisionalKeys(s, iso(tail + Math.round(22.3 * H)))]).toEqual([String(tail)])
    expect([...provisionalKeys(s, iso(tail))]).toEqual([String(tail)]) // written the second its day began
    expect(provisionalKeys(s, iso(tail + DAY)).size).toBe(0) // day over at the write: a stored final bar
    expect(provisionalKeys(s, undefined).size).toBe(0)
    expect(provisionalKeys(s, 'not a date').size).toBe(0)
  })

  it('provisionalKeys fails to the strict check on a bogus but parseable fetchedAt (R2-2)', () => {
    const s = daily(300)
    // V8 parses "0" as the year 2000 and "2026" as 2026-01-01; the epoch predates every bar.
    for (const bogus of ['0', '1', '2026', '1970-01-01T00:00:00Z', '2026-08-16', 'Sun Aug 16 2026']) {
      expect(provisionalKeys(s, bogus).size, bogus).toBe(0)
    }
    // A stamp 100 days before the tail makes one MID-HISTORY bar qualify; only the tail may.
    expect(provisionalKeys(s, iso(s[199].time + 3_600)).size).toBe(0)
    // Disk times in milliseconds, and bars keyed by date with no time.
    expect(provisionalKeys(s.map((c) => ({ ...c, time: c.time * 1000 })), iso(s[299].time + 3_600)).size).toBe(0)
    expect(provisionalKeys(s.map(({ time, ...c }) => ({ ...c, date: iso(time).slice(0, 10) })), iso(s[299].time + 3_600)).size).toBe(0)
    // Two bars in the same day (a sub-daily or duplicated tail): untrustworthy, strict.
    expect(provisionalKeys([...s, { ...s[299], time: s[299].time + 60 }], iso(s[299].time + 3_600)).size).toBe(0)
    // A last bar that is not the newest (unsorted file): strict.
    expect(provisionalKeys([...s.slice(0, 298), s[299], s[298]], iso(s[299].time + 3_600)).size).toBe(0)
    expect(provisionalKeys([...s.slice(0, 298), s[299], s[298]], iso(s[298].time + 3_600)).size).toBe(0)
    // A bar that began AFTER the file says it was written (a weekend gap, then a
    // bar from the stamp's future): the stamp is wrong, so nothing is exempt.
    const gapped = [...s.slice(0, 299), { ...s[298], time: s[298].time + 2 * DAY }]
    expect(provisionalKeys(gapped, iso(s[298].time + Math.round(1.5 * DAY))).size).toBe(0)
  })

  it('the re-gate reproducer: a wrecked refresh is refused whatever the fetchedAt says (R2-2)', () => {
    const disk = daily(300)
    for (const fetchedAt of [undefined, '0', '2026', '1970-01-01T00:00:00Z', iso(disk[199].time + 3_600), iso(disk[299].time + 3_600)]) {
      const v = assessRefresh(disk, wrecked(disk), { existingFetchedAt: fetchedAt })
      expect(v.ok, String(fetchedAt)).toBe(false)
      expect(v.restated, String(fetchedAt)).toBeGreaterThanOrEqual(249)
      expect(v.missing, String(fetchedAt)).toBe(50)
      expect(v.superseded, String(fetchedAt)).toBeLessThanOrEqual(1)
    }
  })

  it('the real BTC shape: a stored partial tail is REPLACED by the finished bar, every field, and the run is ok', () => {
    const disk = daily(300)
    const fetchedAt = iso(disk[299].time + Math.round(22.3 * H))
    const incoming = [...disk.slice(0, 299), finished(disk[299]), { ...disk[299], time: disk[299].time + DAY }]
    const v = assessRefresh(disk, incoming, { existingFetchedAt: fetchedAt })
    expect(v).toMatchObject({ ok: true, restated: 0, missing: 0, superseded: 1, appended: 1 })
    expect(v.supersededBars[0].fields).toEqual(['open', 'high', 'low', 'close', 'volume'])
    expect(v.supersededBars[0].maxRelativeChange).toBeCloseTo(5.2e-2, 6)
  })

  it('the same bar stored AFTER its day ended is a restatement — refused, every field named, no vendor values (D3, D9)', () => {
    const disk = daily(300)
    const incoming = [...disk.slice(0, 299), finished(disk[299])]
    const v = assessRefresh(disk, incoming, { existingFetchedAt: iso(disk[299].time + DAY + 60) })
    expect(v.ok).toBe(false)
    expect(v.restated).toBe(1)
    expect(v.reasons[0]).toContain('2026-08-16 open/high/low/close/volume moved up to 5.2e-2')
    // The old message printed `was -> now`, i.e. raw vendor prices, into public logs.
    expect(v.reasons[0]).not.toMatch(/->|99\.7|100\.0/)
  })

  it('HISTORY LOSS names the oldest missing bar by date, not by epoch key (R2-8)', () => {
    const disk = daily(300)
    const v = assessRefresh(disk, disk.slice(3))
    expect(v.reasons[0]).toContain(`(oldest ${keyDate(String(T0))})`)
    expect(v.reasons[0]).not.toContain(String(T0))
  })

  it('a stored partial tail does not exempt any OTHER bar', () => {
    const disk = daily(300)
    const incoming = [...disk.slice(0, 299).map((c, i) => (i === 3 ? { ...c, close: 100.01 } : c)), finished(disk[299])]
    const v = assessRefresh(disk, incoming, { existingFetchedAt: iso(disk[299].time + H) })
    expect(v).toMatchObject({ ok: false, restated: 1, superseded: 1 })
  })

  it('a stored partial tail the refresh no longer serves is not HISTORY LOSS', () => {
    const disk = daily(300)
    const v = assessRefresh(disk, disk.slice(0, 299), { existingFetchedAt: iso(disk[299].time + H) })
    expect(v).toMatchObject({ ok: true, missing: 0, superseded: 1 })
    expect(v.supersededBars[0]).toMatchObject({ dropped: true })
  })

  it('D2 replay at the real run times: twelve weekly runs from the frozen state stay green with zero restatements', () => {
    // Week 0 is the state on disk: a series whose tail was stored 22.3 h in.
    let disk = daily(300)
    let fetchedAt = iso(disk[299].time + Math.round(22.3 * H))
    const vendor = (throughSec: number) => {
      const n = Math.floor((throughSec - T0) / DAY) + 1 // includes the day in progress
      return daily(n).map((c, i) => (i === 299 ? finished(c) : c))
    }
    // Run times relative to the start of the Sunday bar: the six real creation
    // times, then repeated.
    const offsets = [[23, 28], [23, 52], [23, 50], [24, 17], [24, 25], [24, 57]].map(([h, m]) => h * H + m * 60)
    const results: Array<[number, boolean, number, number]> = []
    for (let week = 1; week <= 12; week++) {
      const nowMs = (disk[299].time + week * 7 * DAY + offsets[(week - 1) % offsets.length]) * 1000
      const plan = planSave({ ticker: 'BTC', sector: 'Crypto', prev: { candles: disk, fetchedAt }, candles: vendor(nowMs / 1000), nowMs })
      if (!plan.ok) { results.push([week, false, -1, -1]); continue }
      results.push([week, true, plan.doc.vintage.restated, plan.doc.vintage.superseded])
      disk = plan.doc.candles
      fetchedAt = plan.doc.fetchedAt
    }
    expect(results.every(([, ok, restated]) => ok && restated === 0), JSON.stringify(results)).toBe(true)
    expect(results.map(([, , , sup]) => sup)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    // And nothing unfinished was ever stored.
    expect(provisionalKeys(disk, fetchedAt).size).toBe(0)
  })
})

/**
 * Q144-R2-5 — planSave is everything saveResult decides, reachable by a test.
 * The re-gate's surviving mutations each map to an assertion here: the clock in
 * the wrong unit, the hold-back skipped, a stale or epoch fetchedAt.
 */
describe('Q144-R2-5 — planSave: what the refresh writes for one instrument', () => {
  const DAY = DAY_SECONDS
  const H = 3_600
  const T0 = Date.parse('2025-06-01T00:00:00Z') / 1000
  const daily = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ time: T0 + i * DAY, open: 100, high: 101, low: 99, close: 100, volume: 1_000 }))
  const NOW_MS = Date.parse('2026-03-29T23:28:00Z') // a Sunday run; the series runs to 2026-03-29 when n = 302
  const base = { ticker: 'BTC', sector: 'Crypto' }

  it('holds back the unfinished tail by the INJECTED clock, and stamps fetchedAt from the same clock', () => {
    const s = daily(302) // last bar 2026-03-29 00:00, 23.5 h old at NOW_MS: held back
    expect(keyDate(String(s[301].time))).toBe('2026-03-29')
    const plan = planSave({ ...base, prev: undefined, candles: s, nowMs: NOW_MS })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.doc.fetchedAt).toBe('2026-03-29T23:28:00.000Z')
    expect(plan.doc.rows).toBe(301)
    expect(plan.doc.candles).toHaveLength(301)
    expect(plan.doc.candles[300].time).toBe(s[300].time)
    expect(plan.doc.fingerprint).toBe(seriesFingerprint(s.slice(0, 301)))
    expect(plan.doc.windowStart).toBe(WINDOW_START)
    expect(plan.doc.vintage).toEqual({ appended: 301, restated: 0, missing: 0, finalized: 0, superseded: 0 })
    expect(plan.log.join('\n')).toContain('held back 1 unfinished or unsettled bar(s)')
  })

  it('refuses a clock in seconds, and the epoch, instead of misdating the fixture', () => {
    const s = daily(302)
    expect(() => planSave({ ...base, prev: undefined, candles: s, nowMs: NOW_MS / 1000 })).toThrow(/not milliseconds/)
    expect(() => planSave({ ...base, prev: undefined, candles: s, nowMs: 0 })).toThrow(/not milliseconds/)
    expect(() => planSave({ ...base, prev: undefined, candles: s, nowMs: Number.NaN })).toThrow(/not milliseconds/)
  })

  it('the legacy BTC transition through planSave: partial tail replaced, one notice with a date and a relative size', () => {
    const disk = daily(301)
    const legacyFetchedAt = new Date((disk[300].time + Math.round(22.3 * H)) * 1000).toISOString()
    const finishedTail = { ...disk[300], high: 101.0333, low: 98.76, close: 100.037, volume: 1_052 }
    const vendor = [...disk.slice(0, 300), finishedTail, { ...disk[300], time: disk[300].time + DAY }]
    const plan = planSave({ ...base, prev: { candles: disk, fetchedAt: legacyFetchedAt }, candles: vendor, nowMs: NOW_MS })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.doc.vintage).toEqual({ appended: 0, restated: 0, missing: 0, finalized: 0, superseded: 1 })
    expect(plan.doc.candles[300]).toEqual(finishedTail)
    const notice = plan.log.find((l) => l.startsWith('::notice'))
    expect(notice).toContain('2026-03-28 was stored before its day ended; high/low/close/volume moved up to 5.2e-2')
    expect(plan.log.join('\n')).not.toMatch(/101\.0333|98\.76|1052/)
  })

  it('a second run on the file it just wrote compares every bar strictly', () => {
    const first = planSave({ ...base, prev: undefined, candles: daily(302), nowMs: NOW_MS })
    if (!first.ok) throw new Error(first.reason)
    const moved = daily(302).map((c, i) => (i === 300 ? { ...c, close: 100.5 } : c))
    const again = planSave({ ...base, prev: first.doc, candles: moved, nowMs: NOW_MS + 3_600_000 })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.reason).toMatch(/^REFUSED to save BTC: VENDOR RESTATEMENT: 1 existing bar\(s\)/)
  })

  it('refuses a short fetch, a shrunken fetch and a fixture with no candles', () => {
    expect(planSave({ ...base, prev: undefined, candles: daily(MIN_ABSOLUTE_ROWS), nowMs: NOW_MS }).ok).toBe(true)
    const short = planSave({ ...base, prev: undefined, candles: daily(MIN_ABSOLUTE_ROWS - 1), nowMs: NOW_MS })
    expect(short).toMatchObject({ ok: false })
    if (!short.ok) expect(short.reason).toContain(`< absolute floor ${MIN_ABSOLUTE_ROWS}`)
    const prev = { candles: daily(400), fetchedAt: '2026-01-01T00:00:00.000Z' }
    const shrunk = planSave({ ...base, prev, candles: daily(Math.floor(400 * (1 - MAX_SHRINK_PCT)) - 1), nowMs: NOW_MS })
    expect(shrunk).toMatchObject({ ok: false })
    if (!shrunk.ok) expect(shrunk.reason).toContain('below existing 400')
    for (const bad of [{}, { candles: [] }, { candles: 'x' }, null, 'x']) {
      const r = planSave({ ...base, prev: bad, candles: daily(302), nowMs: NOW_MS })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.reason).toContain('no usable candles array')
    }
  })
})

describe('Q-144 — the fetch script delegates every decision to planSave', () => {
  // Source text, comments stripped: a tripwire on the one line planSave cannot
  // test from inside — the call site that supplies the clock. A clock in the
  // wrong unit is also refused by planSave at runtime.
  const src = async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    return readFileSync(join(__dirname, '../../scripts/fetchBacktestData.mjs'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  it('saveResult passes the raw bars and Date.now() to planSave and writes its doc', async () => {
    const s = await src()
    expect(s.match(/planSave\(\{ ticker, sector, prev, candles, nowMs: Date\.now\(\) \}\)/g)).toHaveLength(1)
    expect(s).toMatch(/writeFileSync\(filePath, JSON\.stringify\(plan\.doc, null, 2\), 'utf8'\)/)
    expect(s.match(/const rows = saveResult\((?:ticker|'BTC'), sector, candles\)/g)).toHaveLength(2)
    expect(s).not.toMatch(/assessRefresh|dropUnfinishedBars|clampPartialFinalBar|fetchedAt:/)
    // I8: the refusal path prints relative sizes, never raw vendor values.
    expect(s).not.toMatch(/\$\{r\.was\}|\$\{b\.was\}/)
  })

  it('a row with no volume is not stored as volume 0 (R2-4)', async () => {
    const s = await src()
    expect(s).toMatch(/Number\.isFinite\(q\.close\) &&\s*Number\.isFinite\(q\.volume\)/)
    expect(s).not.toMatch(/Number\.isFinite\(q\.volume\) \? q\.volume : 0/)
  })
})
