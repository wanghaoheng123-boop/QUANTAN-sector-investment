import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function runStep(name: string, command: string): { name: string; command: string; pass: boolean; output: string } {
  try {
    const output = execSync(command, { stdio: 'pipe', encoding: 'utf-8' })
    return { name, command, pass: true, output }
  } catch (e) {
    const output =
      e instanceof Error && 'stdout' in e
        ? String((e as { stdout?: string; stderr?: string }).stdout ?? '') + String((e as { stdout?: string; stderr?: string }).stderr ?? '')
        : String(e)
    return { name, command, pass: false, output }
  }
}

function main() {
  const runId = `loop_${Date.now()}`
  const steps = [
    runStep('typecheck', 'npm run typecheck'),
    runStep('long_data_verify', 'npm run verify:data:long'),
    runStep('backtest_matrix', 'npx tsx scripts/backtest-matrix.ts'),
    runStep('scorecard_evaluate', 'npx tsx scripts/scorecard-evaluate.ts'),
  ]

  const scorecardPath = join(process.cwd(), 'artifacts', 'institutional-scorecard.json')
  let scorecardOverall = false
  try {
    const scorecard = JSON.parse(readFileSync(scorecardPath, 'utf-8')) as { overallPass: boolean }
    scorecardOverall = scorecard.overallPass
  } catch {
    scorecardOverall = false
  }

  const payload = {
    runId,
    generatedAt: new Date().toISOString(),
    steps,
    overallPass: steps.every((s) => s.pass) && scorecardOverall,
    nextActionForContinue: steps.every((s) => s.pass) && scorecardOverall
      ? 'Promote candidate and rerun loop after data refresh.'
      : 'Fix failed checks and rerun loop mission.',
  }

  const outDir = join(process.cwd(), 'artifacts', 'loop-mission')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${runId}.json`)
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`[loop] wrote ${outPath} overallPass=${payload.overallPass}`)
  if (!payload.overallPass) process.exitCode = 1
}

main()
