/**
 * FRED (Federal Reserve Economic Data) provider.
 *
 * Free, no API key required for public series.
 * Optional FRED_API_KEY env var for higher rate limits.
 *
 * Common series IDs:
 *   FEDFUNDS   — Federal Funds Rate (monthly)
 *   CPIAUCSL   — CPI All Urban Consumers (monthly)
 *   GDP        — Real GDP (quarterly)
 *   UNRATE     — Unemployment Rate (monthly)
 *   DGS10      — 10-Year Treasury Constant Maturity Rate (daily)
 *   T10YIE     — 10-Year Breakeven Inflation Rate (daily)
 */

import type { MacroDataProvider, DataProvider, DailyBar, QuoteSnapshot, MacroSeries } from './types'

const FRED_BASE = 'https://fred.stlouisfed.org/graph/fredgraph.csv'
const FRED_API_BASE = 'https://api.stlouisfed.org/fred'

export class FredProvider implements MacroDataProvider {
  readonly name = 'fred'
  private readonly apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.FRED_API_KEY ?? ''
  }

  isAvailable(): boolean {
    return true  // FRED public CSV endpoint requires no API key
  }

  /** FRED provides economic series, not individual stock OHLCV data. */
  async fetchDaily(_ticker: string, _startDate: Date | string): Promise<DailyBar[] | null> {
    return null  // not applicable
  }

  async fetchQuote(_ticker: string): Promise<QuoteSnapshot | null> {
    return null  // not applicable
  }

  /**
   * Fetches a FRED time series by series ID.
   * Uses the CSV endpoint (no API key needed) or JSON API endpoint (higher rate limits).
   *
   * @param seriesId  FRED series identifier, e.g. "FEDFUNDS"
   * @param startDate Optional start date (ISO string or Date)
   */
  async fetchMacroSeries(seriesId: string, startDate?: Date | string): Promise<MacroSeries | null> {
    try {
      const from = startDate
        ? (startDate instanceof Date ? startDate.toISOString().slice(0, 10) : startDate)
        : '1990-01-01'

      // Prefer JSON API if key is available, else fall back to CSV
      if (this.apiKey) {
        return await this._fetchViaApi(seriesId, from)
      }
      return await this._fetchViaCsv(seriesId, from)
    } catch {
      return null
    }
  }

  private async _fetchViaCsv(seriesId: string, from: string): Promise<MacroSeries | null> {
    const url = `${FRED_BASE}?id=${seriesId}&vintage_date=&cosd=${from}`
    const res = await fetch(url)
    if (!res.ok) return null
    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) return null

    const observations = lines.slice(1)
      .map((line) => {
        const [date, val] = line.split(',')
        const value = val?.trim() === '.' || val?.trim() === '' ? null : parseFloat(val)
        return { date: date?.trim() ?? '', value }
      })
      .filter((o) => o.date.match(/^\d{4}-\d{2}-\d{2}$/))

    return { seriesId, observations, units: '', frequency: 'unknown' }
  }

  private async _fetchViaApi(seriesId: string, from: string): Promise<MacroSeries | null> {
    const url = `${FRED_API_BASE}/series/observations?series_id=${seriesId}&observation_start=${from}&api_key=${this.apiKey}&file_type=json`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json() as {
      observations?: Array<{ date: string; value: string }>
      units?: string
      frequency?: string
    }
    if (!data.observations) return null
    const observations = data.observations.map((o) => ({
      date: o.date,
      value: o.value === '.' ? null : parseFloat(o.value),
    }))
    return {
      seriesId,
      observations,
      units: data.units ?? '',
      frequency: data.frequency ?? '',
    }
  }
}

export const fredProvider = new FredProvider()
