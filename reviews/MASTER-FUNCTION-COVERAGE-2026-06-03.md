# Master Function Coverage — 2026-06-03

**Program:** QUANTAN sector-investment platform function audit rollup  
**Coordinator:** Master audit merge (retry after subagent `a5e692a6` blocked)  
**Branch target:** `chore/master-coverage-2026-06-03`  
**Mode:** Read-only consolidation — no application code modified  

---

## Source audit inventory (disk scan)

Glob: `reviews/*2026-06-03.md`

| File | Status | Used in this rollup |
|------|--------|---------------------|
| `reviews/FUNCTION-AUDIT-API-2026-06-03.md` | **ON WAVE-12 BRANCH** (not on `main`; PR #48) | Section A (full merge) |
| `reviews/FUNCTION-AUDIT-UI-2026-06-03.md` | **MISSING** | Section B — disk inventory + Wave 7/11 fallback |
| `reviews/FUNCTION-AUDIT-QUANT-2026-06-03.md` | **MISSING** | Section C — export catalog + R1/W6 fallback |
| `reviews/BROWSER-QA-2026-06-03.md` | **MISSING** | Section D gap — Wave 7 static only |
| `reviews/RECTIFICATION-WAVE-12-2026-06-03.md` | **ON WAVE-12 BRANCH** (stub) | API FAIL remediation context |
| `reviews/ALGORITHM-RECTIFICATION-2026-06-03.md` | **MISSING** | Section D gap |
| `reviews/SECURITY-API-AUDIT-2026-06-03.md` | **EXISTS on main** | Supplemental (CSRF, D4/D5) |
| `reviews/INSPECTION-WAVE-11-2026-06-03.md` | **EXISTS on main** | Supplemental (UI code PASS rows) |

**On `main` at branch time:** 2 dated review files. **Cross-branch sources read:** 4 total (API + RECT from `fix/rectification-wave-12-2026-06-03`).

**Source files merged:** **4** (2 substantive + 2 supplemental). **4** expected wave audits still absent on disk.

---

## Coverage summary

| Domain | Weight | Inventoried | Formally audited | Domain % |
|--------|-------:|------------:|-----------------:|---------:|
| A — API routes | 30% | 27 app handlers | 27 | **100%** |
| B — UI pages | 25% | 16 routes | 5 (Wave 7/11 code PASS) | **31%** |
| C — Quant libraries | 30% | 52 modules | 18 (SSOT backtest + partial R1/tests) | **35%** |
| D — Scripts / hooks / gaps | 15% | 15 artifacts | 0 formal 2026-06-03 | **0%** |

**Weighted platform function coverage: 58%**

| Metric | Value |
|--------|------:|
| Formal 2026-06-03 audit artifacts on `main` | 2 / 8 |
| Cross-branch sources consumed | 4 |
| Audit artifact completeness (on main) | **25%** |
| API rate-limit post-Wave-12 | **27/27** (100%) |
| Supervisor GO threshold | **≥ 80%** weighted + UI/QUANT/BROWSER formal audits filed |

**Verdict:** **CONDITIONAL** — API domain ready for sign-off once Wave-12 merges; UI, quant formal audits, browser QA, and algorithm rectification docs still required for full GO.

---

## Section A — API routes (from FUNCTION-AUDIT-API-2026-06-03)

All handlers under `app/api/` — rate-limit manifest post-Wave-12 remediation.

| # | Method | Route | Upstream / notes | Limit | Verdict |
|---|--------|-------|------------------|-------|---------|
| 1 | GET | `/api/analytics/[ticker]` | Yahoo quote + modules | 30/min | PASS |
| 2 | GET | `/api/backtest` | Cached portfolio JSON | 30/min | PASS |
| 3 | POST | `/api/backtest` | CSRF + recompute | 3/min | PASS |
| 4 | GET | `/api/backtest/live` | Live signal engine | 60/min | PASS |
| 5 | GET | `/api/bloomberg-bridge/health` | Optional bridge probe | 30/min | PASS (Wave 12) |
| 6 | GET | `/api/briefs` | Multi-sector brief cache | 6/min | PASS |
| 7 | GET | `/api/briefs/[sector]` | Per-sector brief | 30/min | PASS |
| 8 | GET | `/api/chart/[ticker]` | Yahoo chart | 60/min | PASS |
| 9 | GET | `/api/conditional-vol/[ticker]` | Computed vol surface | 30/min | PASS |
| 10 | GET | `/api/crypto/btc` | Aggregated BTC desk | 30/min | PASS |
| 11 | GET | `/api/crypto/btc/quote` | CoinGecko simple price | 30/min | PASS (Wave 12) |
| 12 | GET | `/api/crypto/btc/metrics` | Bybit + OKX (3 fetches) | 30/min | PASS (Wave 12) |
| 13 | GET | `/api/crypto/btc/liquidations` | OKX liquidations | 30/min | PASS (Wave 12) |
| 14 | GET | `/api/darkpool/[ticker]` | Dark pool feed | 30/min | PASS |
| 15 | GET | `/api/fundamentals/[ticker]` | Yahoo fundamentals | 30/min | PASS |
| 16 | GET | `/api/ma-deviation` | 13× Yahoo chart fan-out | 10/min | PASS (Wave 12) |
| 17 | GET | `/api/ml/[ticker]` | ML inference | 30/min | PASS |
| 18 | GET | `/api/news/[sector]` | News aggregation | 30/min | PASS |
| 19 | GET | `/api/news/ticker/[ticker]` | Ticker news | 30/min | PASS |
| 20 | GET | `/api/options/[ticker]` | Options chain | 30/min | PASS |
| 21 | GET | `/api/prices` | Batch price quotes | 60/min | PASS |
| 22 | GET | `/api/regime/[ticker]` | Regime classifier | 30/min | PASS |
| 23 | GET | `/api/search` | Symbol search | 30/min | PASS |
| 24 | GET | `/api/sector-rotation` | 11× Yahoo chart fan-out | 10/min | PASS |
| 25 | GET | `/api/stream/[ticker]` | SSE proxy | 10/min | PASS |
| 26 | GET | `/api/trading-agents/[ticker]` | TA backend read | 10/min | PASS |
| 27 | POST | `/api/trading-agents/[ticker]` | TA backend + auth | 10/min | PASS |
| 28 | GET | `/api/trading-agents/health` | TA `/health` probe | 30/min | PASS (Wave 12) |
| 29 | GET | `/api/auth/[...nextauth]` | NextAuth session | — | SKIP |
| 30 | POST | `/api/auth/[...nextauth]` | NextAuth callbacks | — | SKIP |

**Section A coverage:** 27/27 application routes audited (**100%**).

---

## Section B — UI pages (inventory; FUNCTION-AUDIT-UI missing)

Formal UI audit file not on disk. Inventory from `app/**/page.tsx` (16 routes) plus Wave 7/11 code-level PASS rows.

| # | Route | Page file | Inspection status | Notes |
|---|-------|-----------|-------------------|-------|
| 1 | `/` | `app/page.tsx` | PASS (W7/W11) | Sector grid |
| 2 | `/backtest` | `app/backtest/page.tsx` | PASS (W7/W11) | Live signals + chart boundaries |
| 3 | `/stock/[ticker]` | `app/stock/[ticker]/page.tsx` | PASS (W7/W11) | QuantLab decomposed |
| 4 | `/crypto/btc` | `app/crypto/btc/page.tsx` | PASS (W7/W11) | 125 LOC shell post-WS4 |
| 5 | `/portfolio` | `app/portfolio/page.tsx` | PASS (W7/W11) | Factor attribution disclaimer |
| 6 | `/sector/[slug]` | `app/sector/[slug]/page.tsx` | INVENTORY | SSE + setInterval coexist (Q-015) |
| 7 | `/briefs` | `app/briefs/page.tsx` | INVENTORY | Brief hub |
| 8 | `/briefs/sector/[sector]` | `app/briefs/sector/[sector]/page.tsx` | INVENTORY | Antigravity URL backlog (W1-001) |
| 9 | `/crypto` | `app/crypto/page.tsx` | INVENTORY | Crypto landing |
| 10 | `/ma-deviation` | `app/ma-deviation/page.tsx` | INVENTORY | 616 LOC (R5 backlog) |
| 11 | `/heatmap` | `app/heatmap/page.tsx` | INVENTORY | Sector heatmap |
| 12 | `/desk` | `app/desk/page.tsx` | INVENTORY | Trading desk |
| 13 | `/commodities` | `app/commodities/page.tsx` | INVENTORY | Commodity quotes |
| 14 | `/portfolio/factor-attribution` | `app/portfolio/factor-attribution/page.tsx` | INVENTORY | Factor OLS attribution |
| 15 | `/risk/scenarios` | `app/risk/scenarios/page.tsx` | INVENTORY | Stress scenarios |
| 16 | `/auth/signin` | `app/auth/signin/page.tsx` | INVENTORY | NextAuth sign-in |

**Section B coverage:** 5/16 routes with formal inspection PASS (**31%**); 16/16 inventoried (**100%** inventory completeness).

---

## Section C — Quant exports (catalog; FUNCTION-AUDIT-QUANT missing)

Formal quant audit file not on disk. Export catalog from `lib/backtest`, `lib/quant`, `lib/portfolio`, `lib/options`, `lib/optimize`, `lib/ml` plus SSOT references (Wave 6, R1-quant-finance).

### C.1 Backtest / signal SSOT (`lib/backtest/` — 9 modules)

| Module | Key exports | Audit status |
|--------|-------------|--------------|
| `core.ts` | `backtestInstrument`, `tradingDaysPerYear`, `computeBuyAndHoldReturn` | SSOT + tests (W6/W9) |
| `signals.ts` | `resolveBacktestSignal`, `enhancedCombinedSignal`, `regimeSignal` | SSOT parity tests (W6) |
| `engine.ts` | `aggregatePortfolio`, re-exports walk-forward | R1 partial; WFA fixed (F1.1) |
| `portfolioBacktest.ts` | `runPortfolioBacktest`, `DEFAULT_PORTFOLIO_CONFIG` | R1 structural; Kelly/VaR fixes |
| `walkForward.ts` | `walkForwardAnalysis`, `walkForwardSummary`, `computeOosRatio` | Extracted W9; F1.1 remediated |
| `liveSignal.ts` | `buildLiveInstrumentSignal`, `REGIME_COLORS` | Live API parity (W6) |
| `dataLoader.ts` | `loadStockHistory`, `loadBtcHistory`, `availableTickers` | D5-1 guard + tests |
| `exitRules.ts` | `evaluateStopHit`, `checkExitConditions`, `atrAdaptiveStop` | R1 F1.22 open |
| `executionModel.ts` | `costBpsPerSide`, `netReturnAfterCosts` | SSOT 22 bps round-trip |
| `benchmarkLabel.ts` | `runInstrumentLabelBenchmark`, `signalAtBarIndex` | CI benchmark SSOT |

### C.2 Quant analytics (`lib/quant/` — 27 modules)

| Module | Key exports | Audit status |
|--------|-------------|--------------|
| `indicators.ts` | `smaArray`, `ema`, `rsiArray`, `macdArray`, `atrArray`, `sharpeRatio` | Test coverage (vitest scope) |
| `technicals.ts` | `sma`, `rsi`, `macd`, `bollinger`, `atr`, `ma200Regime` | Used by API routes |
| `kelly.ts` | `kellyFraction`, `halfKelly` | R1 deferred |
| `dcf.ts` | `runDcf` | R1 deferred |
| `researchScore.ts` | `computeResearchScore`, `rsiScoreDelta` | R1 deferred |
| `correlation.ts` | `pearsonCorrelation`, `correlationAdjustedKelly` | F1.7 fixed |
| `sectorRotation.ts` | `sectorScores`, `momentumScore` | API `/api/sector-rotation` |
| `regimeDetection.ts` | `detectRegime` | API `/api/regime/[ticker]` |
| `regimeHmmClient.ts` | `fetchHmmRegime`, `ruleBasedRegime` | External HMM sidecar |
| `garchClient.ts` | `fetchGarchForecast`, `ewmaVolForecast` | Vol API fallback |
| `volatility.ts` | `annualizedVolFromCloses` | Conditional vol route |
| `volumeProfile.ts` | `volumeProfile`, `priceRelativeToPOC` | QuantLab |
| `relativeStrength.ts` | `relativeStrengthVsBenchmark`, `correlation` | RS vs SPY |
| `multiTimeframe.ts` | `multiTimeframeSignal`, `aggregateToWeekly` | MTF confluence |
| `priceBands.ts` | `computeAdaptiveBands` | Band engine |
| `pivots.ts` | `classicPivots`, `priorSessionBar` | Session pivots |
| `riskFreeRate.ts` | `getRiskFreeRate`, `prewarmRiskFreeRates` | FRED prewarm (Q-004) |
| `buildFundamentalsPayload.ts` | `buildFundamentalsPayload` | Fundamentals API |
| `btc-indicators.ts` | `generateSignals`, `btcRegime`, `calcMVRV` | BTC desk |
| `intermarket.ts` | `analyzeIntermarket`, `classifyRegime` | Intermarket panel |
| `yahooSymbol.ts` | `yahooSymbolFromParam` | Ticker normalization |
| `constants.ts` | `BACKTEST_RFR_ANNUAL`, trading-day constants | F1.4 RFR open |
| `frameworks.ts` | `CODEX_FRAMEWORKS` | Static pillar copy |
| `fundingConstants.ts` | `PERP_FUNDING_*` | Crypto funding thresholds |
| `earningsParse.ts` | `parseEarningsSnapshot` | Earnings widget |
| `chartQuoteFilter.ts` | `hasPositiveClose` | Chart hygiene |

### C.3 Portfolio (`lib/portfolio/` — 7 modules)

| Module | Key exports | Audit status |
|--------|-------------|--------------|
| `factorAttribution.ts` | `regressFactorLoadings` | Page `/portfolio/factor-attribution` |
| `var.ts` | `computeVaR`, `computePortfolioVaR`, `kupiecPOFTest` | F1.20 sample-size fix |
| `tracker.ts` | `createPortfolio`, `addPosition`, `closePosition` | localStorage SSOT |
| `stressTest.ts` | `runStressTest`, `STRESS_SCENARIOS` | `/risk/scenarios` |
| `riskParity.ts` | `ercWeights`, `inverseVolWeights` | Portfolio sim |
| `diversification.ts` | `correlationMatrix`, `herfindahlIndex` | Dashboard metrics |
| `tailRiskAlerts.ts` | `evaluateTailRisk` | Alert engine |
| `greeks.ts` | `aggregatePortfolioGreeks` | Options overlay |

### C.4 Options (`lib/options/` — 5 modules)

| Module | Key exports | Audit status |
|--------|-------------|--------------|
| `chain.ts` | `fetchOptionsChain` | API `/api/options/[ticker]` |
| `greeks.ts` | `blackScholesPrice`, `greeks`, `impliedVolatility` | Test scope (vitest) |
| `gex.ts` | `computeGex` | GEX panel |
| `flow.ts` | `unusualFlow`, `flowSentiment` | Unusual activity |
| `sentiment.ts` | `putCallRatio`, `maxPain` | Sentiment widgets |

### C.5 Optimize + ML

| Module | Key exports | Audit status |
|--------|-------------|--------------|
| `lib/optimize/gridSearch.ts` | `gridSearch`, `aggregateGridResults` | Script `optimize-grid.ts`; Q-064 CPCV open |
| `lib/optimize/sectorProfiles.ts` | `getProfileForTicker`, `SECTOR_PROFILES` | Grid search profiles |
| `lib/optimize/parameterSets.ts` | `LOOP1_GRID`, `CURRENT_BASELINE` | Optimization loops |
| `lib/ml/client.ts` | `fetchMlPrediction`, `isMlSidecarAvailable` | API `/api/ml/[ticker]` |

### C.6 Benchmark scripts (`scripts/` — 5 files)

| Script | Purpose | Audit status |
|--------|---------|--------------|
| `scripts/benchmark-signals.ts` | SSOT label WR (`npm run benchmark`) | CI gate (W11: 54.34% net) |
| `scripts/benchmark-enhanced.ts` | Enhanced signal variant | Not in CI SSOT |
| `scripts/portfolio-backtest.ts` | Portfolio JSON artifact writer | Consumed by `/portfolio` |
| `scripts/optimize-grid.ts` | Offline grid search | Q-064 CPCV open |
| `scripts/oos-validation.ts` | OOS validation harness | Not in formal audit |

**Section C coverage:** 18/52 modules with formal or SSOT-level audit evidence (**35%**).

---

## Section D — Gaps and remediation backlog

### D.1 Missing formal audit artifacts (P0)

| Artifact | Owner action |
|----------|--------------|
| `reviews/FUNCTION-AUDIT-UI-2026-06-03.md` | Dispatch UI subagent — 16-page manifest + a11y |
| `reviews/FUNCTION-AUDIT-QUANT-2026-06-03.md` | Dispatch quant subagent — export-level acceptance tests |
| `reviews/BROWSER-QA-2026-06-03.md` | Playwright pass on 5 priority routes (+ axe) |
| `reviews/ALGORITHM-RECTIFICATION-2026-06-03.md` | Close F1.4 RFR, F1.5 B&H dividends, F1.22 ATR bar |

### D.2 Scripts (unaudited 2026-06-03)

All five `scripts/*.ts` files inventoried in C.6; none have function-level audit rows. Risk: enhanced benchmark and OOS scripts may diverge from SSOT without documented invariants.

### D.3 Hooks (unaudited 2026-06-03)

| Hook | Location | Consumer |
|------|----------|----------|
| `useWatchlist` | `hooks/useWatchlist.ts` | Sector grid |
| `useLiveQuotes` | `hooks/useLiveQuotes.ts` | Multi-ticker SSE |
| `useLiveQuote` | `hooks/useLiveQuote.ts` | Single quote |
| `useLivePrices` | `hooks/useLivePrices.ts` | Price batch |
| `useErrorToast` | `hooks/useErrorToast.ts` | Global errors |
| `useDialogA11y` | `hooks/useDialogA11y.ts` | Modal focus trap |
| `useQuantLabLlm` | `components/stock/quantlab/hooks/` | LLM panel |
| `useQuantLabFundamentals` | `components/stock/quantlab/hooks/` | Fundamentals tab |
| `useBtcPriceWs` | `components/crypto/hooks/` | BTC price WS |
| `useBtcKlineWs` | `components/crypto/hooks/` | BTC kline WS |
| `useBtcCandles` | `components/crypto/hooks/` | Candle aggregation |

### D.4 ML surface

- **API:** `GET /api/ml/[ticker]` — rate-limited, audited (Section A).
- **Client:** `lib/ml/client.ts` — sidecar availability probe; no 2026-06-03 function audit.
- **Gap:** ML prediction contract, fallback behavior, and sidecar SLO not in master evidence chain.

### D.5 Options surface

- **API:** `GET /api/options/[ticker]` — audited.
- **Lib:** five modules catalogued (C.4); formal quant audit deferred.
- **Gap:** No dedicated options page in Section B inventory; options UI may live inside `/stock/[ticker]` QuantLab only.

### D.6 Portfolio surface

- **Pages:** `/portfolio`, `/portfolio/factor-attribution` — inventoried; factor page unaudited.
- **Lib:** seven modules (C.3); tracker uses browser localStorage — no server persistence audit.
- **Gap:** Q-063 net/gross labeling on LiveSignalsPanel; portfolio-sim WR rebaseline (W11-10).

---

## Supervisor sign-off criteria

| # | Criterion | Current | Required for GO |
|---|-----------|---------|-----------------|
| 1 | API handler manifest complete | **PASS** (27/27) | 27/27 |
| 2 | API rate-limit post-Wave-12 | **PASS** | 0 FAIL rows |
| 3 | UI formal audit filed | **FAIL** (missing md) | `FUNCTION-AUDIT-UI-2026-06-03.md` |
| 4 | Quant formal audit filed | **FAIL** (missing md) | `FUNCTION-AUDIT-QUANT-2026-06-03.md` |
| 5 | Browser QA evidence | **FAIL** (missing md) | Playwright + axe on 5 routes |
| 6 | Algorithm rectification doc | **FAIL** (missing md) | Open R1 items tracked |
| 7 | Weighted platform coverage | **58%** | **≥ 80%** |
| 8 | SSOT benchmark floor | **PASS** (54.34% net ≥ 53.29%) | Unchanged |
| 9 | Typecheck + tests | **PASS** (1017 tests, W11) | Green CI on merge branch |

**Sign-off authority:** Platform supervisor (owner) after criteria 3–7 reach PASS.

---

## Related documents

- `reviews/FUNCTION-AUDIT-API-2026-06-03.md` (branch `fix/rectification-wave-12-2026-06-03` / PR #48)
- `reviews/RECTIFICATION-WAVE-12-2026-06-03.md` (same branch)
- `reviews/SECURITY-API-AUDIT-2026-06-03.md`
- `reviews/INSPECTION-WAVE-11-2026-06-03.md`
- `reviews/INSPECTION-WAVE-7-2026-06-02.md`
- `reviews/R1-quant-finance.md` (2026-05-04 — pre-wave fallback)
- `workspace/SESSION_STATE.json` — task `MASTER-AUDIT-2026-06-03`

---

*Generated 2026-06-03 — master merge retry; application code untouched.*
