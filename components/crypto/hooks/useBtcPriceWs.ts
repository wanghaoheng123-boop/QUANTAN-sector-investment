'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { apiUrl } from '@/lib/apiBase'

const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com'

export type BtcPriceSnapshot = {
  price: number
  change24h: number
  changePct24h: number
  high24h: number
  low24h: number
  volume24h: number
}

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
          const price = parseFloat(String(d.price))
          if (!Number.isFinite(price) || price <= 0) return
          priceFromBinanceWsRef.current = true
          lastWsMessageRef.current = Date.now()
          const open24 = parseFloat(String(d.open_24h ?? '0'))
          const chg = open24 > 0 ? price - open24 : 0
          const chgPct = open24 > 0 ? ((price - open24) / open24) * 100 : 0
          setBtcPrice({
            price,
            change24h: chg,
            changePct24h: chgPct,
            high24h: parseFloat(String(d.high_24h)) || price,
            low24h: parseFloat(String(d.low_24h)) || price,
            volume24h: parseFloat(String(d.volume_24h)) || 0,
          })
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
          const d = (await r.json()) as {
            price?: number
            change24h?: number
            changePct24h?: number
            high24h?: number
            low24h?: number
            volume24h?: number
          }
          if (cancelled) return
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
        const cg = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
          { cache: 'no-store' }
        )
        if (cancelled) return
        if (!cg.ok) return
        const q = (await cg.json()) as { bitcoin?: { usd?: number; usd_24h_change?: number; usd_24h_vol?: number } }
        if (cancelled) return
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
      priceWsRef.current?.close()
      priceWsRef.current = null
    }
  }, [connectPriceWs])

  return { btcPrice }
}
