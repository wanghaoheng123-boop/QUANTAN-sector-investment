'use client'

import { useCallback, useEffect, useState } from 'react'
import type { QuantLabPayload, QuantLabSubTab } from '@/components/stock/quantlab/types'
import { QUANT_LAB_DEFAULT_QUERY } from '@/components/stock/quantlab/constants'

export type QuantLabAdvMetrics = {
  winRate252d: number | null
  betaVsSpyLogReturns: number | null
  correlationVsSpy1y: number | null
  dividendYield: number | null
  avgVolume3m: number | null
  note?: string
}

export function useQuantLabFundamentals(ticker: string, sub: QuantLabSubTab) {
  const [data, setData] = useState<QuantLabPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const [wacc, setWacc] = useState(0.09)
  const [tg, setTg] = useState(0.025)
  const [gBear, setGBear] = useState(0.02)
  const [gBase, setGBase] = useState(0.05)
  const [gBull, setGBull] = useState(0.09)

  const [adv, setAdv] = useState<QuantLabAdvMetrics | null>(null)
  const [advLoading, setAdvLoading] = useState(false)
  const [advFetched, setAdvFetched] = useState(false)

  const [kellyP, setKellyP] = useState(0.55)
  const [kellyWin, setKellyWin] = useState(1.2)
  const [kellyLoss, setKellyLoss] = useState(1)

  const buildQuery = useCallback(
    () => `wacc=${wacc}&tg=${tg}&gBear=${gBear}&gBase=${gBase}&gBull=${gBull}`,
    [wacc, tg, gBear, gBase, gBull],
  )

  const fetchPayload = useCallback(
    async (queryString: string) => {
      setLoading(true)
      setErr(null)
      try {
        const r = await fetch(`/api/fundamentals/${encodeURIComponent(ticker)}?${queryString}`)
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || r.statusText)
        setData(j)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Load failed')
        setData(null)
      } finally {
        setLoading(false)
      }
    },
    [ticker],
  )

  useEffect(() => {
    setWacc(0.09)
    setTg(0.025)
    setGBear(0.02)
    setGBase(0.05)
    setGBull(0.09)
    setAdv(null)
    setAdvFetched(false)
    fetchPayload(QUANT_LAB_DEFAULT_QUERY)
  }, [ticker, fetchPayload])

  useEffect(() => {
    if (sub !== 'technicals' || advFetched) return
    setAdvFetched(true)
    setAdvLoading(true)
    fetch(`/api/analytics/${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.error)
          setAdv({
            winRate252d: j.winRate252d ?? null,
            betaVsSpyLogReturns: j.betaVsSpyLogReturns ?? null,
            correlationVsSpy1y: j.correlationVsSpy1y ?? null,
            dividendYield: j.dividendYield ?? null,
            avgVolume3m: j.avgVolume3m ?? null,
            note: j.note,
          })
      })
      .catch((fetchErr) => {
        console.warn('[QuantLabPanel] advanced metrics fetch failed for', ticker, fetchErr)
      })
      .finally(() => setAdvLoading(false))
  }, [sub, ticker, advFetched])

  return {
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
  }
}
