'use client'

/**
 * useLivePrices — SWR hook for polling /api/prices at 5s intervals.
 *
 * Phase 12 Sprint 2 (D3): Real-time price refresh on detail pages.
 *
 * Why SWR not SSE:
 *   Vercel serverless function timeout caps at 30s, breaking long SSE streams.
 *   SWR with refreshInterval is reliable on Vercel and resumes cleanly after focus loss.
 *
 * Returns:
 *   data       — array of price quotes (live + previous)
 *   error      — error from last fetch (null if successful)
 *   isLoading  — true on first load (no data yet)
 *   isValidating — true during background refresh
 *   quoteTime  — Unix ms of latest data (newest of all quotes)
 *   refresh    — manual revalidate function
 *
 * Usage:
 *   const { data, quoteTime } = useLivePrices(['XLK', 'XLF', 'SPY'])
 *   <DataFreshnessIndicator quoteTime={quoteTime} />
 */

import useSWR, { type SWRConfiguration } from 'swr'
import { useMemo } from 'react'

/** Matches the response from /api/prices (route.ts). */
export interface LivePriceQuote {
  ticker: string
  price: number
  change: number
  changePct: number
  volume?: number
  high52w?: number
  low52w?: number
  pe?: number
  marketCap?: string
  quoteTime?: string | null
  /** Source attribution attached by mergeYahooAndBloomberg */
  dataSource?: 'yahoo' | 'bloomberg' | string
}

export interface LivePricesResponse {
  quotes: LivePriceQuote[]
  /** ISO timestamp when /api/prices completed the fetch */
  timestamp?: string
  dataSources?: {
    yahoo?: boolean
    bloombergBridge?: boolean
    bloombergTickers?: string[]
  }
}

const fetcher = async (url: string): Promise<LivePricesResponse> => {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`prices ${res.status}: ${text.slice(0, 120)}`)
  }
  return res.json()
}

const DEFAULT_OPTIONS: SWRConfiguration = {
  // Poll every 5s — institutional-acceptable for sector dashboards.
  refreshInterval: 5_000,
  // Phase 13 S2 fix (F5.8): dedup matches refresh interval. With dedup
  // < refresh, a third hook mount happening between two refresh ticks
  // would trigger an extra fetch. Setting dedup = refresh ensures all
  // mounts within the same refresh window share one network request.
  dedupingInterval: 5_000,
  // Don't re-fetch on tab focus — relies on the 5s interval instead.
  revalidateOnFocus: false,
  // Don't re-mount with stale data unnecessarily.
  revalidateOnReconnect: true,
  // Avoid cascading retries on persistent errors.
  errorRetryCount: 3,
  errorRetryInterval: 10_000,
  // Keep previous data visible while next fetch is in flight.
  keepPreviousData: true,
}

export function useLivePrices(
  tickers: string[],
  options: SWRConfiguration = {}
) {
  const cleanTickers = useMemo(
    () => Array.from(new Set(tickers.filter(t => typeof t === 'string' && t.length > 0))).sort(),
    [tickers]
  )
  const url = cleanTickers.length > 0
    ? `/api/prices?tickers=${encodeURIComponent(cleanTickers.join(','))}`
    : null

  const swr = useSWR<LivePricesResponse>(url, fetcher, { ...DEFAULT_OPTIONS, ...options })

  // Newest quoteTime across all quotes (Unix ms)
  const quoteTime = useMemo(() => {
    const quotes = swr.data?.quotes ?? []
    let max = 0
    for (const q of quotes) {
      if (q.quoteTime) {
        const t = Date.parse(q.quoteTime)
        if (Number.isFinite(t) && t > max) max = t
      }
    }
    // Fall back to the response's timestamp (when the fetch completed)
    if (max === 0 && swr.data?.timestamp) {
      const t = Date.parse(swr.data.timestamp)
      if (Number.isFinite(t)) max = t
    }
    return max > 0 ? max : null
  }, [swr.data])

  return {
    data: swr.data?.quotes ?? [],
    error: swr.error as Error | undefined,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    quoteTime,
    refresh: () => swr.mutate(),
  }
}

export default useLivePrices
