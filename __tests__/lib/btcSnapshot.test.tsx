/**
 * Q-157 — the BTC header's 24h figures are null when the source has none, and
 * the header renders "—" for them, never "▲ 0.00%" or the current price as the
 * day's high. Figures are invented.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { snapshotFromCoinbaseTicker, snapshotFromCoinGecko, snapshotFromQuoteRoute } from '@/lib/btcSnapshot'
import BtcHeader from '@/components/crypto/BtcHeader'

vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))

const NONE = { change24h: null, changePct24h: null }

describe('snapshotFromCoinbaseTicker', () => {
  it('derives the change from open_24h', () => {
    const s = snapshotFromCoinbaseTicker({ price: '110', open_24h: '100', high_24h: '112', low_24h: '99', volume_24h: '5' })
    expect(s).toMatchObject({ price: 110, change24h: 10, high24h: 112, low24h: 99, volume24h: 5 })
    expect(s?.changePct24h).toBeCloseTo(10, 12)
  })

  it('no open_24h, or a zero one, is no change — not 0', () => {
    for (const open of [undefined, '', '0', 'x', null]) {
      expect(snapshotFromCoinbaseTicker({ price: '110', open_24h: open }), String(open)).toMatchObject(NONE)
    }
  })

  it('a missing high, low or volume is null, not the current price or 0', () => {
    expect(snapshotFromCoinbaseTicker({ price: '110', open_24h: '100' })).toMatchObject({ high24h: null, low24h: null, volume24h: null })
  })

  it('no usable price is no snapshot', () => {
    for (const price of [undefined, '0', '-1', 'NaN', '']) expect(snapshotFromCoinbaseTicker({ price }), String(price)).toBeNull()
    expect(snapshotFromCoinbaseTicker(null)).toBeNull()
  })
})

describe('snapshotFromCoinGecko', () => {
  it('derives the absolute change from the percent against the prior price', () => {
    const s = snapshotFromCoinGecko({ bitcoin: { usd: 110, usd_24h_change: 10, usd_24h_vol: 7 } })
    expect(s?.changePct24h).toBe(10)
    expect(s?.change24h).toBeCloseTo(10, 9) // prior 100, not 10% of 110
    expect(s).toMatchObject({ high24h: null, low24h: null, volume24h: 7 })
  })

  it('no percent is no change, and no volume is null (the fallback used to send 0 for both)', () => {
    expect(snapshotFromCoinGecko({ bitcoin: { usd: 110 } })).toMatchObject({ ...NONE, volume24h: null })
  })

  it('an impossible percent is refused', () => {
    expect(snapshotFromCoinGecko({ bitcoin: { usd: 110, usd_24h_change: -100 } })).toMatchObject(NONE)
  })

  it('no usable price is no snapshot', () => {
    expect(snapshotFromCoinGecko({ bitcoin: { usd: 0 } })).toBeNull()
    expect(snapshotFromCoinGecko({})).toBeNull()
  })
})

describe('snapshotFromQuoteRoute', () => {
  it('keeps nulls null', () => {
    expect(snapshotFromQuoteRoute({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null }))
      .toEqual({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
  })

  it('refuses a contradictory pair', () => {
    expect(snapshotFromQuoteRoute({ price: 110, change24h: 5, changePct24h: -3 })).toMatchObject(NONE)
  })
})

describe('BtcHeader', () => {
  const base = { price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null }

  it('renders "—" for a missing change and missing high/low, never ▲ 0.00% or the price as the high', () => {
    const html = renderToStaticMarkup(<BtcHeader btcPrice={base} wsConnected={false} />)
    expect(html).toContain('— (no change data)')
    expect(html).not.toMatch(/0\.00%/)
    expect(html).toContain('H — · L —')
    expect(html).not.toContain('H $110')
  })

  it('renders a measured change and range', () => {
    const html = renderToStaticMarkup(<BtcHeader btcPrice={{ ...base, change24h: -2, changePct24h: -1.5, high24h: 112, low24h: 99 }} wsConnected />)
    expect(html).toContain('▼ 1.50%')
    expect(html).toContain('H $112 · L $99')
  })
})

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: () => null }))

describe('/api/crypto/btc/quote — the fallback sends null, not 0 (Q-157)', () => {
  it('a CoinGecko body with no percent and no volume answers null for both, and change24h null', async () => {
    const { GET } = await import('@/app/api/crypto/btc/quote/route')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ bitcoin: { usd: 110 } }), { status: 200 })))
    try {
      const res = await GET(new Request('http://localhost/api/crypto/btc/quote'))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('no usable price is still a 502', async () => {
    const { GET } = await import('@/app/api/crypto/btc/quote/route')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ bitcoin: {} }), { status: 200 })))
    try {
      expect((await GET(new Request('http://localhost/api/crypto/btc/quote'))).status).toBe(502)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
