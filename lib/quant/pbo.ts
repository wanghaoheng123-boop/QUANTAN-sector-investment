/**
 * Probability of Backtest Overfitting (PBO) via Combinatorially Symmetric
 * Cross-Validation (CSCV).
 *
 * Bailey, Borwein, López de Prado & Zhu (2017), "The Probability of Backtest
 * Overfitting", Journal of Computational Finance 20(4), 39-69.
 *
 * WHY THIS EXISTS
 * ---------------
 * Design invariant I5 requires OOS results, a Deflated Sharpe Ratio, a trial
 * registry entry AND a PBO before any claim of skill. The Q-079 audit found PBO
 * had **zero implementation** — the ten files matching `cscv|combinatorial|pbo`
 * were all prose — which is why I5 has been unmeetable BY CONSTRUCTION: no
 * strategy in this repo could ever have satisfied it, including the one shipped
 * result. This is the missing piece.
 *
 * WHAT IT MEASURES, AND WHY IT IS NOT THE SAME AS A DEFLATED SHARPE
 * ----------------------------------------------------------------
 * DSR asks "is this Sharpe large enough to survive the multiplicity of trials?".
 * PBO asks a different and harder question: **if I select the best-performing
 * configuration in-sample, how often does it land below median out-of-sample?**
 *
 * A strategy can post a respectable DSR and still have PBO near 0.5 — that is
 * the signature of a selection procedure that is fitting noise: the winner
 * in-sample carries no information about the winner out-of-sample. Under the
 * null of no skill, PBO -> 0.5.
 *
 * THE ALGORITHM
 * -------------
 * Given a performance matrix `M` of shape T x N (T observations, N candidate
 * configurations):
 *   1. Partition the T rows into S disjoint, contiguous, equal-size blocks.
 *      Contiguity matters: financial series are autocorrelated, and shuffling
 *      rows would leak information across the split.
 *   2. For each of the C(S, S/2) ways to choose half the blocks as in-sample,
 *      the complement is out-of-sample. This symmetry is the "CS" in CSCV: every
 *      block serves equally often on each side, so the estimate is unbiased with
 *      respect to which period happened to be "training".
 *   3. Pick n* = argmax(in-sample performance).
 *   4. Take the OOS rank of n* among all N configurations, mapped to
 *      omega in (0, 1), and its logit lambda = ln(omega / (1 - omega)).
 *   5. PBO = P(lambda <= 0), i.e. the share of splits where the in-sample
 *      winner finished at or below the OOS median.
 */

/** Sample mean. */
function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Sample standard deviation (n-1). */
function std(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1))
}

/**
 * Default performance statistic: the Sharpe ratio of the pooled observations.
 *
 * Not annualised, deliberately — CSCV only ever COMPARES configurations within
 * the same split, so any monotone rescaling leaves every rank untouched, and an
 * annualisation factor here would be decoration that invites misreading.
 */
export function sharpeOf(xs: readonly number[]): number {
  const s = std(xs)
  return s > 0 ? mean(xs) / s : 0
}

/** Every way to choose `k` of `n` indices, as index arrays. */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const walk = (start: number) => {
    if (cur.length === k) {
      out.push([...cur])
      return
    }
    // Prune: not enough remaining elements to reach length k.
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i)
      walk(i + 1)
      cur.pop()
    }
  }
  walk(0)
  return out
}

/**
 * Ascending rank of `idx` within `values`, as omega in (0, 1).
 *
 * Ties take the AVERAGE rank. Without that, N identical configurations — the
 * common case when a grid is insensitive to a parameter — would resolve by array
 * order, and the first column would look systematically better than the last.
 * The (N + 1) denominator keeps omega strictly inside (0, 1) so the logit is
 * always finite.
 */
export function relativeRank(values: readonly number[], idx: number): number {
  const v = values[idx]
  let below = 0
  let equal = 0
  for (const x of values) {
    if (x < v) below++
    else if (x === v) equal++
  }
  // Average rank among ties, 1-based.
  const rank = below + (equal + 1) / 2
  return rank / (values.length + 1)
}

export interface PboResult {
  /** Probability of backtest overfitting: P(logit <= 0). 0.5 = no skill in selection. */
  pbo: number
  /** One logit per CSCV split. */
  logits: number[]
  /** Number of splits evaluated, i.e. C(S, S/2). */
  splits: number
  /** Blocks the observations were partitioned into. */
  blocks: number
  /** Configurations compared. */
  configurations: number
  /** Observations actually used (T truncated to a multiple of `blocks`). */
  observations: number
}

export interface PboOptions {
  /** Number of contiguous blocks, must be even and >= 2. Default 8 -> 70 splits. */
  blocks?: number
  /** Performance statistic applied to a config's pooled observations. */
  performance?: (xs: readonly number[]) => number
}

/**
 * Compute PBO by CSCV.
 *
 * @param matrix Row-major T x N: `matrix[t][n]` is the period-`t` return of
 *               configuration `n`. Every row must have the same length.
 * @throws if the input cannot support a meaningful estimate. It fails closed
 *         rather than returning a number nobody can interpret — a PBO computed
 *         on 2 configurations or 1 block is not a weaker estimate, it is a
 *         meaningless one, and I5 exists to stop exactly that being published.
 */
