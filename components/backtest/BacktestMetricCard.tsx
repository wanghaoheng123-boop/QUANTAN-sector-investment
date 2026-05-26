/**
 * BacktestMetricCard — small presentational tile for the backtest page key
 * metrics strip.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx as part of
 * the god-component decomposition. Pure presentational; no state, no effects.
 *
 * The companion `BacktestMetricsGrid.tsx` (Phase 15 Q-019 partial) handles
 * a different concern — that's the 3-tile WR/trades/avg-return summary used
 * elsewhere. This file is the single-tile primitive that the backtest page's
 * 6-metric strip composes.
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
