import { NextResponse } from 'next/server'
import { fetchMlPrediction, isMlSidecarAvailable } from '@/lib/ml/client'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'

export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  try {
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
  } catch (error) {
    console.error('[ML API] Error fetching prediction:', error)
    return NextResponse.json(
      {
        available: false,
        error: 'ml_prediction_failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
