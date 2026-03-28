'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export default function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data.quotes || [])
      } catch (e) {
        console.error('Search error', e)
        setResults([])
      } finally {
        setLoading(false)
      }
    }

    const timeoutId = setTimeout(fetchResults, 300)
    return () => clearTimeout(timeoutId)
  }, [query])

  const handleSelect = (symbol: string) => {
    setIsOpen(false)
    setQuery('')
    router.push(`/stock/${symbol}`)
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-xs">
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
          placeholder="Search stocks, ETFs, indices..."
          className="w-full bg-slate-900 border border-slate-800 rounded-md py-1.5 pl-9 pr-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
        />
        {loading && (
          <div className="absolute right-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {isOpen && query.trim().length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-800 rounded-md shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          {results.length > 0 ? (
            <ul>
              {results.map((quote, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => handleSelect(quote.symbol)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-800 transition-colors flex items-center justify-between border-b border-slate-800/50 last:border-0"
                  >
                    <div>
                      <div className="text-sm font-bold text-white mb-0.5">{quote.symbol}</div>
                      <div className="text-xs text-slate-400 truncate w-48">{quote.shortname}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono text-slate-500">{quote.typeDisp}</div>
                      <div className="text-[10px] text-slate-600 uppercase">{quote.exchange}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : !loading && (
            <div className="px-4 py-3 text-sm text-slate-400 text-center">
              No results found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
