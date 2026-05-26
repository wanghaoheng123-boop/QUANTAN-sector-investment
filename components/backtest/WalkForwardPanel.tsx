'use client'

/**
 * WalkForwardPanel — overfitting check panel for the backtest page.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx. Shows
 * rolling quarterly performance + IS/OOS comparison for a user-selected
 * instrument. Has its own ticker-select state.
 *
 * Pre-extract: the function lived at app/backtest/page.tsx:499. The diff
 * is a pure move — body identical, only imports differ.
 */

import { useEffect, useState } from 'react'
import type { BacktestResult } from '@/lib/backtest/engine'

interface QuarterStats {
  label: string
  ret: number
  sharpe: number | null
  ann: number
}

export function WalkForwardPanel({ results }: { results: BacktestResult[] }) {
  const [selectedTicker, setSelectedTicker] = useState(results[0]?.ticker ?? '')
  const tickers = results.map(r => r.ticker)
  // Resync when the parent's `results` prop changes (e.g., ticker selector
  // filter updates upstream). Without this, a previously-picked ticker that
  // no longer appears in `results` left the panel stuck on 'No instrument
  // data available' permanently — the empty-state guard below fired but
  // there was no recovery short of tab unmount.
  useEffect(() => {
    if (tickers.length === 0) return
    if (!tickers.includes(selectedTicker)) {
      setSelectedTicker(tickers[0])
    }
    // We intentionally don't depend on `tickers` (rebuilt every render) —
    // hashing instead by `results` reference + the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selectedTicker])
  const selected = results.find(r => r.ticker === selectedTicker)

  // ── Rolling quarterly performance split ─────────────────────────────────────
  const quarters = ((): QuarterStats[] => {
    if (!selected) return []
    const len = selected.equityCurve.length
    const qLen = Math.floor(len / 4)
    if (qLen < 30) return []
    return [0, 1, 2, 3].map(q => {
      const start = q * qLen
      const end = q === 3 ? len : (q + 1) * qLen
      const curve = selected.equityCurve.slice(start, end)
      const rets: number[] = []
      for (let i = 1; i < curve.length; i++) {
        const r = (curve[i] - curve[i - 1]) / curve[i - 1]
        if (Number.isFinite(r)) rets.push(r)
      }
      if (rets.length < 10) return null
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length
      const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1))
      const sharpe = sd > 1e-10 ? ((mean - 0.04 / 252) / sd) * Math.sqrt(252) : null
      const ret = (curve[curve.length - 1] - curve[0]) / curve[0]
      return {
        label: ['Q1', 'Q2', 'Q3', 'Q4'][q],
        ret,
        sharpe,
        ann: ((1 + ret) ** (252 / rets.length) - 1),
      }
    }).filter((x): x is QuarterStats => x !== null)
  })()

  if (!selected) return <div className="text-slate-500 text-sm py-8 text-center">No instrument data available.</div>

  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider text-slate-400">
          Walk-Forward / Overfitting Check
        </h3>
        <select
          value={selectedTicker}
          onChange={e => setSelectedTicker(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1 border border-slate-700"
        >
          {tickers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Rolling quarterly performance */}
      {quarters.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-2">Rolling Quarterly Performance — {selectedTicker}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quarters.map(q => (
              <div key={q.label} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                <div className="text-[10px] text-slate-500 mb-1">{q.label}</div>
                <div className={`text-lg font-bold font-mono ${q.ann >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(q.ann * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Sharpe: {q.sharpe != null ? q.sharpe.toFixed(2) : '—'}
                </div>
                <div className={`text-[10px] mt-0.5 ${q.ret >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  Total: {(q.ret * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overfitting metric */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">In-Sample Ann. Return</div>
          <div className={`text-xl font-bold font-mono ${selected.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(selected.annualizedReturn * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">B&amp;H Ann. Return</div>
          <div className={`text-xl font-bold font-mono ${selected.bnhReturn >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
            {(selected.bnhReturn * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">Strategy Alpha</div>
          <div className={`text-xl font-bold font-mono ${selected.excessReturn >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
            {(selected.excessReturn * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-slate-400">
        Walk-forward splits data into in-sample (train) and out-of-sample (test) windows. A robust strategy should maintain similar Sharpe ratios across both.
        Large IS/OOS gap indicates potential overfitting to historical patterns.
      </div>
    </div>
  )
}
