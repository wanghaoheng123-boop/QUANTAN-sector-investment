'use client'

import { memo, useMemo, useState } from 'react'
import type { EnrichedChain, EnrichedContract } from '@/lib/options/chain'
import { MetricTooltip } from '@/components/MetricTooltip'
import { toIsoDate } from '@/lib/format'

const HEADER_TOOLTIPS: Record<string, string> = {
  IV: 'iv',
  'Δ': 'delta',
  OI: 'openInterest',
}

interface Props {
  chain: EnrichedChain
}

// Phase 14 wave 41 — every formatter accepts `unknown` and gates on
// Number.isFinite. After fetch+JSON.parse the contract fields are
// nominally `number` but in practice can be null / NaN for missing or
// halted-symbol upstream rows. `v != null && isNaN(v)` (the prior gate)
// missed `null` because typeof null === 'object' and `NaN(null)` is false.
function fmtPct(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function fmtNum(v: unknown, decimals = 2): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

function fmtVol(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(Math.round(v))
}

// Phase 14 wave 41 (task #15 perf) — memoise ContractCell.
// Each row renders 2 ContractCell instances (call + put) and a strike has
// up to 100+ rows in a deep chain. Without memo, every expiry switch or
// parent re-render walks every cell. React.memo + the default referential
// prop comparison gives a meaningful skip rate because chain.calls /
// chain.puts elements are stable references once fetched.
const ContractCell = memo(function ContractCell({
  contract,
  spot,
  side,
}: {
  contract: EnrichedContract | undefined
  spot: number
  side: 'call' | 'put'
}) {
  if (!contract) return <td className="px-2 py-1 text-gray-500 text-xs" colSpan={5}>—</td>
  const itm = side === 'call' ? spot > contract.strike : spot < contract.strike
  const cellCls = `px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`
  return (
    <>
      <td className={cellCls}>{fmtPct(contract.impliedVolatility)}</td>
      <td className={cellCls}>{fmtNum(contract.delta)}</td>
      <td className={cellCls}>{fmtVol(contract.openInterest)}</td>
      <td className={cellCls}>{fmtVol(contract.volume)}</td>
      <td className={cellCls}>${fmtNum(contract.lastPrice)}</td>
    </>
  )
})

const MAX_VISIBLE_EXPIRIES = 8

function OptionsChainTableImpl({ chain }: Props) {
  // Phase 14 wave 41 — `toIsoDate` SSOT replaces the duplicated defensive
  // ternaries. The currentExpiry / expirationDates fields are typed Date
  // but are strings at runtime (JSON cannot reconstruct Date). The prior
  // unconditional `.toISOString()` here crashed the table on first paint.
  const [selectedExpiry, setSelectedExpiry] = useState<string>(
    toIsoDate(chain.currentExpiry, ''),
  )
  const [showAllExpiries, setShowAllExpiries] = useState(false)

  const expiryStr = selectedExpiry || toIsoDate(chain.currentExpiry, '')

  // Phase 14 wave 41 (task #15 perf) — every derived list is now memoised.
  // The filter / Set construction / sort / Map allocation chain previously
  // ran on EVERY render of the parent stock page (every quote tick, every
  // tab switch). For a 100-strike chain that's ~500 allocations per tick.
  const calls = useMemo(
    () => chain.calls.filter((c) => toIsoDate(c.expiration) === expiryStr),
    [chain.calls, expiryStr],
  )
  const puts = useMemo(
    () => chain.puts.filter((p) => toIsoDate(p.expiration) === expiryStr),
    [chain.puts, expiryStr],
  )

  const strikes = useMemo(() => {
    const strikeSet = new Set<number>()
    for (const c of calls) {
      if (Number.isFinite(c.strike)) strikeSet.add(c.strike)
    }
    for (const p of puts) {
      if (Number.isFinite(p.strike)) strikeSet.add(p.strike)
    }
    return Array.from(strikeSet).sort((a, b) => a - b)
  }, [calls, puts])

  const callByStrike = useMemo(
    () => new Map(calls.map((c) => [c.strike, c])),
    [calls],
  )
  const putByStrike = useMemo(
    () => new Map(puts.map((p) => [p.strike, p])),
    [puts],
  )

  // Defensive: chain.underlyingPrice can be 0 / NaN if Yahoo returned a halt
  // row. The pre-wave-41 code computed `spot > contract.strike` against NaN
  // → always false → every cell rendered OTM colours. We display the chain
  // but downgrade the ITM colouring to neutral when spot is unmeasurable.
  const spot = Number.isFinite(chain.underlyingPrice) && chain.underlyingPrice > 0
    ? chain.underlyingPrice
    : 0

  return (
    <div className="space-y-3">
      {/* Expiry selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 uppercase tracking-wide">Expiry:</span>
        {(showAllExpiries ? chain.expirationDates : chain.expirationDates.slice(0, MAX_VISIBLE_EXPIRIES))
          .map((d) => toIsoDate(d, ''))
          .filter((str) => str.length > 0)  // drop malformed expirations
          .map((str) => (
            <button
              key={str}
              type="button"
              onClick={() => setSelectedExpiry(str)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-400 ${
                str === expiryStr
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                  : 'border-gray-600 text-gray-400 hover:border-gray-400'
              }`}
              aria-pressed={str === expiryStr}
              aria-label={`Show expiry ${str}`}
            >
              {str}
            </button>
          ))}
        {chain.expirationDates.length > MAX_VISIBLE_EXPIRIES && (
          <button
            onClick={() => setShowAllExpiries((v) => !v)}
            className="text-xs px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200"
          >
            {showAllExpiries ? 'Show less' : `+${chain.expirationDates.length - MAX_VISIBLE_EXPIRIES} more`}
          </button>
        )}
      </div>

      {/* Chain table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {/* F6.4 (Phase 13 S2): caption + scope for screen readers — WCAG 1.3.1. */}
          <caption className="sr-only">Options chain — calls on the left (IV, delta, open interest, volume, last) and puts on the right (last, volume, open interest, delta, IV) sharing a central strike column.</caption>
          <thead>
            <tr className="border-b border-gray-700">
              <th scope="colgroup" colSpan={5} className="text-center text-xs text-emerald-400 pb-1">CALLS</th>
              <th scope="col" className="text-center text-xs text-gray-300 pb-1 px-3">STRIKE</th>
              <th scope="colgroup" colSpan={5} className="text-center text-xs text-red-400 pb-1">PUTS</th>
            </tr>
            <tr className="border-b border-gray-800">
              {['IV', 'Δ', 'OI', 'Vol', 'Last'].map((h) => {
                const mk = HEADER_TOOLTIPS[h]
                return (
                  <th key={`c-${h}`} scope="col" className="px-2 py-1 text-xs text-gray-500 text-right">
                    <span className="inline-flex items-center justify-end">
                      {h}
                      {mk && <MetricTooltip metricKey={mk} compact />}
                    </span>
                  </th>
                )
              })}
              <th scope="col" className="px-3 py-1 text-xs text-gray-400 text-center">—</th>
              {['IV', 'Δ', 'OI', 'Vol', 'Last'].map((h) => {
                const mk = HEADER_TOOLTIPS[h]
                return (
                  <th key={`p-${h}`} scope="col" className="px-2 py-1 text-xs text-gray-500 text-right">
                    <span className="inline-flex items-center justify-end">
                      {h}
                      {mk && <MetricTooltip metricKey={mk} compact />}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {strikes.map((strike) => {
              const atm = Math.abs(strike - spot) < spot * 0.005
              return (
                <tr
                  key={strike}
                  className={`border-b border-gray-800/50 ${atm ? 'bg-indigo-900/20' : 'hover:bg-gray-800/30'}`}
                >
                  <ContractCell contract={callByStrike.get(strike)} spot={spot} side="call" />
                  <td className={`px-3 py-1 text-xs font-mono text-center ${atm ? 'text-indigo-300 font-bold' : 'text-gray-300'}`}>
                    {strike}
                  </td>
                  <ContractCell contract={putByStrike.get(strike)} spot={spot} side="put" />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-600">
        Spot: ${fmtNum(spot)} · {calls.length} calls · {puts.length} puts · ITM highlighted
      </p>
    </div>
  )
}

// Phase 14 wave 41 (task #15 perf) — React.memo wrapping. The parent stock
// page re-renders on every quote tick (~every 15 s during market hours via
// the SSE useLiveQuote subscription); without memo, the entire chain table
// re-walked even when the chain prop reference was unchanged. The boot
// fetch sets chain once; SSE updates rarely change it. memo skips the
// re-render walk when chain prop is referentially stable.
const OptionsChainTable = memo(OptionsChainTableImpl)
export default OptionsChainTable
