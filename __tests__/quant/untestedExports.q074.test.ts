/**
 * Q-074 — direct unit tests for the untested exports flagged by the
 * 2026-06-03 quant function audit (reviews/FUNCTION-AUDIT-QUANT-2026-06-03.md).
 *
 * Of the 24 flagged exports, 9 gained direct references via
 * __tests__/backtest/mutationHardening.golden.test.ts (Q-075 wave) and
 * signalHelpers.test.ts / frameworks.test.ts. This file covers the remaining
 * 14: calcStochRSI, calcADX, vwapArray, vwapArrayWindow, hasPositiveClose,
 * alignCloses, logReturns, trailingReturn, listPortfolioIds,
 * appendClosedTrade, loadClosedTrades, marginalVaR, formatStressResults,
 * PERP_FUNDING_MODERATE_ABS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calcStochRSI, calcADX, type BtcCandle } from '@/lib/quant/btc-indicators'
import { stochRsiArray, adxArray, vwapArray, vwapArrayWindow } from '@/lib/quant/indicators'
import { hasPositiveClose } from '@/lib/quant/chartQuoteFilter'
import { alignCloses, logReturns, trailingReturn } from '@/lib/quant/relativeStrength'
import {
  listPortfolioIds,
  appendClosedTrade,
  loadClosedTrades,
  type ClosedTrade,
} from '@/lib/portfolio/tracker'
import { marginalVaR } from '@/lib/portfolio/var'
import { formatStressResults, type StressTestResult } from '@/lib/portfolio/stressTest'
import { PERP_FUNDING_MODERATE_ABS as fromCrypto } from '@/lib/crypto'
import {
  PERP_FUNDING_MODERATE_ABS as fromConstants,
  PERP_FUNDING_HIGH_ABS,
} from '@/lib/quant/fundingConstants'

// ─── BTC indicator wrappers (delegation parity) ──────────────────────────────

function makeCandles(n: number, priceFn: (i: number) => number): BtcCandle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = priceFn(i)
    const open = i === 0 ? close : priceFn(i - 1)
    return {
      time: 1700000000 + i * 86400,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000 + i,
    }
  })
}

describe('calcStochRSI — delegates to canonical stochRsiArray', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.4) * 10)

  it('matches stochRsiArray verbatim at default params', () => {
    const wrapped = calcStochRSI(closes)
    const canonical = stochRsiArray(closes, 14, 3, 3)
    expect(wrapped.k).toEqual(canonical.k)
    expect(wrapped.d).toEqual(canonical.d)
    expect(wrapped.k).toHaveLength(closes.length)
    expect(wrapped.k.some(Number.isFinite)).toBe(true)
  })

  it('forwards custom period/smoothing params', () => {
    const wrapped = calcStochRSI(closes, 10, 5, 5)
    const canonical = stochRsiArray(closes, 10, 5, 5)
    expect(wrapped.k).toEqual(canonical.k)
    expect(wrapped.d).toEqual(canonical.d)
  })
})

describe('calcADX — delegates to canonical adxArray', () => {
  const candles = makeCandles(60, (i) => 100 + Math.sin(i * 0.3) * 8 + i * 0.2)

  it('matches adxArray on the same bars and exposes all three lines', () => {
    const wrapped = calcADX(candles)
    const canonical = adxArray(
      candles.map(({ open, high, low, close }) => ({ open, high, low, close })),
      14,
    )
    expect(wrapped.adx).toEqual(canonical.adx)
    expect(wrapped.plusDI).toEqual(canonical.plusDI)
    expect(wrapped.minusDI).toEqual(canonical.minusDI)
    expect(Number.isFinite(wrapped.adx[wrapped.adx.length - 1])).toBe(true)
  })
})

// ─── VWAP ────────────────────────────────────────────────────────────────────

describe('vwapArray / vwapArrayWindow — exact hand-computed pins', () => {
  // Bar typical prices: (h+l+c)/3 = 101, 104, 98
  const highs = [103, 106, 100]
  const lows = [99, 102, 96]
  const closes = [101, 104, 98]
  const volumes = [100, 200, 300]

  it('anchored at 0: cumulative TPV/vol at each bar', () => {
    const v = vwapArray(highs, lows, closes, volumes)
    expect(v[0]).toBeCloseTo(101, 10)
    expect(v[1]).toBeCloseTo((101 * 100 + 104 * 200) / 300, 10) // 103
    expect(v[2]).toBeCloseTo((101 * 100 + 104 * 200 + 98 * 300) / 600, 10) // 100.5
  })

  it('anchored mid-series: NaN before the anchor, restart after', () => {
    const v = vwapArray(highs, lows, closes, volumes, 1)
    expect(Number.isNaN(v[0])).toBe(true)
    expect(v[1]).toBeCloseTo(104, 10)
    expect(v[2]).toBeCloseTo((104 * 200 + 98 * 300) / 500, 10) // 100.4
  })

  it('out-of-range anchor or zero volume yields NaN', () => {
    expect(vwapArray(highs, lows, closes, volumes, 3).every(Number.isNaN)).toBe(true)
    expect(vwapArray(highs, lows, closes, volumes, -1).every(Number.isNaN)).toBe(true)
    const v = vwapArray(highs, lows, closes, [0, 0, 0])
    expect(v.every(Number.isNaN)).toBe(true)
  })

  it('window wrapper anchors to the last N bars (and clamps to 0)', () => {
    expect(vwapArrayWindow(highs, lows, closes, volumes, 2)).toEqual(
      vwapArray(highs, lows, closes, volumes, 1),
    )
    expect(vwapArrayWindow(highs, lows, closes, volumes, 10)).toEqual(
      vwapArray(highs, lows, closes, volumes, 0),
    )
    expect(vwapArrayWindow(highs, lows, closes, volumes, 0).every(Number.isNaN)).toBe(true)
    expect(vwapArrayWindow([], [], [], [], 5)).toEqual([])
  })
})

// ─── Chart quote filter ──────────────────────────────────────────────────────

describe('hasPositiveClose — type-guard boundary', () => {
  const d = new Date('2026-01-01')
  it('accepts only finite positive closes', () => {
    expect(hasPositiveClose({ close: 101.5, date: d })).toBe(true)
    expect(hasPositiveClose({ close: 0, date: d })).toBe(false)
    expect(hasPositiveClose({ close: -1, date: d })).toBe(false)
    expect(hasPositiveClose({ close: null, date: d })).toBe(false)
  })
})

// ─── relativeStrength helpers ────────────────────────────────────────────────

describe('alignCloses — date-keyed intersection with positivity filter', () => {
  it('keeps only shared dates with positive closes on both sides', () => {
    const out = alignCloses(
      ['d1', 'd2', 'd3', 'd4'],
      [10, 20, 30, 40],
      ['d2', 'd3', 'd4', 'd5'],
      [2, 0, 4, 5],
    )
    // d1: missing in B; d3: B close 0 filtered; d2/d4 survive
    expect(out).toEqual({ a: [20, 40], b: [2, 4] })
  })

  it('filters non-positive closes on the A side too', () => {
    const out = alignCloses(['d1', 'd2'], [-5, 20], ['d1', 'd2'], [1, 2])
    expect(out).toEqual({ a: [20], b: [2] })
  })
})

describe('logReturns — exact ln ratios, skipping non-positive bars', () => {
  it('computes ln(c_i / c_{i-1}) per bar', () => {
    const r = logReturns([100, 110, 99])
    expect(r).toHaveLength(2)
    expect(r[0]).toBeCloseTo(Math.log(1.1), 12)
    expect(r[1]).toBeCloseTo(Math.log(99 / 110), 12)
  })
  it('skips pairs containing a non-positive close', () => {
    expect(logReturns([100, 0, 110])).toEqual([])
    expect(logReturns([100])).toEqual([])
  })
})

describe('trailingReturn — exact simple return over the last N sessions', () => {
  const closes = [100, 105, 110, 121]
  it('r = last / close[len-1-days] − 1', () => {
    expect(trailingReturn(closes, 2)).toBeCloseTo(121 / 105 - 1, 12)
    expect(trailingReturn(closes, 3)).toBeCloseTo(0.21, 12)
  })
  it('null when history is short (needs days+1) or base is non-positive', () => {
    expect(trailingReturn(closes, 4)).toBeNull()
    expect(trailingReturn([0, 100, 110], 2)).toBeNull()
  })
})

// ─── portfolio tracker (localStorage-backed) ─────────────────────────────────

function makeLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
}

const sampleTrade: ClosedTrade = {
  ticker: 'AAPL',
  sector: 'Technology',
  entryDate: '2026-01-05',
  exitDate: '2026-02-02',
  shares: 10,
  entryPrice: 100,
  exitPrice: 110,
  realizedPnl: 100,
  realizedPnlPct: 0.1,
  holdingDays: 20,
  exitReason: 'signal',
}

describe('tracker — listPortfolioIds / appendClosedTrade / loadClosedTrades', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageMock())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appendClosedTrade → loadClosedTrades round-trips in order', () => {
    expect(loadClosedTrades('p1')).toEqual([])
    appendClosedTrade('p1', sampleTrade)
    appendClosedTrade('p1', { ...sampleTrade, ticker: 'MSFT' })
    const loaded = loadClosedTrades('p1')
    expect(loaded).toHaveLength(2)
    expect(loaded[0].ticker).toBe('AAPL')
    expect(loaded[1].ticker).toBe('MSFT')
    expect(loadClosedTrades('other')).toEqual([]) // keyed per portfolio
  })

  it('corrupted or non-array stored JSON fails closed to []', () => {
    appendClosedTrade('p2', sampleTrade)
    const key = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).find(
      (k) => k.includes('p2'),
    )!
    localStorage.setItem(key, '{not json')
    expect(loadClosedTrades('p2')).toEqual([])
    // append on corrupt storage re-initializes instead of throwing
    appendClosedTrade('p2', sampleTrade)
    expect(loadClosedTrades('p2')).toHaveLength(1)
    localStorage.setItem(key, '"a string"')
    expect(loadClosedTrades('p2')).toEqual([])
  })

  it('listPortfolioIds extracts ids from the quantan-portfolio- prefix only', () => {
    localStorage.setItem('quantan-portfolio-alpha', '{}')
    localStorage.setItem('quantan-portfolio-beta', '{}')
    localStorage.setItem('unrelated-key', '{}')
    expect(listPortfolioIds().sort()).toEqual(['alpha', 'beta'])
  })
})

describe('tracker — SSR guards (no localStorage global)', () => {
  it('returns empty/no-ops when localStorage is undefined', () => {
    // Node ≥22 ships a global localStorage; stub it away so the SSR guard
    // branch is exercised deterministically on every runtime.
    vi.stubGlobal('localStorage', undefined)
    try {
      expect(typeof localStorage).toBe('undefined')
      expect(listPortfolioIds()).toEqual([])
      expect(loadClosedTrades('p1')).toEqual([])
      expect(() => appendClosedTrade('p1', sampleTrade)).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// ─── marginalVaR ─────────────────────────────────────────────────────────────

describe('marginalVaR — exact perturbation pins', () => {
  // 100 returns: 95 × +0.001 and 5 tail losses. At 99% confidence,
  // varIdx = floor(0.01×100) = 1 → historical VaR = −sorted[1] = 0.05.
  const portfolioReturns = [
    ...Array.from({ length: 95 }, () => 0.001),
    -0.02, -0.03, -0.04, -0.05, -0.06,
  ]

  it('same-as-portfolio position: marginal VaR = +VaR of the tail bar (0.05)', () => {
    const out = marginalVaR(portfolioReturns, { SAME: [...portfolioReturns] }, { SAME: 0.5 })
    // perturbed = 1.01×r → VaR 0.0505 → (0.0505 − 0.05)/0.01 = 0.05
    expect(out.SAME).toBeCloseTo(0.05, 10)
  })

  it('perfect hedge position: negative marginal VaR of the same magnitude', () => {
    const hedge = portfolioReturns.map((r) => -r)
    const out = marginalVaR(portfolioReturns, { HEDGE: hedge }, { HEDGE: 0.5 })
    // perturbed = 0.99×r → VaR 0.0495 → (0.0495 − 0.05)/0.01 = −0.05
    expect(out.HEDGE).toBeCloseTo(-0.05, 10)
  })

  it('skips length-mismatched positions; empty on insufficient history', () => {
    const out = marginalVaR(portfolioReturns, { BAD: [0.01, 0.02] }, { BAD: 0.5 })
    expect(out).toEqual({})
    expect(marginalVaR([0.01, -0.01], { X: [0.01, -0.01] }, { X: 1 })).toEqual({})
  })
})

// ─── formatStressResults ─────────────────────────────────────────────────────

describe('formatStressResults — exact table rendering', () => {
  const result: StressTestResult = {
    scenario: {
      id: 'covid2020',
      name: 'COVID Crash',
      startDate: '2020-02-19',
      endDate: '2020-03-23',
      description: 'Pandemic selloff',
      spyDrawdown: -0.34,
    },
    portfolioReturn: -0.2512,
    maxDrawdown: 0.3056,
    recoveryDays: null,
    tickerReturns: { AAPL: -0.2, TSLA: -0.4 },
    worstTicker: { ticker: 'TSLA', return: -0.4 },
    bestTicker: { ticker: 'AAPL', return: -0.2 },
    estimatedLoss: -25120,
    warnings: [],
  }

  it('renders header, divider, and a formatted row', () => {
    const txt = formatStressResults([result])
    const lines = txt.split('\n')
    expect(lines[0]).toBe(
      'Scenario                 | Port Return | Max DD  | vs SPY  | Worst Ticker',
    )
    expect(lines[1]).toBe('-'.repeat(80))
    expect(lines[2]).toBe('COVID Crash              | -25.1%      | 30.6%   | -34.0%  | TSLA (-40.0%)')
  })

  it('renders N/A when there is no worst ticker; empty input → header only', () => {
    const noWorst = formatStressResults([{ ...result, worstTicker: null }])
    expect(noWorst.split('\n')[2].endsWith('N/A')).toBe(true)
    expect(formatStressResults([]).split('\n')).toHaveLength(2)
  })
})

// ─── funding constants ───────────────────────────────────────────────────────

describe('PERP_FUNDING_MODERATE_ABS — SSOT re-export', () => {
  it('lib/crypto re-exports the fundingConstants value verbatim', () => {
    expect(fromCrypto).toBe(fromConstants)
    expect(fromCrypto).toBe(0.0001)
    expect(PERP_FUNDING_HIGH_ABS).toBeGreaterThan(fromCrypto)
  })
})
