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
 * rules belong as a single visual block.
 */

import EquityCurveChart from '@/components/backtest/EquityCurveChart'
import { ChartErrorBoundary } from '@/components/ChartErrorBoundary'
import SectorHeatmap from '@/components/backtest/SectorHeatmap'
import type { BacktestResult } from '@/lib/backtest/engine'
import { ENGINE_RULES, TX_COST_RULE } from '@/lib/backtest/strategyDescription'

/** Re-exported: the cost-copy spec imports it from the component that renders it. */
export { TX_COST_RULE }

interface OverviewTabProps {
  results: BacktestResult[]
  sectorSummary: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
  sectorColors: Record<string, string>
  initialCapital: number
}

/**
 * Exported so the copy specs assert what actually RENDERS, not a helper.
 *
 * Q-105: this was an inline table describing ATR and trailing stops, SELL
 * exits, confirm counts, tiered Kelly sizing and a 55% confidence minimum —
 * none of which the engine had run since 2026-07-11. It is now the derived
 * table in lib/backtest/strategyDescription.ts.
 */
export const STRATEGY_RULES = ENGINE_RULES

export function OverviewTab({ results, sectorSummary, sectorColors, initialCapital }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Sector heatmap */}
      <SectorHeatmap sectorSummary={sectorSummary} sectorColors={sectorColors} />

      {/* Equity curves — top performers */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h2 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">Equity Curves — Top 8 by Return</h2>
        <ChartErrorBoundary label="Equity Curves" fallbackHeight={320}>
          <EquityCurveChart
            instruments={results.slice().sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
            initialCapital={initialCapital}
          />
        </ChartErrorBoundary>
      </div>

      {/* Strategy explanation */}
      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
        <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
          {STRATEGY_RULES.map(([title, desc]) => (
            <div key={title} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-slate-300 font-medium mb-1">{title}</div>
              <div className="text-slate-400 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
