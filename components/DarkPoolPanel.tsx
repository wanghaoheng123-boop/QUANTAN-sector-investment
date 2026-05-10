'use client'

import { DarkPoolPrint } from '@/lib/sectors'
import type { DarkPoolAnalysis } from '@/lib/darkpool'

// ─── Props ────────────────────────────────────────────────────────────────────

interface DarkPoolPanelProps {
  prints: DarkPoolPrint[]      // illustrative block prints (unchanged)
  ticker: string
  color: string
  /** Real off-exchange analytics loaded from /api/darkpool/[ticker] */
  apiData?: DarkPoolAnalysis | null
  /** True while fetching apiData */
  apiLoading?: boolean
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtShares(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toFixed(0)
}

function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return `${n.toFixed(decimals)}%`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DarkPoolPanel({
  prints,
  ticker,
  color,
  apiData,
  apiLoading = false,
}: DarkPoolPanelProps) {
  const { metrics, hasRealData, statusNote } = apiData ?? {
    metrics: {},
    hasRealData: false,
    statusNote: null,
  }

  // ── Sentiment from real data ─────────────────────────────────────────────
  const offPct = metrics.offExchangePct
  const shortPct = metrics.shortFloatPct

  // Derive sentiment: if short interest > 10% of float → distribution signal
  const shortSignal: 'DISTRIBUTION' | 'ACCUMULATION' | 'NEUTRAL' =
    shortPct == null
      ? 'NEUTRAL'
      : shortPct > 10
        ? 'DISTRIBUTION'
        : shortPct > 5
          ? 'NEUTRAL'
          : 'ACCUMULATION'

  const shortColor =
    shortSignal === 'DISTRIBUTION'
      ? '#ff4757'
      : shortSignal === 'ACCUMULATION'
        ? '#00d084'
        : '#94a3b8'

  // ── Bullish print ratio (illustrative) ────────────────────────────────
  const bullishPrints = prints.filter((p) => p.sentiment === 'BULLISH')
  const totalPrintSize = prints.reduce((s, p) => s + p.size, 0)
  const bullishPct = totalPrintSize > 0
    ? (bullishPrints.reduce((s, p) => s + p.size, 0) / totalPrintSize) * 100
    : 50

  return (
    <div className="space-y-4">
      {/* ── Real off-exchange metrics ──────────────────────────────── */}
      {apiLoading && !apiData && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-2 animate-pulse">
          <div className="h-4 bg-slate-800 rounded w-2/3" />
          <div className="h-3 bg-slate-800 rounded w-1/2" />
        </div>
      )}

      {apiData && !apiLoading && (
        <>
          {/* Status note when no real data */}
          {statusNote && (
            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-500 leading-relaxed">
              <span className="text-amber-300/80 font-semibold">Note: </span>
              {statusNote}
            </div>
          )}

          {/* Real metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard
              label="Off-Exchange Vol"
              value={fmtPct(offPct, 2)}
              sub={offPct != null ? `${(100 - offPct).toFixed(1)}% on-exchange` : 'Finra BATS'}
              color="#f59e0b"
            />
            <MetricCard
              label="Short Interest"
              value={fmtPct(shortPct, 2)}
              sub={metrics.sharesShorted != null ? `${fmtShares(metrics.sharesShorted)} shares` : 'of float'}
              color={shortColor}
            />
            <MetricCard
              label="Days to Cover"
              value={metrics.daysToCover != null ? metrics.daysToCover.toFixed(1) : '—'}
              sub={metrics.avgDailyVolume != null ? `Vol: ${fmtShares(metrics.avgDailyVolume)}/day` : 'avg daily vol'}
              color="#3b82f6"
            />
            <MetricCard
              label="Float / Shares Out"
              value={
                metrics.sharesFloat != null
                  ? fmtShares(metrics.sharesFloat)
                  : metrics.sharesOutstanding != null
                    ? fmtShares(metrics.sharesOutstanding)
                    : '—'
              }
              sub="Yahoo Finance"
              color="#8b5cf6"
            />
          </div>

          {/* Short signal banner */}
          {hasRealData && (
            <div
              className="rounded-xl border p-3 flex items-center gap-3"
              role="alert"
              aria-label={`Short interest signal: ${shortSignal}`}
              style={{
                borderColor: `${shortColor}40`,
                backgroundColor: `${shortColor}10`,
              }}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: shortColor }}
              />
              <div>
                <div className="text-xs font-semibold" style={{ color: shortColor }}>
                  Short Interest Signal: {shortSignal}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  {shortSignal === 'DISTRIBUTION'
                    ? 'Elevated short interest (>10% of float) may indicate bearish sentiment or institutional hedging.'
                    : shortSignal === 'ACCUMULATION'
                      ? 'Low short interest (<5% of float) suggests limited near-term selling pressure.'
                      : 'Short interest is moderate — no strong directional signal from short data.'}
                  {' Source: Finra / Yahoo Finance.'}
                </div>
              </div>
            </div>
          )}

          {/* Price */}
          {apiData.quote.price > 0 && (
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                Last:{' '}
                <span className="text-white font-mono">
                  ${apiData.quote.price.toFixed(2)}
                </span>
              </span>
              <span
                className={
                  apiData.quote.changePct >= 0 ? 'text-green-400' : 'text-red-400'
                }
              >
                {apiData.quote.changePct >= 0 ? '+' : ''}
                {apiData.quote.changePct.toFixed(2)}%
              </span>
              {apiData.quote.quoteTime && (
                <span className="text-slate-600">
                  {new Date(apiData.quote.quoteTime).toLocaleString()}
                </span>
              )}
            </div>
          )}

          {/* Data source line */}
          <div className="text-[10px] text-slate-600 leading-relaxed">
            Source: Yahoo Finance aggregate off-exchange trading data.{' '}
            {apiData.fetchedAt && (
              <>Fetched: {new Date(apiData.fetchedAt).toLocaleString()}. </>
            )}
            Off-exchange % = Finra BATS/OTCQX/OTCBB volume ÷ total volume.
          </div>
        </>
      )}

      {/* ── Short interest / off-exchange bar (real or synthetic) ─── */}
      {(hasRealData || true) && (
        <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800" role="region" aria-label="Off-exchange flow sentiment">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span aria-label="Bearish sentiment">BEARISH</span>
            <span className="text-slate-300 font-medium">Off-Exchange Flow</span>
            <span aria-label="Bullish sentiment">BULLISH</span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(bullishPct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${bullishPct.toFixed(0)}% bullish flow`}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${bullishPct}%`,
                background: `linear-gradient(90deg, #ff4757 0%, ${color} 100%)`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs mt-1.5">
            <span className="text-red-400">{(100 - bullishPct).toFixed(0)}%</span>
            <span style={{ color }}>{bullishPct.toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* ── Block prints table (illustrative demo) ───────────────── */}
      <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-white">
            Block Prints — {ticker}
          </span>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {!hasRealData && (
              <span className="px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/30 text-[10px]">
                ILLUSTRATIVE
              </span>
            )}
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Bullish
            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block ml-1" /> Bearish
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-right px-3 py-2 font-medium">Size</th>
                <th className="text-right px-3 py-2 font-medium">Price</th>
                <th className="text-right px-3 py-2 font-medium">vs VWAP</th>
                <th className="text-center px-3 py-2 font-medium">Type</th>
                <th className="text-center px-3 py-2 font-medium">Signal</th>
              </tr>
            </thead>
            <tbody>
              {prints.slice(0, 10).map((print, i) => (
                <tr
                  key={i}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-slate-400">{print.time}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-white">
                    {(print.size / 1000).toFixed(0)}K
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-white">
                    ${print.price.toFixed(2)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono ${
                      print.premium > 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {print.premium > 0 ? '+' : ''}
                    {(print.premium).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        print.type === 'SWEEP'
                          ? 'bg-yellow-900/40 text-yellow-400'
                          : print.type === 'BLOCK'
                            ? 'bg-blue-900/40 text-blue-400'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {print.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`w-2 h-2 rounded-full inline-block ${
                        print.sentiment === 'BULLISH'
                          ? 'bg-blue-400 shadow-sm shadow-blue-400'
                          : print.sentiment === 'BEARISH'
                            ? 'bg-purple-400 shadow-sm shadow-purple-400'
                            : 'bg-slate-500'
                      }`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!hasRealData && (
          <div className="px-4 py-2.5 text-xs text-slate-600 text-center border-t border-slate-800">
            <span className="text-amber-400/80">
              ⚠ Illustrative block prints — not from a proprietary data feed.
            </span>
            {' '}Individual print data requires a subscription service (e.g. Finra ADF, CBOE UQDF, or Bloomberg LP).
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub: string
  color: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <div className="text-[10px] text-slate-500 mb-1 leading-tight">{label}</div>
      <div className="text-lg font-bold font-mono text-white">{value}</div>
      <div className="text-[10px] text-slate-600 mt-0.5 leading-tight">{sub}</div>
    </div>
  )
}
