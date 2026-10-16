// @vitest-environment jsdom
/**
 * Q-141 — the BTC Quant Lab's analysis follows whatever timeframe the Chart tab
 * loaded, so its labels must name the bars: a 200-bar average on 1-hour
 * candles is not the "200-Day MA". It also no longer shows a "Rainbow" band:
 * that was a 20-bar range scaled by arbitrary 0.6 / 1.5 multipliers and named
 * after a different, well-known model.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'

/** 240 synthetic candles — enough for the 200-bar regime to compute. */
const __SYNTHETIC__CANDLES = Array.from({ length: 240 }, (_, i) => ({
  time: 1_700_000_000 + i * 3_600, open: 60_000 + i * 5, high: 60_200 + i * 5, low: 59_800 + i * 5, close: 60_050 + i * 5, volume: 1_000,
}))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderSignals(interval?: string) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('not mocked'))))
  render(<BtcQuantLab candles={__SYNTHETIC__CANDLES} interval={interval} />)
  fireEvent.click(screen.getByRole('button', { name: 'Analysis' }))
}

describe('BtcQuantLab — labels follow the candle interval', () => {
  it('on 1-hour candles: a 200-bar regime, with the calibration caution', () => {
    renderSignals('1h')
    expect(screen.getByText('200-bar MA regime (1-hour bars)')).toBeInTheDocument()
    expect(screen.getByTestId('regime-interval-caution')).toHaveTextContent('calibrated on daily candles')
    expect(screen.queryByText(/200-Day MA Regime/)).not.toBeInTheDocument()
    expect(screen.queryByText(/200DMA/)).not.toBeInTheDocument()
  })

  it('on daily candles: the 200-day wording, and no caution', () => {
    renderSignals('1d')
    expect(screen.getByText('200-Day MA Regime')).toBeInTheDocument()
    expect(screen.queryByTestId('regime-interval-caution')).not.toBeInTheDocument()
  })

  it('no fabricated "rainbow" band, on any interval', () => {
    renderSignals('1h')
    expect(document.body.textContent).not.toMatch(/Rainbow|Bubble Peak|Sell Peak|Deep Value|Accumulate|20-week/)
    expect(screen.getAllByText(/1-hour closes/).length).toBeGreaterThan(0)
  })
})

describe('the BTC page passes the timeframe it loaded', () => {
  it('BtcQuantLab receives interval={activeRange} (the default would silently mean daily)', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', '..', '..', 'app/crypto/btc/page.tsx'), 'utf8')
    expect(src).toMatch(/<BtcQuantLab candles=\{candles\} interval=\{activeRange\} \/>/)
  })
})
