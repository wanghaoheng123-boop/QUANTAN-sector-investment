'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'
import CryptoChartBoundary from '@/components/crypto/CryptoChartBoundary'
import type { BtcCandle } from '@/lib/crypto'
import { apiUrl } from '@/lib/apiBase'
import { normalizeBtcCandles } from '@/lib/normalizeBtcCandles'
import type { ChartEmaKey } from '@/lib/chartEma'
import { CHART_EMA_PERIODS } from '@/lib/chartEma'

const KLineChart = dynamic(() => import('@/components/KLineChart'), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] bg-slate-800/20 rounded-xl flex items-center justify-center border border-slate-800/50">
      <span className="text-slate-500 text-sm font-mono">Loading chart…</span>
    </div>
  ),
})

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

function coingeckoDaysParam(interval: string): number | 'max' {
  switch (interval) {
    case '5m':
    case '15m':
      return 1
    case '1h':
      return 7
    case '4h':
      return 30
    case '1d':
      return 365
    case '1w':
    case '1M':
      return 'max'
    default:
      return 365
  }
}

async function fetchCoinGeckoCandlesClient(
  interval: string,
  limit: number,
  signal: AbortSignal
): Promise<BtcCandle[] | null> {
  const days = coingeckoDaysParam(interval)
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) return null
  const rows = (await res.json()) as unknown
  if (!Array.isArray(rows) || rows.length === 0) return null
  const slice = rows.slice(-Math.min(limit, rows.length))
  const out = slice
    .map((r) => {
      if (!Array.isArray(r) || r.length < 5) return null
      const t = Math.floor(Number(r[0]) / 1000)
      return {
        time: t,
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: 1,
      } as BtcCandle
    })
    .filter((x): x is BtcCandle => x !== null)
  return normalizeBtcCandles(out)
}

const defaultEmaSelection = (): Record<ChartEmaKey, boolean> => {
  const out: Partial<Record<ChartEmaKey, boolean>> = {}
  for (const p of CHART_EMA_PERIODS) {
    out[`ema${p}` as ChartEmaKey] = (p === 20 || p === 50) // default on: 20 & 50
  }
  return out as Record<ChartEmaKey, boolean>
}

/** Full EMA grid for "all indicators on/off" presets — must match every `ChartEmaKey`. */
function allEmaRecord(value: boolean): Record<ChartEmaKey, boolean> {
  const out: Partial<Record<ChartEmaKey, boolean>> = {}
  for (const p of CHART_EMA_PERIODS) {
    out[`ema${p}` as ChartEmaKey] = value
  }
  return out as Record<ChartEmaKey, boolean>
}

