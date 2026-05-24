/** Extracted metrics grid from backtest page (Q-019 partial). */
'use client'

export function BacktestMetricsGrid({
  winRate,
  totalTrades,
  avgReturn,
}: {
  winRate: number
  totalTrades: number
  avgReturn: number
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-lg border border-slate-800 p-4">
        <p className="text-xs text-slate-500 uppercase">Win rate</p>
        <p className="text-xl text-emerald-400">{(winRate * 100).toFixed(2)}%</p>
      </div>
      <div className="rounded-lg border border-slate-800 p-4">
        <p className="text-xs text-slate-500 uppercase">Trades</p>
        <p className="text-xl text-slate-100">{totalTrades}</p>
      </div>
      <div className="rounded-lg border border-slate-800 p-4">
        <p className="text-xs text-slate-500 uppercase">Avg return</p>
        <p className="text-xl text-slate-100">{(avgReturn * 100).toFixed(2)}%</p>
      </div>
    </div>
  )
}
