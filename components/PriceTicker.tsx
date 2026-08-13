'use client'

import { useState } from 'react'
import { formatCurrency, safeFixed } from '@/lib/format'

interface TickerItem {
  ticker: string
  name: string
  price: number
  changePct: number
}

interface PriceTickerProps {
  items: TickerItem[]
}

// Local `safeToFixed` removed — promoted to lib/format.ts as `safeFixed`
// (SSOT, Phase 13 S2 cross-cutting Pattern 3).
const safeToFixed = safeFixed

export default function PriceTicker({ items }: PriceTickerProps) {
  // Hover pause (mouse) and the explicit pause control (keyboard / touch) are
  // tracked separately: moving the mouse away must not silently restart a
  // marquee the user deliberately stopped.
  const [hoverPaused, setHoverPaused] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const isPaused = hoverPaused || userPaused

  // The list is rendered twice so the 50 s translateX(-50%) loop is seamless.
  // Only the FIRST copy is exposed to assistive tech — see aria-hidden below.
  const doubled = [...items, ...items]

  return (
    <div
      className="relative w-full bg-slate-900/80 border-b border-slate-800 overflow-hidden py-2"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      role="region"
      aria-label="Sector ETF price ticker"
    >
      {/* Fade masks */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-slate-900/90 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-900/90 to-transparent z-10 pointer-events-none" />

      {/* F-A11Y-2 (2026-08-14) — WCAG 2.2.2 Pause, Stop, Hide (Level A).
          The marquee starts automatically, moves for 50 s and repeats forever.
          Its only previous pause mechanism was :hover / onMouseEnter, which
          does not exist for keyboard or touch users — on mobile the band was
          literally unpauseable. This is a real, focusable control. */}
      <button
        type="button"
        onClick={() => setUserPaused((p) => !p)}
        aria-pressed={userPaused}
        aria-label={userPaused ? 'Resume the price ticker' : 'Pause the price ticker'}
        className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded border border-slate-700 bg-slate-800/95 p-1 text-slate-300 transition-colors hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        {userPaused ? (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
          </svg>
        )}
      </button>

      {/* Paused indicator (hover affordance only — the button above carries the
          accessible name and state, so this stays decorative). */}
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 transition-opacity duration-300 pointer-events-none ${
          isPaused ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden="true"
      >
        <div className="bg-slate-800/95 border border-slate-600 rounded px-3 py-1.5 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold font-mono text-slate-300 tracking-widest">PAUSED</span>
          </div>
        </div>
      </div>

      <div className={`flex animate-ticker ${isPaused ? 'paused' : ''}`} style={{ width: 'max-content' }}>
        {doubled.map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 shrink-0"
            // F-A11Y-2 — the second copy exists ONLY to make the CSS loop
            // seamless. Without this, screen readers announced all 22 entries:
            // every sector price twice, back to back.
            aria-hidden={i >= items.length ? true : undefined}
          >
            {i > 0 && i % items.length === 0 && (
              <span className="text-slate-700 mx-1" aria-hidden="true">•</span>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold font-mono text-white tracking-wide">{item.ticker}</span>
              <span className="text-[11px] font-mono text-slate-300">{formatCurrency(item.price)}</span>
              <span className={`text-[11px] font-mono font-medium ${item.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {item.changePct >= 0 ? '▲' : '▼'}{safeToFixed(Math.abs(item.changePct), 2)}%
              </span>
            </div>
            {i < doubled.length - 1 && (
              // Decorative column rule. It was also the single largest cluster
              // of contrast failures (slate-700 on slate-900 = 1.6:1) — the
              // right fix for a separator glyph is to hide it, not recolour it.
              <span className="text-slate-700 mx-0.5" aria-hidden="true">|</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
