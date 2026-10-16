'use client'

/**
 * Q-135 — one sector ETF's session move. Replaces SignalCard, which rendered
 * an "Entry / Stop Loss / Target" grid and a risk/reward ratio no producer
 * ever supplied, and a "confidence" ring that was a rescaled move size.
 * Everything shown here is measured: the move, the price, the quote time.
 */
import { memo } from 'react'
import { formatMovePct, type SessionMove } from '@/lib/sessionMoves'
import { safeFixed, formatFreshness } from '@/lib/format'

// Colour-blind-safe: an icon and a word as well as a hue (WCAG 1.4.1).
const DIRECTION = {
  UP:   { icon: '▲', label: 'UP',   bg: 'bg-green-900/30',  border: 'border-green-500/40',  text: 'text-green-400' },
  DOWN: { icon: '▼', label: 'DOWN', bg: 'bg-red-900/30',    border: 'border-red-500/40',    text: 'text-red-400' },
  FLAT: { icon: '●', label: 'FLAT', bg: 'bg-slate-900/40',  border: 'border-slate-600/40',  text: 'text-slate-300' },
} as const

const pct = formatMovePct

function SessionMoveCard({ move, compact = false }: { move: SessionMove; compact?: boolean }) {
  const d = DIRECTION[move.direction]
  return (
    <div
      role="region"
      aria-label={`${move.etf} ${move.sector}: session ${d.label.toLowerCase()} ${pct(move.changePct)} versus the prior close`}
      className={`${compact ? 'rounded-xl p-4' : 'rounded-2xl p-5'} border ${d.bg} ${d.border}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-bold tracking-widest inline-flex items-center gap-1 ${d.text}`}>
          <span aria-hidden="true">{d.icon}</span>
          {d.label}
        </span>
        <span className="text-xs text-slate-400 font-mono">{move.etf}</span>
      </div>
      <div className={`font-mono font-bold ${compact ? 'text-lg' : 'text-2xl'} ${d.text}`}>{pct(move.changePct)}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">vs prior close · last ${safeFixed(move.price, 2)}</div>
      {!compact && move.quoteTime && (
        <div className="text-[10px] text-slate-400 mt-1 font-mono">
          Quote {formatFreshness(move.quoteTime, { stamp: 'vendor', calendar: 'us-equity' })}
        </div>
      )}
      <div className="text-[10px] text-slate-400 mt-1">{move.sector} · Yahoo Finance</div>
      {!compact && (
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          A measurement of today&apos;s move, not a trade signal: no entry, stop or target is computed.
        </p>
      )}
    </div>
  )
}

export default memo(SessionMoveCard)
