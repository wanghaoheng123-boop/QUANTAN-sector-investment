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
import {
  buildFundamentalsPayload, dcfApplicability, scenarioRates, scenarioOrderNote, MIN_RATE_SPREAD,
  type FundamentalsQuery,
} from '@/lib/quant/buildFundamentalsPayload'
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
    // MIGRATION NOTE (Q110-Q2, 2026-09-05). This golden was 0.005516396121 and
    // it FROZE A BUG: `maxDrawdown` divided the largest absolute drop by the
    // final running peak instead of the peak standing when it happened, which
    // can only ever understate. The old golden matches the buggy formula to
    // 1e-12; the value below matches an INDEPENDENT oracle to 1e-12 (recomputed
    // from this file's own `series(320)` without touching the implementation).
    //
    // A dense golden is a snapshot, and a snapshot of wrong output ratifies the
    // wrongness — this one made the bug look deliberate for as long as it stood.
    // The property version lives in __tests__/quant/maxDrawdown.regression.test.ts
    // and checks an oracle against all 56 fixtures, which is what should have
    // caught this.
    expect(t.maxDrawdownPct).toBeCloseTo(0.005608197080703907, 10)
    expect(t.sharpe).toBeCloseTo(7.700214771, 6)
      // MIGRATION NOTE — Q110-Q4b (2026-09-06): LPM2 denominator is N, not n_d.
    expect(t.sortino).toBeCloseTo(22.25661304, 6)  // was 13.70744206 (n_d)
    expect(t.vol20dAnnualized).toBeCloseTo(0.04493978862, 9)
    expect(t.vol60dAnnualized).toBeCloseTo(0.04473398153, 9)
    expect(t.volRegime20over60).toBeCloseTo(1.004600688, 8)
  })

  it('DENSE GOLDENS: DCF scenarios, bands, anchors, volatility', () => {
    // MIGRATION NOTE — Q-086 (2026-10-17): FCFE, no net-debt bridge. This fixture
    // carries a balance sheet (30e9 + 5e9 debt, 20e9 cash) of the kind Yahoo
    // stopped sending on the tickers measured, so here every per-share value
    // rises by exactly 15e9 / 1e9 shares = $15 and the composite bands (median
    // anchor 160) do not move. That holds for an ADMITTED name only: a refused
    // name loses its bands and signal (see the B1 + B5 suite below).
    const base = payload.dcf.scenarios.base!
    expect(payload.dcf.model).toBe('FCFE')
    expect(payload.dcf.notApplicable).toBeNull()
    expect(base.enterpriseValue).toBeCloseTo(146538889000, -4)
    expect(base.equityValue).toBeCloseTo(146538889000, -4)
    expect(base.valuePerShare).toBeCloseTo(146.538889, 5)
    expect(base.pvExplicit).toBeCloseTo(36815975170, -4)
    expect(base.pvTerminal).toBeCloseTo(109722913800, -4)
    expect(base.terminalValueRaw).toBeCloseTo(168822303600, -4)
    expect(base.netDebtUsed).toBe(0) // FCFE: levered FCF is already after debt service
    expect(payload.dcf.scenarios.bear!.valuePerShare).toBeCloseTo(96, 4)
    expect(payload.dcf.scenarios.bull!.valuePerShare).toBeCloseTo(205.6943245, 5)

    expect(payload.bands!.fairValueMid).toBeCloseTo(160, 8) // median of 146.5/180/160
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
      // Classification present: without it the DCF now refuses (fails closed, accountant B2).
      summaryProfile: { sector: 'Technology', industry: 'Software' },
      defaultKeyStatistics: { sharesOutstanding: 1e9 },
      cashflowStatementHistory: {
        cashflowStatements: [
          { totalCashFromOperatingActivities: 10e9, capitalExpenditures: -3e9 },
        ],
      },
    }
    const p = buildFundamentalsPayload('X', qs, closes, dates, ohlc, [], [], 100, Q)
    expect(p.dcf.inputs.fcf0).toBe(7e9) // 10e9 − |−3e9|
    expect(p.dcf.inputs.fcf0Source).toBe('statement.ocfLessCapex')
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

describe('Q-086: an FCF DCF is refused where it does not apply', () => {
  const { closes, dates, ohlc } = series(320)
  const spy = series(320, 0.0008)
  const build = (industry: string) => buildFundamentalsPayload(
    'BANK', { ...richQuoteSummary, summaryProfile: { ...(richQuoteSummary.summaryProfile as object), industry } },
    closes, dates, ohlc, spy.closes, spy.dates, 150, Q,
  )

  it.each(['Banks - Diversified', 'Banks - Regional', 'Insurance - Diversified', 'Capital Markets'])('%s: no scenario, and the reason', (industry) => {
    const p = build(industry)
    expect(p.dcf.scenarios).toEqual({ bear: null, base: null, bull: null })
    expect(p.dcf.notApplicable).toMatch(/does not apply/)
    expect(p.anchors.dcfBase).toBeNull()
  })

  // Re-titled (accountant B3): the old test, "a payments network is not a
  // bank: Credit Services keeps its DCF", approved a label that also holds card
  // and consumer lenders. No field separates them, so the label is refused.
  it.each(['Credit Services', 'Asset Management'])('%s is a mixed label and is refused, with that reason', (industry) => {
    const p = build(industry)
    expect(p.dcf.scenarios.base).toBeNull()
    expect(p.dcf.notApplicable).toMatch(/no field separates them/)
  })

  it.each(['REIT - Mortgage', 'Financial Conglomerates', 'Mortgage Finance', 'Insurance - Life', 'Banks—Regional'])(
    '%s is refused (accountant B3: the first two were admitted)', (industry) => {
      expect(build(industry).dcf.notApplicable).toMatch(/balance sheet is the product/)
    })

  it('Insurance Brokers and exchanges are fee businesses and keep their DCF', () => {
    for (const industry of ['Insurance Brokers', 'Financial Data & Stock Exchanges']) {
      const p = buildFundamentalsPayload('X', { ...richQuoteSummary, summaryProfile: { sector: 'Financial Services', industry } },
        closes, dates, ohlc, spy.closes, spy.dates, 150, Q)
      expect(p.dcf.notApplicable, industry).toBeNull()
      expect(p.dcf.scenarios.base, industry).not.toBeNull()
    }
  })
})

describe('Q-086 accountant B2: the refusal fails CLOSED on missing classification', () => {
  const { closes, dates, ohlc } = series(320)
  const spy = series(320, 0.0008)
  const run = (over: Record<string, unknown>) => {
    const { summaryProfile: _sp, ...rest } = richQuoteSummary as Record<string, unknown>
    return buildFundamentalsPayload('X', { ...rest, ...over }, closes, dates, ohlc, spy.closes, spy.dates, 150, Q)
  }

  it('no profile at all: refused, with the reason', () => {
    const p = run({})
    expect(p.dcf.scenarios.base).toBeNull()
    expect(p.dcf.notApplicable).toMatch(/sector and industry are unavailable/)
  })

  it('a profile with no industry and no sector: refused', () => {
    expect(run({ summaryProfile: { longName: 'X' } }).dcf.notApplicable).toMatch(/unavailable/)
  })

  it('summaryProfile {} no longer hides a populated assetProfile', () => {
    expect(run({ summaryProfile: {}, assetProfile: { sector: 'Financial Services', industry: 'Banks - Regional' } }).dcf.notApplicable)
      .toMatch(/Banks - Regional/)
  })

  it('a non-string industry is not read as an industry', () => {
    expect(run({ summaryProfile: { industry: 42 } }).dcf.notApplicable).toMatch(/unavailable/)
  })

  it('Financial Services with no industry is refused; another sector with no industry is not', () => {
    expect(dcfApplicability({ sector: 'Financial Services', industry: null })).toMatch(/industry unavailable/)
    expect(dcfApplicability({ sector: 'Technology', industry: null })).toBeNull()
  })

  it('an unrecognised Financial Services label is refused by default (allowlist, not denylist)', () => {
    // A lender label Yahoo adds tomorrow must not slip through a denylist.
    expect(dcfApplicability({ sector: 'Financial Services', industry: 'Specialty Lending' })).toMatch(/balance sheet is the product/)
    expect(dcfApplicability({ sector: 'Technology', industry: 'Specialty Lending' })).toBeNull()
  })
})

describe('Q-086 accountant B1 + B5: a refused name gets no bands, signal or band score', () => {
  const { closes, dates, ohlc } = series(320)
  const spy = series(320, 0.0008)
  const build = (industry: string, sector = 'Technology') => buildFundamentalsPayload(
    'X', { ...richQuoteSummary, summaryProfile: { ...(richQuoteSummary.summaryProfile as object), sector, industry } },
    closes, dates, ohlc, spy.closes, spy.dates, 150, Q,
  )

  it('the same company, refused, draws no buy/sell zones from the remaining anchors', () => {
    const admitted = build('Software')
    const refused = build('Banks - Regional', 'Financial Services')
    // Before the refusal existed the bank got the admitted row's numbers; that
    // the composite moved for refused names is the migration B1 says to record.
    expect(admitted.bands?.fairValueMid).not.toBeNull()
    expect(admitted.signal).not.toBeNull()
    expect(refused.bands).toBeNull()
    expect(refused.signal).toBeNull()
    // The band pillar takes its no-band branch rather than scoring a band
    // drawn from two anchors.
    const bandPillar = (p: typeof refused) => p.researchScore.pillars.find((x: { name: string }) => x.name === 'Valuation band fit')
    expect(bandPillar(refused)).toEqual({ name: 'Valuation band fit', score: 50, detail: 'Bands unavailable.' })
    expect(bandPillar(admitted)?.detail).not.toBe('Bands unavailable.')
  })

  it('a missing input (not a refusal) still draws bands, and the methodology names only the anchors used', () => {
    const { defaultKeyStatistics, ...rest } = richQuoteSummary as Record<string, unknown>
    const p = buildFundamentalsPayload('X', { ...rest, defaultKeyStatistics: { ...(defaultKeyStatistics as object), sharesOutstanding: undefined } },
      closes, dates, ohlc, spy.closes, spy.dates, 150, Q)
    expect(p.dcf.unavailable).toMatch(/no shares outstanding/)
    expect(p.dcf.notApplicable).toBeNull()
    expect(p.bands?.methodology).toMatch(/median of 2 anchor\(s\) \(analyst mean target, forward EPS × P\/E heuristic\)/)
    expect(p.bands?.methodology).not.toMatch(/DCF/)
  })
})

describe('Q-086 accountant S1/S2/S4/S7: scenarios say what they computed', () => {
  const { closes, dates, ohlc } = series(320)
  const spy = series(320, 0.0008)
  const build = (q: Partial<FundamentalsQuery>, over: Record<string, unknown> = {}) =>
    buildFundamentalsPayload('X', { ...richQuoteSummary, ...over }, closes, dates, ohlc, spy.closes, spy.dates, 150, { ...Q, ...q })

  it('the bull rate is never above base and no longer pinned at an absolute 6%', () => {
    // 4.0%: the base spread itself is under MIN_RATE_SPREAD, so that DCF is refused outright.
    for (const wacc of [0.045, 0.05, 0.06, 0.065, 0.07, 0.09, 0.12]) {
      const r = scenarioRates({ wacc, terminalGrowth: 0.025 })
      expect(r.bull, String(wacc)).toBeLessThanOrEqual(r.base)
      expect(r.bear).toBeGreaterThan(r.base)
      expect(r.bull - 0.025).toBeGreaterThanOrEqual(MIN_RATE_SPREAD - 1e-12)
    }
    // 6.5% and 7% now differ (the old floor gave 6% for both).
    expect(scenarioRates({ wacc: 0.065, terminalGrowth: 0.025 }).bull).toBeCloseTo(0.055, 12)
    expect(scenarioRates({ wacc: 0.07, terminalGrowth: 0.025 }).bull).toBeCloseTo(0.06, 12)
  })

  it('values are ordered bear ≤ base ≤ bull across the slider range, or a note says why not', () => {
    for (const wacc of [0.05, 0.06, 0.07, 0.09, 0.12]) {
      const p = build({ wacc })
      const s = p.dcf.scenarios
      if (s.bear && s.base && s.bull) {
        expect(s.bear.valuePerShare, String(wacc)).toBeLessThanOrEqual(s.base.valuePerShare)
        expect(s.base.valuePerShare, String(wacc)).toBeLessThanOrEqual(s.bull.valuePerShare)
      }
    }
    expect(scenarioOrderNote({ gBear: 0.12, gBase: 0.05, gBull: 0 }, { base: 0.09, bull: 0.08 })).toMatch(/not ordered/)
    expect(scenarioOrderNote({ gBear: 0.02, gBase: 0.05, gBull: 0.09 }, { base: 0.09, bull: 0.08 })).toBeNull()
  })

  it('a discount rate within MIN_RATE_SPREAD of terminal growth is refused with a reason, not 105,000/sh', () => {
    const p = build({ wacc: 0.0501, terminalGrowth: 0.05 })
    expect(p.dcf.scenarios.base).toBeNull()
    expect(p.dcf.unavailable).toMatch(/within 2 points of terminal growth/)
  })

  it('a reporting currency that differs from the quote currency is refused', () => {
    const p = build({}, {
      financialData: { ...(richQuoteSummary.financialData as object), financialCurrency: 'TWD' },
      price: { currency: 'USD' },
    })
    expect(p.dcf.scenarios.base).toBeNull()
    expect(p.dcf.notApplicable).toMatch(/reported in TWD and the price is quoted in USD/)
  })

  it('a non-positive fallback cash flow gives a reason, not a silent dash', () => {
    const { financialData, ...rest } = richQuoteSummary as Record<string, unknown>
    const p = buildFundamentalsPayload('X', {
      ...rest,
      financialData: { ...(financialData as object), freeCashflow: undefined },
      cashflowStatementHistory: { cashflowStatements: [{ totalCashFromOperatingActivities: 1e9, capitalExpenditures: -3e9 }] },
    }, closes, dates, ohlc, spy.closes, spy.dates, 150, Q)
    expect(p.dcf.inputs.fcf0).toBeNull()
    expect(p.dcf.unavailable).toMatch(/no positive free cash flow/)
  })

  it('records which cash-flow field fired, and the discount rate under its own name', () => {
    const p = build({})
    expect(p.dcf.inputs.fcf0Source).toBe('financialData.freeCashflow')
    expect(p.dcf.inputs.discountRate).toBe(Q.wacc)
  })
})

