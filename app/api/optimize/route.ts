/**
 * POST /api/optimize — bounded grid search or walk-forward–scored search over StrategyConfig paths.
 * Hard-capped for serverless (iterations + wall time).
 */

import { NextResponse } from 'next/server'
import { mergeStrategyConfig, validateStrategyConfig, type StrategyConfig } from '@/lib/strategy/strategyConfig'
import type { GridAxis } from '@/lib/optimize/gridSearch'
import { defaultAxesForPreset } from '@/lib/optimize/presetAxes'
import { executeBoundedOptimize } from '@/lib/optimize/executeOptimize'
import { buildRunAudit, newTraceId, configHashFromObject, logRunEvent } from '@/lib/infra/runAudit'
import { clientKeyFromRequest, rateLimitHit } from '@/lib/infra/rateLimit'

const ALLOWED_PATHS = new Set([
  'regime.smaPeriod',
  'confirmations.rsiBullThreshold',
  'stopLoss.stopLossAtrMultiplier',
  'stopLoss.stopLossFloor',
  'stopLoss.maxDrawdownCap',
  'stopLoss.positionCap',
])

export async function POST(request: Request) {
  const traceId = newTraceId('opt')
  try {
    if (rateLimitHit(`optimize:${clientKeyFromRequest(request)}`, 24, 60_000)) {
      return NextResponse.json({ error: 'Too many optimization requests — try again shortly.' }, { status: 429 })
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
      return NextResponse.json(
        { error: 'axes must be a non-empty array of { path, values:number[] }, or pass preset for default axes' },
        { status: 400 },
      )
    }
    if (axes.length > 3) {
      return NextResponse.json({ error: 'At most 3 axes allowed' }, { status: 400 })
    }
    for (const ax of axes) {
      if (!ax?.path || !ALLOWED_PATHS.has(ax.path)) {
        return NextResponse.json(
          { error: `path not allowed for optimization: ${ax?.path}. Allowed: ${[...ALLOWED_PATHS].join(', ')}` },
          { status: 400 },
        )
      }
      if (!Array.isArray(ax.values) || ax.values.length === 0 || ax.values.length > 5) {
        return NextResponse.json({ error: `Each axis must have 1–5 numeric values (${ax.path})` }, { status: 400 })
      }
    }

    const base = mergeStrategyConfig(partial)
    const validation = validateStrategyConfig(base)
    if (!validation.valid) {
      return NextResponse.json({ error: 'Invalid base config', validation }, { status: 400 })
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
      configHash: configHashFromObject({ partial, axes, objective, preset: presetName || null }),
      dataWindow: { firstBarUnix: out.firstBar, lastBarUnix: out.lastBar },
      iterationsRun: out.iterationsRun,
      maxIterations,
      maxMsBudget: maxMs,
      dataSource: 'yahoo_finance',
    })

    logRunEvent('info', 'optimize_complete', { traceId, iterationsRun: out.iterationsRun, runId: traceId })

    return NextResponse.json({
      ...out,
      computedAt: new Date().toISOString(),
      traceId,
      audit,
      validationWarnings: validation.warnings.length ? validation.warnings : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logRunEvent('error', 'optimize_failed', { traceId, message: msg, runId: traceId })
    console.error('[api/optimize]', e)
    if (msg.includes('Insufficient')) {
      return NextResponse.json({ error: msg, traceId }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'Optimization failed', message: msg, traceId },
      { status: 500 },
    )
  }
}
