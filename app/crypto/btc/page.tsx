'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'
import BtcHeader from '@/components/crypto/BtcHeader'
import BtcTabBar from '@/components/crypto/BtcTabBar'
import BtcChartPanel from '@/components/crypto/BtcChartPanel'
import { useBtcCandles } from '@/components/crypto/hooks/useBtcCandles'
import { useBtcKlineWs } from '@/components/crypto/hooks/useBtcKlineWs'
import { useBtcPriceWs } from '@/components/crypto/hooks/useBtcPriceWs'
import {
  buildIndicatorConfig,
  btcDefaultEmaSelection,
  type ChartEmaKey,
  type ChartVisKey,
} from '@/lib/chartEma'

export default function BtcPage() {
  const [activeTab, setActiveTab] = useState<'chart' | 'quant'>('chart')
  const [activeRange, setActiveRange] = useState<string>('1d')
  const [activeIndicator, setActiveIndicator] = useState<string>('ema')
  const [emaSelection, setEmaSelection] = useState<Record<ChartEmaKey, boolean>>(btcDefaultEmaSelection)
  const [vis, setVis] = useState<Record<ChartVisKey, boolean>>(() => ({
    ...btcDefaultEmaSelection(),
    vwap: false,
    bollingerBands: false,
    fibonacci: false,
    volSma: true,
  }))

  const activeRangeRef = useRef(activeRange)
  useEffect(() => {
    activeRangeRef.current = activeRange
  }, [activeRange])

  const { candles, setCandles, loading, fetchError, restFallbackNote, fetchCandles, candleCacheRef } =
    useBtcCandles()

  const { wsConnected, connectKlineWs, disconnectKlineWs, clearKlineReconnectTimer } = useBtcKlineWs({
    activeRangeRef,
    candleCacheRef,
    setCandles,
  })

  const { btcPrice } = useBtcPriceWs()

  const indicatorConfig = useMemo(
    () => buildIndicatorConfig(activeIndicator, emaSelection, vis),
    [activeIndicator, emaSelection, vis]
  )

  const handleVisToggle = useCallback((key: ChartVisKey) => {
    setVis((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      return next
    })
    const emaMatch = /^ema(\d+)$/.exec(key)
    if (emaMatch) {
      setEmaSelection((prev) => ({ ...prev, [key]: !prev[key as ChartEmaKey] }))
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'chart') {
      disconnectKlineWs()
      return
    }
    fetchCandles(activeRange)
    connectKlineWs(activeRange)
    return () => {
      clearKlineReconnectTimer()
    }
  }, [activeTab, activeRange, fetchCandles, connectKlineWs, disconnectKlineWs, clearKlineReconnectTimer])

  useEffect(() => {
    if (activeTab !== 'chart') return
    const id = setInterval(() => {
      fetchCandles(activeRangeRef.current)
    }, 75_000)
    return () => clearInterval(id)
  }, [activeTab, fetchCandles])

  return (
    <div className="min-h-screen">
      <BtcHeader btcPrice={btcPrice} wsConnected={wsConnected} />

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <BtcTabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeRange={activeRange}
          onRangeChange={setActiveRange}
        />

        {activeTab === 'chart' ? (
          <BtcChartPanel
            candles={candles}
            loading={loading}
            fetchError={fetchError}
            restFallbackNote={restFallbackNote}
            wsConnected={wsConnected}
            activeRange={activeRange}
            indicatorConfig={indicatorConfig}
            onIndicatorsChange={setVis}
            activeIndicator={activeIndicator}
            onIndicatorPresetChange={setActiveIndicator}
            vis={vis}
            onVisToggle={handleVisToggle}
          />
        ) : (
          <BtcQuantLab candles={candles} />
        )}

        <div className="text-center text-[10px] text-slate-700 max-w-3xl mx-auto space-y-1">
          <p>
            Spot ticker from Coinbase. OHLC from CoinGecko, Kraken REST, or Coinbase candles. Live candles via Kraken
            WebSocket when a timeframe is supported (monthly uses REST only). Derivatives metrics from Bybit/OKX — not
            Binance.
          </p>
          <p>Prices are indicative.</p>
        </div>
      </div>
    </div>
  )
}
