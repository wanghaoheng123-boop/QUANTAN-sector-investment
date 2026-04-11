import { describe, it, expect } from 'vitest'
import {
  runStressTests,
  classifyTicker,
  SCENARIOS,
  type StressPosition,
} from '@/lib/portfolio/stressTest'

const longEquityPortfolio: StressPosition[] = [
  { ticker: 'SPY', marketValue: 50_000, assetClass: 'equity_us' },
  { ticker: 'QQQ', marketValue: 30_000, assetClass: 'equity_tech' },
  { ticker: 'TLT', marketValue: 20_000, assetClass: 'bond_us_long' },
]

const TOTAL_VALUE = 100_000

describe('runStressTests', () => {
  it('returns a result for every scenario', () => {
    const report = runStressTests(longEquityPortfolio, TOTAL_VALUE)
    expect(report.scenarios).toHaveLength(SCENARIOS.length)
  })

  it('identifies worst-case scenario', () => {
    const report = runStressTests(longEquityPortfolio, TOTAL_VALUE)
    const minPct = Math.min(...report.scenarios.map((s) => s.portfolioShockPct))
    expect(report.worstCase.portfolioShockPct).toBeCloseTo(minPct, 5)
  })

  it('GFC 2008 produces large negative shock for equity portfolio', () => {
    const report = runStressTests(longEquityPortfolio, TOTAL_VALUE)
    const gfc = report.scenarios.find((s) => s.scenario === 'GFC 2008')!
    expect(gfc).toBeDefined()
    expect(gfc.portfolioShockPct).toBeLessThan(-0.3)  // > 30% loss
  })

  it('TLT offset reduces GFC shock vs all-equity', () => {
    const allEquity: StressPosition[] = [
      { ticker: 'SPY', marketValue: 100_000, assetClass: 'equity_us' },
    ]
    const mixed: StressPosition[] = [
      { ticker: 'SPY', marketValue: 80_000, assetClass: 'equity_us' },
      { ticker: 'TLT', marketValue: 20_000, assetClass: 'bond_us_long' },
    ]
    const r1 = runStressTests(allEquity, 100_000)
    const r2 = runStressTests(mixed, 100_000)
    const gfc1 = r1.scenarios.find((s) => s.scenario === 'GFC 2008')!.portfolioShockPct
    const gfc2 = r2.scenarios.find((s) => s.scenario === 'GFC 2008')!.portfolioShockPct
    expect(gfc2).toBeGreaterThan(gfc1)  // mixed portfolio less bad
  })

  it('short position benefits from negative shock', () => {
    const short: StressPosition[] = [
      { ticker: 'QQQ', marketValue: -50_000, assetClass: 'equity_tech' },
    ]
    const report = runStressTests(short, 100_000)
    const gfc = report.scenarios.find((s) => s.scenario === 'GFC 2008')!
    expect(gfc.portfolioShockPct).toBeGreaterThan(0)  // short profits
  })

  it('rate shock 2022: energy positive, tech negative', () => {
    const portfolio: StressPosition[] = [
      { ticker: 'XLE', marketValue: 50_000, assetClass: 'equity_energy' },
      { ticker: 'QQQ', marketValue: 50_000, assetClass: 'equity_tech' },
    ]
    const report = runStressTests(portfolio, 100_000)
    const rs = report.scenarios.find((s) => s.scenario === 'Rate Shock 2022')!
    const xleBreakdown = rs.positionBreakdown.find((p) => p.ticker === 'XLE')!
    const qqqBreakdown = rs.positionBreakdown.find((p) => p.ticker === 'QQQ')!
    expect(xleBreakdown.pnlImpact).toBeGreaterThan(0)   // energy up
    expect(qqqBreakdown.pnlImpact).toBeLessThan(0)      // tech down
  })

  it('respects scenario filter', () => {
    const report = runStressTests(longEquityPortfolio, TOTAL_VALUE, [
      SCENARIOS.find((s) => s.name === 'COVID Crash 2020')!,
    ])
    expect(report.scenarios).toHaveLength(1)
    expect(report.scenarios[0].scenario).toBe('COVID Crash 2020')
  })

  it('averageLoss is mean of all scenario shocks', () => {
    const report = runStressTests(longEquityPortfolio, TOTAL_VALUE)
    const expected = report.scenarios.reduce((s, r) => s + r.portfolioShock, 0) / report.scenarios.length
    expect(report.avgLoss).toBeCloseTo(expected, 2)
  })
})

describe('classifyTicker', () => {
  it('classifies known ETFs', () => {
    expect(classifyTicker('SPY')).toBe('equity_us')
    expect(classifyTicker('TLT')).toBe('bond_us_long')
    expect(classifyTicker('GLD')).toBe('commodity_gold')
    expect(classifyTicker('HYG')).toBe('bond_hy')
    expect(classifyTicker('XLE')).toBe('equity_energy')
  })

  it('classifies known mega-cap stocks', () => {
    expect(classifyTicker('AAPL')).toBe('equity_tech')
    expect(classifyTicker('JPM')).toBe('equity_finance')
    expect(classifyTicker('XOM')).toBe('equity_energy')
  })

  it('returns unknown for unrecognized tickers', () => {
    expect(classifyTicker('XYZABC')).toBe('unknown')
  })

  it('is case-insensitive', () => {
    expect(classifyTicker('spy')).toBe('equity_us')
    expect(classifyTicker('Tlt')).toBe('bond_us_long')
  })
})
