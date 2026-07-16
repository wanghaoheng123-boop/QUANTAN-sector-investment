/**
 * Q-067 — shadow signal log: sink selection, hashing, entry shape, and the
 * fail-closed contract (never throws, sink failures swallowed).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  shadowSinkKind,
  shadowHash,
  buildShadowEntry,
  recordShadowSignals,
  type ShadowSignalInput,
} from '@/lib/shadowLog'

const SIGNALS: ShadowSignalInput[] = [
  { ticker: 'AAPL', action: 'BUY', confidence: 90 },
  { ticker: 'MSFT', action: 'HOLD', confidence: 55 },
  { ticker: 'XOM', action: 'SELL', confidence: 95 },
  { ticker: 'NVDA', action: 'HOLD', confidence: 40 },
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('shadowSinkKind — selection precedence', () => {
  it('QUANTAN_SHADOW_LOG=0 disables every sink', () => {
    vi.stubEnv('QUANTAN_SHADOW_LOG', '0')
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example')
    vi.stubEnv('KV_REST_API_TOKEN', 't')
    expect(shadowSinkKind()).toBe('none')
  })

  it('redis wins when the rate-limiter KV env pair is present', () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example')
    vi.stubEnv('KV_REST_API_TOKEN', 't')
    expect(shadowSinkKind()).toBe('redis')
  })

  it('file sink locally; none on Vercel without KV', () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('VERCEL', '')
    expect(shadowSinkKind()).toBe('file')
    vi.stubEnv('VERCEL', '1')
    expect(shadowSinkKind()).toBe('none')
  })
})

describe('shadowHash / buildShadowEntry', () => {
  it('hash is deterministic and order-independent', () => {
    const a = shadowHash(SIGNALS)
    const b = shadowHash([...SIGNALS].reverse())
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash changes when any action or confidence changes', () => {
    const base = shadowHash(SIGNALS)
    const flipped = SIGNALS.map((s, i) =>
      i === 0 ? { ...s, action: 'HOLD' as const } : s,
    )
    expect(shadowHash(flipped)).not.toBe(base)
    const nudged = SIGNALS.map((s, i) => (i === 1 ? { ...s, confidence: 56 } : s))
    expect(shadowHash(nudged)).not.toBe(base)
  })

  it('entry carries counts, compact actions, ISO timestamp, and the hash', () => {
    const e = buildShadowEntry(SIGNALS)
    expect(e.kind).toBe('live-signals')
    expect(e.counts).toEqual({ buy: 1, hold: 2, sell: 1 })
    expect(e.actions).toEqual({ AAPL: 'BUY', MSFT: 'HOLD', XOM: 'SELL', NVDA: 'HOLD' })
    expect(e.hash).toBe(shadowHash(SIGNALS))
    expect(new Date(e.ts).toISOString()).toBe(e.ts)
  })
})

describe('recordShadowSignals — file sink (end-to-end)', () => {
  it('appends one JSONL line per call to the dated file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-'))
    try {
      vi.stubEnv('KV_REST_API_URL', '')
      vi.stubEnv('KV_REST_API_TOKEN', '')
      vi.stubEnv('VERCEL', '')
      vi.stubEnv('QUANTAN_SHADOW_DIR', dir)
      await recordShadowSignals(SIGNALS)
      await recordShadowSignals(SIGNALS.slice(0, 1))
      const files = readdirSync(dir)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)
      const lines = readFileSync(join(dir, files[0]), 'utf-8').trim().split('\n')
      expect(lines).toHaveLength(2)
      const first = JSON.parse(lines[0])
      expect(first.hash).toBe(shadowHash(SIGNALS))
      expect(first.counts).toEqual({ buy: 1, hold: 2, sell: 1 })
      const second = JSON.parse(lines[1])
      expect(second.actions).toEqual({ AAPL: 'BUY' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes nothing for an empty signal set or when disabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-'))
    try {
      vi.stubEnv('KV_REST_API_URL', '')
      vi.stubEnv('KV_REST_API_TOKEN', '')
      vi.stubEnv('VERCEL', '')
      vi.stubEnv('QUANTAN_SHADOW_DIR', dir)
      await recordShadowSignals([])
      vi.stubEnv('QUANTAN_SHADOW_LOG', '0')
      await recordShadowSignals(SIGNALS)
      expect(readdirSync(dir)).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('recordShadowSignals — redis sink', () => {
  it('LPUSH + LTRIM pipeline to the KV REST endpoint', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example/')
    vi.stubEnv('KV_REST_API_TOKEN', 'tok')
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, status: 200 } as Response
    })
    await recordShadowSignals(SIGNALS)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://kv.example/pipeline') // trailing slash stripped
    const [lpush, ltrim] = calls[0].body as [string[], string[]]
    expect(lpush[0]).toBe('LPUSH')
    expect(lpush[1]).toBe('quantan:shadow:signals')
    expect(JSON.parse(lpush[2]).hash).toBe(shadowHash(SIGNALS))
    expect(ltrim).toEqual(['LTRIM', 'quantan:shadow:signals', '0', '9999'])
  })

  it('fail-closed: HTTP failure and thrown fetch are both swallowed', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.example')
    vi.stubEnv('KV_REST_API_TOKEN', 'tok')
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 }) as Response)
    await expect(recordShadowSignals(SIGNALS)).resolves.toBeUndefined()
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    await expect(recordShadowSignals(SIGNALS)).resolves.toBeUndefined()
  })
})
