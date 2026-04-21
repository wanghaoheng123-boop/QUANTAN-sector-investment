export type CotRow = {
  marketAndExchangeNames: string
  reportDate: string
  noncommercialLong: number
  noncommercialShort: number
  commercialLong: number
  commercialShort: number
}

const COT_LEGACY_FUTURES_URL =
  'https://www.cftc.gov/files/dea/history/deacot1986_2025.zip'

/**
 * Placeholder endpoint helper for Phase 8 wiring.
 * CFTC historical data is distributed as ZIP files; parsing is handled in scripts.
 */
export function cotLegacyFuturesUrl(): string {
  return COT_LEGACY_FUTURES_URL
}

