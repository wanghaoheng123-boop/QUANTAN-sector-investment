import type { OptionExpiry, RawOptionContract } from '@/lib/quant/optionsGamma'
import { buildGammaLadder, calcMaxPain, findCallWall, findPutWall } from '@/lib/quant/optionsGamma'

export interface SafetyTierCandidate {
  tier: 'conservative' | 'balanced' | 'aggressive'
  strike: number
  expiry: string
  daysToExpiry: number
  premiumPerShare: number
  premiumYieldPct: number
  distanceFromSpotPct: number
  oi: number
  volume: number
  liquidityScore: number
  score: number
  rationale: string
}

export interface OptionsIntelligenceResult {
  spotPrice: number
  expiriesAnalyzed: number
  maxPainStrike: number
  callWallStrike: number
  callWallStrength: number
  putWallStrike: number
  putWallStrength: number
  entryBands: Array<{
    tier: 'conservative' | 'balanced' | 'aggressive'
    low: number
    high: number
    note: string
  }>
  sellPutCandidates: SafetyTierCandidate[]
  sellCallCandidates: SafetyTierCandidate[]
  confidence: 'high' | 'medium' | 'low'
  confidenceReason: string
}

function premiumPerShare(c: RawOptionContract): number {
  const mid = (c.bid + c.ask) / 2
  if (Number.isFinite(mid) && mid > 0) return mid
  return Number.isFinite(c.last) ? Math.max(0, c.last) : 0
}

function liquidityScore(c: RawOptionContract): number {
  const spread = c.ask > 0 ? Math.max(0, c.ask - c.bid) : 999
  const spreadPenalty = spread > 1 ? 0.4 : spread > 0.5 ? 0.7 : 1
  const oiBoost = Math.min(1, c.oi / 1000)
  const volumeBoost = Math.min(1, c.volume / 500)
  return Math.max(0, Math.min(1, spreadPenalty * (0.55 + 0.25 * oiBoost + 0.2 * volumeBoost)))
}

function nearestLiquidExpiry(expiries: OptionExpiry[]): OptionExpiry | null {
  const candidates = expiries
    .filter(e => e.daysToExpiry >= 14 && e.daysToExpiry <= 60)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
  for (const e of candidates) {
    const oi = e.calls.reduce((s, c) => s + c.oi, 0) + e.puts.reduce((s, p) => s + p.oi, 0)
    if (oi > 500) return e
  }
  return candidates[0] ?? expiries[0] ?? null
}

function pickTier<T>(values: T[], idx: number): T | null {
  if (values.length === 0) return null
  const i = Math.max(0, Math.min(values.length - 1, idx))
  return values[i]
}

function buildPutCandidate(spot: number, expiry: OptionExpiry, c: RawOptionContract, tier: SafetyTierCandidate['tier']): SafetyTierCandidate {
  const premium = premiumPerShare(c)
  const distance = (spot - c.strike) / spot
  const liq = liquidityScore(c)
  const score = distance * 0.55 + (premium / Math.max(c.strike, 1)) * 0.2 + liq * 0.25
  return {
    tier,
    strike: c.strike,
    expiry: expiry.date,
    daysToExpiry: expiry.daysToExpiry,
    premiumPerShare: premium,
    premiumYieldPct: c.strike > 0 ? (premium / c.strike) * 100 : 0,
    distanceFromSpotPct: distance * 100,
    oi: c.oi,
    volume: c.volume,
    liquidityScore: liq,
    score,
    rationale: `${tier} put: ${distance >= 0 ? '+' : ''}${(distance * 100).toFixed(2)}% below spot, ${(premium / Math.max(c.strike, 1) * 100).toFixed(2)}% premium yield.`,
  }
}

function buildCallCandidate(spot: number, expiry: OptionExpiry, c: RawOptionContract, tier: SafetyTierCandidate['tier']): SafetyTierCandidate {
  const premium = premiumPerShare(c)
  const distance = (c.strike - spot) / spot
  const liq = liquidityScore(c)
  const score = distance * 0.5 + (premium / Math.max(spot, 1)) * 0.2 + liq * 0.3
  return {
    tier,
    strike: c.strike,
    expiry: expiry.date,
    daysToExpiry: expiry.daysToExpiry,
    premiumPerShare: premium,
    premiumYieldPct: spot > 0 ? (premium / spot) * 100 : 0,
    distanceFromSpotPct: distance * 100,
    oi: c.oi,
    volume: c.volume,
    liquidityScore: liq,
    score,
    rationale: `${tier} call: ${distance >= 0 ? '+' : ''}${(distance * 100).toFixed(2)}% above spot with ${(premium / Math.max(spot, 1) * 100).toFixed(2)}% premium.`,
  }
}

