import { SECTORS, type PriceSignal, type SignalDirection } from '@/lib/sectors'

export type QuoteLike = {
  price: number
  change: number
  changePct: number
  quoteTime?: string | null
}

function sessionDirection(changePct: number): SignalDirection {
  if (changePct > 0.01) return 'BUY'
  if (changePct < -0.01) return 'SELL'
  return 'HOLD'
}

/**
 * Phase 14 wave 34 (dedup): the per-sector signal-building logic was
 * duplicated between `buildSessionSignalsFromQuotes` (the list builder)
 * and `buildSingleSessionSignal` (the lookup-by-ticker variant). 15 lines
 * of identical confidence math + return-shape construction. Now both
 * call this single helper. Slight rationale-wording difference preserved
 * via the optional `extraRationale` suffix arg.
 */
function buildSignalRow(
  sector: { name: string; etf: string },
  q: QuoteLike | undefined,
  timestamp: string,
  rationaleSuffix: string,
): PriceSignal {
  const changePct = q?.changePct ?? 0
  const price = q?.price ?? 0
  const direction = sessionDirection(changePct)
  const absM = Math.abs(changePct)
  const confidence = Math.min(98, Math.round(42 + Math.min(40, absM * 14)))
  return {
    sector: sector.name,
    etf: sector.etf,
    direction,
    confidence,
    entry: price,
    stopLoss: price,
    target: price,
    timeframe: '1D',
    rationale: `Yahoo session vs prior close: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%. Last ${
      price > 0 ? `$${price.toFixed(2)}` : '—'
    }. ${rationaleSuffix}`,
    timestamp,
    source: 'yahoo-session',
    quoteTime: q?.quoteTime ?? null,
    sessionChangePct: changePct,
  }
}

/**
 * One row per sector ETF from Yahoo (or merged) quotes — not a trading model.
 * `direction` reuses BUY/SELL/HOLD only as UI tokens for up/down/flat session vs prior close.
 */
export function buildSessionSignalsFromQuotes(
  quotes: Record<string, QuoteLike>
): PriceSignal[] {
  const ts = new Date().toISOString()
  return SECTORS.map((sector) =>
    buildSignalRow(
      sector,
      quotes[sector.etf],
      ts,
      'Not investment advice; levels mirror last price only (no modelled entry/stop/target).',
    ),
  )
}

export function buildSingleSessionSignal(sectorEtf: string, q: QuoteLike | undefined): PriceSignal | null {
  const sector = SECTORS.find((s) => s.etf === sectorEtf)
  if (!sector || !q) return null
  return buildSignalRow(
    sector,
    q,
    new Date().toISOString(),
    'Not investment advice; levels mirror last price only.',
  )
}
