/**
 * Q-086 accountant S8 — the DCF refusal is RENDERED, not just computed.
 *
 * `data-testid="dcf-not-applicable"` had no reader anywhere, so the refusal's
 * display path was untested ("tagged code is not a fixed effect"). These
 * render the Valuation and Summary tabs from a payload built by the real
 * `buildFundamentalsPayload`, so the path from builder to screen is the one
 * under test. B5: a refused name must not show buy/sell zones on Summary.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildFundamentalsPayload } from '@/lib/quant/buildFundamentalsPayload'
import { ValuationTab } from '@/components/stock/quantlab/tabs/ValuationTab'
import { SummaryTab } from '@/components/stock/quantlab/tabs/SummaryTab'
import type { QuantLabPayload } from '@/components/stock/quantlab/types'

const Q = { wacc: 0.09, terminalGrowth: 0.025, gBear: 0.02, gBase: 0.06, gBull: 0.1 }

function series(n: number) {
  const closes: number[] = []
  const dates: string[] = []
  let level = 100
  for (let i = 0; i < n; i++) {
    level *= 1 + 0.0015 + Math.sin(i * 0.7) * 0.004
    closes.push(level)
    dates.push(new Date(Date.UTC(2024, 0, 1) + i * 86400_000).toISOString().slice(0, 10))
  }
  return { closes, dates, ohlc: closes.map((c) => ({ open: c, high: c + 0.4, low: c - 0.4, close: c })) }
}

function payload(sector: string, industry: string): QuantLabPayload {
  const { closes, dates, ohlc } = series(320)
  return buildFundamentalsPayload('X', {
    summaryProfile: { longName: 'X Corp', sector, industry },
    financialData: { freeCashflow: 8e9, targetMeanPrice: 180 },
    defaultKeyStatistics: { sharesOutstanding: 1e9, forwardEps: 8, forwardPE: 20 },
  }, closes, dates, ohlc, closes, dates, 150, Q) as unknown as QuantLabPayload
}

const noop = () => {}
const valuation = (data: QuantLabPayload) => renderToStaticMarkup(
  <ValuationTab data={data} wacc={0.09} setWacc={noop} tg={0.025} setTg={noop} gBear={0.02} setGBear={noop}
    gBase={0.06} setGBase={noop} gBull={0.1} setGBull={noop} buildQuery={() => ''} fetchPayload={async () => {}} />,
)
const summary = (data: QuantLabPayload) => renderToStaticMarkup(<SummaryTab data={data} summaryOpen={false} setSummaryOpen={noop} />)

describe('DCF refusal reaches the screen', () => {
  it('Valuation says why there is no DCF, and shows no scenario value', () => {
    const html = valuation(payload('Financial Services', 'Banks - Regional'))
    expect(html).toContain('data-testid="dcf-not-applicable"')
    expect(html).toMatch(/No DCF: An FCF DCF does not apply to Banks - Regional: the balance sheet is the product/)
    expect(html).not.toMatch(/\$\d+\.\d{2}<\/td>/) // no implied value per share in the table
  })

  it('Summary draws no buy/sell zone for a refused name, and says why (B5)', () => {
    const html = summary(payload('Financial Services', 'Banks - Regional'))
    expect(html).toContain('data-testid="bands-refused"')
    expect(html).not.toMatch(/buy-zone ceiling/)
  })

  it('an admitted name renders scenarios with their rate and terminal share, and no refusal', () => {
    const v = valuation(payload('Technology', 'Software'))
    expect(v).not.toContain('dcf-not-applicable')
    expect(v).toMatch(/9\.0%/)          // base rate column
    expect(v).toMatch(/\d{2}%<\/td>/)   // terminal-value share column
    expect(summary(payload('Technology', 'Software'))).toMatch(/buy-zone ceiling/)
  })

  it('the scenario note renders when the growth inputs are out of order (re-gate M12)', () => {
    const { closes, dates, ohlc } = series(320)
    const data = buildFundamentalsPayload('X', {
      summaryProfile: { longName: 'X Corp', sector: 'Technology', industry: 'Software' },
      financialData: { freeCashflow: 8e9, targetMeanPrice: 180 },
      defaultKeyStatistics: { sharesOutstanding: 1e9, forwardEps: 8, forwardPE: 20 },
    }, closes, dates, ohlc, closes, dates, 150, { ...Q, gBear: 0.12, gBase: 0.05, gBull: 0 }) as unknown as QuantLabPayload
    expect(valuation(data)).toMatch(/data-testid="dcf-scenario-note"[^>]*>Scenario labels are approximate: the growth inputs are not ordered/)
  })

  it('the cash-flow note hedges the vendor definition (B4)', () => {
    const v = valuation(payload('Technology', 'Software'))
    expect(v).toMatch(/exact definition is not verified/)
    expect(v).not.toMatch(/levered free cash flow|already net of debt service/)
  })
})
