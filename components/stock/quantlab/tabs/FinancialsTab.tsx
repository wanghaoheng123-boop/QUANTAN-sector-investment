'use client'

import { fmtB } from '@/components/stock/quantlab/formatters'
import type { QuantLabPayload } from '@/components/stock/quantlab/types'

export function FinancialsTab({ data }: { data: QuantLabPayload }) {
  return (
    <div className="space-y-6">
            <h3 className="text-sm font-semibold text-white">Balance sheet (annual snapshots)</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800 text-left">
                    <th className="p-2">Period</th>
                    <th className="p-2 text-right">Assets</th>
                    <th className="p-2 text-right">Liabilities</th>
                    <th className="p-2 text-right">Equity</th>
                    <th className="p-2 text-right">Cash</th>
                    <th className="p-2 text-right">LT debt</th>
                    <th className="p-2 text-right">C. assets</th>
                    <th className="p-2 text-right">C. liab.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((b, i) => (
                    <tr key={i} className="border-b border-slate-800/60 text-slate-300">
                      <td className="p-2 text-slate-500">{b.endDate ?? '—'}</td>
                      <td className="p-2 text-right">{fmtB(b.totalAssets)}</td>
                      <td className="p-2 text-right">{fmtB(b.totalLiab)}</td>
                      <td className="p-2 text-right">{fmtB(b.equity)}</td>
                      <td className="p-2 text-right">{fmtB(b.cash)}</td>
                      <td className="p-2 text-right">{fmtB(b.longTermDebt)}</td>
                      <td className="p-2 text-right">{fmtB(b.currentAssets)}</td>
                      <td className="p-2 text-right">{fmtB(b.currentLiab)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-semibold text-white">Income (annual snapshots)</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800 text-left">
                    <th className="p-2">Period</th>
                    <th className="p-2 text-right">Revenue</th>
                    <th className="p-2 text-right">Gross profit</th>
                    <th className="p-2 text-right">Net income</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incomes.map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/60 text-slate-300">
                      <td className="p-2 text-slate-500">{r.endDate ?? '—'}</td>
                      <td className="p-2 text-right">{fmtB(r.revenue)}</td>
                      <td className="p-2 text-right">{fmtB(r.grossProfit)}</td>
                      <td className="p-2 text-right">{fmtB(r.netIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
    </div>
  )
}
