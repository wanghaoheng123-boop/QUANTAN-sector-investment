/**
 * QA Data Validator — automated data quality checks.
 * Detects NaN, stale quotes, zero values, and anomalous price moves.
 */

export interface DataQualityIssue {
  ticker: string
  field: string
  severity: 'error' | 'warning' | 'info'
  message: string
  value?: number | string | null
}

export interface DataQualityReport {
  ticker: string
  issues: DataQualityIssue[]
  score: number // 0-100, 100 = perfect
  timestamp: string
}

/** Check a single quote for data quality issues. */
export function validateQuote(ticker: string, quote: {
  price?: number | null
  change?: number | null
  changePct?: number | null
  volume?: number | null
  high52w?: number | null
  low52w?: number | null
  pe?: number | null
  marketCap?: string | null
  quoteTime?: string | null
}): DataQualityReport {
  const issues: DataQualityIssue[] = []

  // Price validation
  if (quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0) {
    issues.push({
      ticker, field: 'price', severity: 'error',
      message: 'Price is null, NaN, or non-positive',
      value: quote.price,
    })
  }

  // Volume validation
  if (quote.volume != null && (!Number.isFinite(quote.volume) || quote.volume < 0)) {
    issues.push({
      ticker, field: 'volume', severity: 'warning',
      message: 'Volume is invalid',
      value: quote.volume,
    })
  }
  if (quote.volume === 0) {
    issues.push({
      ticker, field: 'volume', severity: 'info',
      message: 'Zero volume — market may be closed or data unavailable',
    })
  }

  // Extreme change detection (> 20% single day)
  if (quote.changePct != null && Math.abs(quote.changePct) > 20) {
    issues.push({
      ticker, field: 'changePct', severity: 'warning',
      message: `Extreme daily change: ${quote.changePct.toFixed(2)}% — verify data correctness`,
      value: quote.changePct,
    })
  }

  // 52-week range sanity
  if (quote.high52w != null && quote.low52w != null && quote.price != null) {
    if (quote.price > quote.high52w * 1.05) {
      issues.push({
        ticker, field: 'price', severity: 'warning',
        message: 'Price is >5% above 52-week high — possible stale high or data error',
      })
    }
    if (quote.low52w > 0 && quote.high52w / quote.low52w > 10) {
      issues.push({
        ticker, field: '52w-range', severity: 'info',
        message: '52-week range ratio > 10x — extreme volatility or data issue',
      })
    }
  }

  // Stale quote detection
  if (quote.quoteTime != null) {
    const quoteDate = new Date(quote.quoteTime)
    const now = new Date()
    const hoursAgo = (now.getTime() - quoteDate.getTime()) / (1000 * 60 * 60)
    // If market should be open and quote is > 2 hours old
    if (hoursAgo > 48) {
      issues.push({
        ticker, field: 'quoteTime', severity: 'warning',
        message: `Quote is ${Math.floor(hoursAgo)} hours old — may be stale`,
        value: quote.quoteTime,
      })
    }
  }

  // Score: start at 100, deduct for issues
  let score = 100
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 30
    else if (issue.severity === 'warning') score -= 10
    else score -= 2
  }

  return {
    ticker,
    issues,
    score: Math.max(0, score),
    timestamp: new Date().toISOString(),
  }
}

/** Validate an OHLCV bar series for indicator calculation. */
export function validateOhlcvSeries(
  ticker: string,
  bars: Array<{ open: number; high: number; low: number; close: number; volume?: number }>,
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []

  if (bars.length === 0) {
    issues.push({ ticker, field: 'bars', severity: 'error', message: 'Empty bar series' })
    return issues
  }

  let nanCount = 0
  let zeroCloseCount = 0
  let inversionCount = 0

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    if (!Number.isFinite(b.close) || !Number.isFinite(b.open) ||
        !Number.isFinite(b.high) || !Number.isFinite(b.low)) {
      nanCount++
    }
    if (b.close <= 0) zeroCloseCount++
    if (b.high < b.low) inversionCount++

    // Detect extreme single-day moves (> 30%)
    if (i > 0 && bars[i - 1].close > 0) {
      const dayReturn = Math.abs(b.close / bars[i - 1].close - 1)
      if (dayReturn > 0.30) {
        issues.push({
          ticker, field: `bar[${i}]`, severity: 'warning',
          message: `Extreme move: ${(dayReturn * 100).toFixed(1)}% in one bar`,
          value: dayReturn,
        })
      }
    }
  }

  if (nanCount > 0) {
    issues.push({
      ticker, field: 'bars', severity: 'error',
      message: `${nanCount} bars with NaN/Infinity values`,
    })
  }
  if (zeroCloseCount > 0) {
    issues.push({
      ticker, field: 'bars', severity: 'error',
      message: `${zeroCloseCount} bars with zero or negative close`,
    })
  }
  if (inversionCount > 0) {
    issues.push({
      ticker, field: 'bars', severity: 'warning',
      message: `${inversionCount} bars with high < low (OHLC inversion)`,
    })
  }

  return issues
}

/** Check for look-ahead bias: ensure signal index never exceeds data index. */
export function detectLookAheadBias(
  signalDates: string[],
  dataDates: string[],
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []
  const dataDateSet = new Set(dataDates)

  for (const signalDate of signalDates) {
    if (!dataDateSet.has(signalDate)) {
      issues.push({
        ticker: 'SYSTEM',
        field: 'lookAheadBias',
        severity: 'error',
        message: `Signal generated for date ${signalDate} not found in data — possible look-ahead bias`,
      })
    }
  }

  return issues
}
