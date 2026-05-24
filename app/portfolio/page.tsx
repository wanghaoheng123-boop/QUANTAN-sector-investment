import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import Link from 'next/link'
import { TailRiskBanner } from '@/components/risk/TailRiskBanner'

interface PortfolioBacktestJson {
  computedAt?: string
  ranking?: { label: string; metrics: { winRate: number; maxDrawdown: number; sharpe?: number } }[]
}

function loadPortfolioResults(): PortfolioBacktestJson | null {
  try {
    const p = join(process.cwd(), 'scripts/portfolio-backtest-results.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8')) as PortfolioBacktestJson
  } catch {
    return null
  }
}

export default function PortfolioPage() {
  const data = loadPortfolioResults()
  const best = data?.ranking?.[0]

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-100">Portfolio dashboard</h1>
        <Link href="/risk/scenarios" className="text-sm text-cyan-400 hover:underline">
          Stress scenarios →
        </Link>
      </div>
      <TailRiskBanner />
      {!best ? (
        <p className="text-slate-400 text-sm">
          Run <code className="text-cyan-300">npm run portfolio:backtest</code> to populate metrics.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500 uppercase">Best config</p>
            <p className="text-lg text-slate-100 font-medium">{best.label}</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500 uppercase">Win rate</p>
            <p className="text-lg text-emerald-400">{(best.metrics.winRate * 100).toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-500 uppercase">Max drawdown</p>
            <p className="text-lg text-amber-400">{(best.metrics.maxDrawdown * 100).toFixed(2)}%</p>
          </div>
        </div>
      )}
      {data?.computedAt && <p className="text-xs text-slate-500">Computed {data.computedAt}</p>}
      <Link href="/portfolio/factor-attribution" className="text-sm text-cyan-400 hover:underline">
        Factor attribution →
      </Link>
    </main>
  )
}
