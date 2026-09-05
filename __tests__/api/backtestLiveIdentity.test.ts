/**
 * I6 + I2 — `?tickers=BRK-B` returned nothing, with a 200 and no error.
 *
 * The universe writes `BRK.B`, the fixture on disk is `BRK-B.json`, and this
 * route compared the raw query token against `sector.topHoldings` with no
 * canonicalisation. `Q-080` built `lib/data/securityId.ts` as the identity SSOT
 * for exactly this — and ZERO routes under `app/api/` imported it. I6 was
 * consistent everywhere except the layer the public actually calls.
 *
 * Measured against the running dev server before the fix (2026-09-05):
 *   ?tickers=BRK-B  -> {"instruments":[]}         200
 *   ?tickers=BRK.B  -> {"instruments":[{...}]}    200
 *
 * These exercise the real route handler rather than a re-implementation, so a
 * change to the parsing pipeline that reintroduces the split fails here.
 */
import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/backtest/live/route'
import { canonicalSecurityId } from '@/lib/data/securityId'

const call = async (qs: string) => {
  const res = await GET(new Request(`http://localhost/api/backtest/live${qs}`) as never)
  return (await res.json()) as {
    instruments: Array<{ ticker: string }>
    unmatchedTickers?: string[]
  }
}

describe('GET /api/backtest/live — one security, one identity', () => {
  it('resolves the hyphen share-class form to the same row as the dot form', async () => {
    const dot = await call('?tickers=BRK.B')
    // Reachability: if the dot form returned nothing the assertion below would
    // pass vacuously by comparing two empty lists. This is the control.
    expect(dot.instruments.map((i) => i.ticker)).toEqual(['BRK.B'])

    const hyphen = await call('?tickers=BRK-B')
    expect(hyphen.instruments.map((i) => i.ticker)).toEqual(['BRK.B'])
  })

  it('is case-insensitive on the same identity', async () => {
    const lower = await call('?tickers=brk-b')
    expect(lower.instruments.map((i) => i.ticker)).toEqual(['BRK.B'])
  })

  it('does not mangle a genuine hyphenated pair into a share class', async () => {
    // The failure mode the old blanket `.replace('-', '.')` had: `BTC-USD` is
    // not a security once mangled. The SSOT leaves it alone, and this pins that
    // the route inherits that behaviour rather than reintroducing a local one.
    expect(canonicalSecurityId('BTC-USD')).toBe('BTC-USD')
    expect(canonicalSecurityId('BRK-B')).toBe('BRK.B')
  })
})

describe('GET /api/backtest/live — missing displays as MISSING (I2)', () => {
  it('names a filter token that matched nothing instead of returning bare []', async () => {
    const res = await call('?tickers=ZZZZ')
    expect(res.instruments).toEqual([])
    // An empty list with a 200 cannot distinguish "no signals today" from "I did
    // not recognise that symbol". That is fail-SILENT, which I2 names first.
    expect(res.unmatchedTickers).toEqual(['ZZZZ'])
  })

  it('does NOT report a matched ticker as unmatched', async () => {
    const res = await call('?tickers=BRK-B')
    expect(res.unmatchedTickers).toBeUndefined()
  })

  it('omits the field entirely on an unfiltered request', async () => {
    const res = await call('')
    expect(res.unmatchedTickers).toBeUndefined()
    expect(res.instruments.length).toBeGreaterThan(10)
  })
})
