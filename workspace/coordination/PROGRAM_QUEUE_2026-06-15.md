# QUANTAN Autonomous Program — Cell Queue / Coverage Ledger (seeded 2026-06-15)

SSOT for the daily routine's work queue. Driven by
`workspace/AUTONOMOUS_PROGRAM_2026-06-15.md`. Each **cell** = one module/algorithm +
its tests + a perf profile. The daily run picks the next `pending` cell in WS order
(WS-Q fully before WS-PY, etc.); the Monday deep-sweep day is cross-cutting (no cell).

**Status values:** `pending` · `in_progress` · `done` · `partial` · `blocked`.
Update the row after each run: status, date, findings/PR, perf delta.

> Seeded "watch" notes carry forward known P2/P3 findings from
> `reviews/full-review-2026-06-10/` so the routine investigates them at the right cell.

---

## WS-Q — Quant & algorithm correctness (LEAD)

| # | Cell | Watch / known findings to check | Status |
|---|------|---------------------------------|--------|
| Q01 | `lib/backtest/engine.ts` | portfolio aggregation (live `/api/backtest`); F-8 T+1 MTM booked one bar early; common-window alignment | **done 2026-06-15** — fixed profit-factor Infinity→null render crash (see daily report); F-1/F-1a confirmed present; perf single-pass OK. **Escalated:** F-4 gross-WR (owner), profitFactor type `number` emits `null` (contract), unused `initialCapital` param. F-8 → Q02 (core.ts). |
| Q02 | `lib/backtest/core.ts` | F-4 per-trade WR gross-of-cost (DENY auto-merge → escalate); equity-curve stub <252 (already F-1 fixed, confirm) | **done 2026-06-15** — fixed corrupt-next-open NaN-injection guard (+5 invariant tests); <252 stub confirmed; T+1/slippage/MTM logic sound. **Escalated:** F-4 gross WR, F-8 T+1 MTM one bar early (both change published numbers). |
| Q03 | `lib/backtest/signals.ts` | signal core; SSOT import block; no look-ahead | **done 2026-06-15 — VERIFIED CLEAN (no fix).** All ensemble scores clamped to [-1,1] with finite-guards (Phase-13 audit); no look-ahead (caller passes lookback slices); SSOT import block correct; enhanced path research-only (off in prod via featureFlags). Covered by signals.test + signalParity. |
| Q04 | `lib/backtest/signalHelpers.ts` + `signalTypes.ts` | post-F-6 SSOT; confirm parity | **done 2026-06-15** — fixed detectVolumeClimax corrupt-bar guard (+new test file, 5 cases, closes coverage gap). signalTypes.ts pure types — clean. F-6 re-export confirmed. SAFE → auto-merge. |
| Q05 | `lib/backtest/regimeSignal.ts` | regime zone thresholds; uses sma200 SSOT | pending |
| Q06 | `lib/backtest/executionModel.ts` | F-9 entry-slippage double-count vs 22bps SSOT; cost model | pending |
| Q07 | `lib/backtest/exitRules.ts` | F-3 trailing-stop intra-bar look-ahead + non-ratcheting peak; F-11 maxHoldDays union-calendar vs trading days | pending |
| Q08 | `lib/backtest/benchmarkLabel.ts` | label parity with resolveBacktestSignal (signalParity test) | pending |
| Q09 | `lib/backtest/liveSignal.ts` | live path vs backtest path consistency | pending |
| Q10 | `lib/backtest/portfolioBacktest.ts` | F-2 alpha mismatched windows after common-window fix; sectorGates wiring | pending |
| Q11 | `lib/backtest/walkForward.ts` | F-12 hardcoded 252 / rf-252 for BTC; OOS non-zero | pending |
| Q12 | `lib/backtest/dataLoader.ts` | non-finite OHLC sanitize; NaN time | pending |
| Q13 | `lib/optimize/gridSearch.ts` | survivorship + OOS-selection bias; inert grid dims (3/5) | pending |
| Q14 | `lib/optimize/parameterSets.ts` + `sectorProfiles.ts` | parameter ranges; macro gate fields | pending |
| Q15 | `lib/quant/indicators.ts` | SSOT primitives (sma/ema/rsi/macd/atr/bollinger + sma200* added F-6); EMA seeding | pending |
| Q16 | `lib/quant/technicals.ts` | thin adapters over indicators; ma200Regime | pending |
| Q17 | `lib/quant/volatility.ts` | Parkinson/realized vol; finite guards | pending |
| Q18 | `lib/quant/correlation.ts` + `intermarket.ts` | correlation math; NaN handling | pending |
| Q19 | `lib/quant/kelly.ts` | Kelly sizing (has property test); bounds | pending |
| Q20 | `lib/quant/regimeDetection.ts` + `regimeHmmClient.ts` | regime labels; HMM client fallback | pending |
| Q21 | `lib/quant/pivots.ts` + `priceBands.ts` + `volumeProfile.ts` | level math; off-by-one | pending |
| Q22 | `lib/quant/dcf.ts` + `researchScore.ts` + `buildFundamentalsPayload.ts` | valuation math | pending |
| Q23 | `lib/quant/multiTimeframe.ts` + `relativeStrength.ts` + `sectorRotation.ts` | RS vs benchmark; rotation scores | pending |
| Q24 | `lib/quant/riskFreeRate.ts` + `constants.ts` + `fundingConstants.ts` + `yahooSymbol.ts` | rf double-divide (prior false alarm — confirm); symbol mapping | pending |
| Q25 | `lib/quant/btc-indicators.ts` + `garchClient.ts` + `earningsParse.ts` + `frameworks.ts` + `chartQuoteFilter.ts` | MVRV/S2F; garch TS EWMA fallback | pending |
| Q26 | `quant_framework/garch.py` + `regime_hmm.py` | GARCH MLE (just fixed — confirm live); HMM | pending |
| Q27 | `quant_framework/backtest.py` + `strategy.py` + `analysis.py` + `data_engine.py` | offline framework parity | pending |

