/**
 * Q-075 wave 5 (2026-07-18) — mutation hardening for the backtest shard
 * (63.50 on run 29584073911; acceptance ≥ 70).
 *
 * Waves 3–4 (#125/#127) target portfolioBacktest + signals.enhanced. This
 * wave takes the pools with NO golden aboard:
 *   regimeSignal (47 survived — the dip-zone classifier, ZERO dedicated
 *     goldens), benchmarkLabel (56 — warmup/tail boundaries, cost override,
 *     netWinRate divergence), liveSignal (18 — the non-dip HOLD payload with
 *     null indicator fields).
 *
 * Exact pins are CHARACTERIZATION goldens from the shipped implementation on
 * deterministic fixtures. Deviation boundaries land on IEEE-exact integers
 * (flat-100 SMA base) so `>` vs `>=` mutants flip a pinned zone; every fp
 * value uses toBeCloseTo (2026-07-16 Node-20/25 ulp lesson).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { regimeSignal } from '@/lib/backtest/regimeSignal'
import {
  runInstrumentLabelBenchmark,
  signalAtBarIndex,
  WARMUP_BARS,
  LABEL_HOLD_DAYS,
} from '@/lib/backtest/benchmarkLabel'
import { buildLiveInstrumentSignal, REGIME_COLORS } from '@/lib/backtest/liveSignal'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'

const SECONDS_PER_DAY = 86400
const START_TIME = Date.UTC(2024, 0, 1) / 1000

function makeOhlcv(bars: number, priceFn: (i: number) => number, range = 0.5): OhlcvRow[] {
  const out: OhlcvRow[] = []
  for (let i = 0; i < bars; i++) {
    const close = priceFn(i)
    const open = i === 0 ? close : priceFn(i - 1)
    out.push({
      time: START_TIME + i * SECONDS_PER_DAY,
      open,
      high: Math.max(open, close) + range,
      low: Math.min(open, close) - range,
      close,
      volume: 1_000_000 + (i % 7) * 50_000,
    })
  }
  return out
}

function multiDipSeries(bars: number, crashes: number[], rate = 0.004, crashFactor = 0.64, tailRate?: number): OhlcvRow[] {
  const closes: number[] = []
  let level = 100
  let g = rate
  const crashSet = new Set(crashes)
  for (let i = 0; i < bars; i++) {
    if (i > 0) level *= 1 + g
    if (crashSet.has(i)) { level *= crashFactor; g = tailRate ?? rate }
    closes.push(level)
  }
  return makeOhlcv(bars, (i) => closes[i], 0.2)
}
const dipRecover380 = () => multiDipSeries(380, [300], 0.004, 0.64, 0.005)

afterEach(() => vi.unstubAllEnvs())

// ─── regimeSignal — full dip-zone branch matrix ──────────────────────────────
// flat-240 closes → SMA=100, slope=0 (slopePos=false), price-was-near=true.
// slopePos=false ⇒ canBuyDip=false ⇒ every dip zone is a HOLD/SELL, never BUY.
// Integer deviations (price−100) pin the `>` / `>=` zone boundaries exactly.

describe('regimeSignal — deviation-zone boundaries (flat SMA, non-positive slope)', () => {
  const flat240 = Array.from({ length: 240 }, () => 100)

  const cases: Array<[number, string, string, string, number]> = [
    // price, zone, dipSignal, action, confidence
    [125, 'EXTREME_BULL', 'OVERBOUGHT', 'HOLD', 40],
    [121, 'EXTREME_BULL', 'OVERBOUGHT', 'HOLD', 40], // dev=21 > 20 (strict)
    [120, 'EXTENDED_BULL', 'OVERBOUGHT', 'HOLD', 45], // dev=20 not > 20
    [115, 'EXTENDED_BULL', 'OVERBOUGHT', 'HOLD', 45],
    [111, 'EXTENDED_BULL', 'OVERBOUGHT', 'HOLD', 45], // dev=11 > 10
    [110, 'HEALTHY_BULL', 'IN_TREND', 'HOLD', 55],    // dev=10 not > 10
    [105, 'HEALTHY_BULL', 'IN_TREND', 'HOLD', 55],
    [100, 'HEALTHY_BULL', 'IN_TREND', 'HOLD', 55],    // dev=0 >= 0
    [95, 'FIRST_DIP', 'WATCH_DIP', 'HOLD', 35],       // dev=-5, canBuyDip false
    [90, 'FIRST_DIP', 'WATCH_DIP', 'HOLD', 35],       // dev=-10 >= -10
    [85, 'DEEP_DIP', 'FALLING_KNIFE', 'SELL', 82],    // dev=-15
    [80, 'DEEP_DIP', 'FALLING_KNIFE', 'SELL', 82],    // dev=-20 >= -20
    [75, 'BEAR_ALERT', 'FALLING_KNIFE', 'SELL', 90],  // dev=-25
    [70, 'BEAR_ALERT', 'FALLING_KNIFE', 'SELL', 90],  // dev=-30 >= -30
    [65, 'CRASH_ZONE', 'FALLING_KNIFE', 'SELL', 95],  // dev=-35 < -30
  ]

  it.each(cases)('price %d → %s / %s / %s @ conf %d', (price, zone, dip, action, conf) => {
    const r = regimeSignal(price, flat240)
    expect(r.zone).toBe(zone)
    expect(r.dipSignal).toBe(dip)
    expect(r.action).toBe(action)
    expect(r.confidence).toBe(conf)
    expect(r.deviationPct).toBeCloseTo(price - 100, 10) // SMA=100 ⇒ dev = price−100
    expect(r.slopePct).toBe(0)
    expect(r.slopePositive).toBe(false)
    expect(r.label).toBe(zone)
  })
})

describe('regimeSignal — BUY branches require positive slope AND near-SMA', () => {
  // rising-240 (100 + 0.1·i): SMA≈113.95, slope≈0.017865 (>0.005 ⇒ slopePos),
  // price-was-near=true ⇒ canBuyDip=true ⇒ dips become BUYs.
  const rising240 = Array.from({ length: 240 }, (_, i) => 100 + 0.1 * i)
  const SMA = 113.95

  it('FIRST_DIP BUY at conf 75, RSI<35 boosts to 90 (strict <)', () => {
    const p = SMA * 0.95
    expect(regimeSignal(p, rising240).confidence).toBe(75)          // no rsi
    expect(regimeSignal(p, rising240, 35).confidence).toBe(75)      // 35 not < 35
    expect(regimeSignal(p, rising240, 34.9).confidence).toBe(90)
    expect(regimeSignal(p, rising240, 30).confidence).toBe(90)
    const r = regimeSignal(p, rising240, 30)
    expect(r.zone).toBe('FIRST_DIP')
    expect(r.dipSignal).toBe('STRONG_DIP')
    expect(r.action).toBe('BUY')
    expect(r.slopePositive).toBe(true)
    expect(r.slopePct).toBeCloseTo(0.01786511835640911, 10)
  })

  it('deeper dip zones each carry their own BUY confidence', () => {
    expect(regimeSignal(SMA * 0.85, rising240)).toMatchObject({ zone: 'DEEP_DIP', action: 'BUY', confidence: 88, dipSignal: 'STRONG_DIP' })
    expect(regimeSignal(SMA * 0.75, rising240)).toMatchObject({ zone: 'BEAR_ALERT', action: 'BUY', confidence: 80, dipSignal: 'STRONG_DIP' })
    expect(regimeSignal(SMA * 0.65, rising240)).toMatchObject({ zone: 'CRASH_ZONE', action: 'BUY', confidence: 78, dipSignal: 'STRONG_DIP' })
  })
})

describe('regimeSignal — fail-closed guards', () => {
  const flat240 = Array.from({ length: 240 }, () => 100)
  const rising210 = Array.from({ length: 210 }, (_, i) => 100 + 0.1 * i)
  const SMA210 = 110.95

  it('< 200 closes → INSUFFICIENT_DATA HOLD conf 0 (nulls everywhere)', () => {
    const r = regimeSignal(100, flat240.slice(0, 199))
    expect(r).toEqual({
      zone: 'INSUFFICIENT_DATA', dipSignal: 'INSUFFICIENT_DATA',
      deviationPct: null, slopePct: null, slopePositive: null,
      action: 'HOLD', confidence: 0, label: 'Insufficient Data',
    })
  })

  it('non-positive / non-finite price → dev==null guard: HOLD conf 0, slope retained', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const r = regimeSignal(bad, flat240)
      expect(r.zone).toBe('INSUFFICIENT_DATA')
      expect(r.action).toBe('HOLD')
      expect(r.confidence).toBe(0)
      expect(r.deviationPct).toBeNull()
      expect(r.slopePct).toBe(0)        // slope is still computed (flat ⇒ 0)
      expect(r.slopePositive).toBe(false)
    }
  })

  it('unknown slope (200–220 bars) in a deep dip → WATCH_DIP HOLD conf 20, never SELL', () => {
    // 210 bars ⇒ sma200Slope needs ≥221 ⇒ null ⇒ slopePos=null ⇒ Q05-1 branch.
    for (const [m, zone] of [[0.85, 'DEEP_DIP'], [0.75, 'BEAR_ALERT'], [0.65, 'CRASH_ZONE']] as const) {
      const r = regimeSignal(SMA210 * m, rising210)
      expect(r.zone).toBe(zone)
      expect(r.dipSignal).toBe('WATCH_DIP')
      expect(r.action).toBe('HOLD')
      expect(r.confidence).toBe(20)
      expect(r.slopePct).toBeNull()
      expect(r.slopePositive).toBeNull()
    }
  })
})

// ─── benchmarkLabel — warmup/tail boundaries, cost override, netWinRate ──────

describe('benchmarkLabel — SSOT constants + signalAtBarIndex window guards', () => {
  it('pins WARMUP_BARS=200 and LABEL_HOLD_DAYS=20', () => {
    expect(WARMUP_BARS).toBe(200)
    expect(LABEL_HOLD_DAYS).toBe(20)
  })

  it('HOLD (no signal) below warmup and inside the tail window', () => {
    const rows = dipRecover380()
    // i < WARMUP_BARS ⇒ forced HOLD before any signal is resolved.
    expect(signalAtBarIndex(rows, 199, 'AAPL', { productionPath: true })).toEqual({
      action: 'HOLD', grossReturn: null, netReturn: null, regimeZone: null,
    })
    // i >= rows.length - LABEL_HOLD_DAYS - 1 (= 359) ⇒ forced HOLD (no 20d fwd).
    expect(signalAtBarIndex(rows, 359, 'AAPL', { productionPath: true }).action).toBe('HOLD')
    expect(signalAtBarIndex(rows, 358, 'AAPL', { productionPath: true }).action).toBe('HOLD')
  })
})

describe('runInstrumentLabelBenchmark — cost override and netWinRate divergence', () => {
  it('a punitive cost config drops net returns below gross without moving gross WR', () => {
    const rows = dipRecover380()
    const base = runInstrumentLabelBenchmark('AAPL', 'Technology', rows, { productionPath: true })!
    const dear = runInstrumentLabelBenchmark('AAPL', 'Technology', rows, {
      productionPath: true,
      costs: { spreadBpsPerSide: 100, slippageBpsPerSide: 50, commissionBpsPerSide: 50 },
    })!
    // gross unchanged (same 21 BUYs, same gross math)
    expect(dear.buySignals).toBe(21)
    expect(dear.winRate).toBe(1)
    expect(dear.avgReturn20d).toBeCloseTo(base.avgReturn20d!, 12)
    // 200 bps round-trip (2 × 100 bps) subtracted off every gross ⇒ net avg −0.04
    expect(dear.avgNetReturn20d).toBeCloseTo(base.avgReturn20d! - 0.04, 10)
    expect(dear.avgNetReturn20d).toBeCloseTo(0.06489557718672836, 10)
    // net WR still 1 here (all wins clear the cost), but net avg strictly below gross
    expect(dear.avgNetReturn20d!).toBeLessThan(dear.avgReturn20d!)
  })

  it('252-bar smooth uptrend → zero BUYs but a real B&H return (not null)', () => {
    const rows252 = makeOhlcv(252, (i) => 100 + 0.05 * i, 0.2)
    const stats = runInstrumentLabelBenchmark('AAPL', 'Technology', rows252, { productionPath: true })!
    expect(stats.bars).toBe(252)
    expect(stats.buySignals).toBe(0)
    expect(stats.winRate).toBeNull()
    expect(stats.netWinRate).toBeNull()
    expect(stats.avgReturn20d).toBeNull()
    expect(stats.avgNetReturn20d).toBeNull()
    expect(stats.bnhReturn).toBeCloseTo(0.12549999999999997, 12) // (112.55−100)/100
    expect(stats.trades).toEqual([])
    // exact 252-bar boundary: 251 rows ⇒ null (needs ≥ 252)
    expect(runInstrumentLabelBenchmark('AAPL', 'T', rows252.slice(0, 251), { productionPath: true })).toBeNull()
  })
})

// ─── liveSignal — non-dip HOLD payload with null indicator fields ────────────

describe('buildLiveInstrumentSignal — alternate-branch payloads', () => {
  beforeEach(() => vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '0'))

  it('flat-200 series → HEALTHY_BULL HOLD with null slope/bbPctB and zero change', () => {
    const live = buildLiveInstrumentSignal(makeOhlcv(200, () => 100, 0.5), 'X', 'S')!
    expect(live.zone).toBe('HEALTHY_BULL')
    expect(live.dipSignal).toBe('IN_TREND')
    expect(live.action).toBe('HOLD')
    expect(live.confidence).toBe(55)
    expect(live.deviationPct).toBe(0)
    expect(live.slopePositive).toBeNull()   // 200 bars < 221 ⇒ slope null
    expect(live.bbPctB).toBeNull()          // flat series ⇒ zero band width ⇒ non-finite %B
    expect(live.changePct).toBe(0)          // prev==price
    expect(live.macdHist).toBe(0)
    expect(live.rsi14).toBe(100)            // no down-moves ⇒ RSI pinned at 100
    expect(live.atrPct).toBeCloseTo(1, 10)  // ATR≈1 on the ±0.5 range, price 100
    expect(live.regimeColor).toBe(REGIME_COLORS.HEALTHY_BULL)
    expect(live.regimeColor).toBe('#22c55e')
    expect(live.candles).toBe(200)
    expect(live.KellyFraction).toBeCloseTo(0.1, 10)
    expect(live.signalReason).toContain('HEALTHY_BULL')
  })

  it('extended-uptrend tail → EXTREME_BULL HOLD (overbought, no chase)', () => {
    const live = buildLiveInstrumentSignal(dipRecover380(), 'AAPL', 'Technology')!
    expect(live.zone).toBe('EXTREME_BULL')
    expect(live.dipSignal).toBe('OVERBOUGHT')
    expect(live.action).toBe('HOLD')
    expect(live.confidence).toBe(40)
    expect(live.deviationPct).toBeCloseTo(20.196999223723516, 6)
    expect(live.slopePositive).toBe(true)
    expect(live.rsi14).toBeCloseTo(98.383247, 4)
    expect(live.KellyFraction).toBeCloseTo(0.1, 10)
    expect(live.regimeColor).toBe('#ef4444')
    expect(live.candles).toBe(380)
  })

  it('REGIME_COLORS static map is complete and pinned', () => {
    expect(REGIME_COLORS).toEqual({
      EXTREME_BULL: '#ef4444',
      EXTENDED_BULL: '#f97316',
      HEALTHY_BULL: '#22c55e',
      FIRST_DIP: '#84cc16',
      DEEP_DIP: '#eab308',
      BEAR_ALERT: '#f97316',
      CRASH_ZONE: '#ef4444',
      INSUFFICIENT_DATA: '#64748b',
    })
  })
})
