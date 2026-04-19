'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiUrl } from '@/lib/infra/apiBase'
import {
  defaultSnapshot,
  loadSnapshot,
  saveSnapshot,
  marketValue,
  unrealizedPnl,
  reconcile,
  buy,
  sell,
  type PortfolioSnapshot,
  type QuoteMap,
} from '@/lib/portfolio/tracker'
import { iterativeRiskParity } from '@/lib/portfolio/riskParity'
import { herfindahlIndex } from '@/lib/portfolio/diversification'
import { STRESS_SCENARIOS, applyStressToEquity } from '@/lib/portfolio/stressTest'

export default function PortfolioPage() {
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null)
  const [quotes, setQuotes] = useState<QuoteMap>({})
  const [tickerIn, setTickerIn] = useState('')
  const [sharesIn, setSharesIn] = useState('10')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setSnap(loadSnapshot() ?? defaultSnapshot())
  }, [])

  useEffect(() => {
    if (!snap) return
    saveSnapshot(snap)
  }, [snap])

  const refreshQuotes = useCallback(async () => {
    if (!snap || snap.positions.length === 0) {
      setQuotes({})
      return
    }
    const tickers = snap.positions.map(p => p.ticker).join(',')
    try {
      const res = await fetch(apiUrl(`/api/prices?tickers=${encodeURIComponent(tickers)}`))
      if (!res.ok) return
      const json = await res.json()
      const qm: QuoteMap = {}
      for (const q of json.quotes ?? []) {
        if (q.ticker && q.price > 0) qm[String(q.ticker).toUpperCase()] = { price: q.price }
      }
      setQuotes(qm)
    } catch {
      /* ignore */
    }
  }, [snap])

  useEffect(() => {
    void refreshQuotes()
    const iv = setInterval(() => void refreshQuotes(), 60_000)
    return () => clearInterval(iv)
  }, [refreshQuotes])

  const equity = snap ? snap.cash + marketValue(snap.positions, quotes) : 0
  const uPnL = snap ? unrealizedPnl(snap.positions, quotes) : 0
  const recon = snap ? reconcile(snap, quotes) : null

  const weights = useMemo(() => {
    if (!snap || snap.positions.length === 0) return []
    const mv = snap.positions.map(p => {
      const px = quotes[p.ticker]?.price ?? p.avgCost
      return Math.abs(p.shares * px)
    })
    const t = mv.reduce((a, b) => a + b, 0)
    return t > 0 ? mv.map(v => v / t) : snap.positions.map(() => 1 / snap.positions.length)
  }, [snap, quotes])

  const hhi = weights.length ? herfindahlIndex(weights) : 0
  const vols = snap?.positions.map(() => 0.25) ?? []
  const rp = snap && snap.positions.length > 0 ? iterativeRiskParity(vols, 6) : []

  if (!snap) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-slate-400 text-sm">
        Loading portfolio…
      </div>
    )
  }

  const pxFor = (t: string) => quotes[t]?.price ?? null

  return (
    <div className="min-h-screen bg-black text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Paper portfolio</h1>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Stored in this browser only (<span className="font-mono">localStorage</span>). Mark-to-market uses live quotes when available.
              Numbers reconcile: cash + position market value = equity (within rounding).
            </p>
          </div>
          <Link href="/simulator" className="text-xs text-cyan-400 hover:text-cyan-300">
            → Simulator
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-[10px] text-slate-500 uppercase">Cash</div>
            <div className="text-lg font-mono text-white">${snap.cash.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-[10px] text-slate-500 uppercase">Market value</div>
            <div className="text-lg font-mono text-emerald-300">${marketValue(snap.positions, quotes).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-[10px] text-slate-500 uppercase">Equity</div>
            <div className="text-lg font-mono text-cyan-300">${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-[10px] text-slate-500 uppercase">Unrealized PnL</div>
            <div className={`text-lg font-mono ${uPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {uPnL >= 0 ? '+' : ''}{uPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        {recon && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${recon.ok ? 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300' : 'border-amber-800/60 bg-amber-950/20 text-amber-200'}`}>
            Reconciliation: cash ${recon.cash.toFixed(2)} + positions MV ${recon.positionsMv.toFixed(2)} = book ${recon.bookEquity.toFixed(2)}
            {recon.ok ? ' · OK' : ` · drift ${recon.drift.toFixed(4)} (missing quotes for some tickers)`}
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300">Trade (paper)</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Ticker</label>
              <input
                value={tickerIn}
                onChange={e => setTickerIn(e.target.value.toUpperCase())}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm w-28"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Shares</label>
              <input
                value={sharesIn}
                onChange={e => setSharesIn(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm w-24"
              />
            </div>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-emerald-600/80 text-white text-xs font-semibold"
              onClick={() => {
                setMsg(null)
                const sh = Number(sharesIn)
                const t = tickerIn.trim().toUpperCase()
                const px = pxFor(t)
                if (!t || !Number.isFinite(sh) || sh <= 0) {
                  setMsg('Enter ticker and positive shares')
                  return
                }
                if (px == null) {
                  setMsg('Fetch a quote first (add position after prices load), or enter a liquid ticker.')
                  void refreshQuotes()
                  return
                }
                const { next, error } = buy(snap, t, sh, px)
                if (error) setMsg(error)
                else setSnap(next)
              }}
            >
              Buy @ last
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-600"
              onClick={() => {
                setMsg(null)
                const sh = Number(sharesIn)
                const t = tickerIn.trim().toUpperCase()
                const px = pxFor(t)
                if (!t || !Number.isFinite(sh) || sh <= 0) {
                  setMsg('Enter ticker and positive shares')
                  return
                }
                if (px == null) {
                  setMsg('No quote for ticker')
                  return
                }
                const { next, error } = sell(snap, t, sh, px)
                if (error) setMsg(error)
                else setSnap(next)
              }}
            >
              Sell @ last
            </button>
          </div>
          {msg && <div className="text-xs text-amber-400">{msg}</div>}
        </div>

        <div className="rounded-2xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-[10px] text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">Ticker</th>
                <th className="px-4 py-2">Shares</th>
                <th className="px-4 py-2">Avg</th>
                <th className="px-4 py-2">Last</th>
                <th className="px-4 py-2">MV</th>
              </tr>
            </thead>
            <tbody>
              {snap.positions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-xs">
                    No positions — buy above to start.
                  </td>
                </tr>
              ) : (
                snap.positions.map(p => {
                  const last = pxFor(p.ticker)
                  const mv = last != null ? p.shares * last : p.shares * p.avgCost
                  return (
                    <tr key={p.ticker} className="border-t border-slate-800/80">
                      <td className="px-4 py-2 font-mono">{p.ticker}</td>
                      <td className="px-4 py-2">{p.shares}</td>
                      <td className="px-4 py-2">${p.avgCost.toFixed(2)}</td>
                      <td className="px-4 py-2">{last != null ? `$${last.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-2">${mv.toFixed(0)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase">Concentration</h3>
            <p className="text-xs text-slate-500">Herfindahl of weights (1 = single name).</p>
            <div className="text-2xl font-mono text-white">{hhi.toFixed(3)}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase">Risk parity (illustrative)</h3>
            <p className="text-xs text-slate-500">Equal vol placeholder (25% each name) → iterative weights.</p>
            <div className="text-xs font-mono text-slate-300">
              {snap.positions.map((p, i) => (
                <div key={p.ticker}>{p.ticker}: {(rp[i] * 100).toFixed(1)}%</div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase">Stress scenarios (equity only)</h3>
          <div className="grid sm:grid-cols-3 gap-2">
            {STRESS_SCENARIOS.map(s => (
              <div key={s.id} className="rounded-lg border border-slate-700/60 p-3 text-xs">
                <div className="text-slate-300 font-medium">{s.label}</div>
                <div className="text-slate-500 mt-1">{s.description}</div>
                <div className="mt-2 font-mono text-amber-300">
                  ${applyStressToEquity(equity, s.equityShock).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
