'use client'

import { LocalTime } from '@/components/LocalTime'
import { formatLocalTime } from '@/lib/format'
import { useState, useEffect, useCallback, useRef } from 'react'
import { DataFreshnessIndicator } from '@/components/DataFreshnessIndicator'
import {
  BtcCandle,
  calcRSI,
  calcMACD,
  calcEMA,
  calcBollingerBands,
  calcVWAP,
  calcATR,
  calcStochastic,
  interpretFundingRate,
} from '@/lib/crypto'
import { barLabel, isDailyInterval } from '@/lib/barInterval'
import { DIP_SIGNAL_LABEL, ma200Regime } from '@/lib/quant/technicals'
import { fetchJsonSafe } from '@/lib/fetchJsonSafe'
import { LiquidationsPanel } from '@/components/crypto/LiquidationsPanel'

interface Props {
  candles: BtcCandle[]
  /** Q-141: the interval of `candles` (the Chart tab's timeframe), so labels name the bars. */
  interval?: string
}

interface MetricsData {
  fundingRate: number | null
  nextFundingTime: string | null
  openInterest: number | null
  /** Bybit account buy/sell ratios (not taker volume) — Q-140 AC3. */
  accountBuyRatio: number | null
  accountSellRatio: number | null
  longShortRatio: number | null
  longAccountPct: number | null
  shortAccountPct: number | null
  source: string
  fetchedAt: string
  /** Q-140: set by the route when Bybit and/or OKX failed. */
  degraded?: boolean
  userMessage?: string
}


// ─── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
      <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6">
      <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-widest text-slate-400">{title}</h3>
      {children}
    </div>
  )
}


