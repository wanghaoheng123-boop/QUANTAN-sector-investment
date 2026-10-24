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
  it('a Coinbase ticker with no open_24h yields a null change, not 0', () => {
    const { result } = renderHook(() => useBtcPriceWs())
    act(() => { FakeSocket.last!.emit({ type: 'ticker', product_id: 'BTC-USD', price: '110' }) })
    expect(result.current.btcPrice).toEqual({ price: 110, change24h: null, changePct24h: null, high24h: null, low24h: null, volume24h: null })
  })

  it('the REST fallback is parsed, not cast: a contradictory pair is refused', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 110, change24h: 5, changePct24h: -3, volume24h: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useBtcPriceWs())
    // The fallback runs once no socket message has arrived for more than 120 s: the 60 s poll at 180 s.
    await act(async () => { await vi.advanceTimersByTimeAsync(181_000) })
    expect(fetchMock).toHaveBeenCalled()
    expect(result.current.btcPrice).toMatchObject({ price: 110, change24h: null, changePct24h: null, volume24h: null })
  })
})
