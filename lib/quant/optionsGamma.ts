/**
 * Options Gamma, Vanna, and Charm Calculation Engine
 *
 * Based on institutional-grade options analysis methodology:
 * - Gamma Exposure (GEX): Net gamma positioning at each strike
 * - Call/Put Walls: Strikes with concentrated OI that create hedging demand
 * - Max Pain: Strike minimizing total option holder losses at expiry
 * - Vanna: dDelta/dVol — how delta responds to vol changes
 * - Charm: dDelta/dTime — time decay of delta
 *
 * Data source: Yahoo Finance options chain
 * Verification: Each computed field is annotated with source confidence
 */

import { createVerification, DataVerification } from '@/lib/research/dataVerification'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RawOptionContract {
  strike: number
  expiry: string        // ISO date string
  type: 'call' | 'put'
  bid: number
  ask: number
  last: number
  volume: number        // today's volume
  oi: number            // open interest
  impliedVol: number     // IV for this strike
  delta: number         // -1 to 1
  gamma: number         // 0 to ~1
  theta: number         // negative daily
  vega: number          // per 1% vol move
  inTheMoney: boolean
}

export interface OptionExpiry {
  date: string          // ISO date string
  calls: RawOptionContract[]
  puts: RawOptionContract[]
  daysToExpiry: number
}

export interface GammaStrikeLevel {
  strike: number
  callGamma: number     // total gamma exposure from calls at this strike
  putGamma: number      // total gamma exposure from puts at this strike
  netGamma: number      // callGamma - putGamma
  callOi: number        // open interest (contracts)
  putOi: number
  callVolume: number
  putVolume: number
}

export interface GammaAnalysis {
  ticker: string
  spotPrice: number
  quoteTime: string
  expiryChain: OptionExpiry[]
  // Aggregated greeks at spot
  totalCallDelta: number
  totalPutDelta: number
  netDelta: number         // dealer net delta exposure
  totalVega: number
  totalTheta: number       // daily theta burn (negative)
  // GEX metrics
  totalGammaExposure: number   // GEX = Sum(|netGamma|) where netGamma = callGamma * callOi - putGamma * putOi per strike
  gammaFlipStrike: number      // strike where net gamma crosses zero
  zeroGammaLower: number       // lower bound of zero-gamma zone
  zeroGammaUpper: number       // upper bound of zero-gamma zone
  // Max Pain
  maxPainStrike: number
  // Walls
  callWallStrike: number       // strike above spot with significant call OI concentration
  putWallStrike: number        // strike below spot with significant put OI concentration
  callWallStrength: number     // 0-100 confidence
  putWallStrength: number      // 0-100 confidence
  // OI concentrations
  highestCallOiStrike: number
  highestPutOiStrike: number
  // Put/Call ratio
  putCallRatio: number         // total put OI / total call OI
  putCallVolumeRatio: number   // total put volume / total call volume
  // Vanna & Charm
  vannaExposure: number        // dDelta/dVol — measured as correlation of delta vs IV
  charmExposure: number        // dDelta/dTime — avg theta-weighted delta decay rate
  // Per-strike gamma ladder
  gammaLadder: GammaStrikeLevel[]
  // Verification
  dataVerification: DataVerification
}

// ─── Black-Scholes approximations for Greeks when Yahoo doesn't provide them ─

const RFR = 0.05   // risk-free rate (approximate current Fed funds rate)

// Approximate normal CDF
function normCdf(x: number): number {
  const a = 0.2316419
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429]
  const k = 1 / (1 + a * Math.abs(x))
  const poly = k * (b[0] + k * (b[1] + k * (b[2] + k * (b[3] + k * b[4]))))
  return x >= 0 ? 1 - poly * Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI) : poly * Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI)
}

// Approximate normal PDF
function normPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI)
}

// Approximate d1, d2 for Black-Scholes
function bsD1D2(S: number, K: number, T: number, r: number, q: number, sigma: number) {
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  return { d1, d2 }
}

// ─── Greeks approximations from IV ─────────────────────────────────────────

/**
 * Estimate delta from implied volatility and moneyness
 * For calls: N(d1), For puts: N(d1) - exp(-q*T)
 */
