'use client'

import Link from 'next/link'
import { SECTORS } from '@/lib/sectors'
import type { SectorBrief } from '@/lib/briefs/sectorBrief'
import { formatCurrency, formatSignedNumber } from '@/lib/format'

// Q-140: was a hand-copied duplicate of the builder's type, which is how a
// price that can be null went unnoticed here. One definition now.

export default function BriefCard({ brief }: { brief: SectorBrief }) {
  const sector = SECTORS.find(s => s.slug === brief.sector)
  if (!sector) return null

  const analystBadgeColor =
    brief.analystRating === 'BUY' ? '#00d084' :
    brief.analystRating === 'SELL' ? '#ff6b7a' :
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
              <span className="text-xs text-slate-400">
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
              <span className="text-lg font-bold text-white font-mono">{formatCurrency(brief.price)}</span>
              <span
                className="text-sm font-mono font-semibold"
                style={{ color: brief.changePct == null ? '#94a3b8' : brief.changePct >= 0 ? '#00d084' : '#ff6b7a' }}
              >
                {brief.changePct == null ? '—' : `${formatSignedNumber(brief.changePct)}%`}
              </span>
              <span className="text-sm text-slate-400 font-mono">
                {formatSignedNumber(brief.change)}
              </span>
              <span className="ml-auto text-xs text-slate-400 font-mono">
                H: {formatCurrency(brief.high52w)}
              </span>
            </div>

            <p className="text-sm text-slate-400 line-clamp-2 mb-2">{brief.summary}</p>

            {/* Key signals row */}
            {brief.signals.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-2">
                {brief.signals.slice(0, 4).map((s, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    <span className="text-slate-400">{s.key}: </span>
                    <span style={{
                      color: s.impact === 'positive' ? '#00d084' : s.impact === 'negative' ? '#ff6b7a' : '#94a3b8'
                    }}>{s.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-slate-400 group-hover:text-slate-200 transition-colors text-lg shrink-0 self-center">→</div>
        </div>
      </div>
    </Link>
  )
}
