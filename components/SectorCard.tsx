'use client'

import { memo } from 'react'
import Link from 'next/link'
import { Sector } from '@/lib/sectors'
import type { SessionMove } from '@/lib/sessionMoves'
import { safeFixed } from '@/lib/format'

interface SectorCardProps {
  sector: Sector
  quote?: {
    price: number
    /** Missing vendor changes stay missing, never 0.00%. */
    change: number | null
    changePct: number | null
  }
  move?: SessionMove | null
}

function SectorCard({ sector, quote, move }: SectorCardProps) {
  const pct = quote?.changePct ?? null
  const isUp = pct != null && pct > 0
  const isDown = pct != null && pct < 0
  const directionClass = isUp ? 'text-[var(--color-up)]' : isDown ? 'text-[var(--color-down)]' : 'text-slate-300'

  return (
    <Link
      href={`/sector/${sector.slug}`}
      className="group flex h-full flex-col justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-4 transition-colors hover:border-slate-600 hover:bg-slate-800/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: sector.color }} aria-hidden="true" />
            <span className="font-mono text-xs font-medium tracking-wide text-slate-400">{sector.etf}</span>
          </div>
          <h3 className="text-sm font-medium leading-snug text-slate-100">{sector.name}</h3>
        </div>
        <span aria-hidden="true" className="text-slate-500 transition-colors group-hover:text-amber-400">↗</span>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-2">
        {quote ? (
          <span className="font-mono text-xl font-medium tracking-tight text-white tabular-nums">
            ${safeFixed(quote.price, 2)}
          </span>
        ) : (
          <span className="font-mono text-xl text-slate-400" aria-label="quote missing">—</span>
        )}
        {pct == null ? (
          <span className="text-xs text-slate-400" aria-label="no change data">—</span>
        ) : (
          <span
            className={`font-mono text-sm tabular-nums ${directionClass}`}
            aria-label={`${isUp ? 'up' : isDown ? 'down' : 'flat'} ${safeFixed(Math.abs(pct), 2)} percent`}
          >
            <span aria-hidden="true">{isUp ? '↗' : isDown ? '↘' : '→'}</span>{' '}
            {isUp ? '+' : isDown ? '−' : ''}{safeFixed(Math.abs(pct), 2)}%
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-400">
        <span className="truncate font-mono">{sector.topHoldings.slice(0, 3).join(' · ')}</span>
        {move && (
          <span className="shrink-0" aria-label={`session ${move.direction.toLowerCase()} versus the prior close`}>
            {move.direction === 'FLAT' ? 'Flat' : move.direction === 'UP' ? 'Up' : 'Down'}
          </span>
        )}
      </div>
    </Link>
  )
}

export default memo(SectorCard)
