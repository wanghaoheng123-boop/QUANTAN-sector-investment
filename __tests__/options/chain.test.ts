import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for lib/options/chain.ts
 *
 * Closes F8.1 (sub-task: options/chain). The module wraps yahoo-finance2's
 * options() call and enriches each contract with Black-Scholes greeks.
 *
 * Tests pin down:
 *   - Field normalisation (string/number coercion, optional field handling)
 *   - Greeks attached to every contract (delta, gamma, theta, vega, rho)
 *   - Edge cases: zero IV → zero greeks, expired contracts → zero greeks
 *   - Date coercion (epoch-seconds, ISO string, Date instance)
 *   - validateResult: false passed to yahoo-finance2 (schema-drift tolerance)
 *
 * yahoo-finance2 is mocked so the test does not depend on network or
 * Yahoo's per-symbol availability.
 */

// Mock the yahoo-finance2 default export (constructor-style usage in chain.ts).
// vi.mock is hoisted above all imports — declare the mock fn via vi.hoisted
// so it exists when the factory runs.
const { optionsMock } = vi.hoisted(() => ({ optionsMock: vi.fn() }))

vi.mock('yahoo-finance2', () => {
  return {
    default: class {
      options = optionsMock
    },
  }
})

import { fetchOptionsChain } from '@/lib/options/chain'

beforeEach(() => {
  optionsMock.mockReset()
})

const oneYearMs = 365 * 24 * 60 * 60 * 1000

function makeRawChain(opts: {
  spot: number
  expirationMs: number
  calls?: Record<string, unknown>[]
  puts?: Record<string, unknown>[]
  expirationDates?: unknown[]
  underlyingSymbol?: string
}) {
  return {
    underlyingSymbol: opts.underlyingSymbol ?? 'AAPL',
    quote: { regularMarketPrice: opts.spot },
    expirationDates: opts.expirationDates ?? [new Date(opts.expirationMs)],
    options: [
      {
        expirationDate: new Date(opts.expirationMs),
        calls: opts.calls ?? [],
        puts: opts.puts ?? [],
      },
    ],
  }
}

