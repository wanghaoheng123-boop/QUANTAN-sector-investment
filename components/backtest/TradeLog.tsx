'use client'

import { useState, useMemo } from 'react'
import type { Trade } from '@/lib/backtest/engine'
import { ENGINE_MAX_HOLD_DAYS } from '@/lib/backtest/strategyConstants'
import { MetricTooltip } from '@/components/MetricTooltip'

/** Q-133: the engine's three exits, in words. */
export const EXIT_LABELS: Record<NonNullable<Trade['exitReason']>, string> = {
  time_exit: `${ENGINE_MAX_HOLD_DAYS}-bar time exit`,
  max_drawdown: 'Drawdown breaker',
  end_of_data: 'End of data',
}

/** Exported so the /backtest copy spec scans the glossary text these keys resolve to. */
export const HEADER_TOOLTIPS: Record<string, { metricKey?: string; content?: string }> = {
  // Red-team F12: this is the SIGNAL bar; the position fills at the next open.
  'Signal date': { content: 'The bar whose close produced the BUY signal. The position fills at the next session\'s open.' },
  'PnL %': { content: 'Price move from entry to exit, before costs. The win and loss counts above are net of costs, so a small positive move can still be a loss.' },
  'Regime': { metricKey: 'regime' },
  'Signal': { metricKey: 'dipSignal' },
  'Conf%': { metricKey: 'confidence' },
  // Q-105 corrected these to the entry reason; Q-133 made the engine record
  // the exit, so it now has its own column.
  'Entry reason': { content: 'Why the position was opened: the regime zone behind the BUY signal.' },
  'Exit': { content: `Why and when the position closed: the ${ENGINE_MAX_HOLD_DAYS}-bar time exit, the drawdown breaker, or the end of the data (a position still open then is closed at the final close).` },
  'Action': { content: 'The side of the position. Exit Price is where it closed.' },
}

interface Props {
  trades: Trade[]
  sectorColors: Record<string, string>
}

