import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface MatrixWindow {
  years: number
  instruments: number
  totalReturn: number
  annualizedReturn: number
  winRate: number
  maxDrawdown: number
  sharpeRatio: number | null
  sortinoRatio: number | null
}

function main() {
  const gatesPath = join(process.cwd(), 'config', 'institutional-gates.json')
  const matrixPath = join(process.cwd(), 'artifacts', 'backtest-matrix.json')
  const gates = JSON.parse(readFileSync(gatesPath, 'utf-8')) as {
    thresholds: Record<string, number>
  }
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as {
    windows: MatrixWindow[]
  }

  const checks = matrix.windows.flatMap((w) => {
    const t = gates.thresholds
    return [
      { metricId: `A1_${w.years}y_ann_return`, pass: w.annualizedReturn >= t.A1_minAvgAnnReturn, measured: w.annualizedReturn, threshold: t.A1_minAvgAnnReturn },
      { metricId: `A2_${w.years}y_win_rate`, pass: w.winRate >= t.A2_minWinRate, measured: w.winRate, threshold: t.A2_minWinRate },
      { metricId: `B1_${w.years}y_max_dd`, pass: w.maxDrawdown <= t.B1_maxPortfolioDrawdown, measured: w.maxDrawdown, threshold: t.B1_maxPortfolioDrawdown },
      { metricId: `B3_${w.years}y_sharpe`, pass: (w.sharpeRatio ?? -1) >= t.B3_minSharpe, measured: w.sharpeRatio, threshold: t.B3_minSharpe },
      { metricId: `B3_${w.years}y_sortino`, pass: (w.sortinoRatio ?? -1) >= t.B3_minSortino, measured: w.sortinoRatio, threshold: t.B3_minSortino },
      { metricId: `D3_${w.years}y_coverage`, pass: w.instruments >= t.D3_minInstrumentsPerWindow, measured: w.instruments, threshold: t.D3_minInstrumentsPerWindow },
    ]
  })

  const summary = {
    generatedAt: new Date().toISOString(),
    checks,
    overallPass: checks.every((c) => c.pass),
  }
  const outDir = join(process.cwd(), 'artifacts')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, 'institutional-scorecard.json')
  writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8')
  console.log(`[scorecard] wrote ${outPath} overallPass=${summary.overallPass}`)
  if (!summary.overallPass) process.exitCode = 1
}

main()
