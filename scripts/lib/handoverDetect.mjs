/**
 * Ticker-handover detection (design invariant I6).
 *
 * I6 warns that tickers are recycled and reassigned. The Q-079 audit noted that
 * `verify-data-integrity.mjs` "cannot detect a clean ticker handover": if a
 * symbol is reassigned to a different issuer, the series continues with no
 * missing bars, no NaNs and no ordering faults. Every existing check passes
 * while two issuers are spliced into one price history.
 *
 * What a reassignment DOES leave behind is an overnight move far outside the
 * series' own distribution.
 *
 * THIS DOES NOT IDENTIFY A HANDOVER, and saying otherwise would be the
 * overclaim this invariant exists to prevent. A genuine gap, a trading halt, or
 * an unadjusted split looks identical. It flags a bar a human must explain —
 * which is the honest ceiling without a permanent security identifier, and
 * strictly better than the silence it replaces.
 *
 * Lives in `scripts/lib/` because its only consumer is a plain-Node verifier,
 * and duplicating the arithmetic into `.mjs` to satisfy a layering preference
 * would put two copies of a statistical rule in the repo.
 */

/** Default: a move this many standard deviations of log return is unexplained. */
export const DEFAULT_SIGMAS = 12

/**
 * @param closes  Adjusted closes, ascending by date.
 * @param dates   Parallel ISO dates.
 * @param sigmas  Threshold in standard deviations.
 * @returns Bars whose move is too large to be explained by the series itself.
 */
export function detectTickerHandover(closes, dates, sigmas = DEFAULT_SIGMAS) {
  if (!Array.isArray(closes) || closes.length < 30) return []

  const logRet = []
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]
    const b = closes[i]
    logRet.push(a > 0 && b > 0 ? Math.log(b / a) : 0)
  }
  const mean = logRet.reduce((x, y) => x + y, 0) / logRet.length
  const variance =
    logRet.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / Math.max(1, logRet.length - 1)
  const sd = Math.sqrt(variance)
  // A flat series has no distribution to be an outlier of.
  if (!(sd > 0)) return []

  const out = []
  for (let i = 0; i < logRet.length; i++) {
    if (Math.abs(logRet[i] - mean) > sigmas * sd) {
      out.push({
        index: i + 1,
        date: dates?.[i + 1] ?? '',
        gapRatio: Number(Math.exp(logRet[i]).toFixed(4)),
      })
    }
  }
  return out
}
