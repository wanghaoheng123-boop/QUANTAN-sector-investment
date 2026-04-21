---
name: QUANTAN Master Implementation Plan Summary — Phases 8–16
description: Condensed summary of the institutional-grade upgrade plan (Warren Buffet / Wall Street level) with OPUS AI self-optimizing feedback loop. Full detail in docs/MASTER_PLAN_PHASES_8_16.md
type: project
---

# QUANTAN Institutional-Grade Upgrade — Phase Summary

**Full detail:** `docs/MASTER_PLAN_PHASES_8_16.md`

**Why:** User wants a self-optimizing quantitative investment platform at the level of Warren Buffet's research team, Druckenmiller, Renaissance Technologies, and Wall Street institutional desks — understanding how smart money accumulates, reads options market structure, times entries across business cycles — with an OPUS-orchestrated feedback loop.

**How to apply:** Any agent picking up a Phase 8–16 task should start with `docs/MASTER_PLAN_PHASES_8_16.md` and `AGENTS.md`, then consult this file for the quick phase index.

---

## AI Model Hierarchy

| Role | Model | When to use |
|---|---|---|
| Brain / Orchestrator | `claude-opus-4-7` | Strategy, hypothesis, meta-optimization, research synthesis, quality gates, report prose |
| Executor | `claude-sonnet-4-6` | Code generation, algorithm implementation, complex analysis |
| Fast Processor | `claude-haiku-4-5` | Data pipelines, batch processing, quick validation checks, real-time signals |

---

## Phase Index

| # | Name | Status | Key Deliverables |
|---|---|---|---|
| 8 | Data Infrastructure 2.0 | PENDING | Stooq/CBOE/NBER/EDGAR/CFTC providers; 30Y OHLCV warehouse; FRED macro series |
| 9 | Business Cycle Engine | PENDING | `lib/macro/businessCycle.ts`, yieldCurve, creditCycle, fedPolicy, recessionProbability, macro API |
| 10 | Advanced Valuation Suite | PENDING | CAPE, reverseDCF, EV/EBITDA cycle-adj, DDM, EPV, ROIC/WACC spread, valuationSynthesis |
| 11 | Options Microstructure 2.0 | PENDING | volSurface, volRegime, flowClassification, **strikeRecommendation engine** |
| 12 | Institutional Accumulation | PENDING | 13F, COT, whale detection, accumulation patterns, gameTheory |
| 13 | 30-Year Backtesting | PENDING | longTermEngine, regimeAttribution, monteCarlo, stressScenarios |
| 14 | OPUS Feedback Loop | PENDING | opusOrchestrator, performanceCollector, hypothesisEngine, improvementLog |
| 15 | Institutional Output | PENDING | moatScore, intrinsicValue, druckenmillerFramework, researchReport |
| 16 | Verification System | RUNNING | regressionDetector, mathVerifier, expanded test suite |

---

## Institutional-Grade Targets (Loop runs until ALL met)

| Metric | Target |
|---|---|
| Overall win rate | ≥ 62% |
| 30Y Sharpe | ≥ 1.5 |
| 30Y Sortino | ≥ 2.0 |
| Max drawdown | ≤ 20% |
| Valuation accuracy (within ±15% of 12M actual) | ≥ 70% |
| Options POP | ≥ 75% |
| Recession signal lead time | ≥ 6mo before NBER |
| Institutional accumulation 12M forward alpha vs SPY | ≥ 8% |

---

## Dependency Graph

```
Phase 8  → BLOCKS everything
Phase 9  ⇆ 10, 11 (parallelizable after 8)
Phase 10 INDEPENDENT
Phase 11 INDEPENDENT
Phase 12 needs 8
Phase 13 needs 8 + 9
Phase 14 needs 13
Phase 15 needs 10 + 11 + 12
Phase 16 PARALLEL throughout
```

---

## Free Data Sources Used

| Source | Data | Period |
|---|---|---|
| Stooq.com | Daily OHLCV | 30+ years |
| FRED API | 800+ macro series | 1950+ |
| CBOE | VIX history, vol surface | 1990+ |
| NBER | Recession dates | 1854+ |
| SEC EDGAR | 13F filings | 1993+ |
| CFTC | COT reports | 1986+ |
| Yahoo Finance | Quotes, options, fundamentals | Current |

---

## Invariants

1. `npm run benchmark` ≥55% win rate after every code change
2. No paid APIs in core code
3. `tsc --noEmit` passes, no `any` in quant modules
4. Next-day execution (no lookahead)
5. 11bps per side transaction costs
6. SQLite via Node 22.5+ built-in only
7. All novel analytics annotated via `createVerification()`
8. Update `AGENTS.md` when phase completes
