/**
 * Q-051 final item (2026-07-17) — fixture suite for the 457-line
 * buildFundamentalsPayload assembler so it can leave coverage.exclude.
 *
 * Three fixtures: RICH (every Yahoo module present → full payload), MINIMAL
 * (empty quoteSummary + short history → fail-closed nulls, no throw), and
 * BRANCHES (FCF fallback via OCF−|capex|, short-term-debt name variants,
 * forward-heuristic PE fallback chain).
 */
import { describe, it, expect } from 'vitest'
import { buildFundamentalsPayload, type FundamentalsQuery } from '@/lib/quant/buildFundamentalsPayload'
import type { OhlcBar } from '@/lib/quant/technicals'

const Q: FundamentalsQuery = {
  wacc: 0.09,
  terminalGrowth: 0.025,
  gBear: 0.02,
  gBase: 0.06,
  gBull: 0.1,
}

/** Deterministic daily series with mild noise; ISO dates from 2024-01-01. */
function series(bars: number, rate = 0.0015) {
  const closes: number[] = []
  const dates: string[] = []
  const ohlc: OhlcBar[] = []
  let level = 100
  const d0 = Date.UTC(2024, 0, 1)
  for (let i = 0; i < bars; i++) {
    if (i > 0) level *= 1 + rate + Math.sin(i * 0.7) * 0.004
    const open = i === 0 ? level : closes[i - 1]
    closes.push(level)
    dates.push(new Date(d0 + i * 86400_000).toISOString().slice(0, 10))
    ohlc.push({ open, high: Math.max(open, level) + 0.4, low: Math.min(open, level) - 0.4, close: level })
  }
  return { closes, dates, ohlc }
}

const richQuoteSummary = {
  summaryProfile: {
    longName: 'Acme Corp',
    sector: 'Technology',
    industry: 'Software',
    longBusinessSummary: 'Makes anvils and SaaS.',
    fullTimeEmployees: 12_345,
    website: 'https://acme.example',
  },
  financialData: {
    currentPrice: 150,
    freeCashflow: 8_000_000_000,
    targetMeanPrice: 180,
    targetHighPrice: 220,
    targetLowPrice: 120,
    recommendationMean: 2.1,
    numberOfAnalystOpinions: 30,
    debtToEquity: 55,
    currentRatio: 1.4,
    quickRatio: 1.1,
    returnOnEquity: 0.32,
    profitMargins: 0.25,
    operatingMargins: 0.3,
    ebitdaMargins: 0.35,
    revenueGrowth: 0.12,
    earningsGrowth: 0.15,
  },
  defaultKeyStatistics: {
    sharesOutstanding: 1_000_000_000,
    forwardEps: 8,
    trailingPE: 25,
    forwardPE: 20,
    pegRatio: 1.8,
    priceToBook: 10,
    beta: 1.1,
    enterpriseValue: 200_000_000_000,
    bookValue: 15,
  },
  incomeStatementHistory: {
    incomeStatementHistory: [
      { endDate: { fmt: '2025-12-31' }, totalRevenue: 50e9, netIncome: 12e9, grossProfit: 30e9 },
      { endDate: { raw: 1703980800 }, totalRevenue: 45e9, netIncome: 10e9, grossProfit: 27e9 },
    ],
  },
  balanceSheetHistory: {
    balanceSheets: [
      {
        endDate: { fmt: '2025-12-31' },
        totalAssets: 120e9, totalLiab: 60e9, totalStockholderEquity: 60e9,
        cash: 20e9, longTermDebt: 30e9, shortLongTermDebt: 5e9,
        totalCurrentAssets: 40e9, totalCurrentLiab: 25e9,
      },
    ],
  },
  cashflowStatementHistory: {
    cashflowStatements: [
      { freeCashflow: 7_500_000_000 },
    ],
  },
}

