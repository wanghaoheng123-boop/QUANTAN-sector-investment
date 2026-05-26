// @vitest-environment jsdom
/**
 * PoC component snapshot test (Q-027 infrastructure verification).
 *
 * This file is the canary that proves the Phase 16 component-test pipeline
 * works end-to-end: vitest jsdom env, @testing-library/react render(),
 * @testing-library/jest-dom matchers, and the per-file environment switch
 * in vitest.config.ts.
 *
 * BacktestMetricsGrid was chosen as the PoC subject because it is:
 *   - Small (30 LOC, pure presentational)
 *   - 100% deterministic given props (no useEffect, no API calls)
 *   - Already shipped to production (extracted from app/backtest/page.tsx
 *     in Phase 15 Q-019 partial)
 *
 * Phase 16 S2 will extend this pattern to the god components
 * (QuantLabPanel 1684 LOC, app/backtest/page.tsx 887 LOC) where snapshot
 * coverage is the precondition for safe decomposition.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BacktestMetricsGrid } from '@/components/backtest/BacktestMetricsGrid'

describe('BacktestMetricsGrid (Q-027 PoC)', () => {
  it('renders all three metric tiles with formatted percent / count values', () => {
    const { container } = render(
      <BacktestMetricsGrid winRate={0.5705} totalTrades={1390} avgReturn={0.01409} />,
    )
    // Labels are present
    expect(screen.getByText(/Win rate/i)).toBeInTheDocument()
    expect(screen.getByText(/Trades/i)).toBeInTheDocument()
    expect(screen.getByText(/Avg return/i)).toBeInTheDocument()
    // Values are formatted correctly
    expect(screen.getByText('57.05%')).toBeInTheDocument()
    expect(screen.getByText('1390')).toBeInTheDocument()
    expect(screen.getByText('1.41%')).toBeInTheDocument()
    // Structural snapshot guards against accidental DOM-shape drift during
    // a future Q-054 decomposition refactor.
    expect(container.firstChild).toMatchSnapshot()
  })

  it('handles zero / extreme inputs without crashing', () => {
    const { rerender } = render(
      <BacktestMetricsGrid winRate={0} totalTrades={0} avgReturn={0} />,
    )
    // With winRate=0 and avgReturn=0, '0.00%' appears twice (one tile each).
    expect(screen.getAllByText('0.00%')).toHaveLength(2)
    expect(screen.getByText('0')).toBeInTheDocument() // totalTrades tile
    // Negative average return (losing strategy)
    rerender(<BacktestMetricsGrid winRate={0.3} totalTrades={50} avgReturn={-0.025} />)
    expect(screen.getByText('-2.50%')).toBeInTheDocument()
    expect(screen.getByText('30.00%')).toBeInTheDocument()
  })
})
