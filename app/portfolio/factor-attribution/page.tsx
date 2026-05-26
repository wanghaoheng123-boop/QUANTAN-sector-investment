import { regressFactorLoadings } from '@/lib/portfolio/factorAttribution'

export default function FactorAttributionPage() {
  const assetReturns = Array.from({ length: 60 }, (_, i) => 0.001 + Math.sin(i / 10) * 0.002)
  const factors = {
    MKT: assetReturns.map((r) => r * 0.8),
    SMB: assetReturns.map((r) => r * 0.1),
    HML: assetReturns.map((r) => r * 0.05),
    MOM: assetReturns.map((r) => r * 0.15),
    QMJ: assetReturns.map((r) => r * 0.08),
  }
  const attr = regressFactorLoadings(assetReturns, factors)

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Factor attribution</h1>
      <p className="text-sm text-amber-200/80 border border-amber-500/30 rounded-lg p-3">{attr.disclaimer}</p>
      <p className="text-sm text-slate-400">5-factor loadings (demo series). Monthly report export in Phase 16.</p>
      <ul className="text-sm text-slate-200 space-y-1">
        {Object.entries(attr.loadings).map(([k, v]) => (
          <li key={k}>
            {k}: {v.toFixed(3)}
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Alpha (daily): {attr.alpha.toFixed(5)} · R²: {attr.rSquared != null ? attr.rSquared.toFixed(2) : 'N/A (multivariate OLS deferred)'}
      </p>
    </main>
  )
}
