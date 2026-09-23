'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react'

/**
 * Q-109 (2026-09-24) — this banner named the WRONG regulators, and the fix is
 * to name none.
 *
 * It asserted the product does not provide recommendations "regulated under
 * MiFID II, SEC RIA, or equivalent regimes". That is a regulatory
 * SELF-CLASSIFICATION: it claims to know which regimes do and do not govern
 * this product. It named two that do not and omitted MAS, which does — this
 * platform's regulatory posture is Singapore/MAS (see CLAUDE.md, Q-083).
 *
 * DO NOT "FIX" THIS BY WRITING "not regulated under MAS". That is the identical
 * error aimed at the regulator that actually bites, and it would be worse: an
 * unlicensed self-exemption from the regime that applies. Whether the FAA/SFA
 * licensing line is crossed is a legal question for the owner and external
 * counsel (Q-083), not a sentence a component can settle.
 *
 * So the clause is DELETED and no regime is named at all. Everything left below
 * is a mechanical fact about what the software does, each verified against the
 * code on 2026-09-24:
 *   • does not route or execute orders — no broker/execution path exists;
 *     the only "order"/"broker" matches in the tree are cost-model comments
 *     (lib/options/flow.ts:71, components/backtest/OverviewTab.tsx:29)
 *   • does not hold customer funds — no custody or balance path exists
 *
 * `__tests__/architecture/compliance-wording.test.ts` fails if a regime name
 * returns.
 */

export default function ComplianceBanner() {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-slate-800 bg-slate-950/95">
      <div className="max-w-7xl mx-auto px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="compliance-detail"
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
          <div id="compliance-detail" className="mt-3 text-xs text-slate-400 space-y-2 leading-relaxed border-t border-slate-800/80 pt-3">
            <p>
              QUANTAN is a research and visualization tool. It does not route or execute orders, and does not hold customer funds.
            </p>
            <p>
              Data arrives from several vendors on different terms: some feeds are vendor-delayed, and others — the crypto order-book
              feeds — stream live to your browser. Each surface labels the age and state of what it is showing, so read that label rather
              than assuming a single freshness for the whole product. Map any level to your own tick plant before using it for execution
              or risk limits.
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
