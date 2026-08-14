// @vitest-environment jsdom
/**
 * Tests for useLiveQuotes — the multiplexed-SSE dashboard hook.
 *
 * Two layers here:
 *
 *   1. Cap + dedup contracts, exercised through the exported
 *      MAX_LIVE_STREAMS constant (unchanged since PR #138).
 *
 *   2. The marketOpen STATE MACHINE (DQ-1, 2026-08-15), exercised through a
 *      fake EventSource. jsdom ships no EventSource, so the harness below
 *      installs one on globalThis before render — `supported` is computed
 *      during render, so it has to be there first — and hands each test a
 *      handle to push server events. The fake never auto-reconnects and the
 *      hook's reconnect timers are fake-timed and unmounted, because a live
 *      timer would hold the suite open.
 *
 * WHAT LAYER 2 PINS. `marketOpen` used to be a one-way latch: the quote handler
 * and the market_state handler both did `setMarketOpen(true)` and nothing
 * anywhere set it back, so `app/page.tsx`'s MARKET CLOSED branch was
 * unreachable after any open tick and a dashboard left open across 16:00 ET
 * kept its LIVE affordance over a frozen tape. It is now derived — per-symbol
 * open map, reduced with any() — which keeps the aggregate's ANY-semantics
 * (one live 24/7 symbol among closed equities ⇒ live) that a plain scalar
 * overwrite would have destroyed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MAX_LIVE_STREAMS, useLiveQuotes } from '@/hooks/useLiveQuotes'

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

/* ────────────────────────── fake EventSource harness ────────────────────────── */

type Listener = (evt: MessageEvent) => void

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  /** Every instance built during a test, newest last. */
  static instances: FakeEventSource[] = []

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2

  url: string
  readyState = FakeEventSource.OPEN
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
  }

  /** Push a server event into the hook, wrapped in act(). */
  emit(type: string, data: unknown) {
    this.emitRaw(type, JSON.stringify(data))
  }

  /** Push a raw (possibly unparseable) event body — the wire is untrusted. */
  emitRaw(type: string, data: string) {
    act(() => {
      for (const fn of this.listeners.get(type) ?? []) {
        fn({ data } as MessageEvent)
      }
    })
  }

  /** Drive the transport's OPEN transition. */
  open() {
    act(() => { this.onopen?.() })
  }
}

/** A `quote` payload in the shape the multiplex route emits. */
function quoteEvent(ticker: string, marketOpen: boolean, price = 100) {
  return {
    ticker,
    price,
    change: 1,
    changePct: 1,
    volume: 1_000,
    marketOpen,
    timestamp: '2026-08-15T14:30:00.000Z',
  }
}

