# QUANTAN Master Plan — Phases 8–16
## Institutional-Grade Investment Intelligence with OPUS AI Feedback Loop

> **READ THIS FILE** before working on any Phase 8+ task. This is the canonical implementation plan for extending QUANTAN from the current 5-year backtest platform into a Warren-Buffet / Wall-Street-caliber self-optimizing investment intelligence system.
>
> Companion files:
> - `AGENTS.md` — project context + phase status
> - `memory/MEMORY.md` — memory bank index
> - `memory/project_quantan_master_plan.md` — condensed plan summary
> - `memory/project_quantan_architecture.md` — file map + constraints

---

## 1. Vision & Success Criteria

**Mission.** Build a self-optimizing quantitative investment platform that replicates how Warren Buffet's research team, Druckenmiller's macro framework, Renaissance Technologies' systematic edge, and Wall Street institutional desks analyze stocks — understanding how smart money accumulates positions, reads options market structure, and times entries across business cycles.

**Institutional-Grade Targets** (all must be met before declaring "done"):

| Metric | Target |
|---|---|
| Overall win rate (56 instruments) | ≥ 62% |
| 30-year Sharpe ratio | ≥ 1.5 |
| 30-year Sortino ratio | ≥ 2.0 |
| Max drawdown (30-year) | ≤ 20% |
| Valuation accuracy (fair value within ±15% of 12M actual) | ≥ 70% |
| Options strike recommendation POP (probability of profit) | ≥ 75% |
| Recession signal lead time (months before NBER) | ≥ 6 months |
| Institutional accumulation 12M forward alpha vs SPY | ≥ 8% |

---

## 2. AI Model Hierarchy

Three Claude models collaborate continuously:

| Role | Model | Function |
|---|---|---|
| **Brain / Orchestrator** | `claude-opus-4-7` | Strategic decisions, hypothesis generation, meta-optimization, research synthesis, quality gates |
| **Executor** | `claude-sonnet-4-6` | Code generation, algorithm implementation, complex analysis, report writing |
| **Fast Processor** | `claude-haiku-4-5` | Data pipelines, batch operations, real-time signal scoring, quick validation checks |

OPUS *thinks and decides*. Sonnet *implements*. Haiku *validates and processes*.

---

## 3. Phase 8 — Data Infrastructure 2.0 (30-Year Historical Data)

### Objective
Replace the 5-year JSON dataset with a 10–30-year multi-asset data warehouse spanning OHLCV, macro series, institutional holdings, and options history.

### Data Sources (All Free Tier)

| Source | Data | Period | Access |
|---|---|---|---|
| Stooq.com | Daily OHLCV | 30+ years | `https://stooq.com/q/d/l/?s={ticker}.us&i=d` CSV |
| FRED API | 800+ macro series | 1950s+ | `FRED_API_KEY` (already wired) |
| CBOE | VIX history, historical vol | 1990+ | Free CSV downloads |
| NBER | Recession dates | 1854+ | Static CSV |
| SEC EDGAR | 13F institutional filings | 1993+ | `https://data.sec.gov/submissions/` |
| CFTC | Commitment of Traders | 1986+ | Weekly CSV |

### New Files

| File | Purpose |
|---|---|
| `lib/data/providers/stooq.ts` | 30Y OHLCV CSV downloader implementing `DataProvider` interface |
| `lib/data/providers/cboe.ts` | VIX history + historical vol surface loader |
| `lib/data/providers/nber.ts` | `isRecession(date) -> boolean` helper |
| `lib/data/providers/edgar.ts` | 13F filing fetcher + parser |
| `lib/data/providers/cftc.ts` | COT data loader |
| `scripts/fetchLongHistory.ts` | Orchestrator: fetch 30Y OHLCV for all 56+ instruments via Stooq → SQLite |
| `scripts/fetchMacroSeries.ts` | Pull all FRED series into warehouse |

### Files to Extend

| File | Changes |
|---|---|
| `lib/data/warehouse.ts` | Add tables: `macro_series(series_id, date, value)`, `institutional_holdings(cik, ticker, quarter, shares, value)`, `recession_dates(start_date, end_date)`, `vix_history(date, open, high, low, close)` |
| `lib/backtest/dataLoader.ts` | Add `loadLongHistory(ticker, years)`, `loadMacroSeries(seriesId)`, `loadRecessionDates()` |

