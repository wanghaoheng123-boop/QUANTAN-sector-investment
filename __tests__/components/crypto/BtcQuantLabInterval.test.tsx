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

/** Steeper than the series above: its 200-bar average moves ~+5% in 20 bars, well past the +0.5% daily band. */
const __SYNTHETIC__STEEP = Array.from({ length: 240 }, (_, i) => ({
  time: 1_700_000_000 + i * 3_600, open: 60_000 + i * 200, high: 60_200 + i * 200, low: 59_800 + i * 200, close: 60_050 + i * 200, volume: 1_000,
}))

function renderSignals(interval?: string, candles = __SYNTHETIC__CANDLES) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('not mocked'))))
  render(<BtcQuantLab candles={candles} interval={interval} />)
  fireEvent.click(screen.getByRole('button', { name: 'Analysis' }))
}

describe('BtcQuantLab — labels follow the candle interval', () => {
  it('on 1-hour candles: a 200-bar regime, with the calibration caution, and no daily words', () => {
    renderSignals('1h')
    expect(screen.getByText('200-bar average (1-hour bars)')).toBeInTheDocument()
    expect(screen.getByTestId('regime-interval-caution')).toHaveTextContent('defined for daily candles')
    // Red-team R2-241-1: case-insensitive, and "200-day" in any form. The old
    // checks passed beside "8% above the 200-day SMA" in the explanation.
    const text = document.body.textContent ?? ''
    expect(text.replace(/not the 200-day moving average/i, '')).not.toMatch(/200-day|200DMA|200-Day MA Regime/i)
  })

  it('on 1-hour candles: no daily-calibrated dip classification or trade wording (R2-241-3)', () => {
    renderSignals('1h')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/buy the dip|falling knife|watch — no add|in trend|accumulate|scaling in|avoid long|positioning|buy zone|forward context/i)
    // The signals table's 200MA row says the classification is daily-only.
    expect(screen.getByText('daily only')).toBeInTheDocument()
  })

  it('the 200-bar slope reads its real direction and unit (a rising average is not "falling")', () => {
    renderSignals('1h')
    const text = document.body.textContent ?? ''
    // The synthetic series rises steadily, so its 200-bar average is up.
    // Q153-R2-11: off daily bars only the SIGN and the value are shown. The
    // ±0.5% band (and so "rising" / "flat" / "falling") is defined for 20 DAYS
    // of a 200-DAY average, not 20 hourly bars of a 200-hour one.
    expect(text).toMatch(/200-bar MA ▲ \+\d+\.\d{2}% \/ 20 bars/)
    expect(text).not.toMatch(/%\/bar|200-bar MA falling|within ±|\b(?:rising|flat|falling)\b/i)
  })

  it('off daily bars the slope is one neutral colour; the daily threshold colours stay on daily bars', () => {
    // Same steep series both times: the 200-bar average is far above +0.5% in 20 bars.
    renderSignals('1h', __SYNTHETIC__STEEP)
    const hourly = screen.getByText(/200-bar MA ▲/)
    expect(hourly.className).toContain('text-slate-300')
    expect(hourly.className).not.toMatch(/emerald|red-|green/)
    cleanup()
    renderSignals('1d', __SYNTHETIC__STEEP)
    const daily = screen.getByText(/200DMA ▲ rising/)
    expect(daily.className).toContain('text-emerald-400')
  })

  it('a 1D interval is daily, not "1D bars" (R2-241-2)', () => {
    renderSignals('1D')
    expect(screen.getByText('200-day average: distance and slope')).toBeInTheDocument()
    expect(screen.queryByTestId('regime-interval-caution')).not.toBeInTheDocument()
  })

  it('on daily candles: the 200-day wording, and no caution', () => {
    renderSignals('1d')
    expect(screen.getByText('200-day average: distance and slope')).toBeInTheDocument()
    expect(screen.queryByTestId('regime-interval-caution')).not.toBeInTheDocument()
  })

  it('no fabricated "rainbow" band, on any interval', () => {
    renderSignals('1h')
    expect(document.body.textContent).not.toMatch(/Rainbow|Bubble Peak|Sell Peak|Deep Value|Accumulate|20-week/i)
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
