/**
 * Q-138 — /api/crypto/btc/liquidations: every figure the panel showed was
 * wrong in a different way. These pin the route's half.
 *
 * Fixtures are HAND-BUILT, not captured OKX payloads: this repository is
 * public, and committing vendor data is redistribution (I8). Every expected
 * value below is computed by hand in the comment beside it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BTC_USDT_SWAP_CT_VAL,
  LIQ_DETAIL_LIMIT,
  LIQ_INST_ID,
  liquidationFeedProblem,
  summariseLiquidations,
  type OkxLiqRow,
} from '@/lib/data/providers/okxLiquidations'

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(() => null) }))

const NOW = Date.parse('2026-09-28T12:00:00Z')
const MIN = 60_000

/** Three countable liquidations, one stale, two unreadable, one other instrument. */
const __SYNTHETIC__OKX = {
  __SYNTHETIC__: true as const,
  rows: [
    {
      instId: LIQ_INST_ID,
      details: [
        // long force-sold: 80,000 × 150 contracts × 0.01 = $120,000
        { bkPx: '80000', sz: '150', posSide: 'long', side: 'sell', ts: String(NOW - 5 * MIN) },
        // short force-bought: 81,000 × 20 × 0.01 = $16,200
        { bkPx: '81000', sz: '20', posSide: 'short', side: 'buy', ts: String(NOW - 30 * MIN) },
        // short force-bought: 82,000 × 10 × 0.01 = $8,200  (oldest counted: NOW − 90 min)
        { bkPx: '82000', sz: '10', posSide: 'short', side: 'buy', ts: String(NOW - 90 * MIN) },
        // ignored: older than 24h
        { bkPx: '70000', sz: '999', posSide: 'long', side: 'sell', ts: String(NOW - 25 * 60 * MIN) },
        // unreadable: zero size (counted in `unreadable`, which degrades the route)
        { bkPx: '80000', sz: '0', posSide: 'long', side: 'sell', ts: String(NOW - MIN) },
        // unreadable: unparseable price
        { bkPx: '', sz: '5', posSide: 'long', side: 'sell', ts: String(NOW - MIN) },
      ],
    },
    // ignored: a different instrument — its contract size is not 0.01 BTC
    { instId: 'BTC-USD-SWAP', details: [{ bkPx: '80000', sz: '1000', posSide: 'long', side: 'sell', ts: String(NOW - MIN) }] },
  ] satisfies OkxLiqRow[],
}

describe('summariseLiquidations — units, sides, window', () => {
  const s = summariseLiquidations(__SYNTHETIC__OKX.rows, NOW)

  it('scales contracts to BTC before pricing them (0.01 BTC per contract)', () => {
    expect(BTC_USDT_SWAP_CT_VAL).toBe(0.01)
    expect(s.sellVolume).toBeCloseTo(120_000, 6)
    expect(s.buyVolume).toBeCloseTo(24_400, 6)
    // The pre-Q-138 formula (price × contracts) would have said $12,000,000.
    expect(s.sellVolume).not.toBeCloseTo(80_000 * 150, 0)
  })

  it('maps a forced SELL to a LONG liquidation and a forced BUY to a SHORT one', () => {
    expect(s.sellLiquidations).toBe(1)
    expect(s.buyLiquidations).toBe(2)
    expect(s.totalLiquidations).toBe(3)
    expect(s.netDirection).toBe('LONG_BIAS') // $120,000 of longs vs $24,400 of shorts
  })

  it('drops other instruments, stale rows, zero sizes and unparseable prices', () => {
    expect(s.totalLiquidations).toBe(3)
    // …and COUNTS what it could not read, so drift is visible (red-team HIGH-1).
    expect(s.unreadable).toBe(2)
  })

  it('red-team A2: a liquidation matching neither pairing is in the total and disclosed', () => {
    const net = summariseLiquidations([{ instId: LIQ_INST_ID, details: [
      { bkPx: '80000', sz: '10', posSide: 'net', side: 'sell', ts: String(NOW - MIN) },
      { bkPx: '80000', sz: '10', posSide: 'long', side: 'sell', ts: String(NOW - MIN) },
    ] }], NOW)
    expect(net).toMatchObject({ totalLiquidations: 2, sellLiquidations: 1, buyLiquidations: 0, unclassifiedLiquidations: 1 })
  })

  it('red-team A3: side matters — a long with side "buy" is not a long liquidation', () => {
    const odd = summariseLiquidations([{ instId: LIQ_INST_ID, details: [
      { bkPx: '80000', sz: '10', posSide: 'long', side: 'buy', ts: String(NOW - MIN) },
    ] }], NOW)
    expect(odd).toMatchObject({ sellLiquidations: 0, buyLiquidations: 0, unclassifiedLiquidations: 1 })
  })

  it('reports the window it actually covers', () => {
    expect(s.windowStart).toBe(new Date(NOW - 90 * MIN).toISOString())
    expect(s.truncated).toBe(false)
  })

  it('flags truncation when OKX returned its maximum number of details', () => {
    const detail = { bkPx: '80000', sz: '1', posSide: 'long', side: 'sell', ts: String(NOW - MIN) }
    const at = (n: number) => summariseLiquidations([{ instId: LIQ_INST_ID, details: Array(n).fill(detail) }], NOW)
    expect(at(LIQ_DETAIL_LIMIT).truncated).toBe(true)
    expect(at(LIQ_DETAIL_LIMIT - 1).truncated).toBe(false)
  })

  it('red-team A1: truncation is judged on what OKX RETURNED, not on what was counted', () => {
    const fresh = { bkPx: '80000', sz: '1', posSide: 'long', side: 'sell', ts: String(NOW - MIN) }
    const stale = { ...fresh, ts: String(NOW - 25 * 60 * MIN) }
    const r = summariseLiquidations([{ instId: LIQ_INST_ID, details: [...Array(50).fill(fresh), ...Array(50).fill(stale)] }], NOW)
    expect(r.totalLiquidations).toBe(50)
    expect(r.truncated).toBe(true)
  })
})

