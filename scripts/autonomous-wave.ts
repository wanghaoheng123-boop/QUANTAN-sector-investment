import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type StepResult = {
  name: string
  command: string
  pass: boolean
  durationMs: number
  output: string
  artifact?: string
  artifactExists?: boolean
}

type ExpertNote = {
  role: 'quant_reviewer' | 'risk_auditor' | 'pm_critic' | 'performance_optimizer' | 'safety_guard'
  score: number
  finding: string
  recommendation: string
}

type CycleReport = {
  cycleId: string
  cycleIndex: number
  startedAt: string
  endedAt: string
  elapsedMs: number
  goalHours: number
  missionPass: boolean
  steps: StepResult[]
  experts: ExpertNote[]
  nextActions: string[]
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function runStep(name: string, command: string, artifact?: string): StepResult {
  const started = Date.now()
  try {
    const output = execSync(command, { stdio: 'pipe', encoding: 'utf-8' })
    const artifactExists = artifact ? existsSync(artifact) : undefined
    const pass = artifact ? Boolean(artifactExists) : true
    return {
      name,
      command,
      pass,
      durationMs: Date.now() - started,
      output,
      artifact,
      artifactExists,
    }
  } catch (error) {
    const output =
      error instanceof Error && 'stdout' in error
        ? String((error as { stdout?: string; stderr?: string }).stdout ?? '') +
          String((error as { stdout?: string; stderr?: string }).stderr ?? '')
        : String(error)
    const artifactExists = artifact ? existsSync(artifact) : undefined
    return {
      name,
      command,
      pass: false,
      durationMs: Date.now() - started,
      output,
      artifact,
      artifactExists,
    }
  }
}

function expertReview(artifactsDir: string): { notes: ExpertNote[]; nextActions: string[] } {
  const matrix = readJson<{
    windows?: Array<{
      years: number
      winRate: number
      annualizedReturn: number
      maxDrawdown: number
      sharpeRatio: number | null
      sortinoRatio: number | null
      instruments: number
    }>
  }>(join(artifactsDir, 'backtest-matrix.json'))
  const scorecard = readJson<{ overallPass?: boolean; checks?: Array<{ metricId?: string; pass?: boolean }> }>(
    join(artifactsDir, 'institutional-scorecard.json'),
  )
  const ranking = readJson<{ strictQualified?: number }>(join(artifactsDir, 'institutional-ranking-strict.json'))
  const optimize = readJson<{ topConfigs?: Array<{ winRate?: number; sharpe?: number | null; maxDD?: number }> }>(
    join(artifactsDir, 'signal-param-optimization.json'),
  )

  const notes: ExpertNote[] = []
  const nextActions: string[] = []

  const windows = matrix?.windows ?? []
  const sharpeValues = windows.map((w) => asFiniteNumber(w.sharpeRatio)).filter((v): v is number => v != null)
  const minSharpe = sharpeValues.length ? Math.min(...sharpeValues) : null
  const minWinRate = windows.length ? Math.min(...windows.map((w) => w.winRate)) : null
  const maxDD = windows.length ? Math.max(...windows.map((w) => w.maxDrawdown)) : null

  notes.push({
    role: 'quant_reviewer',
    score: minSharpe == null ? 45 : minSharpe >= 0.5 ? 85 : minSharpe >= 0 ? 70 : 50,
    finding:
      minSharpe == null
        ? 'Backtest matrix missing or invalid; cannot validate long-window robustness.'
        : `Minimum window Sharpe=${minSharpe.toFixed(2)}, minimum window win-rate=${((minWinRate ?? 0) * 100).toFixed(1)}%.`,
    recommendation:
      minSharpe == null || minSharpe < 0.25
        ? 'Prioritize parameter re-optimization and run walk-forward stress checks before changing production defaults.'
        : 'Current risk-adjusted profile is acceptable; keep iterating via constrained optimization.',
  })

  const failedChecks = (scorecard?.checks ?? []).filter((c) => c.pass === false).map((c) => c.metricId ?? 'unknown')
  notes.push({
    role: 'risk_auditor',
    score: scorecard?.overallPass ? 90 : Math.max(35, 85 - failedChecks.length * 8),
    finding: scorecard?.overallPass
      ? 'Institutional scorecard passes for current profile.'
      : `Scorecard has ${failedChecks.length} failed checks.`,
    recommendation: scorecard?.overallPass
      ? 'Proceed with controlled promotion workflow after final sanity run.'
      : `Fix failed checks first: ${failedChecks.slice(0, 5).join(', ')}${failedChecks.length > 5 ? ' ...' : ''}.`,
  })

  const strictQualified = asFiniteNumber(ranking?.strictQualified)
  notes.push({
    role: 'pm_critic',
    score: strictQualified == null ? 40 : strictQualified >= 10 ? 85 : strictQualified >= 5 ? 70 : 55,
    finding:
      strictQualified == null
        ? 'Unable to evaluate ranking output; strict-qualified count artifact is missing.'
        : `Strict-qualified opportunities=${strictQualified}.`,
    recommendation:
      strictQualified == null || strictQualified < 5
        ? 'Improve ranking stability and explainability before expanding UI claims.'
        : 'Update app messaging with transparent confidence/risk context from latest ranking outputs.',
  })

  const top = optimize?.topConfigs?.[0]
  const topWinRate = asFiniteNumber(top?.winRate)
  const topSharpe = asFiniteNumber(top?.sharpe)
  notes.push({
    role: 'performance_optimizer',
    score: topWinRate == null ? 50 : topWinRate >= 0.58 ? 85 : topWinRate >= 0.55 ? 75 : 60,
    finding:
      topWinRate == null
        ? 'No optimization artifact yet; tuning effectiveness unknown.'
        : `Best tuned config win-rate=${(topWinRate * 100).toFixed(1)}%, Sharpe=${topSharpe?.toFixed(2) ?? 'n/a'}.`,
    recommendation:
      topWinRate == null || topWinRate < 0.55
        ? 'Expand constrained grid search around RSI/ATR/confirmation and compare out-of-sample slices.'
        : 'Persist top parameter set as candidate preset and validate in fresh holdout window.',
  })

  const hasInvalidNumerics =
    windows.some(
      (w) =>
        asFiniteNumber(w.annualizedReturn) == null ||
        asFiniteNumber(w.winRate) == null ||
        asFiniteNumber(w.maxDrawdown) == null,
    ) || (top != null && (asFiniteNumber(top.maxDD) == null || asFiniteNumber(top.winRate) == null))

  notes.push({
    role: 'safety_guard',
    score: hasInvalidNumerics ? 35 : 90,
    finding: hasInvalidNumerics
      ? 'Detected invalid numeric values (NaN/non-finite) in analysis artifacts.'
      : 'No invalid numeric values detected in key artifacts.',
    recommendation: hasInvalidNumerics
      ? 'Block promotion and investigate metric computation pipeline immediately.'
      : 'Keep hard promotion gate on scorecard pass + finite-metric checks.',
  })

  for (const note of notes) {
    if (note.score < 70) {
      nextActions.push(`[${note.role}] ${note.recommendation}`)
    }
  }
  if (nextActions.length === 0) {
    nextActions.push('All expert gates are acceptable; continue periodic autonomous cycles and monitor drift.')
  }

  return { notes, nextActions }
}

function sleep(ms: number) {
  execSync(`node -e "setTimeout(() => process.exit(0), ${Math.max(1, Math.floor(ms))})"`, { stdio: 'ignore' })
}

function runCycle(cycleIndex: number, goalHours: number): CycleReport {
  const cycleId = `autowave_${Date.now()}_${cycleIndex}`
  const startedAt = new Date().toISOString()
  const artifactsDir = join(process.cwd(), 'artifacts')
  const loopMissionDir = join(process.cwd(), 'artifacts', 'loop-mission')

  const steps: StepResult[] = [
    runStep('loop_mission', 'npm run loop:mission'),
    runStep('optimize_signals', 'npm run optimize:signals', join(artifactsDir, 'signal-param-optimization.json')),
  ]

  const review = expertReview(artifactsDir)
  const missionPass = steps.every((s) => s.pass)
  const endedAt = new Date().toISOString()

  const report: CycleReport = {
    cycleId,
    cycleIndex,
    startedAt,
    endedAt,
    elapsedMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    goalHours,
    missionPass,
    steps,
    experts: review.notes,
    nextActions: review.nextActions,
  }

  mkdirSync(loopMissionDir, { recursive: true })
  const outDir = join(process.cwd(), 'artifacts', 'autonomous-wave')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${cycleId}.json`), JSON.stringify(report, null, 2), 'utf-8')
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf-8')
  return report
}

function main() {
  const goalHours = Math.max(0.25, Number(process.env.QUANTAN_AUTONOMOUS_HOURS ?? '5'))
  const cycleDelaySec = Math.max(5, Number(process.env.QUANTAN_AUTONOMOUS_DELAY_SEC ?? '45'))
  const hardDeadlineMs = Date.now() + goalHours * 60 * 60 * 1000
  let cycleIndex = 0
  let failuresInRow = 0

  console.log(`[autowave] start duration=${goalHours}h delay=${cycleDelaySec}s`)
  while (Date.now() < hardDeadlineMs) {
    cycleIndex += 1
    const report = runCycle(cycleIndex, goalHours)
    const avgExpertScore = report.experts.reduce((sum, x) => sum + x.score, 0) / Math.max(1, report.experts.length)
    console.log(
      `[autowave] cycle=${cycleIndex} pass=${report.missionPass} avgExpertScore=${avgExpertScore.toFixed(1)} next="${report.nextActions[0]}"`,
    )

    if (!report.missionPass) {
      failuresInRow += 1
      if (failuresInRow >= 4) {
        console.warn('[autowave] repeated failures detected; continuing with cooldown to avoid thrashing.')
        sleep(Math.min(300, cycleDelaySec * 4) * 1000)
      } else {
        sleep(cycleDelaySec * 1000)
      }
      continue
    }

    failuresInRow = 0
    sleep(cycleDelaySec * 1000)
  }

  console.log(`[autowave] complete cycles=${cycleIndex}`)
}

main()
