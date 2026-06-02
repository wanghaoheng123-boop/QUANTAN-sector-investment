'use client'

/**
 * AnalysisTab — sector attribution + risk-return matrix + walk-forward
 * for the backtest page Analysis tab.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx. Pure
 * presentational (no state, no effects); composes WalkForwardPanel.
 *
 * Pre-extract: the function lived at app/backtest/page.tsx:358. The diff
 * is a pure move — body identical, only imports differ.
 */

import type { BacktestResult } from '@/lib/backtest/engine'
import { WalkForwardPanel } from './WalkForwardPanel'

interface SectorRow {
  sector: string
  color: string
  totalReturn: number
  annReturn: number
  avgTrades: number
  tickers: string[]
}

export function AnalysisTab({ results, sectorColors }: { results: BacktestResult[]; sectorColors: Record<string, string> }) {
  // ── Sector performance table ──────────────────────────────────────────────
  const sectorRows: SectorRow[] = Object.entries(
    results.reduce<Record<string, { ret: number; ann: number; trades: number; winRate: number; sharpe: number | null; tickers: string[]; count: number }>>((acc, r) => {
      if (!acc[r.sector]) acc[r.sector] = { ret: 0, ann: 0, trades: 0, winRate: 0, sharpe: null, tickers: [], count: 0 }
      const s = acc[r.sector]
      s.ret += r.totalReturn
      s.ann += r.annualizedReturn
      s.trades += r.totalTrades
      s.tickers.push(r.ticker)
      s.count++
      return acc
    }, {})
  ).map(([sector, data]) => ({
    sector,
    color: sectorColors[sector] ?? '#64748b',
    totalReturn: data.ret / Math.max(data.count, 1),
    annReturn: data.ann / Math.max(data.count, 1),
    avgTrades: Math.round(data.trades / Math.max(data.count, 1)),
    tickers: data.tickers,
  })).sort((a, b) => b.annReturn - a.annReturn)

  return (
    <div className="space-y-6">
      {/* Sector Performance Table */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
          Performance Attribution by Sector
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Performance attribution by sector — annualised return, total return, and ranking</caption>
            <thead>
              <tr className="border-b border-slate-800">
                {['Sector', 'Ann. Return', 'Total Return', 'Avg Trades', 'vs B&H α', 'Rank'].map(h => (
                  <th key={h} scope="col" className="px-4 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sectorRows.map((row, i) => (
                <tr key={row.sector} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="text-slate-300 font-medium">{row.sector}</span>
                      <span className="text-slate-400 text-[10px]">({row.tickers.length} instr.)</span>
                    </div>
                  </td>
                  <td className={`px-4 py-3 font-mono font-bold ${row.annReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(row.annReturn * 100).toFixed(1)}%
                  </td>
                  <td className={`px-4 py-3 font-mono ${row.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(row.totalReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{row.avgTrades}</td>
                  <td className="px-4 py-3 font-mono text-cyan-400">
                    {i === 0 ? '🏆 Top' : i === sectorRows.length - 1 ? '📉 Bot' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${i < 3 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      #{i + 1}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk/Return Matrix */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
          Risk/Return Map
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Risk/return matrix — per-ticker annualised return, drawdown, Sharpe, Sortino, win rate, and alpha vs buy-and-hold</caption>
            <thead>
              <tr className="border-b border-slate-800">
                {['Ticker', 'Sector', 'Ann. Ret', 'Max DD', 'Sharpe', 'Sortino', 'Win Rate', 'PF', 'B&H Ret', 'Alpha'].map(h => (
                  <th key={h} scope="col" className="px-3 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[...results]
                .sort((a, b) => b.annualizedReturn - a.annualizedReturn)
                .map(r => {
                  const sectorColor = sectorColors[r.sector] ?? '#64748b'
                  return (
                    <tr key={r.ticker} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono font-bold text-white">{r.ticker}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: sectorColor, backgroundColor: sectorColor + '20' }}>
                          {r.sector}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${r.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(r.annualizedReturn * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-red-400">
                        -{(Math.abs(r.maxDrawdown) * 100).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 font-mono ${(r.sharpeRatio ?? 0) >= 1 ? 'text-emerald-400' : (r.sharpeRatio ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                        {r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono ${(r.sortinoRatio ?? 0) >= 1 ? 'text-emerald-400' : (r.sortinoRatio ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                        {r.sortinoRatio != null ? r.sortinoRatio.toFixed(2) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono ${r.winRate >= 0.5 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {(r.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">
                        {r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 font-mono ${r.bnhReturn >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
                        {(r.bnhReturn * 100).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${r.excessReturn >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
                        {(r.excessReturn * 100).toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-Forward Windows */}
      <WalkForwardPanel results={results} />
    </div>
  )
}
