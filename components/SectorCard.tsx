'use client'

import { memo } from 'react'
import Link from 'next/link'
import { Sector } from '@/lib/sectors'
import { PriceSignal } from '@/lib/sectors'
import Sparkline from '@/components/Sparkline'
import { MetricTooltip } from '@/components/MetricTooltip'
import { safeFixed } from '@/lib/format'

interface SectorCardProps {
  sector: Sector
  quote?: {
    price: number
    change: number
    changePct: number
  }
  signal?: PriceSignal
}

const SIGNAL_CONFIG = {
  BUY:   { bg: 'bg-green-900/30',  border: 'border-green-500/40',  text: 'text-green-400' },
  SELL:  { bg: 'bg-red-900/30',    border: 'border-red-500/40',    text: 'text-red-400' },
  HOLD:  { bg: 'bg-yellow-900/20', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  WATCH: { bg: 'bg-blue-900/20',   border: 'border-blue-500/30',   text: 'text-blue-400' },
}

// R5-H-2 (Phase 14 S1): wrap with React.memo so SectorCard only re-renders when its props
// change. The dashboard grid renders one card per sector — without memo, a parent state
// update (e.g. a live-quote tick for a single sector) re-renders all N cards.
function SectorCard({ sector, quote, signal }: SectorCardProps) {
  const isUp = (quote?.changePct ?? 0) >= 0
  const sparkData =
    quote && quote.price > 0 && Number.isFinite(quote.change)
      ? [quote.price - quote.change, quote.price]
      : []
  const sigCfg = signal ? SIGNAL_CONFIG[signal.direction] : null
  const session = signal?.source === 'yahoo-session'

  const priorPrice = sparkData.length >= 2 ? sparkData[0] : null
  const lastPrice = sparkData.length >= 2 ? sparkData[1] : null

  return (
    <Link href={`/sector/${sector.slug}`}>
      <div
        className={`group relative rounded-2xl p-4 border transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer overflow-hidden animate-card-enter ${sector.borderColor}`}
        style={{
          background: 'linear-gradient(135deg, rgba(14,14,22,0.97) 0%, rgba(9,9,16,0.99) 100%)',
          boxShadow: `0 0 0 1px ${sector.color}12, 0 0 30px ${sector.color}08`,
        }}
      >
        {/* Hover radial glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 0%, ${sector.color}18 0%, transparent 65%)` }}
        />

        {/* Prominent hover glow effect */}
        <div
          className="absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl"
          style={{ boxShadow: `0 0 50px ${sector.color}35, inset 0 0 30px ${sector.color}12` }}
        />

        {/* Header row */}
        <div className="flex items-start justify-between mb-2 relative">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-base">{sector.icon}</span>
              <span className="text-[10px] font-mono tracking-wider text-slate-500">{sector.etf}</span>
            </div>
            <div className="text-sm font-bold text-white">{sector.name}</div>
          </div>
          {signal && sigCfg && (
            <span className={`text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded ${sigCfg.bg} ${sigCfg.text}`}>
              {              session
                ? signal.direction === 'BUY'
                  ? 'UP'
                  : signal.direction === 'SELL'
                    ? 'DOWN'
                    : 'NEUTRAL'
                : signal.direction}
            </span>
          )}
        </div>

        {/* Price row + sparkline */}
        <div className="flex items-end justify-between mb-2.5 relative">
          <div>
            {quote ? (
              <>
                <div className="text-xl font-bold text-white font-mono leading-none transition-all duration-300">
                  ${safeFixed(quote.price, 2)}
                </div>
                {/* F6.3 (Phase 13 S2): icon + sign prefix + aria-label so direction is
                    clear without relying on color hue (WCAG 2.2 SC 1.4.1). */}
                <div
                  className={`text-xs font-mono mt-0.5 transition-all duration-300 ${isUp ? 'text-green-400' : 'text-red-400'}`}
                  aria-label={`${isUp ? 'up' : 'down'} ${safeFixed(Math.abs(quote.changePct), 2)} percent`}
                >
                  <span aria-hidden="true">{isUp ? '▲' : '▼'}</span>{' '}
                  {isUp ? '+' : '−'}{safeFixed(Math.abs(quote.changePct), 2)}%
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <div className="h-5 w-20 bg-slate-800 rounded animate-pulse" />
                <div className="h-3 w-12 bg-slate-800 rounded animate-pulse" />
              </div>
            )}
          </div>
          {sparkData.length >= 2 ? (
            <div className="flex flex-col items-end gap-0.5 relative group/sparkline">
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/sparkline:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap">
                  <div className="text-[10px] text-slate-400 font-mono space-y-0.5">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Prior:</span>
                      <span className="text-slate-300">${safeFixed(priorPrice, 2)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-500">Last:</span>
                      <span className="text-white font-medium">${safeFixed(lastPrice, 2)}</span>
                    </div>
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-slate-700" />
                </div>
              </div>
              <Sparkline data={sparkData} color={sector.color} width={72} height={28} />
              <span className="text-[8px] text-slate-400 font-mono text-right group-hover/sparkline:text-slate-500 transition-colors">prior→last</span>
            </div>
          ) : (
            <span className="text-[9px] text-slate-400 self-end">—</span>
          )}
        </div>

        {/* Signal confidence bar */}
        {signal && (
          <div className="relative mb-2.5">
            <div className="flex justify-between text-[10px] mb-1 text-slate-400">
              <span className="inline-flex items-center">
                {session ? 'Move scale' : 'Confidence'}
                {!session && <MetricTooltip metricKey="confidence" compact />}
              </span>
              <span style={{ color: sector.color }} className="font-mono">{signal.confidence}%</span>
            </div>
            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${signal.confidence}%`, backgroundColor: sector.color }}
              />
            </div>
          </div>
        )}

        {/* Top holdings chips */}
        <div className="flex gap-1 flex-wrap relative">
          {sector.topHoldings.slice(0, 4).map(h => (
            <span key={h} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-500 font-mono">
              {h}
            </span>
          ))}
        </div>

        {/* Bottom glow bar */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px transition-opacity opacity-30 group-hover:opacity-80"
          style={{ background: `linear-gradient(90deg, transparent, ${sector.color}, transparent)` }}
        />
      </div>
    </Link>
  )
}

export default memo(SectorCard)
