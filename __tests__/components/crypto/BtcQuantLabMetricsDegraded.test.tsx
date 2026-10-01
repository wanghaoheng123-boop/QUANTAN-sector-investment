// @vitest-environment jsdom
/**
 * Q-140 — the BTC metrics route has always answered `degraded: true` with a
 * `userMessage` when Bybit/OKX failed, and BtcQuantLab never read it. The
 * fail-closed consumer guard cannot pin this read by text: the lab imports
 * LiquidationsPanel, which reads ANOTHER route's flag, so "the consumer
 * mentions degraded" was already true (mutation C1 survived it). This renders
 * the lab and asserts the notice itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'

/** 60 synthetic daily candles — the lab needs ≥30 to render (it computes indicators). */
const __SYNTHETIC__CANDLES = Array.from({ length: 60 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400, open: 60_000 + i * 10, high: 60_200 + i * 10, low: 59_800 + i * 10, close: 60_050 + i * 10, volume: 1_000,
}))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('BtcQuantLab — degraded derivatives metrics are said', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('shows the route userMessage on the Funding & OI tab', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/crypto/btc/metrics')) {
        return Promise.resolve(json({
          fundingRate: null, nextFundingTime: null, openInterest: null, takerBuyVolume: null, takerSellVolume: null,
          longShortRatio: null, longAccountPct: null, shortAccountPct: null,
          source: 'Unavailable (Bybit/OKX unreachable)', fetchedAt: new Date().toISOString(),
          degraded: true, userMessage: 'Derivatives metrics could not be loaded from Bybit/OKX. Check network or try again shortly.',
        }))
      }
      return Promise.reject(new TypeError('not mocked'))
    }))
    render(<BtcQuantLab candles={__SYNTHETIC__CANDLES} />)
    await waitFor(() => expect(screen.getByText('Derivatives metrics could not be loaded from Bybit/OKX. Check network or try again shortly.')).toBeInTheDocument())
  })
})