export function buildOptionsIntelligence(spotPrice: number, expiries: OptionExpiry[]): OptionsIntelligenceResult {
  const ladder = buildGammaLadder(spotPrice, expiries)
  const maxPainStrike = calcMaxPain(spotPrice, expiries).overallStrike
  const callWall = findCallWall(spotPrice, ladder)
  const putWall = findPutWall(spotPrice, ladder)

  const focusExpiry = nearestLiquidExpiry(expiries)
  const puts = (focusExpiry?.puts ?? [])
    .filter(p => p.strike < spotPrice && p.oi > 0)
    .sort((a, b) => b.strike - a.strike)
  const calls = (focusExpiry?.calls ?? [])
    .filter(c => c.strike > spotPrice && c.oi > 0)
    .sort((a, b) => a.strike - b.strike)

  const pConservative = pickTier(puts, Math.floor(puts.length * 0.2))
  const pBalanced = pickTier(puts, Math.floor(puts.length * 0.4))
  const pAggressive = pickTier(puts, Math.floor(puts.length * 0.65))
  const cConservative = pickTier(calls, Math.floor(calls.length * 0.65))
  const cBalanced = pickTier(calls, Math.floor(calls.length * 0.45))
  const cAggressive = pickTier(calls, Math.floor(calls.length * 0.25))

  const sellPutCandidates = [
    pConservative ? buildPutCandidate(spotPrice, focusExpiry!, pConservative, 'conservative') : null,
    pBalanced ? buildPutCandidate(spotPrice, focusExpiry!, pBalanced, 'balanced') : null,
    pAggressive ? buildPutCandidate(spotPrice, focusExpiry!, pAggressive, 'aggressive') : null,
  ].filter((v): v is SafetyTierCandidate => v != null)

  const sellCallCandidates = [
    cConservative ? buildCallCandidate(spotPrice, focusExpiry!, cConservative, 'conservative') : null,
    cBalanced ? buildCallCandidate(spotPrice, focusExpiry!, cBalanced, 'balanced') : null,
    cAggressive ? buildCallCandidate(spotPrice, focusExpiry!, cAggressive, 'aggressive') : null,
  ].filter((v): v is SafetyTierCandidate => v != null)

  const conservativeLow = Math.min(putWall.strike, maxPainStrike) * 0.985
  const conservativeHigh = Math.max(putWall.strike, maxPainStrike) * 1.005
  const balancedLow = Math.min(maxPainStrike, spotPrice) * 0.99
  const balancedHigh = Math.max(maxPainStrike, spotPrice) * 1.01
  const aggressiveLow = Math.min(spotPrice, callWall.strike) * 0.995
  const aggressiveHigh = Math.max(spotPrice, callWall.strike) * 1.01

  const coverageScore = Math.min(1, expiries.length / 6)
  const liquidityScoreAvg = [...sellPutCandidates, ...sellCallCandidates].reduce((s, c) => s + c.liquidityScore, 0) / Math.max(1, sellPutCandidates.length + sellCallCandidates.length)
  const confidenceRaw = coverageScore * 0.55 + liquidityScoreAvg * 0.45
  const confidence = confidenceRaw > 0.75 ? 'high' : confidenceRaw > 0.5 ? 'medium' : 'low'

  return {
    spotPrice,
    expiriesAnalyzed: expiries.length,
    maxPainStrike,
    callWallStrike: callWall.strike,
    callWallStrength: callWall.strength,
    putWallStrike: putWall.strike,
    putWallStrength: putWall.strength,
    entryBands: [
      { tier: 'conservative', low: conservativeLow, high: conservativeHigh, note: 'Around put wall and max pain for larger safety margin.' },
      { tier: 'balanced', low: balancedLow, high: balancedHigh, note: 'Blend of max pain gravity and current spot context.' },
      { tier: 'aggressive', low: aggressiveLow, high: aggressiveHigh, note: 'Near spot/call wall transition with tighter buffer.' },
    ],
    sellPutCandidates,
    sellCallCandidates,
    confidence,
    confidenceReason: `Expiries analyzed=${expiries.length}, candidate liquidity=${liquidityScoreAvg.toFixed(2)}.`,
  }
}
