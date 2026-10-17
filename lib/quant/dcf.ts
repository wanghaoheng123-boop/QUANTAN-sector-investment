/**
 * Simple 2-stage DCF (cash flow → explicit growth → Gordon terminal).
 *
 * MODEL-NEUTRAL: the caller decides what the cash flow and the rate are, and
 * the two must match (Damodaran, A. (2012). *Investment Valuation*, 3rd ed.,
 * Wiley):
 *   - FCFF discounted at WACC gives FIRM value (ch. 15); equity = firm value
 *     − net debt, so an FCFF caller passes `netDebt`.
 *   - FCFE discounted at the cost of equity gives EQUITY value directly
 *     (ch. 14); an FCFE caller passes NO `netDebt`, or the debt is counted
 *     twice.
 * The only production caller, `buildFundamentalsPayload`, is FCFE (Q-086,
 * 2026-10-17) and passes none. `enterpriseValue` in the result is the value of
 * the discounted stream — firm value under FCFF, equity value under FCFE; the
 * name predates Q-086 and is kept because it is serialised to the client.
 *
 * All outputs are illustrative; garbage-in/garbage-out applies to any DCF.
 */

export interface DcfInputs {
  fcf0: number
  shares: number
  wacc: number
  terminalGrowth: number
  /** Year 1–5 growth rate (constant for simplicity). */
  explicitGrowth: number
  explicitYears?: number
  /**
   * FCFF CALLERS ONLY. Net debt = debt − cash & equivalents, subtracted from
   * firm value to give equity. An FCFE caller must leave it unset: its cash
   * flow is already after debt, and subtracting net debt counts it twice.
   */
  netDebt?: number
}

export interface DcfResult {
  /** Value of the discounted stream: firm value (FCFF) or equity value (FCFE). */
  enterpriseValue: number
  equityValue: number
  /** Equity value per share = (EV − netDebt) / shares. */
  valuePerShare: number
  pvExplicit: number
  pvTerminal: number
  terminalValueRaw: number
  /** The netDebt used (echoed back for transparency / audit). */
  netDebtUsed: number
}

export function runDcf(input: DcfInputs): DcfResult | null {
  const { fcf0, shares, wacc, terminalGrowth, explicitGrowth } = input
  const n = input.explicitYears ?? 5
  const netDebt = Number.isFinite(input.netDebt) ? (input.netDebt as number) : 0
  if (!Number.isFinite(fcf0) || !Number.isFinite(shares) || shares <= 0) return null
  if (wacc <= terminalGrowth || wacc <= 0 || wacc >= 0.5) return null
  if (terminalGrowth < -0.02 || terminalGrowth > 0.06) return null
  if (!Number.isFinite(explicitGrowth) || explicitGrowth < -0.3 || explicitGrowth > 0.45) return null

  let pvExplicit = 0
  let fcf = fcf0
  for (let t = 1; t <= n; t++) {
    fcf *= 1 + explicitGrowth
    pvExplicit += fcf / Math.pow(1 + wacc, t)
  }

  const fcfTerminalStart = fcf * (1 + terminalGrowth)
  const terminalValueRaw = fcfTerminalStart / (wacc - terminalGrowth)
  const pvTerminal = terminalValueRaw / Math.pow(1 + wacc, n)

  const enterpriseValue = pvExplicit + pvTerminal
  // FCFF → equity bridge (zero for an FCFE caller): subtract net debt.
  // Net-cash companies have negative netDebt and equity exceeds firm value.
  const equityValue = enterpriseValue - netDebt
  // Q1-C-4 (Phase 14 S1): explicit insolvency rejection.
  // EV < netDebt means the company's debt exceeds its asset value — no equity to value.
  // Citation: Damodaran, A. (2012). Investment Valuation (3rd ed.), Wiley, ch.2 — insolvency.
  if (equityValue <= 0) return null
  const valuePerShare = equityValue / shares

  if (!Number.isFinite(valuePerShare) || valuePerShare <= 0) return null

  return {
    enterpriseValue,
    equityValue,
    valuePerShare,
    pvExplicit,
    pvTerminal,
    terminalValueRaw,
    netDebtUsed: netDebt,
  }
}
