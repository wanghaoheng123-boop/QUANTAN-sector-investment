/**
 * Factor exposure attribution — multivariate OLS (Fama-French / Carhart style).
 *
 * Joint regression of asset excess returns on [MKT, SMB, HML, MOM, QMJ] with
 * intercept (alpha). R² is computed from SS_res / SS_tot on the fitted model.
 */

export interface FactorReturns {
  MKT: number[]
  SMB: number[]
  HML: number[]
  MOM: number[]
  QMJ: number[]
}

export type FactorAttributionMethodology = 'multivariate_ols'

export interface FactorAttribution {
  ticker: string
  loadings: Record<keyof FactorReturns, number>
  alpha: number
  rSquared: number | null
  methodology: FactorAttributionMethodology
  disclaimer: string
  /**
   * Diagnostics (additive — existing callers ignore them). All optional so the
   * type stays backward-compatible with consumers that only read loadings/alpha.
   *
   * - standardErrors / tStats: per-coefficient (keyed 'alpha' + factor names).
   *   A coefficient that was dropped as a zero-variance column (no information
   *   in-sample) reports `null` rather than a fabricated 0 — its SE is undefined.
   * - adjustedRSquared: R² penalised for the number of fitted parameters q
   *   (active columns incl. intercept): 1 − (1−R²)(n−1)/(n−q).
   * - conditionNumber: PROXY = max/min of the diagonal of XᵀX on active columns.
   *   A true condition number needs the spectral norm of (XᵀX)⁻¹; this cheap
   *   diagonal-ratio proxy still flags gross scaling imbalance / collinearity.
   * - nObs / dof: sample size and residual degrees of freedom (n − q) actually used.
   */
  standardErrors?: Record<'alpha' | keyof FactorReturns, number | null>
  tStats?: Record<'alpha' | keyof FactorReturns, number | null>
  adjustedRSquared?: number | null
  conditionNumber?: number | null
  nObs?: number
  dof?: number
}

const FACTOR_NAMES = ['MKT', 'SMB', 'HML', 'MOM', 'QMJ'] as const

/**
 * Minimum observations to fit the 6-parameter model (intercept + 5 factors).
 *
 * Previously `FACTOR_NAMES.length + 5` = 10, which leaves only n−p = 4 residual
 * degrees of freedom for a 6-parameter regression — t-stats on 4 dof are far
 * too wide to be meaningful and σ̂²=RSS/(n−p) is a near-singular estimate.
 * 60 monthly observations (~5y) gives n−p = 54 dof, the conventional floor for
 * Fama-French/Carhart factor regressions (Bali, Engle & Murray 2016, ch.5;
 * standard 60-month rolling-β window). Below this the estimate is suppressed.
 */
const MIN_OBSERVATIONS = 60

export function regressFactorLoadings(
  assetReturns: number[],
  factors: FactorReturns,
): FactorAttribution {
  const n = Math.min(
    assetReturns.length,
    ...FACTOR_NAMES.map(name => factors[name].length),
  )
  const loadings = { MKT: 0, SMB: 0, HML: 0, MOM: 0, QMJ: 0 }
  const disclaimer =
    'Multivariate OLS factor attribution (5-factor + intercept). For research dashboards — not audited for regulatory reporting.'
  if (n < MIN_OBSERVATIONS) {
    return { ticker: '', loadings, alpha: 0, rSquared: null, methodology: 'multivariate_ols', disclaimer }
  }

  const y = assetReturns.slice(-n)
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    X.push([1, ...FACTOR_NAMES.map(name => factors[name][factors[name].length - n + i])])
  }

  const fit = olsMultivariate(y, X)
  if (!fit) {
    return { ticker: '', loadings, alpha: 0, rSquared: null, methodology: 'multivariate_ols', disclaimer }
  }
  const { beta, activeCols, xtxInverse } = fit

  loadings.MKT = beta[1]
  loadings.SMB = beta[2]
  loadings.HML = beta[3]
  loadings.MOM = beta[4]
  loadings.QMJ = beta[5]
  const alpha = beta[0]

  const yMean = mean(y)
  let ssTot = 0
  let ssRes = 0
  for (let i = 0; i < n; i++) {
    const fitted = X[i].reduce((s, xj, j) => s + xj * beta[j], 0)
    ssTot += (y[i] - yMean) ** 2
    ssRes += (y[i] - fitted) ** 2
  }
  const rSquared = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : null

  // ── Inference: σ̂² = RSS/(n−q), Var(β̂) = σ̂²·diag((XᵀX)⁻¹) ──────────────────
  // q = number of fitted (active) parameters — NOT the nominal 6. Dropped
  // zero-variance columns are not estimated and don't consume a degree of
  // freedom. (Greene 2012, Econometric Analysis §4.6; Bali et al. 2016 §5.)
  const q = activeCols.length
  const dof = n - q
  const COEF_KEYS = ['alpha', ...FACTOR_NAMES] as const
  const standardErrors: Record<'alpha' | keyof FactorReturns, number | null> = {
    alpha: null, MKT: null, SMB: null, HML: null, MOM: null, QMJ: null,
  }
  const tStats: Record<'alpha' | keyof FactorReturns, number | null> = {
    alpha: null, MKT: null, SMB: null, HML: null, MOM: null, QMJ: null,
  }
  if (dof > 0 && xtxInverse) {
    const sigma2 = ssRes / dof
    // Map each active column position back to its coefficient slot, reading the
    // matching diagonal of (XᵀX)⁻¹ (built on the active sub-matrix).
    for (let a = 0; a < q; a++) {
      const colIdx = activeCols[a]          // 0 = intercept, 1..5 = factor j
      const varBeta = sigma2 * xtxInverse[a][a]
      const se = varBeta > 0 ? Math.sqrt(varBeta) : null
      const key = COEF_KEYS[colIdx]
      standardErrors[key] = se
      tStats[key] = se != null && se > 0 ? beta[colIdx] / se : null
    }
  }

  const adjustedRSquared = rSquared != null && dof > 0
    ? 1 - (1 - rSquared) * (n - 1) / dof
    : null

  // Diagonal-ratio condition-number proxy on the active XᵀX (rebuild diagonal).
  let condDiagMax = 0
  let condDiagMin = Number.POSITIVE_INFINITY
  for (let a = 0; a < q; a++) {
    const colIdx = activeCols[a]
    let d = 0
    for (let i = 0; i < n; i++) d += X[i][colIdx] * X[i][colIdx]
    if (d > condDiagMax) condDiagMax = d
    if (d < condDiagMin) condDiagMin = d
  }
  const conditionNumber = condDiagMin > 0 && Number.isFinite(condDiagMin)
    ? condDiagMax / condDiagMin
    : null

  return {
    ticker: '', loadings, alpha, rSquared, methodology: 'multivariate_ols', disclaimer,
    standardErrors, tStats, adjustedRSquared, conditionNumber, nObs: n, dof,
  }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