export default function BtcQuantLab({ candles, interval = '1d' }: Props) {
  const bars = barLabel(interval)
  const daily = isDailyInterval(interval)
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [activeMetricTab, setActiveMetricTab] = useState<'funding' | 'liquidations' | 'signals'>('funding')
  const [derivativesError, setDerivativesError] = useState<string | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsFetchedAt, setMetricsFetchedAt] = useState<string | null>(null)
  // I2 — these routes serve a stored copy when the upstream exchange call fails
  // or is rate-limited, and both set `_cached: true`. Nothing read it, so a
  // cached derivatives figure was displayed identically to a live one.
  const [metricsCached, setMetricsCached] = useState(false)

  // F3 (WS-F): guard against setState-after-unmount. The 30s/60s pollers below
  // clearInterval on cleanup (no NEW fetches after unmount), but an in-flight
  // fetch can still resolve post-unmount and call setState. mountedRef gates the
  // post-await updates (the pre-await setLoading(true) is synchronous, so safe).
  const mountedRef = useRef(true)
  useEffect(() => {
    // Set in the body (not just useRef(true)) so React StrictMode's dev
    // mount→unmount→mount double-invoke re-arms the flag instead of leaving it
    // permanently false after the throwaway first cleanup.
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchMetrics = useCallback(async () => {
    setMetricsLoading(true)
    setDerivativesError((prev) => prev && !prev.includes('metrics') ? prev : null)
    try {
      const mr = await fetchJsonSafe('/api/crypto/btc/metrics')
      if (!mountedRef.current) return
      if (mr.ok) {
        setMetrics(mr.data as MetricsData)
        setMetricsCached((mr.data as { _cached?: boolean })?._cached === true)
        setMetricsFetchedAt(formatLocalTime(new Date()))
      } else {
        setDerivativesError((prev) => {
          const base = prev ? `${prev} · ` : ''
          return `${base}metrics: ${mr.message}`
        })
      }
    } catch (e) {
      console.error('[BtcQuantLab] metrics', e)
    } finally {
      if (mountedRef.current) setMetricsLoading(false)
    }
  }, [])


  // Initial load
  useEffect(() => {
    void fetchMetrics()
  }, [fetchMetrics])

  // Poll metrics every 30 seconds
  useEffect(() => {
    const id = setInterval(() => { void fetchMetrics() }, 30_000)
    return () => clearInterval(id)
  }, [fetchMetrics])


  const closes = candles.map(c => c.close)
  const latestClose = closes[closes.length - 1] ?? 0
  const high20 = closes.length >= 20 ? Math.max(...closes.slice(-20)) : latestClose
  const low20 = closes.length >= 20 ? Math.min(...closes.slice(-20)) : latestClose

  const rsiValues = calcRSI(closes)
  const latestRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : NaN
  const macdValues = calcMACD(closes)
  const latestMACD = macdValues.length > 0 ? macdValues[macdValues.length - 1] : { macd: NaN, signal: NaN, histogram: NaN }
  const ema20 = calcEMA(closes, 20)
  const latestEMA20 = ema20.length > 0 ? ema20[ema20.length - 1] : NaN
  const ema50 = calcEMA(closes, 50)
  const latestEMA50 = ema50.length > 0 ? ema50[ema50.length - 1] : NaN
  const rsiOk = Number.isFinite(latestRSI)
  const macdHist = latestMACD.histogram
  const macdOk = Number.isFinite(macdHist ?? NaN)
  const emaOk = Number.isFinite(latestEMA20) && Number.isFinite(latestEMA50)
  const bb = calcBollingerBands(closes)
  const latestBB = bb.length > 0 ? bb[bb.length - 1] : { mid: NaN, upper: NaN, lower: NaN }
  const bbRange = Number(latestBB?.upper) - Number(latestBB?.lower)
  const bbPositionPct =
    Number.isFinite(bbRange) && bbRange > 0
      ? ((latestClose - Number(latestBB.lower)) / bbRange) * 100
      : null
  const vwapData = calcVWAP(candles)
  const latestVWAP = vwapData[vwapData.length - 1]?.value ?? latestClose
  const fundingInfo = metrics?.fundingRate != null ? interpretFundingRate(metrics.fundingRate) : null

  const atrSeries = calcATR(candles, 14)
  const latestATR = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : NaN
  const stoch = calcStochastic(candles, 14, 3, 3)
  const latestStK = stoch.k.length > 0 ? stoch.k[stoch.k.length - 1] : NaN
  const latestStD = stoch.d.length > 0 ? stoch.d[stoch.d.length - 1] : NaN
  const stochOk = Number.isFinite(latestStK) && Number.isFinite(latestStD)
  const atrOk = Number.isFinite(latestATR)

  // Q-141: a "Rainbow model" sat here. It was not the BTC rainbow chart (a log
  // regression over BTC's whole history): it placed price inside an arbitrary
  // [0.6 × 20-bar low, 1.5 × 20-bar high] and named the result "Sell Peak",
  // "FOMO", "Accumulate", "Deep Value". What it actually measured, honestly:
  // where the close sits in the last 20 bars' close range.
  const rangePosition = high20 > low20 ? (latestClose - low20) / (high20 - low20) : null

  // 200-day MA deviation regime (lib/quant/technicals.ts ma200Regime)
  const regime = ma200Regime(latestClose, closes, latestRSI)
  const ma200 =
    closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : null

  // Signal summary
  const signals = [
    {
      label: 'RSI(14)',
      value: rsiOk ? latestRSI.toFixed(1) : '—',
      signal: !rsiOk ? 'INSUFFICIENT DATA' : latestRSI > 70 ? 'OVERBOUGHT' : latestRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
      color: !rsiOk ? 'text-slate-400' : latestRSI > 70 ? 'text-red-400' : latestRSI < 30 ? 'text-green-400' : 'text-slate-400',
    },
    {
      label: 'MACD Histogram',
      value: macdOk ? (macdHist as number).toFixed(2) : '—',
      signal: !macdOk ? 'INSUFFICIENT DATA' : (macdHist ?? 0) > 0 ? 'BULLISH' : (macdHist ?? 0) < 0 ? 'BEARISH' : 'FLAT',
      color: !macdOk ? 'text-slate-400' : (macdHist ?? 0) > 0 ? 'text-green-400' : (macdHist ?? 0) < 0 ? 'text-red-400' : 'text-slate-400',
    },
    {
      label: 'EMA 20 vs 50',
      value: !emaOk ? '—' : latestEMA20 > latestEMA50 ? 'E20>E50 ↑' : 'E20<E50 ↓',
      signal: !emaOk ? 'INSUFFICIENT DATA' : latestEMA20 > latestEMA50 ? 'BULLISH CROSS' : 'BEARISH CROSS',
      color: !emaOk ? 'text-slate-400' : latestEMA20 > latestEMA50 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'VWAP',
      value: `$${latestVWAP.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
      signal: latestClose > latestVWAP ? 'ABOVE VWAP ↑' : 'BELOW VWAP ↓',
      color: latestClose > latestVWAP ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'BB Position',
      value: bbPositionPct != null && Number.isFinite(bbPositionPct) ? `${bbPositionPct.toFixed(0)}%` : 'N/A',
      signal: latestClose > latestBB.upper ? 'ABOVE UPPER BAND' : latestClose < latestBB.lower ? 'BELOW LOWER BAND' : 'WITHIN BANDS',
      color: latestClose > latestBB.upper ? 'text-red-400' : latestClose < latestBB.lower ? 'text-green-400' : 'text-slate-400',
    },
    {
      label: 'ATR(14)',
      value: atrOk ? `$${latestATR.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—',
      signal: !atrOk
        ? 'INSUFFICIENT DATA'
        : latestATR > latestClose * 0.05
          ? 'HIGH VOL'
          : 'NORMAL VOL',
      color: !atrOk ? 'text-slate-400' : latestATR > latestClose * 0.05 ? 'text-amber-400' : 'text-slate-400',
    },
    {
      label: 'Stoch %K / %D',
      value: stochOk ? `${latestStK.toFixed(0)} / ${latestStD.toFixed(0)}` : '—',
      signal: !stochOk
        ? 'INSUFFICIENT DATA'
        : latestStK > 80 && latestStD > 80
          ? 'OVERBOUGHT'
          : latestStK < 20 && latestStD < 20
            ? 'OVERSOLD'
            : 'NEUTRAL',
      color: !stochOk
        ? 'text-slate-400'
        : latestStK > 80
          ? 'text-red-400'
          : latestStK < 20
            ? 'text-green-400'
            : 'text-slate-400',
    },
    {
      label: 'Funding Rate',
      value: metrics?.fundingRate != null ? `${(metrics.fundingRate * 100).toFixed(4)}%` : 'N/A',
      signal: fundingInfo?.signal ?? 'N/A',
      color:
        fundingInfo?.signal === 'BULLISH'
          ? 'text-green-400'
          : fundingInfo?.signal === 'BEARISH'
            ? 'text-orange-400'
            : 'text-slate-400',
    },
    // Q-138: a "Liquidation Bias" card (formerly "OI Net Direction") sat here,
    // coloured and undated beside BULLISH / BUY THE DIP. Its window is the
    // latest 100 OKX liquidations — ~1.5h, and it flipped within minutes on
    // 2026-09-28 while the trailing 24h pointed the other way. It is shown,
    // with its window, only on the Liquidations tab; it is not a signal.
    {
      label: 'Range position (20 bars)',
      value: rangePosition != null ? `${(rangePosition * 100).toFixed(0)}%` : '—',
      signal: 'RANGE',
      color: 'text-slate-300',
    },
    {
      label: '200MA Deviation',
      value: regime.deviationPct != null ? `${regime.deviationPct > 0 ? '+' : ''}${regime.deviationPct.toFixed(1)}%` : '—',
      // Red-team R2-241-1/-3: the dip classification is calibrated on daily
      // candles; on any other bars it is not shown at all.
      // Q-153: a description of the classification, not "BUY THE DIP".
      signal: !daily ? 'daily only' : DIP_SIGNAL_LABEL[regime.dipSignal],
      color: regime.dipSignal === 'STRONG_DIP' ? 'text-green-400' : regime.dipSignal === 'FALLING_KNIFE' ? 'text-red-400' : regime.dipSignal === 'WATCH_DIP' ? 'text-amber-400' : regime.dipSignal === 'OVERBOUGHT' ? 'text-orange-400' : 'text-slate-400',
    },
  ]

  if (candles.length < 30) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
        Not enough BTC history loaded yet. Quant signals need at least 30 candles.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-[11px] text-slate-400 border border-slate-800 rounded-lg px-3 py-2 bg-slate-900/40">
        <span className="text-emerald-400/90 font-semibold">Live quant</span> — RSI, MACD, EMA, Bollinger, VWAP, ATR(14), Stochastic(14,3,3), 200MA regime recalculated in your browser from the loaded candle series ({candles.length} bars). Derivatives (funding, OI) refresh every 30s; liquidations every 60s while their tab is open. Exchange APIs may be empty when geo-blocked.
      </p>
      {derivativesError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90">
          <span className="font-medium text-amber-100">Derivatives / liquidity API</span>
          <p className="text-amber-200/80 mt-0.5">{derivativesError}</p>
          <p className="text-slate-400 mt-1">Price-action indicators above still work; perp metrics load from Bybit/OKX public APIs (no Binance).</p>
        </div>
      )}
      {/* Top signals grid */}
      <Section title="BTC Quant Signals">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {signals.map(s => (
            <div key={s.label} className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{s.label}</div>
              <div className={`text-base font-bold font-mono ${s.color}`}>{s.value}</div>
              <div className={`text-[10px] mt-1 ${s.color}`}>{s.signal}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Metrics tabs */}
      {/* Q-138: was "On-Chain & Derivatives Metrics" — nothing in this section is
          read from the chain; funding, OI and liquidations are exchange-reported. */}
      <Section title="Exchange Derivatives Metrics">
        <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 mb-4 w-fit">
          {([['funding', 'Funding & OI'], ['liquidations', 'Liquidations'], ['signals', 'Analysis']] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => setActiveMetricTab(tab)}
              className={`px-4 py-1.5 text-xs rounded-md transition-all ${activeMetricTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* I2 (Q-138 round 2): the metrics cache flag was shown only as "(cached)"
            text, and this file satisfied the cache-flag guard only through an
            import left over from the liquidations tab. The badge is real now. */}
        {activeMetricTab === 'funding' && metricsCached && (
          <div className="mb-2"><DataFreshnessIndicator cached compact /></div>
        )}
        {/* Q-140 (I2): the metrics route has always answered `degraded: true` with
            a `userMessage` when Bybit/OKX failed, and nothing here read it — the
            nulls rendered as dashes with no reason. Said now. */}
        {activeMetricTab === 'funding' && metrics?.degraded && (
          <div role="status" className="text-[11px] text-amber-400 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2 mb-3">
            {metrics.userMessage ?? 'Derivatives metrics are partially unavailable.'}
          </div>
        )}
        {activeMetricTab === 'funding' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              label="Funding Rate (8h)"
              value={metrics?.fundingRate != null ? `${(metrics.fundingRate * 100).toFixed(4)}%` : '—'}
              sub={metrics?.nextFundingTime ? <>Next: <LocalTime value={metrics.nextFundingTime} /></> : undefined}
              color={fundingInfo?.color ?? 'text-slate-400'}
            />
            <MetricCard
              label="Open Interest"
              value={metrics?.openInterest != null ? `$${(metrics.openInterest / 1e9).toFixed(2)}B` : '—'}
              sub="BTC notional open"
            />
            <MetricCard
              label="Long/Short Ratio"
              value={metrics?.longShortRatio != null ? metrics.longShortRatio.toFixed(2) : '—'}
              sub={metrics?.longAccountPct != null ? `Longs: ${(metrics.longAccountPct * 100).toFixed(1)}%` : undefined}
              color="text-slate-400"
            />
            <MetricCard
              label="Data Source"
              value={metricsLoading ? 'Refreshing…' : metrics?.source?.includes('Unavailable') ? 'Unavailable' : (metrics?.source ?? '—')}
              sub={metricsFetchedAt ? `Updated ${metricsFetchedAt}` : undefined}
              color="text-slate-400"
            />
          </div>
        )}

        {activeMetricTab === 'liquidations' && (
          <LiquidationsPanel />
        )}

        {activeMetricTab === 'signals' && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              This analysis reads only the price candles last loaded on the Chart tab (daily unless you changed the timeframe there): EMA trend, RSI and MACD momentum, volatility, and the moving-average regime. It does not use the funding, open-interest or liquidation data in the other two tabs. Toggle individual indicators on the chart to see their levels.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Trend</div>
                <div className={`text-lg font-bold ${!emaOk ? 'text-slate-400' : latestEMA20 > latestEMA50 ? 'text-green-400' : 'text-red-400'}`}>
                  {!emaOk ? '—' : latestEMA20 > latestEMA50 ? '↑ BULLISH TREND' : '↓ BEARISH TREND'}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {emaOk
                    ? `EMA20 $${latestEMA20.toLocaleString('en-US', { maximumFractionDigits: 0 })} · EMA50 $${latestEMA50.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                    : 'Need more candles'}
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Momentum</div>
                <div className={`text-lg font-bold ${!rsiOk ? 'text-slate-400' : latestRSI > 70 ? 'text-red-400' : latestRSI < 30 ? 'text-green-400' : 'text-slate-400'}`}>
                  {rsiOk ? (
                    <>RSI {latestRSI.toFixed(1)} — {latestRSI > 70 ? 'OVERBOUGHT' : latestRSI < 30 ? 'OVERSOLD' : 'NEUTRAL'}</>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  MACD Histogram: {macdOk ? (macdHist as number).toFixed(2) : '—'}
                </div>
              </div>
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Range position</div>
                <div className="text-lg font-bold text-slate-200">
                  {rangePosition != null ? `${(rangePosition * 100).toFixed(0)}%` : '—'}
                </div>
                {/* R2-241-2: no "$NaN–$NaN" when the range cannot be computed. */}
                {rangePosition != null && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    Of the last 20 {bars} closes&apos; low–high range (${low20.toLocaleString('en-US', { maximumFractionDigits: 0 })}–${high20.toLocaleString('en-US', { maximumFractionDigits: 0 })})
                  </div>
                )}
              </div>
              <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Volatility</div>
                <div className={`text-lg font-bold text-slate-400`}>
                  {bbPositionPct != null && Number.isFinite(bbPositionPct) ? `${bbPositionPct.toFixed(0)}%` : 'N/A'} BB Position
                </div>
                <div className="text-[10px] text-slate-400 mt-1">Upper: ${latestBB.upper?.toLocaleString('en-US', { maximumFractionDigits: 0 })} · Lower: ${latestBB.lower?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
              </div>
            </div>

            {/* 200-day MA deviation regime: a description of the distance and slope (Q-153) */}
            {ma200 != null && Number.isFinite(latestClose) && (
              <div className="rounded-xl border p-4 mt-2" style={{ borderColor: regime.color + '55', backgroundColor: regime.color + '0d' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: regime.color }}>
                      {daily ? '200-Day MA Regime' : `200-bar MA regime (${bars} bars)`}
                    </div>
                    <div className="text-xl font-bold" style={{ color: daily ? regime.color : undefined }}>
                      {daily ? regime.label : `${regime.deviationPct != null && regime.deviationPct >= 0 ? 'Above' : 'Below'} the 200-bar average`}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {ma200 != null ? `${daily ? '200DMA' : '200-bar MA'}: $${ma200.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}
                      {regime.deviationPct != null ? ` · Deviation: ${regime.deviationPct > 0 ? '+' : ''}${regime.deviationPct.toFixed(1)}%` : ''}
                      {regime.slopePct != null && (
                        // The direction is the SIGN of the measured change, and the
                        // change is over 20 bars (sma200Slope). The card used to
                        // print the classifier's boolean (slope > 0.5%) as the
                        // direction and the number as "%/bar", so an average up
                        // 0.16% over 20 bars read "falling (+0.1649%/bar)".
                        <span className="ml-2">
                          {regime.slopePct > 0 ? '↗' : regime.slopePct < 0 ? '↘' : '→'} {daily ? '200DMA' : '200-bar MA'}{' '}
                          {regime.slopePct > 0 ? 'up' : regime.slopePct < 0 ? 'down' : 'flat'}{' '}
                          {`${regime.slopePct > 0 ? '+' : ''}${(regime.slopePct * 100).toFixed(2)}% over 20 bars`}
                        </span>
                      )}
                    </div>
                  </div>
                  {daily && (<div className={`text-sm font-bold px-3 py-1 rounded-full border ${regime.dipSignal === 'STRONG_DIP' ? 'bg-green-950/60 border-green-500/50 text-green-300' : regime.dipSignal === 'FALLING_KNIFE' ? 'bg-red-950/60 border-red-500/50 text-red-300' : 'bg-slate-900/60 border-slate-700 text-slate-300'}`}>
                    {DIP_SIGNAL_LABEL[regime.dipSignal]}
                  </div>)}
                </div>
                {daily && <p className="text-xs text-slate-400 mt-2 leading-relaxed">{regime.dipSignalExplained}</p>}
                {!daily && (
                  <p role="note" data-testid="regime-interval-caution" className="text-[11px] text-amber-300/90 mt-2">
                    The regime zones, dip classification and their notes are calibrated on daily candles, so on {bars} candles
                    they are not shown. This is a 200-bar average, not the 200-day moving average.
                  </p>
                )}
                {daily && <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] text-slate-400">
                  <div>
                    <span className="uppercase tracking-wide">Risk: </span>
                    <span className={regime.riskLevel === 'low' ? 'text-green-400' : regime.riskLevel === 'medium' ? 'text-amber-400' : 'text-red-400'}>{regime.riskLevel}</span>
                  </div>
                </div>}
              </div>
            )}
            {ma200 == null && (
              <div className="rounded-xl border border-slate-800 p-4 mt-2 bg-slate-900/40">
                <div className="text-sm text-slate-400">The 200-bar MA regime needs at least 200 {bars} candles — only {candles.length} are loaded.</div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Disclaimer */}
      <div className="text-center text-[10px] text-slate-400 max-w-2xl mx-auto space-y-1">
        <p>
          Indicators are simplified heuristics — not validated trading signals, not execution logic, and can disagree with other venues or
          professional systems. Funding is shown in exchange decimal form; always verify on the exchange before trading.
        </p>
        <p>Not financial advice. Past performance does not guarantee future results.</p>
      </div>
    </div>
  )
}
