/**
 * Q-067 — shadow signal log (timestamp, content hash, actions).
 *
 * Append-only audit trail of what the LIVE signal path actually served, so
 * live-vs-backtest divergence questions can be answered from evidence
 * instead of reconstruction. Decision 2026-07-16 (owner-delegated): the
 * filed spec (persist to workspace/shadow/) cannot work on serverless — the
 * sink is therefore PLUGGABLE and fail-closed:
 *
 *   1. Redis / Upstash REST when KV_REST_API_URL + KV_REST_API_TOKEN are set
 *      — the SAME env pair the distributed rate limiter (Q-005,
 *      lib/api/rateLimit.ts) keys on, so provisioning marketplace Redis once
 *      activates both. LPUSH to a capped list (LTRIM).
 *   2. Local filesystem (workspace/shadow/YYYY-MM-DD.jsonl) when no KV env is
 *      present AND we are not on Vercel — dev/research runs.
 *   3. Otherwise: no-op.
 *
 * Fail-closed contract: recordShadowSignals NEVER throws and NEVER blocks
 * the response path beyond a short network timeout; any sink failure is
 * swallowed (one console.warn). Opt out entirely with QUANTAN_SHADOW_LOG=0.
 */

import { createHash } from 'crypto'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ShadowSignalInput {
  ticker: string
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
}

export interface ShadowLogEntry {
  ts: string
  kind: 'live-signals'
  /** sha256 over the sorted (ticker,action,confidence) tuples — the "path hash". */
  hash: string
  counts: { buy: number; hold: number; sell: number }
  /** Compact ticker -> action map (confidence omitted to keep entries small). */
  actions: Record<string, 'BUY' | 'HOLD' | 'SELL'>
}

const REDIS_KEY = 'quantan:shadow:signals'
const REDIS_CAP = 10_000
const REDIS_TIMEOUT_MS = 1_500

export type ShadowSinkKind = 'redis' | 'file' | 'none'

export function shadowSinkKind(): ShadowSinkKind {
  const flag = process.env.QUANTAN_SHADOW_LOG
  if (flag === '0' || flag === 'false') return 'none'
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'redis'
  if (!process.env.VERCEL) return 'file'
  return 'none'
}

/** Deterministic content hash of a signal set (order-independent). */
export function shadowHash(instruments: ShadowSignalInput[]): string {
  const canon = instruments
    .map((i) => `${i.ticker}:${i.action}:${i.confidence}`)
    .sort()
    .join('|')
  return createHash('sha256').update(canon).digest('hex')
}

export function buildShadowEntry(instruments: ShadowSignalInput[]): ShadowLogEntry {
  const counts = { buy: 0, hold: 0, sell: 0 }
  const actions: ShadowLogEntry['actions'] = {}
  for (const i of instruments) {
    if (i.action === 'BUY') counts.buy++
    else if (i.action === 'SELL') counts.sell++
    else counts.hold++
    actions[i.ticker] = i.action
  }
  return {
    ts: new Date().toISOString(),
    kind: 'live-signals',
    hash: shadowHash(instruments),
    counts,
    actions,
  }
}

async function writeRedis(entry: ShadowLogEntry): Promise<void> {
  const base = process.env.KV_REST_API_URL!.replace(/\/$/, '')
  const auth = { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN!}` }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS)
  try {
    // Upstash REST pipeline: LPUSH + LTRIM in one round trip.
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['LPUSH', REDIS_KEY, JSON.stringify(entry)],
        ['LTRIM', REDIS_KEY, '0', String(REDIS_CAP - 1)],
      ]),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`shadow-log redis HTTP ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

function writeFileSink(entry: ShadowLogEntry): void {
  const dir = process.env.QUANTAN_SHADOW_DIR ?? join(process.cwd(), 'workspace', 'shadow')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${entry.ts.slice(0, 10)}.jsonl`)
  appendFileSync(file, JSON.stringify(entry) + '\n')
}

/**
 * Record a served live-signal set. Fail-closed: never throws; resolves after
 * the sink write (or its failure) so serverless runtimes don't kill the
 * write mid-flight — worst case adds REDIS_TIMEOUT_MS to one uncached
 * request per cache window.
 */
export async function recordShadowSignals(instruments: ShadowSignalInput[]): Promise<void> {
  try {
    const sink = shadowSinkKind()
    if (sink === 'none' || instruments.length === 0) return
    const entry = buildShadowEntry(instruments)
    if (sink === 'redis') await writeRedis(entry)
    else writeFileSink(entry)
  } catch (err) {
    console.warn('[shadowLog] write failed (ignored):', err instanceof Error ? err.message : err)
  }
}