interface OlsFit {
  /** Full-length coefficient vector (p slots; dropped columns are 0). */
  beta: number[]
  /** Column indices actually estimated (0 = intercept). */
  activeCols: number[]
  /** (XᵀX)⁻¹ on the active sub-matrix, q×q — for standard errors. null if singular. */
  xtxInverse: number[][] | null
}

/** Normal-equations solve for multivariate OLS; drops zero-variance factor columns. */
function olsMultivariate(y: number[], X: number[][]): OlsFit | null {
  const n = y.length
  const p = X[0]?.length ?? 0
  if (n < p || p === 0) return null

  const activeCols = [0]
  for (let j = 1; j < p; j++) {
    const col = X.map(row => row[j])
    const m = mean(col)
    const v = col.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1)
    if (v > 1e-14) activeCols.push(j)
  }

  const q = activeCols.length
  const xtx: number[][] = Array.from({ length: q }, () => Array(q).fill(0))
  const xty: number[] = Array(q).fill(0)

  for (let i = 0; i < n; i++) {
    for (let aj = 0; aj < q; aj++) {
      const xj = X[i][activeCols[aj]]
      xty[aj] += xj * y[i]
      for (let ak = 0; ak < q; ak++) {
        xtx[aj][ak] += xj * X[i][activeCols[ak]]
      }
    }
  }

  const reduced = solveLinearSystem(xtx, xty)
  if (!reduced) return null

  const beta = Array(p).fill(0)
  for (let j = 0; j < q; j++) beta[activeCols[j]] = reduced[j]

  // (XᵀX)⁻¹ for the variance-covariance matrix of β̂. Computed from the SAME
  // active sub-matrix so SE diagonals line up with the fitted coefficients.
  const xtxInverse = invertMatrix(xtx)

  return { beta, activeCols, xtxInverse }
}

/**
 * Invert a small square matrix by solving A·xᵢ = eᵢ for each identity column eᵢ
 * (reuses the existing partial-pivot Gaussian elimination). Returns null if A is
 * singular (any column solve fails). Used only for the q×q XᵀX (q ≤ 6).
 */
function invertMatrix(A: number[][]): number[][] | null {
  const m = A.length
  if (m === 0) return null
  // inv[j] holds the j-th COLUMN of A⁻¹; we transpose to row-major at the end.
  const cols: number[][] = []
  for (let j = 0; j < m; j++) {
    const e = Array(m).fill(0)
    e[j] = 1
    const col = solveLinearSystem(A, e)
    if (!col) return null
    cols.push(col)
  }
  const inv: number[][] = Array.from({ length: m }, () => Array(m).fill(0))
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      inv[r][c] = cols[c][r]
    }
  }
  return inv
}

/** Gaussian elimination with partial pivoting */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map(row => [...row])
  const v = [...b]

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    ;[v[col], v[pivot]] = [v[pivot], v[col]]

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col]
      for (let k = col; k < n; k++) M[row][k] -= factor * M[col][k]
      v[row] -= factor * v[col]
    }
  }

  const x = Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = v[row]
    for (let k = row + 1; k < n; k++) sum -= M[row][k] * x[k]
    x[row] = sum / M[row][row]
  }
  return x
}