export default function TradeLog({ trades, sectorColors }: Props) {
  const [filterSector, setFilterSector] = useState<string>('All')
  const [filterAction, setFilterAction] = useState<string>('All')
  const [filterTicker, setFilterTicker] = useState<string>('')

  // Q-133: only offer actions the engine actually recorded. Every trade it
  // opens is a BUY, so a SELL option always rendered an empty table.
  const actions = useMemo(() => Array.from(new Set(trades.map(t => t.action))).sort(), [trades])

  const sectors = useMemo(() => {
    const s = new Set(trades.map(t => t.sector))
    return ['All', ...Array.from(s).sort()]
  }, [trades])

  const filtered = useMemo(() => {
    // Phase 14 wave 10: copy via spread before sort. Prior code did
    //   let rows = trades; ...; return rows.sort(...)
    // which — when no filters were applied — mutated the `trades` PROP
    // directly. That's a React-Anti-pattern: a parent component passing the
    // same `trades` array to multiple children would have the array silently
    // reordered to date-descending by this child.
    let rows = trades
    if (filterSector !== 'All') rows = rows.filter(t => t.sector === filterSector)
    if (filterAction !== 'All') rows = rows.filter(t => t.action === filterAction)
    if (filterTicker) rows = rows.filter(t => t.ticker.toLowerCase().includes(filterTicker.toLowerCase()))
    return [...rows].sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [trades, filterSector, filterAction, filterTicker])

  // Classified on NET cash after costs, as the engine's win rate is (Q-123).
  // On the raw price move, a +0.1% trade that lost money after 22 bps of
  // round-trip costs was counted here as a winner.
  // Red-team F13: a response cached from before netPnl/exitReason existed has
  // closed trades without them. Those are still CLOSED (pnlPct is set); their
  // net result is unknown, so the win/loss counts say so rather than read 0.
  const closedAll = filtered.filter((t) => t.pnlPct != null)
  const netUnknown = closedAll.some((t) => t.netPnl == null)
  const closed = closedAll.filter((t): t is Trade & { netPnl: number } => t.netPnl != null)
  const winningTrades = closed.filter(t => t.netPnl > 0)
  const losingTrades = closed.filter(t => t.netPnl <= 0)
  const netReturn = (t: Trade & { netPnl: number }) => t.netPnl / t.value

  const avgWinPct = winningTrades.length > 0
    ? (winningTrades.reduce((s, t) => s + netReturn(t), 0) / winningTrades.length * 100).toFixed(2)
    : null
  const avgLossPct = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((s, t) => s + netReturn(t), 0) / losingTrades.length * 100).toFixed(2)
    : null

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-950/30 rounded-xl p-4 border border-emerald-800/30">
          <div className="text-xs text-emerald-500 mb-1">Winning Trades</div>
          <div className="text-xl font-bold font-mono text-emerald-400">{netUnknown ? '—' : winningTrades.length}</div>
          <div className="text-[10px] text-emerald-600 mt-1">
            {avgWinPct == null ? '—' : `avg net +${avgWinPct}%`}
          </div>
        </div>
        <div className="bg-red-950/30 rounded-xl p-4 border border-red-800/30">
          <div className="text-xs text-red-500 mb-1">Losing Trades</div>
          <div className="text-xl font-bold font-mono text-red-400">{netUnknown ? '—' : losingTrades.length}</div>
          <div className="text-[10px] text-red-600 mt-1">
            {avgLossPct == null ? '—' : `avg net −${avgLossPct}%`}
          </div>
        </div>
        <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
          <div className="text-xs text-slate-400 mb-1">All Trades</div>
          <div className="text-xl font-bold font-mono text-white">{filtered.length}</div>
          <div className="text-[10px] text-slate-400 mt-1">
            {new Set(filtered.map(t => t.ticker)).size} instruments
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterSector}
          onChange={e => setFilterSector(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700"
        >
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {actions.length > 1 && (
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            aria-label="Filter by action"
            className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700"
          >
            <option value="All">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <input
          type="text"
          placeholder="Filter ticker…"
          value={filterTicker}
          onChange={e => setFilterTicker(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700 placeholder-slate-600"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          {/* F6.4 (Phase 13 S2): caption + scope for screen readers — WCAG 1.3.1. */}
          <caption className="sr-only">Backtest trade log — newest first, with signal date, ticker, sector, action, entry and exit prices, price move, share count, dollar value, regime, signal, confidence, entry reason, and why and when the position closed.</caption>
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {['Signal date', 'Ticker', 'Sector', 'Action', 'Entry Price', 'Exit Price', 'PnL %', 'Shares', 'Value', 'Regime', 'Signal', 'Conf%', 'Entry reason', 'Exit'].map(h => {
                const tip = HEADER_TOOLTIPS[h]
                return (
                  <th key={h} scope="col" className="px-3 py-2.5 text-left text-slate-400 uppercase tracking-wider font-medium">
                    <span className="inline-flex items-center">
                      {h}
                      {tip && <MetricTooltip metricKey={tip.metricKey} content={tip.content} compact />}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filtered.slice(0, 200).map((t, i) => {
              const pnl = t.pnlPct ?? 0
              const isWin = pnl > 0
              return (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-slate-400 whitespace-nowrap">{t.date}</td>
                  <td className="px-3 py-2.5 font-mono font-bold text-white">{t.ticker}</td>
                  <td className="px-3 py-2.5 text-slate-400 text-[10px]">{t.sector}</td>
                  <td className={`px-3 py-2.5 font-bold ${t.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.action}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">${t.entryPrice.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">
                    {t.pnlPct !== null ? `$${t.exitPrice.toFixed(2)}` : '—'}
                  </td>
                  <td className={`px-3 py-2.5 font-mono font-bold ${isWin ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {t.pnlPct !== null ? `${isWin ? '+' : ''}${(pnl * 100).toFixed(2)}%` : 'Open'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{t.shares}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">${t.value.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-400">{t.regime}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-400">{t.dipSignal}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{t.confidence}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-400 max-w-[200px] truncate" title={t.reason}>{t.reason}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-400 whitespace-nowrap" data-testid="trade-exit">
                    {t.exitReason ? `${EXIT_LABELS[t.exitReason]} · ${t.exitDate ?? '—'}` : t.pnlPct != null ? '—' : 'Open'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-400 text-sm">No trades found.</div>
        )}
        {filtered.length > 200 && (
          <div className="py-2 text-center text-[10px] text-slate-400 border-t border-slate-800">
            Showing 200 of {filtered.length} trades
          </div>
        )}
      </div>
    </div>
  )
}
