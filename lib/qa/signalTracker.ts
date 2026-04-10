/**
 * QA Signal Tracker — logs signals with outcomes for accuracy monitoring.
 * Tracks rolling win rates at 5d, 10d, 20d horizons.
 */

export interface TrackedSignal {
  ticker: string
  date: string
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  entryPrice: number
  regime: string
  // Outcomes (filled in after N days)
  return5d?: number | null
  return10d?: number | null
  return20d?: number | null
  outcome5d?: 'WIN' | 'LOSS' | 'PENDING'
  outcome10d?: 'WIN' | 'LOSS' | 'PENDING'
  outcome20d?: 'WIN' | 'LOSS' | 'PENDING'
}

export interface AccuracyReport {
  totalSignals: number
  buySignals: number
  sellSignals: number
  // Win rates at each horizon
  winRate5d: number | null
  winRate10d: number | null
  winRate20d: number | null
  // Average returns
  avgReturn5d: number | null
  avgReturn10d: number | null
  avgReturn20d: number | null
  // False positive rate (BUY signals that resulted in loss)
  falsePositiveRate5d: number | null
  falsePositiveRate20d: number | null
  // By confidence bucket
  highConfidenceWinRate: number | null  // confidence >= 80
  lowConfidenceWinRate: number | null   // confidence < 60
}

/** Evaluate signal outcomes given future price data. */
export function evaluateSignalOutcomes(
  signals: Array<{
    ticker: string
    date: string
    action: 'BUY' | 'HOLD' | 'SELL'
    confidence: number
    entryPrice: number
    regime: string
  }>,
  futurePrices: Map<string, number[]>, // ticker -> daily closes after signal
): TrackedSignal[] {
  return signals.map(sig => {
    const prices = futurePrices.get(sig.ticker) || []
    const entry = sig.entryPrice

    const ret5d = prices.length >= 5 ? (prices[4] - entry) / entry : null
    const ret10d = prices.length >= 10 ? (prices[9] - entry) / entry : null
    const ret20d = prices.length >= 20 ? (prices[19] - entry) / entry : null

    // For BUY signals, positive return = WIN. For SELL signals, negative return = WIN.
    const isWin = (ret: number | null, action: string) => {
      if (ret == null) return 'PENDING' as const
      if (action === 'BUY') return ret > 0 ? 'WIN' as const : 'LOSS' as const
      if (action === 'SELL') return ret < 0 ? 'WIN' as const : 'LOSS' as const
      return 'PENDING' as const
    }

    return {
      ...sig,
      return5d: ret5d,
      return10d: ret10d,
      return20d: ret20d,
      outcome5d: isWin(ret5d, sig.action),
      outcome10d: isWin(ret10d, sig.action),
      outcome20d: isWin(ret20d, sig.action),
    }
  })
}

/** Compute accuracy report from tracked signals. */
export function computeAccuracyReport(signals: TrackedSignal[]): AccuracyReport {
  const actionable = signals.filter(s => s.action !== 'HOLD')
  const buys = actionable.filter(s => s.action === 'BUY')
  const sells = actionable.filter(s => s.action === 'SELL')

  const winRate = (sigs: TrackedSignal[], horizon: '5d' | '10d' | '20d'): number | null => {
    const key = `outcome${horizon}` as keyof TrackedSignal
    const resolved = sigs.filter(s => s[key] === 'WIN' || s[key] === 'LOSS')
    if (resolved.length === 0) return null
    const wins = resolved.filter(s => s[key] === 'WIN').length
    return wins / resolved.length
  }

  const avgReturn = (sigs: TrackedSignal[], horizon: '5d' | '10d' | '20d'): number | null => {
    const key = `return${horizon}` as keyof TrackedSignal
    const valid = sigs.filter(s => s[key] != null && typeof s[key] === 'number') as TrackedSignal[]
    if (valid.length === 0) return null
    return valid.reduce((sum, s) => sum + (s[key] as number), 0) / valid.length
  }

  const falsePositiveRate = (horizon: '5d' | '20d'): number | null => {
    const key = `outcome${horizon}` as keyof TrackedSignal
    const resolved = buys.filter(s => s[key] === 'WIN' || s[key] === 'LOSS')
    if (resolved.length === 0) return null
    const losses = resolved.filter(s => s[key] === 'LOSS').length
    return losses / resolved.length
  }

  const highConf = actionable.filter(s => s.confidence >= 80)
  const lowConf = actionable.filter(s => s.confidence < 60)

  return {
    totalSignals: signals.length,
    buySignals: buys.length,
    sellSignals: sells.length,
    winRate5d: winRate(actionable, '5d'),
    winRate10d: winRate(actionable, '10d'),
    winRate20d: winRate(actionable, '20d'),
    avgReturn5d: avgReturn(actionable, '5d'),
    avgReturn10d: avgReturn(actionable, '10d'),
    avgReturn20d: avgReturn(actionable, '20d'),
    falsePositiveRate5d: falsePositiveRate('5d'),
    falsePositiveRate20d: falsePositiveRate('20d'),
    highConfidenceWinRate: winRate(highConf, '20d'),
    lowConfidenceWinRate: winRate(lowConf, '20d'),
  }
}

/** Alert if rolling win rate drops below threshold. */
export function checkAccuracyAlerts(
  report: AccuracyReport,
  winRateThreshold = 0.55,
): string[] {
  const alerts: string[] = []

  if (report.winRate20d != null && report.winRate20d < winRateThreshold) {
    alerts.push(`ALERT: 20d win rate (${(report.winRate20d * 100).toFixed(1)}%) below threshold (${(winRateThreshold * 100).toFixed(0)}%)`)
  }

  if (report.falsePositiveRate20d != null && report.falsePositiveRate20d > 0.50) {
    alerts.push(`ALERT: False positive rate (${(report.falsePositiveRate20d * 100).toFixed(1)}%) is above 50%`)
  }

  if (report.highConfidenceWinRate != null && report.lowConfidenceWinRate != null) {
    if (report.highConfidenceWinRate < report.lowConfidenceWinRate) {
      alerts.push('ALERT: High-confidence signals performing worse than low-confidence — calibration issue')
    }
  }

  return alerts
}
