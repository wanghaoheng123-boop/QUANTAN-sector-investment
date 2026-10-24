'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { apiUrl } from '@/lib/apiBase'
import {
  snapshotFromCoinbaseTicker,
  snapshotFromCoinGecko,
  snapshotFromQuoteRoute,
  type BtcPriceSnapshot,
} from '@/lib/btcSnapshot'

export type { BtcPriceSnapshot }

const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com'

export function useBtcPriceWs() {
  const [btcPrice, setBtcPrice] = useState<BtcPriceSnapshot | null>(null)

  const priceWsRef = useRef<WebSocket | null>(null)
  const priceReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const priceFromBinanceWsRef = useRef(false)
  const lastWsMessageRef = useRef(Date.now())

  const connectPriceWs = useCallback(() => {
    if (priceReconnectTimerRef.current) {
      clearTimeout(priceReconnectTimerRef.current)
      priceReconnectTimerRef.current = null
    }

    priceWsRef.current?.close()

    const ws = new WebSocket(COINBASE_WS)
    priceWsRef.current = ws
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: ['BTC-USD'],
          channels: ['ticker'],
        })
      )
    }
    ws.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data) as Record<string, unknown>
        if (d.type === 'ticker' && d.product_id === 'BTC-USD') {
          const snapshot = snapshotFromCoinbaseTicker(d)
          if (!snapshot) return
          priceFromBinanceWsRef.current = true
          lastWsMessageRef.current = Date.now()
          setBtcPrice(snapshot)
        }
      } catch (err) {
        if (!priceFromBinanceWsRef.current) {
          console.warn('[btc/price-ws] message parse failed', err)
        }
      }
    }
    ws.onerror = (event) => {
      console.warn('[btc/price-ws] WebSocket error event', event.type)
    }
    ws.onclose = () => {
      priceReconnectTimerRef.current = setTimeout(() => {
        priceReconnectTimerRef.current = null
        connectPriceWs()
      }, 5000)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadRestQuote = async () => {
      if (priceFromBinanceWsRef.current || cancelled) return
      try {
        const r = await fetch(apiUrl('/api/crypto/btc/quote'), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (cancelled) return
        if (r.ok) {
          const snapshot = snapshotFromQuoteRoute(await r.json())
          if (cancelled) return
          if (snapshot) setBtcPrice(snapshot)
          return
        }
        const cg = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
          { cache: 'no-store' }
        )
        if (cancelled) return
        if (!cg.ok) return
        const snapshot = snapshotFromCoinGecko(await cg.json())
        if (cancelled) return
        if (snapshot) setBtcPrice(snapshot)
      } catch (err) {
        if (cancelled) return
        console.warn('[btc] REST quote fallback failed', err)
      }
    }
    const t = setTimeout(() => {
      if (Date.now() - lastWsMessageRef.current > 120_000) loadRestQuote()
    }, 120_000)
    const iv = setInterval(() => {
      if (Date.now() - lastWsMessageRef.current > 120_000) loadRestQuote()
    }, 60_000)
    return () => {
      cancelled = true
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [])

  useEffect(() => {
    connectPriceWs()
    return () => {
      if (priceReconnectTimerRef.current) clearTimeout(priceReconnectTimerRef.current)
      priceReconnectTimerRef.current = null
      if (priceWsRef.current) {
        priceWsRef.current.onclose = null
        priceWsRef.current.close()
        priceWsRef.current = null
      }
    }
  }, [connectPriceWs])

  return { btcPrice }
}
