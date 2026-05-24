/**
 * Scenario stress engine (Phase 15 Q-043-NEW) — **LINEAR DELTA-ONLY STRESS;
 * NOT A FULL TAYLOR-EXPANSION P&L**.
 *
 * ⚠️ Limitations to disclose before relying on `portfolioPnl`:
 *
 *   1. **`portfolioPnl` is delta × dS only.** The conventional stress P&L for
 *      an options portfolio is the second-order Taylor expansion:
 *          pnl_i = Δ_i × dS
 *                + 0.5 × Γ_i × dS²
 *                + ν_i × dVol
 *                + θ_i × dT
 *                + ρ_i × dR
 *      The current implementation only sums the first term. For long-equity
 *      portfolios this is a reasonable first-cut; for short-gamma /
 *      long-vega options books it materially under- or over-states P&L.
 *
 *   2. **Returned `.greeks` field mixes pre- and post-shock quantities.**
 *          g.delta += (delta ?? shares) × (1 + shock.spotPct)
 *          g.gamma += (gamma ?? 0) × shock.spotPct ** 2
 *      Neither is a clean Greek (no Γ-from-Δ adjustment) nor a clean P&L
 *      contribution (no 0.5 prefactor on gamma). Treat these numbers as
 *      directional indicators, not as portfolio Greeks.
 *
 *   3. **Vega units assume per-1.0 IV change**, not per-1% (1 vol-point).
 *      Caller must pre-scale `shock.volPct` appropriately.
 *
 * The canned scenarios (Fed +100bps, S&P -10%, etc.) and the dashboard
 * panel use this engine as a smoke-test for the API contract. Phase 16
 * acceptance: replace the loop body with the full Taylor expansion and
 * separate the "portfolio Greeks" output (Σ position Greeks, unmodified)
 * from the "scenario P&L" output (Taylor sum).
 *
 * Citation: Jorion, P. (2006) "Value at Risk," 3rd ed., ch. 7 (stress
 * testing); Hull, J. (2017) "Options, Futures and Other Derivatives,"
 * §17.3 (Taylor-series approximation of position value).
 */

export interface ScenarioShock {
  id: string
  label: string
  spotPct: number
  volPct: number
  rateBps: number
}

export const CANNED_SCENARIOS: ScenarioShock[] = [
  { id: 'fed-100', label: 'Fed +100bps', spotPct: -0.03, volPct: 0.15, rateBps: 100 },
  { id: 'sp-minus-10', label: 'S&P -10%', spotPct: -0.10, volPct: 0.25, rateBps: 0 },
  { id: 'vix-plus-50', label: 'VIX +50%', spotPct: -0.05, volPct: 0.50, rateBps: 0 },
  { id: 'gfc-2008', label: '2008-style', spotPct: -0.35, volPct: 0.80, rateBps: -200 },
  { id: 'covid-2020', label: 'COVID crash', spotPct: -0.30, volPct: 1.0, rateBps: -150 },
  { id: 'flash-crash', label: 'Flash crash', spotPct: -0.08, volPct: 0.60, rateBps: 0 },
]

export interface PositionStub {
  ticker: string
  shares: number
  price: number
  delta?: number
  gamma?: number
  vega?: number
  theta?: number
  rho?: number
}

export interface ScenarioResult {
  scenarioId: string
  label: string
  portfolioPnl: number
  portfolioPnlPct: number
  greeks: { delta: number; gamma: number; vega: number; theta: number; rho: number }
}

export function runScenario(positions: PositionStub[], shock: ScenarioShock): ScenarioResult {
  let pnl = 0
  let nav = 0
  const g = { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 }
  for (const p of positions) {
    const mv = p.shares * p.price
    nav += mv
    const dS = p.price * shock.spotPct
    pnl += p.shares * dS
    g.delta += (p.delta ?? p.shares) * (1 + shock.spotPct)
    g.gamma += (p.gamma ?? 0) * shock.spotPct ** 2
    g.vega += (p.vega ?? 0) * shock.volPct
    g.theta += p.theta ?? 0
    g.rho += (p.rho ?? 0) * (shock.rateBps / 10000)
  }
  return {
    scenarioId: shock.id,
    label: shock.label,
    portfolioPnl: pnl,
    portfolioPnlPct: nav > 0 ? pnl / nav : 0,
    greeks: g,
  }
}

export function runAllScenarios(positions: PositionStub[]): ScenarioResult[] {
  return CANNED_SCENARIOS.map((s) => runScenario(positions, s))
}