describe('liquidationFeedProblem — a well-formed response is not automatically a measurement', () => {
  // CORRECTION (red-team HIGH-1). The first version asserted "an empty but
  // valid response is a measured zero". OKX logged ~1,640 BTC-USDT-SWAP
  // liquidations in the trailing 24h on 2026-09-28, and it answers requests
  // that match nothing with the same `code: '0', data: []`. A zero here is a
  // feed problem until shown otherwise.
  it('nothing counted → unknown, not zero', () => {
    expect(liquidationFeedProblem(summariseLiquidations([], NOW))).toMatch(/no liquidations/)
  })

  it('rows, but none for the instrument (e.g. `instId` renamed) → unknown', () => {
    const rows = [{ details: __SYNTHETIC__OKX.rows[0].details }] as OkxLiqRow[]
    expect(liquidationFeedProblem(summariseLiquidations(rows, NOW))).toMatch(/none for BTC-USDT-SWAP/)
  })

  it('records it cannot read (e.g. `sz` renamed) → unknown, even with others counted', () => {
    expect(liquidationFeedProblem(summariseLiquidations(__SYNTHETIC__OKX.rows, NOW))).toMatch(/2 liquidation records this panel could not read/)
    const renamed = [{ instId: LIQ_INST_ID, details: [{ bkPx: '80000', size: '5', posSide: 'long', side: 'sell', ts: String(NOW - MIN) }] }] as unknown as OkxLiqRow[]
    expect(liquidationFeedProblem(summariseLiquidations(renamed, NOW))).toMatch(/could not read/)
  })

  it('a clean response has no problem', () => {
    const clean = [{ instId: LIQ_INST_ID, details: __SYNTHETIC__OKX.rows[0].details.slice(0, 3) }]
    expect(liquidationFeedProblem(summariseLiquidations(clean, NOW))).toBeNull()
  })
})

describe('GET /api/crypto/btc/liquidations — a failed feed is unknown, not zero', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    // The fixture's timestamps are relative to NOW; without pinning the clock
    // the success case would start failing once they age past 24h.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  async function call() {
    const { GET } = await import('@/app/api/crypto/btc/liquidations/route')
    const res = await GET(new Request('http://localhost/api/crypto/btc/liquidations'))
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  const UNKNOWN = {
    totalLiquidations: null, buyLiquidations: null, sellLiquidations: null,
    buyVolume: null, sellVolume: null, netDirection: null, windowStart: null, truncated: null,
    degraded: true,
  }

  it('network failure → nulls + degraded (HTTP 200, so the client replaces stale numbers)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body).toMatchObject(UNKNOWN)
    expect(typeof body.userMessage).toBe('string')
  })

  it('HTTP error from OKX → nulls + degraded', async () => {
    fetchMock.mockResolvedValue(new Response('blocked', { status: 403 }))
    expect((await call()).body).toMatchObject(UNKNOWN)
  })

  it('OKX error code → nulls + degraded', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: '50011', data: [] }), { status: 200 }))
    expect((await call()).body).toMatchObject(UNKNOWN)
  })

  it('no failure path answers with a zero or NEUTRAL', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))
    const { body } = await call()
    for (const k of ['totalLiquidations', 'buyVolume', 'sellVolume']) expect(body[k]).not.toBe(0)
    expect(body.netDirection).not.toBe('NEUTRAL')
  })

  it('a well-formed but unreadable response → nulls + degraded (red-team HIGH-1)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: '0', data: __SYNTHETIC__OKX.rows }), { status: 200 }))
    const { body } = await call()
    expect(body).toMatchObject(UNKNOWN)
    expect(body.userMessage).toMatch(/could not read/)
  })

  it('an empty `code: 0` response → nulls + degraded, never "0 · Balanced"', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: '0', data: [] }), { status: 200 }))
    expect((await call()).body).toMatchObject(UNKNOWN)
  })

  it('success → the scaled summary, not degraded', async () => {
    const clean = [{ instId: LIQ_INST_ID, details: __SYNTHETIC__OKX.rows[0].details.slice(0, 3) }]
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: '0', data: clean }), { status: 200 }))
    const { body } = await call()
    expect(body.degraded).toBeUndefined()
    expect(body.sellLiquidations).toBe(1)
    expect(body.buyLiquidations).toBe(2)
    expect(body.netDirection).toBe('LONG_BIAS')
    expect(body.largeTradeCount).toBeUndefined() // removed: nothing was filtered by size
    expect(body.unclassifiedLiquidations).toBe(0)
    expect(body.unreadable).toBeUndefined() // diagnostics stay off the wire
    expect(body.windowStart).toBe(new Date(NOW - 90 * MIN).toISOString())
    expect(body.truncated).toBe(false)
  })
})
