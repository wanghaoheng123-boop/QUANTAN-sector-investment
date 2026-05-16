'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'

export default function ComplianceBanner() {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-slate-800 bg-slate-950/95">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert className="w-4 h-4 text-amber-500/90 shrink-0" />
            <span>
              <strong className="text-slate-300">Professional disclaimer:</strong> Not investment advice.
              Signals, dark pool panels, and briefs are illustrative or simulated where labeled — verify all data with your OMS, vendor feeds, and compliance workflow.
            </span>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
        </button>
        {open && (
          <div className="mt-3 text-xs text-slate-500 space-y-2 leading-relaxed border-t border-slate-800/80 pt-3">
            <p>
              QUANTAN is a research and visualization tool. It does not route orders, hold customer funds, or provide personalized recommendations
              regulated under MiFID II, SEC RIA, or equivalent regimes unless you separately engage a licensed entity.
            </p>
            <p>
              Market data is delayed or aggregated per your data provider (e.g. Yahoo Finance via this demo). Trading floors should map APIs to Bloomberg Refinitiv, FactSet,
              or internal tick plants before using any level for execution or risk limits.
            </p>
            <p>
              Past performance and backtests do not guarantee future results. You are responsible for suitability, best execution, and record-keeping.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
