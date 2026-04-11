'use client'

import { useState } from 'react'
import type { EnrichedChain, EnrichedContract } from '@/lib/options/chain'

interface Props {
  chain: EnrichedChain
}

function fmtPct(v: number | undefined): string {
  if (v == null || isNaN(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function fmtNum(v: number | undefined | null, decimals = 2): string {
  if (v == null || isNaN(v as number)) return '—'
  return (v as number).toFixed(decimals)
}

function fmtVol(v: number | undefined): string {
  if (v == null) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

function ContractCell({
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
  return (
    <>
      <td className={`px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`}>
        {fmtPct(contract.impliedVolatility)}
      </td>
      <td className={`px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`}>
        {fmtNum(contract.delta)}
      </td>
      <td className={`px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`}>
        {fmtVol(contract.openInterest)}
      </td>
      <td className={`px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`}>
        {fmtVol(contract.volume)}
      </td>
      <td className={`px-2 py-1 text-xs tabular-nums text-right ${itm ? 'text-emerald-400' : 'text-gray-300'}`}>
        ${fmtNum(contract.lastPrice)}
      </td>
    </>
  )
}

export default function OptionsChainTable({ chain }: Props) {
  const [selectedExpiry, setSelectedExpiry] = useState<string>(
    chain.currentExpiry ? chain.currentExpiry.toISOString().slice(0, 10) : '',
  )

  const expiryStr = selectedExpiry || (chain.currentExpiry ? chain.currentExpiry.toISOString().slice(0, 10) : '')
  const calls = chain.calls.filter(
    (c) => c.expiration instanceof Date
      ? c.expiration.toISOString().slice(0, 10) === expiryStr
      : new Date(c.expiration).toISOString().slice(0, 10) === expiryStr,
  )
  const puts = chain.puts.filter(
    (p) => p.expiration instanceof Date
      ? p.expiration.toISOString().slice(0, 10) === expiryStr
      : new Date(p.expiration).toISOString().slice(0, 10) === expiryStr,
  )

  // Build unified strike list
  const strikeSet = new Set<number>()
  calls.forEach((c) => strikeSet.add(c.strike))
  puts.forEach((p) => strikeSet.add(p.strike))
  const strikes = Array.from(strikeSet).sort((a, b) => a - b)

  const callByStrike = new Map(calls.map((c) => [c.strike, c]))
  const putByStrike  = new Map(puts.map((p) => [p.strike, p]))
  const spot = chain.underlyingPrice

  return (
    <div className="space-y-3">
      {/* Expiry selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400 uppercase tracking-wide">Expiry:</span>
        {chain.expirationDates.slice(0, 8).map((d) => {
          const str = d instanceof Date ? d.toISOString().slice(0, 10) : new Date(d).toISOString().slice(0, 10)
          return (
            <button
              key={str}
              onClick={() => setSelectedExpiry(str)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                str === expiryStr
                  ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                  : 'border-gray-600 text-gray-400 hover:border-gray-400'
              }`}
            >
              {str}
            </button>
          )
        })}
      </div>

      {/* Chain table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th colSpan={5} className="text-center text-xs text-emerald-400 pb-1">CALLS</th>
              <th className="text-center text-xs text-gray-300 pb-1 px-3">STRIKE</th>
              <th colSpan={5} className="text-center text-xs text-red-400 pb-1">PUTS</th>
            </tr>
            <tr className="border-b border-gray-800">
              {['IV', 'Δ', 'OI', 'Vol', 'Last'].map((h) => (
                <th key={`c-${h}`} className="px-2 py-1 text-xs text-gray-500 text-right">{h}</th>
              ))}
              <th className="px-3 py-1 text-xs text-gray-400 text-center">—</th>
              {['IV', 'Δ', 'OI', 'Vol', 'Last'].map((h) => (
                <th key={`p-${h}`} className="px-2 py-1 text-xs text-gray-500 text-right">{h}</th>
              ))}
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
