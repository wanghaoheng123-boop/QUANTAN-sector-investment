'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'
import type { BtcCandle } from '@/lib/crypto'

const KLineChart = dynamic(() => import('@/components/KLineChart'), { ssr: false })

// Binance WebSocket streams (wss — secure, public, no API keys)
const PRICE_WS = 'wss://stream.binance.com:9443/ws/btcusdt@ticker'
const KLINE_WS = (interval: string) =>
  `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_${interval}`

const TIMEFRAMES = [
  ['5m', '5m'], ['15m', '15m'], ['1h', '1H'], ['4h', '4H'],
  ['1d', '1D'], ['1w', '1W'], ['1M', '1M'],
] as const
const INDICATOR_PRESETS = [
  ['ema', 'EMA'], ['vwap', 'VWAP'], ['bb', 'BB'], ['fib', 'Fib'], ['all', 'All'],
] as const

export default function BtcPage() {
  const [candles, setCandles] = useState<BtcCandle[]>([])
  const [activeTab, setActiveTab] = useState<'chart' | 'quant'>('chart')
  const [activeRange, setActiveRange] = useState<string>('1d')
  const [activeIndicator, setActiveIndicator] = useState<string>('ema')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [btcPrice, setBtcPrice] = useState<{
    price: number; change24h: number; changePct24h: number; high24h: number; low24h: number; volume24h: number
  } | null>(null)
  const [wsConnected, setWsConnected] = useState(false)

  const candleCacheRef = useRef<Map<string, BtcCandle[]>>(new Map())
  const priceWsRef = useRef<WebSocket | null>(null)
  const klineWsRef = useRef<WebSocket | null>(null)
  /** Bumps on each new kline subscription — ignore stale onmessage from closed sockets */
  const klineGenRef = useRef(0)
  const klineReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const priceReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Always the interval the user selected (fixes reconnect after timeframe change) */
  const activeRangeRef = useRef(activeRange)

  useEffect(() => {
    activeRangeRef.current = activeRange
  }, [activeRange])

  const indicatorConfig = useMemo(() => {
    if (activeIndicator === 'all') return { ema20: true, ema50: true, vwap: true, bollingerBands: true, fibonacci: true }
    if (activeIndicator === 'ema') return { ema20: true, ema50: true, vwap: false, bollingerBands: false, fibonacci: false }
    if (activeIndicator === 'vwap') return { ema20: false, ema50: false, vwap: true, bollingerBands: false, fibonacci: false }
    if (activeIndicator === 'bb') return { ema20: false, ema50: false, vwap: false, bollingerBands: true, fibonacci: false }
    return { ema20: false, ema50: false, vwap: false, bollingerBands: false, fibonacci: true }
  }, [activeIndicator])

  const fetchCandles = useCallback((interval: string) => {
    setFetchError(null)
    const cached = candleCacheRef.current.get(interval)
    if (cached?.length) {
      setCandles(cached)
      setLoading(false)
    }

    setLoading(true)
    fetch(`/api/crypto/btc?interval=${encodeURIComponent(interval)}&limit=500`)
      .then(async r => {
        if (!r.ok) {
          const t = await r.text().catch(() => '')
          throw new Error(t || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then(data => {
        if (data.candles?.length) {
          candleCacheRef.current.set(interval, data.candles)
          setCandles(data.candles)
        } else {
          setFetchError(data.error || 'No candle data returned')
        }
      })
      .catch(err => {
        console.error('[BTC] fetch candles', err)
        setFetchError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  const connectKlineWs = useCallback((interval: string) => {
    if (klineReconnectTimerRef.current) {
      clearTimeout(klineReconnectTimerRef.current)
      klineReconnectTimerRef.current = null
    }

    klineGenRef.current += 1
    const gen = klineGenRef.current

    klineWsRef.current?.close()
    klineWsRef.current = null

    const ws = new WebSocket(KLINE_WS(interval))
    klineWsRef.current = ws

    ws.onmessage = event => {
      if (gen !== klineGenRef.current) return

      try {
        const msg = JSON.parse(event.data)
        const k = msg.data?.k
        if (!k) return

        const candle: BtcCandle = {
          time: Math.floor(Number(k.t) / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        }
        if ([candle.open, candle.high, candle.low, candle.close].some(Number.isNaN)) return

        const cacheKey = activeRangeRef.current
        const prevCached = candleCacheRef.current.get(cacheKey) ?? []
        const nextCached =
          prevCached.length === 0
            ? [candle]
            : prevCached[prevCached.length - 1].time === candle.time
              ? [...prevCached.slice(0, -1), candle]
              : [...prevCached, candle]
        candleCacheRef.current.set(cacheKey, nextCached)

        setCandles(prev => {
          if (gen !== klineGenRef.current) return prev
          if (!prev?.length) return [candle]
          const last = prev[prev.length - 1]
          if (last.time === candle.time) return [...prev.slice(0, -1), candle]
          return [...prev, candle]
        })
      } catch {
        /* ignore malformed frames */
      }
    }

    ws.onopen = () => setWsConnected(true)
    ws.onerror = () => setWsConnected(false)
    ws.onclose = () => {
      setWsConnected(false)
      if (gen !== klineGenRef.current) return
      klineReconnectTimerRef.current = setTimeout(() => {
        klineReconnectTimerRef.current = null
        if (activeRangeRef.current !== interval) return
        connectKlineWs(activeRangeRef.current)
      }, 3000)
    }
  }, [])

  const connectPriceWs = useCallback(() => {
    if (priceReconnectTimerRef.current) {
      clearTimeout(priceReconnectTimerRef.current)
      priceReconnectTimerRef.current = null
    }

    priceWsRef.current?.close()
    const ws = new WebSocket(PRICE_WS)
    priceWsRef.current = ws

    ws.onmessage = event => {
      try {
        const d = JSON.parse(event.data)
        if (d.lastPrice) {
          setBtcPrice({
            price: parseFloat(d.lastPrice),
            change24h: parseFloat(d.priceChange),
            changePct24h: parseFloat(d.priceChangePercent),
            high24h: parseFloat(d.highPrice),
            low24h: parseFloat(d.lowPrice),
            volume24h: parseFloat(d.volume),
          })
        }
      } catch {
        /* ignore */
      }
    }

    ws.onerror = () => {}
    ws.onclose = () => {
      priceReconnectTimerRef.current = setTimeout(() => {
        priceReconnectTimerRef.current = null
        connectPriceWs()
      }, 5000)
    }
  }, [])

  useEffect(() => {
    fetchCandles(activeRange)
    connectKlineWs(activeRange)
    connectPriceWs()

    return () => {
      if (klineReconnectTimerRef.current) clearTimeout(klineReconnectTimerRef.current)
      if (priceReconnectTimerRef.current) clearTimeout(priceReconnectTimerRef.current)
      priceWsRef.current?.close()
      klineWsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab !== 'chart') return
    fetchCandles(activeRange)
    connectKlineWs(activeRange)
  }, [activeRange, activeTab, fetchCandles, connectKlineWs])

  const isUp = (btcPrice?.changePct24h ?? 0) >= 0
  const color = '#f7931a'

  return (
    <div className="min-h-screen">
      <div className="border-b border-slate-800 py-6" style={{ background: 'linear-gradient(180deg, #f7931a08 0%, transparent 100%)' }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold text-white bg-[#f7931a20] border border-[#f7931a40]">
                ₿
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">Markets</Link>
                  <span className="text-slate-700 text-xs">/</span>
                  <span className="text-xs text-slate-400">Crypto</span>
                </div>
                <h1 className="text-2xl font-bold text-white tracking-wide">Bitcoin (BTC)</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  BTC/USDT · Binance · Real-time WebSocket stream
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {wsConnected && (
                <div className="flex items-center gap-1.5 bg-green-500/10 px-2 py-1 rounded-md border border-green-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[10px] text-green-400 font-medium">LIVE</span>
                </div>
              )}
              {!wsConnected && (
                <div className="flex items-center gap-1.5 bg-slate-800/50 px-2 py-1 rounded-md border border-slate-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                  <span className="text-[10px] text-slate-400 font-medium">RECONNECTING</span>
                </div>
              )}
            </div>

            <div className="flex items-start gap-4 flex-wrap">
              {btcPrice ? (
                <div className="text-right">
                  <div className="text-2xl font-bold text-white font-mono">
                    ${btcPrice.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {isUp ? '▲' : '▼'} {Math.abs(btcPrice.changePct24h).toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-600 mt-1 font-mono">
                    H${btcPrice.high24h.toLocaleString('en-US', { maximumFractionDigits: 0 })} · L${btcPrice.low24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-right w-36">
                  <div className="h-7 bg-slate-800 rounded animate-pulse" />
                  <div className="h-5 bg-slate-800 rounded animate-pulse" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
            {([['chart', 'Chart'], ['quant', 'Quant Lab']] as const).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'chart' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {TIMEFRAMES.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setActiveRange(val)}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeRange === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {INDICATOR_PRESETS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setActiveIndicator(val)}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeIndicator === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'chart' ? (
          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white">BTC/USDT · Binance</span>
                <span className="text-[10px] text-amber-400/60 font-mono border border-amber-400/20 px-1.5 py-0.5 rounded">WSS LIVE</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                <span>{activeRange.toUpperCase()} BARS</span>
                <span>{candles.length} candles</span>
              </div>
            </div>
            {fetchError && (
              <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90">
                REST: {fetchError}
              </div>
            )}
            {loading && candles.length === 0 ? (
              <div className="h-[480px] bg-slate-800/20 rounded-xl animate-pulse flex flex-col items-center justify-center border border-slate-800/50">
                <span className="text-slate-500 text-sm font-mono mb-2">Connecting to Binance...</span>
              </div>
            ) : candles.length > 0 ? (
              <KLineChart
                candles={candles as any}
                darkPoolMarkers={[]}
                newsMarkers={[]}
                color={color}
                ticker="BTC"
                range={activeRange}
                showRSI
                indicators={indicatorConfig}
              />
            ) : (
              <div className="h-[480px] bg-slate-800/10 rounded-xl flex items-center justify-center border border-dashed border-slate-800">
                <span className="text-slate-600 text-sm">No BTC data available from Binance</span>
              </div>
            )}
          </div>
        ) : (
          <BtcQuantLab candles={candles} />
        )}

        <div className="text-center text-[10px] text-slate-700">
          Data sourced from Binance Public API via WebSocket (real-time) and REST (historical). Prices are indicative.
        </div>
      </div>
    </div>
  )
}
