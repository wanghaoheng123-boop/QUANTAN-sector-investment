'use client'

/**
 * Q-138 — the Liquidations tab of the BTC Quant Lab.
 *
 * `LiquidationsPanel` owns its fetch, polling and state; the lab renders it
 * with no props. Round 2 of the red team broke the earlier split, where the
 * lab held the state and passed it down: an early `return` before the state
 * transition, or `cached={false}`, went untested — and the I2 cache-flag
 * guard for this panel was passing only because of a dead import. Nothing in
 * the lab reads liquidation data any more, so there is no wiring left to break
 * there, and the file that reads `_cached` is the file that renders the badge.
 *
 * `LiquidationsView` is props-only and render-tested with react-dom/server;
 * the container's fetch wiring is tested in jsdom
 * (__tests__/components/crypto/LiquidationsPanel.test.tsx). All wording and
 * transitions live in lib/liquidationDisplay.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DataFreshnessIndicator } from '@/components/DataFreshnessIndicator'
import { fetchJsonSafe } from '@/lib/fetchJsonSafe'
import { formatFreshness } from '@/lib/format'
import {
  LIQ_SCOPE_NOTE,
  liquidationCards,
  liquidationFreshnessPrefix,
  nextLiqState,
  type LiqData,
} from '@/lib/liquidationDisplay'

/** Poll interval while the tab is open. */
export const LIQ_POLL_MS = 60_000

interface ViewProps {
  liq: LiqData | null
  loading: boolean
  /** A fetch has completed at least once. */
  fetched: boolean
  cached: boolean
  onRefresh?: () => void
}

export function LiquidationsView({ liq, loading, fetched, cached, onRefresh }: ViewProps) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 mb-2 flex items-center gap-2 min-h-[1rem]">
        {loading && <span>Refreshing liquidations data…</span>}
        {!loading && fetched && (
          // Q-114: OUR fetch time; crypto trades 24/7, so no us-equity calendar.
          <span data-testid="liq-freshness">{liquidationFreshnessPrefix(liq)}: {formatFreshness(liq?.fetchedAt)}</span>
        )}
        {cached && <DataFreshnessIndicator cached compact />}
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={loading} className="ml-auto text-slate-400 hover:text-slate-200 underline disabled:opacity-50">
            Refresh
          </button>
        )}
      </div>
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

export function LiquidationsPanel() {
  const [liq, setLiq] = useState<LiqData | null>(null)
  const [cached, setCached] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await fetchJsonSafe('/api/crypto/btc/liquidations')
    if (!mounted.current) return
    // Every outcome goes through the one transition; see nextLiqState.
    setLiq((prev) => nextLiqState(prev, result, new Date().toISOString()))
    // I2: a served-from-cache answer is badged; any other outcome clears it.
    setCached(result.ok && (result.data as { _cached?: boolean } | null)?._cached === true)
    setFetched(true)
    setLoading(false)
  }, [])

  useEffect(() => {
    mounted.current = true
    void load()
    const id = setInterval(() => { void load() }, LIQ_POLL_MS)
    return () => { mounted.current = false; clearInterval(id) }
  }, [load])

  return <LiquidationsView liq={liq} loading={loading} fetched={fetched} cached={cached} onRefresh={() => { void load() }} />
}
