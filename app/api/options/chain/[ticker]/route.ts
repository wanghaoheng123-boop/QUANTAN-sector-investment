import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import {
  normalizeYahooOptionsChain,
  computeGammaAnalysis,
  interpretGamma,
  calcPutCallRatio,
  computeOiWeightedIvForExpiries,
} from '@/lib/quant/optionsGamma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker?.toUpperCase() ?? ''
  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required' }, { status: 400 })
  }

  try {
    // 1. Fetch spot price
    const [quoteResult, optionsResult] = await Promise.all([
      YahooFinance.quote(ticker) as Promise<{
        symbol: string
        regularMarketPrice: number
        regularMarketChange: number
        regularMarketChangePercent: number
        regularMarketTime: number
        fiftyTwoWeekHigh: number
        fiftyTwoWeekLow: number
      }>,
      YahooFinance.options(ticker) as Promise<{
        expirationDates: number[]
        hasMiniOptions: boolean
        calls: Record<string, unknown>[]
        puts: Record<string, unknown>[]
      }>,
    ])

    const spotPrice = quoteResult.regularMarketPrice
    const quoteTime = new Date(quoteResult.regularMarketTime * 1000).toISOString()

    if (!spotPrice || spotPrice <= 0) {
      return NextResponse.json({ error: `Invalid spot price for ${ticker}` }, { status: 422 })
    }

    // 2. Normalize options chain
    const rawChain = {
      expirationDates: optionsResult.expirationDates ?? [],
      calls: optionsResult.calls ?? [],
      puts: optionsResult.puts ?? [],
    }
    const expiryChain = normalizeYahooOptionsChain(ticker, spotPrice, rawChain)

    // 3. Compute gamma analysis
    const gammaAnalysis = computeGammaAnalysis(ticker, spotPrice, quoteTime, expiryChain)
    const interpretation = interpretGamma(gammaAnalysis)
    const { putCallRatio, putCallVolumeRatio } = calcPutCallRatio(expiryChain)

    // 4. Get near-term expiry for quick Greeks summary
    const nearTerm = expiryChain
      .filter(e => e.daysToExpiry <= 30)
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry)[0]

    const oiIvMethodology =
      'OI-weighted mean of Yahoo chain impliedVolatility; descriptive only, not a trade signal or probability of profit.'
    const oiWeightedNearTerm = nearTerm ? computeOiWeightedIvForExpiries([nearTerm]) : null
    const oiWeightedAllExpiries = computeOiWeightedIvForExpiries(expiryChain)

    return NextResponse.json(
      {
        ticker,
        spotPrice,
        quoteTime,
        quoteChange: quoteResult.regularMarketChange,
        quoteChangePct: quoteResult.regularMarketChangePercent,
        fiftyTwoWeekHigh: quoteResult.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quoteResult.fiftyTwoWeekLow,
        expiryCount: expiryChain.length,
        nearTermExpiry: nearTerm
          ? {
              date: nearTerm.date,
              daysToExpiry: nearTerm.daysToExpiry,
              atmStrike: nearTerm.calls.find(
                c => Math.abs(c.strike - spotPrice) < spotPrice * 0.02
              )?.strike ?? Math.round(spotPrice / 5) * 5,
            }
          : null,
        putCallRatio,
        putCallVolumeRatio,
        oiWeightedImpliedVol: {
          methodology: oiIvMethodology,
          nearTermExpiry: nearTerm
            ? {
                date: nearTerm.date,
                daysToExpiry: nearTerm.daysToExpiry,
                ...oiWeightedNearTerm,
              }
            : null,
          allExpiries: oiWeightedAllExpiries,
        },
        gamma: {
          totalGammaExposure: gammaAnalysis.totalGammaExposure,
          netDelta: gammaAnalysis.netDelta,
          totalVega: gammaAnalysis.totalVega,
          totalTheta: gammaAnalysis.totalTheta,
          gammaFlipStrike: gammaAnalysis.gammaFlipStrike,
          maxPainStrike: gammaAnalysis.maxPainStrike,
          callWallStrike: gammaAnalysis.callWallStrike,
          callWallStrength: gammaAnalysis.callWallStrength,
          putWallStrike: gammaAnalysis.putWallStrike,
          putWallStrength: gammaAnalysis.putWallStrength,
          vannaExposure: gammaAnalysis.vannaExposure,
          charmExposure: gammaAnalysis.charmExposure,
          zeroGammaLower: gammaAnalysis.zeroGammaLower,
          zeroGammaUpper: gammaAnalysis.zeroGammaUpper,
          highestCallOiStrike: gammaAnalysis.highestCallOiStrike,
          highestPutOiStrike: gammaAnalysis.highestPutOiStrike,
        },
        interpretation: {
          dealerPosture: interpretation.dealerPosture,
          hedgingBias: interpretation.hedgingBias,
          volSignal: interpretation.volSignal,
          marketImplication: interpretation.marketImplication,
          confidence: interpretation.confidence,
        },
        gammaLadder: gammaAnalysis.gammaLadder.slice(0, 40), // top 40 strikes
        dataVerification: {
          source: gammaAnalysis.dataVerification.source,
          timestamp: gammaAnalysis.dataVerification.timestamp,
          confidence: gammaAnalysis.dataVerification.confidence,
          methodology: gammaAnalysis.dataVerification.methodology,
          rawFields: gammaAnalysis.dataVerification.rawFields,
        },
      },
      {
        headers: {
          'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (error) {
    console.error(`[Options Chain API] ${ticker}:`, error)

    // If Yahoo options fails (e.g. ETF with no options), return graceful error
    if (error instanceof Error && error.message.includes('options')) {
      return NextResponse.json(
        {
          error: `Options not available for ${ticker}`,
          details: 'This ticker does not have listed options or is not supported by Yahoo Finance.',
          ticker,
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to fetch options data', details: String(error) },
      { status: 500 }
    )
  }
}
