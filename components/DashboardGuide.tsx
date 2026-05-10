'use client'

/**
 * DashboardGuide — collapsible "How to read this dashboard" panel.
 *
 * Phase 12 Sprint 1 follow-up: Sits at the top of every page, gives traders a
 * 30-second orientation: what they're looking at, what columns mean, how to act.
 * Stays collapsed by default after first visit (localStorage), open on first load.
 */

import { useState, useEffect } from 'react'
import { ChevronDown, BookOpen } from 'lucide-react'

export interface GuideSection {
  /** Heading shown bolded */
  title: string
  /** Body — supports inline JSX (use <strong>, <code>, etc.) */
  body: React.ReactNode
}

interface Props {
  /** Page identifier; used as localStorage key for collapse-state persistence */
  pageKey: string
  /** Page title shown next to the icon */
  title: string
  /** One-line summary at the top of the panel */
  summary: string
  /** Detailed sections explaining the page */
  sections: GuideSection[]
  /** Glossary of color codes used on the page */
  legend?: { color: string; label: string; meaning: string }[]
}

export function DashboardGuide({ pageKey, title, summary, sections, legend }: Props) {
  const storageKey = `quantan-guide-${pageKey}`
  // Default OPEN on first ever visit so users see the explanations
  const [open, setOpen] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const seen = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    if (seen === 'collapsed') setOpen(false)
    setHydrated(true)
  }, [storageKey])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, next ? 'open' : 'collapsed')
    }
  }

  // Until hydration, render the SSR default (open) to avoid mismatch.
  const isOpen = hydrated ? open : true

  return (
    <section
      className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/80 to-slate-900/40 backdrop-blur-sm shadow-lg overflow-hidden"
      aria-labelledby={`guide-${pageKey}-title`}
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-800/30 transition-colors text-left"
        aria-expanded={isOpen}
        aria-controls={`guide-${pageKey}-content`}
      >
        <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 id={`guide-${pageKey}-title`} className="text-sm font-semibold text-cyan-200 leading-tight">
            How to read this dashboard — <span className="text-slate-100">{title}</span>
          </h2>
          <p className="text-[11px] text-slate-400 leading-snug mt-0.5 truncate">{summary}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          id={`guide-${pageKey}-content`}
          className="px-5 pb-4 pt-1 grid gap-4 md:grid-cols-2 border-t border-slate-700/40"
        >
          <div className="space-y-3">
            {sections.map((s, i) => (
              <div key={i} className="text-xs leading-relaxed">
                <h3 className="text-cyan-300 font-medium mb-1">{s.title}</h3>
                <div className="text-slate-300/90">{s.body}</div>
              </div>
            ))}
          </div>
          {legend && legend.length > 0 && (
            <div>
              <h3 className="text-cyan-300 font-medium text-xs mb-2">Color legend</h3>
              <ul className="space-y-1.5">
                {legend.map((l, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px]">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 mt-0.5 ring-1 ring-slate-700"
                      style={{ backgroundColor: l.color }}
                      aria-hidden="true"
                    />
                    <span className="leading-relaxed">
                      <strong className="text-slate-200">{l.label}</strong>
                      <span className="text-slate-400"> — {l.meaning}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default DashboardGuide
