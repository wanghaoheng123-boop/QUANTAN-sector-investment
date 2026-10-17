/**
 * Q-133 / Q-136 / Q-139 — what the /backtest tables render for the engine's
 * new fields.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TradeLog from '@/components/backtest/TradeLog'
import InstrumentTable from '@/components/backtest/InstrumentTable'
import { KeyMetricsStrip } from '@/components/backtest/KeyMetricsStrip'
import type { BacktestResult, Trade } from '@/lib/backtest/engine'

function trade(over: Partial<Trade>): Trade {
  return {
    date: '2026-01-05', ticker: 'AAA', sector: 'Tech', action: 'BUY',
    entryPrice: 100, exitPrice: 100.1, shares: 100, value: 10_000,
    regime: 'FIRST_DIP', dipSignal: 'STRONG_DIP', confidence: 70,
    pnlPct: 0.001, reason: '__SYNTHETIC__ fixture', exitReason: 'time_exit',
    exitDate: '2026-04-01', netPnl: -12.0, ...over,
  }
}

function result(over: Partial<BacktestResult>): BacktestResult {
  return {
    ticker: 'AAA', sector: 'Tech', initialPrice: 100, finalPrice: 110,
    totalReturn: 0.05, annualizedReturn: 0.012, sharpeRatio: 0.3, sortinoRatio: 0.4,
    maxDrawdown: 0.02, winRate: 0.6, profitFactor: 1.4, avgTradeReturn: 0.01,
    totalTrades: 3, closedTrades: [], openTrade: null, dailyReturns: [], equityCurve: [1, 2],
    days: 1200, confidenceAvg: 70, bnhReturn: 0.4, excessReturn: -0.35, unaffordableEntries: 0,
    ...over,
  }
}

describe('Q-133: the trade log says why each position closed', () => {
  const html = renderToStaticMarkup(
    <TradeLog trades={[
      trade({}),
      trade({ ticker: 'BBB', exitReason: 'end_of_data', exitDate: '2026-10-12', netPnl: 500 }),
      trade({ ticker: 'CCC', exitReason: 'max_drawdown', exitDate: '2026-05-01', netPnl: -900 }),
    ]} />,
  )

  it('renders an Exit column with the reason and the exit date', () => {
    expect(html).toContain('>Exit<')
    expect(html).toContain('60-bar time exit · 2026-04-01')
    expect(html).toContain('End of data · 2026-10-12')
    expect(html).toContain('Drawdown breaker · 2026-05-01')
    expect(html).toContain('Entry reason')
  })

  it('counts a positive price move that lost money after costs as a LOSS', () => {
    // AAA moved +0.1% but netPnl is negative: 1 win (BBB), 2 losses.
    const winning = html.match(/Winning Trades<\/div><div[^>]*>(\d+)</)?.[1]
    const losing = html.match(/Losing Trades<\/div><div[^>]*>(\d+)</)?.[1]
    expect([winning, losing]).toEqual(['1', '2'])
  })

  it('offers no action filter when the engine recorded only one action', () => {
    expect(html).not.toContain('All Actions')
    expect(html).not.toContain('>SELL<')
  })
})

describe('Q-136: an instrument that never traded is labelled, not scored', () => {
  it('shows the label and dashes instead of 0% and a phantom excess', () => {
    const html = renderToStaticMarkup(
      <InstrumentTable sectorColors={{}} results={[
        result({}),
        result({ ticker: 'BTC', sector: 'Crypto', totalTrades: 0, totalReturn: 0, annualizedReturn: 0, excessReturn: -0.59, unaffordableEntries: 167 }),
      ]} />,
    )
    const btcRow = html.slice(html.indexOf('>BTC'), html.indexOf('</tr>', html.indexOf('>BTC')))
    expect(btcRow).toContain('not tradeable at this size')
    expect(btcRow).toContain('all 167 BUY signals')
    expect(btcRow).not.toContain('-59')
    expect(btcRow).not.toMatch(/[+−-]?0\.0+%/)
  })

  it('the metrics strip counts only instruments inside the aggregate', () => {
    const portfolio: Parameters<typeof KeyMetricsStrip>[0]['portfolio'] = {
      totalInstruments: 55, avgReturn: 0.037, avgAnnReturn: 0.0084, bnhAvg: 1.17, alpha: -1.13,
      maxPortfolioDd: 0.007, winRate: 0.6, totalTrades: 230,
    }
    const html = renderToStaticMarkup(<KeyMetricsStrip portfolio={portfolio} instrumentCount={56} />)
    expect(html).toContain('>55<')
    expect(html).toContain('In the portfolio figures, of 56 backtested')
  })
})

describe('Q-136 red-team F2/F4: no surface scores an instrument that never traded', () => {
  it('the Analysis tab omits it from the sector table, the risk table and the period picker, and says so', async () => {
    const { AnalysisTab } = await import('@/components/backtest/AnalysisTab')
    const html = renderToStaticMarkup(
      <AnalysisTab sectorColors={{}} results={[
        result({ equityCurve: Array.from({ length: 300 }, (_, i) => 100_000 + i) }),
        result({ ticker: 'BTC', sector: 'Crypto', totalTrades: 0, totalReturn: 0, annualizedReturn: 0, excessReturn: -0.59, unaffordableEntries: 167, equityCurve: Array.from({ length: 300 }, () => 100_000) }),
      ]} />,
    )
    expect(html).toContain('data-testid="analysis-omitted"')
    expect(html).toContain('Not shown here: BTC')
    expect(html).not.toContain('Crypto')
    expect(html).not.toMatch(/<option[^>]*>BTC</)
    expect(html).not.toContain('-59')
  })

  it('an aggregate with no instrument renders no figures, not zeros', () => {
    const portfolio: Parameters<typeof KeyMetricsStrip>[0]['portfolio'] = {
      totalInstruments: 0, avgReturn: 0, avgAnnReturn: 0, bnhAvg: 0, alpha: 0,
      maxPortfolioDd: 0, winRate: 0, totalTrades: 0,
    }
    const html = renderToStaticMarkup(<KeyMetricsStrip portfolio={portfolio} instrumentCount={1} />)
    expect(html).toContain('No portfolio figures')
    expect(html).not.toMatch(/0\.00%/)
  })
})

describe('Q-133 red-team F12/F13: the trade log under an older cached response', () => {
  it('closed trades without exitReason/netPnl are not "Open", and the counts are unknown, not 0', () => {
    const old = trade({ exitReason: undefined as unknown as Trade['exitReason'], exitDate: undefined as unknown as string, netPnl: undefined as unknown as number })
    const html = renderToStaticMarkup(<TradeLog trades={[old]} />)
    expect(html).not.toContain('>Open<')
    expect(html).toMatch(/Winning Trades<\/div><div[^>]*>—</)
    expect(html).toContain('Signal date')
  })
})