export function approxDelta(spot: number, strike: number, T: number, r: number, q: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0) return type === 'call' ? 1 : -1
  const { d1 } = bsD1D2(spot, strike, T, r, q, sigma)
  return type === 'call' ? normCdf(d1) : normCdf(d1) - Math.exp(-q * T)
}

/**
 * Estimate gamma from implied volatility
 * Gamma is the same for calls and puts
 */
export function approxGamma(spot: number, strike: number, T: number, r: number, q: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0
  const { d1 } = bsD1D2(spot, strike, T, r, q, sigma)
  return normPdf(d1) / (spot * sigma * Math.sqrt(T))
}

/**
 * Estimate vega from implied volatility
 * Per 1% (0.01) move in vol
 */
export function approxVega(spot: number, strike: number, T: number, r: number, q: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return 0
  const { d1 } = bsD1D2(spot, strike, T, r, q, sigma)
  return (spot * normPdf(d1) * Math.sqrt(T)) / 100
}

/**
 * Estimate theta from implied volatility
 * Daily theta (negative = burn per day)
 */
export function approxTheta(spot: number, strike: number, T: number, r: number, q: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0) return 0
  const { d1, d2 } = bsD1D2(spot, strike, T, r, q, sigma)
  const term1 = -(spot * normPdf(d1) * sigma) / (2 * Math.sqrt(T))
  const term2 = r * strike * Math.exp(-r * T)
  const term3 = q * spot * Math.exp(-q * T)
  const theta = type === 'call'
    ? (term1 - term2 + term3) / 365
    : (term1 + term2 - term3) / 365
  return theta
}

/**
 * Estimate rho from implied volatility
 * Per 1% move in interest rate
 */
export function approxRho(spot: number, strike: number, T: number, r: number, q: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0) return 0
  const { d2 } = bsD1D2(spot, strike, T, r, q, sigma)
  return type === 'call'
    ? (strike * T * Math.exp(-r * T) * normCdf(d2)) / 100
    : (-strike * T * Math.exp(-r * T) * normCdf(-d2)) / 100
}

// ─── Normalize Yahoo options data ────────────────────────────────────────────

/**
 * Normalize raw Yahoo Finance options chain into our OptionExpiry format
 * Yahoo options() returns: { expirationDates: string[], puts: {...}[], calls: {...}[] }
 * Each contract has: strike, bid, ask, lastPrice, volume, openInterest, impliedVolatility
 */
export function normalizeYahooOptionsChain(
  ticker: string,
  spotPrice: number,
  rawChain: {
    expirationDates: number[]
    puts: Record<string, unknown>[]
    calls: Record<string, unknown>[]
  },
  now: Date = new Date()
): OptionExpiry[] {
  const expirations = rawChain.expirationDates ?? []
  const rawCalls = Array.isArray(rawChain.calls) ? rawChain.calls : []
  const rawPuts = Array.isArray(rawChain.puts) ? rawChain.puts : []

  return expirations.map((expTs: number) => {
    const expiryDate = new Date(expTs * 1000)
    const daysToExpiry = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    const T = daysToExpiry / 365

    const toContract = (raw: Record<string, unknown>, type: 'call' | 'put'): RawOptionContract => {
      const strike = Number(raw.strike ?? 0)
      const iv = Number(raw.impliedVolatility ?? 0.3)
      const delta = Number(raw.delta ?? approxDelta(spotPrice, strike, T, RFR, 0, iv, type))
      const gamma = Number(raw.gamma ?? approxGamma(spotPrice, strike, T, RFR, 0, iv))
      const theta = Number(raw.theta ?? approxTheta(spotPrice, strike, T, RFR, 0, iv, type))
      const vega = Number(raw.vega ?? approxVega(spotPrice, strike, T, RFR, 0, iv))
      const moneyness = spotPrice / strike
      const itm = type === 'call' ? moneyness > 1.0 : moneyness < 1.0

      return {
        strike,
        expiry: expiryDate.toISOString(),
        type,
        bid: Number(raw.bid ?? 0),
        ask: Number(raw.ask ?? 0),
        last: Number(raw.lastPrice ?? 0),
        volume: Number(raw.volume ?? 0),
        oi: Number(raw.openInterest ?? 0),
        impliedVol: iv,
        delta: Number.isFinite(delta) ? delta : 0,
        gamma: Number.isFinite(gamma) ? gamma : 0,
        theta: Number.isFinite(theta) ? theta : 0,
        vega: Number.isFinite(vega) ? vega : 0,
        inTheMoney: itm,
      }
    }

    const calls = rawCalls
      .filter((c: Record<string, unknown>) => Number(c.expiration ?? 0) === expTs)
      .map((c: Record<string, unknown>) => toContract(c, 'call'))

    const puts = rawPuts
      .filter((p: Record<string, unknown>) => Number(p.expiration ?? 0) === expTs)
      .map((p: Record<string, unknown>) => toContract(p, 'put'))

    return { date: expiryDate.toISOString(), calls, puts, daysToExpiry }
  })
}

