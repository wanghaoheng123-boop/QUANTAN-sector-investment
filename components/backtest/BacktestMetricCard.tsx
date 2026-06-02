/**
 * BacktestMetricCard — small presentational tile for the backtest page key
 * metrics strip.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx as part of
 * the god-component decomposition. Pure presentational; no state, no effects.
 *
 * This is the single-tile primitive that `KeyMetricsStrip` composes into the
 * backtest page's 6-metric row. (The old `BacktestMetricsGrid.tsx` 3-tile
 * variant from Phase 15 Q-019 was removed as dead code — superseded by
 * KeyMetricsStrip.)
 */

export interface BacktestMetricCardProps {
  label: string
  value: string
  sub?: string
  color?: string
}

export function BacktestMetricCard({ label, value, sub, color }: BacktestMetricCardProps) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}
