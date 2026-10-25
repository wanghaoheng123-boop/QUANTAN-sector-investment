/**
 * A vendor-supplied number as a finite number, or null.
 *
 * Accepts a finite number, or a plain decimal string (optional sign, optional
 * exponent, surrounding whitespace). Rejects everything else: `Number(' ')`,
 * `Number(false)` and `Number([])` are all 0 and `Number(true)` is 1, which is
 * how a blank or a boolean became a measured-looking figure (red-team F5 on
 * Q-156/Q-157); hex strings are rejected too. The one parser for vendor fields
 * in lib/btcSnapshot.ts and lib/options/chain.ts.
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

export function finiteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!DECIMAL.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