// ─── OI-weighted implied volatility (descriptive chain summary) ─────────────

/** OI-weighted mean IV (same numeric scale as `RawOptionContract.impliedVol`, typically 0–2+ as annualized decimal). */
export interface OiWeightedIvSnapshot {
  calls: number | null
  puts: number | null
  combined: number | null
  /** Sum of open interest included in the calls leg weighting. */
  oiWeightCalls: number
  /** Sum of open interest included in the puts leg weighting. */
  oiWeightPuts: number
  /** Contracts with oi > 0 and finite impliedVol > 0. */
  contractsUsedCalls: number
  contractsUsedPuts: number
}

function accumulateOiIvLeg(
  contracts: RawOptionContract[],
  acc: { sumIvOi: number; sumOi: number; used: number }
): void {
  for (const c of contracts) {
    const oi = c.oi
    const iv = c.impliedVol
    if (oi > 0 && Number.isFinite(iv) && iv > 0) {
      acc.sumIvOi += iv * oi
      acc.sumOi += oi
      acc.used += 1
    }
  }
}

/**
 * Open-interest-weighted average implied volatility by leg and combined,
 * over one expiry slice or many (e.g. entire chain).
 * Excludes contracts with zero OI or non-positive / non-finite IV.
 */
export function computeOiWeightedIvForExpiries(expiries: OptionExpiry[]): OiWeightedIvSnapshot {
  const callsAcc = { sumIvOi: 0, sumOi: 0, used: 0 }
  const putsAcc = { sumIvOi: 0, sumOi: 0, used: 0 }
  for (const expiry of expiries) {
    accumulateOiIvLeg(expiry.calls, callsAcc)
    accumulateOiIvLeg(expiry.puts, putsAcc)
  }
  const combinedSumIvOi = callsAcc.sumIvOi + putsAcc.sumIvOi
  const combinedSumOi = callsAcc.sumOi + putsAcc.sumOi
  return {
    calls: callsAcc.sumOi > 0 ? callsAcc.sumIvOi / callsAcc.sumOi : null,
    puts: putsAcc.sumOi > 0 ? putsAcc.sumIvOi / putsAcc.sumOi : null,
    combined: combinedSumOi > 0 ? combinedSumIvOi / combinedSumOi : null,
    oiWeightCalls: callsAcc.sumOi,
    oiWeightPuts: putsAcc.sumOi,
    contractsUsedCalls: callsAcc.used,
    contractsUsedPuts: putsAcc.used,
  }
}

// ─── Core Gamma Analysis ─────────────────────────────────────────────────────

const CONTRACT_MULTIPLIER = 100   // standard equity option = 100 shares

/**
 * Build gamma ladder: net gamma at each strike
 * Net gamma = call_gamma_at_strike - put_gamma_at_strike
 * Positive = dealers net long gamma (stabilizing)
 * Negative = dealers net short gamma (destabilizing)
 */
