import { describe, it, expect } from 'vitest'
// Plain .mjs so the fetch script can import it without a TS build step.
import { diffSeries, assessRefresh, seriesFingerprint, WINDOW_START } from '../../scripts/lib/dataVintage.mjs'

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
