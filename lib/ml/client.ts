/**
 * TypeScript client for the optional Python ML sidecar.
 *
 * The sidecar runs separately at localhost:8001 (see ml/server.py).
 * If it is not running, all calls return null — the rest of the app
 * continues to function without ML signals.
 */

const ML_SIDECAR_URL = process.env.ML_SIDECAR_URL ?? 'http://localhost:8001'
const ML_TIMEOUT_MS = 5_000

export interface MlPrediction {
  ticker: string
  /** Probability of a +1% move in the next 5 days (0–1). Null if model unavailable. */
  probability: number | null
  /** BUY / SELL / HOLD */
  signal: 'BUY' | 'SELL' | 'HOLD'
  /** |probability - 0.5| * 2, scaled to [0, 1] */
  confidence: number
  modelVersion: string
  trainedAt: string
  nTrainSamples: number
  featureImportance: Record<string, number>
}

/**
 * Fetches an ML prediction for `ticker` from the Python sidecar.
 * Returns null if the sidecar is unreachable or returns an error.
 */
export async function fetchMlPrediction(ticker: string): Promise<MlPrediction | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ML_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${ML_SIDECAR_URL}/predict/${encodeURIComponent(ticker)}`,
      { signal: controller.signal },
    )
    if (!res.ok) return null
    const data = await res.json()
    return data as MlPrediction
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Checks if the ML sidecar is available.
 * Returns false if it cannot be reached within the timeout.
 */
export async function isMlSidecarAvailable(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  try {
    const res = await fetch(`${ML_SIDECAR_URL}/health`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