## WS-PY — Python / ML tier
| # | Cell | Watch | Status |
|---|------|-------|--------|
| PY1 | `server_trading_agents.py` + `trading_agents_runtime.py` + `trading_agents_env_guard.py` | just hardened (F-PY-12/13/14/15/16) — confirm | pending |
| PY2 | `server_options.py` | CORS, bridge, options math | pending |
| PY3 | `alpha_miner.py` | AST evaluator (Pow removed F-PY-01); safe_div registration F-PY-03 | pending |
| PY4 | `multi_agent_factor_mining/` | F-PY-04/05 no-op + boot crash (DENY feature-scope → escalate); F-PY-16 cache | pending |

## WS-A — API, security & operations
| # | Cell | Watch | Status |
|---|------|-------|--------|
| A1 | `app/api/backtest/*` + `lib/api/rateLimit.ts` | V-1 done; in-flight lock; cache headers | pending |
| A2 | `app/api/[analytics|sector-rotation|regime|conditional-vol]/*` | sanitizeError/rate-limit/normalizeTicker | pending |
| A3 | `app/api/[stream|prices|chart|darkpool|liquidations]/*` | SSE leak-safety; OKX/yahoo error sanitize | pending |
| A4 | `app/api/[trading-agents|ml|briefs|news|fundamentals|options]/*` | B-1 briefs id collision; B-2 unbounded TA params; allSettled | pending |
| A5 | `lib/data/providers/*` (alphavantage/polygon/fred/yahoo) | timeouts; B-3 finite-OHLC guard; polygon ns/ms | pending |
| A6 | `middleware.ts` + `lib/api/csrf.ts` + `sanitize.ts` + `auth.ts` | CSRF/CSP/headers; TICKER_REGEX; auth name regex | pending |

## WS-P — Performance & optimization (interleaved + weekly deep)
| # | Cell | Watch | Status |
|---|------|-------|--------|
| P1 | backtest engine + data load hot path | per-bar allocation; repeated SMA/EMA recompute | pending |
| P2 | signal compute (per-tick) | KL-6 every WS tick recomputes all 20 EMA series incl hidden | pending |
| P3 | chart render (`hooks/useKLineChart.ts`) | series churn; visibility gating | pending |
| P4 | bundle size / dynamic imports | code-split; PWA/workbox chain | pending |

## WS-F — Frontend/UX & accessibility
| # | Cell | Watch | Status |
|---|------|-------|--------|
| F1 | chart components (`KLineChart`, `useKLineChart`, BtcChartPanel) | KL-4 async init no .catch; KL-5 runtime showRSI | pending |
| F2 | `app/**` pages + error boundaries | blank-chart boundary coverage | pending |
| F3 | `components/**` data tables/panels | abort-race; nested-component re-render | pending |
| F4 | a11y sweep (aria-sort/expanded/tabpanel, live regions) | axe CI (`a11y-axe.yml`); F5.6/F6.7/F6.8 | pending |

---

## Run log (newest first)
_(the daily routine appends one line per run: date · cell · result · PR · merge/escalate)_

- 2026-06-15 — Q04 `signalHelpers.ts`/`signalTypes.ts`: detectVolumeClimax corrupt-bar guard FIXED (+new test file); types clean. SAFE → auto-merge. Next cell: **Q05** `regimeSignal.ts`.
- 2026-06-15 — Q03 `signals.ts`: VERIFIED CLEAN (no code change; heavily hardened, well-tested). Next cell: **Q04** `signalHelpers.ts`/`signalTypes.ts`.
- 2026-06-15 — Q02 `core.ts`: corrupt-next-open NaN guard FIXED (PR auto/wsq-q02-core-2026-06-15, SAFE → auto-merge); +5 invariant tests. F-4/F-8 escalated. Next cell: **Q03** `signals.ts`.
- 2026-06-15 — Q01 `engine.ts`: profit-factor display crash FIXED (PR auto/wsq-q01-engine-2026-06-15, SAFE → auto-merge). 3 escalations logged. Next cell: **Q02** `core.ts`.
- 2026-06-15 — queue seeded (claude opus-4.8, consolidation session). First run picks **Q01**.
