'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { QUANT_LAB_TABS } from '@/components/stock/quantlab/constants'
import { useQuantLabFundamentals } from '@/components/stock/quantlab/hooks/useQuantLabFundamentals'
import { useQuantLabLlm } from '@/components/stock/quantlab/hooks/useQuantLabLlm'
import { FinancialsTab } from '@/components/stock/quantlab/tabs/FinancialsTab'
import { FrameworksTab } from '@/components/stock/quantlab/tabs/FrameworksTab'
import { LlmTab } from '@/components/stock/quantlab/tabs/LlmTab'
import { SummaryTab } from '@/components/stock/quantlab/tabs/SummaryTab'
import { TechnicalsTab } from '@/components/stock/quantlab/tabs/TechnicalsTab'
import { ValuationTab } from '@/components/stock/quantlab/tabs/ValuationTab'
import type { QuantLabSubTab } from '@/components/stock/quantlab/types'
import { formatFreshness } from '@/lib/format'

export default function QuantLabPanel({ ticker }: { ticker: string }) {
  const [sub, setSub] = useState<QuantLabSubTab>('summary')

  const fundamentals = useQuantLabFundamentals(ticker, sub)
  const llm = useQuantLabLlm(ticker, sub)

  const {
    data,
    err,
    loading,
    summaryOpen,
    setSummaryOpen,
    wacc,
    setWacc,
    tg,
    setTg,
    gBear,
    setGBear,
    gBase,
    setGBase,
    gBull,
    setGBull,
    adv,
    advLoading,
    kellyP,
    setKellyP,
    kellyWin,
    setKellyWin,
    kellyLoss,
    setKellyLoss,
    buildQuery,
    fetchPayload,
  } = fundamentals

  return (
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/80 to-slate-950/90 overflow-hidden shadow-2xl">
      <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-blue-400/90 font-semibold">Quant Lab</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 font-mono">{ticker}</span>
          </div>
          <h2 className="text-lg font-bold text-white mt-1">{data?.narrative?.name ?? ticker}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {data?.narrative?.sector}
            {data?.narrative?.industry ? ` · ${data.narrative.industry}` : ''}
          </p>
          {data?.fetchedAt && (
            <p className="text-[10px] text-slate-400 mt-1">Freshness: {formatFreshness(data.fetchedAt)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => fetchPayload(buildQuery())}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start px-3 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1 px-3 sm:px-4 py-2 border-b border-slate-800/80 bg-slate-950/40">
        {QUANT_LAB_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSub(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              sub === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {loading && !data && (
          <div className="space-y-3 animate-pulse">
            <div className="h-24 bg-slate-800/60 rounded-xl" />
            <div className="h-40 bg-slate-800/40 rounded-xl" />
          </div>
        )}
        {err && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200/90">
            {err}
            <p className="text-xs text-red-300/60 mt-2">
              ETFs and ADRs sometimes omit full statements; try a common US common stock (e.g. AAPL, MSFT).
            </p>
          </div>
        )}
        {data && sub === 'summary' && (
          <SummaryTab data={data} summaryOpen={summaryOpen} setSummaryOpen={setSummaryOpen} />
        )}
        {data && sub === 'technicals' && (
          <TechnicalsTab
            data={data}
            adv={adv}
            advLoading={advLoading}
            kellyP={kellyP}
            setKellyP={setKellyP}
            kellyWin={kellyWin}
            setKellyWin={setKellyWin}
            kellyLoss={kellyLoss}
            setKellyLoss={setKellyLoss}
          />
        )}
        {data && sub === 'financials' && <FinancialsTab data={data} />}
        {data && sub === 'valuation' && (
          <ValuationTab
            data={data}
            wacc={wacc}
            setWacc={setWacc}
            tg={tg}
            setTg={setTg}
            gBear={gBear}
            setGBear={setGBear}
            gBase={gBase}
            setGBase={setGBase}
            gBull={gBull}
            setGBull={setGBull}
            buildQuery={buildQuery}
            fetchPayload={fetchPayload}
          />
        )}
        {data && sub === 'frameworks' && <FrameworksTab />}
        {sub === 'llm' && <LlmTab {...llm} />}
      </div>
    </div>
  )
}