### Verification Commands
```bash
npm run fetch:history        # Downloads 30Y OHLCV for all 56 instruments
npm run fetch:macro          # Pulls all FRED series
npm run verify:data:long     # Integrity: no gaps >5 business days, OHLCV sanity, volume > 0 where expected
npm run test -- dataProviders
```

---

## 4. Phase 9 — Business Cycle Intelligence Engine

### Objective
Detect the current business cycle phase (Recovery → Expansion → Late Cycle → Slowdown → Contraction → Recession) with a confidence score, and map it to expected sector performance.

### Multi-Signal FRED Composite (weighted)

| Series ID | Indicator | Weight |
|---|---|---|
| `T10Y2Y` | 10Y-2Y yield spread | 20% |
| `T10Y3M` | 10Y-3M yield spread (NY Fed recession probit) | 20% |
| `BAMLH0A0HYM2` | HY OAS (credit stress) | 15% |
| `BAMLC0A0CM` | IG OAS | 10% |
| `UNRATE` | Unemployment rate | 10% |
| `ICSA` | Initial jobless claims (leading) | 10% |
| `MANEMP` | Manufacturing employment | 5% |
| `M2SL` | M2 money supply | 5% |
| `FEDFUNDS` | Fed Funds rate | 5% |

### Sector Performance by Phase (Fidelity/PIMCO Model)

| Phase | Outperform | Underperform |
|---|---|---|
| Recovery | XLY, XLF, XLI | XLU, XLP |
| Expansion | XLK, XLE, XLB | XLU, XLV |
| Late Cycle | XLE, XLB, XLV | XLF, XLY |
| Contraction | XLV, XLP, XLU | XLK, XLF |

### New Files

| File | Purpose |
|---|---|
| `lib/macro/businessCycle.ts` | Master composite: `computeBusinessCycleScore()` returns `BusinessCycleState` |
| `lib/macro/yieldCurve.ts` | Slope classifier + NY Fed recession-probability model |
| `lib/macro/creditCycle.ts` | HY/IG OAS z-score regime classifier |
| `lib/macro/fedPolicy.ts` | Fed stance classifier (cutting / on_hold / hiking / aggressive) |
| `lib/macro/recessionProbability.ts` | Estrella-Mishkin probit model |
| `app/api/macro/cycle/route.ts` | API: current cycle state + sector rec |

### Files to Extend

| File | Change |
|---|---|
| `lib/quant/researchScore.ts` | Add 6th pillar: Macro Regime (10% weight), penalize stocks in late-cycle/contraction phases |
| `lib/quant/sectorRotation.ts` | Integrate cycle phase into sector signal boosts |

### Verification
```bash
npm run verify:macro:cycle   # Engine must signal recession 6–12mo before NBER dates (1990–2024)
npm run test -- businessCycle
```

---

## 5. Phase 10 — Advanced Valuation Suite

### Objective
Move beyond single-DCF to a probability-weighted multi-model valuation framework with business-cycle adjustment. Matches how Bernstein, Goldman Sachs, and Morgan Stanley build valuation models.

### Valuation Models

| Model | File | Notes |
|---|---|---|
| **CAPE (Shiller)** | `lib/quant/cape.ts` | 10Y inflation-adjusted earnings normalization, uses FRED `CPIAUCSL` |
| **Reverse DCF** | `lib/quant/reverseDcf.ts` | Newton-Raphson solver for implied growth rate from current price |
| **EV/EBITDA Cycle-Adj** | `lib/quant/evValuation.ts` | Current vs 10Y sector average |
| **DDM (Gordon + multi-stage)** | `lib/quant/ddm.ts` | For dividend payers |
| **Earnings Power Value** | `lib/quant/epv.ts` | Normalized earnings / WACC (no-growth baseline) |
| **ROIC/WACC Spread (EVA)** | `lib/quant/economicProfit.ts` | Economic profit tracker — moat quality proxy |
| **P/FCF Yield** | Extend `lib/quant/buildFundamentalsPayload.ts` | FCF yield vs 10Y treasury |