describe('buildFundamentalsPayload — RICH fixture (full payload)', () => {
  const { closes, dates, ohlc } = series(320)
  const spy = series(320, 0.0008)
  const payload = buildFundamentalsPayload(
    'ACME', richQuoteSummary, closes, dates, ohlc, spy.closes, spy.dates, 150, Q,
  )

  it('assembles narrative / market / health from the Yahoo modules', () => {
    expect(payload.symbol).toBe('ACME')
    expect(payload.narrative).toMatchObject({
      name: 'Acme Corp', sector: 'Technology', industry: 'Software', employees: 12_345,
    })
    expect(payload.market).toMatchObject({
      trailingPE: 25, forwardPE: 20, peg: 1.8, beta: 1.1, targetMeanPrice: 180,
    })
    expect(payload.health).toMatchObject({
      debtToEquity: 55, returnOnEquity: 0.32, profitMargin: 0.25, revenueGrowth: 0.12,
    })
  })

  it('maps statements incl. Yahoo {fmt}/{raw} date cells', () => {
    expect(payload.incomes).toHaveLength(2)
    expect(payload.incomes[0]).toEqual({
      endDate: '2025-12-31', revenue: 50e9, netIncome: 12e9, grossProfit: 30e9,
    })
    expect(payload.incomes[1].endDate).toBe(1703980800) // raw fallback
    expect(payload.balances).toHaveLength(1)
    expect(payload.balances[0]).toMatchObject({
      endDate: '2025-12-31', totalAssets: 120e9, equity: 60e9, longTermDebt: 30e9,
    })
  })

  it('runs all three DCF scenarios with bear < base < bull ordering', () => {
    expect(payload.dcf.inputs.fcf0).toBe(8_000_000_000) // financialData wins over statements
    expect(payload.dcf.inputs.shares).toBe(1_000_000_000)
    const { bear, base, bull } = payload.dcf.scenarios
    expect(bear).not.toBeNull()
    expect(base).not.toBeNull()
    expect(bull).not.toBeNull()
    expect(bear!.valuePerShare).toBeLessThan(base!.valuePerShare)
    expect(base!.valuePerShare).toBeLessThan(bull!.valuePerShare)
    expect(payload.anchors.dcfBase).toBe(base!.valuePerShare)
    expect(payload.anchors.analystTarget).toBe(180)
    // forwardEps 8 × forwardPE 20
    expect(payload.anchors.forwardEarningsHeuristic).toBe(160)
  })

  it('computes bands, signal, technicals, and 52w range coherently', () => {
    expect(payload.price).toBe(150)
    expect(payload.bands).not.toBeNull()
    expect(payload.signal).not.toBeNull()
    expect(['Below buy-zone upper bound', 'Above sell-zone lower bound', 'Inside neutral band'])
      .toContain(payload.signal!.label)

    const t = payload.technicals
    expect(t.sma20).not.toBeNull()
    expect(t.sma200).not.toBeNull()
    expect(t.rsi14).toBeGreaterThanOrEqual(0)
    expect(t.rsi14).toBeLessThanOrEqual(100)
    expect(t.atr14).not.toBeNull()
    const lastClose = closes[closes.length - 1]
    expect(t.atrStopLong).toBeCloseTo(lastClose - 2 * t.atr14!, 10)
    expect(t.atrStopShort).toBeCloseTo(lastClose + 2 * t.atr14!, 10)

    const r = payload.range52w
    expect(r.high).toBeGreaterThan(r.low!)
    expect(r.position).toBeGreaterThanOrEqual(0)
    // fib retracements descend from the high
    expect(payload.fibRetracement!.fib382).toBeGreaterThan(payload.fibRetracement!.fib500)
    expect(payload.fibRetracement!.fib500).toBeGreaterThan(payload.fibRetracement!.fib618)
  })

  it('aligns against SPY and scores relative strength', () => {
    expect(payload.relative.alignedSessions).toBe(320) // identical calendars
    expect(payload.relative.correlationVsSpy).not.toBeNull()
    expect(payload.relative.excessReturn60dVsSpy).not.toBeNull()
    expect(payload.researchScore).toBeTruthy()
    expect(payload.pivots).not.toBeNull()
    expect(payload.ma200Regime).not.toBeNull() // 320 ≥ 220 bars
    expect(payload.dataLineage.sources.length).toBeGreaterThan(0)
  })
})

describe('buildFundamentalsPayload — MINIMAL fixture (fail-closed)', () => {
  const { closes, dates, ohlc } = series(30)
  const payload = buildFundamentalsPayload(
    'BARE', {}, closes, dates, ohlc, [], [], null, Q,
  )

  it('never throws; degrades to nulls/empties without modules', () => {
    expect(payload.symbol).toBe('BARE')
    expect(payload.narrative.name).toBe('BARE') // falls back to symbol
    expect(payload.balances).toEqual([])
    expect(payload.incomes).toEqual([])
    expect(payload.dcf.inputs.fcf0).toBeNull()
    expect(payload.dcf.scenarios).toEqual({ bear: null, base: null, bull: null })
    expect(payload.anchors.forwardEarningsHeuristic).toBeNull()
    expect(payload.price).toBeNull() // no currentPrice anywhere
    expect(payload.bands).toBeNull()
    expect(payload.signal).toBeNull()
    expect(payload.ma200Regime).toBeNull() // < 220 bars
    expect(payload.relative.alignedSessions).toBe(0)
    expect(payload.relative.correlationVsSpy).toBeNull()
    expect(payload.technicals.sma200).toBeNull() // < 200 bars
  })
})

describe('buildFundamentalsPayload — BRANCH fixture (fallback chains)', () => {
  const { closes, dates, ohlc } = series(120)

  it('FCF falls back to OCF − |capex| from the statements', () => {
    const qs = {
      defaultKeyStatistics: { sharesOutstanding: 1e9 },
      cashflowStatementHistory: {
        cashflowStatements: [
          { totalCashFromOperatingActivities: 10e9, capitalExpenditures: -3e9 },
        ],
      },
    }
    const p = buildFundamentalsPayload('X', qs, closes, dates, ohlc, [], [], 100, Q)
    expect(p.dcf.inputs.fcf0).toBe(7e9) // 10e9 − |−3e9|
    expect(p.dcf.scenarios.base).not.toBeNull()
  })

  it('forward heuristic: forwardPE → trailingPE → 18 fallback', () => {
    const base = { financialData: { currentPrice: 100 } }
    const viaTrailing = buildFundamentalsPayload('X', {
      ...base, defaultKeyStatistics: { forwardEps: 5, trailingPE: 22 },
    }, closes, dates, ohlc, [], [], 100, Q)
    expect(viaTrailing.anchors.forwardEarningsHeuristic).toBe(110)

    const viaDefault = buildFundamentalsPayload('X', {
      ...base, defaultKeyStatistics: { forwardEps: 5 },
    }, closes, dates, ohlc, [], [], 100, Q)
    expect(viaDefault.anchors.forwardEarningsHeuristic).toBe(90) // 5 × 18
  })

  it('price falls back to financialData.currentPrice when no live price', () => {
    const p = buildFundamentalsPayload('X', {
      financialData: { currentPrice: 77.5 },
    }, closes, dates, ohlc, [], [], null, Q)
    expect(p.price).toBe(77.5)
  })
})
