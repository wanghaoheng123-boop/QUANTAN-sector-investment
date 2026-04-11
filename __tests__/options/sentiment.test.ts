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

  it('returns null volumeRatio when no call volume', () => {
    const calls = [makeContract(100, 0, 1000, 'call')]
    const puts  = [makeContract(95, 500, 1000, 'put')]
    expect(putCallRatio(calls, puts).volumeRatio).toBeNull()
  })

  it('returns null for empty arrays', () => {
    const { volumeRatio, oiRatio } = putCallRatio([], [])
    expect(volumeRatio).toBeNull()
    expect(oiRatio).toBeNull()
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
})
