'use client'

/**
 * OverviewTab — sector heatmap + top equity curves + strategy rules
 * for the backtest page Overview tab.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx.
 * Pure presentational; composes existing SectorHeatmap, ChartErrorBoundary,
 * EquityCurveChart primitives.
 *
 * The strategy-rules grid is static documentation that explains the
 * backtest's signal/exit/sizing logic to the user. Kept inline (not its
 * own component) because it's tightly coupled to one render site and the
 * 8 rules belong as a single visual block.
 */

import EquityCurveChart from '@/components/backtest/EquityCurveChart'
import { ChartErrorBoundary } from '@/components/ChartErrorBoundary'
import SectorHeatmap from '@/components/backtest/SectorHeatmap'
import type { BacktestResult } from '@/lib/backtest/engine'

interface OverviewTabProps {
  results: BacktestResult[]
  sectorSummary: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
  sectorColors: Record<string, string>
  initialCapital: number
}

const STRATEGY_RULES: ReadonlyArray<readonly [string, string]> = [
  ['BUY Signal', '200EMA deviation dip zone + 200SMA rising (>0.5%/20bars) + price near SMA + ≥2 of: RSI<35, MACD hist>0, ATR%>2, BB%<0.20 → BUY with Half-Kelly (10-25%)'],
  ['HOLD', 'Confidence <55% or HEALTHY_BULL / EXTENDED_BULL → No action. Slope insufficient or price not near SMA = no buy.'],
  ['SELL Signal', 'FALLING_KNIFE (dip zone + declining SMA) or HEALTHY_BULL + RSI>70 → Exit full position'],
  ['Stop Loss', 'ATR-adaptive: 1.5× ATR%, floor 5%, cap 15%. Volatility-adjusted per instrument.'],
  ['Trailing Stop', '2× ATR profit → stop rises to break-even. 4× ATR profit → stop locks at 1× ATR above entry.'],
  ['Max DD Cap', 'Portfolio equity drawdown >25% → circuit breaker, close all positions immediately'],
  ['Position Sizing', 'Half-Kelly: STRONG_DIP+3 confirms → 25%, STRONG_DIP → 15%, normal BUY → 10%. 55% confidence minimum.'],
  ['Transaction Costs', '~11bps round-trip (IBKR: $0.005/sh + 0.05% spread + 0.5bps slippage). Applied at both entry and exit.'],
] as const

export function OverviewTab({ results, sectorSummary, sectorColors, initialCapital }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Sector heatmap */}
      <SectorHeatmap sectorSummary={sectorSummary} sectorColors={sectorColors} />

      {/* Equity curves — top performers */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">Equity Curves — Top 8 by Return</h3>
        <ChartErrorBoundary label="Equity Curves" fallbackHeight={320}>
          <EquityCurveChart
            instruments={results.slice().sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
            initialCapital={initialCapital}
          />
        </ChartErrorBoundary>
      </div>

      {/* Strategy explanation */}
      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
          {STRATEGY_RULES.map(([title, desc]) => (
            <div key={title} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-slate-300 font-medium mb-1">{title}</div>
              <div className="text-slate-500 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