### Synthesis
`lib/quant/valuationSynthesis.ts` — probability-weighted fair value range:
- `bear` = 10th percentile of model outputs
- `base` = median weighted by model confidence
- `bull` = 90th percentile
- `cyclicalAdjustment` = ±15% based on business cycle phase (Phase 9)
- `marginOfSafety`: price < fairValue × 0.75 → strong buy

### Verification
```bash
# Backtest: stocks w/ margin of safety → superior 5Y returns
npm run backtest:valuation
# Verify models return correct sign (undervalued 2009/2020; overvalued 1999/2021)
npm run test -- valuationSuite
```

---

## 6. Phase 11 — Options Market Microstructure 2.0

### Objective
Build an institutional-grade options analysis engine that models dealer positioning, vol surface dynamics, and generates **specific sell-put/sell-call strike recommendations**.

### Components

**1. Volatility Surface** (`lib/options/volSurface.ts`)
- Reconstruct IV surface across strikes × expiries
- 25-delta put/call skew
- Vol term structure (1M / 3M / 6M — contango/backwardation)
- IV rank: `(IV - 52w_low) / (52w_high - 52w_low)`
- VIX futures term structure (CBOE M1/M2/M3)

**2. Dealer Gamma Exposure** (extend `lib/quant/optionsGamma.ts`)
- `computeDealerGEX()` — net dealer position across all strikes × OI × gamma
- Short gamma → price amplification (trending market)
- Long gamma → price dampening (mean-reversion regime)
- Gamma flip level

**3. Pin Risk** (extend `lib/quant/optionsGamma.ts`)
- `calcPinProbability(chain, dte)` — MM hedging toward max-pain strike

**4. Vol Regime Classifier** (`lib/options/volRegime.ts`)
- Levels: calm <15, normal 15–20, elevated 20–30, stress 30–40, panic >40
- Term-structure slope (contango = sell vol, backwardation = buy vol)
- VVIX check — high vol of vol → avoid vol selling

**5. Flow Classification** (`lib/options/flowClassification.ts`)
- Retail (small OTM) vs institutional (multi-leg, precision strikes)
- Whales: >$500K premium orders, >3× avg-OI volume, 20–45 DTE

**6. Strike Recommendation Engine** (`lib/options/strikeRecommendation.ts`) — **KEY DELIVERABLE**

```typescript
interface StrikeRecommendation {
  sellPut: {
    strike: number; expiry: string; premium: number
    probabilityOfProfit: number; deltaAtEntry: number
    rationale: string[]  // ["Below put wall @X", "30% OTM from gamma flip"]
    riskMetrics: { maxLoss: number; breakeven: number; annualizedReturn: number }
  }
  sellCall: { /* same structure */ }
  ironCondor?: { putStrike; callStrike; netPremium; maxProfit }
  marketContext: {
    businessCyclePhase: string     // from Phase 9
    volRegime: 'calm'|'normal'|'elevated'|'stress'|'panic'
    dealerPosture: 'long_gamma'|'short_gamma'
    expectedMovePercent: number    // options-implied
    ivRank: number
    recommendedAction: 'sell_vol'|'buy_vol'|'avoid'|'wait'
  }
}
```

**Recommendation logic:**
- Put strike = max(putWall, technical support)
- Call strike = min(callWall, technical resistance)
- Only recommend when: IV rank > 50%, not panic regime, dealer in long gamma, no earnings in period
- Kelly-fraction position sizing attached

### API
- `app/api/options/recommend/[ticker]/route.ts` — full recommendation payload
- Extend `app/api/options/chain/[ticker]/route.ts` with surface + recommendation

### Verification
```bash
npm run backtest:options:sellput     # ≥75% of trades must expire worthless
npm run test -- strikeRecommendation
```

---

## 7. Phase 12 — Institutional Accumulation Detection

### Objective
Reverse-engineer how smart money builds positions — the "how Wall Street plays the game" layer.

### Components

