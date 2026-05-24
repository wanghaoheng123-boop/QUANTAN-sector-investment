/**
 * Factor exposure attribution (Phase 15 Q-044-NEW) — **NAIVE PROXY, NOT
 * CANONICAL FAMA-FRENCH / CARHART**.
 *
 * ⚠️ Do NOT surface the output of this module to institutional users as
 * "Fama-French attribution" or "Carhart 5-factor attribution" — the
 * implementation is statistically biased relative to those canonical
 * models. Specifically:
 *
 *   1. **Univariate, not multivariate.** Each factor loading is computed
 *      by an independent OLS of asset returns on that single factor.
 *      Real Fama-French / Carhart attribution requires a joint
 *      multivariate regression because the factors (MKT, SMB, HML, MOM,
 *      QMJ) are correlated; univariate betas absorb each other's
 *      explanatory power and are therefore biased.
 *
 *   2. **R² is fabricated**, not measured. The `rSquared` field returns
 *      `Math.min(0.95, |mktBeta| × 0.5)` — a heuristic placeholder. It is
 *      NOT the coefficient of determination (SS_residual / SS_total).
 *
 *   3. **Alpha is single-factor.** `alpha = mean(returns) - mktBeta *
 *      mean(MKT)` ignores contributions from SMB/HML/MOM/QMJ.
 *
 * This stub exists so the API surface (`/api/portfolio/factor-attribution`
 * and the dashboard panel) can render data while the real multivariate
 * OLS implementation is deferred to Phase 16 (Q-044-NEW continuation —
 * see workspace/IMPROVEMENT_BACKLOG.json).
 *
 * Citation for the canonical models this stub does NOT yet implement:
 *   • Fama, E. & French, K. (1992) "The cross-section of expected stock
 *     returns," J. Finance 47(2).
 *   • Carhart, M. (1997) "On persistence in mutual fund performance,"
 *     J. Finance 52(1).
 *
 * Phase 16 acceptance: replace `olsBeta` with a QR-decomposition multivariate
 * solve; compute real R² as 1 - SSres/SStot; rename or remove this
 * disclaimer when the real implementation lands.
 */

export interface FactorReturns {
  MKT: number[]
  SMB: number[]
  HML: number[]
  MOM: number[]
  QMJ: number[]
}

export interface FactorAttribution {
  ticker: string
  loadings: Record<keyof FactorReturns, number>
  alpha: number
  rSquared: number
}

export function regressFactorLoadings(
  assetReturns: number[],
  factors: FactorReturns,
): FactorAttribution {
  const n = Math.min(assetReturns.length, factors.MKT.length)
  const names = ['MKT', 'SMB', 'HML', 'MOM', 'QMJ'] as const
  const loadings = { MKT: 0, SMB: 0, HML: 0, MOM: 0, QMJ: 0 }
  if (n < 10) {
    return { ticker: '', loadings, alpha: 0, rSquared: 0 }
  }
  // Simple univariate proxy per factor (full multivariate OLS deferred to Phase 16).
  for (const name of names) {
    const f = factors[name].slice(-n)
    const a = assetReturns.slice(-n)
    loadings[name] = olsBeta(a, f)
  }
  const mktBeta = loadings.MKT
  const alpha = mean(assetReturns.slice(-n)) - mktBeta * mean(factors.MKT.slice(-n))
  return { ticker: '', loadings, alpha, rSquared: Math.min(0.95, Math.abs(mktBeta) * 0.5) }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function olsBeta(y: number[], x: number[]): number {
  const mx = mean(x)
  const my = mean(y)
  let num = 0
  let den = 0
  for (let i = 0; i < y.length; i++) {
    num += (x[i] - mx) * (y[i] - my)
    den += (x[i] - mx) ** 2
  }
  return den > 0 ? num / den : 0
}