export function buildGammaLadder(
  spotPrice: number,
  expiries: OptionExpiry[]
): GammaStrikeLevel[] {
  // Collect all unique strikes across all expiries
  const strikeMap = new Map<number, GammaStrikeLevel>()

  for (const expiry of expiries) {
    const weight = Math.exp(-0.04 * expiry.daysToExpiry / 365) // time decay on gamma importance
    for (const call of expiry.calls) {
      const g = call.gamma * call.oi * CONTRACT_MULTIPLIER * weight
      const existing = strikeMap.get(call.strike) ?? {
        strike: call.strike,
        callGamma: 0, putGamma: 0, netGamma: 0,
        callOi: 0, putOi: 0, callVolume: 0, putVolume: 0,
      }
      existing.callGamma += g
      existing.callOi += call.oi
      existing.callVolume += call.volume
      strikeMap.set(call.strike, existing)
    }
    for (const put of expiry.puts) {
      const g = put.gamma * put.oi * CONTRACT_MULTIPLIER * weight
      const existing = strikeMap.get(put.strike) ?? {
        strike: put.strike,
        callGamma: 0, putGamma: 0, netGamma: 0,
        callOi: 0, putOi: 0, callVolume: 0, putVolume: 0,
      }
      existing.putGamma += g
      existing.putOi += put.oi
      existing.putVolume += put.volume
      strikeMap.set(put.strike, existing)
    }
  }

  // Compute net gamma
  const ladder: GammaStrikeLevel[] = []
  for (const level of strikeMap.values()) {
    level.netGamma = level.callGamma - level.putGamma
    ladder.push(level)
  }

  return ladder.sort((a, b) => a.strike - b.strike)
}

/**
 * Find the strike where gamma crosses zero (0-delta-gamma line)
 * This is the strike where dealers flip from buying to selling stock
 */
export function findGammaFlipStrike(ladder: GammaStrikeLevel[]): number {
  let flipStrike = ladder[0]?.strike ?? 0
  for (let i = 0; i < ladder.length - 1; i++) {
    const curr = ladder[i]
    const next = ladder[i + 1]
    if (curr.netGamma > 0 && next.netGamma < 0) {
      // Linear interpolation to find crossing point
      const ratio = curr.netGamma / (curr.netGamma - next.netGamma)
      flipStrike = curr.strike + ratio * (next.strike - curr.strike)
      break
    }
  }
  return flipStrike
}

/**
 * Calculate Max Pain strike
 * Max Pain = strike where option holders lose the most money at expiry
 * (minimizes total intrinsic value paid to option holders)
 * Returns per-expiry max pain AND the overall time-weighted strike.
 */
export function calcMaxPain(
  spotPrice: number,
  expiries: OptionExpiry[]
): { overallStrike: number; perExpiry: Array<{ expiry: string; strike: number; pain: number }> } {
  const perExpiryResults = expiries.map(expiry => {
    const strikes = new Set<number>()
    expiry.calls.forEach(c => strikes.add(c.strike))
    expiry.puts.forEach(p => strikes.add(p.strike))

    let minPain = Infinity, maxPainStrike = 0
    for (const strike of strikes) {
      let pain = 0
      for (const call of expiry.calls) {
        if (call.strike < strike) pain += (strike - call.strike) * call.oi * CONTRACT_MULTIPLIER
      }
      for (const put of expiry.puts) {
        if (put.strike > strike) pain += (put.strike - strike) * put.oi * CONTRACT_MULTIPLIER
      }
      if (pain < minPain) { minPain = pain; maxPainStrike = strike }
    }
    return { expiry: expiry.date, strike: maxPainStrike, pain: minPain }
  })

  // Overall: weight by time-to-expiry (higher weight for nearer expiries)
  const weights = perExpiryResults.map(r =>
    Math.exp(-0.04 * (new Date(r.expiry).getTime() - Date.now()) / (1000 * 365 * 24 * 3600))
  )
  const totalWeight = weights.reduce((s, w) => s + w, 0)
  const weightedStrike = totalWeight > 0
    ? perExpiryResults.reduce((s, r, i) => s + r.strike * weights[i], 0) / totalWeight
    : spotPrice

  // Round to nearest $5 strike
  const overallStrike = Math.round(weightedStrike / 5) * 5

  return { overallStrike, perExpiry: perExpiryResults }
}

/**
 * Find Call Wall: lowest strike ABOVE spot with concentrated call OI
 * Call wall acts as a ceiling — dealers must buy stock to hedge calls above here
 */
