/**
 * Production feature flags (Phase 15 Q-009).
 *
 * `enhancedCombinedSignal` underperforms the canonical benchmark (52.63% vs 57.05%
 * aggregate WR). It remains available for research via `npm run benchmark:enhanced`
 * and opt-in env, but is OFF in production by default until vsBaseline >= 0.
 */

/** Explicit opt-in: QUANTAN_USE_ENHANCED_SIGNAL=1 */
export function useEnhancedCombinedSignal(): boolean {
  const raw = process.env.QUANTAN_USE_ENHANCED_SIGNAL
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  // Production API/backtest routes default OFF; dev/test keep engine parity.
  if (process.env.NODE_ENV === 'production') return false
  return true
}
