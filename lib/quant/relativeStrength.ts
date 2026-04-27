/** Align two close series by trading day key (YYYY-MM-DD). */

export function alignCloses(
  datesA: string[],
  closesA: number[],
  datesB: string[],
  closesB: number[]
): { a: number[]; b: number[] } {
  const mapB = new Map<string, number>()
  for (let i = 0; i < datesB.length; i++) mapB.set(datesB[i], closesB[i])
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < datesA.length; i++) {
    const d = datesA[i]
    const ca = closesA[i]
    const cb = mapB.get(d)
    if (cb != null && ca > 0 && cb > 0) {
      a.push(ca)
      b.push(cb)
    }
  }
  return { a, b }
}

export function logReturns(closes: number[]): number[] {
  const r: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]))
  }
  return r
}

export function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 10) return null
  const xs = x.slice(-n)
  const ys = y.slice(-n)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const vx = xs[i] - mx
    const vy = ys[i] - my
    num += vx * vy
    dx += vx * vx
    dy += vy * vy
  }
  const den = Math.sqrt(dx * dy)
  return den > 0 ? num / den : null
}

/** Total return over last `days` trading sessions. */
export function trailingReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null
  const old = closes[closes.length - 1 - days]
  const last = closes[closes.length - 1]
  if (old <= 0) return null
  return last / old - 1
}

/** Stock return minus benchmark return (same window). */
export function excessReturn(
  stockCloses: number[],
  benchCloses: number[],
  days: number
): number | null {
  const rs = trailingReturn(stockCloses, days)
  const rb = trailingReturn(benchCloses, days)
  if (rs == null || rb == null) return null
  return rs - rb
}

export interface RelativeStrengthRow {
  ticker: string
  ratio: number              // last close / SPY last close, raw scale
  ratio1mAgo: number | null  // ratio 21 trading days ago
  pct1m: number | null       // % change in ratio over 1m (positive = outperforming)
  pct3m: number | null       // % change in ratio over 3m (~63 trading days)
  pct6m: number | null       // % change in ratio over 6m (~126 trading days)
  rank: number
}

/**
 * Compute relative-strength rows for each ticker vs SPY (the benchmark).
 * Uses ratio = price / SPY_price; positive % change in ratio = outperformance.
 *
 * @param tickerCloses  Map of ticker → daily closes (oldest → newest)
 * @param spyCloses     SPY daily closes (oldest → newest), same date alignment expected
 * @returns Sorted by 1-month relative strength descending, with rank assigned
 */
export function relativeStrengthVsBenchmark(
  tickerCloses: Record<string, number[]>,
  spyCloses: number[],
): RelativeStrengthRow[] {
  if (spyCloses.length < 22) return []

  const spyLast = spyCloses[spyCloses.length - 1]
  const spy1mAgo = spyCloses[spyCloses.length - 22] ?? null
  const spy3mAgo = spyCloses[spyCloses.length - 64] ?? null
  const spy6mAgo = spyCloses[spyCloses.length - 127] ?? null

  if (!(spyLast > 0)) return []

  const rows: Omit<RelativeStrengthRow, 'rank'>[] = []
  for (const [ticker, closes] of Object.entries(tickerCloses)) {
    if (!closes || closes.length < 22) continue
    const last = closes[closes.length - 1]
    if (!(last > 0)) continue

    const ratio = last / spyLast

    const computeRatio = (priceAgo: number | null | undefined, spyAgo: number | null) =>
      priceAgo != null && priceAgo > 0 && spyAgo != null && spyAgo > 0 ? priceAgo / spyAgo : null

    const ratio1m = computeRatio(closes[closes.length - 22], spy1mAgo)
    const ratio3m = computeRatio(closes[closes.length - 64], spy3mAgo)
    const ratio6m = computeRatio(closes[closes.length - 127], spy6mAgo)

    const pct1m = ratio1m != null ? (ratio - ratio1m) / ratio1m : null
    const pct3m = ratio3m != null ? (ratio - ratio3m) / ratio3m : null
    const pct6m = ratio6m != null ? (ratio - ratio6m) / ratio6m : null

    rows.push({ ticker, ratio, ratio1mAgo: ratio1m, pct1m, pct3m, pct6m })
  }

  rows.sort((a, b) => (b.pct1m ?? -Infinity) - (a.pct1m ?? -Infinity))
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}
