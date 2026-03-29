'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SECTORS } from '@/lib/sectors'

interface NewsItem {
  title: string
  publisher: string
  publishedAt: string | null
  snippet: string | null
  link: string
  tickers: string[]
}

interface BriefSignal {
  key: string
  value: string
  impact: 'positive' | 'negative' | 'neutral'
}

interface SectorBrief {
  id: string
  sector: string
  sectorName: string
  fetchedAt: string
  lastUpdated: string | null
  price: number
  change: number
  changePct: number
  quoteTime: string | null
  high52w: number | null
  low52w: number | null
  priceVsHighPct: number | null
  priceVsLowPct: number | null
  analystRating: string | null
  analystCount: number | null
  targetPrice: number | null
  currentVsTargetPct: number | null
  volume: number | null
  avgVolume: number | null
  avgVolume10d: number | null
  marketCap: string | null
  peRatio: number | null
  forwardPe: number | null
  pegRatio: number | null
  priceToBook: number | null
  dividendYield: number | null
  beta: number | null
  holdings: { ticker: string; weight: string; price: number; change: number; changePct: number }[]
  holdingsAvgChange: number
  news: NewsItem[]
  signals: BriefSignal[]
  summary: string
  source: string
  dataQuality: 'live' | 'partial' | 'unavailable'
  dataQualityNote: string | null
}

function impactColor(impact: string): string {
  return impact === 'positive' ? '#00d084' : impact === 'negative' ? '#ff4757' : '#94a3b8'
}

