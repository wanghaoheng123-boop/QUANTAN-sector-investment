/**
 * Trial-registry reader — the multiplicity denominator for the Deflated Sharpe
 * Ratio (design invariant I5).
 *
 * I5 requires an entry in `.quantlab/TRIAL_REGISTRY.jsonl` recording how many
 * configurations were tried, and requires the DEFLATED number as the headline.
 * Until Q-081 the registry had no reader: `scripts/benchmark-signals.ts` called
 * `deflatedSharpe(returns, 10)` and `(returns, 100)` with hardcoded guesses, so
 * the published correction was deflated against a number nobody had counted.
 *
 * WHY THIS RETURNS A BAND AND NOT A NUMBER
 * ----------------------------------------
 * `T-0001` records `declared_grid: 1024` against
 * `reported_total_combinations_per_instrument: 16` and marks itself
 * `uncertain: true`; its own note says multiplicity corrections built on either
 * number are provisional until the discrepancy is reconciled (`Q-084`).
 * Collapsing that to a single invented `nTrials` would be exactly the guess this
 * reader exists to remove, so it reports the interval the evidence supports and
 * lets the caller deflate against BOTH ends.
 *
 * Both ends are LOWER BOUNDS on the true trial count: the registry was
 * backfilled from nine recorded experiments, and configurations tried and then
 * discarded without a written record are, by construction, absent.
 *
 * Reference: Bailey & López de Prado (2014), "The Deflated Sharpe Ratio:
 * Correcting for Selection Bias, Backtest Overfitting and Non-Normality",
 * Journal of Portfolio Management 40(5). `nTrials` is N in their eq. 4.
 */

/** A configurations-tried record. Both fields are optional in the corpus. */
export interface ConfigsTried {
  declared_grid?: number
  reported_total_combinations_per_instrument?: number
  uncertain?: boolean
}

export interface TrialRow {
  trial_id: string
  configs_tried?: ConfigsTried
  verdict?: string
}

export interface TrialCount {
  /** Conservative end: the reported count where one exists, else the declared. */
  lower: number
  /** Permissive end: the declared grid where one exists, else the lower. */
  upper: number
  /** Rows parsed. Zero means the registry is missing or empty — fail, do not guess. */
  rows: number
  /** Trial ids whose configs_tried is flagged `uncertain`. */
  uncertain: string[]
}

/**
 * A trial with no recorded configuration count still consumed one degree of
 * freedom: it was run, looked at, and kept or discarded. Counting it as zero
 * would understate multiplicity, so it counts as one.
 */
const MIN_CONFIGS_PER_TRIAL = 1

/** Parse JSONL text into rows, ignoring blank lines. Throws on malformed JSON. */
export function parseRegistry(text: string): TrialRow[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => {
      let row: unknown
      try {
        row = JSON.parse(l)
      } catch {
        throw new Error(`[I5] TRIAL_REGISTRY.jsonl line ${i + 1} is not valid JSON`)
      }
      if (typeof row !== 'object' || row === null || typeof (row as TrialRow).trial_id !== 'string') {
        throw new Error(`[I5] TRIAL_REGISTRY.jsonl line ${i + 1} has no trial_id`)
      }
      return row as TrialRow
    })
}

/** Sum the registry into the interval of defensible `nTrials` values. */
export function countTrials(rows: readonly TrialRow[]): TrialCount {
  let lower = 0
  let upper = 0
  const uncertain: string[] = []
  for (const r of rows) {
    const c = r.configs_tried ?? {}
    const declared = typeof c.declared_grid === 'number' ? c.declared_grid : undefined
    const reported =
      typeof c.reported_total_combinations_per_instrument === 'number'
        ? c.reported_total_combinations_per_instrument
        : undefined
    const lo = reported ?? declared ?? MIN_CONFIGS_PER_TRIAL
    const hi = declared ?? lo
    lower += lo
    upper += Math.max(hi, lo)
    if (c.uncertain === true) uncertain.push(r.trial_id)
  }
  return { lower, upper, rows: rows.length, uncertain }
}

export function readTrialCount(text: string): TrialCount {
  return countTrials(parseRegistry(text))
}
