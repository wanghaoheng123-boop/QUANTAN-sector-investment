'use client'

/**
 * Q-138 — the Liquidations tab of the BTC Quant Lab, extracted as a props-only
 * component so its RENDERED output can be tested in node with
 * react-dom/server (jsdom tests are CI-only on this machine). All wording and
 * state transitions live in lib/liquidationDisplay.ts.
 */

import { DataFreshnessIndicator } from '@/components/DataFreshnessIndicator'
import { formatFreshness } from '@/lib/format'
import {
  LIQ_SCOPE_NOTE,
  liquidationCards,
  liquidationFreshnessPrefix,
  type LiqData,
} from '@/lib/liquidationDisplay'

interface Props {
  liq: LiqData | null
  loading: boolean
  /** Our local fetch has happened at least once. */
  fetched: boolean
  cached: boolean
}

export function LiquidationsPanel({ liq, loading, fetched, cached }: Props) {
  return (
    <div>
      {loading && <div className="text-[10px] text-slate-400 mb-2">Refreshing liquidations data…</div>}
      {fetched && (
        <div className="text-[10px] text-slate-400 mb-2 flex items-center gap-2">
          {/* Q-114: OUR fetch time; crypto trades 24/7, so no us-equity calendar. */}
          <span>{liquidationFreshnessPrefix(liq)}: {formatFreshness(liq?.fetchedAt)}</span>
          {cached && <DataFreshnessIndicator cached compact />}
        </div>
      )}
      {liq?.degraded && (
        <div
          role="status"
          data-testid="liq-degraded"
          className="text-[11px] text-amber-400 border border-amber-800/40 bg-amber-950/20 rounded-lg px-3 py-2 mb-3"
        >
          {liq.userMessage ?? 'Liquidation data is unavailable right now.'}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {liquidationCards(liq).map((c) => (
          <div key={c.label} data-testid="liq-card" className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
            <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">{c.label}</div>
            <div className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">{LIQ_SCOPE_NOTE}</p>
    </div>
  )
}