export default function LiveBriefClient({ slug, initialBrief }: { slug: string; initialBrief: SectorBrief | null }) {
  const sector = SECTORS.find(s => s.slug === slug)

  const [brief, setBrief] = useState<SectorBrief | null>(initialBrief ?? null)
  const [loading, setLoading] = useState(!initialBrief)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || initialBrief) return
    setLoading(true)
    setError(null)
    fetch(`/api/briefs/${encodeURIComponent(slug)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setBrief(data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [slug, initialBrief])

  if (!sector && !loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-bold text-white">Sector not found</h1>
        <Link href="/briefs" className="text-blue-400 mt-4 inline-block">← All Briefs</Link>
      </div>
    )
  }

  return (
    <article className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/briefs" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
        ← All Briefs
      </Link>

      {loading && (
        <div className="mt-8 space-y-4 animate-pulse">
          <div className="h-6 bg-slate-800 rounded w-1/3" />
          <div className="h-10 bg-slate-800 rounded w-2/3" />
          <div className="h-4 bg-slate-800 rounded w-full" />
          <div className="h-4 bg-slate-800 rounded w-5/6" />
        </div>
      )}

      {error && (
        <div className="mt-8 p-4 rounded-xl border border-red-800 bg-red-950/20 text-red-400 text-sm">
          Failed to load brief: {error}
        </div>
      )}

      {brief && !loading && (
        <>
          <div className="mt-6 mb-8">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded flex items-center gap-1.5"
                style={{ backgroundColor: `${sector?.color}20`, color: sector?.color }}
              >
                {sector?.icon} {sector?.name}
              </span>
              <span className="text-xs text-slate-500">
                {brief.lastUpdated
                  ? new Date(brief.lastUpdated).toLocaleString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                    }) + ' UTC'
                  : 'Live — Yahoo Finance'}
              </span>
              <span className="text-xs text-slate-600">·</span>
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor:
                    brief.dataQuality === 'live' ? 'rgba(0,208,132,0.15)' :
                    brief.dataQuality === 'partial' ? 'rgba(251,191,36,0.15)' :
                    'rgba(239,68,68,0.15)',
                  color:
                    brief.dataQuality === 'live' ? '#00d084' :
                    brief.dataQuality === 'partial' ? '#fbbf24' :
                    '#ef4444',
                }}
              >
                {brief.dataQuality === 'live' ? '● LIVE' : brief.dataQuality === 'partial' ? '◐ PARTIAL' : '✕ UNAVAILABLE'}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-white leading-tight mb-3">
              {sector?.name} Sector Intelligence Brief
            </h1>

            <div className="flex items-center gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/40 mb-4">
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Price</div>
                <div className="text-2xl font-bold text-white font-mono">${brief.price.toFixed(2)}</div>
              </div>
              <div
                className="text-lg font-mono font-semibold"
                style={{ color: brief.changePct >= 0 ? '#00d084' : '#ff4757' }}
              >
                {brief.changePct >= 0 ? '+' : ''}{brief.changePct.toFixed(2)}%
              </div>
              <div className="text-sm text-slate-400 font-mono">
                {brief.change >= 0 ? '+' : ''}{brief.change.toFixed(2)}
              </div>
              <div className="ml-auto text-right">
                <div className="text-xs text-slate-500">52W Range</div>
                <div className="text-xs text-slate-400 font-mono">
                  ${(brief.low52w ?? 0).toFixed(2)} → ${(brief.high52w ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <p className="text-slate-400 text-sm leading-relaxed border-l-2 pl-4" style={{ borderColor: sector?.color }}>
              {brief.summary}
            </p>
          </div>

          {brief.dataQualityNote && (
            <div className="mb-6 p-3 rounded-lg border border-amber-500/20 bg-amber-950/10 text-xs text-amber-300/80">
              {brief.dataQualityNote}
            </div>
          )}

          {(brief.peRatio !== null || brief.beta !== null || brief.dividendYield !== null || brief.forwardPe !== null || brief.marketCap !== null) && (
            <div className="rounded-xl border border-slate-800 p-5 mb-6 bg-slate-900/40">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Key Statistics</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {brief.peRatio !== null && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Trailing P/E</div>
                    <div className="text-sm font-mono font-semibold text-white">{brief.peRatio > 0 ? brief.peRatio.toFixed(1) : '—'}</div>
                  </div>
                )}
                {brief.forwardPe !== null && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Forward P/E</div>
                    <div className="text-sm font-mono font-semibold text-white">{brief.forwardPe > 0 ? brief.forwardPe.toFixed(1) : '—'}</div>
                  </div>
                )}
                {brief.beta !== null && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Beta</div>
                    <div className="text-sm font-mono font-semibold text-white">{brief.beta.toFixed(2)}</div>
                  </div>
                )}
                {brief.dividendYield !== null && brief.dividendYield > 0 && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Dividend Yield</div>
                    <div className="text-sm font-mono font-semibold text-white">{(brief.dividendYield * 100).toFixed(2)}%</div>
                  </div>
                )}
                {brief.marketCap !== null && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Market Cap</div>
                    <div className="text-sm font-mono font-semibold text-white">{brief.marketCap}</div>
                  </div>
                )}
                {brief.analystRating !== null && (
                  <div>
                    <div className="text-[10px] text-slate-500 mb-0.5">Analyst Rating</div>
                    <div className="text-sm font-mono font-semibold" style={{ color: brief.analystRating === 'BUY' ? '#00d084' : brief.analystRating === 'SELL' ? '#ff4757' : '#fbbf24' }}>
                      {brief.analystRating}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {brief.signals.length > 0 && (
            <div className="rounded-xl border border-slate-800 p-5 mb-6 bg-slate-900/40">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Embedded Signals</h3>
              <div className="space-y-2.5">
                {brief.signals.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-4">
                    <span className="text-sm text-slate-400">{s.key}</span>
                    <span className="text-sm font-mono font-medium text-right shrink-0" style={{ color: impactColor(s.impact) }}>
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brief.holdings.length > 0 && (
            <div className="rounded-xl border border-slate-800 p-5 mb-6 bg-slate-900/40">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
                Top Holdings · Avg {brief.holdingsAvgChange >= 0 ? '+' : ''}{brief.holdingsAvgChange.toFixed(2)}%
              </h3>
              <div className="space-y-2">
                {brief.holdings.map(h => (
                  <div key={h.ticker} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/stock/${h.ticker}`}
                        className="text-sm font-mono font-semibold text-white hover:text-blue-400 transition-colors"
                      >
                        {h.ticker}
                      </Link>
                      <span className="text-xs text-slate-500 font-mono">${h.price.toFixed(2)}</span>
                    </div>
                    <span className="text-sm font-mono font-semibold" style={{ color: h.changePct >= 0 ? '#00d084' : '#ff4757' }}>
                      {h.changePct >= 0 ? '+' : ''}{h.changePct.toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {brief.news.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
                Latest Headlines · Source: Yahoo Finance
              </h3>
              <div className="space-y-3">
                {brief.news.map((item, i) => (
                  <a
                    key={i}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-slate-800 p-4 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 group-hover:text-white leading-snug line-clamp-2">
                          {item.title}
                        </div>
                        {item.snippet && (
                          <div className="text-xs text-slate-500 mt-1 line-clamp-2">{item.snippet}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="text-[10px] text-slate-600">{item.publisher}</span>
                          {item.publishedAt && (
                            <span className="text-[10px] text-slate-600">
                              {new Date(item.publishedAt).toLocaleString('en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                          {item.tickers.length > 0 && (
                            <span className="text-[10px] text-slate-600">{item.tickers.slice(0, 4).join(', ')}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-slate-600 text-sm shrink-0 group-hover:text-slate-400 transition-colors">↗</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-slate-600 leading-relaxed pt-4 border-t border-slate-800">
            Data sourced from Yahoo Finance · {brief.lastUpdated ? `Last session close: ${new Date(brief.lastUpdated).toLocaleString()}` : 'Pre/post-market session'} ·
            Fetched: {new Date(brief.fetchedAt).toLocaleString()}.
            Prices delayed 15 minutes during regular market hours.
          </div>
        </>
      )}
    </article>
  )
}