export function findCallWall(
  spotPrice: number,
  ladder: GammaStrikeLevel[]
): { strike: number; strength: number } {
  const totalCallGammaWeight = ladder.reduce((s, l) => s + l.callGamma * l.callOi, 0)
  const threshold = totalCallGammaWeight * 0.25  // 25% of total gamma-weighted call OI

  // Find strikes above spot sorted ascending
  const aboveSpot = ladder
    .filter(l => l.strike >= spotPrice)
    .sort((a, b) => a.strike - b.strike)

  let cumsum = 0
  for (const level of aboveSpot) {
    cumsum += level.callGamma * level.callOi
    if (cumsum >= threshold) {
      const strength = Math.min(100, Math.round((cumsum / totalCallGammaWeight) * 100))
      return { strike: level.strike, strength }
    }
  }

  // Fallback: highest strike above spot
  const highest = aboveSpot[aboveSpot.length - 1]
  return { strike: highest?.strike ?? spotPrice * 1.05, strength: 30 }
}

/**
 * Find Put Wall: highest strike BELOW spot with concentrated put OI
 * Put wall acts as a floor — dealers must sell stock to hedge puts below here
 */
export function findPutWall(
  spotPrice: number,
  ladder: GammaStrikeLevel[]
): { strike: number; strength: number } {
  const totalPutGammaWeight = ladder.reduce((s, l) => s + l.putGamma * l.putOi, 0)
  const threshold = totalPutGammaWeight * 0.25  // 25% of total gamma-weighted put OI

  // Find strikes below spot sorted descending
  const belowSpot = ladder
    .filter(l => l.strike <= spotPrice)
    .sort((a, b) => b.strike - a.strike)

  let cumsum = 0
  for (const level of belowSpot) {
    cumsum += level.putGamma * level.putOi
    if (cumsum >= threshold) {
      const strength = Math.min(100, Math.round((cumsum / totalPutGammaWeight) * 100))
      return { strike: level.strike, strength }
    }
  }

  // Fallback: lowest strike below spot
  const lowest = belowSpot[belowSpot.length - 1]
  return { strike: lowest?.strike ?? spotPrice * 0.95, strength: 30 }
}

/**
 * Calculate Vanna Exposure
 * Vanna = dDelta/dVol = dVega/dSpot
 * High Vanna = delta is sensitive to vol changes
 * Vanna > 0: falling vol + falling price = accelerating downside
 * Vanna < 0: falling vol + rising price = accelerating upside
 *
 * Includes both calls and puts; puts carry negative Vanna ITM.
 * Weighted by OTM-ness: higher weight away from ATM.
 * Returns raw weighted sum in gamma-vega terms (no arbitrary normalization).
 */
export function calcVanna(expiries: OptionExpiry[], spotPrice: number): number {
  const allAtm = expiries.flatMap(e => [
    ...e.calls.filter(c => Math.abs(c.strike - spotPrice) / spotPrice < 0.05).map(c => ({ ...c, sign: 1 as const })),
    ...e.puts.filter(p => Math.abs(p.strike - spotPrice) / spotPrice < 0.05).map(p => ({ ...p, sign: -1 as const })),
  ])

  if (allAtm.length === 0) return 0

  // Weight by OTM-ness: higher weight away from ATM (theoretical Vanna is zero exactly at ATM)
  const totalWeight = allAtm.reduce((s, c) => {
    const moneyness = Math.abs(1 - c.strike / spotPrice)
    return s + moneyness * c.oi
  }, 0)

  if (totalWeight === 0) return 0

  const weightedVanna = allAtm.reduce((sum, c) => {
    const moneyness = Math.abs(1 - c.strike / spotPrice)
    const weight = moneyness * c.oi
    return sum + c.sign * c.vega * weight
  }, 0)

  return weightedVanna / totalWeight
}

/**
 * Calculate Charm Exposure
 * Charm = dDelta/dTime = -dTheta/dSpot
 * Time decay of delta — as expiry approaches, ATM options lose delta sensitivity
 * Positive Charm = delta becoming more positive over time (bullish decay pattern)
 */
export function calcCharm(expiries: OptionExpiry[], spotPrice: number): number {
  // Sum of theta-weighted delta across all expiries
  const totalCharm = expiries.reduce((sum, expiry) => {
    const expiryWeight = Math.exp(-0.1 * expiry.daysToExpiry / 365) // decay with time
    const atmCalls = expiry.calls.filter(c => Math.abs(c.strike - spotPrice) / spotPrice < 0.05)
    const atmPuts = expiry.puts.filter(c => Math.abs(c.strike - spotPrice) / spotPrice < 0.05)

    const callCharm = atmCalls.reduce((s, c) => s + c.delta * c.theta * c.oi, 0)
    const putCharm = atmPuts.reduce((s, p) => s + p.delta * p.theta * p.oi, 0)

    return sum + (callCharm + putCharm) * expiryWeight
  }, 0)

  return totalCharm / 100 // normalize
}

