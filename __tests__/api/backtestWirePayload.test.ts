import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { OhlcvRow } from '@/lib/backtest/core'
import { markSynthetic, unwrapSynthetic } from '@/lib/synthetic'

/**
 * Q-121 — /api/backtest shipped 742.6 kB brotli (2.4 MB decoded) on every
 * /backtest load. `bnhCurve` and `dailyReturns` were 56% of it and the browser
 * never read either.
 *
 * Two properties are guarded here, and the second is the one that rots:
 *  1. the response omits them;
 *  2. no CLIENT code reads them — because the day someone writes
 *     `result.bnhCurve` in a component, the field will be undefined at runtime
 *     and the only clue will be a blank chart. This test is that clue.
 */

const data = vi.hoisted(() => ({ rows: [] as OhlcvRow[] }))
const seen = vi.hoisted(() => ({ aggregatorInput: [] as Record<string, unknown>[] }))
vi.mock('@/lib/sectors', () => ({ SECTORS: [{ name: 'Technology', topHoldings: ['AAPL'] }] }))
vi.mock('@/lib/backtest/dataLoader', () => ({
  availableTickers: () => ['AAPL'],
  loadStockHistory: () => data.rows,
  loadBtcHistory: () => [],
}))
vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: () => null }))
// Capture what the aggregator is HANDED. Asserting its OUTPUT cannot detect the
// ordering bug: with bnhCurve missing, aggregatePortfolio falls back to the
// legacy full-history average (engine.ts `bnhAvgAligned ?? …`), which is still
// a finite number. A mutation moving the strip before aggregation survived a
// finiteness assertion — so the property has to be the INPUT.
vi.mock('@/lib/backtest/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/backtest/engine')>()
  return {
    ...mod,
    aggregatePortfolio: (results: Parameters<typeof mod.aggregatePortfolio>[0], cap: number) => {
      seen.aggregatorInput = results as unknown as Record<string, unknown>[]
      return mod.aggregatePortfolio(results, cap)
    },
  }
})
vi.mock('@/lib/api/csrf', () => ({ validateCsrf: () => true }))

beforeEach(() => {
  vi.resetModules()
  data.rows = unwrapSynthetic(markSynthetic(Array.from({ length: 400 }, (_, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1, close: 100 + i * 0.1, volume: 1000,
  }))), 'Q121 wire-payload fixture only')
})
afterEach(() => vi.restoreAllMocks())

async function getPayload() {
  const { GET } = await import('@/app/api/backtest/route')
  const res = await GET(new Request('http://localhost/api/backtest'))
  return res.json() as Promise<{ results: Record<string, unknown>[]; portfolio: Record<string, unknown> }>
}

describe('Q-121 — the wire payload drops what the browser never reads', () => {
  it('omits bnhCurve and dailyReturns from every result', async () => {
    const body = await getPayload()
    expect(body.results.length).toBeGreaterThan(0)
    for (const r of body.results) {
      expect(r).not.toHaveProperty('bnhCurve')
      expect(r).not.toHaveProperty('dailyReturns')
    }
  })

  it('KEEPS every field the page was measured reading', async () => {
    // Measured on production by wrapping each result in a recording Proxy and
    // driving all five tabs. Dropping any of these breaks a rendered surface.
    const CONSUMED = ['ticker', 'sector', 'equityCurve', 'totalReturn', 'annualizedReturn',
      'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'winRate', 'profitFactor',
      'bnhReturn', 'excessReturn', 'totalTrades']
    const body = await getPayload()
    for (const r of body.results) for (const k of CONSUMED) expect(r).toHaveProperty(k)
  })

  it('hands the aggregator results that STILL carry bnhCurve', async () => {
    // The ordering IS the property: aggregatePortfolio walks bnhCurve to produce
    // the aligned portfolio.bnhAvg and therefore alpha. Strip it first and the
    // aggregator silently falls back to the legacy average — same shape, worse
    // number, no error. So assert on its input, not its output.
    const body = await getPayload()
    expect(seen.aggregatorInput.length).toBeGreaterThan(0)
    for (const r of seen.aggregatorInput) expect(r).toHaveProperty('bnhCurve')
    // ...and the same field is gone by the time it reaches the wire.
    for (const r of body.results) expect(r).not.toHaveProperty('bnhCurve')
    expect(Number.isFinite(body.portfolio.bnhAvg as number)).toBe(true)
  })

  it('no client code reads a field the wire no longer carries', () => {
    const OMITTED = ['bnhCurve', 'dailyReturns']
    const roots = ['app', 'components', 'hooks']
    const skip = new Set(['node_modules', '.next', '__tests__', 'api'])
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (skip.has(e)) continue
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
      }
      return out
    }
    const files = roots.flatMap((r) => walk(r))
    // Reachability: assert the scan reaches the components that render results.
    expect(files).toContain(join('components', 'backtest', 'EquityCurveChart.tsx'))
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
      return OMITTED.some((k) => new RegExp(`\\.${k}\\b`).test(src))
    })
    expect(offenders).toEqual([])
  })
})
