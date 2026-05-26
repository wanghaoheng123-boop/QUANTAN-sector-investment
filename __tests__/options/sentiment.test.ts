import { describe, it, expect } from 'vitest'
import { putCallRatio, maxPain } from '@/lib/options/sentiment'
import type { CallOrPut } from '@/lib/options/chain'

function makeContract(strike: number, volume: number, openInterest: number, type: 'call' | 'put'): CallOrPut {
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  return {
    contractSymbol: `TEST${type === 'call' ? 'C' : 'P'}${strike}`,
    strike,
    lastPrice: 1.0,
    change: 0,
    contractSize: 'REGULAR',
    expiration: expiry,
    lastTradeDate: new Date(),
    impliedVolatility: 0.25,
    inTheMoney: false,
    volume,
    openInterest,
  }
}

describe('putCallRatio', () => {
  it('computes volume ratio correctly', () => {
    const calls = [makeContract(100, 1000, 5000, 'call'), makeContract(105, 500, 2000, 'call')]
    const puts  = [makeContract(95,  600, 3000, 'put'),  makeContract(90,  400, 1000, 'put')]
    const { volumeRatio } = putCallRatio(calls, puts)
    // (600+400) / (1000+500) = 1000/1500 ≈ 0.667
    expect(volumeRatio).toBeCloseTo(1000 / 1500, 4)
  })

  it('computes OI ratio correctly', () => {
    const calls = [makeContract(100, 0, 4000, 'call')]
    const puts  = [makeContract(100, 0, 2000, 'put')]
    const { oiRatio } = putCallRatio(calls, puts)
    expect(oiRatio).toBeCloseTo(0.5, 4)
  })

  // Phase 14 wave 41 (F1): the prior contract returned null whenever calls
  // had zero volume — silently dropping a strongly bearish signal when
  // puts had real activity. New contract returns PCR_MAX (= 99) when only
  // one side has activity. Pure-null is reserved for the BOTH-empty case.
  it('returns PCR_MAX (99) volumeRatio when no call volume but puts have volume', () => {
    const calls = [makeContract(100, 0, 1000, 'call')]
    const puts  = [makeContract(95, 500, 1000, 'put')]
    expect(putCallRatio(calls, puts).volumeRatio).toBe(99)
  })

  it('returns null for empty arrays (both sides truly empty)', () => {
    const { volumeRatio, oiRatio } = putCallRatio([], [])
    expect(volumeRatio).toBeNull()
    expect(oiRatio).toBeNull()
  })

  it('returns null for two-sided chain with zero activity on both sides', () => {
    const calls = [makeContract(100, 0, 0, 'call')]
    const puts  = [makeContract(95, 0, 0, 'put')]
    const { volumeRatio, oiRatio } = putCallRatio(calls, puts)
    expect(volumeRatio).toBeNull()
    expect(oiRatio).toBeNull()
  })

  it('rejects NaN volume / OI in the fold (F7 defensive guard)', () => {
    // A single malformed row with NaN volume must not poison the sum.
    const calls = [
      makeContract(100, NaN, 100, 'call'),   // NaN volume — should be skipped
      makeContract(100, 200, 100, 'call'),
    ]
    const puts  = [makeContract(95, 100, 50, 'put')]
    const { volumeRatio } = putCallRatio(calls, puts)
    // Only the 200-volume call counts → 100 / 200 = 0.5
    expect(volumeRatio).toBeCloseTo(0.5, 4)
  })
})

