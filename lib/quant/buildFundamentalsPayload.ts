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
import { classicPivots, priorSessionBar } from './pivots'
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

/** Which field the DCF's starting cash flow came from (accountant S11). */
export type Fcf0Source = 'financialData.freeCashflow' | 'statement.freeCashflow' | 'statement.ocfLessCapex'

/**
 * The DCF's starting cash flow, and where it came from. Positive only: a DCF
 * grows a cash flow forward, and growing a negative one is not a valuation
 * (accountant S4 — the OCF − capex fallback used to return a negative value,
 * which then produced a silent null with no reason).
 */
function pickFcf0(cashflowModule: unknown, financialData: AnyRec | null): { value: number; source: Fcf0Source } | null {
  const fc = num(financialData?.freeCashflow)
  if (fc && fc > 0) return { value: fc, source: 'financialData.freeCashflow' }
  const cashflowHistory = extractStatementRows(cashflowModule, [
    'cashflowStatements',
    'cashflowStatementHistory',
  ])
  if (cashflowHistory.length === 0) return null
  const latest = cashflowHistory[0] as AnyRec
  const fcf = num(latest?.freeCashflow)
  if (fcf && fcf > 0) return { value: fcf, source: 'statement.freeCashflow' }
  const ocf = num(latest?.totalCashFromOperatingActivities)
  const capexRaw = num(latest?.capitalExpenditures)
  if (ocf != null && capexRaw != null) {
    const v = ocf - Math.abs(capexRaw)
    return v > 0 ? { value: v, source: 'statement.ocfLessCapex' } : null
  }
  return null
}

function lastAnnualBalanceSheets(rows: AnyRec[], max = 5): AnyRec[] {
  return rows.slice(0, max)
}

function firstString(a: unknown, b: unknown, key: string): string | null {
  for (const o of [a, b]) {
    if (o && typeof o === 'object') {
      const v = (o as AnyRec)[key]
      if (typeof v === 'string' && v.trim() !== '') return v.trim()
    }
  }
  return null
}

