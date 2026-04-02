'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'

const SEARCH_LIMIT = 40
const RECENT_SEARCHES_KEY = 'quantan_recent_searches'
const MAX_RECENT = 5

interface Quote {
  symbol: string
  shortname: string
  exchange: string
  typeDisp: string
}

function looksLikeDirectTicker(s: string): string | null {
  const t = s.trim().toUpperCase()
  if (t.length < 1 || t.length > 24) return null
  if (!/^[A-Z0-9^.\-=*]+$/.test(t)) return null
  return yahooSymbolFromParam(t)
}

function getRecentSearches(): Quote[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function addRecentSearch(quote: Quote): void {
  if (typeof window === 'undefined') return
  try {
    const recent = getRecentSearches().filter(r => r.symbol !== quote.symbol)
    const updated = [quote, ...recent].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {}
}

function removeRecentSearch(symbol: string): void {
  if (typeof window === 'undefined') return
  try {
    const recent = getRecentSearches().filter(r => r.symbol !== symbol)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent))
  } catch {}
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Quote[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<Quote[]>([])
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

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
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  useEffect(() => {
    const fetchResults = async () => {
      if (query.trim().length === 0) {
        setResults([])
        return
      }
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}`
        )
        const data = await res.json()
        if (!res.ok) {
          setFetchError(typeof data.error === 'string' ? data.error : 'Search request failed')
          setResults([])
          return
        }
        setResults(data.quotes || [])
        if ((data.quotes || []).length === 0 && data.error) {
          setFetchError(String(data.error))
        }
      } catch {
        setFetchError('Network error — try again')
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

  const handleSelectResult = useCallback((quote: Quote) => {
    addRecentSearch(quote)
    setRecentSearches(getRecentSearches())
    goToStock(quote.symbol)
  }, [goToStock])

  const handleRemoveRecent = useCallback((e: React.MouseEvent, symbol: string) => {
    e.stopPropagation()
    removeRecentSearch(symbol)
    setRecentSearches(getRecentSearches())
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const direct = looksLikeDirectTicker(query)
      if (direct) {
        goToStock(direct)
        return
      }
      if (results.length > 0) {
        handleSelectResult(results[0])
      }
    }
  }

  const showRecent = isOpen && query.trim().length === 0 && recentSearches.length > 0
  const showResults = isOpen && query.trim().length > 0

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <div className="absolute left-3 text-slate-500 pointer-events-none">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search name or symbol…"
          className="w-full bg-slate-900 border border-slate-800 rounded-md py-1.5 pl-9 pr-16 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
          aria-label="Search stocks and ETFs"
          autoComplete="off"
        />
        <div className="absolute right-2 flex items-center gap-1">
          {loading ? (
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : (
            <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 rounded">
              <span className="text-xs">⌘</span>K
            </kbd>
          )}
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-1 px-0.5">
        Up to {SEARCH_LIMIT} Yahoo results · symbol + Enter opens the stock page even if the list is empty
      </p>
      {fetchError && (
        <p className="text-[10px] text-amber-500/90 mt-1 px-0.5">{fetchError}</p>
      )}

      {showRecent && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-md shadow-xl overflow-hidden z-[100]"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider font-medium border-b border-slate-800">
            Recent Searches
          </div>
          <ul role="listbox" aria-label="Recent searches">
            {recentSearches.map((quote) => (
              <li key={quote.symbol}>
                <button
                  type="button"
                  onClick={() => handleSelectResult(quote)}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-800 transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg className="w-3.5 h-3.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white font-mono">{quote.symbol}</div>
                      <div className="text-xs text-slate-500 truncate max-w-[180px]">{quote.shortname}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveRecent(e, quote.symbol)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-white transition-all"
                    aria-label={`Remove ${quote.symbol} from recent searches`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showResults && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-md shadow-xl overflow-hidden z-[100] max-h-96 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
          aria-label="Search results"
        >
          {results.length > 0 ? (
            <ul>
              {results.map((quote) => (
                <li key={quote.symbol}>
                  <button
                    type="button"
                    onClick={() => handleSelectResult(quote)}
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
