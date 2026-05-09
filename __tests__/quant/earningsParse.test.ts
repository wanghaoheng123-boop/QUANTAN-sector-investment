import { describe, it, expect } from 'vitest'
import { parseEarningsSnapshot } from '@/lib/quant/earningsParse'

/**
 * Tests for lib/quant/earningsParse.ts
 *
 * Closes F8.1 (sub-task: earningsParse). The module parses Yahoo Finance
 * `quoteSummary` payloads into a UI-friendly `EarningsSnapshot`. Yahoo's
 * envelope is well-known but inconsistent — fields are sometimes plain
 * numbers, sometimes `{raw, fmt}` objects, sometimes missing entirely.
 * These tests pin down the parser's contract under each shape.
 *
 * Citation: Yahoo Finance v10 quoteSummary schema is undocumented but
 *           empirically-stable; field shapes verified against
 *           https://query2.finance.yahoo.com/v10/finance/quoteSummary
 *           responses captured 2026-04 (calendarEvents.earnings.earningsDate
 *           is unix-epoch in `raw`, ISO-date in `fmt`).
 */
describe('parseEarningsSnapshot', () => {
  it('returns all-nulls snapshot for empty input', () => {
    const snap = parseEarningsSnapshot({})
    expect(snap).toEqual({
      nextEarningsDate: null,
      lastQuarterEnd: null,
      lastEPSActual: null,
      lastEPSEstimate: null,
      lastSurprisePct: null,
    })
  })

  it('parses nextEarningsDate from calendarEvents.earnings.earningsDate[0].fmt', () => {
    const snap = parseEarningsSnapshot({
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1714435200, fmt: '2026-04-29' }],
        },
      },
    })
    expect(snap.nextEarningsDate).toBe('2026-04-29')
  })

  it('falls back to raw epoch → ISO date when fmt is missing', () => {
    // 2026-04-29T00:00:00Z = 1745884800 epoch seconds
    const snap = parseEarningsSnapshot({
      calendarEvents: {
        earnings: {
          earningsDate: [{ raw: 1745884800 }],
        },
      },
    })
    // Should produce a YYYY-MM-DD slice of the ISO timestamp
    expect(snap.nextEarningsDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snap.nextEarningsDate).toBe(new Date(1745884800 * 1000).toISOString().slice(0, 10))
  })

  it('returns null nextEarningsDate when earningsDate array is empty', () => {
    const snap = parseEarningsSnapshot({
      calendarEvents: { earnings: { earningsDate: [] } },
    })
    expect(snap.nextEarningsDate).toBeNull()
  })

  it('parses last quarter EPS (actual + estimate) and surprise pct', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { raw: 1704067200, fmt: '2025-12-31' },
            epsActual: { raw: 2.18 },
            epsEstimate: { raw: 2.10 },
          },
        ],
      },
    })
    expect(snap.lastQuarterEnd).toBe('2025-12-31')
    expect(snap.lastEPSActual).toBe(2.18)
    expect(snap.lastEPSEstimate).toBe(2.10)
    // (2.18 - 2.10) / 2.10 * 100 ≈ 3.8095...
    expect(snap.lastSurprisePct).toBeCloseTo(3.8095, 3)
  })

  it('handles negative surprise (miss) correctly', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-09-30' },
            epsActual: { raw: 1.50 },
            epsEstimate: { raw: 1.60 },
          },
        ],
      },
    })
    // (1.50 - 1.60) / 1.60 * 100 = -6.25
    expect(snap.lastSurprisePct).toBeCloseTo(-6.25, 5)
  })

  it('handles negative-estimate beat using |est| in denominator', () => {
    // Edge case: company expected to lose money but beat the loss estimate.
    // Per parser: ((actual - est) / |est|) * 100
    // actual=-0.10, est=-0.20  →  ((-0.10 - -0.20) / 0.20) * 100 = +50
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-06-30' },
            epsActual: { raw: -0.10 },
            epsEstimate: { raw: -0.20 },
          },
        ],
      },
    })
    expect(snap.lastSurprisePct).toBeCloseTo(50, 5)
  })

  it('does NOT divide by zero when estimate ≈ 0', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-06-30' },
            epsActual: { raw: 0.05 },
            epsEstimate: { raw: 0 },
          },
        ],
      },
    })
    expect(snap.lastEPSActual).toBe(0.05)
    expect(snap.lastEPSEstimate).toBe(0)
    expect(snap.lastSurprisePct).toBeNull()
  })

  it('falls back to earningsHistory.earningsHistory when .history is missing', () => {
    // Yahoo's payload occasionally double-nests under the same key.
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        earningsHistory: [
          {
            quarter: { fmt: '2025-03-31' },
            epsActual: { raw: 1.00 },
            epsEstimate: { raw: 0.95 },
          },
        ],
      },
    })
    expect(snap.lastQuarterEnd).toBe('2025-03-31')
    expect(snap.lastEPSActual).toBe(1.00)
    expect(snap.lastEPSEstimate).toBe(0.95)
  })

  it('returns null EPS fields when history is empty array', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: { history: [] },
    })
    expect(snap.lastQuarterEnd).toBeNull()
    expect(snap.lastEPSActual).toBeNull()
    expect(snap.lastEPSEstimate).toBeNull()
    expect(snap.lastSurprisePct).toBeNull()
  })

  it('rejects non-finite EPS values (NaN, Infinity, strings)', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-12-31' },
            epsActual: { raw: NaN },
            epsEstimate: { raw: 'oops' },
          },
        ],
      },
    })
    expect(snap.lastEPSActual).toBeNull()
    expect(snap.lastEPSEstimate).toBeNull()
    expect(snap.lastSurprisePct).toBeNull()
  })

  it('handles plain-number eps values (when raw envelope omitted)', () => {
    // Some Yahoo payloads inline the value directly as a number.
    // The parser uses `epsA?.raw ?? epsA` — when epsA is a number,
    // `.raw` is undefined so it falls through to epsA itself.
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-12-31' },
            epsActual: 2.50,
            epsEstimate: 2.40,
          },
        ],
      },
    })
    expect(snap.lastEPSActual).toBe(2.50)
    expect(snap.lastEPSEstimate).toBe(2.40)
    expect(snap.lastSurprisePct).toBeCloseTo(((2.50 - 2.40) / 2.40) * 100, 5)
  })

  it('parses quarter end from raw epoch when fmt missing', () => {
    // 2025-12-31T00:00:00Z = 1767139200 epoch seconds
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { raw: 1767139200 },
            epsActual: { raw: 1.0 },
            epsEstimate: { raw: 1.0 },
          },
        ],
      },
    })
    expect(snap.lastQuarterEnd).toBe(new Date(1767139200 * 1000).toISOString().slice(0, 10))
  })

  it('returns nulls when only one of actual/estimate is present', () => {
    const snap = parseEarningsSnapshot({
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-12-31' },
            epsActual: { raw: 1.5 },
            // epsEstimate missing
          },
        ],
      },
    })
    expect(snap.lastEPSActual).toBe(1.5)
    expect(snap.lastEPSEstimate).toBeNull()
    expect(snap.lastSurprisePct).toBeNull()
  })

  it('parses both calendar + history together (full snapshot)', () => {
    const snap = parseEarningsSnapshot({
      calendarEvents: {
        earnings: { earningsDate: [{ fmt: '2026-04-29' }] },
      },
      earningsHistory: {
        history: [
          {
            quarter: { fmt: '2025-12-31' },
            epsActual: { raw: 2.18 },
            epsEstimate: { raw: 2.10 },
          },
        ],
      },
    })
    expect(snap.nextEarningsDate).toBe('2026-04-29')
    expect(snap.lastQuarterEnd).toBe('2025-12-31')
    expect(snap.lastEPSActual).toBe(2.18)
    expect(snap.lastEPSEstimate).toBe(2.10)
    expect(snap.lastSurprisePct).toBeCloseTo(3.8095, 3)
  })

  it('does not throw on completely malformed input', () => {
    expect(() => parseEarningsSnapshot({ calendarEvents: 'oops' as unknown as object })).not.toThrow()
    expect(() => parseEarningsSnapshot({ earningsHistory: null as unknown as object })).not.toThrow()
  })
})
