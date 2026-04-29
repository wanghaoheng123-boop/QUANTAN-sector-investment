/**
 * Simple 2-stage DCF (FCF → explicit growth → Gordon terminal).
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
  /** Net debt (total debt minus cash). Defaults to 0 if not provided. */
  netDebt?: number
}

export interface DcfResult {
  enterpriseValue: number
  equityValue: number
  valuePerShare: number
  pvExplicit: number
  pvTerminal: number
  terminalValueRaw: number
}

export function runDcf(input: DcfInputs): DcfResult | null {
  const { fcf0, shares, wacc, terminalGrowth, explicitGrowth, netDebt } = input
  const n = input.explicitYears ?? 5
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
  const netDebtValue = Number.isFinite(netDebt ?? 0) ? (netDebt ?? 0) : 0
  const equityValue = enterpriseValue - netDebtValue
  const valuePerShare = equityValue / shares

  if (!Number.isFinite(valuePerShare) || valuePerShare <= 0) return null

  return {
    enterpriseValue,
    equityValue,
    valuePerShare,
    pvExplicit,
    pvTerminal,
    terminalValueRaw,
  }
}
