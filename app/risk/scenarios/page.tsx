'use client'

import { CANNED_SCENARIOS, runAllScenarios, type PositionStub } from '@/lib/scenarios/engine'

const DEMO_POSITIONS: PositionStub[] = [
  { ticker: 'SPY', shares: 100, price: 500, delta: 100, vega: -2000 },
  { ticker: 'AAPL', shares: 50, price: 200, delta: 50, vega: 500 },
]

export default function ScenariosPage() {
  const results = runAllScenarios(DEMO_POSITIONS)

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-100">Stress scenarios</h1>
      <p className="text-sm text-slate-400">
        Six canned shocks ({CANNED_SCENARIOS.map((s) => s.label).join(', ')}). Demo portfolio — wire live positions in Phase 16.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-4 py-2">Scenario</th>
              <th className="px-4 py-2">P&amp;L</th>
              <th className="px-4 py-2">P&amp;L %</th>
              <th className="px-4 py-2">Δ</th>
              <th className="px-4 py-2">Vega</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.scenarioId} className="border-t border-slate-800 text-slate-200">
                <td className="px-4 py-2">{r.label}</td>
                <td className="px-4 py-2">{r.portfolioPnl.toFixed(0)}</td>
                <td className="px-4 py-2">{(r.portfolioPnlPct * 100).toFixed(2)}%</td>
                <td className="px-4 py-2">{r.greeks.delta.toFixed(1)}</td>
                <td className="px-4 py-2">{r.greeks.vega.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