/** Yahoo's display strings use hyphens; tolerate dash variants and spacing. */
const normLabel = (s: string) => s.replace(/[‒-―]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Industries inside Financial Services where operating cash flow IS separable
 * from financing, so an FCF DCF can apply. Everything else in the sector is
 * refused — an allowlist, because a denylist has to know every lender label
 * (accountant B3: REIT - Mortgage and Financial Conglomerates were admitted,
 * Insurance Brokers wrongly refused).
 */
export const DCF_ADMITTED_FINANCIAL_INDUSTRIES = ['Insurance Brokers', 'Financial Data & Stock Exchanges']

/** Lender and balance-sheet labels refused wherever they appear, whatever the sector says. */
const BALANCE_SHEET_INDUSTRY = /^(?:banks\b|insurance\b(?! brokers)|capital markets|mortgage finance|financial conglomerates|reit - mortgage|shell companies)/

/** Labels Yahoo uses for a MIX of separable and balance-sheet businesses, which no field splits. */
const MIXED_INDUSTRY = /^(?:credit services|asset management)\b/

const BALANCE_SHEET_REASON =
  'the balance sheet is the product (deposits, reserves, borrowings), so cash flow cannot be separated from financing.'

/**
 * Whether an FCF-based DCF applies, as the reason it does not (null = applies).
 *
 * Fails CLOSED (accountant B2): an unknown classification refuses rather than
 * proceeds — the refusal-gate rule in CLAUDE.md. Damodaran (2012) ch. 21:
 * for financial-service firms, debt is raw material, not capital, so cash flow
 * to the firm cannot be defined.
 */
export function dcfApplicability(c: { sector: string | null; industry: string | null }): string | null {
  const sector = c.sector ? normLabel(c.sector) : null
  const industry = c.industry ? normLabel(c.industry) : null
  if (sector === null && industry === null) {
    return "The company's sector and industry are unavailable, so whether an FCF DCF applies cannot be checked."
  }
  if (industry !== null && BALANCE_SHEET_INDUSTRY.test(industry)) {
    return `An FCF DCF does not apply to ${c.industry}: ${BALANCE_SHEET_REASON}`
  }
  if (industry !== null && MIXED_INDUSTRY.test(industry)) {
    return `An FCF DCF is not applied to ${c.industry}: Yahoo files lenders or leveraged investment vehicles under this label alongside fee businesses, and no field separates them.`
  }
  if (sector === 'financial services') {
    const admitted = industry !== null && DCF_ADMITTED_FINANCIAL_INDUSTRIES.some((a) => normLabel(a) === industry)
    if (!admitted) {
      return `An FCF DCF does not apply to ${c.industry ?? 'this Financial Services company (industry unavailable)'}: ${BALANCE_SHEET_REASON}`
    }
  }
  return null
}

/**
 * Scenario discount-rate offsets: the bear case adds 1.5pp, the bull case
 * removes 1pp. SOURCE: inherited unchanged from the pre-Q-086 implementation,
 * kept so the default scenarios do not move. They are sensitivity offsets, not
 * estimates of any company's risk premium, and no paper is claimed for them.
 * What changed (accountant S1): the bull rate was floored at an absolute 6%,
 * which pinned the bull value for every input from 4% to 7% and put the bull
 * rate ABOVE base at 4-5%. It is now never above base and never closer to
 * terminal growth than MIN_RATE_SPREAD.
 */
export const BEAR_RATE_DELTA = 0.015
export const BULL_RATE_DELTA = 0.01
/** Bear-case terminal growth cap. SOURCE: inherited unchanged from the pre-Q-086 code. */
export const BEAR_TERMINAL_GROWTH_CAP = 0.02
/**
 * The smallest discount-rate-minus-growth spread a scenario may use.
 *
 * The Gordon terminal value is FCF × (1+g) / (r − g), so its multiple of
 * next year's cash flow is 1 / (r − g) and diverges as the spread closes
 * (Damodaran, A. (2012). Investment Valuation, 3rd ed., ch. 12, the stable-
 * growth model). A 2pp spread caps that multiple at 50×. The 2pp is this
 * platform's choice of cap, not a sourced estimate; the accountant gate
 * measured 105,000/sh at a 0.01pp spread (S2).
 */
export const MIN_RATE_SPREAD = 0.02

export function scenarioRates(q: { wacc: number; terminalGrowth: number }) {
  const base = q.wacc
  const bearTerminalGrowth = Math.min(q.terminalGrowth, BEAR_TERMINAL_GROWTH_CAP)
  const bull = Math.min(base, Math.max(base - BULL_RATE_DELTA, q.terminalGrowth + MIN_RATE_SPREAD))
  return { bear: base + BEAR_RATE_DELTA, base, bull, bearTerminalGrowth }
}

/** When the inputs do not make bear <= base <= bull, say so instead of labelling them as if they did. */
export function scenarioOrderNote(
  q: { gBear: number; gBase: number; gBull: number },
  rates: { base: number; bull: number },
): string | null {
  const notes: string[] = []
  if (!(q.gBear <= q.gBase && q.gBase <= q.gBull)) notes.push('the growth inputs are not ordered bear ≤ base ≤ bull')
  if (rates.bull >= rates.base) notes.push('the bull discount rate cannot go below the base rate without closing on terminal growth, so it equals the base rate')
  return notes.length ? `Scenario labels are approximate: ${notes.join('; ')}.` : null
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
  q: FundamentalsQuery,
  /**
   * The currency the price is quoted in, from the route's `quote()` row. The
   * route does not request the `price` quoteSummary module, so without this the
   * currency refusal below could never fire in production.
   */
  quoteCurrencyIn?: string | null,
) {
  // Narrative text only. Classification (sector, industry) is read field by
  // field below, because the DCF refusal depends on it.
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

  // `ordinarySharesNumber` was a second fallback here; it is not a
  // DefaultKeyStatistics field in yahoo-finance2 3.13.2, so it never fired.
  const shares = num(keyStats?.sharesOutstanding)
  const fcf0Pick = pickFcf0(cashModule, financialData)
  const fcf0 = fcf0Pick?.value ?? null

  // Q-086 (2026-10-17) — this is an FCFE model, and says so.
  //
  // `fcf0` is Yahoo's `financialData.freeCashflow`. Its exact definition is
  // NOT verified by this platform (yahoo-finance2 types it with no doc; the
  // accountant gate, reviews/q086-accountant-2026-10-17.md, Q1): it is TREATED
  // as cash available to equity holders with zero net borrowing, which is an
  // assumption, not an identity. The code used to discount it at a "WACC" and
  // subtract net debt built from `balanceSheetHistory` — the FCFF bridge. That
  // bridge was inert on the four tickers measured (AAPL/JPM/NEE/XOM,
  // 2026-10-16), whose balance-sheet rows carry only `endDate`, so net debt was
  // 0 there; tickers that still return the fields would have had debt
  // subtracted, and no longer do.
  //
  // Citation: Damodaran, A. (2012). Investment Valuation (3rd ed.), ch. 14 —
  // FCFE discounted at the cost of equity yields equity value directly.
  const classification = {
    // Field by field (accountant B2): `summaryProfile || assetProfile` took the
    // first truthy object, so `summaryProfile: {}` hid a populated assetProfile.
    sector: firstString(quoteSummary.summaryProfile, quoteSummary.assetProfile, 'sector'),
    industry: firstString(quoteSummary.summaryProfile, quoteSummary.assetProfile, 'industry'),
  }
  const reportingCurrency = typeof financialData?.financialCurrency === 'string' ? financialData.financialCurrency : null
  const quoteCurrency =
    typeof quoteCurrencyIn === 'string' && quoteCurrencyIn !== ''
      ? quoteCurrencyIn
      : typeof quoteSummary.price === 'object' && quoteSummary.price !== null && typeof (quoteSummary.price as AnyRec).currency === 'string'
        ? ((quoteSummary.price as AnyRec).currency as string)
        : null
  const dcfNotApplicable =
    dcfApplicability(classification) ??
    // Accountant S7: a per-share value in the reporting currency compared with
    // a price in the quote currency is not a valuation (a foreign ADR).
    (reportingCurrency && quoteCurrency && reportingCurrency !== quoteCurrency
      ? `The cash flow is reported in ${reportingCurrency} and the price is quoted in ${quoteCurrency}, and this model does not convert currencies or ADR share ratios.`
      : null)

  const fcfReason =
    fcf0 == null ? 'Yahoo supplied no positive free cash flow for this company, and a DCF needs one to grow.' : null
  const sharesReason = shares == null || shares <= 0 ? 'Yahoo supplied no shares outstanding, so a per-share value cannot be computed.' : null
  const spreadReason =
    q.wacc - q.terminalGrowth < MIN_RATE_SPREAD
      ? `The discount rate is within ${(MIN_RATE_SPREAD * 100).toFixed(0)} points of terminal growth, where the terminal value swamps everything and diverges; widen the gap.`
      : null
  /** Why there is no DCF at all, when there is none (accountant S4: every null carries a reason). */
  const dcfUnavailable = dcfNotApplicable ?? sharesReason ?? fcfReason ?? spreadReason

  const rates = scenarioRates(q)
  const canDcf = dcfUnavailable === null && shares != null && fcf0 != null
  const dcfBear = canDcf
    ? runDcf({ fcf0: fcf0 as number, shares: shares as number, wacc: rates.bear, terminalGrowth: rates.bearTerminalGrowth, explicitGrowth: q.gBear })
    : null
  const dcfBase = canDcf
    ? runDcf({ fcf0: fcf0 as number, shares: shares as number, wacc: rates.base, terminalGrowth: q.terminalGrowth, explicitGrowth: q.gBase })
    : null
  const dcfBull = canDcf
    ? runDcf({ fcf0: fcf0 as number, shares: shares as number, wacc: rates.bull, terminalGrowth: q.terminalGrowth, explicitGrowth: q.gBull })
    : null
  /** Accountant S1: the bear/base/bull labels must describe the inputs actually used. */
  const scenarioNote = scenarioOrderNote(q, rates)

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
  // Accountant B5: a refused DCF must not reappear as buy/sell zones drawn
  // from the two remaining anchors (the forward heuristic is ~ the price).
  const bands =
    price && price > 0 && dcfNotApplicable === null
      ? computeAdaptiveBands({
          currentPrice: price,
          anchors,
          anchorLabels: ['DCF base', 'analyst mean target', 'forward EPS × P/E heuristic'],
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
    sector: classification.sector ?? undefined,
    industry: classification.industry ?? undefined,
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

  // Floor-trader pivots: derive from the most-recent COMPLETED session's HLC.
  // priorSessionBar inspects dates to distinguish "last bar is today's intraday"
  // (use length-2) from "last bar IS yesterday/the prior complete session"
  // (use length-1). Previous code always took length-2 and silently returned
  // 2-day-old data on weekends, holidays, and pre-market hits.
  let pivots: ReturnType<typeof classicPivots> | null = null
  const prior = priorSessionBar(ohlc, dates)
  if (prior) {
    pivots = classicPivots(prior.high, prior.low, prior.close)
  }

  const earnings = parseEarningsSnapshot(quoteSummary as Record<string, unknown>)

  const slice52 = closes.length >= 60 ? closes.slice(-Math.min(252, closes.length)) : closes
  const high52w = slice52.length ? Math.max(...slice52) : null
  const low52w = slice52.length ? Math.min(...slice52) : null
  // Phase 13 S2 audit (cross-cutting Pattern 1 — comment-vs-code drift):
  // posIn52w previously used `lastClose` (yesterday's daily-bar close) but
  // should use `price` (the LIVE intraday value) so the 52w-range position
  // reflects current market state, not yesterday's close. Fall back to
  // `lastClose` only when `price` is unavailable.
  const pricePoint = price != null && price > 0 ? price : lastClose
  const posIn52w =
    high52w != null && low52w != null && pricePoint != null && high52w > low52w
      ? (pricePoint - low52w) / (high52w - low52w)
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
      /** Q-086: Yahoo's free cash flow, treated as cash to equity, at a cost of equity — no debt bridge. */
      model: 'FCFE' as const,
      /** Why an FCF DCF does not apply to this company (a refusal; no bands are drawn). */
      notApplicable: dcfNotApplicable,
      /** Why no scenario was computed, for ANY reason — the refusal above, or a missing input. */
      unavailable: dcfUnavailable,
      /** When the bear/base/bull labels do not strictly describe the inputs used. */
      scenarioNote,
      inputs: {
        fcf0,
        fcf0Source: fcf0Pick?.source ?? null,
        shares,
        ...q,
        /** `wacc` is the legacy name of this input; it is used as a cost of equity (accountant S10). */
        discountRate: q.wacc,
        scenarioRates: rates,
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