**1. 13F Analysis** (`lib/institutional/filingAnalysis.ts`)
- SEC EDGAR `https://data.sec.gov/submissions/CIK{cid}.json` — no key
- Quarterly holdings: new/additions/reductions/eliminations
- Flag high-conviction buys (>5% new allocation)
- Top-20 fund consensus scoring

**2. COT Analysis** (`lib/institutional/cotAnalysis.ts`)
- CFTC weekly: commercial (smart money) vs non-commercial (speculators)
- Extreme positioning → mean-reversion signal
- Covers: /ES, /NQ, /CL, /GC, /ZB

**3. Accumulation/Distribution Patterns** (extend `lib/quant/marketMakerAnalysis.ts`)
- `detectAccumulationPhase()` — Wyckoff A-E phases
- Volume Spread Analysis (effort vs result)
- Dark-pool + consolidation correlation

**4. Options Whales** (`lib/institutional/whaleDetection.ts`)
- Single orders >$500K premium, no news catalyst
- Vol >3× 30d avg OI for a strike
- Institutional DTE preference: 20–45 days

**5. Market Manipulation Game Theory** (`lib/institutional/gameTheory.ts`)
- Stop hunting (price pushed below support → reversal)
- Gamma pinning (price held near max pain at expiry)
- Vol compression before moves (smart money quietly buys vol)
- Tape painting at close
- Dark-pool accumulation in narrow range → breakout imminent

### Files to Extend
- `lib/quant/marketMakerAnalysis.ts` — add `detectAccumulationPhase()`, `detectStopHunt()`
- `lib/quant/researchScore.ts` — add 7th pillar: **Institutional Conviction**

### APIs
- `app/api/institutional/[ticker]/route.ts`
- `app/api/cot/[commodity]/route.ts`

### Verification
```bash
npm run backtest:institutional   # >60% of high-conviction 13F buys must outperform SPY over 12mo
npm run test -- institutionalAnalysis
```

---

## 8. Phase 13 — 30-Year Backtesting with Regime Attribution

### Objective
Validate every algorithm across multiple complete business cycles (1994–2024 minimum). Covers dot-com, GFC, COVID, rate hiking cycles.

### New Files

| File | Purpose |
|---|---|
| `lib/backtest/longTermEngine.ts` | 30Y engine with cycle tagging per trade |
| `lib/backtest/regimeAttribution.ts` | Return attribution by cycle phase, sector, factor |
| `lib/backtest/monteCarlo.ts` | 1,000-path bootstrap path simulation + confidence intervals |
| `lib/backtest/stressScenarios.ts` | Crisis replay: 2000 (-49%), 2008 (-56%), 2020 (-34%) |
| `scripts/runLongBacktest.ts` | CLI: full 30Y backtest across all instruments |

### Performance Targets by Phase

| Phase | Min Win Rate | Min Sharpe |
|---|---|---|
| Recovery | 60% | 1.2 |
| Expansion | 58% | 1.0 |
| Late Cycle | 55% | 0.8 |
| Contraction | 52% | 0.5 |
| Recession | 50% | 0.3 (capital preservation priority) |

### Verification
```bash
npm run backtest:30y            # Full 30Y run (10–30min)
npm run backtest:stress         # Historical crisis replays
npm run backtest:montecarlo     # 1000-path Monte Carlo
```

---

## 9. Phase 14 — OPUS-Orchestrated Self-Optimizing Feedback Loop

### Objective
Continuous nightly improvement: OPUS analyzes all metrics, identifies the weakest signal, delegates a specific improvement to Sonnet, Haiku validates, OPUS commits or discards.

### Architecture

```
┌───────────────────────────────────────────────┐
│           OPUS ORCHESTRATOR                    │
│           (claude-opus-4-7)                    │
│                                                │
│  1. GATHER  → collect all perf metrics         │
│  2. ANALYZE → identify weakest regime/signal   │
│  3. HYPOTHESIZE → propose improvement          │
│  4. DELEGATE → write Sonnet task spec          │
│  5. VALIDATE → review Sonnet output            │
│  6. COMMIT → accept or reject                  │
│  7. UPDATE → log what worked / failed          │
│  8. REPEAT → until all targets met             │
└───────────────────────────────────────────────┘
         │                       │
    ┌────▼─────────┐      ┌──────▼───────┐
    │   SONNET     │      │    HAIKU     │
    │ (implement)  │      │  (validate)  │
    └──────────────┘      └──────────────┘
```

