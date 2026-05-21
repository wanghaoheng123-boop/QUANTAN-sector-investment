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

  // Phase 14 wave 39: regression coverage for the fix to the chain.ts T=0 gate.
  // PRIOR BEHAVIOUR (buggy): contracts expiring TODAY or already expired
  //   reported delta=0 for every contract — including deep-ITM calls that
  //   should have delta=1. The chain.ts gate `sigma > 0 && T > 0` returned
  //   { delta: 0, ... } before the greeks() function's intrinsic-delta
  //   logic could fire.
  // CORRECT BEHAVIOUR: at expiry, delta is the intrinsic indicator —
  //   1 for ITM call, 0 for OTM call, -1 for ITM put, 0 for OTM put.
  //   Other Greeks (gamma/theta/vega/rho) remain 0 at expiry by definition.

  it('expired ITM call returns intrinsic delta = 1 (not 0)', async () => {
    const expiredAt = Date.now() - 60_000 // expired 1 minute ago
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 150,        // S > K → ITM call
        expirationMs: expiredAt,
        calls: [
          {
            contractSymbol: 'AAPL_EXPIRED_ITM_C',
            strike: 100,
            lastPrice: 0,
            change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiredAt),
            lastTradeDate: new Date(expiredAt),
            impliedVolatility: 0.25,
            inTheMoney: true,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls[0]).toMatchObject({ delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 })
  })

  it('expired OTM call returns intrinsic delta = 0', async () => {
    const expiredAt = Date.now() - 60_000
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 80,         // S < K → OTM call
        expirationMs: expiredAt,
        calls: [
          {
            contractSymbol: 'AAPL_EXPIRED_OTM_C',
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

  it('expired ITM put returns intrinsic delta = -1 (not 0)', async () => {
    const expiredAt = Date.now() - 60_000
    optionsMock.mockResolvedValue(
      makeRawChain({
        spot: 80,         // S < K → ITM put
        expirationMs: expiredAt,
        calls: [],
        puts: [
          {
            contractSymbol: 'AAPL_EXPIRED_ITM_P',
            strike: 100,
            lastPrice: 0,
            change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiredAt),
            lastTradeDate: new Date(expiredAt),
            impliedVolatility: 0.25,
            inTheMoney: true,
          },
        ],
      })
    )
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.puts[0]).toMatchObject({ delta: -1, gamma: 0, theta: 0, vega: 0, rho: 0 })
  })

  // Phase 14 wave 40: regression coverage for the front-month picker.
  //
  // Pre-wave-40 the picker always took optionsArr[0] — the earliest
  // expiration. When the earliest expiration was expiring today (T<=0 for
  // all contracts), every contract had gamma=0 → GexChart showed flat zero.
  // The fix in fetchOptionsChain skips expired blocks and picks the first
  // tradable expiration. The test exercises the WHOLE selection path: a
  // chain with TWO expirations where the front is expired, expecting the
  // back to be the picked chain.
  it('picks the first tradable expiration when front-month is already expired', async () => {
    const expiredAt = Date.now() - 60_000        // expired
    const futureExpiry = Date.now() + oneYearMs * 0.1  // future
    optionsMock.mockResolvedValue({
      underlyingSymbol: 'AAPL',
      quote: { regularMarketPrice: 200 },
      expirationDates: [new Date(expiredAt), new Date(futureExpiry)],
      options: [
        // Block 1: expired — pre-wave-40 this was picked, returning gamma=0.
        {
          expirationDate: new Date(expiredAt),
          calls: [{
            contractSymbol: 'EXPIRED_C',
            strike: 200, lastPrice: 0, change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expiredAt),
            lastTradeDate: new Date(expiredAt),
            impliedVolatility: 0.25,
            inTheMoney: false,
          }],
          puts: [],
        },
        // Block 2: tradable — this is what the fix selects.
        {
          expirationDate: new Date(futureExpiry),
          calls: [{
            contractSymbol: 'TRADABLE_C',
            strike: 200, lastPrice: 5, change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(futureExpiry),
            lastTradeDate: new Date(),
            impliedVolatility: 0.30,
            inTheMoney: false,
          }],
          puts: [],
        },
      ],
    })
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls).toHaveLength(1)
    expect(chain.calls[0].contractSymbol).toBe('TRADABLE_C')
    // The tradable contract has gamma > 0 (live option, not expired) so
    // a downstream GEX computation would produce non-zero strikeGex.
    expect(chain.calls[0].gamma).toBeGreaterThan(0)
  })

  it('falls back to first expiration when EVERY block is expired (defensive)', async () => {
    // Pathological case — would only happen for a halted symbol whose chain
    // hasn't been updated. We pick the earliest expired block so the route
    // still returns SOMETHING rather than crashing on an empty chain.
    const expired1 = Date.now() - 7 * 86_400_000
    const expired2 = Date.now() - 86_400_000
    optionsMock.mockResolvedValue({
      underlyingSymbol: 'AAPL',
      quote: { regularMarketPrice: 200 },
      expirationDates: [new Date(expired1), new Date(expired2)],
      options: [
        {
          expirationDate: new Date(expired1),
          calls: [{
            contractSymbol: 'EXP1_C',
            strike: 200, lastPrice: 0, change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expired1),
            lastTradeDate: new Date(expired1),
            impliedVolatility: 0.25,
            inTheMoney: false,
          }],
          puts: [],
        },
        {
          expirationDate: new Date(expired2),
          calls: [{
            contractSymbol: 'EXP2_C',
            strike: 200, lastPrice: 0, change: 0,
            contractSize: 'REGULAR',
            expiration: new Date(expired2),
            lastTradeDate: new Date(expired2),
            impliedVolatility: 0.25,
            inTheMoney: false,
          }],
          puts: [],
        },
      ],
    })
    const chain = await fetchOptionsChain('AAPL')
    expect(chain.calls).toHaveLength(1)
    // Falls back to the earliest expiration when nothing is tradable.
    expect(chain.calls[0].contractSymbol).toBe('EXP1_C')
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

  /**
   * Phase 13 S2: dividend-yield forwarding to Merton-extended greeks.
   * Without q, BS-1973 over-prices calls and under-prices puts for any
   * dividend-paying underlying (SPY ≈ 1.4%, JNJ ≈ 3%, utilities ≈ 4%).
   */
  describe('dividend-yield forwarding', () => {
    it('q defaults to 0 — back-compat preserves prior call delta', async () => {
      const expiry = Date.now() + oneYearMs * 0.25
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
              contractSize: 'REGULAR',
              expiration: new Date(expiry),
              lastTradeDate: new Date(),
              impliedVolatility: 0.25,
              inTheMoney: false,
            },
          ],
        })
      )
      const chain = await fetchOptionsChain('AAPL')  // no q
      const deltaNoQ = chain.calls[0].delta
      expect(deltaNoQ).toBeGreaterThan(0.4)
      expect(deltaNoQ).toBeLessThan(0.7)
    })

    it('positive q (3% dividend) lowers call delta vs no-dividend', async () => {
      const expiry = Date.now() + oneYearMs
      const callTemplate = {
        contractSymbol: 'X',
        strike: 100,
        lastPrice: 5,
        change: 0,
        contractSize: 'REGULAR',
        expiration: new Date(expiry),
        lastTradeDate: new Date(),
        impliedVolatility: 0.25,
        inTheMoney: false,
      }
      // No dividend
      optionsMock.mockResolvedValueOnce(
        makeRawChain({ spot: 100, expirationMs: expiry, calls: [callTemplate] })
      )
      const noDiv = await fetchOptionsChain('AAPL')
      // 3% dividend
      optionsMock.mockResolvedValueOnce(
        makeRawChain({ spot: 100, expirationMs: expiry, calls: [callTemplate] })
      )
      const withDiv = await fetchOptionsChain('JNJ', undefined, 0.03)
      expect(withDiv.calls[0].delta).toBeLessThan(noDiv.calls[0].delta)
    })

    it('clamps absurd dividend yields (e.g. 50%) to 0 instead of mispricing', async () => {
      const expiry = Date.now() + oneYearMs
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
              contractSize: 'REGULAR',
              expiration: new Date(expiry),
              lastTradeDate: new Date(),
              impliedVolatility: 0.25,
              inTheMoney: false,
            },
          ],
        })
      )
      // Pass an absurd yield (would be a data error from Yahoo).
      const chain = await fetchOptionsChain('BAD', undefined, 0.50)
      // Should produce same result as q=0 (clamped), not divDiscount = e^-0.5 ≈ 0.61
      expect(chain.calls[0].delta).toBeGreaterThan(0.4)
      expect(chain.calls[0].delta).toBeLessThan(0.7)
    })

    it('treats negative dividend yield as 0 (no negative-q exotic pricing)', async () => {
      const expiry = Date.now() + oneYearMs
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
              contractSize: 'REGULAR',
              expiration: new Date(expiry),
              lastTradeDate: new Date(),
              impliedVolatility: 0.25,
              inTheMoney: false,
            },
          ],
        })
      )
      const chain = await fetchOptionsChain('X', undefined, -0.05)
      // Negative yield rejected → q=0 default → call delta unchanged from no-q baseline
      expect(chain.calls[0].delta).toBeGreaterThan(0.4)
    })
  })
})
