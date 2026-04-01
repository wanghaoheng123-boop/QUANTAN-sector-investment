import { runDcf, type DcfResult } from './dcf'
import { computeAdaptiveBands } from './priceBands'
import { annualizedVolFromCloses } from './volatility'
import {
  sma,
  rsi,
  macd,
  bollinger,
  atr,
  maxDrawdown,
  dailyReturns,
  sharpeRatio,
  sortinoRatio,
  trendLabel,
  ma200Regime,
  type OhlcBar,
  type MA200Regime,
} from './technicals'
import { alignCloses, logReturns, correlation, excessReturn } from './relativeStrength'
import { bandPosition, computeResearchScore } from './researchScore'
import { classicPivots } from './pivots'
import { parseEarningsSnapshot } from './earningsParse'

type AnyRec = Record<string, unknown>

function num(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  return null
}

/** Yahoo `endDate`-style cells: `{ fmt, raw }`. */
function yahooDateCell(x: unknown): string | number | null {
  if (!x || typeof x !== 'object') return null
  const o = x as AnyRec
  const fmt = o.fmt
  const raw = o.raw
  if (typeof fmt === 'string' || typeof fmt === 'number') return fmt
  if (typeof raw === 'string' || typeof raw === 'number') return raw
  return null
}

function extractStatementRows(moduleObj: unknown, fallbacks: string[]): AnyRec[] {
  if (!moduleObj || typeof moduleObj !== 'object') return []
  const o = moduleObj as AnyRec
  for (const k of fallbacks) {
    const v = o[k]
    if (Array.isArray(v)) return v as AnyRec[]
  }
  return []
}

function pickFcf0(cashflowModule: unknown, financialData: AnyRec | null): number | null {
  const fc = num(financialData?.freeCashflow)
  if (fc && fc > 0) return fc
  const cashflowHistory = extractStatementRows(cashflowModule, [
    'cashflowStatements',
    'cashflowStatementHistory',
  ])
  if (cashflowHistory.length === 0) return null
  const latest = cashflowHistory[0] as AnyRec
  const fcf = num(latest?.freeCashflow)
  if (fcf && fcf > 0) return fcf
  const ocf = num(latest?.totalCashFromOperatingActivities)
  const capexRaw = num(latest?.capitalExpenditures)
  if (ocf != null && capexRaw != null) {
    const capexOut = Math.abs(capexRaw)
    return ocf - capexOut
  }
  return null
}

function lastAnnualBalanceSheets(rows: AnyRec[], max = 5): AnyRec[] {
  return rows.slice(0, max)
}

export interface FundamentalsQuery {
  wacc: number
  terminalGrowth: number
  gBear: number
  gBase: number
  gBull: number
}

