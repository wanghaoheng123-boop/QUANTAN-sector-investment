/**
 * Factor attribution — NOT AVAILABLE, and it says so.
 *
 * This page previously fabricated its entire input:
 *
 *     const assetReturns = Array.from({ length: 60 }, (_, i) => 0.001 + Math.sin(i / 10) * 0.002)
 *     const factors = { MKT: assetReturns.map((r) => r * 0.8), ... }
 *
 * Every factor was a scalar multiple of the same invented series, so the
 * regression was degenerate by construction — and it rendered an intercept and
 * five loadings on a LIVE route as though they described something. I3 forbids
 * synthetic data reaching a render; the guard missed it because its
 * `inline-fabrication` rule keys on `Math.random()` (Q-104).
 *
 * The regression itself (`lib/portfolio/factorAttribution.ts`) is real code and
 * is kept. What is missing is a measured input: this platform holds no factor
 * return series (MKT/SMB/HML/MOM/QMJ), and none can be derived from the price
 * data it does hold. So the page reports that it cannot compute, which per the
 * PRIME DIRECTIVE is the product working — a tool that says "I don't know"
 * correctly is worth more than one that renders a confident number from nothing.
 */
export default function FactorAttributionPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">Factor attribution</h1>

      <p className="text-sm text-amber-200/90 border border-amber-500/40 rounded-lg p-3">
        <strong>Not available.</strong> Factor attribution needs a measured factor
        return series, and this platform does not hold one. Rather than show a
        number derived from invented inputs, this page reports that it cannot
        compute.
      </p>

      <div className="text-sm text-slate-300 space-y-2">
        <p className="font-medium text-slate-200">What would make this page work</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-400">
          <li>A daily return series for the five factors (MKT, SMB, HML, MOM, QMJ), from a licensed source.</li>
          <li>A portfolio return series aligned to the same dates.</li>
          <li>A recorded licence finding for that source, per design invariant I8.</li>
        </ul>
        <p className="text-slate-400">
          The regression is implemented and unit-tested in
          <code className="mx-1 px-1 rounded bg-slate-800/70 text-slate-300">lib/portfolio/factorAttribution.ts</code>
          — only the measured input is missing.
        </p>
      </div>
    </main>
  )
}
