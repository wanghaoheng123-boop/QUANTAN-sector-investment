'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import type { BtcCandle } from '@/lib/crypto'
import { apiUrl } from '@/lib/apiBase'
import { normalizeBtcCandles } from '@/lib/normalizeBtcCandles'

function coingeckoDaysParam(interval: string): number | 'max' {
  switch (interval) {
    case '1m':
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

export function useBtcCandles() {
  const [candles, setCandles] = useState<BtcCandle[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [restFallbackNote, setRestFallbackNote] = useState<string | null>(null)

  const candleCacheRef = useRef<Map<string, BtcCandle[]>>(new Map())
  const candlesRequestIdRef = useRef(0)
  const candlesAbortRef = useRef<AbortController | null>(null)

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
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('[btc/fallback] CoinGecko client fetch failed', err)
        }
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

  useEffect(() => {
    return () => {
      candlesAbortRef.current?.abort()
      candlesRequestIdRef.current += 1
    }
  }, [])

  return {
    candles,
    setCandles,
    loading,
    fetchError,
    restFallbackNote,
    fetchCandles,
    candleCacheRef,
  }
}
