'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { apiUrl } from '@/lib/apiBase'
import {
  snapshotFromCoinbaseTicker,
  snapshotFromCoinGecko,
  snapshotFromQuoteRoute,
  hasFreshVendorPrice,
  type BtcPriceFeed,
  type BtcPriceSnapshot,
} from '@/lib/btcSnapshot'

export type { BtcPriceFeed, BtcPriceSnapshot }

const COINBASE_WS = 'wss://ws-feed.exchange.coinbase.com'

export function useBtcPriceWs() {
  const [btcPrice, setBtcPrice] = useState<BtcPriceSnapshot | null>(null)
  const [feed, setFeed] = useState<BtcPriceFeed | null>(null)

  const priceWsRef = useRef<WebSocket | null>(null)
  const priceReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const parseWarnedRef = useRef(false)
  const lastFreshWsPriceRef = useRef(Date.now())

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
          const receivedAt = Date.now()
          const nextFeed: BtcPriceFeed = { source: 'coinbase', receivedAt, quoteTime: snapshot.quoteTime }
          // Transport activity is not a fresh quote: replayed or undated ticks
          // must not suppress the fallback forever while the badge says STALE.
          if (hasFreshVendorPrice(nextFeed, receivedAt)) lastFreshWsPriceRef.current = receivedAt
          setBtcPrice(snapshot)
          setFeed(nextFeed)
        }
      } catch (err) {
        if (!parseWarnedRef.current) {
          parseWarnedRef.current = true
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
    // Red-team F1: the fallback runs whenever the socket has been silent for
    // 120 s without a fresh vendor-dated price — it used to be switched off
    // for good by the first socket tick, so a feed that died froze the price.
    const loadRestQuote = async () => {
      if (cancelled) return
      try {
        const r = await fetch(apiUrl('/api/crypto/btc/quote'), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (cancelled) return
        if (r.ok) {
          const snapshot = snapshotFromQuoteRoute(await r.json())
          if (cancelled) return
          if (snapshot) {
            setBtcPrice(snapshot)
            setFeed({ source: 'quote-route', receivedAt: Date.now(), quoteTime: snapshot.quoteTime })
          }
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
        if (snapshot) {
          setBtcPrice(snapshot)
          setFeed({ source: 'coingecko', receivedAt: Date.now(), quoteTime: snapshot.quoteTime })
        }
      } catch (err) {
        if (cancelled) return
        console.warn('[btc] REST quote fallback failed', err)
      }
    }
    const t = setTimeout(() => {
      if (Date.now() - lastFreshWsPriceRef.current > 120_000) loadRestQuote()
    }, 120_000)
    const iv = setInterval(() => {
      if (Date.now() - lastFreshWsPriceRef.current > 120_000) loadRestQuote()
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

  return { btcPrice, feed }
}
