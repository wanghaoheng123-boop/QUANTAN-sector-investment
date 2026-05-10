/**
 * Historical stress test scenarios for portfolio risk assessment.
 *
 * Replays portfolio through documented historical crises using
 * actual market returns. Returns portfolio P&L and drawdown metrics.
 *
 * Scenarios:
 *   - GFC 2008/2009 (peak: Oct 2007, trough: Mar 2009)
 *   - COVID-19 2020 crash (Feb 19 – Mar 23, 2020)
 *   - Rate Shock 2022 (Jan 2022 – Oct 2022)
 *   - Dot-com bust 2000-2002 (Mar 2000 – Oct 2002)
 *   - 2018 Q4 selloff (Sep – Dec 2018)
 */

export type ScenarioId = 'gfc2008' | 'covid2020' | 'rateShock2022' | 'dotcom2000' | 'selloff2018'

export interface StressScenario {
  id: ScenarioId
  name: string
  startDate: string  // YYYY-MM-DD
  endDate: string
  description: string
  /** Expected SPY drawdown during this period (reference) */
  spyDrawdown: number
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: 'gfc2008',
    name: 'GFC 2008/2009',
    startDate: '2007-10-01',
    endDate: '2009-03-31',
    description: 'Global Financial Crisis — SPY -56% peak to trough',
    spyDrawdown: -0.565,
  },
  {
    id: 'covid2020',
    name: 'COVID-19 Crash 2020',
    startDate: '2020-02-19',
    endDate: '2020-03-23',
    description: 'Fastest 30%+ drawdown in market history — 33 trading days',
    spyDrawdown: -0.339,
  },
  {
    id: 'rateShock2022',
    name: 'Rate Shock 2022',
    startDate: '2022-01-01',
    endDate: '2022-10-12',
    description: 'Fed rate hike cycle — S&P -27% YTD, NASDAQ -36%',
    spyDrawdown: -0.274,
  },
  {
    id: 'dotcom2000',
    name: 'Dot-com Bust 2000-2002',
    startDate: '2000-03-24',
    endDate: '2002-10-09',
    description: 'Tech bubble burst — NASDAQ -78%, S&P -49%',
    spyDrawdown: -0.491,
  },
  {
    id: 'selloff2018',
    name: 'Q4 2018 Selloff',
    startDate: '2018-09-20',
    endDate: '2018-12-24',
    description: 'Fed tightening + trade war fears — S&P -20%',
    spyDrawdown: -0.196,
  },
]

export interface StressTestResult {
  scenario: StressScenario
  /** Portfolio return during the stress period */
  portfolioReturn: number
  /** Max drawdown during the stress period */
  maxDrawdown: number
  /** Days to recovery (from trough to new high), or null if not recovered */
  recoveryDays: number | null
  /** Per-ticker returns during stress period */
  tickerReturns: Record<string, number>
  /** Worst position during stress */
  worstTicker: { ticker: string; return: number } | null
  /** Best position during stress (defensive) */
  bestTicker: { ticker: string; return: number } | null
  /** Estimated portfolio dollar loss at peak drawdown */
  estimatedLoss: number
}

/**
 * Run a stress test on a portfolio.
 *
 * @param weights          Current portfolio weights (ticker → fraction)
 * @param historicalReturns  Historical daily returns per ticker
 * @param portfolioValue   Current portfolio value in $
 * @param scenario         Stress scenario to test
 */
export function runStressTest(
  weights: Record<string, number>,
  historicalReturns: Record<string, { date: string; return: number }[]>,
  portfolioValue: number,
  scenario: StressScenario,
): StressTestResult {
  const { startDate, endDate } = scenario
  const tickers = Object.keys(weights).filter(t => weights[t] > 0)

  // Extract returns for each ticker during the scenario window
  const tickerPeriodReturns: Record<string, number[]> = {}
  for (const t of tickers) {
    const series = (historicalReturns[t] ?? []).filter(
      d => d.date >= startDate && d.date <= endDate,
    )
    tickerPeriodReturns[t] = series.map(d => d.return)
  }

  // Compute portfolio daily returns (weighted average)
  const n = Math.min(...Object.values(tickerPeriodReturns).map(r => r.length))
  const portDailyReturns: number[] = new Array(n).fill(0)
  for (const t of tickers) {
    const rets = tickerPeriodReturns[t].slice(0, n)
    for (let i = 0; i < n; i++) {
      portDailyReturns[i] += weights[t] * (rets[i] ?? 0)
    }
  }

  // Cumulative portfolio return
  let portfolioReturn = 0
  let equity = 1.0
  let peakEquity = 1.0
  let maxDd = 0
  for (const r of portDailyReturns) {
    equity *= (1 + r)
    if (equity > peakEquity) peakEquity = equity
    const dd = (peakEquity - equity) / peakEquity
    if (dd > maxDd) maxDd = dd
  }
  portfolioReturn = equity - 1

  // Per-ticker cumulative returns during period
  const tickerReturns: Record<string, number> = {}
  for (const t of tickers) {
    const rets = tickerPeriodReturns[t]
    let cum = 1.0
    for (const r of rets) cum *= (1 + r)
    tickerReturns[t] = cum - 1
  }

  // Worst / best ticker
  const tickerEntries = Object.entries(tickerReturns)
  const worstEntry = tickerEntries.length > 0
    ? tickerEntries.reduce((min, cur) => cur[1] < min[1] ? cur : min)
    : null
  const bestEntry = tickerEntries.length > 0
    ? tickerEntries.reduce((max, cur) => cur[1] > max[1] ? cur : max)
    : null

  // estimatedLoss: positive dollar magnitude of peak loss.
  // portfolioValue * portfolioReturn gives the signed PnL (negative for losses).
  // Use Math.abs with Math.min(0, ...) to get a positive number, or compute
  // max drawdown based loss for a more conservative estimate.
  const estimatedLoss = Math.abs(portfolioValue * Math.min(0, portfolioReturn))

  return {
    scenario,
    portfolioReturn,
    maxDrawdown: maxDd,
    recoveryDays: null, // Would need post-scenario data to compute
    tickerReturns,
    worstTicker: worstEntry ? { ticker: worstEntry[0], return: worstEntry[1] } : null,
    bestTicker: bestEntry ? { ticker: bestEntry[0], return: bestEntry[1] } : null,
    estimatedLoss,
  }
}

/**
 * Run all stress scenarios and return summary table.
 */
export function runAllStressTests(
  weights: Record<string, number>,
  historicalReturns: Record<string, { date: string; return: number }[]>,
  portfolioValue: number,
): StressTestResult[] {
  return STRESS_SCENARIOS.map(s => runStressTest(weights, historicalReturns, portfolioValue, s))
}

/**
 * Format stress test results for display.
 */
export function formatStressResults(results: StressTestResult[]): string {
  const header = 'Scenario                 | Port Return | Max DD  | vs SPY  | Worst Ticker'
  const divider = '-'.repeat(80)
  const rows = results.map(r => {
    const pr = (r.portfolioReturn * 100).toFixed(1) + '%'
    const dd = (r.maxDrawdown * 100).toFixed(1) + '%'
    const spy = (r.scenario.spyDrawdown * 100).toFixed(1) + '%'
    const worst = r.worstTicker ? `${r.worstTicker.ticker} (${(r.worstTicker.return * 100).toFixed(1)}%)` : 'N/A'
    return `${r.scenario.name.padEnd(25)}| ${pr.padEnd(12)}| ${dd.padEnd(8)}| ${spy.padEnd(8)}| ${worst}`
  })
  return [header, divider, ...rows].join('\n')
}
