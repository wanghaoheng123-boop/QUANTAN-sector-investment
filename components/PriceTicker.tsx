'use client'

import { useState } from 'react'
import Sparkline from './Sparkline'

interface TickerItem {
  ticker: string
  name: string
  price: number
  changePct: number
  history?: number[]
}

interface PriceTickerProps {
  items: TickerItem[]
}

export default function PriceTicker({ items }: PriceTickerProps) {
  const [isPaused, setIsPaused] = useState(false)

  // Group items by sector for dividers
  const doubled = [...items, ...items]

  return (
    <div
      className="relative w-full bg-slate-900/80 border-b border-slate-800 overflow-hidden py-2"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Fade masks */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-slate-900/90 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-slate-900/90 to-transparent z-10 pointer-events-none" />

      {/* Paused indicator */}
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 transition-opacity duration-300 pointer-events-none ${
          isPaused ? 'opacity-100' : 'opacity-0'
        }`}
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
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && i % items.length === 0 && (
              <span className="text-slate-700 mx-1">•</span>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold font-mono text-white tracking-wide">{item.ticker}</span>
              <span className="text-[11px] font-mono text-slate-300">${item.price.toFixed(2)}</span>
              <span className={`text-[11px] font-mono font-medium ${item.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {item.changePct >= 0 ? '▲' : '▼'}{Math.abs(item.changePct).toFixed(2)}%
              </span>
              {item.history && item.history.length >= 2 && (
                <Sparkline data={item.history} color={item.changePct >= 0 ? '#00d084' : '#ff4757'} width={48} height={16} />
              )}
            </div>
            {i < doubled.length - 1 && (
              <span className="text-slate-700 mx-0.5">|</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
