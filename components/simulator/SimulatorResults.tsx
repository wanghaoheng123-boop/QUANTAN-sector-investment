'use client'

import { useState } from 'react'
import EquityCurveChart from '@/components/backtest/EquityCurveChart'
import InstrumentTable from '@/components/backtest/InstrumentTable'
import TradeLog from '@/components/backtest/TradeLog'
import type { BacktestResult, WalkForwardSummary } from '@/lib/backtest/engine'
import { normalizedConfidenceScales, type StrategyConfig } from '@/lib/strategy/strategyConfig'
import type { EntryExitZonesPayload } from '@/lib/quant/entryExitZones'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SimulatorPortfolio {
  avgReturn: number
  avgAnnReturn: number
  bnhAvg: number
  alpha: number
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxPortfolioDd: number
  winRate: number
  profitFactor: number
  avgTradeReturn: number
  totalTrades: number
  totalInstruments: number
  initialCapital: number
  finalCapital: number
}

export interface SimulatorResultsProps {
  results: BacktestResult[]
  portfolio: SimulatorPortfolio
  config: StrategyConfig
  walkForwardByTicker?: Record<string, WalkForwardSummary | null>
  paperAdvisory?: Record<string, { csp: string; cc: string }>
  entryExitZonesByTicker?: Record<string, EntryExitZonesPayload>
  liveQuotes?: Record<string, {
    price?: number
    changePct?: number
    rsi14?: number | null
    atrPct?: number | null
    deviationPct?: number | null
    macdHist?: number | null
    bbPctB?: number | null
    regime?: string
    action?: 'BUY' | 'HOLD' | 'SELL'
    confidence?: number
  }>
  computedAt: string
  runId: string
}

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmtPct(v: number, sign = true): string {
  const s = sign && v >= 0 ? '+' : ''
  return `${s}${(v * 100).toFixed(2)}%`
}
function fmtMoney(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtRatio(v: number | null): string {
  return v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

// ─── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
      <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Walk-Forward Panel ────────────────────────────────────────────────────────

export function WalkForwardPanel({
  results,
  walkForwardByTicker,
}: {
  results: BacktestResult[]
  walkForwardByTicker?: Record<string, WalkForwardSummary | null>
}) {
  const [selectedTicker, setSelectedTicker] = useState(results[0]?.ticker ?? '')
  const selected = results.find(r => r.ticker === selectedTicker)
  const tickers = results.map(r => r.ticker)
  const wf = walkForwardByTicker?.[selectedTicker]

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

      <div className="mb-3 text-[10px] text-slate-500 leading-relaxed">
        <strong className="text-slate-400">Windows:</strong> in-sample = 252 trading days, out-of-sample = 63 days, stepped forward by 63 days (same engine as <span className="font-mono">lib/backtest/engine</span>).
      </div>

      {wf && wf.windows.length > 0 ? (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="text-left py-2 pr-2">Period</th>
                  <th className="text-right py-2">IS ann.</th>
                  <th className="text-right py-2">OOS ann.</th>
                  <th className="text-right py-2">OOS/IS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {wf.windows.map(w => (
                  <tr key={w.periodLabel}>
                    <td className="py-1.5 pr-2 text-slate-400 font-mono">{w.periodLabel}</td>
                    <td className={`text-right font-mono ${w.isReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(w.isReturn * 100).toFixed(1)}%
                    </td>
                    <td className={`text-right font-mono ${w.osReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(w.osReturn * 100).toFixed(1)}%
                    </td>
                    <td className="text-right font-mono text-slate-300">{w.oosRatio.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/50">
              <div className="text-[9px] text-slate-500">Avg IS ann.</div>
              <div className="text-sm font-mono text-slate-200">{(wf.avgIsReturn * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/50">
              <div className="text-[9px] text-slate-500">Avg OOS ann.</div>
              <div className="text-sm font-mono text-slate-200">{(wf.avgOsReturn * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/50">
              <div className="text-[9px] text-slate-500">Avg OOS/IS</div>
              <div className="text-sm font-mono text-slate-200">{wf.avgOosRatio.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800/40 rounded-lg p-2 border border-slate-700/50">
              <div className="text-[9px] text-slate-500">Overfit index</div>
              <div className="text-sm font-mono text-amber-400/90">{wf.overfittingIndex.toFixed(2)}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="mb-4 text-xs text-slate-500">
          No walk-forward windows for this ticker (need ~315+ daily bars). Full-sample metrics below are not an IS/OOS split.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">Full-sample Ann. Return</div>
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

      <div className="mt-3 text-[10px] text-slate-600">
        Robust strategies show OOS performance in line with IS segments. A collapsing OOS/IS ratio or very high overfitting index warrants simpler rules or fewer parameters.
      </div>
    </div>
  )
}

// ─── Strategy Mode Description ─────────────────────────────────────────────────

const STRATEGY_MODE_DESCRIPTIONS: Record<string, { title: string; desc: string; when: string }> = {
  regime: {
    title: 'Regime Dip-Buy',
    desc: 'Buy when price dips below the 200SMA into correction territory with bullish confirmations. Sells when price reaches extended zones.',
    when: 'Use in choppy, mean-reverting markets. Best after sharp rallies — buys the dip before the next leg up.',
  },
  momentum: {
    title: 'Momentum Breakout',
    desc: 'Buy when price breaks above SMA with positive slope and strong momentum. Does not dip-buy.',
    when: 'Use in strong trending markets (e.g., 2020–2021 type runs). Underperforms in range-bound and mean-reversion regimes.',
  },
  mean_reversion: {
    title: 'Mean Reversion',
    desc: 'Buy when price is statistically far below its mean (z-score entry). Sell when price reverts or exceeds mean.',
    when: 'Use in highly stationary markets with strong historical averages. Works poorly in trending markets.',
  },
  breakout: {
    title: 'Breakout',
    desc: 'Buy on volume-confirmed price breakouts above recent consolidation range. Sell on breakdown.',
    when: 'Use when markets are coiled — low-volatility consolidation preceding strong directional moves.',
  },
}

function StrategyModeBadge({ config }: { config: StrategyConfig }) {
  const mode = config.strategyMode.strategyMode
  const info = STRATEGY_MODE_DESCRIPTIONS[mode] ?? STRATEGY_MODE_DESCRIPTIONS.regime
  const modeColors: Record<string, string> = {
    regime: 'border-cyan-500/30 bg-cyan-500/10',
    momentum: 'border-violet-500/30 bg-violet-500/10',
    mean_reversion: 'border-amber-500/30 bg-amber-500/10',
    breakout: 'border-emerald-500/30 bg-emerald-500/10',
  }

  return (
    <div className={`rounded-xl p-4 border ${modeColors[mode] ?? ''}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-bold text-white">{info.title}</span>
        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase tracking-wider">{mode}</span>
      </div>
      <p className="text-xs text-slate-400 mb-1">{info.desc}</p>
      <p className="text-[10px] text-slate-600"><span className="text-slate-500">When to use:</span> {info.when}</p>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

function EntryExitZonesCard({
  zones,
  ticker,
}: {
  zones: EntryExitZonesPayload
  ticker: string
}) {
  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-800 p-4">
      <div className="text-xs font-semibold text-slate-300 mb-1">{ticker} — conditional price bands</div>
      <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">{zones.disclaimer}</p>
      <ul className="space-y-2 text-[11px]">
        {zones.bands.map(b => (
          <li key={b.id} className="border border-slate-800/80 rounded-lg p-2 bg-slate-950/40">
            <div className="text-slate-400 font-medium">{b.label}</div>
            <div className="font-mono text-slate-200">
              {b.lower.toFixed(2)} – {b.upper.toFixed(2)}
            </div>
            <div className="text-slate-600 text-[10px] mt-0.5">{b.note}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SimulatorResults({
  results,
  portfolio,
  config,
  computedAt,
  runId,
  liveQuotes,
  walkForwardByTicker,
  paperAdvisory,
  entryExitZonesByTicker,
}: SimulatorResultsProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'instruments' | 'trades' | 'analysis'>('summary')

  const INITIAL_CAPITAL = portfolio.initialCapital || 100_000

  const sectorColors: Record<string, string> = {
    Technology: '#3b82f6', Energy: '#f59e0b', Financials: '#10b981', Healthcare: '#ec4899',
    'Consumer Disc.': '#f97316', Industrials: '#6366f1', Communication: '#8b5cf6',
    Materials: '#84cc16', Utilities: '#06b6d4', 'Real Estate': '#a78bfa',
    'Consumer Staples': '#34d399', Crypto: '#f7931a',
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-white text-lg font-bold">
            SIM
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Simulation Results</h2>
            <p className="text-xs text-slate-400">
              {results.length} instruments · Run ID: {runId.slice(0, 8)} · Computed {new Date(computedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <span className="text-[10px] px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 font-mono">
            Initial: {fmtMoney(INITIAL_CAPITAL)}
          </span>
          <span className={`text-[10px] px-3 py-1.5 rounded-lg border font-mono font-bold ${
            portfolio.finalCapital >= INITIAL_CAPITAL
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            Final: {fmtMoney(portfolio.finalCapital)}
          </span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Portfolio Return"
          value={fmtPct(portfolio.avgReturn)}
          sub={`Ann: ${fmtPct(portfolio.avgAnnReturn)}`}
          color={portfolio.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <MetricCard
          label="Alpha vs B&H"
          value={fmtPct(portfolio.alpha)}
          sub={`B&H avg: ${fmtPct(portfolio.bnhAvg)}`}
          color={portfolio.alpha > 0 ? 'text-cyan-400' : 'text-orange-400'}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={fmtRatio(portfolio.sharpeRatio)}
          sub="Risk-adj return"
          color={portfolio.sharpeRatio != null && portfolio.sharpeRatio > 0 ? 'text-cyan-400' : 'text-slate-400'}
        />
        <MetricCard
          label="Max Drawdown"
          value={`-${(portfolio.maxPortfolioDd * 100).toFixed(1)}%`}
          sub="Portfolio peak-to-trough"
          color="text-red-400"
        />
        <MetricCard
          label="Win Rate"
          value={`${(portfolio.winRate * 100).toFixed(1)}%`}
          sub={`${portfolio.totalTrades} total trades`}
          color={portfolio.winRate > 0.5 ? 'text-emerald-400' : 'text-slate-400'}
        />
        <MetricCard
          label="Sortino Ratio"
          value={fmtRatio(portfolio.sortinoRatio)}
          sub="Downside risk-adj"
          color={portfolio.sortinoRatio != null && portfolio.sortinoRatio > 0 ? 'text-cyan-400' : 'text-slate-400'}
        />
      </div>

      {entryExitZonesByTicker && Object.keys(entryExitZonesByTicker).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results
            .filter(r => entryExitZonesByTicker[r.ticker]?.bands?.length)
            .slice(0, 6)
            .map(r => (
              <EntryExitZonesCard key={r.ticker} ticker={r.ticker} zones={entryExitZonesByTicker[r.ticker]} />
            ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 w-fit">
        {(['summary', 'instruments', 'trades', 'analysis'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs rounded-md transition-all capitalize ${
              activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Strategy mode info */}
          <StrategyModeBadge config={config} />

          {/* Equity curve */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
              Equity Curves — Top 8 by Return
            </h3>
            <EquityCurveChart
              instruments={results.slice().sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
              initialCapital={INITIAL_CAPITAL}
            />
          </div>

          {/* Strategy rules */}
          <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
              {[
                ['BUY Signal', `${config.regime.smaPeriod}-period SMA deviation dip zone + SMA slope rising (>0.5%/20 bars) + price near SMA + ≥2 of: RSI<35, MACD hist>0, ATR%>2, BB%<0.20 → sized per Kelly tiers`],
                ['HOLD', 'Confidence <55% or HEALTHY_BULL / EXTENDED_BULL → No action. Slope insufficient or price not near SMA = no buy.'],
                ['SELL Signal', 'FALLING_KNIFE (dip zone + declining SMA) or HEALTHY_BULL + RSI>70 → Exit full position'],
                ['Stop Loss', `ATR-adaptive: ${config.stopLoss.stopLossAtrMultiplier}× ATR%, floor ${(config.stopLoss.stopLossFloor * 100).toFixed(0)}%, cap ${(config.stopLoss.stopLossCeiling * 100).toFixed(0)}%. Volatility-adjusted per instrument.`],
                ['Trailing Stop', `${config.stopLoss.trailAtrMultiplier1}× ATR profit → stop rises to break-even. ${config.stopLoss.trailAtrMultiplier2}× ATR profit → stop locks at ${config.stopLoss.trailLockMultiplier}× ATR above entry.`],
                ['Max DD Cap', `${(config.stopLoss.maxDrawdownCap * 100).toFixed(0)}% portfolio equity drawdown → circuit breaker, close all positions immediately`],
                [
                  'Position Sizing',
                  (() => {
                    const tiers = normalizedConfidenceScales(config.positionSizing.confidenceScales)
                    const tierStr = tiers
                      .map((s) => `≥${s.confidenceThreshold}%→${(s.kellyFraction * 100).toFixed(0)}%`)
                      .join(' · ')
                    return `Kelly mode: ${config.positionSizing.kellyMode} · Max ${(config.positionSizing.maxKellyFraction * 100).toFixed(0)}% per trade · Tiers: ${tierStr}`
                  })(),
                ],
                ['Transaction Costs', `${config.transactionCosts.txCostBpsPerSide} bps round-trip (IBKR: $0.005/sh + 0.05% spread + 0.5bps slippage)`],
              ].map(([title, desc]) => (
                <div key={title} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="text-slate-300 font-medium mb-1">{title}</div>
                  <div className="text-slate-500 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'instruments' && (
        <InstrumentTable results={results} sectorColors={sectorColors} />
      )}

      {activeTab === 'trades' && (
        <TradeLog trades={results.flatMap(r => r.closedTrades)} sectorColors={sectorColors} />
      )}

      {activeTab === 'analysis' && (
        <div className="space-y-6">
          <WalkForwardPanel results={results} walkForwardByTicker={walkForwardByTicker} />

          {paperAdvisory && Object.keys(paperAdvisory).length > 0 && (
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
              <h3 className="text-sm font-semibold text-white mb-2 uppercase tracking-wider text-slate-400">
                Paper options · CSP / Covered call (advisory)
              </h3>
              <p className="text-[10px] text-slate-500 mb-4">
                Not merged into strategy equity. Assumes end-of-day chain snapshot; no assignment, borrow, or dividend risk model.
              </p>
              <div className="space-y-3">
                {Object.entries(paperAdvisory).map(([t, adv]) => (
                  <div key={t} className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50 text-xs text-slate-400 space-y-1">
                    <div className="font-mono text-slate-300">{t}</div>
                    <div><span className="text-slate-500">CSP:</span> {adv.csp}</div>
                    <div><span className="text-slate-500">CC:</span> {adv.cc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Regime performance breakdown */}
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
              Per-Regime Performance
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800">
                    {['Regime', 'Trades', 'Wins', 'Win Rate', 'Avg Return', 'Ann. Return', 'Best', 'Worst'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {/* Aggregate by regime from closed trades */}
                  {(() => {
                    const regimeMap: Record<string, { trades: number; wins: number; totalRet: number; annRets: number[] }> = {}
                    for (const r of results) {
                      for (const t of r.closedTrades) {
                        if (!regimeMap[t.regime]) regimeMap[t.regime] = { trades: 0, wins: 0, totalRet: 0, annRets: [] }
                        regimeMap[t.regime].trades++
                        if ((t.pnlPct ?? 0) > 0) regimeMap[t.regime].wins++
                        regimeMap[t.regime].totalRet += t.pnlPct ?? 0
                      }
                    }
                    return Object.entries(regimeMap)
                      .sort(([, a], [, b]) => b.trades - a.trades)
                      .slice(0, 10)
                      .map(([regime, data]) => {
                        const winRate = data.wins / Math.max(data.trades, 1)
                        const avgRet = data.totalRet / Math.max(data.trades, 1)
                        return (
                          <tr key={regime} className="hover:bg-slate-800/30">
                            <td className="px-4 py-2.5 font-mono text-slate-300 text-[10px]">{regime}</td>
                            <td className="px-4 py-2.5 font-mono text-slate-400">{data.trades}</td>
                            <td className="px-4 py-2.5 font-mono text-emerald-400">{data.wins}</td>
                            <td className={`px-4 py-2.5 font-mono ${winRate > 0.5 ? 'text-emerald-400' : 'text-slate-400'}`}>
                              {(winRate * 100).toFixed(0)}%
                            </td>
                            <td className={`px-4 py-2.5 font-mono ${avgRet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {(avgRet * 100).toFixed(2)}%
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 text-[10px]">—</td>
                            <td className="px-4 py-2.5 text-slate-600 text-[10px]">—</td>
                            <td className="px-4 py-2.5 text-slate-600 text-[10px]">—</td>
                          </tr>
                        )
                      })
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live quote prices vs backtest prices */}
          {liveQuotes && Object.keys(liveQuotes).length > 0 && (
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
              <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
                Live Prices vs Backtest Entry
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      {['Ticker', 'Backtest Entry', 'Live Price', 'Change', 'Signal', 'Confidence'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {results.map(r => {
                      const lq = liveQuotes[r.ticker]
                      if (!lq) return null
                      const livePrice = lq.price
                      const entryPrice = r.closedTrades[0]?.entryPrice ?? r.initialPrice
                      const priceChg = livePrice && entryPrice ? ((livePrice - entryPrice) / entryPrice) * 100 : null
                      return (
                        <tr key={r.ticker} className="hover:bg-slate-800/30">
                          <td className="px-4 py-2.5 font-mono font-bold text-white">{r.ticker}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">${entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-2.5 font-mono text-white">{livePrice != null ? `$${livePrice.toFixed(2)}` : '—'}</td>
                          <td className={`px-4 py-2.5 font-mono ${priceChg == null ? 'text-slate-600' : priceChg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {priceChg != null ? `${priceChg >= 0 ? '+' : ''}${priceChg.toFixed(2)}%` : '—'}
                          </td>
                          <td className={`px-4 py-2.5 font-bold text-sm ${lq.action === 'BUY' ? 'text-emerald-400' : lq.action === 'SELL' ? 'text-red-400' : 'text-amber-400'}`}>
                            {lq.action ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">
                            {lq.confidence != null ? `${lq.confidence.toFixed(0)}%` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
