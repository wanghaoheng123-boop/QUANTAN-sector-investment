'use client'

import { useState, useCallback, useRef, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { BtcCandle } from '@/lib/crypto'

/** Kraken WS v2 OHLC — public, no Binance (see docs.kraken.com/api/docs/websocket-v2/ohlc) */
const KRAKEN_WS_V2 = 'wss://ws.kraken.com/v2'
/** Kraken `interval` in minutes; null = no candle WS (e.g. monthly — use REST + poll only). */
const KRAKEN_OHLC_INTERVAL_MIN: Record<string, number | null> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
  '1M': null,
}

export interface UseBtcKlineWsOptions {
  activeRangeRef: MutableRefObject<string>
  candleCacheRef: MutableRefObject<Map<string, BtcCandle[]>>
  setCandles: Dispatch<SetStateAction<BtcCandle[]>>
}

export function useBtcKlineWs({ activeRangeRef, candleCacheRef, setCandles }: UseBtcKlineWsOptions) {
  const [wsConnected, setWsConnected] = useState(false)

  const klineWsRef = useRef<WebSocket | null>(null)
  const klineGenRef = useRef(0)
  const klineReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wsConnectedRef = useRef(false)

  useEffect(() => {
    wsConnectedRef.current = wsConnected
  }, [wsConnected])

  const disconnectKlineWs = useCallback(() => {
    klineGenRef.current += 1
    if (klineReconnectTimerRef.current) {
      clearTimeout(klineReconnectTimerRef.current)
      klineReconnectTimerRef.current = null
    }
    klineWsRef.current?.close()
    klineWsRef.current = null
    setWsConnected(false)
  }, [])

  const connectKlineWs = useCallback(
    (interval: string) => {
      if (klineReconnectTimerRef.current) {
        clearTimeout(klineReconnectTimerRef.current)
        klineReconnectTimerRef.current = null
      }

      klineGenRef.current += 1
      const gen = klineGenRef.current

      klineWsRef.current?.close()
      klineWsRef.current = null

      const intervalMin = KRAKEN_OHLC_INTERVAL_MIN[interval] ?? null
      if (intervalMin == null) {
        setWsConnected(false)
        return
      }

      const ws = new WebSocket(KRAKEN_WS_V2)
      klineWsRef.current = ws

      const applyCandle = (candle: BtcCandle) => {
        if (gen !== klineGenRef.current) return
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

        setCandles((prev) => {
          if (gen !== klineGenRef.current) return prev
          if (!prev?.length) return [candle]
          const last = prev[prev.length - 1]
          if (last.time === candle.time) return [...prev.slice(0, -1), candle]
          return [...prev, candle]
        })
      }

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            method: 'subscribe',
            params: {
              channel: 'ohlc',
              symbol: ['BTC/USD'],
              interval: intervalMin,
              snapshot: true,
            },
          })
        )
        setWsConnected(true)
      }

      ws.onmessage = (event) => {
        if (gen !== klineGenRef.current) return
        try {
          const msg = JSON.parse(event.data) as {
            channel?: string
            type?: string
            data?: Array<{
              interval_begin?: string
              open?: number
              high?: number
              low?: number
              close?: number
              volume?: number
            }>
          }
          if (msg.channel !== 'ohlc' || !Array.isArray(msg.data) || msg.data.length === 0) return
          const rows = msg.type === 'snapshot' ? msg.data.slice(-3) : msg.data
          for (const row of rows) {
            const begin = row.interval_begin
            if (!begin) continue
            const t = Math.floor(new Date(begin).getTime() / 1000)
            if (!Number.isFinite(t)) continue
            const candle: BtcCandle = {
              time: t,
              open: Number(row.open),
              high: Number(row.high),
              low: Number(row.low),
              close: Number(row.close),
              volume: Number(row.volume ?? 0),
            }
            applyCandle(candle)
          }
        } catch (err) {
          if (wsConnectedRef.current) {
            console.warn('[btc/kline-ws] frame parse failed', err)
          }
        }
      }

      ws.onerror = (event) => {
        console.warn('[btc/kline-ws] WebSocket error', event.type)
        setWsConnected(false)
      }
      ws.onclose = () => {
        setWsConnected(false)
        if (gen !== klineGenRef.current) return
        klineReconnectTimerRef.current = setTimeout(() => {
          klineReconnectTimerRef.current = null
          if (activeRangeRef.current !== interval) return
          connectKlineWs(activeRangeRef.current)
        }, 3000)
      }
    },
    [activeRangeRef, candleCacheRef, setCandles]
  )

  const clearKlineReconnectTimer = useCallback(() => {
    if (klineReconnectTimerRef.current) {
      clearTimeout(klineReconnectTimerRef.current)
      klineReconnectTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      klineGenRef.current += 1
      if (klineReconnectTimerRef.current) clearTimeout(klineReconnectTimerRef.current)
      klineWsRef.current?.close()
      klineWsRef.current = null
    }
  }, [])

  return { wsConnected, connectKlineWs, disconnectKlineWs, clearKlineReconnectTimer }
}