// ─── Put/Call Ratios ────────────────────────────────────────────────────────

export function calcPutCallRatio(expiries: OptionExpiry[]): {
  putCallRatio: number
  putCallVolumeRatio: number
} {
  let totalPutOi = 0, totalCallOi = 0
  let totalPutVol = 0, totalCallVol = 0

  for (const expiry of expiries) {
    for (const call of expiry.calls) {
      totalCallOi += call.oi
      totalCallVol += call.volume
    }
    for (const put of expiry.puts) {
      totalPutOi += put.oi
      totalPutVol += put.volume
    }
  }

  return {
    putCallRatio: totalCallOi > 0 ? totalPutOi / totalCallOi : 0,
    putCallVolumeRatio: totalCallVol > 0 ? totalPutVol / totalCallVol : 0,
  }
}

// ─── Full Gamma Analysis ───────────────────────────────────────────────────

export function computeGammaAnalysis(
  ticker: string,
  spotPrice: number,
  quoteTime: string,
  expiries: OptionExpiry[]
): GammaAnalysis {
  const ladder = buildGammaLadder(spotPrice, expiries)

  // Total Greeks
  let totalCallDelta = 0, totalPutDelta = 0
  let totalVega = 0, totalTheta = 0

  for (const expiry of expiries) {
    const weight = Math.exp(-0.04 * expiry.daysToExpiry / 365)
    for (const call of expiry.calls) {
      totalCallDelta += call.delta * call.oi * weight
      totalVega += call.vega * call.oi * weight
      totalTheta += call.theta * call.oi * weight
    }
    for (const put of expiry.puts) {
      totalPutDelta += put.delta * put.oi * weight
      totalVega += put.vega * put.oi * weight
      totalTheta += put.theta * put.oi * weight
    }
  }

  // Zero-gamma boundaries (where net gamma ~0)
  const posGamma = ladder.filter(l => l.netGamma > 0)
  const negGamma = ladder.filter(l => l.netGamma < 0)
  const zeroGammaLower = posGamma.length > 0 ? posGamma[posGamma.length - 1].strike : spotPrice * 0.95
  const zeroGammaUpper = negGamma.length > 0 ? negGamma[0].strike : spotPrice * 1.05

  const { putCallRatio, putCallVolumeRatio } = calcPutCallRatio(expiries)
  const gammaFlipStrike = findGammaFlipStrike(ladder)
  const maxPainResult = calcMaxPain(spotPrice, expiries)
  const callWall = findCallWall(spotPrice, ladder)
  const putWall = findPutWall(spotPrice, ladder)
  const vanna = calcVanna(expiries, spotPrice)
  const charm = calcCharm(expiries, spotPrice)

  // Highest OI strikes
  const highestCallOiStrike = ladder.reduce((max, l) => l.callOi > (max?.callOi ?? 0) ? l : max, ladder[0])?.strike ?? spotPrice
  const highestPutOiStrike = ladder.reduce((max, l) => l.putOi > (max?.putOi ?? 0) ? l : max, ladder[0])?.strike ?? spotPrice

  // Total gamma exposure (sum of absolute net gamma)
  const totalGammaExposure = ladder.reduce((s, l) => s + Math.abs(l.netGamma), 0)

  const dataVerification = createVerification(
    expiries.length > 0 ? 'yahoo' : 'illustrative',
    expiries.length > 0
      ? `Yahoo Finance options chain: ${expiries.length} expiry dates, ${ladder.length} strike levels. Greeks approximated via Black-Scholes when not provided by Yahoo.`
      : 'No options data available for this ticker. Greeks approximated using Black-Scholes with assumed 30% IV.',
    {
      confidence: expiries.length > 0 ? 0.85 : 0.4,
      rawFields: ['impliedVolatility', 'openInterest', 'volume', 'bid', 'ask', 'lastPrice', 'delta', 'gamma', 'theta', 'vega'],
    }
  )

  return {
    ticker,
    spotPrice,
    quoteTime,
    expiryChain: expiries,
    totalCallDelta,
    totalPutDelta,
    netDelta: totalCallDelta + totalPutDelta,
    totalVega,
    totalTheta,
    totalGammaExposure,
    gammaFlipStrike,
    zeroGammaLower,
    zeroGammaUpper,
    maxPainStrike: maxPainResult.overallStrike,
    callWallStrike: callWall.strike,
    putWallStrike: putWall.strike,
    callWallStrength: callWall.strength,
    putWallStrength: putWall.strength,
    highestCallOiStrike,
    highestPutOiStrike,
    putCallRatio,
    putCallVolumeRatio,
    vannaExposure: vanna,
    charmExposure: charm,
    gammaLadder: ladder,
    dataVerification,
  }
}

