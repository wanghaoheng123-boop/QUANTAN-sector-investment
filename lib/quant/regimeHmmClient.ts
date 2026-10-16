/**
 * HMM 3-state regime client (Phase 15 Q-042-NEW).
 */

export type HmmRegimeLabel = 'Bull' | 'Normal' | 'Bear'

export interface HmmRegimeResult {
  ticker: string
  currentState: HmmRegimeLabel
  /**
   * HMM posterior probabilities — null from the rule fallback. Q-140 red-team
   * H2: the fallback returned CONSTANTS (0.65 for the chosen state, 0.175 for
   * each other) shaped like a posterior. A rule has no posterior, and a
   * fabricated one is a calibration claim nobody measured.
   */
  probabilities: Record<HmmRegimeLabel, number> | null
  source: 'python' | 'rule-fallback'
  /** Set when the HMM service is configured but did not answer (I2). */
  degraded?: boolean
  error?: { code: 'quant_framework_unreachable'; message: string }
}

export function ruleBasedRegime(closes: number[]): HmmRegimeResult {
  const n = closes.length
  const ticker = 'UNKNOWN'
  if (n < 60) {
    return { ticker, currentState: 'Normal', probabilities: null, source: 'rule-fallback' }
  }
  const ret63 = (closes[n - 1] - closes[n - 64]) / closes[n - 64]
  const vol20 = std(logReturns(closes.slice(-21)))
  const vol60 = std(logReturns(closes.slice(-61)))
  const volRatio = vol60 > 0 ? vol20 / vol60 : 1
  let state: HmmRegimeLabel = 'Normal'
  if (ret63 > 0.05 && volRatio < 1.1) state = 'Bull'
  else if (ret63 < -0.05 || volRatio > 1.4) state = 'Bear'
  return { ticker, currentState: state, probabilities: null, source: 'rule-fallback' }
}

function logReturns(closes: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]))
  return out
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export async function fetchHmmRegime(ticker: string, closes: number[]): Promise<HmmRegimeResult> {
  const sidecar = process.env.QUANT_FRAMEWORK_URL
  let failure: string | null = null
  if (sidecar) {
    try {
      const res = await fetch(`${sidecar}/regime/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = (await res.json()) as HmmRegimeResult
        return { ...data, ticker, source: 'python' }
      }
      failure = `HTTP ${res.status}`
    } catch (e) {
      failure = e instanceof Error ? e.name : 'network error'
    }
  }
  const fb = ruleBasedRegime(closes)
  return {
    ...fb,
    ticker,
    ...(failure != null
      ? {
          degraded: true,
          error: {
            code: 'quant_framework_unreachable' as const,
            message: `The HMM service did not answer (${failure}); this state comes from a volatility-ratio rule.`,
          },
        }
      : {}),
  }
}
