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
import { isUntradeable } from '@/lib/backtest/resultFlags'
import { TX_COST_RULE, rulesForPath, rulesMismatchNote, type SignalPath } from '@/lib/backtest/strategyDescription'

/** Re-exported: the cost-copy spec imports it from the component that renders it. */
export { TX_COST_RULE }

interface OverviewTabProps {
  results: BacktestResult[]
  sectorSummary: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
  sectorColors: Record<string, string>
  initialCapital: number
  /** Q-134: the path that produced `results`; rules render only when they describe it. */
  signalPath?: SignalPath
}

export function OverviewTab({ results, sectorSummary, sectorColors, initialCapital, signalPath }: OverviewTabProps) {
  const rules = rulesForPath(signalPath)
  return (
    <div className="space-y-6">
      {/* Sector heatmap */}
      <SectorHeatmap sectorSummary={sectorSummary} sectorColors={sectorColors} />

      {/* Equity curves — top performers */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h2 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">Equity Curves — Top 8 by Return</h2>
        <ChartErrorBoundary label="Equity Curves" fallbackHeight={320}>
          <EquityCurveChart
            // F2: a flat curve that never traded is not a "top performer".
            instruments={results.filter((r) => !isUntradeable(r)).sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
            initialCapital={initialCapital}
          />
        </ChartErrorBoundary>
      </div>

      {/* Strategy explanation */}
      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
        <h2 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
          {rules ? rules.map(([title, desc]) => (
            <div key={title} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-slate-300 font-medium mb-1">{title}</div>
              <div className="text-slate-400 leading-relaxed">{desc}</div>
            </div>
          )) : (
            <p role="status" data-testid="rules-mismatch" className="text-amber-300 sm:col-span-2 lg:col-span-3">
              {rulesMismatchNote(signalPath)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
