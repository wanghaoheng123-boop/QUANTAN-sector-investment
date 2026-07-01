'use client'

import { memo } from 'react'
import dynamic from 'next/dynamic'
import CryptoChartBoundary from '@/components/crypto/CryptoChartBoundary'
import IndicatorPanel from '@/components/IndicatorPanel'
import type { BtcCandle } from '@/lib/crypto'
import type { ChartEmaKey, ChartVisKey } from '@/lib/chartEma'

const KLineChart = dynamic(() => import('@/components/KLineChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] bg-slate-800/20 rounded-xl flex items-center justify-center border border-slate-800/50">
      <span className="text-slate-500 text-sm font-mono">Loading chart…</span>
    </div>
  ),
})

const INDICATOR_PRESETS = [
  ['ema', 'EMA'],
  ['vwap', 'VWAP'],
  ['bb', 'BB'],
  ['fib', 'Fib'],
  ['all', 'All'],
] as const

const EMPTY_DARK_POOL_MARKERS: never[] = []
const EMPTY_NEWS_MARKERS: never[] = []
const BTC_CHART_COLOR = '#f7931a'

export interface BtcChartPanelProps {
  candles: BtcCandle[]
  loading: boolean
  fetchError: string | null
  restFallbackNote: string | null
  wsConnected: boolean
  activeRange: string
  indicatorConfig: Record<string, boolean>
  activeIndicator: string
  onIndicatorPresetChange: (preset: string) => void
  vis: Record<ChartVisKey, boolean>
  onVisToggle: (key: ChartVisKey) => void
}

function BtcChartPanel({
  candles,
  loading,
  fetchError,
  restFallbackNote,
  wsConnected,
  activeRange,
  indicatorConfig,
  activeIndicator,
  onIndicatorPresetChange,
  vis,
  onVisToggle,
}: BtcChartPanelProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
      <div className="xl:col-span-3">
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white">BTC · multi-source chart</span>
              <span className="text-[10px] text-amber-400/60 font-mono border border-amber-400/20 px-1.5 py-0.5 rounded">
                {wsConnected ? 'KLINE WSS' : 'REST + POLL'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
              <span>{activeRange.toUpperCase()} BARS</span>
              <span>{candles.length} candles</span>
            </div>
          </div>
          {restFallbackNote && !fetchError && (
            <div className="mb-3 rounded-lg border border-cyan-500/25 bg-cyan-950/15 px-3 py-2 text-[11px] text-cyan-100/90">
              <span className="font-medium text-cyan-200/90">REST fallback</span>
              <p className="text-cyan-100/75 leading-relaxed mt-0.5">{restFallbackNote}</p>
            </div>
          )}
          {fetchError && (
            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90 space-y-1">
              <div className="font-medium text-amber-100">REST data unavailable</div>
              <p className="text-amber-200/80 leading-relaxed">{fetchError}</p>
            </div>
          )}
          {loading && candles.length === 0 ? (
            <div className="h-[480px] bg-slate-800/20 rounded-xl animate-pulse flex flex-col items-center justify-center border border-slate-800/50">
              <span className="text-slate-500 text-sm font-mono mb-2">Loading market data…</span>
            </div>
          ) : candles.length > 0 ? (
            <CryptoChartBoundary title="BTC chart crashed">
              <KLineChart
                candles={candles}
                darkPoolMarkers={EMPTY_DARK_POOL_MARKERS}
                newsMarkers={EMPTY_NEWS_MARKERS}
                color={BTC_CHART_COLOR}
                ticker="BTC"
                range={activeRange}
                hideTimeframeSelector
                showRSI
                indicators={indicatorConfig}
              />
            </CryptoChartBoundary>
          ) : (
            <div className="h-[480px] bg-slate-800/10 rounded-xl flex flex-col items-center justify-center gap-2 border border-dashed border-slate-800 px-6 text-center">
              <span className="text-slate-500 text-sm">No candle data yet</span>
              <span className="text-[11px] text-slate-400 max-w-md">
                If this persists, open DevTools → Network, reload, and check{' '}
                <code className="text-slate-500">/api/crypto/btc</code> (should be 200 with a{' '}
                <code className="text-slate-500">candles</code> array). Disable VPN or try another network if all
                exchanges time out.
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="xl:col-span-1 space-y-4">
        <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {INDICATOR_PRESETS.map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => onIndicatorPresetChange(val)}
              aria-pressed={activeIndicator === val}
              className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${
                activeIndicator === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <IndicatorPanel
          vis={vis}
          onToggle={(key) => onVisToggle(key as ChartVisKey)}
          title="Chart Indicators"
        />
      </div>
    </div>
  )
}

export default memo(BtcChartPanel)