/**
 * CSCV over a BLOCK-LEVEL performance matrix.
 *
 * Use this when performance is only measurable per period rather than per
 * observation — a backtest that needs a warm-up window cannot be evaluated on a
 * single bar, so its natural unit is the block, not the row.
 *
 * @param blockPerf S x N: `blockPerf[s][n]` is configuration `n`'s performance
 *                  on block `s`. Splits pool blocks by MEAN, which is the right
 *                  aggregation for equal-length blocks and keeps the statistic
 *                  rank-equivalent to pooling the underlying observations.
 */
export function pboFromBlockPerformance(blockPerf: readonly (readonly number[])[]): PboResult {
  const blocks = blockPerf.length
  if (!Number.isInteger(blocks) || blocks < 2 || blocks % 2 !== 0) {
    throw new Error(`[PBO] needs an even number of blocks >= 2; received ${blocks}`)
  }
  const nConfigs = blockPerf[0]?.length ?? 0
  if (nConfigs < 2) {
    throw new Error(
      `[PBO] needs at least 2 configurations to rank; received ${nConfigs}. ` +
        'PBO measures whether SELECTING among candidates overfits, so a single candidate has no PBO.',
    )
  }
  for (const row of blockPerf) {
    if (row.length !== nConfigs) throw new Error('[PBO] all rows must have the same length')
  }

  const half = blocks / 2
  const logits: number[] = []
  const meanOver = (idxs: readonly number[], n: number) =>
    idxs.reduce((a, b) => a + blockPerf[b][n], 0) / idxs.length

  for (const isBlocks of combinations(blocks, half)) {
    const oosBlocks = Array.from({ length: blocks }, (_, b) => b).filter((b) => !isBlocks.includes(b))
    const isPerf = Array.from({ length: nConfigs }, (_, n) => meanOver(isBlocks, n))
    const oosPerf = Array.from({ length: nConfigs }, (_, n) => meanOver(oosBlocks, n))

    let best = 0
    for (let n = 1; n < nConfigs; n++) if (isPerf[n] > isPerf[best]) best = n

    const omega = relativeRank(oosPerf, best)
    logits.push(Math.log(omega / (1 - omega)))
  }

  return {
    pbo: logits.filter((l) => l <= 0).length / logits.length,
    logits,
    splits: logits.length,
    blocks,
    configurations: nConfigs,
    observations: blocks,
  }
}

export function probabilityOfBacktestOverfitting(
  matrix: readonly (readonly number[])[],
  options: PboOptions = {},
): PboResult {
  const { blocks = 8, performance = sharpeOf } = options

  if (!Number.isInteger(blocks) || blocks < 2 || blocks % 2 !== 0) {
    throw new Error(`[PBO] blocks must be an even integer >= 2; received ${blocks}`)
  }
  if (matrix.length === 0) throw new Error('[PBO] matrix is empty')

  const nConfigs = matrix[0].length
  if (nConfigs < 2) {
    throw new Error(
      `[PBO] needs at least 2 configurations to rank; received ${nConfigs}. ` +
        'PBO measures whether SELECTING among candidates overfits, so a single candidate has no PBO.',
    )
  }
  for (const row of matrix) {
    if (row.length !== nConfigs) throw new Error('[PBO] all rows must have the same length')
  }

  // Truncate to a whole number of blocks; CSCV requires equal-size partitions.
  const blockSize = Math.floor(matrix.length / blocks)
  if (blockSize < 2) {
    throw new Error(
      `[PBO] ${matrix.length} observations cannot fill ${blocks} blocks of >= 2 rows. ` +
        'Use fewer blocks or a longer sample.',
    )
  }
  const used = blockSize * blocks

  const blockRows: number[][] = []
  for (let b = 0; b < blocks; b++) blockRows.push([b * blockSize, (b + 1) * blockSize])

  const half = blocks / 2
  const logits: number[] = []

  for (const isBlocks of combinations(blocks, half)) {
    const inSample = new Set(isBlocks)

    const isPerf: number[] = []
    const oosPerf: number[] = []
    for (let n = 0; n < nConfigs; n++) {
      const isVals: number[] = []
      const oosVals: number[] = []
      for (let b = 0; b < blocks; b++) {
        const [lo, hi] = blockRows[b]
        const target = inSample.has(b) ? isVals : oosVals
        for (let t = lo; t < hi; t++) target.push(matrix[t][n])
      }
      isPerf.push(performance(isVals))
      oosPerf.push(performance(oosVals))
    }

    // n* = the configuration a researcher would have SELECTED in-sample.
    let best = 0
    for (let n = 1; n < nConfigs; n++) if (isPerf[n] > isPerf[best]) best = n

    const omega = relativeRank(oosPerf, best)
    logits.push(Math.log(omega / (1 - omega)))
  }

  const pbo = logits.filter((l) => l <= 0).length / logits.length
  return {
    pbo,
    logits,
    splits: logits.length,
    blocks,
    configurations: nConfigs,
    observations: used,
  }
}