### Nightly Cycle
1. **Haiku** collects metrics (win rates by regime from SQLite, 30-day live accuracy, valuation errors, options POP)
2. **OPUS** analyzes + hypothesizes, e.g.:
   > "Contraction win rate is 48% (<50% target). Yield-curve shows stable inversion. Hypothesis: RSI thresholds should tighten in high-vol regimes. Task for Sonnet: modify `lib/backtest/signals.ts:145-167` to..."
3. **Sonnet** implements the spec (TypeScript strict, runs `npm run benchmark + test`)
4. **Haiku** validates (metric improved? no regression? types clean?)
5. **OPUS** commits or discards

### New Files

| File | Purpose |
|---|---|
| `lib/ai/opusOrchestrator.ts` | Loop orchestrator (Anthropic SDK) |
| `lib/ai/performanceCollector.ts` | Unified metrics snapshot |
| `lib/ai/hypothesisEngine.ts` | OPUS prompt templates |
| `lib/ai/improvementLog.ts` | Change history tracker |
| `scripts/runFeedbackLoop.ts` | CLI entry point |
| `app/api/opus/status/route.ts` | Current loop state + improvement history |

### Verification
```bash
npm run opus:loop:dry-run    # Simulate one cycle without committing
npm run opus:status          # View current perf vs targets
npm run opus:loop            # Full cycle (15–30 min)
```

---

## 10. Phase 15 — Institutional-Grade Output Layer

### Objective
Produce output matching what a Goldman Sachs equity research desk, Warren Buffet's team, or a hedge fund PM would see.

### Warren Buffet Intrinsic Value Assessment

```typescript
interface IntrinsicValueAssessment {
  moatScore: {
    total: number
    networkEffect: number      // MSFT, GOOG, META
    costAdvantage: number      // WMT, AMZN
    switchingCosts: number     // AAPL ecosystem, ADBE subs
    intangibleAssets: number   // brands, patents, licenses
    efficientScale: number     // natural monopolies
  }
  intrinsicValue: {
    bear: number; base: number; bull: number
    methodsUsed: string[]
    cycleAdjustment: string
    marginOfSafety: number
  }
  competitiveAdvantagePeriod: number  // years
  capitalAllocation: {
    score: number
    roicVsWacc: number
    returnOnRetainedEarnings: number
    buybackQuality: 'accretive'|'dilutive'
  }
  verdict: {
    action: 'strong_buy'|'buy'|'hold'|'sell'|'avoid'
    timeHorizon: '6M'|'1Y'|'3Y'|'5Y+'
    entryZone: { lower: number; upper: number }
    targetPrice: number
    stopLoss: number
    reasoning: string[]  // 3–5 Buffet-style sentences
  }
}
```

### New Files

| File | Purpose |
|---|---|
| `lib/quant/moatScore.ts` | Buffet moat scoring |
| `lib/quant/intrinsicValue.ts` | Multi-model value synthesis |
| `lib/quant/druckenmillerFramework.ts` | Macro overlay + conviction sizing ("earnings don't move the market; the Fed does") |
| `lib/report/researchReport.ts` | OPUS-written institutional research reports |
| `app/api/report/[ticker]/route.ts` | Report API |
| `app/report/[ticker]/page.tsx` | Report UI |

---

## 11. Phase 16 — Verification, Testing & Inspection

### Objective
Continuous QA system that catches regressions, validates mathematical accuracy, maintains institutional-grade reliability. Runs in **parallel** with all other phases.

