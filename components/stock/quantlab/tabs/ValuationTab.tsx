'use client'

import { Slider } from '@/components/stock/quantlab/ui'
import type { DcfScenario, QuantLabPayload } from '@/components/stock/quantlab/types'

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

/** Share of the value that comes from the terminal value (accountant S2: report it every time). */
function terminalShare(s: DcfScenario | null): string {
  if (!s || s.pvTerminal == null || !s.enterpriseValue) return '—'
  return `${((s.pvTerminal / s.enterpriseValue) * 100).toFixed(0)}%`
}

export function ValuationTab({
  data,
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
  buildQuery,
  fetchPayload,
}: {
  data: QuantLabPayload
  wacc: number
  setWacc: (v: number) => void
  tg: number
  setTg: (v: number) => void
  gBear: number
  setGBear: (v: number) => void
  gBase: number
  setGBase: (v: number) => void
  gBull: number
  setGBull: (v: number) => void
  buildQuery: () => string
  fetchPayload: (q: string) => Promise<void>
}) {
  const rates = data.dcf.inputs.scenarioRates
  return (
    <div className="space-y-6">
            <p className="text-xs text-slate-400">
              Adjust growth and discount assumptions; the server recomputes DCF scenarios and volatility-adaptive bands. This mirrors the <em>bear / base / bull</em> tables in your QUANTAN memos — not a single “true” fair value.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Slider label="Discount rate (cost of equity; one default for every company)" value={wacc} min={0.04} max={0.16} step={0.005} onChange={setWacc} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="Terminal growth" value={tg} min={0} max={0.045} step={0.005} onChange={setTg} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="FCF growth bear" value={gBear} min={-0.05} max={0.12} step={0.005} onChange={setGBear} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="FCF growth base" value={gBase} min={-0.05} max={0.15} step={0.005} onChange={setGBase} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="FCF growth bull" value={gBull} min={0} max={0.22} step={0.005} onChange={setGBull} fmt={(v) => `${(v * 100).toFixed(1)}%`} />
            </div>

            <button
              type="button"
              onClick={() => fetchPayload(buildQuery())}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium"
            >
              Recalculate
            </button>

            {(data.dcf.unavailable ?? data.dcf.notApplicable) && (
              <p role="status" data-testid="dcf-not-applicable" className="text-xs text-amber-300">
                No DCF: {data.dcf.unavailable ?? data.dcf.notApplicable}
              </p>
            )}
            {data.dcf.scenarioNote && (
              <p role="note" data-testid="dcf-scenario-note" className="text-xs text-slate-400">
                {data.dcf.scenarioNote}
              </p>
            )}
            <div className="rounded-xl border border-slate-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900/80 text-left text-xs text-slate-400 uppercase tracking-wider">
                    <th className="p-3">Scenario</th>
                    <th className="p-3 text-right font-mono">Rate</th>
                    <th className="p-3 text-right font-mono">Terminal share</th>
                    <th className="p-3 text-right font-mono">Implied / sh</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-slate-200">
                  <tr className="border-t border-slate-800">
                    <td className="p-3 text-red-300/90">Bear (higher discount rate, lower growth)</td>
                    <td className="p-3 text-right">{rates ? pct1(rates.bear) : '—'}</td>
                    <td className="p-3 text-right">{terminalShare(data.dcf.scenarios.bear)}</td>
                    <td className="p-3 text-right">
                      {data.dcf.scenarios.bear ? `$${data.dcf.scenarios.bear.valuePerShare.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-800">
                    <td className="p-3 text-slate-200">Base</td>
                    <td className="p-3 text-right">{rates ? pct1(rates.base) : '—'}</td>
                    <td className="p-3 text-right">{terminalShare(data.dcf.scenarios.base)}</td>
                    <td className="p-3 text-right">
                      {data.dcf.scenarios.base ? `$${data.dcf.scenarios.base.valuePerShare.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-800">
                    <td className="p-3 text-emerald-300/90">Bull (lower or equal discount rate, higher growth)</td>
                    <td className="p-3 text-right">{rates ? pct1(rates.bull) : '—'}</td>
                    <td className="p-3 text-right">{terminalShare(data.dcf.scenarios.bull)}</td>
                    <td className="p-3 text-right">
                      {data.dcf.scenarios.bull ? `$${data.dcf.scenarios.bull.valuePerShare.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-slate-400">DCF base anchor</div>
                <div className="font-mono text-white mt-1">{data.anchors.dcfBase != null ? `$${data.anchors.dcfBase.toFixed(2)}` : '—'}</div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-slate-400">Analyst mean target</div>
                <div className="font-mono text-white mt-1">
                  {data.anchors.analystTarget != null ? `$${data.anchors.analystTarget.toFixed(2)}` : '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 p-3">
                <div className="text-slate-400">Forward EPS × P/E heuristic</div>
                <div className="font-mono text-white mt-1">
                  {data.anchors.forwardEarningsHeuristic != null
                    ? `$${data.anchors.forwardEarningsHeuristic.toFixed(2)}`
                    : '—'}
                </div>
              </div>
            </div>

            <div className="text-[10px] text-slate-400 space-y-1">
              {/* Q-086: the second line said the DCF "ignores net cash/debt" — true only by
                  accident (the balance-sheet module has been empty since Nov 2024). It is an
                  FCFE model, which needs no debt bridge, and now says so. */}
              {/* Accountant B4: the vendor's definition of the field is not verified, so
                  the text says what the model ASSUMES rather than what the field is. */}
              <p>
                FCFE model: the cash flow is{' '}
                {data.dcf.inputs.fcf0Source === 'statement.ocfLessCapex'
                  ? <>the latest annual statement&apos;s operating cash flow less capex (Yahoo&apos;s <code>freeCashflow</code> field was absent)</>
                  : data.dcf.inputs.fcf0Source === 'statement.freeCashflow'
                    ? <>the latest annual statement&apos;s free cash flow (Yahoo&apos;s <code>freeCashflow</code> field was absent)</>
                    : <>Yahoo&apos;s <code>freeCashflow</code> field</>}
                , treated here as cash available to equity holders with no net borrowing. The vendor&apos;s exact definition is
                not verified by this platform. It is grown and discounted at the rate you set, with no net-debt bridge; the
                bear case also caps terminal growth at {rates ? pct1(rates.bearTerminalGrowth) : '2.0%'}. The 9% default is one
                placeholder for every company, not a company-specific cost of equity. Shares are Yahoo&apos;s basic{' '}
                <code>sharesOutstanding</code>, not diluted.
              </p>
            </div>
    </div>
  )
}
