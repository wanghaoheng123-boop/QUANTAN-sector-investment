// @vitest-environment jsdom
/**
 * Regression test for `components/backtest/PeriodSplitPanel.tsx` — pins
 * the `selectedTicker` resync fix.
 *
 * Pre-fix: `useState(results[0]?.ticker ?? '')` ran ONCE on mount; if the
 * parent later passed a new `results` prop where the previously-picked
 * ticker was filtered out, `results.find(...)` returned undefined and the
 * panel stuck on 'No instrument data available' permanently — until the
 * tab unmounted.
 *
 * Post-fix: a useEffect resyncs `selectedTicker` to `results[0].ticker`
 * whenever the new `results` array doesn't contain the current pick.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PeriodSplitPanel } from '@/components/backtest/PeriodSplitPanel'
import type { BacktestResult } from '@/lib/backtest/engine'

function makeResult(ticker: string): BacktestResult {
  return {
    ticker,
    sector: 'Test',
    totalReturn: 0.1,
    annualizedReturn: 0.08,
    totalTrades: 10,
    winRate: 0.6,
    profitFactor: 1.5,
    avgTradeReturn: 0.01,
    maxDrawdown: 0.05,
    sharpeRatio: 1.2,
    sortinoRatio: 1.5,
    bnhReturn: 0.05,
    excessReturn: 0.03,
    closedTrades: [],
    equityCurve: Array.from({ length: 252 }, (_, i) => 100000 * (1 + 0.0003 * i)),
  } as unknown as BacktestResult
}

describe('PeriodSplitPanel — selectedTicker resync', () => {
  it('initially selects the first ticker in results', () => {
    const results = [makeResult('AAPL'), makeResult('MSFT')]
    render(<PeriodSplitPanel results={results} />)

    expect(screen.getByText(/consecutive periods.*— AAPL/)).toBeInTheDocument()
  })

  it('resyncs to first available ticker when results no longer contains current pick', () => {
    const initial = [makeResult('AAPL'), makeResult('MSFT'), makeResult('GOOG')]
    const { rerender } = render(<PeriodSplitPanel results={initial} />)

    // User picks MSFT via the dropdown.
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'MSFT' } })
    expect(screen.getByText(/consecutive periods.*— MSFT/)).toBeInTheDocument()

    // Parent refetches with a filter that excludes MSFT. Pre-fix: panel
    // would render 'No instrument data available' until tab unmount.
    // Post-fix: the resync useEffect picks the first ticker in the new
    // array (NVDA in this case).
    rerender(<PeriodSplitPanel results={[makeResult('NVDA'), makeResult('TSLA')]} />)

    // Empty-state placeholder should NOT appear.
    expect(screen.queryByText(/No instrument data available/)).not.toBeInTheDocument()
    // The panel should display the new first ticker.
    expect(screen.getByText(/consecutive periods.*— NVDA/)).toBeInTheDocument()
  })

  it('renders empty-state when results is genuinely empty', () => {
    render(<PeriodSplitPanel results={[]} />)
    expect(screen.getByText(/No instrument data available/)).toBeInTheDocument()
  })

  it('does NOT clobber a still-valid selection when results updates with the same set', () => {
    const results = [makeResult('AAPL'), makeResult('MSFT')]
    const { rerender } = render(<PeriodSplitPanel results={results} />)

    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'MSFT' } })
    expect(screen.getByText(/consecutive periods.*— MSFT/)).toBeInTheDocument()

    // Refetch returns the SAME tickers (e.g., user clicked refresh). The
    // resync must NOT reset selection back to AAPL.
    rerender(<PeriodSplitPanel results={[makeResult('AAPL'), makeResult('MSFT')]} />)
    expect(screen.getByText(/consecutive periods.*— MSFT/)).toBeInTheDocument()
  })
})
