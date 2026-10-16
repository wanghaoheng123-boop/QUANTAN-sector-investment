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
 * H-DECISION (2026-07-16): once this many bars have elapsed since a position's
 * fill, the exit is observed at that bar's close and filled at the NEXT open —
 * so the position is held 61 bars open-to-open. The only position-level exit
 * besides the drawdown breaker. See `DEFAULT_TIME_EXIT_CONFIG` in
 * `exitRules.ts` for the acceptance evidence.
 */
export const ENGINE_MAX_HOLD_DAYS = 60

/**
 * FIX A: minimum rise of the 200SMA over its 20-bar lookback (`sma200Slope`)
 * for a dip to be bought — 0.5% filters flat and noisy markets.
 */
export const MIN_SMA200_SLOPE = 0.005

/**
 * The FIRST_DIP zone is a close from 0% down to this many percent below the
 * 200SMA. A dip here that fails the slope or proximity test is a HOLD; a deeper
 * one that fails them is labelled SELL (FALLING_KNIFE).
 */
export const FIRST_DIP_FLOOR_PCT = 10

/**
 * FIX D: a dip is bought only if, at some bar of the last 20, price sat no more
 * than this many percent below its 200SMA — not a "forever falling" name.
 */
export const NEAR_SMA200_PCT = 5

/**
 * Position size on the regime-only path, as a fraction of the instrument's CASH
 * at entry (`core.ts` sizes `capital * fraction`, then rounds DOWN to whole
 * shares and skips the bar when that is zero). NOT a Kelly computation — a
 * fixed fraction selected by the `halfKelly` flag; the enhanced path computes a
 * Kelly fraction from confidence instead.
 *
 * Keys are `half`/`full`, not `halfKelly`/`fullKelly`: a `.halfKelly` member
 * here satisfied the inert-config guard's name match for
 * `BacktestConfig.halfKelly` (Q-105 red-team R4).
 */
export const REGIME_PATH_POSITION_FRACTION = { half: 0.15, full: 0.30 } as const

/**
 * Bars of history consumed before the backtest loop may emit its first
 * signal. Set by the LONGEST lookback any signal reads: `sma200DeviationPct`,
 * `sma200Slope` and the EMA50>EMA200 golden-cross gate in `./signals`, all of
 * which need 200 prior bars. The strategy is therefore exposed to the market
 * over `rows.length - BACKTEST_WARMUP_BARS` bars, NOT `rows.length` — every
 * quantity compared against `totalReturn` must span that same window (Q110-Q1).
 */
export const BACKTEST_WARMUP_BARS = 200