### Test Suite Structure
```
__tests__/
├── macro/
│   ├── businessCycle.test.ts        # Known FRED data → known phase
│   ├── yieldCurve.test.ts           # 2006–2007 → inversion before GFC
│   └── recessionProbability.test.ts
├── valuation/
│   ├── cape.test.ts                 # Matches Shiller public data
│   ├── reverseDcf.test.ts           # Newton-Raphson convergence
│   └── valuationSynthesis.test.ts
├── options/
│   ├── volSurface.test.ts
│   ├── strikeRecommendation.test.ts
│   └── pinRisk.test.ts
├── institutional/
│   ├── filingAnalysis.test.ts
│   └── cotAnalysis.test.ts
└── backtest/
    ├── longTermEngine.test.ts
    ├── regimeAttribution.test.ts
    └── monteCarlo.test.ts
```

### Infrastructure

| File | Purpose |
|---|---|
| `lib/verification/regressionDetector.ts` | Benchmark vs baseline; alert >2% regime win-rate drop |
| `lib/verification/mathVerifier.ts` | Cross-check vs academic reference values (QuantLib, Shiller, NY Fed) |

### Performance Monitoring Dashboard
Extend `app/monitor/page.tsx`:
- Business cycle gauge (phase + confidence)
- Options recommendation accuracy tracker (last 90 days)
- Feedback loop status (last run, changes, trend)
- Regime-breakdown win rates (live)

---

## 12. Implementation Order

```
Phase 8  → Data Infrastructure         BLOCKS everything else
Phase 9  → Business Cycle Engine       parallel with 10, 11
Phase 10 → Advanced Valuation          INDEPENDENT
Phase 11 → Options Microstructure 2.0  INDEPENDENT
Phase 12 → Institutional Analysis      needs Phase 8 (13F history)
Phase 13 → 30Y Backtesting             needs Phases 8 + 9
Phase 14 → OPUS Feedback Loop          needs Phase 13 metrics
Phase 15 → Institutional Output        needs Phases 10 + 11 + 12
Phase 16 → Verification System         PARALLEL throughout
```

**Parallelizable**: Phases 10, 11, 12, 16 can be executed simultaneously by separate agents.

---

## 13. Invariants — Never Break

1. **Benchmark guard**: `npm run benchmark` must show ≥55% win rate after every change
2. **No paid APIs in core**: Yahoo primary; Polygon/AV optional via env vars
3. **TypeScript strict**: `tsc --noEmit` must pass; no `any` in quant modules
4. **Next-day execution**: signals at close, execute at next open — no lookahead bias
5. **Transaction costs**: 11 bps per side (22 bps round-trip) maintained
6. **SQLite**: Node 22.5+ built-in `node:sqlite` only; no `better-sqlite3`
7. **Data verification**: all novel analytics annotated via `createVerification()` from `lib/research/dataVerification.ts`
8. **Update `AGENTS.md`** when a phase completes

---

## 14. End State

When complete, the system will:
1. **Name** the current business cycle phase (>80% accuracy, 6–12mo before NBER)
2. **Show** probability-weighted fair-value range from 6+ cycle-adjusted valuation models
3. **Recommend** exact sell-put / sell-call strikes with POP, premium, Kelly sizing
4. **Detect** institutional smart-money accumulation before price moves
5. **Generate** Buffet-style research reports: moat, intrinsic value, margin of safety, verdict
6. **Backtest** every signal across 30 years and 5 complete business cycles
7. **Self-improve** nightly via OPUS — finding and fixing the weakest signal
8. **Explain** Wall Street dealer positioning (long/short gamma) and price-action implications

This is software that reads how the market is being played — it doesn't just react to price.

---

## 15. Quick Reference for Executing Agents

**When starting a new task in this plan:**
1. Read this file (`docs/MASTER_PLAN_PHASES_8_16.md`) end-to-end
2. Read `AGENTS.md` for project state + constraints
3. Read `memory/project_quantan_architecture.md` for file map
4. Check the current phase status in `AGENTS.md` phase table
5. Before writing code, verify no one else is working on the same phase (check recent commits)
6. After writing code: `npm run test:types && npm run benchmark && npm run test`
7. Update phase status in `AGENTS.md` when done
8. Commit with descriptive message

**Performance metrics baseline (as of 2026-04-19):**
- 56 instruments, 56.35% win rate (hard floor 55%)
- ≥266 tests passing
- TypeScript clean

**Current phase:** Phase 8 — Data Infrastructure 2.0
