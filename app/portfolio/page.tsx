'use client'

/**
 * Portfolio Dashboard — /portfolio
 *
 * Features:
 *   - Position manager: add/close positions with real-time P&L
 *   - Risk metrics: diversification grade, HHI, effective N, portfolio vol
 *   - Risk parity weights: suggested allocation based on inverse-vol
 *   - Stress test: GFC/COVID/Rate Shock/Dot-Com/Flash Crash impacts
 *   - Trade history log
 *
 * State is persisted to localStorage; API calls do server-side analytics.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  createPortfolio,
  openPosition,
  closePosition,
  updatePrices,
  portfolioSummary,
  savePortfolio,
  loadPortfolio,
  type Portfolio,
  type PortfolioSummary,
  type Side,
} from '@/lib/portfolio/tracker'
import { classifyTicker } from '@/lib/portfolio/stressTest'

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const color = value >= 0 ? 'text-emerald-400' : 'text-red-400'
  const sign  = value >= 0 ? '+' : ''
  return (
    <span className={`font-mono text-sm ${color}`}>
      {sign}${value.toFixed(2)} ({sign}{(pct * 100).toFixed(2)}%)
    </span>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-indigo-400">{title}</h2>
      {children}
    </div>
  )
}

// ──────────────────────────────────────────────
// Add position form
// ──────────────────────────────────────────────

interface AddPositionFormProps {
  onAdd: (ticker: string, side: Side, qty: number, price: number, commission: number) => void
}

function AddPositionForm({ onAdd }: AddPositionFormProps) {
  const [ticker, setTicker]   = useState('')
  const [side, setSide]       = useState<Side>('LONG')
  const [qty, setQty]         = useState('')
  const [price, setPrice]     = useState('')
  const [comm, setComm]       = useState('0')
  const [error, setError]     = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const q = parseFloat(qty), p = parseFloat(price), c = parseFloat(comm)
    if (!ticker.trim()) { setError('Ticker required'); return }
    if (!isFinite(q) || q <= 0) { setError('Invalid quantity'); return }
    if (!isFinite(p) || p <= 0) { setError('Invalid price'); return }
    onAdd(ticker.trim().toUpperCase(), side, q, p, isFinite(c) ? c : 0)
    setTicker(''); setQty(''); setPrice(''); setComm('0')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Ticker</label>
        <input
          value={ticker} onChange={(e) => setTicker(e.target.value)}
          placeholder="AAPL"
          className="w-24 rounded bg-white/10 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Side</label>
        <select
          value={side} onChange={(e) => setSide(e.target.value as Side)}
          className="rounded bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Shares</label>
        <input
          type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
          placeholder="100"
          className="w-24 rounded bg-white/10 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Price ($)</label>
        <input
          type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)}
          placeholder="150.00"
          className="w-28 rounded bg-white/10 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-white/50">Commission ($)</label>
        <input
          type="number" min="0" step="any" value={comm} onChange={(e) => setComm(e.target.value)}
          className="w-20 rounded bg-white/10 px-2 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 active:bg-indigo-700"
      >
        Add Position
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  )
}

// ──────────────────────────────────────────────
// Stress test table
// ──────────────────────────────────────────────

interface StressTestResult {
  scenario: string
  portfolioShock: number
  portfolioShockPct: number
}

function StressTable({ results }: { results: StressTestResult[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/10 text-left text-xs text-white/50">
          <th className="pb-2">Scenario</th>
          <th className="pb-2 text-right">Impact ($)</th>
          <th className="pb-2 text-right">Impact (%)</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.scenario} className="border-b border-white/5 hover:bg-white/5">
            <td className="py-1.5 font-medium text-white">{r.scenario}</td>
            <td className={`py-1.5 text-right font-mono ${r.portfolioShock >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {r.portfolioShock >= 0 ? '+' : ''}${r.portfolioShock.toFixed(0)}
            </td>
            <td className={`py-1.5 text-right font-mono ${r.portfolioShockPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {r.portfolioShockPct >= 0 ? '+' : ''}{(r.portfolioShockPct * 100).toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

interface DivMetrics {
  hhi: number
  effectiveN: number
  avgPairwiseCorr: number
  portfolioVol: number
  diversificationRatio: number
  grade: 'A' | 'B' | 'C' | 'D'
}

interface RiskParityWeight {
  ticker: string
  weight: number
  annualizedVol: number
  allocation?: number
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio>(() => createPortfolio(100_000))
  const [summary, setSummary]     = useState<PortfolioSummary | null>(null)
  const [divMetrics, setDivMetrics]   = useState<DivMetrics | null>(null)
  const [riskWeights, setRiskWeights] = useState<RiskParityWeight[]>([])
  const [stressResults, setStressResults] = useState<StressTestResult[]>([])
  const [activeTab, setActiveTab] = useState<'positions' | 'stress' | 'riskparity' | 'trades'>('positions')
  const [loading, setLoading]     = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadPortfolio()
    if (saved) setPortfolio(saved)
    setInitialized(true)
  }, [])

  // Persist + recompute summary whenever portfolio changes
  useEffect(() => {
    if (!initialized) return
    savePortfolio(portfolio)
    setSummary(portfolioSummary(portfolio))
  }, [portfolio, initialized])

  const computeAnalytics = useCallback(async () => {
    if (Object.keys(portfolio.positions).length === 0) return
    setLoading(true)
    try {
      // Portfolio summary + diversification
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.diversification) setDivMetrics(data.diversification)
      }

      // Risk parity weights
      const tickers = Object.keys(portfolio.positions)
      const rpRes = await fetch('/api/portfolio/risk-parity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, totalValue: summary?.totalValue }),
      })
      if (rpRes.ok) {
        const rpData = await rpRes.json()
        setRiskWeights(rpData.weights ?? [])
      }

      // Stress test
      const positions = Object.values(portfolio.positions).map((p) => ({
        ticker: p.ticker,
        marketValue: p.quantity * p.lastPrice * (p.side === 'SHORT' ? -1 : 1),
        assetClass: classifyTicker(p.ticker),
      }))
      const stRes = await fetch('/api/portfolio/stress-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, totalValue: summary?.totalValue ?? 100_000 }),
      })
      if (stRes.ok) {
        const stData = await stRes.json()
        setStressResults(stData.scenarios ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [portfolio, summary?.totalValue])

  const handleAddPosition = useCallback((
    ticker: string, side: Side, qty: number, price: number, commission: number
  ) => {
    try {
      setPortfolio((prev) => openPosition(prev, ticker, side, qty, price, commission))
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error adding position')
    }
  }, [])

  const handleClosePosition = useCallback((ticker: string) => {
    const pos = portfolio.positions[ticker]
    if (!pos) return
    const priceStr = prompt(`Close price for ${ticker} (last: $${pos.lastPrice}):`, String(pos.lastPrice))
    if (!priceStr) return
    const closePrice = parseFloat(priceStr)
    if (!isFinite(closePrice) || closePrice <= 0) { alert('Invalid price'); return }
    try {
      const { portfolio: next } = closePosition(portfolio, ticker, pos.quantity, closePrice)
      setPortfolio(next)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Error closing position')
    }
  }, [portfolio])

  const handleReset = () => {
    if (!confirm('Reset portfolio? This cannot be undone.')) return
    setPortfolio(createPortfolio(100_000))
    setDivMetrics(null)
    setRiskWeights([])
    setStressResults([])
  }

  const gradeColor = (g: string) =>
    g === 'A' ? 'text-emerald-400' : g === 'B' ? 'text-green-400' : g === 'C' ? 'text-yellow-400' : 'text-red-400'

  const posArr = Object.values(portfolio.positions)
  const sm = summary

  return (
    <main className="min-h-screen bg-[#0d0f17] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Portfolio Dashboard</h1>
            <p className="mt-1 text-sm text-white/50">Track positions · Analyze risk · Optimize allocation</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={computeAnalytics}
              disabled={loading || posArr.length === 0}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {loading ? 'Computing…' : 'Analyze Portfolio'}
            </button>
            <button
              onClick={handleReset}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Summary cards */}
        {sm && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Total Value', value: `$${sm.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
              { label: 'Cash', value: `$${sm.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
              { label: 'Unrealized P&L', value: <PnlBadge value={sm.totalUnrealizedPnl} pct={sm.totalUnrealizedPnlPct} /> },
              { label: 'Realized P&L', value: <span className={`font-mono text-sm ${sm.totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${sm.totalRealizedPnl.toFixed(2)}</span> },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-xs text-white/50">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Diversification metrics row */}
        {divMetrics && (
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              { label: 'Div. Grade', value: <span className={`text-xl font-bold ${gradeColor(divMetrics.grade)}`}>{divMetrics.grade}</span> },
              { label: 'Effective N', value: divMetrics.effectiveN.toFixed(1) },
              { label: 'Avg Correlation', value: divMetrics.avgPairwiseCorr.toFixed(2) },
              { label: 'Portfolio Vol', value: `${(divMetrics.portfolioVol * 100).toFixed(1)}%` },
              { label: 'Div. Ratio', value: divMetrics.diversificationRatio.toFixed(2) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="mb-1 text-xs text-white/50">{label}</p>
                <p className="text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tab nav */}
        <div className="mb-4 flex gap-1 rounded-lg bg-white/5 p-1 w-fit">
          {(['positions', 'stress', 'riskparity', 'trades'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab ? 'bg-indigo-600 text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              {tab === 'riskparity' ? 'Risk Parity' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Positions tab */}
        {activeTab === 'positions' && (
          <div className="space-y-5">
            <SectionCard title="Add Position">
              <AddPositionForm onAdd={handleAddPosition} />
            </SectionCard>

            <SectionCard title={`Open Positions (${posArr.length})`}>
              {posArr.length === 0 ? (
                <p className="text-sm text-white/40">No positions yet. Add one above.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs text-white/50">
                      <th className="pb-2">Ticker</th>
                      <th className="pb-2">Side</th>
                      <th className="pb-2 text-right">Qty</th>
                      <th className="pb-2 text-right">Avg Cost</th>
                      <th className="pb-2 text-right">Last</th>
                      <th className="pb-2 text-right">Mkt Value</th>
                      <th className="pb-2 text-right">Unr. P&L</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sm?.positions.map((p) => (
                      <tr key={p.ticker} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 font-semibold text-indigo-300">{p.ticker}</td>
                        <td className="py-2">
                          <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${p.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {p.side}
                          </span>
                        </td>
                        <td className="py-2 text-right font-mono">{p.quantity}</td>
                        <td className="py-2 text-right font-mono">${p.avgCost.toFixed(2)}</td>
                        <td className="py-2 text-right font-mono">${p.lastPrice.toFixed(2)}</td>
                        <td className="py-2 text-right font-mono">${p.marketValue.toFixed(0)}</td>
                        <td className="py-2 text-right">
                          <PnlBadge value={p.unrealizedPnl} pct={p.unrealizedPnlPct} />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleClosePosition(p.ticker)}
                            className="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10"
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>
          </div>
        )}

        {/* Stress test tab */}
        {activeTab === 'stress' && (
          <SectionCard title="Historical Stress Tests">
            {stressResults.length === 0 ? (
              <p className="text-sm text-white/40">
                Click <strong>Analyze Portfolio</strong> to run stress scenarios.
              </p>
            ) : (
              <StressTable results={stressResults} />
            )}
          </SectionCard>
        )}

        {/* Risk parity tab */}
        {activeTab === 'riskparity' && (
          <SectionCard title="Inverse-Volatility Weights">
            {riskWeights.length === 0 ? (
              <p className="text-sm text-white/40">
                Click <strong>Analyze Portfolio</strong> to compute risk parity allocation.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-white/50">
                    <th className="pb-2">Ticker</th>
                    <th className="pb-2 text-right">Ann. Vol</th>
                    <th className="pb-2 text-right">Target Weight</th>
                    <th className="pb-2 text-right">Target Alloc ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {riskWeights.map((w) => (
                    <tr key={w.ticker} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 font-semibold text-indigo-300">{w.ticker}</td>
                      <td className="py-2 text-right font-mono">{(w.annualizedVol * 100).toFixed(1)}%</td>
                      <td className="py-2 text-right font-mono">{(w.weight * 100).toFixed(1)}%</td>
                      <td className="py-2 text-right font-mono">
                        {w.allocation != null ? `$${w.allocation.toFixed(0)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        )}

        {/* Trades tab */}
        {activeTab === 'trades' && (
          <SectionCard title={`Trade History (${portfolio.trades.length})`}>
            {portfolio.trades.length === 0 ? (
              <p className="text-sm text-white/40">No trades recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-white/50">
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Ticker</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Price</th>
                    <th className="pb-2 text-right">Comm.</th>
                  </tr>
                </thead>
                <tbody>
                  {[...portfolio.trades].reverse().map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-1.5 font-mono text-xs text-white/50">
                        {new Date(t.executedAt).toLocaleString()}
                      </td>
                      <td className="py-1.5 font-semibold text-indigo-300">{t.ticker}</td>
                      <td className="py-1.5">
                        <span className={`text-xs font-bold ${t.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.action} {t.side}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono">{t.quantity}</td>
                      <td className="py-1.5 text-right font-mono">${t.price.toFixed(2)}</td>
                      <td className="py-1.5 text-right font-mono">${t.commission.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        )}
      </div>
    </main>
  )
}
