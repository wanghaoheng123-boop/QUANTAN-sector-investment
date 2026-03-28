'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const SEARCH_LIMIT = 40

/** Rough ticker pattern: AAPL, BRK-B, ^VIX, GC=F */
function looksLikeDirectTicker(s: string): string | null {
  const t = s.trim().toUpperCase()
  if (t.length < 1 || t.length > 20) return null
  if (!/^[A-Z0-9^.\-=*]+$/.test(t)) return null
  return t
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<
    { symbol: string; shortname: string; exchange: string; typeDisp: string }[]
  >([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const fetchResults = async () => {
      if (query.trim().length === 0) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`
        )
        const data = await res.json()
        setResults(data.quotes || [])
      } catch (e) {
        console.error('Search error', e)
        setResults([])
      } finally {
        setLoading(false)
      }
    }

    const timeoutId = setTimeout(fetchResults, 280)
    return () => clearTimeout(timeoutId)
  }, [query])

  const goToStock = useCallback(
    (symbol: string) => {
      setIsOpen(false)
      setQuery('')
      router.push(`/stock/${encodeURIComponent(symbol)}`)
    },
    [router]
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const direct = looksLikeDirectTicker(query)
    if (direct) {
      goToStock(direct)
      return
    }
    if (results.length > 0) {
      goToStock(results[0].symbol)
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <div className="absolute left-3 text-slate-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search name or symbol (Enter = open)…"
          className="w-full bg-slate-900 border border-slate-800 rounded-md py-1.5 pl-9 pr-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          aria-label="Search stocks and ETFs"
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate-600 mt-1 px-0.5">
        Up to {SEARCH_LIMIT} Yahoo results · type a ticker (e.g. AAPL) and press Enter to open Quant Lab
      </p>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-md shadow-xl overflow-hidden z-50 max-h-96 overflow-y-auto">
          {results.length > 0 ? (
            <ul>
              {results.map((quote) => (
                <li key={quote.symbol}>
                  <button
                    type="button"
                    onClick={() => goToStock(quote.symbol)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-800 transition-colors flex items-center justify-between border-b border-slate-800/50 last:border-0"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="text-sm font-bold text-white mb-0.5 font-mono">{quote.symbol}</div>
                      <div className="text-xs text-slate-400 truncate max-w-[200px] sm:max-w-xs">{quote.shortname}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono text-slate-500">{quote.typeDisp}</div>
                      <div className="text-[10px] text-slate-600 uppercase truncate max-w-[100px]">{quote.exchange}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : !loading && (
            <div className="px-4 py-3 text-sm text-slate-400 text-center space-y-1">
              <p>No Yahoo matches. Try a symbol (e.g. MSFT) and press Enter.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
