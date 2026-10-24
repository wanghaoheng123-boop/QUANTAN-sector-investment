// @vitest-environment jsdom
/**
 * Q-157 — the hook itself routes every source through lib/btcSnapshot, so a
 * missing figure reaches the header as null. Drives a fake Coinbase socket and
 * the REST fallback; figures are invented.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useBtcPriceWs', () => {
  it('a Coinbase ticker with no open_24h yields a null change, not 0, and a coinbase feed', () => {
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110' }) })
    expect(result.current.btcPrice).toEqual({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    expect(result.current.feed).toEqual({ source: 'coinbase', receivedAt: Date.now() })
  })

  it('the REST fallback is parsed, not cast: a contradictory pair is refused', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 110, change24h: 5, changePct24h: -3, volume24h: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    // The fallback runs once the socket has been silent for more than 120 s
    // (never having ticked counts as silent): first at the 60 s poll at 180 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(181_000) })
    expect(fetchMock).toHaveBeenCalled()
    expect(result.current.btcPrice).toEqual({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
    expect(result.current.feed?.source).toBe('quote-route')
  })

  it('route not ok -> direct CoinGecko: no percent, no volume is null, not 0 (red-team F2)', async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).includes('coingecko')
      ? new Response(JSON.stringify({ bitcoin: { usd: 110 } }), { status: 200 })
      : new Response('{}', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    await act(async () => { await vi.advanceTimersByTimeAsync(181_000) })
    expect(result.current.btcPrice).toEqual({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
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
