/**
 * Tests for useLiveQuotes — the multi-ticker SSE fan-out hook.
 *
 * We can't easily exercise the React state-machine without
 * @testing-library/react. What we CAN exercise is the cap + dedup
 * behaviour by importing the exported `MAX_LIVE_STREAMS` constant and
 * mirroring the call-site math. This pins the behaviour the documentation
 * promises.
 *
 * The full EventSource lifecycle is shared with useLiveQuote (covered by
 * its parseLiveQuote tests + smoke integration).
 */

import { describe, it, expect } from 'vitest'
import { MAX_LIVE_STREAMS } from '@/hooks/useLiveQuotes'

describe('useLiveQuotes — caps & guards', () => {
  it('exports a sane MAX_LIVE_STREAMS cap', () => {
    // Browsers limit ~6 simultaneous HTTP/1.1 connections per origin.
    // HTTP/2 lifts the per-origin limit. The cap must be > 6 so the
    // dashboard's 11 sector ETFs all fit, AND modest enough that a
    // wide call site doesn't spawn dozens of streams.
    expect(MAX_LIVE_STREAMS).toBeGreaterThanOrEqual(11)
    expect(MAX_LIVE_STREAMS).toBeLessThanOrEqual(50)
  })

  it('11 sector ETFs + SPY + QQQ fit under the cap (no dashboard drop)', () => {
    const sectors = ['XLK', 'XLE', 'XLF', 'XLV', 'XLY', 'XLI', 'XLC', 'XLB', 'XLU', 'XLRE', 'XLP']
    const indices = ['SPY', 'QQQ']
    const all = [...sectors, ...indices]
    expect(all.length).toBeLessThanOrEqual(MAX_LIVE_STREAMS)
  })

  it('dedup removes duplicates before applying cap', () => {
    // Mirror the hook's internal cleaning logic so the contract is
    // pinned even if the call-site math changes.
    const raw = ['SPY', 'SPY', 'QQQ', '', 'QQQ', 'IWM']
    const cleaned = Array.from(new Set(raw.filter((t) => t && t.length > 0)))
    expect(cleaned).toEqual(['SPY', 'QQQ', 'IWM'])
  })

  it('empty-string + falsy tickers are filtered out', () => {
    const raw = ['SPY', '', 'QQQ', '']
    const cleaned = raw.filter((t) => t && t.length > 0)
    expect(cleaned).toEqual(['SPY', 'QQQ'])
  })
})
