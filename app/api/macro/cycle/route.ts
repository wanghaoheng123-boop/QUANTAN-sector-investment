import { NextResponse } from 'next/server'
import { loadMacroSeries } from '@/lib/backtest/dataLoader'
import { computeBusinessCycleScore } from '@/lib/macro/businessCycle'

export async function GET() {
  try {
    const state = computeBusinessCycleScore({
      t10y2y: loadMacroSeries('T10Y2Y'),
      t10y3m: loadMacroSeries('T10Y3M'),
      hyOas: loadMacroSeries('BAMLH0A0HYM2'),
      igOas: loadMacroSeries('BAMLC0A0CM'),
      unrate: loadMacroSeries('UNRATE'),
      icsa: loadMacroSeries('ICSA'),
      fedFunds: loadMacroSeries('FEDFUNDS'),
    })
    return NextResponse.json(
      { fetchedAt: new Date().toISOString(), ...state },
      { headers: { 'Cache-Control': 's-maxage=900, stale-while-revalidate=1800' } }
    )
  } catch (e) {
    return NextResponse.json({ error: 'Macro cycle engine failed', details: String(e) }, { status: 502 })
  }
}