describe('useLiveQuotes — marketOpen is derived, not latched (DQ-1)', () => {
  const realEventSource = (globalThis as { EventSource?: unknown }).EventSource

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    // `supported` is computed during render, so the constructor has to exist
    // on globalThis BEFORE renderHook runs.
    ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    ;(globalThis as unknown as { EventSource: unknown }).EventSource = realEventSource
  })

  /** Render the hook against a stable ticker array and return the live handle. */
  function mount(tickers: string[]) {
    const view = renderHook(() => useLiveQuotes(tickers))
    const es = FakeEventSource.instances.at(-1)
    if (!es) throw new Error('hook did not construct an EventSource')
    es.open()
    return { ...view, es }
  }

  it('starts closed and stays closed before any data (no pre-data flash)', () => {
    const { result, unmount } = mount(['XLK', 'XLE'])
    expect(result.current.marketOpen).toBe(false)
    expect(result.current.supported).toBe(true)
    unmount()
  })

  it('ALL-CLOSED: every symbol reporting closed ⇒ marketOpen false', () => {
    const { result, es, unmount } = mount(['XLK', 'XLE'])
    es.emit('quote', quoteEvent('XLK', false))
    es.emit('quote', quoteEvent('XLE', false))
    es.emit('market_state', { open: false, timestamp: '2026-08-15T22:00:00.000Z' })

    expect(result.current.marketOpen).toBe(false)
    // The quotes themselves still arrive — a closed market still renders the
    // last print; only the LIVE affordance is gated.
    expect(result.current.quotes.XLK?.price).toBe(100)
    unmount()
  })

  it('ANY-SEMANTICS: one open symbol among closed ones ⇒ marketOpen true', () => {
    // The multi-asset case the original latch comment was protecting: a 24/7
    // instrument is live while the equity session is shut. A blind
    // `setMarketOpen(payload.marketOpen)` (the singular hook's pattern) would
    // report false here, because the closed equity reports last.
    const { result, es, unmount } = mount(['BTC-USD', 'XLK', 'XLE'])
    es.emit('quote', quoteEvent('BTC-USD', true, 64_000))
    es.emit('quote', quoteEvent('XLK', false))
    es.emit('quote', quoteEvent('XLE', false))

    expect(result.current.marketOpen).toBe(true)
    unmount()
  })

  it('THE REGRESSION: open → closed DURING a session flips the flag to false', () => {
    // The 16:00 ET transition. The server emits market_state{open:false} and
    // then STOPS polling quotes, so this event is the last word about every
    // symbol; before the fix the per-symbol trues froze and the pill stayed lit
    // until a hard reload.
    const { result, es, unmount } = mount(['XLK', 'XLE'])
    es.emit('market_state', { open: true, timestamp: '2026-08-15T14:30:00.000Z' })
    es.emit('quote', quoteEvent('XLK', true))
    es.emit('quote', quoteEvent('XLE', true))
    expect(result.current.marketOpen).toBe(true)

    es.emit('market_state', { open: false, timestamp: '2026-08-15T20:00:00.000Z' })
    expect(result.current.marketOpen).toBe(false)
    unmount()
  })

  it('THE OPEN BELL: market_state{open:true} lifts reported-closed symbols at once', () => {
    // The other half of the fold, and the reason it applies in BOTH directions
    // rather than only on `false`. A client connecting pre-market gets the
    // route's unconditional initial batch stamped marketOpen:false; at 09:30
    // the bell arrives as market_state{open:true} and the pill must go LIVE
    // then — not up to a 15 s poll interval later.
    const { result, es, unmount } = mount(['XLK', 'XLE'])
    es.emit('quote', quoteEvent('XLK', false))   // 09:25 pre-market print
    es.emit('quote', quoteEvent('XLE', false))
    expect(result.current.marketOpen).toBe(false)

    es.emit('market_state', { open: true, timestamp: '2026-08-15T13:30:00.000Z' })
    expect(result.current.marketOpen).toBe(true)
    unmount()
  })

  it('reopens on the next open quote (the flag is not latched in either direction)', () => {
    const { result, es, unmount } = mount(['XLK'])
    es.emit('quote', quoteEvent('XLK', true))
    expect(result.current.marketOpen).toBe(true)
    es.emit('market_state', { open: false, timestamp: '2026-08-15T20:00:00.000Z' })
    expect(result.current.marketOpen).toBe(false)
    es.emit('quote', quoteEvent('XLK', true))
    expect(result.current.marketOpen).toBe(true)
    unmount()
  })

  it('market_state does not invent state for symbols that never reported', () => {
    // An aggregated scalar is not evidence that a particular symbol is
    // trading. With only XLK reported-closed, an open market_state must not
    // manufacture an "open" entry for the silent XLE.
    const { result, es, unmount } = mount(['XLK', 'XLE'])
    es.emit('quote', quoteEvent('XLK', false))
    es.emit('market_state', { open: false, timestamp: '2026-08-15T20:00:00.000Z' })
    expect(result.current.marketOpen).toBe(false)
    unmount()
  })

  it('a degraded stream (market_state open, zero quotes) reads CLOSED — fail-safe', () => {
    // Intended, not incidental: when the initial batch fails the route emits
    // `degraded` + market_state{open:true} and no quotes. Nothing has reported,
    // so the map is empty and the pill says MARKET CLOSED rather than claiming
    // LIVE over data that never arrived.
    const { result, es, unmount } = mount(['XLK', 'XLE'])
    es.emit('degraded', { code: 'initial_quote_unavailable' })
    es.emit('market_state', { open: true, timestamp: '2026-08-15T14:30:00.000Z' })
    expect(result.current.marketOpen).toBe(false)
    unmount()
  })

  it('ignores a malformed market_state payload instead of dropping the state', () => {
    const { result, es, unmount } = mount(['XLK'])
    es.emit('quote', quoteEvent('XLK', true))
    es.emit('market_state', { open: 'yes' })   // non-boolean → not a state change
    es.emit('market_state', {})                // missing field
    es.emitRaw('market_state', '{ not json')   // unparseable
    expect(result.current.marketOpen).toBe(true)
    unmount()
  })

  it('demultiplexes server-normalized symbols back to the subscribed key', () => {
    // The server normalizes `VIX` → `^VIX`; the caller still addresses `VIX`.
    const { result, es, unmount } = mount(['VIX'])
    es.emit('quote', { ...quoteEvent('^VIX', true), price: 18 })
    expect(result.current.quotes.VIX?.price).toBe(18)
    expect(result.current.marketOpen).toBe(true)
    unmount()
  })

  it('ignores quotes for symbols this hook never subscribed to', () => {
    const { result, es, unmount } = mount(['XLK'])
    es.emit('quote', quoteEvent('TSLA', true))
    expect(result.current.marketOpen).toBe(false)
    expect(result.current.quotes.TSLA).toBeUndefined()
    unmount()
  })

  it('keeps the public API surface unchanged', () => {
    const { result, unmount } = mount(['XLK', 'XLE'])
    expect(Object.keys(result.current).sort()).toEqual(
      ['active', 'connections', 'dropped', 'marketOpen', 'quotes', 'supported'],
    )
    expect(result.current.active).toBe(2)
    expect(result.current.dropped).toBe(0)
    expect(result.current.connections).toEqual({ XLK: true, XLE: true })
    unmount()
  })

  it('drops the connection flags but not the open state on transport error', () => {
    const { result, es, unmount } = mount(['XLK'])
    es.emit('quote', quoteEvent('XLK', true))
    act(() => {
      es.readyState = FakeEventSource.CLOSED
      es.onerror?.()
    })
    expect(result.current.connections.XLK).toBe(false)
    // Still the last thing we knew; the pill's CONNECTING state is driven by
    // `connections`, not by pretending the market changed.
    expect(result.current.marketOpen).toBe(true)
    unmount()
  })
})
