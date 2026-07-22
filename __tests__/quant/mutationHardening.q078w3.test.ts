/**
 * Q-078 wave 3 (2026-07-18) — mutation hardening for the quant-rest shard
 * (65.08 on run 29584073911; acceptance ≥ 70).
 *
 * Targets the survivor pools with NO wave aboard after #123/#126:
 *   relativeStrength (56 survived + 3 no-cov), frameworks (30), sectorRotation
 *   (29+1), intermarket (27), riskFreeRate (25 + 7 no-cov), constants (4 + 13
 *   no-cov), yahooSymbol (18).
 *
 * KEY LESSON APPLIED (from the #123 post-mortem): constants.ts and
 * yahooSymbol.ts stayed flat because their surviving mutants are STATIC —
 * module-scope initializers (the RFR env-override IIFE, the US_INDEX_SYMBOLS
 * set, the CODEX_FRAMEWORKS array) execute at import time, BEFORE any test
 * body runs, so ordinary assertions can never observe the mutated init.
 * The fix: `vi.resetModules()` + dynamic `await import(...)` INSIDE the test,
 * so module init re-executes during the test's coverage window.
 *
 * All fixtures are deterministic (no Math.random). Exact pins are
 * CHARACTERIZATION goldens from the shipped implementation; boundary pins
 * avoid fp-fragile classification edges (2026-07-16 Node-20/25 ulp lesson) —
 * every pinned boundary below lands on an IEEE-exact value.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  alignCloses,
  logReturns,
  correlation,
  trailingReturn,
  excessReturn,
  relativeStrengthVsBenchmark,
} from '@/lib/quant/relativeStrength'
import { intermarketCorrelations, classifyRegime } from '@/lib/quant/intermarket'
import type { CorrelationMap } from '@/lib/quant/intermarket'
import { momentumScore, meanReversionBoost, sectorScores } from '@/lib/quant/sectorRotation'
import { rsiLatest } from '@/lib/quant/indicators'
import {
  getRiskFreeRate,
  getRiskFreeRateSync,
  _resetRiskFreeRateCache,
} from '@/lib/quant/riskFreeRate'

const realFetch = globalThis.fetch

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.resetModules()
  globalThis.fetch = realFetch
  _resetRiskFreeRateCache()
})

// ─── relativeStrength — exact-value pins ─────────────────────────────────────

describe('alignCloses — exact filtering and pairing', () => {
  it('drops unmatched dates and non-positive closes on EITHER side', () => {
    const out = alignCloses(
      ['d1', 'd2', 'd3', 'd4', 'd5'],
      [10, 0, 30, 40, 50],       // d2 closeA = 0 → dropped
      ['d1', 'd2', 'd4', 'd5'],  // d3 missing on B → dropped
      [1, 2, -4, 5],             // d4 closeB = -4 → dropped
    )
    expect(out).toEqual({ a: [10, 50], b: [1, 5] })
  })

  it('empty inputs → empty aligned arrays', () => {
    expect(alignCloses([], [], ['d1'], [1])).toEqual({ a: [], b: [] })
  })
})

describe('logReturns — exact ln pins, non-positive pairs skipped', () => {
  it('pins ln ratios and skips both pairs touching a 0 close', () => {
    const r = logReturns([100, 110, 99, 0, 50, 55])
    expect(r).toHaveLength(3)
    expect(r[0]).toBeCloseTo(Math.log(1.1), 14)
    expect(r[1]).toBeCloseTo(Math.log(0.9), 14)
    expect(r[2]).toBeCloseTo(Math.log(1.1), 14)
  })

  it('single element / empty → []', () => {
    expect(logReturns([100])).toEqual([])
    expect(logReturns([])).toEqual([])
  })
})

describe('correlation — n≥10 gate and tail alignment', () => {
  const x10 = Array.from({ length: 10 }, (_, i) => i + 1)
  const y12 = Array.from({ length: 12 }, (_, i) => 100 - 3 * i)

  it('perfect anti-relation over the tail-aligned window → −1', () => {
    // min(10, 12) = 10 → x[0..9] vs y[2..11], both perfectly linear → −1
    expect(correlation(x10, y12)).toBeCloseTo(-1, 12)
  })

  it('n = 9 → null (strict < 10 gate)', () => {
    expect(correlation(x10.slice(0, 9), y12)).toBeNull()
    expect(correlation(x10, y12.slice(0, 9))).toBeNull()
  })
})

describe('trailingReturn / excessReturn — exact arithmetic + boundaries', () => {
  it('r = last/old − 1 over exactly `days` sessions', () => {
    expect(trailingReturn([100, 105, 110, 121], 2)).toBeCloseTo(121 / 105 - 1, 14)
    expect(trailingReturn([100, 121], 1)).toBeCloseTo(0.21, 14) // length == days+1 boundary
    expect(trailingReturn([100, 121], 2)).toBeNull()            // length == days → null
    expect(trailingReturn([0, 121], 1)).toBeNull()              // old ≤ 0 → null
    expect(trailingReturn([-5, 121], 1)).toBeNull()
  })

  it('excessReturn = rs − rb exactly; null propagates from either leg', () => {
    const stock = [100, 110, 132]
    const bench = [200, 210, 220]
    expect(excessReturn(stock, bench, 2)).toBeCloseTo(0.32 - 0.1, 14)
    expect(excessReturn([100], bench, 2)).toBeNull()
    expect(excessReturn(stock, [0, 1, 2], 2)).toBeNull()
  })
})

describe('relativeStrengthVsBenchmark — full-row characterization golden', () => {
  // Deterministic 130-bar series: SPY linear 400+i; TA geometric ×1.002/bar;
  // TB linear-declining 200−0.5i; TZ flat-100 with a single 0 close at the
  // 1-month-ago index (108) → pct1m null → ranks LAST via the ?? −Infinity sort.
  const spy130 = Array.from({ length: 130 }, (_, i) => 400 + i)
  const ta = Array.from({ length: 130 }, (_, i) => 100 * Math.pow(1.002, i))
  const tb = Array.from({ length: 130 }, (_, i) => 200 - 0.5 * i)
  const tz = (() => { const z = Array.from({ length: 130 }, () => 100); z[108] = 0; return z })()

  it('pins every ratio/pct/rank on the 3-ticker fixture', () => {
    const rows = relativeStrengthVsBenchmark({ TA: ta, TB: tb, TZ: tz }, spy130)
    expect(rows.map((r) => r.ticker)).toEqual(['TA', 'TB', 'TZ'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])

    const [a, b, z] = rows
    expect(a.ratio).toBeCloseTo(0.24461349087989467, 12)
    expect(a.ratio1mAgo).toBeCloseTo(0.24425879658706962, 12)
    expect(a.pct1m).toBeCloseTo(0.0014521249501801361, 12)
    expect(a.pct3m).toBeCloseTo(-0.0009281989408638749, 12)
    expect(a.pct6m).toBeCloseTo(-0.020098805574122306, 12)

    expect(b.ratio).toBeCloseTo(0.2561436672967864, 12)
    expect(b.ratio1mAgo).toBeCloseTo(0.2874015748031496, 12)
    expect(b.pct1m).toBeCloseTo(-0.10876039050159252, 12)
    expect(b.pct3m).toBeCloseTo(-0.28525180263291944, 12)
    expect(b.pct6m).toBeCloseTo(-0.4799702875536276, 12)

    // TZ: 0 close at the 21-trading-day lookback → 1m leg null, 3m/6m intact.
    expect(z.ratio).toBeCloseTo(0.1890359168241966, 12)
    expect(z.ratio1mAgo).toBeNull()
    expect(z.pct1m).toBeNull()
    expect(z.pct3m).toBeCloseTo(-0.11909262759924388, 12)
    expect(z.pct6m).toBeCloseTo(-0.23818525519848774, 12)
  })

  it('SPY gate boundaries: 21 bars → [], 22 bars → rows; spyLast ≤ 0 → []', () => {
    expect(relativeStrengthVsBenchmark({ TA: ta }, spy130.slice(0, 21))).toEqual([])
    const rows22 = relativeStrengthVsBenchmark({ TA: ta.slice(0, 22) }, spy130.slice(0, 22))
    expect(rows22).toHaveLength(1)
    // 22-bar ticker: ratio1m uses closes[0]/spy[0] exactly
    expect(rows22[0].ratio1mAgo).toBeCloseTo(100 / 400, 14)
    const spyDead = [...spy130]; spyDead[129] = 0
    expect(relativeStrengthVsBenchmark({ TA: ta }, spyDead)).toEqual([])
  })

  it('skips tickers with < 22 bars', () => {
    expect(relativeStrengthVsBenchmark({ TA: ta.slice(0, 21) }, spy130)).toEqual([])
  })
})

// ─── frameworks — static-data golden (dynamic import kills static mutants) ───

describe('CODEX_FRAMEWORKS — full-content golden', () => {
  it('deep-equals the curated pillar list (fresh module instance)', async () => {
    vi.resetModules()
    const { CODEX_FRAMEWORKS } = await import('@/lib/quant/frameworks')
    expect(CODEX_FRAMEWORKS.map((p) => p.id)).toEqual([
      'probabilistic', 'quality', 'macro', 'convexity', 'technology', 'narrative', 'physical',
    ])
    expect(CODEX_FRAMEWORKS).toEqual([
      {
        id: 'probabilistic',
        title: 'Probabilistic & EV (Thorp / Mauboussin-style)',
        themes: [
          'Treat each idea as expected value, not a story.',
          'Prefer the outside view / base rates over inside-view optimism.',
        ],
        checklist: [
          'Can you state win probability, payoff, and loss in the same units?',
          'What reference class of past outcomes most resembles this setup?',
          'Is position size consistent with edge and risk of ruin (Kelly thinking)?',
        ],
      },
      {
        id: 'quality',
        title: 'Quality & capital allocation (Buffett / Munger-style)',
        themes: [
          'Cash flows and ROIC persistence matter more than narrative.',
          'Margin of safety: buy below a conservative intrinsic band.',
        ],
        checklist: [
          'Is ROIC plausibly above cost of capital through a cycle?',
          'Is the moat structural (scale, regulation, network) vs. temporary?',
          'What would make this a permanent value trap (Klarman-style caution)?',
        ],
      },
      {
        id: 'macro',
        title: 'Liquidity & balance-sheet recessions (Druckenmiller / Koo-style)',
        themes: [
          'Broad risk assets often track liquidity; earnings drive relative winners.',
          'When the private sector deleverages, rate cuts may not revive demand.',
        ],
        checklist: [
          'Does the macro regime support credit expansion for this sector?',
          'Is this name a “liquid piggy bank” casualty in a margin-call spiral?',
        ],
      },
      {
        id: 'convexity',
        title: 'Tail risk & barbell (Taleb / Spitznagel-style)',
        themes: [
          'Gaussian risk models understate joint crashes; plan for fat tails.',
          'Convex hedges can protect geometric compounding.',
        ],
        checklist: [
          'What happens to this thesis in a correlation → 1.0 panic?',
          'Is downside convex or are you short volatility in disguise?',
        ],
      },
      {
        id: 'technology',
        title: 'Power laws & deployment cycles (Thiel / Perez-style)',
        themes: [
          'Technology waves have installation vs. deployment phases.',
          'Returns concentrate in a few winners; avoid false diversification.',
        ],
        checklist: [
          'Is the company in frenzy or deployment — and does valuation match?',
          'Is growth priced as if certainty when outcomes are power-law?',
        ],
      },
      {
        id: 'narrative',
        title: 'Narrative & reflexivity (Shiller / Soros-style)',
        themes: [
          'Stories drive flows; map when contagion may peak or break.',
          'Strong views, weakly held: update when the market disproves timing.',
        ],
        checklist: [
          'What narrative is priced in vs. underappreciated?',
          'What observable would make you invalidate the thesis quickly?',
        ],
      },
      {
        id: 'physical',
        title: 'Physical constraints (Smil / complexity-style)',
        themes: [
          'Software scales fast; atoms (energy, copper, logistics) move slowly.',
          'Increasing-returns businesses can lock in — or face regulatory backlash.',
        ],
        checklist: [
          'Where are physical bottlenecks in the value chain?',
          'Does the business rely on cheap energy / inputs that could reprice?',
        ],
      },
    ])
  })
})

// ─── intermarket — deterministic window pins + regime boundaries ─────────────

function isoDates(n: number, start = '2024-01-01'): string[] {
  const s = new Date(start + 'T00:00:00Z')
  return Array.from({ length: n }, (_, i) => new Date(s.getTime() + i * 86400_000).toISOString().slice(0, 10))
}

describe('intermarketCorrelations — 63d vs 252d window separation', () => {
  // Regime-shift fixture (deterministic): the benchmark moves AGAINST the
  // target's ±1% alternation for the first 150 bars, WITH it afterwards →
  // corr63d (all same-direction) = 1, corr252d (mixed window) ≈ 0.1905.
  // Any mutation of the slice(-63)/slice(-252) windowing separates the pins.
  const n = 300
  const dates = isoDates(n)
  const tgt: number[] = [100]
  for (let i = 1; i < n; i++) tgt.push(tgt[i - 1] * (i % 2 === 0 ? 1.01 : 0.99))
  const ben: number[] = [50]
  for (let i = 1; i < n; i++) {
    const w = i % 2 === 0 ? 1.01 : 0.99
    ben.push(ben[i - 1] * (i < 150 ? 2 - w : w))
  }

  it('pins both windows on the regime-shift fixture', () => {
    const r = intermarketCorrelations(tgt, dates, { SPY: { closes: ben, dates } })
    expect(r.SPY.corr63d).toBeCloseTo(1, 12)
    expect(r.SPY.corr252d).toBeCloseTo(0.19047619047619116, 12)
  })

  it('n ≥ 63 boundary: 64 aligned closes → corr63d = −1 (anti region); 63 → null', () => {
    const r64 = intermarketCorrelations(tgt.slice(0, 64), dates.slice(0, 64), {
      SPY: { closes: ben.slice(0, 64), dates: dates.slice(0, 64) },
    })
    expect(r64.SPY.corr63d).toBeCloseTo(-1, 12)
    expect(r64.SPY.corr252d).toBeNull()
    const r63 = intermarketCorrelations(tgt.slice(0, 63), dates.slice(0, 63), {
      SPY: { closes: ben.slice(0, 63), dates: dates.slice(0, 63) },
    })
    expect(r63.SPY.corr63d).toBeNull()
  })

  it('partially-supplied benchmarks: missing tickers get null entries', () => {
    const r = intermarketCorrelations(tgt, dates, { SPY: { closes: ben, dates } })
    for (const t of ['^VIX', 'UUP', 'TLT'] as const) {
      expect(r[t]).toEqual({ corr63d: null, corr252d: null })
    }
  })

  it('INTERMARKET_BENCHMARKS static tuple golden (fresh module instance)', async () => {
    vi.resetModules()
    const m = await import('@/lib/quant/intermarket')
    expect([...m.INTERMARKET_BENCHMARKS]).toEqual(['SPY', '^VIX', 'UUP', 'TLT'])
  })
})

describe('classifyRegime — exact threshold boundaries', () => {
  function corrs(spy: number | null, vix: number | null): CorrelationMap {
    return {
      SPY: { corr63d: spy, corr252d: null },
      '^VIX': { corr63d: vix, corr252d: null },
      UUP: { corr63d: null, corr252d: null },
      TLT: { corr63d: null, corr252d: null },
    }
  }

  it('strict boundaries: exactly 0.5 / −0.3 / 0 / 0.3 are all mixed', () => {
    expect(classifyRegime(corrs(0.5, -0.55))).toBe('mixed')   // spy > 0.5 strict
    expect(classifyRegime(corrs(0.65, -0.3))).toBe('mixed')   // vix < −0.3 strict
    expect(classifyRegime(corrs(0, 0.45))).toBe('mixed')      // spy < 0 strict
    expect(classifyRegime(corrs(-0.2, 0.3))).toBe('mixed')    // vix > 0.3 strict
  })

  it('one-sided conditions never fire alone (&& not ||)', () => {
    expect(classifyRegime(corrs(0.6, 0.5))).toBe('mixed')     // spy leg true, vix leg false
    expect(classifyRegime(corrs(-0.5, -0.5))).toBe('mixed')   // spy-negative true, vix leg false
  })
})

// ─── sectorRotation — exact momentum/boost/rank pins ─────────────────────────

describe('momentumScore — exact weighted arithmetic', () => {
  const rising = Array.from({ length: 253 }, (_, i) => 50 + 0.2 * i)

  it('0.4·r63 + 0.3·r126 + 0.3·r252 − r21, recomputed independently', () => {
    const pr = (days: number) => {
      const start = rising[rising.length - days - 1]
      return (rising[rising.length - 1] - start) / start
    }
    const expected = 0.40 * pr(63) + 0.30 * pr(126) + 0.30 * pr(252) - pr(21)
    expect(momentumScore(rising)).toBeCloseTo(expected, 14)
    expect(momentumScore(rising)).toBeCloseTo(0.41667606030063253, 12)
  })

  it('needs 253 bars (252-bar leg + baseline): 252 → null', () => {
    expect(momentumScore(rising.slice(0, 252))).toBeNull()
  })
})

describe('meanReversionBoost — all five RSI tiers on deterministic series', () => {
  // Alternating multiplicative series steer RSI(14) into each tier; the
  // rsiLatest range assertion makes each fixture self-validating.
  function alt(up: number, down: number, n = 40): number[] {
    const s = [100]
    for (let i = 1; i < n; i++) s.push(s[i - 1] * (i % 2 === 0 ? up : down))
    return s
  }

  it('RSI < 30 → +0.10 (deep oversold and monotone-down)', () => {
    const deepDown = Array.from({ length: 30 }, (_, i) => 100 - i) // RSI 0
    expect(rsiLatest(deepDown, 14)).toBe(0)
    expect(meanReversionBoost(deepDown)).toBe(0.10)
    const mildDown = alt(1.004, 0.99) // RSI ≈ 26.75
    expect(rsiLatest(mildDown, 14)!).toBeLessThan(30)
    expect(meanReversionBoost(mildDown)).toBe(0.10)
  })

  it('30 ≤ RSI < 40 → +0.05', () => {
    const s = alt(1.005, 0.99) // RSI ≈ 31.33
    const rsi = rsiLatest(s, 14)!
    expect(rsi).toBeGreaterThan(30)
    expect(rsi).toBeLessThan(40)
    expect(meanReversionBoost(s)).toBe(0.05)
  })

  it('neutral band → 0', () => {
    const s = alt(0.995, 1.01) // RSI ≈ 68.42 — inside (40, 70]
    const rsi = rsiLatest(s, 14)!
    expect(rsi).toBeGreaterThan(40)
    expect(rsi).toBeLessThan(70)
    expect(meanReversionBoost(s)).toBe(0)
  })

  it('70 < RSI ≤ 80 → −0.05', () => {
    const s = alt(0.997, 1.01) // RSI ≈ 78.34
    const rsi = rsiLatest(s, 14)!
    expect(rsi).toBeGreaterThan(70)
    expect(rsi).toBeLessThan(80)
    expect(meanReversionBoost(s)).toBe(-0.05)
  })

  it('RSI > 80 → −0.10; short series (RSI null) → 0', () => {
    const s = alt(0.998, 1.01) // RSI ≈ 84.45
    expect(rsiLatest(s, 14)!).toBeGreaterThan(80)
    expect(meanReversionBoost(s)).toBe(-0.10)
    expect(meanReversionBoost([100, 101, 102])).toBe(0)
  })
})

describe('sectorScores — composite pins, sector lookup, rank/signal boundaries', () => {
  const risingA = Array.from({ length: 253 }, (_, i) => 50 + 0.2 * i)
  const risingB = Array.from({ length: 253 }, (_, i) => 50 + 0.1 * i)

  it('pins composite = 0.6·momentum + 0.4·boost; XLK maps to Technology; unknown ETF falls back', () => {
    const rows = sectorScores({ XLK: risingA, ZZZ: risingB, SHORT: risingA.slice(0, 252) })
    expect(rows).toHaveLength(2) // SHORT (< 253 bars) skipped
    expect(rows[0]).toMatchObject({ sector: 'Technology', etf: 'XLK', rank: 1, signal: 'OVERWEIGHT' })
    expect(rows[1]).toMatchObject({ sector: 'ZZZ', etf: 'ZZZ', rank: 2, signal: 'OVERWEIGHT' })
    expect(rows[0].momentum).toBeCloseTo(0.41667606030063253, 12)
    expect(rows[0].meanReversion).toBe(-0.10)
    expect(rows[0].composite).toBeCloseTo(0.2100056361803795, 12)
    expect(rows[1].momentum).toBeCloseTo(0.2194303624123392, 12)
    expect(rows[1].composite).toBeCloseTo(0.09165821744740352, 12)
  })

  it('topN/bottomN boundaries: with 2 ETFs and topN=1/bottomN=1 → OVER then UNDER', () => {
    const rows = sectorScores({ XLK: risingA, ZZZ: risingB }, 1, 1)
    expect(rows.map((r) => [r.etf, r.rank, r.signal])).toEqual([
      ['XLK', 1, 'OVERWEIGHT'],
      ['ZZZ', 2, 'UNDERWEIGHT'],
    ])
  })

  it('empty input → []', () => {
    expect(sectorScores({})).toEqual([])
  })
})

// ─── riskFreeRate — cache expiry, URL contract, CSV walk-back, prewarm ───────

const FRED_CSV = (series: string, rows: string[]) => `DATE,${series}\n${rows.join('\n')}\n`

describe('riskFreeRate — cache staleness boundary (fake clock)', () => {
  it('cached value serves for < 24h, falls back at exactly 24h', async () => {
    const T0 = new Date('2026-07-18T12:00:00Z').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    _resetRiskFreeRateCache()
    globalThis.fetch = (async () =>
      new Response(FRED_CSV('DGS3MO', ['2026-07-17,4.85']), { status: 200 })) as typeof fetch

    await getRiskFreeRate(30)
    expect(getRiskFreeRateSync(30)).toBeCloseTo(0.0485, 12)

    vi.setSystemTime(T0 + 24 * 60 * 60 * 1000 - 1)
    expect(getRiskFreeRateSync(30)).toBeCloseTo(0.0485, 12) // 1ms before expiry

    vi.setSystemTime(T0 + 24 * 60 * 60 * 1000)
    expect(getRiskFreeRateSync(30)).toBe(0.0525) // strict <: exactly 24h is stale

    vi.setSystemTime(T0 + 24 * 60 * 60 * 1000 + 1)
    expect(getRiskFreeRateSync(30)).toBe(0.0525)
  })
})

describe('riskFreeRate — FRED URL contract + tenor routing', () => {
  async function capturedUrlFor(tenor: number): Promise<{ url: string; init: RequestInit | undefined }> {
    _resetRiskFreeRateCache()
    let captured: { url: string; init: RequestInit | undefined } = { url: '', init: undefined }
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init }
      return new Response(FRED_CSV('X', ['2026-07-17,4.00']), { status: 200 })
    }) as typeof fetch
    await getRiskFreeRate(tenor)
    return captured
  }

  it('pins the exact URL (id + cosd one year back) and the revalidate hint', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'))
    const { url, init } = await capturedUrlFor(180)
    expect(url).toBe('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS1&cosd=2025-07-18')
    expect((init as { next?: { revalidate?: number } } | undefined)?.next?.revalidate).toBe(86400)
  })

  it('routes every tenor boundary to the right series', async () => {
    expect((await capturedUrlFor(0)).url).toContain('id=DGS3MO&')
    expect((await capturedUrlFor(90)).url).toContain('id=DGS3MO&')
    expect((await capturedUrlFor(91)).url).toContain('id=DGS1&')
    expect((await capturedUrlFor(365)).url).toContain('id=DGS1&')
    expect((await capturedUrlFor(366)).url).toContain('id=DGS2&')
    expect((await capturedUrlFor(730)).url).toContain('id=DGS2&')
    expect((await capturedUrlFor(731)).url).toContain('id=DGS10&')
    expect((await capturedUrlFor(NaN)).url).toContain('id=DGS1&')   // non-finite → 365
    expect((await capturedUrlFor(-5)).url).toContain('id=DGS3MO&')  // clamped to 0
  })
})

describe('riskFreeRate — CSV walk-back parsing', () => {
  async function rateFromCsv(csv: string): Promise<number> {
    _resetRiskFreeRateCache()
    globalThis.fetch = (async () => new Response(csv, { status: 200 })) as typeof fetch
    return getRiskFreeRate(30)
  }

  it('walks past trailing "." missing values to the last numeric', async () => {
    const v = await rateFromCsv(FRED_CSV('DGS3MO', ['2026-07-15,4.10', '2026-07-16,.', '2026-07-17,.']))
    expect(v).toBeCloseTo(0.041, 12)
  })

  it('skips a 0.00 observation (strict > 0) and uses the older positive one', async () => {
    const v = await rateFromCsv(FRED_CSV('DGS3MO', ['2026-07-15,3.00', '2026-07-16,0.00']))
    expect(v).toBeCloseTo(0.03, 12)
  })

  it('all-missing data and header-only CSV → static fallback', async () => {
    expect(await rateFromCsv(FRED_CSV('DGS3MO', ['2026-07-16,.', '2026-07-17,.']))).toBe(0.0525)
    _resetRiskFreeRateCache()
    expect(await rateFromCsv('DATE,DGS3MO\n')).toBe(0.0525)
  })
})

describe('riskFreeRate — module-init prewarm gate (static mutants)', () => {
  async function importFreshWithEnv(prewarm: string | undefined, nodeEnv: string): Promise<number> {
    vi.resetModules()
    if (prewarm === undefined) vi.stubEnv('QUANTAN_FRED_PREWARM', undefined as unknown as string)
    else vi.stubEnv('QUANTAN_FRED_PREWARM', prewarm)
    vi.stubEnv('NODE_ENV', nodeEnv)
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response(FRED_CSV('X', ['2026-07-17,4.00']), { status: 200 })
    }) as typeof fetch
    await import('@/lib/quant/riskFreeRate')
    // allow the fire-and-forget prewarm microtasks to settle
    await new Promise((r) => setTimeout(r, 20))
    return calls
  }

  it('PREWARM=1 outside test env → warms all 4 series at import', async () => {
    expect(await importFreshWithEnv('1', 'production')).toBe(4)
  })

  it('PREWARM unset → no fetch; PREWARM=1 under NODE_ENV=test → no fetch', async () => {
    expect(await importFreshWithEnv(undefined, 'production')).toBe(0)
    expect(await importFreshWithEnv('1', 'test')).toBe(0)
  })
})

// ─── constants — env-override IIFE (static mutants via fresh imports) ────────

describe('BACKTEST_RFR_ANNUAL env override — full branch matrix', () => {
  async function freshConstants(envValue: string | undefined) {
    vi.resetModules()
    if (envValue === undefined) vi.stubEnv('BACKTEST_RFR_ANNUAL', undefined as unknown as string)
    else vi.stubEnv('BACKTEST_RFR_ANNUAL', envValue)
    return import('@/lib/quant/constants')
  }

  it('valid decimal override is honored exactly', async () => {
    expect((await freshConstants('0.052')).BACKTEST_RFR_ANNUAL).toBe(0.052)
  })

  it('bounds are inclusive-valid at 0 and 0.2, rejected beyond', async () => {
    expect((await freshConstants('0')).BACKTEST_RFR_ANNUAL).toBe(0)      // 0 is not < 0
    expect((await freshConstants('0.2')).BACKTEST_RFR_ANNUAL).toBe(0.2)  // 0.2 is not > 0.2
    expect((await freshConstants('-0.01')).BACKTEST_RFR_ANNUAL).toBe(0.045)
    expect((await freshConstants('0.25')).BACKTEST_RFR_ANNUAL).toBe(0.045)
    expect((await freshConstants('4.5')).BACKTEST_RFR_ANNUAL).toBe(0.045) // percent-not-decimal mistake
  })

  it('unset / empty / non-numeric → 0.045 default', async () => {
    expect((await freshConstants(undefined)).BACKTEST_RFR_ANNUAL).toBe(0.045)
    expect((await freshConstants('')).BACKTEST_RFR_ANNUAL).toBe(0.045)
    expect((await freshConstants('abc')).BACKTEST_RFR_ANNUAL).toBe(0.045)
  })

  it('sibling constants pinned on a fresh module instance', async () => {
    const m = await freshConstants(undefined)
    expect(m.OPTIONS_RFR_ANNUAL).toBe(0.0525)
    expect(m.DEFAULT_SORTINO_MAR_DAILY).toBe(0)
    expect(m.TRADING_DAYS_EQUITIES).toBe(252)
    expect(m.TRADING_DAYS_CRYPTO).toBe(365)
    expect(m.OPTIONS_DAYS_PER_YEAR).toBe(365)
    expect(m.DEFAULT_TX_COST_BPS_PER_SIDE).toBe(11)
  })
})

// ─── yahooSymbol — US_INDEX_SYMBOLS static set (fresh import) ────────────────

describe('yahooSymbolFromParam — index set golden on a fresh module instance', () => {
  it('prefixes every known US index, passes plain tickers, fails closed on junk', async () => {
    vi.resetModules()
    const { yahooSymbolFromParam } = await import('@/lib/quant/yahooSymbol')
    for (const idx of ['VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX']) {
      expect(yahooSymbolFromParam(idx.toLowerCase())).toBe(`^${idx}`)
    }
    expect(yahooSymbolFromParam('^VIX')).toBe('^VIX')
    expect(yahooSymbolFromParam('aapl')).toBe('AAPL')
    expect(yahooSymbolFromParam('  msft  ')).toBe('MSFT')
    expect(yahooSymbolFromParam('BRK-B')).toBe('BRK-B')
    expect(yahooSymbolFromParam('')).toBeNull()
    expect(yahooSymbolFromParam('bad ticker!')).toBeNull()
    expect(yahooSymbolFromParam(42 as unknown as string)).toBeNull()
  })
})