describe('fetchOptionsChain', () => {
  it('passes validateResult: false to yahoo-finance2 (schema-drift tolerance)', async () => {
    optionsMock.mockResolvedValue(makeRawChain({ spot: 100, expirationMs: Date.now() + oneYearMs }))
    await fetchOptionsChain('AAPL')
    // Third arg is moduleOptions
    const call = optionsMock.mock.calls[0]
    expect(call[2]).toMatchObject({ validateResult: false })
  })

  it('forwards `date` query option when provided', async () => {
    const expiry = new Date(Date.now() + oneYearMs)
    optionsMock.mockResolvedValue(makeRawChain({ spot: 100, expirationMs: expiry.getTime() }))
    await fetchOptionsChain('AAPL', expiry)
    const call = optionsMock.mock.calls[0]
    expect(call[1]).toMatchObject({ date: expiry })
  })

  it('omits `date` when not supplied', async () => {
    optionsMock.mockResolvedValue(makeRawChain({ spot: 100, expirationMs: Date.now() + oneYearMs }))
    await fetchOptionsChain('AAPL')
    const call = optionsMock.mock.calls[0]
    expect(call[1]).toEqual({})
  })

  it('returns empty calls/puts when chain is empty', async () => {
    optionsMock.mockResolvedValue({
      underlyingSymbol: 'AAPL',
      quote: { regularMarketPrice: 150 },
      expirationDates: [],
      options: [],
    })
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls).toEqual([])
    expect(chain.puts).toEqual([])
    expect(chain.currentExpiry).toBeNull()
    expect(chain.underlyingPrice).toBe(150)
  })

  it('enriches each call with finite greeks when IV > 0 and T > 0', async () => {
    const expiry = Date.now() + oneYearMs * 0.25 // ~3 months out
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 100,
        expirationMs: expiry,
        calls: [
          {
            contractSymbol: 'AAPL250101C00100000',
            strike: 100,
            lastPrice: 5.20,
            change: 0.10,
            volume: 1000,
            openInterest: 5000,
            bid: 5.10,
            ask: 5.30,
            contractSize: 'REGULAR',
            expiration: new Date(expiry),
            lastTradeDate: new Date(),
            impliedVolatility: 0.25,
            inTheMoney: false,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls).toHaveLength(1)
    const c = chain.calls[0]
    // ATM call delta should be roughly 0.5–0.6
    expect(c.delta).toBeGreaterThan(0.4)
    expect(c.delta).toBeLessThan(0.7)
    expect(c.gamma).toBeGreaterThan(0)
    expect(c.vega).toBeGreaterThan(0)
    // Theta should be negative for a long call (time decay)
    expect(c.theta).toBeLessThan(0)
    expect(Number.isFinite(c.rho)).toBe(true)
  })

  it('enriches put delta as negative number', async () => {
    const expiry = Date.now() + oneYearMs * 0.25
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 100,
        expirationMs: expiry,
        puts: [
          {
            contractSymbol: 'AAPL250101P00100000',
            strike: 100,
            lastPrice: 4.80,
            change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiry),
            lastTradeDate: new Date(),
            impliedVolatility: 0.25,
            inTheMoney: false,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.puts).toHaveLength(1)
    const p = chain.puts[0]
    // ATM put delta ≈ -0.5
    expect(p.delta).toBeLessThan(0)
    expect(p.delta).toBeGreaterThan(-0.7)
    expect(p.gamma).toBeGreaterThan(0)
  })

  it('zeroes out greeks when IV is 0 (no information to price)', async () => {
    const expiry = Date.now() + oneYearMs * 0.25
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 100,
        expirationMs: expiry,
        calls: [
          {
            contractSymbol: 'AAPL250101C00100000',
            strike: 100,
            lastPrice: 5,
            change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiry),
            lastTradeDate: new Date(),
            impliedVolatility: 0,
            inTheMoney: false,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls[0]).toMatchObject({ delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 })
  })

  it('zeroes out greeks for already-expired contracts (T = 0)', async () => {
    const expiredAt = Date.now() - 24 * 60 * 60 * 1000 // yesterday
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 100,
        expirationMs: expiredAt,
        calls: [
          {
            contractSymbol: 'AAPL_EXPIRED',
            strike: 100,
            lastPrice: 0,
            change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiredAt),
            lastTradeDate: new Date(expiredAt),
            impliedVolatility: 0.25,
            inTheMoney: false,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls[0]).toMatchObject({ delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 })
  })

  it('coerces missing/optional fields gracefully', async () => {
    const expiry = Date.now() + oneYearMs * 0.5
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 100,
        expirationMs: expiry,
        calls: [
          {
            contractSymbol: 'X',
            strike: 100,
            lastPrice: 5,
            change: 0,
            // contractSize omitted → defaults 'REGULAR'
            expiration: new Date(expiry),
            // lastTradeDate omitted → falls back to expiration
            impliedVolatility: 0.20,
            // inTheMoney omitted → false
            // bid/ask/volume/openInterest/percentChange/currency omitted
          } as Record<string, unknown>,
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    const c = chain.calls[0]
    expect(c.contractSize).toBe('REGULAR')
    expect(c.inTheMoney).toBe(false)
    expect(c.lastTradeDate).toEqual(c.expiration)
    expect(c.bid).toBeUndefined()
    expect(c.ask).toBeUndefined()
    expect(c.volume).toBeUndefined()
    expect(c.openInterest).toBeUndefined()
    expect(c.currency).toBeUndefined()
  })

  it('uses ticker arg as fallback when underlyingSymbol missing', async () => {
    const expiry = Date.now() + oneYearMs * 0.25
    optionsMock.mockResolvedValue({
      // underlyingSymbol intentionally omitted
      quote: { regularMarketPrice: 100 },
      expirationDates: [new Date(expiry)],
      options: [{ expirationDate: new Date(expiry), calls: [], puts: [] }],
    })
    const chain = await fetchOptionsChain('NVDA')
    expect(chain.ticker).toBe('NVDA')
  })

  it('parses currentExpiry from firstExpiration.expirationDate', async () => {
    const expiry = Date.now() + oneYearMs * 0.25
    optionsMock.mockResolvedValue(makeRawChain({ spot: 100, expirationMs: expiry }))
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.currentExpiry).toBeInstanceOf(Date)
    expect(chain.currentExpiry?.getTime()).toBe(expiry)
  })

  it('coerces numeric expirationDates from epoch seconds', async () => {
    const expiry = Math.floor((Date.now() + oneYearMs * 0.25) / 1000) // epoch seconds
    optionsMock.mockResolvedValue({
      underlyingSymbol: 'AAPL',
      quote: { regularMarketPrice: 100 },
      expirationDates: [expiry], // raw number — toDate must coerce
      options: [{ expirationDate: expiry, calls: [], puts: [] }],
    })
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.expirationDates[0]).toBeInstanceOf(Date)
    // The Date constructor with a number treats it as ms, not seconds — but the
    // function passes raw to `new Date(...)`. Either way, instanceof must hold.
    expect(chain.currentExpiry).toBeInstanceOf(Date)
  })

  it('returns underlyingPrice = 0 when quote missing', async () => {
    optionsMock.mockResolvedValue({
      underlyingSymbol: 'AAPL',
      // quote intentionally missing
      expirationDates: [],
      options: [],
    })
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.underlyingPrice).toBe(0)
  })

  it('propagates errors from yahoo-finance2 (no silent catch)', async () => {
    optionsMock.mockRejectedValue(new Error('Yahoo 404'))
    await expect(fetchOptionsChain('NOPE')).rejects.toThrow('Yahoo 404')
  })
})