export function buildFundamentalsPayload(
  symbol: string,
  quoteSummary: AnyRec,
  closes: number[],
  dates: string[],
  ohlc: OhlcBar[],
  spyCloses: number[],
  spyDates: string[],
  currentPrice: number | null,
  q: FundamentalsQuery
) {
  const profile = (quoteSummary.summaryProfile || quoteSummary.assetProfile) as AnyRec | null
  const financialData = quoteSummary.financialData as AnyRec | null
  const keyStats = quoteSummary.defaultKeyStatistics as AnyRec | null
  const incomeHist = extractStatementRows(quoteSummary.incomeStatementHistory, [
    'incomeStatementHistory',
    'incomeStatements',
  ])
  const balanceHist = extractStatementRows(quoteSummary.balanceSheetHistory, [
    'balanceSheetHistory',
    'balanceSheets',
  ])
  const cashModule = quoteSummary.cashflowStatementHistory

  const shares = num(keyStats?.sharesOutstanding) ?? num(keyStats?.ordinarySharesNumber)
  const fcf0 = pickFcf0(cashModule, financialData)

  const dcfBear =
    shares && fcf0
      ? runDcf({
          fcf0,
          shares,
          wacc: q.wacc + 0.015,
          terminalGrowth: Math.min(q.terminalGrowth, 0.02),
          explicitGrowth: q.gBear,
        })
      : null
  const dcfBase =
    shares && fcf0
      ? runDcf({ fcf0, shares, wacc: q.wacc, terminalGrowth: q.terminalGrowth, explicitGrowth: q.gBase })
      : null
  const dcfBull =
    shares && fcf0
      ? runDcf({
          fcf0,
          shares,
          wacc: Math.max(q.wacc - 0.01, 0.06),
          terminalGrowth: q.terminalGrowth,
          explicitGrowth: q.gBull,
        })
      : null

  const forwardEps = num(keyStats?.forwardEps)
  const trailingPe = num(keyStats?.trailingPE)
  const forwardPe = num(keyStats?.forwardPE)
  const targetMean = num(financialData?.targetMeanPrice)

  let forwardHeuristic: number | null = null
  if (forwardEps && forwardEps > 0) {
    const peFair = forwardPe && forwardPe > 0 ? forwardPe : trailingPe && trailingPe > 0 ? trailingPe : 18
    forwardHeuristic = forwardEps * peFair
  }

  const anchors: (number | null)[] = [
    dcfBase?.valuePerShare ?? null,
    targetMean,
    forwardHeuristic,
  ]

  const vol = annualizedVolFromCloses(closes)
  const price = currentPrice && currentPrice > 0 ? currentPrice : num(financialData?.currentPrice)
  const bands =
    price && price > 0
      ? computeAdaptiveBands({
          currentPrice: price,
          anchors,
          annualizedVol: vol,
        })
      : null

  const balances = lastAnnualBalanceSheets(balanceHist, 5).map((b) => ({
    endDate: yahooDateCell(b.endDate),
    totalAssets: num(b.totalAssets),
    totalLiab: num(b.totalLiab),
    equity: num(b.totalStockholderEquity),
    cash: num(b.cash),
    longTermDebt: num(b.longTermDebt),
    currentAssets: num(b.totalCurrentAssets),
    currentLiab: num(b.totalCurrentLiab),
  }))

  const incomes = incomeHist
    .slice(0, 5)
    .map((r) => ({
        endDate: yahooDateCell(r.endDate),
        revenue: num(r.totalRevenue),
        netIncome: num(r.netIncome),
        grossProfit: num(r.grossProfit),
      }))

  const health = {
    debtToEquity: num(financialData?.debtToEquity),
    currentRatio: num(financialData?.currentRatio),
    quickRatio: num(financialData?.quickRatio),
    returnOnEquity: num(financialData?.returnOnEquity) ?? num(keyStats?.returnOnEquity),
    profitMargin: num(financialData?.profitMargins),
    operatingMargin: num(financialData?.operatingMargins),
    ebitdaMargin: num(financialData?.ebitdaMargins),
    revenueGrowth: num(financialData?.revenueGrowth),
    earningsGrowth: num(financialData?.earningsGrowth),
  }

  const narrative = {
    name: (profile?.longName || profile?.shortName || symbol) as string,
    sector: profile?.sector as string | undefined,
    industry: profile?.industry as string | undefined,
    summary: (profile?.longBusinessSummary || '') as string,
    employees: num(profile?.fullTimeEmployees),
    website: profile?.website as string | undefined,
  }

  const market = {
    trailingPE: trailingPe,
    forwardPE: forwardPe,
    peg: num(keyStats?.pegRatio),
    priceToBook: num(keyStats?.priceToBook),
    beta: num(keyStats?.beta),
    enterpriseValue: num(keyStats?.enterpriseValue),
    bookValue: num(keyStats?.bookValue),
    targetMeanPrice: targetMean,
    targetHigh: num(financialData?.targetHighPrice),
    targetLow: num(financialData?.targetLowPrice),
    recommendationMean: num(financialData?.recommendationMean),
    numberOfAnalystOpinions: num(financialData?.numberOfAnalystOpinions),
  }

  const dcfPack: { bear: DcfResult | null; base: DcfResult | null; bull: DcfResult | null } = {
    bear: dcfBear,
    base: dcfBase,
    bull: dcfBull,
  }

  const signal = price && bands?.fairValueMid
    ? describeSignal(price, bands.buyZoneHigh, bands.sellZoneLow, bands.fairValueMid)
    : null

  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  const sma200 = sma(closes, 200)
  const rsi14 = rsi(closes, 14)
  const macdVal = macd(closes)
  const bb = bollinger(closes, 20, 2)
  const atr14 = ohlc.length >= 15 ? atr(ohlc, 14) : null
  const dd = maxDrawdown(closes)
  const dr = dailyReturns(closes)
  const sharpe = sharpeRatio(dr)
  const sortino = sortinoRatio(dr)
  const lastClose = closes.length ? closes[closes.length - 1] : null
  const atrStopLong =
    atr14 != null && lastClose != null ? lastClose - 2 * atr14 : null
  const atrStopShort =
    atr14 != null && lastClose != null ? lastClose + 2 * atr14 : null

  let trendScore: number | null = null
  if (price != null && sma50 != null && sma200 != null) {
    if (price > sma50 && sma50 > sma200) trendScore = 1
    else if (price < sma50 && sma50 < sma200) trendScore = -1
    else trendScore = 0
  }

  const aligned = alignCloses(dates, closes, spyDates, spyCloses)
  const lrA = logReturns(aligned.a)
  const lrB = logReturns(aligned.b)
  const nRet = Math.min(lrA.length, lrB.length)
  const corrSpy =
    nRet >= 30 ? correlation(lrA.slice(-126), lrB.slice(-126)) : null
  const excess20 =
    aligned.a.length > 25 ? excessReturn(aligned.a, aligned.b, 20) : null
  const excess60 =
    aligned.a.length > 65 ? excessReturn(aligned.a, aligned.b, 60) : null

  const bPos =
    price != null && bands?.fairValueMid != null
      ? bandPosition(price, bands.buyZoneHigh, bands.sellZoneLow, bands.fairValueMid)
      : null

  const researchScore = computeResearchScore({
    trailingPE: trailingPe,
    forwardPE: forwardPe,
    debtToEquity: health.debtToEquity,
    returnOnEquity: health.returnOnEquity,
    profitMargin: health.profitMargin,
    rsi14,
    trendScore,
    pctB: bb.pctB,
    excessVsSpy60d: excess60,
    bandPosition: bPos,
  })

  let pivots: ReturnType<typeof classicPivots> | null = null
  if (ohlc.length >= 2) {
    const p = ohlc[ohlc.length - 2]
    pivots = classicPivots(p.high, p.low, p.close)
  }

  const earnings = parseEarningsSnapshot(quoteSummary as Record<string, unknown>)

  const slice52 = closes.length >= 60 ? closes.slice(-Math.min(252, closes.length)) : closes
  const high52w = slice52.length ? Math.max(...slice52) : null
  const low52w = slice52.length ? Math.min(...slice52) : null
  const posIn52w =
    high52w != null && low52w != null && lastClose != null && high52w > low52w
      ? (lastClose - low52w) / (high52w - low52w)
      : null

  const vol20d = closes.length >= 22 ? annualizedVolFromCloses(closes.slice(-22)) : null
  const vol60d = closes.length >= 62 ? annualizedVolFromCloses(closes.slice(-62)) : null
  const volRegime20over60 =
    vol20d != null && vol60d != null && vol60d > 0 ? vol20d / vol60d : null

  /** 200-day MA deviation regime — buy-the-dip / falling-knife classifier */
  const ma200RegimeVal: MA200Regime | null =
    price != null && closes.length >= 220 ? ma200Regime(price, closes, rsi14) : null

  let fib: { fib382: number; fib500: number; fib618: number } | null = null
  if (high52w != null && low52w != null && high52w > low52w) {
    const r = high52w - low52w
    fib = {
      fib382: high52w - 0.382 * r,
      fib500: high52w - 0.5 * r,
      fib618: high52w - 0.618 * r,
    }
  }

  return {
    symbol,
    fetchedAt: new Date().toISOString(),
    narrative,
    market,
    health,
    balances,
    incomes,
    dcf: {
      inputs: {
        fcf0,
        shares,
        ...q,
      },
      scenarios: dcfPack,
    },
    anchors: {
      dcfBase: dcfBase?.valuePerShare ?? null,
      analystTarget: targetMean,
      forwardEarningsHeuristic: forwardHeuristic,
    },
    volatility: { annualized: vol, sampleDays: closes.length },
    bands,
    price,
    signal,
    technicals: {
      sma20,
      sma50,
      sma200,
      rsi14,
      macd: macdVal,
      bollinger: bb,
      atr14,
      atrStopLong,
      atrStopShort,
      trendLabel: trendLabel(sma50, sma200, (price ?? lastClose) || 0),
      maxDrawdownPct: dd?.maxDdPct ?? null,
      sharpe,
      sortino,
      vol20dAnnualized: vol20d,
      vol60dAnnualized: vol60d,
      volRegime20over60,
    },
    relative: {
      correlationVsSpy: corrSpy,
      excessReturn20dVsSpy: excess20,
      excessReturn60dVsSpy: excess60,
      alignedSessions: aligned.a.length,
    },
    researchScore,
    earnings,
    pivots,
    ma200Regime: ma200RegimeVal,
    range52w: {
      high: high52w,
      low: low52w,
      position: posIn52w,
    },
    fibRetracement: fib,
    dataLineage: {
      sources: [
        'Yahoo Finance quoteSummary: profile, financialData, defaultKeyStatistics, statements (balance, income, cash flow), calendarEvents, earningsHistory, recommendations.',
        'Yahoo Finance daily chart (~800 sessions) for volatility, technicals, 52-week range, and SPY alignment for relative strength.',
      ],
      refresh:
        'Each GET to /api/fundamentals recomputes from Yahoo at request time (edge cache may reuse up to ~2 minutes). Quant Lab “Refresh” triggers a new request with your valuation sliders.',
      statementNote:
        'Statement dates and mapped fields follow Yahoo’s aggregation; verify filing time and restatements in primary issuer filings (e.g. SEC EDGAR).',
    },
  }
}

function describeSignal(
  price: number,
  buyHigh: number | null,
  sellLow: number | null,
  fair: number | null
): { label: string; detail: string } | null {
  if (buyHigh == null || sellLow == null || fair == null) return null
  if (price <= buyHigh) {
    return {
      label: 'Below buy-zone upper bound',
      detail: `Price is at or below the mechanical buy-zone ceiling (${buyHigh.toFixed(2)}) vs composite fair value ~${fair.toFixed(2)}.`,
    }
  }
  if (price >= sellLow) {
    return {
      label: 'Above sell-zone lower bound',
      detail: `Price is at or above the mechanical sell-zone floor (${sellLow.toFixed(2)}).`,
    }
  }
  return {
    label: 'Inside neutral band',
    detail: `Between buy-zone and sell-zone vs fair value ~${fair.toFixed(2)} — model is not aggressive either way.`,
  }
}
