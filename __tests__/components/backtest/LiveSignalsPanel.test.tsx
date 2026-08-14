// @vitest-environment jsdom
/**
 * Regression tests for `components/backtest/LiveSignalsPanel.tsx` —
 * pins the null-guard fixes for findings surfaced by the Q-054-NEW
 * decomposition code review:
 *
 *   1. `signals.summary` destructure crashed the tab when the API
 *      omitted the summary key.
 *   2. Numeric columns (`price`, `confidence`, `KellyFraction`, `zone`)
 *      rendered the literal strings `'undefined'`, `'$undefined'`, and
 *      `'NaN%'` when the API value was null/undefined.
 *
 * The fix hoists every cell value into a typed local and renders an
 * em-dash `'—'` for missing values. These tests verify that:
 *   - No literal `'undefined'` / `'NaN'` text appears in the DOM.
 *   - The panel does not throw when `summary` is absent.
 *   - The em-dash fallback renders for each null-able cell.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { LiveSignalsPanel } from '@/components/backtest/LiveSignalsPanel'

function mockFetchOnce(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  )
}

describe('LiveSignalsPanel — null-guard regression', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not crash when the API response omits `summary`', async () => {
    // Pre-fix: `summary.buySignals ?? 0` threw `TypeError: Cannot read
    // properties of undefined` and the tab crashed to the error boundary.
    mockFetchOnce({
      instruments: [
        {
          ticker: 'AAPL',
          sector: 'Technology',
          price: 200,
          changePct: 1.5,
          zone: 'HEALTHY_BULL',
          action: 'HOLD',
          confidence: 60,
          rsi14: 55,
          atrPct: 1.2,
          deviationPct: 5,
          slopePct: 0.001,
          KellyFraction: 0.1,
          lastDate: '2026-05-25',
        },
      ],
      // summary OMITTED on purpose
    })

    render(<LiveSignalsPanel />)

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeInTheDocument()
    })

    // Pre-fix: render crashed; post-fix: row renders normally with
    // BUY/HOLD/SELL counts all 0. NEUTRAL regime label is the structural
    // anchor — confirms the summary destructure didn't crash.
    expect(screen.getByText('NEUTRAL')).toBeInTheDocument()
    // "0 BUY" appears in both the breadth pill and the regime descriptor,
    // so use getAllByText.
    expect(screen.getAllByText(/0 BUY/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders em-dash for null/undefined cell values, not "undefined" or "NaN"', async () => {
    // The instrument has every cell value set to null. Pre-fix this row
    // rendered `$undefined`, an empty zone pill, `undefined%` confidence,
    // `NaN%` Kelly, and green-coloured '—' in the change column.
    mockFetchOnce({
      instruments: [
        {
          ticker: 'TEST',
          sector: 'Test',
          price: null,
          changePct: null,
          zone: null,
          action: 'HOLD',
          confidence: null,
          rsi14: null,
          atrPct: null,
          deviationPct: null,
          slopePct: null,
          KellyFraction: null,
          lastDate: null,
        },
      ],
      summary: { buySignals: 0, holdSignals: 1, sellSignals: 0 },
    })

    const { container } = render(<LiveSignalsPanel />)

    await waitFor(() => {
      expect(screen.getByText('TEST')).toBeInTheDocument()
    })

    // No literal junk text anywhere in the rendered DOM.
    expect(container.textContent).not.toMatch(/undefined/)
    expect(container.textContent).not.toMatch(/NaN/)
    // No bare '$undefined' price either.
    expect(container.textContent).not.toMatch(/\$undefined/)

    // Em-dash should appear multiple times (once per null-able column in
    // the row — 9 columns: price, changePct, zone, confidence, rsi14,
    // atrPct, deviationPct, slopePct, KellyFraction, lastDate = 10 cells,
    // but ticker/sector/action are non-null in this fixture).
    const dashCount = (container.textContent ?? '').match(/—/g)?.length ?? 0
    expect(dashCount).toBeGreaterThanOrEqual(9)
  })

  it('paints null `changePct` cell with slate-grey class, not emerald', async () => {
    // Pre-fix: `null >= 0` evaluated true (null → 0), so the cell got
    // `text-emerald-400` while the text content showed '—'. Misleading
    // green '—' meant a missing-data row looked like a gain.
    mockFetchOnce({
      instruments: [
        {
          ticker: 'NULL_CHG',
          sector: 'Test',
          price: 100,
          changePct: null,
          zone: 'HEALTHY_BULL',
          action: 'HOLD',
          confidence: 50,
          rsi14: null,
          atrPct: null,
          deviationPct: null,
          slopePct: null,
          KellyFraction: null,
          lastDate: '2026-05-25',
        },
      ],
      summary: { buySignals: 0, holdSignals: 1, sellSignals: 0 },
    })

    const { container } = render(<LiveSignalsPanel />)

    await waitFor(() => expect(screen.getByText('NULL_CHG')).toBeInTheDocument())

    // Find the row by ticker, then check its changePct cell (3rd-from-left
    // numeric cell after ticker + sector + price).
    const row = screen.getByText('NULL_CHG').closest('tr')!
    expect(row).not.toBeNull()
    // Easier path: assert no emerald class on any cell whose text is just
    // the em-dash. Pre-fix would fail this assertion on the changePct,
    // deviationPct, and slopePct cells.
    const dashCells = Array.from(container.querySelectorAll('td')).filter(
      td => td.textContent?.trim() === '—',
    )
    for (const cell of dashCells) {
      expect(cell.className).not.toMatch(/text-emerald/)
    }
  })
})

describe('LiveSignalsPanel — data freshness disclosure (AL-2/DQ-7)', () => {
  // The panel used to render "Live data refreshes every 60s" beside the as-of
  // date. Nothing here refreshes every 60 seconds: the inputs are committed
  // weekly fixtures, the 60s was a server-side memo TTL for recomputing the
  // SAME frozen inputs, and this component fetches once on mount with no
  // interval. Reading the widget correctly required disbelieving the sentence
  // next to the date, which is worse than saying nothing.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderWithDates(lastDates: Array<string | null>) {
    mockFetchOnce({
      instruments: lastDates.map((lastDate, i) => ({
        ticker: `T${i}`,
        sector: 'Test',
        price: 100,
        changePct: 0,
        zone: 'HEALTHY_BULL',
        action: 'HOLD',
        confidence: 50,
        rsi14: 50,
        atrPct: 1,
        deviationPct: 1,
        slopePct: 0.01,
        KellyFraction: 0.1,
        lastDate,
      })),
      summary: { buySignals: 0, holdSignals: lastDates.length, sellSignals: 0 },
    })
    return render(<LiveSignalsPanel />)
  }

  it('makes no claim that the data refreshes on a timer', async () => {
    const { container } = renderWithDates(['2026-08-07'])
    await waitFor(() => expect(screen.getByText('T0')).toBeInTheDocument())

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/refreshes every 60s/)
    expect(text).not.toMatch(/Live data refreshes/)
    // Guards the weaker rewrite too: the panel does not poll, so no phrasing
    // that implies a 60-second client cadence is true either.
    expect(text).not.toMatch(/every 60\s*s(econds)?/i)
  })

  it('states the as-of date and the real (weekly) cadence', async () => {
    const { container } = renderWithDates(['2026-08-07'])
    await waitFor(() => expect(screen.getByText('T0')).toBeInTheDocument())

    const text = container.textContent ?? ''
    expect(text).toMatch(/Data through/)
    expect(text).toMatch(/refreshed weekly/)
    // The date also appears in the table's "Last Data" column, so scope the
    // assertion to the disclosure line rather than matching document-wide.
    const disclosure = Array.from(container.querySelectorAll('div')).find(d =>
      d.textContent?.startsWith('Data through'),
    )
    expect(disclosure?.textContent).toContain('2026-08-07')
  })

  it('reports the NEWEST bar across instruments as the as-of date', async () => {
    // Mixed staleness (equities lag BTC on a weekend) must not be summarised
    // by whichever instrument happens to sort first.
    const { container } = renderWithDates(['2026-08-07', '2026-08-09', null])
    await waitFor(() => expect(screen.getByText('T0')).toBeInTheDocument())

    const disclosure = Array.from(container.querySelectorAll('div')).find(d =>
      d.textContent?.startsWith('Data through'),
    )
    expect(disclosure?.textContent).toContain('2026-08-09')
  })
})
