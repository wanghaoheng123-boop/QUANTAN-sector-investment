'use client'

interface SectorSummary {
  totalReturn: number
  annReturn: number
  tickers: string[]
}

interface Props {
  sectorSummary: Record<string, SectorSummary> | null
  sectorColors: Record<string, string>
}

export default function SectorHeatmap({ sectorSummary, sectorColors }: Props) {
  if (!sectorSummary) {
    return (
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6 flex items-center justify-center h-32">
        <p className="text-slate-500 text-sm">Loading sector data…</p>
      </div>
    )
  }

  const entries = Object.entries(sectorSummary).sort((a, b) => b[1].annReturn - a[1].annReturn)

  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
      <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
        Sector Performance — Annualized Return %
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {entries.map(([sector, data]) => {
          const ret = data.annReturn
          const isPositive = ret >= 0
          const abs = Math.abs(ret)
          const color = sectorColors[sector] ?? '#64748b'

          // Gradient based on return magnitude and sign
          let bgClass = 'bg-slate-800/60'
          if (abs > 0.20) bgClass = isPositive ? 'bg-emerald-900/40' : 'bg-red-900/40'
          else if (abs > 0.10) bgClass = isPositive ? 'bg-emerald-900/20' : 'bg-red-900/20'
          else if (abs > 0) bgClass = isPositive ? 'bg-emerald-900/10' : 'bg-red-900/10'

          return (
            <div key={sector} className={`${bgClass} rounded-xl p-4 border border-slate-800 transition-all hover:border-slate-700`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-300">{sector}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">{data.tickers.length} tickers</span>
              </div>
              <div className={`text-2xl font-bold font-mono ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? '+' : '−'}{(ret * 100).toFixed(2)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {isPositive ? '+' : '−'}{(data.totalReturn * 100).toFixed(2)}% total
              </div>
              {/* Bar visualization */}
              <div className="mt-2 h-1 bg-slate-700/50 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(abs * 200, 100)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
