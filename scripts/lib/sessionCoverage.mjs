/**
 * Cross-ticker session coverage (Q110-D1, 2026-09-05).
 *
 * `verify-data-integrity.mjs` fails on a calendar gap > 5 days between
 * CONSECUTIVE bars of one series. A single missing session cannot trip that:
 * 2026-07-30 (Thu) → 2026-08-03 (Mon) is four days. EQIX sat one bar short of
 * every peer — 1253 against 1254 — and every check in that file passed.
 *
 * A hole that small is invisible from inside one series and obvious the moment
 * you compare series. This is the comparison, extracted as a pure function so
 * it can be tested against constructed inputs rather than only against whatever
 * the fixture directory happens to contain today — the same shape as
 * `handoverDetect.mjs`.
 *
 * DETECTION ONLY. The remedy for a missing bar is to refetch it. Fabricating or
 * forward-filling one crosses the boundary design invariant I3 exists to defend,
 * and a backtest silently computed on a different calendar from its peers is the
 * failure the PRIME DIRECTIVE calls worse than saying "I don't know".
 */

/** A session counts as real when this share of the universe traded it. */
export const DEFAULT_QUORUM = 0.9

/**
 * @param {Map<string, Set<string>>} byTicker  ticker → set of YYYY-MM-DD
 * @param {number} quorum                      share of the universe, 0..1
 * @returns {{ sessions: string[], holes: Array<{ ticker: string, missing: string[] }> }}
 *   `sessions` is the consensus calendar; `holes` names each ticker missing
 *   sessions that fall INSIDE its own first..last range — a name that listed
 *   mid-window is short of history, not full of holes, and the two must not be
 *   reported as the same thing.
 */
export function findSessionHoles(byTicker, quorum = DEFAULT_QUORUM) {
  const universe = byTicker.size
  if (universe === 0) return { sessions: [], holes: [] }

  const tally = new Map()
  for (const dates of byTicker.values()) {
    for (const d of dates) tally.set(d, (tally.get(d) ?? 0) + 1)
  }

  const threshold = universe * quorum
  const sessions = [...tally.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([d]) => d)
    .sort()

  const holes = []
  for (const [ticker, dates] of byTicker) {
    if (dates.size === 0) continue
    const sorted = [...dates].sort()
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const missing = sessions.filter((d) => d >= first && d <= last && !dates.has(d))
    if (missing.length > 0) holes.push({ ticker, missing })
  }

  return { sessions, holes }
}
