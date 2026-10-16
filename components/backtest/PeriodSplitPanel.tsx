'use client'

/**
 * Performance by period — the Analysis tab's per-instrument split.
 *
 * Q-139: this panel was titled "Walk-Forward / Overfitting Check" and showed
 * "Rolling Quarterly Performance" and an "In-Sample Ann. Return". The engine
 * fits nothing, so there is no in-sample period; the "quarters" were four
 * ~1-year slices; and "B&H Ann. Return" printed a TOTAL return. It now says
 * what it computes (lib/backtest/periodSplit.ts), and the component is renamed
 * PeriodSplitPanel so its name does not repeat the claim.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx; owns its
 * ticker-select state.
 */

import { useEffect, useMemo, useState } from 'react'
import type { BacktestResult } from '@/lib/backtest/engine'
import { tradingDaysPerYear } from '@/lib/backtest/calendar'
import { splitIntoPeriods } from '@/lib/backtest/periodSplit'
import { BACKTEST_RFR_ANNUAL } from '@/lib/quant/constants'

const PERIODS = 4

function pct(v: number | null, digits = 1): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
}

export function PeriodSplitPanel({ results }: { results: BacktestResult[] }) {
  const tickers = useMemo(() => results.map((r) => r.ticker), [results])
  const [selectedTicker, setSelectedTicker] = useState(results[0]?.ticker ?? '')
  // Resync when the parent's `results` prop changes (e.g., ticker selector
  // filter updates upstream). Without this, a previously-picked ticker that
  // no longer appears in `results` left the panel stuck on 'No instrument
  // data available' permanently.
  useEffect(() => {
    if (tickers.length === 0) return
    if (!tickers.includes(selectedTicker)) {
      setSelectedTicker(tickers[0])
    }
  }, [tickers, selectedTicker])
  const selected = results.find(r => r.ticker === selectedTicker)

  const daysPerYear = selected ? tradingDaysPerYear(selected.ticker, selected.sector) : 252
  const periods = useMemo(
    () => (selected ? splitIntoPeriods(selected.equityCurve, daysPerYear, BACKTEST_RFR_ANNUAL, PERIODS) : []),
    [selected, daysPerYear],
  )

  if (!selected) return <div className="text-slate-400 text-sm py-8 text-center">No instrument data available.</div>

  const monthsPerPeriod = periods.length > 0 ? Math.round((periods[0].bars / daysPerYear) * 12) : null

  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider text-slate-400">
          Performance by Period
        </h2>
        <select
          value={selectedTicker}
          onChange={e => setSelectedTicker(e.target.value)}
          aria-label="Instrument"
          className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1 border border-slate-700"
        >
          {tickers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {periods.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-400 mb-2">
            {PERIODS} consecutive periods{monthsPerPeriod != null ? ` of about ${monthsPerPeriod} months` : ''}, oldest first — {selectedTicker}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {periods.map(p => (
              <div key={p.index} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                <div className="text-[10px] text-slate-400 mb-1">Period {p.index}</div>
                <div className={`text-lg font-bold font-mono ${(p.annualizedReturn ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pct(p.annualizedReturn)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">annualised</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Sharpe: {p.sharpe != null ? p.sharpe.toFixed(2) : '—'}
                </div>
                <div className={`text-[10px] mt-0.5 ${p.totalReturn >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  Period total: {pct(p.totalReturn)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Whole-window figures, all TOTAL returns over the same traded window. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-400 uppercase mb-1">Strategy total return</div>
          <div className={`text-xl font-bold font-mono ${selected.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pct(selected.totalReturn)}
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-400 uppercase mb-1">Buy &amp; hold total return</div>
          <div className={`text-xl font-bold font-mono ${selected.bnhReturn >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
            {pct(selected.bnhReturn)}
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-400 uppercase mb-1">Excess vs buy &amp; hold</div>
          <div className={`text-xl font-bold font-mono ${selected.excessReturn >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
            {pct(selected.excessReturn)}
          </div>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-slate-400">
        The strategy has no fitted parameters, so there is no in-sample or out-of-sample period to compare and this
        is not an overfitting test. The single pass is split into consecutive periods to show whether the result
        comes from one stretch of the window. Idle cash earns nothing in this simulation, so a strategy that is
        mostly flat shows a negative Sharpe against the {(BACKTEST_RFR_ANNUAL * 100).toFixed(1)}% risk-free rate.
      </div>
    </div>
  )
}