export default function BtcPage() {
  const [candles, setCandles] = useState<BtcCandle[]>([])
  const [activeTab, setActiveTab] = useState<'chart' | 'quant'>('chart')
  const [activeRange, setActiveRange] = useState<string>('1d')
  const [activeIndicator, setActiveIndicator] = useState<string>('ema')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  /** Set when REST uses Kraken fallback (Binance blocked or failed). */
  const [restFallbackNote, setRestFallbackNote] = useState<string | null>(null)
  const [emaSelection, setEmaSelection] = useState<Record<ChartEmaKey, boolean>>(defaultEmaSelection)
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
  /** True after Binance ticker WebSocket delivered a price — skip CoinGecko REST header quote. */
  const priceFromBinanceWsRef = useRef(false)
  /** Always the interval the user selected (fixes reconnect after timeframe change) */
  const activeRangeRef = useRef(activeRange)
  /** Invalidates in-flight REST responses when interval changes or unmounts. */
  const candlesRequestIdRef = useRef(0)
  const candlesAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    activeRangeRef.current = activeRange
  }, [activeRange])

  const indicatorConfig = useMemo(() => {
    const allEmasOn = (): Record<ChartEmaKey, boolean> => allEmaRecord(true)
    const allEmasOff = (): Record<ChartEmaKey, boolean> => allEmaRecord(false)
    if (activeIndicator === 'all') {
      return { ...allEmasOn(), vwap: true, bollingerBands: true, fibonacci: true }
    }
    if (activeIndicator === 'ema') {
      return { ...emaSelection, vwap: false, bollingerBands: false, fibonacci: false }
    }
    if (activeIndicator === 'vwap') {
      return { ...allEmasOff(), vwap: true, bollingerBands: false, fibonacci: false }
    }
    if (activeIndicator === 'bb') {
      return { ...allEmasOff(), vwap: false, bollingerBands: true, fibonacci: false }
    }
    return { ...allEmasOff(), vwap: false, bollingerBands: false, fibonacci: true }
  }, [activeIndicator, emaSelection])

  const fetchCandles = useCallback((interval: string) => {
    candlesAbortRef.current?.abort()
    const ac = new AbortController()
    candlesAbortRef.current = ac
    const reqId = ++candlesRequestIdRef.current

    setFetchError(null)
    const cached = candleCacheRef.current.get(interval)
    if (cached?.length) {
      setCandles(cached)
      setLoading(false)
    }

    setLoading(true)
    setRestFallbackNote(null)

    const url = `${apiUrl('/api/crypto/btc')}?interval=${encodeURIComponent(interval)}&limit=500`

    const parsePayload = async (r: Response): Promise<Record<string, unknown> | { _bad: true; msg: string }> => {
      const ct = r.headers.get('content-type') ?? ''
      const text = await r.text()
      if (!ct.includes('application/json')) {
        if (!text) return { _bad: true as const, msg: `Empty response (HTTP ${r.status})` }
        return { _bad: true as const, msg: `Non-JSON response (HTTP ${r.status}): ${text.slice(0, 200)}` }
      }
      try {
        return JSON.parse(text) as Record<string, unknown>
      } catch {
        return { _bad: true as const, msg: `Invalid JSON (HTTP ${r.status}): ${text.slice(0, 200)}` }
      }
    }

    const isBadPayload = (p: unknown): p is { _bad: true; msg: string } =>
      typeof p === 'object' && p !== null && '_bad' in p && (p as { _bad?: boolean })._bad === true

    ;(async () => {
      let lastErr: Error | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (ac.signal.aborted) return
        if (attempt > 0) await new Promise((r) => setTimeout(r, 350 * attempt))
        try {
          const r = await fetch(url, {
            signal: ac.signal,
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          })
          const payload = await parsePayload(r)
          if (isBadPayload(payload)) {
            lastErr = new Error(payload.msg)
            continue
          }
          const p = payload as {
            userMessage?: string
            error?: string
            details?: string
            candles?: BtcCandle[]
            note?: string
          }
          if (!r.ok) {
            let msg =
              typeof p.userMessage === 'string'
                ? p.userMessage
                : typeof p.error === 'string'
                  ? p.error
                  : typeof p.details === 'string'
                    ? p.details
                    : `HTTP ${r.status}`
            // Some deployments wrap backend errors as JSON string in `message`.
            if (typeof msg === 'string' && msg.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(msg) as { userMessage?: string; error?: string; details?: string }
                msg = parsed.userMessage ?? parsed.error ?? parsed.details ?? msg
              } catch {
                /* keep original string */
              }
            }
            lastErr = new Error(msg)
            if (r.status !== 429 && r.status < 500) break
            continue
          }
          if (reqId !== candlesRequestIdRef.current || ac.signal.aborted) return
          if (p.candles?.length) {
            const normalized = normalizeBtcCandles(p.candles as BtcCandle[])
            if (normalized.length === 0) {
              setFetchError('Received candles but none passed validation (check API payload).')
              return
            }
            candleCacheRef.current.set(interval, normalized)
            setCandles(normalized)
            setRestFallbackNote(typeof p.note === 'string' ? p.note : null)
            setFetchError(null)
          } else {
            setFetchError(typeof p.error === 'string' ? p.error : 'No candle data returned')
          }
          return
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return
          lastErr = err instanceof Error ? err : new Error(String(err))
        }
      }
      if (reqId !== candlesRequestIdRef.current || ac.signal.aborted) return
      try {
        const cg = await fetchCoinGeckoCandlesClient(interval, 500, ac.signal)
        if (reqId !== candlesRequestIdRef.current || ac.signal.aborted) return
        if (cg && cg.length > 0) {
          candleCacheRef.current.set(interval, cg)
          setCandles(cg)
          setRestFallbackNote(
            'Server API is unavailable in this region/network. Loaded OHLC directly from CoinGecko in the browser.'
          )
          setFetchError(null)
          return
        }
      } catch {
        /* ignore fallback failure */
      }
      setFetchError(lastErr?.message ?? 'Failed to load candles')
    })()
      .catch((err) => {
        console.error('[BTC] fetch candles', err)
        if (reqId === candlesRequestIdRef.current) {
          setFetchError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (reqId === candlesRequestIdRef.current) setLoading(false)
      })
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
        // Map#set must receive the new array — never pass a function (unlike React setState).
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
        const d = JSON.parse(event.data) as Record<string, unknown>
        // Raw ticker stream uses short keys (c/P/h/l/v), some gateways use verbose keys.
        const price = Number(d.lastPrice ?? d.c)
        if (Number.isFinite(price) && price > 0) {
          priceFromBinanceWsRef.current = true
          setBtcPrice({
            price,
            change24h: Number(d.priceChange ?? d.p) || 0,
            changePct24h: Number(d.priceChangePercent ?? d.P) || 0,
            high24h: Number(d.highPrice ?? d.h) || price,
            low24h: Number(d.lowPrice ?? d.l) || price,
            volume24h: Number(d.volume ?? d.v) || 0,
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

  /** When Binance WSS is blocked, show header price from CoinGecko via same-origin API. */
  useEffect(() => {
    const loadRestQuote = async () => {
      if (priceFromBinanceWsRef.current) return
      try {
        const r = await fetch(apiUrl('/api/crypto/btc/quote'), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (r.ok) {
          const d = (await r.json()) as {
            price?: number
            change24h?: number
            changePct24h?: number
            high24h?: number
            low24h?: number
            volume24h?: number
          }
          if (!d.price || !Number.isFinite(d.price)) return
          setBtcPrice({
            price: d.price,
            change24h: d.change24h ?? 0,
            changePct24h: d.changePct24h ?? 0,
            high24h: d.high24h ?? d.price,
            low24h: d.low24h ?? d.price,
            volume24h: d.volume24h ?? 0,
          })
          return
        }
        // Last-resort direct quote, independent of app API deployment.
        const cg = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
          { cache: 'no-store' }
        )
        if (!cg.ok) return
        const q = (await cg.json()) as { bitcoin?: { usd?: number; usd_24h_change?: number; usd_24h_vol?: number } }
        const p = Number(q.bitcoin?.usd)
        if (!Number.isFinite(p) || p <= 0) return
        setBtcPrice({
          price: p,
          change24h: 0,
          changePct24h: Number(q.bitcoin?.usd_24h_change) || 0,
          high24h: p,
          low24h: p,
          volume24h: Number(q.bitcoin?.usd_24h_vol) || 0,
        })
      } catch {
        /* ignore */
      }
    }
    const t = setTimeout(loadRestQuote, 4000)
    const iv = setInterval(loadRestQuote, 60_000)
    return () => {
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [])

  /** Binance ticker — one connection for the page lifetime. */
  useEffect(() => {
    connectPriceWs()
    return () => {
      if (priceReconnectTimerRef.current) clearTimeout(priceReconnectTimerRef.current)
      priceReconnectTimerRef.current = null
      priceWsRef.current?.close()
      priceWsRef.current = null
    }
  }, [connectPriceWs])

  /**
   * REST + kline when Chart tab is active only (avoids double-fetch / double-WS on mount).
   * Leaving Chart closes kline to reduce flaky duplicate streams.
   */
  useEffect(() => {
    if (activeTab !== 'chart') {
      klineGenRef.current += 1
      if (klineReconnectTimerRef.current) {
        clearTimeout(klineReconnectTimerRef.current)
        klineReconnectTimerRef.current = null
      }
      klineWsRef.current?.close()
      klineWsRef.current = null
      setWsConnected(false)
      return
    }
    fetchCandles(activeRange)
    connectKlineWs(activeRange)
    return () => {
      if (klineReconnectTimerRef.current) {
        clearTimeout(klineReconnectTimerRef.current)
        klineReconnectTimerRef.current = null
      }
    }
  }, [activeTab, activeRange, fetchCandles, connectKlineWs])

  useEffect(() => {
    return () => {
      candlesAbortRef.current?.abort()
      candlesRequestIdRef.current += 1
      klineGenRef.current += 1
      if (klineReconnectTimerRef.current) clearTimeout(klineReconnectTimerRef.current)
      klineWsRef.current?.close()
      klineWsRef.current = null
    }
  }, [])

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
                  BTC/USDT · Primary: CoinGecko · Fallbacks: Binance, Kraken · Live: Binance WebSocket
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
              {(activeIndicator === 'ema' || activeIndicator === 'all') && (
                <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                  <span className="text-[10px] text-slate-500 uppercase shrink-0">EMAs</span>
                  <div className="flex flex-wrap gap-0.5">
                    {CHART_EMA_PERIODS.map((p) => {
                      const key = `ema${p}` as ChartEmaKey
                      const on = activeIndicator === 'all' ? true : emaSelection[key]
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={activeIndicator === 'all'}
                          onClick={() =>
                            setEmaSelection((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-all ${
                            on
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                              : 'border-slate-700 text-slate-500 hover:border-slate-600'
                          } ${activeIndicator === 'all' ? 'opacity-60 cursor-not-allowed' : ''}`}
                          title={activeIndicator === 'all' ? 'All indicators on' : `Toggle EMA ${p}`}
                        >
                          {p}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
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
                <span className="text-slate-500 text-sm font-mono mb-2">Connecting to Binance...</span>
              </div>
            ) : candles.length > 0 ? (
              <CryptoChartBoundary title="BTC chart crashed">
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
              </CryptoChartBoundary>
            ) : (
              <div className="h-[480px] bg-slate-800/10 rounded-xl flex flex-col items-center justify-center gap-2 border border-dashed border-slate-800 px-6 text-center">
                <span className="text-slate-500 text-sm">No candle data yet</span>
                <span className="text-[11px] text-slate-600 max-w-md">
                  If this persists, open DevTools → Network, reload, and check <code className="text-slate-500">/api/crypto/btc</code> (should be 200 with a <code className="text-slate-500">candles</code> array). Disable VPN or try another network if all exchanges time out.
                </span>
              </div>
            )}
          </div>
        ) : (
          <BtcQuantLab candles={candles} />
        )}

        <div className="text-center text-[10px] text-slate-700 max-w-3xl mx-auto space-y-1">
          <p>
            Data sourced from CoinGecko (primary, no geo-blocking), Binance REST, Kraken, and Binance WebSocket. Geo-restriction messages mean the server region is blocked — not a bug.
          </p>
          <p>Prices are indicative.</p>
        </div>
      </div>
    </div>
  )
}
