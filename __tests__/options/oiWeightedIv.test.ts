import { describe, it, expect } from 'vitest'
import { computeOiWeightedIvForExpiries, type OptionExpiry, type RawOptionContract } from '@/lib/quant/optionsGamma'

function contract(
  partial: Pick<RawOptionContract, 'strike' | 'impliedVol' | 'oi'> & Partial<RawOptionContract>
): RawOptionContract {
  return {
    strike: partial.strike,
    expiry: '2026-06-20T00:00:00.000Z',
    type: partial.type ?? 'call',
    bid: 0,
    ask: 0,
    last: 0,
    volume: 0,
    oi: partial.oi,
    impliedVol: partial.impliedVol,
    delta: 0.5,
    gamma: 0.01,
    theta: -0.05,
    vega: 0.1,
    inTheMoney: false,
  }
}

describe('computeOiWeightedIvForExpiries', () => {
  it('weights IV by open interest on calls', () => {
    const expiry: OptionExpiry = {
      date: '2026-06-20T00:00:00.000Z',
      daysToExpiry: 30,
      calls: [
        contract({ strike: 100, impliedVol: 0.2, oi: 1000, type: 'call' }),
        contract({ strike: 105, impliedVol: 0.4, oi: 3000, type: 'call' }),
      ],
      puts: [],
    }
    const r = computeOiWeightedIvForExpiries([expiry])
    expect(r.calls).toBeCloseTo((0.2 * 1000 + 0.4 * 3000) / 4000, 10)
    expect(r.puts).toBeNull()
    expect(r.combined).toBeCloseTo(r.calls!, 10)
    expect(r.oiWeightCalls).toBe(4000)
    expect(r.oiWeightPuts).toBe(0)
    expect(r.contractsUsedCalls).toBe(2)
    expect(r.contractsUsedPuts).toBe(0)
  })

  it('aggregates multiple expiries for allExpiries-style use', () => {
    const e1: OptionExpiry = {
      date: '2026-06-20T00:00:00.000Z',
      daysToExpiry: 20,
      calls: [contract({ strike: 100, impliedVol: 0.25, oi: 200, type: 'call' })],
      puts: [contract({ strike: 95, impliedVol: 0.35, oi: 800, type: 'put' })],
    }
    const e2: OptionExpiry = {
      date: '2026-07-18T00:00:00.000Z',
      daysToExpiry: 48,
      calls: [contract({ strike: 100, impliedVol: 0.15, oi: 200, type: 'call' })],
      puts: [],
    }
    const r = computeOiWeightedIvForExpiries([e1, e2])
    expect(r.calls).toBeCloseTo((0.25 * 200 + 0.15 * 200) / 400, 10)
    expect(r.puts).toBeCloseTo(0.35, 10)
    const comb = (0.25 * 200 + 0.15 * 200 + 0.35 * 800) / (200 + 200 + 800)
    expect(r.combined).toBeCloseTo(comb, 10)
  })

  it('returns null legs when no valid OI or IV', () => {
    const expiry: OptionExpiry = {
      date: '2026-06-20T00:00:00.000Z',
      daysToExpiry: 30,
      calls: [
        contract({ strike: 100, impliedVol: 0.3, oi: 0, type: 'call' }),
        contract({ strike: 101, impliedVol: 0, oi: 100, type: 'call' }),
        contract({ strike: 102, impliedVol: -0.1, oi: 100, type: 'call' }),
      ],
      puts: [],
    }
    const r = computeOiWeightedIvForExpiries([expiry])
    expect(r.calls).toBeNull()
    expect(r.puts).toBeNull()
    expect(r.combined).toBeNull()
    expect(r.oiWeightCalls).toBe(0)
  })

  it('ignores non-finite IV', () => {
    const c = contract({ strike: 100, impliedVol: NaN, oi: 500, type: 'call' })
    const expiry: OptionExpiry = {
      date: '2026-06-20T00:00:00.000Z',
      daysToExpiry: 30,
      calls: [c],
      puts: [],
    }
    const r = computeOiWeightedIvForExpiries([expiry])
    expect(r.calls).toBeNull()
  })
})
