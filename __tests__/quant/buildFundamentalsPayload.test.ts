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

  // Q-078 wave 2 (2026-07-17): the first measurement after this suite landed
  // scored the file at 32.78 — 275 mutants SURVIVED because line coverage is
  // not value coverage: the assertions above touch a subset of the payload.
  // This block pins the numeric payload DENSELY (goldens generated from this
  // exact fixture; update from the failure diff on intended changes).

  it('DENSE GOLDENS: technicals block to 6 decimals', () => {
    const t = payload.technicals
    expect(t.sma20).toBeCloseTo(159.7960414, 6)
    expect(t.sma50).toBeCloseTo(156.232829, 6)
    expect(t.sma200).toBeCloseTo(140.1290404, 6)
    expect(t.rsi14).toBeCloseTo(82.63741586, 6)
    expect(t.macd.line).toBeCloseTo(1.763914905, 8)
    expect(t.macd.signal).toBeCloseTo(1.652314666, 8)
    expect(t.macd.histogram).toBeCloseTo(0.1116002383, 8)
    expect(t.bollinger.mid).toBeCloseTo(159.7960414, 6)
    expect(t.bollinger.upper).toBeCloseTo(163.0138537, 6)
    expect(t.bollinger.lower).toBeCloseTo(156.578229, 6)
    expect(t.bollinger.pctB).toBeCloseTo(0.9618517816, 8)
    expect(t.atr14).toBeCloseTo(1.245320725, 8)
    expect(t.atrStopLong).toBeCloseTo(160.2777047, 6)
    expect(t.atrStopShort).toBeCloseTo(165.2589876, 6)
    expect(t.trendLabel).toBe('Golden cross zone (SMA50 above SMA200)')
    expect(t.maxDrawdownPct).toBeCloseTo(0.005516396121, 10)
    expect(t.sharpe).toBeCloseTo(7.700214771, 6)
    expect(t.sortino).toBeCloseTo(13.70744206, 6)
    expect(t.vol20dAnnualized).toBeCloseTo(0.04493978862, 9)
    expect(t.vol60dAnnualized).toBeCloseTo(0.04473398153, 9)
    expect(t.volRegime20over60).toBeCloseTo(1.004600688, 8)
  })

  it('DENSE GOLDENS: DCF scenarios, bands, anchors, volatility', () => {
    const base = payload.dcf.scenarios.base!
    expect(base.enterpriseValue).toBeCloseTo(146538889000, -4)
    expect(base.equityValue).toBeCloseTo(131538889000, -4)
    expect(base.valuePerShare).toBeCloseTo(131.538889, 5)
    expect(base.pvExplicit).toBeCloseTo(36815975170, -4)
    expect(base.pvTerminal).toBeCloseTo(109722913800, -4)
    expect(base.terminalValueRaw).toBeCloseTo(168822303600, -4)
    expect(base.netDebtUsed).toBe(15e9) // 30e9 LTD + 5e9 STD − 20e9 cash
    expect(payload.dcf.scenarios.bear!.valuePerShare).toBeCloseTo(81, 4)
    expect(payload.dcf.scenarios.bull!.valuePerShare).toBeCloseTo(190.6943245, 5)

    expect(payload.bands!.fairValueMid).toBeCloseTo(160, 8) // median of 131.5/180/160
    expect(payload.bands!.buyZoneHigh).toBeCloseTo(142.4, 6)
    expect(payload.bands!.sellZoneLow).toBeCloseTo(171.6, 6)
    expect(payload.anchors).toEqual({
      dcfBase: base.valuePerShare, analystTarget: 180, forwardEarningsHeuristic: 160,
    })
    expect(payload.volatility.annualized).toBeCloseTo(0.04488440636, 9)
    expect(payload.volatility.sampleDays).toBe(320)
  })

  it('DENSE GOLDENS: research score, 52w range, fib, relative, pivots, regime', () => {
    expect(payload.researchScore.total).toBeCloseTo(55.91357202, 6)
    expect(payload.researchScore.pillars.map((p) => p.score)[0]).toBe(55)
    expect(payload.researchScore.pillars.map((p) => p.score)[1]).toBe(65)
    expect(payload.researchScore.pillars[2].score).toBeCloseTo(37.78752805, 6)
    expect(payload.researchScore.pillars[3].score).toBeCloseTo(55.44471564, 6)
    expect(payload.researchScore.pillars[4].score).toBeCloseTo(66.78082192, 6)

    expect(payload.range52w.high).toBeCloseTo(162.7683461, 6)
    expect(payload.range52w.low).toBeCloseTo(111.1727783, 6)
    expect(payload.range52w.position).toBeCloseTo(0.7525301755, 8)
    expect(payload.fibRetracement!.fib382).toBeCloseTo(143.0588392, 6)
    expect(payload.fibRetracement!.fib500).toBeCloseTo(136.9705622, 6)
    expect(payload.fibRetracement!.fib618).toBeCloseTo(130.8822852, 6)

    expect(payload.relative.correlationVsSpy).toBeCloseTo(1, 8) // same sin phase
    expect(payload.relative.excessReturn20dVsSpy).toBeCloseTo(0.01432068639, 9)
    expect(payload.relative.excessReturn60dVsSpy).toBeCloseTo(0.04537263031, 9)

    expect(payload.pivots!.pivot).toBeCloseTo(162.7400219, 6)
    expect(payload.pivots!.r1).toBeCloseTo(163.1966704, 6)
    expect(payload.pivots!.r2).toBeCloseTo(163.6249946, 6)
    expect(payload.pivots!.r3).toBeCloseTo(164.0816431, 6)
    expect(payload.pivots!.s1).toBeCloseTo(162.3116976, 6)
    expect(payload.pivots!.s2).toBeCloseTo(161.8550492, 6)
    expect(payload.pivots!.s3).toBeCloseTo(161.4267249, 6)

    expect(payload.signal).toEqual({
      label: 'Inside neutral band',
      detail: 'Between buy-zone and sell-zone vs fair value ~160.00 — model is not aggressive either way.',
    })
    expect(payload.ma200Regime!.zone).toBe('HEALTHY_BULL')
    expect(payload.ma200Regime!.dipSignal).toBe('IN_TREND')
    expect(payload.ma200Regime!.deviationPct).toBeCloseTo(7.044192642, 6)
    expect(payload.ma200Regime!.slopePct).toBeCloseTo(0.03041242190, 8)
    expect(payload.ma200Regime!.slopePositive).toBe(true)
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
