/**
 * Standard audit / trace envelope for backtest, simulator, and optimize runs.
 * No secrets — only reproducibility metadata.
 */

import { createHash } from 'crypto'

export const CURRENT_STRATEGY_SCHEMA_VERSION = 2

export interface RunAudit {
  runId: string
  traceId: string
  computedAt: string
  strategySchemaVersion: number
  /** SHA-256 prefix of normalized config JSON (16 hex chars). */
  configHash?: string
  dataWindow?: { firstBarUnix?: number; lastBarUnix?: number }
  /** CI / Vercel commit when available. */
  buildSha?: string | null
  iterationsRun?: number
  maxIterations?: number
  maxMsBudget?: number
  dataSource?: string
}

export function newTraceId(prefix = 'tr'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

export function configHashFromObject(obj: unknown): string {
  const s = JSON.stringify(obj, Object.keys(obj as object).sort())
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

export function buildRunAudit(p: Omit<RunAudit, 'computedAt' | 'strategySchemaVersion'> & Partial<Pick<RunAudit, 'strategySchemaVersion'>>): RunAudit {
  return {
    computedAt: new Date().toISOString(),
    strategySchemaVersion: p.strategySchemaVersion ?? CURRENT_STRATEGY_SCHEMA_VERSION,
    ...p,
    buildSha: p.buildSha ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
  }
}

/** Structured single-line log for observability (Phase 18). */
export function logRunEvent(level: 'info' | 'warn' | 'error', event: string, audit: Partial<RunAudit> & { message?: string }) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...audit })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
