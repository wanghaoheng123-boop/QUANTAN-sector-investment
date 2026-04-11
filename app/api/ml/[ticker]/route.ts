import { NextResponse } from 'next/server'
import { fetchMlPrediction, isMlSidecarAvailable } from '@/lib/ml/client'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  const symbol = yahooSymbolFromParam(params.ticker)

  const available = await isMlSidecarAvailable()
  if (!available) {
    return NextResponse.json({ available: false, symbol })
  }

  const prediction = await fetchMlPrediction(symbol)
  if (!prediction) {
    return NextResponse.json({ available: false, symbol })
  }

  return NextResponse.json({ available: true, ...prediction })
}
