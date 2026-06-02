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
}

const FACTOR_NAMES = ['MKT', 'SMB', 'HML', 'MOM', 'QMJ'] as const

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
  if (n < FACTOR_NAMES.length + 5) {
    return { ticker: '', loadings, alpha: 0, rSquared: null, methodology: 'multivariate_ols', disclaimer }
  }

  const y = assetReturns.slice(-n)
  const X: number[][] = []
  for (let i = 0; i < n; i++) {
    X.push([1, ...FACTOR_NAMES.map(name => factors[name][factors[name].length - n + i])])
  }

  const beta = olsMultivariate(y, X)
  if (!beta) {
    return { ticker: '', loadings, alpha: 0, rSquared: null, methodology: 'multivariate_ols', disclaimer }
  }

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

  return { ticker: '', loadings, alpha, rSquared, methodology: 'multivariate_ols', disclaimer }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Normal-equations solve for multivariate OLS; drops zero-variance factor columns. */
function olsMultivariate(y: number[], X: number[][]): number[] | null {
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
  return beta
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
