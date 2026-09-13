'use client'

/**
 * DashboardGuide — collapsible "How to read this dashboard" panel.
 *
 * Phase 12 Sprint 1 follow-up: gives traders a 30-second orientation — what
 * they're looking at, what the columns mean, how to act.
 *
 * ("Sits at the top of every page" was this docstring's claim and it is not
 * true: measured 2026-09-13 it is mounted on TWO of sixteen pages, /desk and
 * /sector/[slug]. Corrected rather than left, since a reader sizing a change to
 * this file would mis-scope it by a factor of eight.)
 * Stays collapsed by default after first visit (localStorage), open on first load
 * — on a wide viewport. On a narrow one it starts COLLAPSED even on a first
 * visit (Q-115).
 *
 * Measured on production 2026-09-13 at 375x812: this panel was 2453px tall on
 * /desk, putting the first quote row 985px down — 1.21 screens of scrolling past
 * explanatory prose before a single price is visible, on a page whose entire
 * purpose is at-a-glance quotes. On /sector/[slug] it pushed the first content
 * below the guide to 1266px, 1.56 screens.
 *
 * The Phase 12 decision (show the explanation on first load) is preserved where
 * it is cheap — a wide viewport wraps the same prose into far fewer lines. What
 * changes is only the case where it was expensive. The collapsed header still
 * carries the page title and the one-line summary, so the orientation is not
 * hidden, only the detail: progressive disclosure, which is the standard answer
 * to exactly this trade-off on small screens.
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

/**
 * Tailwind's `sm` breakpoint, which is what every responsive class in this repo
 * is written against. Named so the guide and the layout cannot drift apart.
 */
export const NARROW_VIEWPORT_MAX_PX = 639

/**
 * Whether the guide should start collapsed for a first-time visitor.
 *
 * Pure and exported so the decision is unit-testable without a DOM — the state
 * it drives is only observable through a hydration effect otherwise, which is
 * how a default like this goes unnoticed when it changes.
 *
 * `matchMedia` is feature-detected: jsdom and older browsers lack it, and the
 * safe answer there is "do not collapse" — showing the explanation to someone
 * who did not need it is a smaller harm than hiding it from someone who did.
 */
export function shouldStartCollapsed(win: Pick<Window, 'matchMedia'> | undefined): boolean {
  if (!win || typeof win.matchMedia !== 'function') return false
  try {
    return win.matchMedia(`(max-width: ${NARROW_VIEWPORT_MAX_PX}px)`).matches
  } catch {
    return false
  }
}

export function DashboardGuide({ pageKey, title, summary, sections, legend }: Props) {
  const storageKey = `quantan-guide-${pageKey}`
  // Default OPEN on first ever visit so users see the explanations
  const [open, setOpen] = useState(true)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const seen = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    if (seen === 'collapsed') {
      setOpen(false)
    } else if (seen === null && typeof window !== 'undefined' && shouldStartCollapsed(window)) {
      // First visit on a narrow viewport. Deliberately NOT persisted: this is a
      // default, not a choice the user made, so rotating to landscape or opening
      // the same page on a desktop still gets the first-visit explanation.
      setOpen(false)
    }
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
