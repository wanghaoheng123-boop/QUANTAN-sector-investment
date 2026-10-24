// @vitest-environment jsdom
/**
 * Q-157 — the hook itself routes every source through lib/btcSnapshot, so a
 * missing figure reaches the header as null. Drives a fake Coinbase socket and
 * the REST fallback; figures are invented.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { priceFeedBadge } from '@/lib/btcSnapshot'
import { useBtcPriceWs } from '@/components/crypto/hooks/useBtcPriceWs'

class FakeSocket {
  static last: FakeSocket | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) { FakeSocket.last = this }
  send() {}
  close() {}
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useBtcPriceWs', () => {
  it('carries a fresh vendor timestamp separately from browser receipt time', () => {
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110', time: '2026-10-24T23:59:55Z' }) })
    expect(result.current.btcPrice?.quoteTime).toBe(Date.parse('2026-10-24T23:59:55Z'))
    expect(result.current.feed).toEqual({ source: 'coinbase', receivedAt: Date.parse('2026-10-25T00:00:00Z'), quoteTime: Date.parse('2026-10-24T23:59:55Z') })
    expect(priceFeedBadge(result.current.feed, Date.now()).state).toBe('live')
  })

  it('a replayed four-hour-old trade remains stale when its socket message just arrived', () => {
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110', time: '2026-10-24T20:00:00Z' }) })
    expect(result.current.btcPrice?.quoteTime).toBe(Date.parse('2026-10-24T20:00:00Z'))
    expect(priceFeedBadge(result.current.feed, Date.now()).label).toBe('STALE · 4h')
  })

  it.each([undefined, 'bad-time', '2026-10-25T00:05:00Z', '2026-10-24T20:00:00Z'])(
    'undated, invalid, future or old tickers (%s) do not suppress the REST fallback', async (time) => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 120 }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const { result } = renderHook(() => useBtcPriceWs())
      for (let i = 0; i < 3; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
        act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110', time }) })
        expect(priceFeedBadge(result.current.feed, Date.now()).state).toBe('stale')
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
      expect(fetchMock).toHaveBeenCalled()
      expect(result.current.feed?.source).toBe('quote-route')
      expect(result.current.btcPrice?.price).toBe(120)
    },
  )

  it('fresh vendor-dated ticks keep the live feed active without invoking the REST fallback', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    for (let i = 0; i < 3; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(59_000) })
      act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110', time: new Date().toISOString() }) })
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(priceFeedBadge(result.current.feed, Date.now()).state).toBe('live')
  })

  it('a Coinbase ticker with no open_24h yields a null change, not 0, and a coinbase feed', () => {
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110' }) })
    expect(result.current.btcPrice).toEqual({ price: 110, quoteTime: null, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    expect(result.current.feed).toEqual({ source: 'coinbase', receivedAt: Date.now(), quoteTime: null })
  })

  it('the REST fallback is parsed, not cast: a contradictory pair is refused', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 110, change24h: 5, changePct24h: -3, volume24h: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    // The fallback runs once the socket has been silent for more than 120 s
    // (never having ticked counts as silent): first at the 60 s poll at 180 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(181_000) })
    expect(fetchMock).toHaveBeenCalled()
    expect(result.current.btcPrice).toEqual({ price: 110, quoteTime: null, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    expect(result.current.feed?.source).toBe('quote-route')
  })

  it('route not ok -> direct CoinGecko: no percent, no volume is null, not 0 (red-team F2)', async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).includes('coingecko')
      ? new Response(JSON.stringify({ bitcoin: { usd: 110 } }), { status: 200 })
      : new Response('{}', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    await act(async () => { await vi.advanceTimersByTimeAsync(181_000) })
    expect(result.current.btcPrice).toEqual({ price: 110, quoteTime: null, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    expect(result.current.feed?.source).toBe('coingecko')
  })

  it('a socket that ticked and then died still falls back (red-team F1: the first tick used to switch the fallback off for good)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 120, changePct24h: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110', open_24h: '100' }) })
    expect(result.current.feed?.source).toBe('coinbase')
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000) })
    expect(fetchMock).toHaveBeenCalled()
    expect(result.current.btcPrice?.price).toBe(120)
    expect(result.current.feed?.source).toBe('quote-route')
  })
})
