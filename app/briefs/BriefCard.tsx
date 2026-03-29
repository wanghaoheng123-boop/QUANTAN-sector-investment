'use client'

import Link from 'next/link'
import { SECTORS } from '@/lib/sectors'

interface SectorBrief {
  id: string
  sector: string
  sectorName: string
  fetchedAt: string
  lastUpdated: string | null
  quoteTime: string | null
  price: number
  change: number
  changePct: number
  high52w: number | null
  low52w: number | null
  analystRating: string | null
  analystCount: number | null
  holdingsAvgChange: number
  dataQuality: 'live' | 'partial' | 'unavailable'
  dataQualityNote: string | null
  news: { title: string }[]
  signals: { key: string; value: string; impact: string }[]
  summary: string
}

export default function BriefCard({ brief }: { brief: SectorBrief }) {
  const sector = SECTORS.find(s => s.slug === brief.sector)
  if (!sector) return null

  const analystBadgeColor =
    brief.analystRating === 'BUY' ? '#00d084' :
    brief.analystRating === 'SELL' ? '#ff4757' :
    brief.analystRating === 'HOLD' ? '#fbbf24' : '#94a3b8'

  return (
    <Link href={`/briefs/sector/${brief.sector}`}>
      <div className="group rounded-xl border border-slate-800 p-5 hover:border-slate-600 hover:bg-slate-900/40 transition-all">
        <div className="flex items-start gap-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
            style={{ backgroundColor: `${sector.color}15`, border: `1px solid ${sector.color}30` }}
          >
            {sector.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded"
                style={{ backgroundColor: `${sector.color}20`, color: sector.color }}
              >
                {sector.name}
              </span>
              {brief.analystRating && (
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded"
                  style={{ backgroundColor: `${analystBadgeColor}20`, color: analystBadgeColor }}
                >
                  {brief.analystRating}
                </span>
              )}
              {brief.dataQuality !== 'live' && (
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}
                >
                  {brief.dataQuality === 'partial' ? '◐ Partial' : '✕ Unavailable'}
                </span>
              )}
              <span className="text-xs text-slate-600">
                {brief.lastUpdated
                  ? new Date(brief.lastUpdated).toLocaleString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })
                  : '—'}
              </span>
            </div>

            {/* Price line */}
            <div className="flex items-center gap-3 mb-2">
              <span className="text-lg font-bold text-white font-mono">${brief.price.toFixed(2)}</span>
              <span
                className="text-sm font-mono font-semibold"
                style={{ color: brief.changePct >= 0 ? '#00d084' : '#ff4757' }}
              >
                {brief.changePct >= 0 ? '+' : ''}{brief.changePct.toFixed(2)}%
              </span>
              <span className="text-sm text-slate-500 font-mono">
                {brief.change >= 0 ? '+' : ''}{brief.change.toFixed(2)}
              </span>
              <span className="ml-auto text-xs text-slate-500 font-mono">
                H: ${(brief.high52w ?? 0).toFixed(2)}
              </span>
            </div>

            <p className="text-sm text-slate-500 line-clamp-2 mb-2">{brief.summary}</p>

            {/* Key signals row */}
            {brief.signals.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-2">
                {brief.signals.slice(0, 4).map((s, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    <span className="text-slate-500">{s.key}: </span>
                    <span style={{
                      color: s.impact === 'positive' ? '#00d084' : s.impact === 'negative' ? '#ff4757' : '#94a3b8'
                    }}>{s.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-slate-600 group-hover:text-slate-400 transition-colors text-lg shrink-0 self-center">→</div>
        </div>
      </div>
    </Link>
  )
}
