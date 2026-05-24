/**
 * HMM 3-state regime client (Phase 15 Q-042-NEW).
 */

export type HmmRegimeLabel = 'Bull' | 'Normal' | 'Bear'

export interface HmmRegimeResult {
  ticker: string
  currentState: HmmRegimeLabel
  probabilities: Record<HmmRegimeLabel, number>
  source: 'python' | 'rule-fallback'
}

export function ruleBasedRegime(closes: number[]): HmmRegimeResult {
  const n = closes.length
  const ticker = 'UNKNOWN'
  if (n < 60) {
    return {
      ticker,
      currentState: 'Normal',
      probabilities: { Bull: 0.33, Normal: 0.34, Bear: 0.33 },
      source: 'rule-fallback',
    }
  }
  const ret63 = (closes[n - 1] - closes[n - 64]) / closes[n - 64]
  const vol20 = std(logReturns(closes.slice(-21)))
  const vol60 = std(logReturns(closes.slice(-61)))
  const volRatio = vol60 > 0 ? vol20 / vol60 : 1
  let state: HmmRegimeLabel = 'Normal'
  if (ret63 > 0.05 && volRatio < 1.1) state = 'Bull'
  else if (ret63 < -0.05 || volRatio > 1.4) state = 'Bear'
  const probs: Record<HmmRegimeLabel, number> = { Bull: 0.2, Normal: 0.6, Bear: 0.2 }
  probs[state] = 0.65
  const rest = (1 - 0.65) / 2
  for (const k of Object.keys(probs) as HmmRegimeLabel[]) {
    if (k !== state) probs[k] = rest
  }
  return { ticker, currentState: state, probabilities: probs, source: 'rule-fallback' }
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
  if (sidecar) {
    try {
      const res = await fetch(`${sidecar}/regime/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const data = (await res.json()) as HmmRegimeResult
        return { ...data, ticker, source: 'python' }
      }
    } catch {
      /* fallback */
    }
  }
  const fb = ruleBasedRegime(closes)
  return { ...fb, ticker }
}