// ─── Interpretation helpers ────────────────────────────────────────────────

export interface GammaInterpretation {
  dealerPosture: 'long_gamma' | 'short_gamma' | 'neutral'
  marketImplication: string
  hedgingBias: 'buy_dips' | 'sell_rips' | 'unclear'
  volSignal: 'cramp_dealers' | 'dealers_hedge_flip' | 'stable'
  confidence: 'high' | 'medium' | 'low'
}

export function interpretGamma(analysis: GammaAnalysis): GammaInterpretation {
  const { gammaFlipStrike, spotPrice, totalGammaExposure } = analysis

  // Net dealer delta position
  const netDeltaSign = analysis.netDelta > 0 ? 1 : -1
  const absNetDelta = Math.abs(analysis.netDelta)

  // Is spot inside zero-gamma zone?
  const inZeroGammaZone = spotPrice >= analysis.zeroGammaLower && spotPrice <= analysis.zeroGammaUpper

  // Determine dealer posture
  let dealerPosture: GammaInterpretation['dealerPosture']
  if (totalGammaExposure > absNetDelta * 10) {
    dealerPosture = 'long_gamma'
  } else if (totalGammaExposure < absNetDelta * 2) {
    dealerPosture = 'short_gamma'
  } else {
    dealerPosture = 'neutral'
  }

  // Hedging bias
  let hedgingBias: GammaInterpretation['hedgingBias']
  if (inZeroGammaZone) {
    hedgingBias = 'unclear'
  } else if (spotPrice > gammaFlipStrike) {
    // Above flip: dealers who are short gamma must buy stock on rallies
    hedgingBias = 'buy_dips'
  } else {
    // Below flip: dealers who are short gamma must sell stock on dips
    hedgingBias = 'sell_rips'
  }

  // Vol signal
  let volSignal: GammaInterpretation['volSignal']
  if (analysis.totalTheta < -absNetDelta * 0.1) {
    volSignal = 'cramp_dealers' // high theta burn relative to delta = dealers squeezed
  } else if (Math.abs(spotPrice - gammaFlipStrike) / spotPrice < 0.01) {
    volSignal = 'dealers_hedge_flip'
  } else {
    volSignal = 'stable'
  }

  const confidence: GammaInterpretation['confidence'] =
    analysis.dataVerification.confidence > 0.8 ? 'high' :
    analysis.dataVerification.confidence > 0.5 ? 'medium' : 'low'

  // Market implication narrative
  let marketImplication = ''
  if (dealerPosture === 'long_gamma' && spotPrice > gammaFlipStrike) {
    marketImplication = `Dealers net long gamma above ${gammaFlipStrike.toFixed(2)}. Positive feedback loop: price up → dealers buy stock to hedge → price up. Stability zone.`
  } else if (dealerPosture === 'long_gamma' && spotPrice < gammaFlipStrike) {
    marketImplication = `Dealers net long gamma below ${gammaFlipStrike.toFixed(2)}. Dealers buy dips to hedge, selling rips — mean reversion tendency.`
  } else if (dealerPosture === 'short_gamma') {
    marketImplication = `Dealers net short gamma (${analysis.totalTheta.toFixed(0)} daily theta burn). Negative feedback: price up → dealers sell → price down. Moves amplify. Watch for squeeze.`
  } else {
    marketImplication = `Dealers near gamma-neutral. Market may lack clear intraday hedging direction.`
  }

  return { dealerPosture, hedgingBias, volSignal, marketImplication, confidence }
}
