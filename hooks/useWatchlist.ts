'use client'

import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useState } from 'react'
import { canonicalizeTickerCase } from '@/lib/tickerNormalize'

const GUEST_KEY = 'ag-watchlist-guest'
const MAX_ITEMS = 64

function safeParse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string').map((s) => canonicalizeTickerCase(s))
  } catch (err) {
    // Phase 14 wave 24: corrupted localStorage entry. Logging makes the
    // condition diagnosable instead of silently resetting the watchlist.
    console.warn('[useWatchlist] safeParse: corrupted localStorage entry', err)
    return []
  }
}

export function useWatchlist() {
  const { data: session, status } = useSession()
  const storageKey =
    status === 'authenticated' && session?.user?.email
      ? `ag-watchlist-${session.user.email}`
      : GUEST_KEY

  const [items, setItems] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(false)
    try {
      setItems(safeParse(typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null))
    } catch (err) {
      // Phase 14 wave 24: localStorage.getItem can throw in some sandbox /
      // disabled-storage environments. Falls back to empty list and logs.
      console.warn('[useWatchlist] hydrate failed', err)
      setItems([])
    }
    setHydrated(true)
  }, [storageKey])

  const persist = useCallback(
    (next: string[]) => {
      const capped = Array.from(new Set(next.map((t) => canonicalizeTickerCase(t)))).slice(0, MAX_ITEMS)
      setItems(capped)
      try {
        localStorage.setItem(storageKey, JSON.stringify(capped))
      } catch (err) {
        // Phase 14 wave 24: QuotaExceededError (private/incognito mode or
        // exceeded 5–10 MB quota). The in-memory state survives; only the
        // persistence step fails. Surfaced via warn for diagnosability.
        console.warn('[useWatchlist] persist failed', err)
      }
    },
    [storageKey]
  )

  const toggle = useCallback(
    (ticker: string) => {
      const u = canonicalizeTickerCase(ticker)
      if (items.includes(u)) persist(items.filter((x) => x !== u))
      else persist([...items, u])
    },
    [items, persist]
  )

  const remove = useCallback(
    (ticker: string) => {
      const u = canonicalizeTickerCase(ticker)
      persist(items.filter((x) => x !== u))
    },
    [items, persist]
  )

  const has = useCallback((ticker: string) => items.includes(canonicalizeTickerCase(ticker)), [items])

  return { items, toggle, remove, has, hydrated, storageKey, isGuest: storageKey === GUEST_KEY }
}
