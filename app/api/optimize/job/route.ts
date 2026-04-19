/**
 * POST /api/optimize/job — same bounded work as /api/optimize, returns a stable job id + cached payload for polling.
 * GET /api/optimize/job?id=… — retrieve completed payload (in-memory, per-instance, ~15 min intent).
 */

import { NextResponse } from 'next/server'
import { mergeStrategyConfig, validateStrategyConfig, type StrategyConfig } from '@/lib/strategy/strategyConfig'
import type { GridAxis } from '@/lib/optimize/gridSearch'
import { defaultAxesForPreset } from '@/lib/optimize/presetAxes'
import { executeBoundedOptimize } from '@/lib/optimize/executeOptimize'
import { buildRunAudit, newTraceId, configHashFromObject, logRunEvent } from '@/lib/infra/runAudit'
import { getJob, putCompletedJob, putFailedJob } from '@/lib/optimize/jobStore'
import { clientKeyFromRequest, rateLimitHit } from '@/lib/infra/rateLimit'

const ALLOWED_PATHS = new Set([
  'regime.smaPeriod',
  'confirmations.rsiBullThreshold',
  'stopLoss.stopLossAtrMultiplier',
  'stopLoss.stopLossFloor',
  'stopLoss.maxDrawdownCap',
  'stopLoss.positionCap',
])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ error: 'id query parameter required' }, { status: 400 })
  }
  const job = getJob(id)
  if (!job) {
    return NextResponse.json({ error: 'job not found or expired' }, { status: 404 })
  }
  return NextResponse.json(job)
}

export async function POST(request: Request) {
  const traceId = newTraceId('optjob')
  try {
    if (rateLimitHit(`optimize_job:${clientKeyFromRequest(request)}`, 12, 60_000)) {
      return NextResponse.json({ error: 'Too many job requests — try again shortly.' }, { status: 429 })
    }

    const body = await request.json()
    const ticker = String(body.ticker ?? '').trim().toUpperCase()
    const sector = String(body.sector ?? 'Custom').trim() || 'Custom'
    const partial = (body.config ?? {}) as Partial<StrategyConfig>
    let axes = body.axes as GridAxis[] | undefined
    const presetName = body.preset != null ? String(body.preset) : ''
    if (!axes?.length && presetName) {
      axes = defaultAxesForPreset(presetName)
    }
    const lookbackDays = Math.min(2000, Math.max(252, Number(body.lookbackDays) || 1260))
    const maxIterations = Math.min(80, Math.max(4, Number(body.maxIterations) || 40))
    const maxMs = Math.min(45_000, Math.max(3000, Number(body.maxMs) || 18_000))
    const objective = body.objective === 'walk_forward' ? 'walk_forward' : 'full'

    if (!ticker) {
      return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
    }
    if (!Array.isArray(axes) || axes.length === 0) {
      return NextResponse.json({ error: 'axes or preset required' }, { status: 400 })
    }
    if (axes.length > 3) {
      return NextResponse.json({ error: 'At most 3 axes allowed' }, { status: 400 })
    }
    for (const ax of axes) {
      if (!ax?.path || !ALLOWED_PATHS.has(ax.path)) {
        return NextResponse.json({ error: `path not allowed: ${ax?.path}` }, { status: 400 })
      }
      if (!Array.isArray(ax.values) || ax.values.length === 0 || ax.values.length > 5) {
        return NextResponse.json({ error: `Invalid values for ${ax.path}` }, { status: 400 })
      }
    }

    const base = mergeStrategyConfig(partial)
    const validation = validateStrategyConfig(base)
    if (!validation.valid) {
      const job = putFailedJob('Invalid base config')
      return NextResponse.json({ jobId: job.id, status: job.status, traceId, error: 'Invalid base config', validation }, { status: 400 })
    }

    const out = await executeBoundedOptimize({
      ticker,
      sector,
      partial,
      axes,
      lookbackDays,
      maxIterations,
      maxMs,
      objective,
    })

    const audit = buildRunAudit({
      runId: traceId,
      traceId,
      configHash: configHashFromObject({ partial, axes, objective }),
      dataWindow: { firstBarUnix: out.firstBar, lastBarUnix: out.lastBar },
      iterationsRun: out.iterationsRun,
      maxIterations,
      maxMsBudget: maxMs,
      dataSource: 'yahoo_finance',
    })

    const payload = {
      ...out,
      computedAt: new Date().toISOString(),
      traceId,
      audit,
    }
    const job = putCompletedJob(payload)
    logRunEvent('info', 'optimize_job_complete', { traceId, runId: job.id })

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      traceId,
      pollUrl: `/api/optimize/job?id=${encodeURIComponent(job.id)}`,
      audit,
      /** Same payload as GET for convenience when polling is not needed. */
      result: payload,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const job = putFailedJob(msg)
    logRunEvent('error', 'optimize_job_failed', { traceId, message: msg, runId: job.id })
    return NextResponse.json(
      { jobId: job.id, status: job.status, traceId, error: msg },
      { status: 500 },
    )
  }
}
