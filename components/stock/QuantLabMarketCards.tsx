/** Extracted market summary cards from QuantLabPanel (Q-008 partial). */
'use client'

import { formatCurrency } from '@/lib/format'

export function QuantLabMarketCards({
  market,
}: {
  market: Record<string, number | null | undefined>
}) {
  const price = market.regularMarketPrice ?? market.price
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-lg border border-slate-800 p-3">
        <p className="text-xs text-slate-500">Price</p>
        <p className="text-lg text-slate-100">{price != null ? formatCurrency(price) : '—'}</p>
      </div>
      <div className="rounded-lg border border-slate-800 p-3">
        <p className="text-xs text-slate-500">Market cap</p>
        <p className="text-lg text-slate-100">
          {market.marketCap != null ? formatCurrency(market.marketCap) : '—'}
        </p>
      </div>
    </div>
  )
}