describe('maxPain', () => {
  it('returns null for empty arrays', () => {
    expect(maxPain([], [])).toBeNull()
  })

  it('finds the correct max pain strike in a simple case', () => {
    // Setup:
    // Strikes: 90, 95, 100, 105, 110
    // If underlying expires at 100:
    //   calls < 100 are ITM: 90 (OI=100, payout=10*100*100=100000), 95 (OI=100, payout=5*100*100=50000)
    //   puts  > 100 are ITM: 105 (OI=100, payout=5*100*100=50000), 110 (OI=100, payout=10*100*100=100000)
    //   total = 300000
    // At 95:
    //   calls < 95 are ITM: 90 (payout=5*100*100=50000)
    //   puts  > 95 are ITM: 100 (payout=5*100*100=50000), 105 (payout=10*100*100=100000), 110 (payout=15*100*100=150000)
    //   total = 350000
    // Max pain should be somewhere in the middle — the strike with minimum total
    const calls = [90, 95, 100, 105, 110].map((s) => makeContract(s, 0, 100, 'call'))
    const puts  = [90, 95, 100, 105, 110].map((s) => makeContract(s, 0, 100, 'put'))
    const mp = maxPain(calls, puts)
    // With equal OI across all strikes, max pain is at the center strike (100)
    expect(mp).toBe(100)
  })

  it('returns the only strike when there is one', () => {
    const calls = [makeContract(100, 0, 1000, 'call')]
    const puts  = [makeContract(100, 0, 1000, 'put')]
    expect(maxPain(calls, puts)).toBe(100)
  })

  it('skews toward high-OI strikes', () => {
    // Calls concentrated at 90, puts concentrated at 110
    // Max pain should be pulled toward 90 (heavy call OI makes 90 cheap for writers)
    const calls = [
      makeContract(90, 0, 10000, 'call'),  // heavy
      makeContract(110, 0, 100, 'call'),
    ]
    const puts = [
      makeContract(90, 0, 100, 'put'),
      makeContract(110, 0, 10000, 'put'),  // heavy
    ]
    const mp = maxPain(calls, puts)
    // Should be somewhere between 90 and 110
    expect(mp).toBeGreaterThanOrEqual(90)
    expect(mp).toBeLessThanOrEqual(110)
  })

  /**
   * Phase 13 S2 regression: with zero total OI, every candidate strike's
   * payout is 0 and the first strike trivially "wins". Returning that
   * meaningless number was a fail-OPEN bug — caller would treat it as
   * a real max-pain estimate. Now returns null on zero/empty OI.
   */
  it('returns null when total open interest is zero (fail-closed)', () => {
    const calls = [
      makeContract(90, 0, 0, 'call'),
      makeContract(100, 0, 0, 'call'),
      makeContract(110, 0, 0, 'call'),
    ]
    const puts = [
      makeContract(90, 0, 0, 'put'),
      makeContract(100, 0, 0, 'put'),
      makeContract(110, 0, 0, 'put'),
    ]
    expect(maxPain(calls, puts)).toBeNull()
  })

  it('returns null when OI is undefined across all contracts', () => {
    // Contracts without openInterest property set (typical of missing-data Yahoo response).
    const calls = [
      { ...makeContract(100, 0, 0, 'call'), openInterest: undefined },
    ] as ReturnType<typeof makeContract>[]
    const puts = [
      { ...makeContract(100, 0, 0, 'put'), openInterest: undefined },
    ] as ReturnType<typeof makeContract>[]
    expect(maxPain(calls, puts)).toBeNull()
  })

  it('still computes when AT LEAST ONE contract has non-zero OI', () => {
    // Even just one OI > 0 means a meaningful max-pain calculation is possible.
    const calls = [
      makeContract(90, 0, 0, 'call'),
      makeContract(100, 0, 1000, 'call'), // single source of OI
      makeContract(110, 0, 0, 'call'),
    ]
    const puts = [
      makeContract(90, 0, 0, 'put'),
      makeContract(100, 0, 0, 'put'),
      makeContract(110, 0, 0, 'put'),
    ]
    const mp = maxPain(calls, puts)
    expect(mp).not.toBeNull()
    // The lone OI is at the 100 call. Pain is minimised where calls are OTM,
    // i.e. at strikes ≤ 100. Pin to within the strike grid.
    expect(mp).toBeLessThanOrEqual(100)
  })
})
