'use client'

/**
 * MetricTooltip — info-icon tooltip with metric definition + how-to-use.
 *
 * Phase 12 Sprint 1 follow-up: Addresses the "users don't know what they're looking at"
 * complaint. Hover/focus shows definition, range, trader guidance, and source citation.
 *
 * Usage:
 *   <MetricTooltip metricKey="rsi" />
 *   <span>RSI: 72</span><MetricTooltip metricKey="rsi" />
 *
 * Or inline custom tooltip:
 *   <MetricTooltip label="Custom" content="My explanation" />
 */

import { useState, useRef, useEffect } from 'react'
import { Info } from 'lucide-react'
import { getMetric, type MetricMeta } from '@/lib/metricGlossary'

interface Props {
  /** Lookup key in METRIC_GLOSSARY */
  metricKey?: string
  /** Inline label override (when metricKey is not in the glossary) */
  label?: string
  /** Custom content override */
  content?: string
  /** Compact (smaller icon) */
  compact?: boolean
}

export function MetricTooltip({ metricKey, label, content, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickAway)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClickAway)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const meta: MetricMeta | null = metricKey ? getMetric(metricKey) : null
  const displayLabel = meta?.label ?? label ?? metricKey ?? 'Metric'

  // Fall back to content prop when no glossary entry
  if (!meta && !content) {
    return null
  }

  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          // Tooltip lives inside Links/cards — don't navigate or submit on click.
          e.stopPropagation()
          e.preventDefault()
          setOpen(o => !o)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-cyan-400 transition-colors focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded ml-1"
        aria-label={`Explain ${displayLabel}`}
        aria-expanded={open}
      >
        <Info className={iconSize} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-cyan-500/30 bg-slate-900/98 backdrop-blur-md px-3 py-2.5 shadow-2xl text-left"
        >
          <span className="block text-cyan-300 text-xs font-semibold tracking-wide mb-1">{displayLabel}</span>
          {meta ? (
            <>
              <span className="block text-[11px] text-slate-300 leading-relaxed mb-1.5">{meta.definition}</span>
              <span className="block text-[10.5px] text-slate-400 mb-1">
                <span className="text-slate-500 font-medium">Range: </span>{meta.range}
              </span>
              <span className="block text-[10.5px] text-amber-200/90 leading-relaxed mt-1.5 pt-1.5 border-t border-slate-700/50">
                <span className="text-amber-400 font-medium">How to use: </span>{meta.howToUse}
              </span>
              {meta.source && (
                <span className="block text-[9.5px] text-slate-500 mt-1.5 italic">Source: {meta.source}</span>
              )}
            </>
          ) : (
            <span className="block text-[11px] text-slate-300 leading-relaxed">{content}</span>
          )}
        </span>
      )}
    </span>
  )
}

export default MetricTooltip
