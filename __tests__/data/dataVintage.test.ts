import { describe, it, expect } from 'vitest'
// Plain .mjs so the fetch script can import it without a TS build step.
import {
  diffSeries,
  assessRefresh,
  seriesFingerprint,
  WINDOW_START,
  FINALIZATION_SESSIONS,
  FINALIZATION_MAX_VOLUME_DRIFT,
} from '../../scripts/lib/dataVintage.mjs'

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
