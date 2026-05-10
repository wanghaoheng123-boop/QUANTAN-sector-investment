/**
 * Simple 2-stage DCF (FCF → explicit growth → Gordon terminal).
 *
 * This is an FCFF (free cash flow to firm) model: future cash flows are
 * discounted at WACC, producing enterprise value. To convert EV to
 * equity value we MUST subtract net debt (= long-term debt − cash &
 * short-term investments). Previously the code set
 *   equityValue = enterpriseValue
 * which is correct ONLY for net-cash companies. For levered companies
 * (utilities, REITs, financials) this overstated equity by 10–200% of
 * the true value. The fix takes an optional `netDebt` parameter, which
 * defaults to 0 for backwards compatibility but should be supplied by
 * any caller that has the balance-sheet data available.
 *
 * All outputs are illustrative; garbage-in/garbage-out applies to any DCF.
 *
 * Citation: Damodaran, A. (2012). *Investment Valuation* (3rd ed.),
 *           Wiley, ch. 12 — FCFF discounted at WACC yields firm value;
 *           equity = firm value − net debt + non-operating cash.
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
   * Net debt = long-term debt + short-term debt − cash & equivalents.
   * Subtracted from EV to derive equity. Defaults to 0 (assumes
   * debt-free / net-cash company) — provide it whenever balance-sheet
   * data is available; otherwise the equity value is silently inflated.
   */
  netDebt?: number
}

export interface DcfResult {
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
  // FCFF → equity bridge: subtract net debt. Net-cash companies have
  // negative netDebt and equity exceeds EV (correct).
  const equityValue = enterpriseValue - netDebt
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
