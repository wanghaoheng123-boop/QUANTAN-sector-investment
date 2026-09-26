/**
 * Q-105 — the numbers the per-instrument engine (`core.ts` `backtestInstrument`)
 * actually trades on, in a module with NO runtime imports.
 *
 * Two reasons it is a separate leaf:
 *   1. The /backtest page described a strategy the engine no longer ran (ATR and
 *      trailing stops retired in D2, SELL exits in D4, a 55% confidence floor the
 *      production path never reads). Copy that quotes these constants cannot
 *      drift from the engine again without failing a test.
 *   2. `exitRules.ts` and `regimeSignal.ts` import `lib/quant/indicators`. The
 *      page is a client component, so importing the constants from THOSE modules
 *      would ship the indicator library to the browser to render a sentence.
 */

/**
 * H-DECISION (2026-07-16): the engine exits every position this many bars after
 * its fill — the only position-level exit besides the drawdown breaker. See
 * `DEFAULT_TIME_EXIT_CONFIG` in `exitRules.ts` for the acceptance evidence.
 */
export const ENGINE_MAX_HOLD_DAYS = 60

/**
 * FIX A: minimum rise of the 200SMA over its 20-bar lookback (`sma200Slope`)
 * for a dip to be bought — 0.5% filters flat and noisy markets.
 */
export const MIN_SMA200_SLOPE = 0.005

/**
 * FIX D: a dip is bought only if, at some bar of the last 20, price sat no more
 * than this many percent below its 200SMA — not a "forever falling" name.
 */
export const NEAR_SMA200_PCT = 5

/**
 * Position size on the regime-only path, as a fraction of capital. NOT a Kelly
 * computation — a fixed fraction selected by the `halfKelly` flag. The enhanced
 * path computes a Kelly fraction from confidence instead.
 */
export const REGIME_PATH_POSITION_FRACTION = { halfKelly: 0.15, fullKelly: 0.30 } as const
