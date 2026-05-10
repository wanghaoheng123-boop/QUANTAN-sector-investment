'use client'

import { useState, useEffect } from 'react'

// Compatible with both mock news (source/url/summary) and live news
interface NewsItem {
  title: string
  source?: string     // mock
  publisher?: string  // live
  url?: string        // mock
  link?: string       // live
  summary?: string    // mock
  snippet?: string    // live
  publishedAt?: string | null
  tickers?: string[]
}

interface NewsFeedProps {
  /** Sector slug — fetches live news when provided */
  sector?: string
  /** Static news array (mock or pre-fetched) */
  news?: NewsItem[]
  color: string
}

function getPublisher(item: NewsItem): string {
  return item.publisher ?? item.source ?? 'Unknown'
}
function getLink(item: NewsItem): string {
  return item.link ?? item.url ?? '#'
}
function getSnippet(item: NewsItem): string | undefined {
  return item.snippet ?? item.summary
}

export default function NewsFeed({ sector, news: staticNews, color }: NewsFeedProps) {
  const [news, setNews] = useState<NewsItem[]>(staticNews ?? [])
  const [loading, setLoading] = useState(!staticNews && !!sector)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [apiError, setApiError] = useState(false)

  useEffect(() => {
    if (!sector) {
      setNews(staticNews ?? [])
      return
    }

    let cancelled = false
    setLoading(true)
    setApiError(false)

    fetch(`/api/news/${encodeURIComponent(sector)}`)
      .then(r => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then(data => {
        if (cancelled) return
        setNews(data.news ?? [])
        setFetchedAt(data.fetchedAt ?? null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        // Phase 13 S2 fix (F5.4): preserve UI behavior, add operator-visible diagnostic.
        console.warn('[NewsFeed] news fetch failed for sector', sector, err)
        setApiError(true)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [sector, staticNews])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-slate-900/60 rounded-xl p-4 border border-slate-800 animate-pulse">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-800 rounded w-3/4" />
                <div className="h-3 bg-slate-800 rounded w-full" />
                <div className="h-3 bg-slate-800 rounded w-2/3" />
              </div>
            </div>
          </div>
        ))}
        <div className="text-center text-xs text-slate-600 py-2">Loading Yahoo Finance news…</div>
      </div>
    )
  }

  if (apiError) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/20 p-4 text-xs text-red-400">
        Failed to load live news from Yahoo Finance. Please try again.
      </div>
    )
  }

  if (news.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 p-6 text-center text-xs text-slate-500">
        No recent news found for this {sector ? 'sector' : 'topic'} on Yahoo Finance.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Source / timestamp bar */}
      {fetchedAt && (
        <div className="flex items-center gap-2 text-[10px] text-slate-600 pb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
          Live · Yahoo Finance
          <span>· Fetched {new Date(fetchedAt).toLocaleTimeString()}</span>
        </div>
      )}

      {news.map((item, i) => (
        <a
          key={i}
          href={getLink(item)}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-slate-900/60 rounded-xl p-4 border border-slate-800 hover:border-slate-600 hover:bg-slate-800/40 transition-all group"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <h4 className="text-sm font-semibold text-white group-hover:text-slate-200 leading-snug flex-1">
              {item.title}
            </h4>
            <span
              className="text-xs px-2 py-0.5 rounded font-mono shrink-0 mt-0.5"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {getPublisher(item)}
            </span>
          </div>

          {getSnippet(item) && (
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{getSnippet(item)}</p>
          )}

          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs text-slate-600 group-hover:text-slate-500 transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Read full story →
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-600">
              {item.publishedAt && (
                <span>
                  {new Date(item.publishedAt).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
              {item.tickers && item.tickers.length > 0 && (
                <span className="text-blue-400/70">{item.tickers.slice(0, 3).join(', ')}</span>
              )}
            </div>
          </div>
        </a>
      ))}
    </div>
  )
}
