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
| Q05 | `lib/backtest/regimeSignal.ts` | regime zone thresholds; uses sma200 SSOT | **done 2026-06-22 — VERIFIED CLEAN (no live bug).** sma200 SSOT (indicators.ts) finite/zero guards sound; the `dev==null` fail-closed guard catches bad price/SMA before any action; no look-ahead (historical `closes` slices only); thresholds internally consistent. Parity-safe cleanup (proven by signalParity): dropped 6 dead always-true `dev != null &&` checks (`dev` is narrowed to `number` past the early return) + fixed a wrong zone comment (`-10% to -5%` → `-10% to 0%`). +11 deterministic zone-boundary & invariant tests (flat→dips-not-buyable, rising→buyable; BUY⇒slopePositive, SELL⟺FALLING_KNIFE, conf∈[0,100]). PR #66 → main `ac4ce09`, prod deploy READY. SAFE → auto-merged. |
| Q06 | `lib/backtest/executionModel.ts` | F-9 entry-slippage double-count vs 22bps SSOT; cost model | **done 2026-06-22 — SSOT VERIFIED CLEAN** (pure, correct per-side/round-trip math, engine-parity-tested). **F-9 CONFIRMED REAL but ESCALATED** (ledger `F-9`; changes published numbers → owner re-baseline): engine entry pays BOTH a 2bps `ENTRY_SLIPPAGE_BPS` price bump AND an 11bps/side `txCost` that already includes a 2bps slippage component → 2bps double-counted at entry (~13bps vs 11bps SSOT; round-trip ~24 vs 22); exit clean. SAFE shipped: +2 custom-config tests (config path was untested) + a parity-safe F-9 doc-comment in core.ts (signalParity 2/2). PR #67 → main `0c138fc`, prod ✓. SAFE → auto-merged. |
| Q07 | `lib/backtest/exitRules.ts` | F-3 trailing-stop intra-bar look-ahead + non-ratcheting peak; F-11 maxHoldDays union-calendar vs trading days | **done 2026-06-22 — exitRules.ts VERIFIED CLEAN (no fix; 50 existing tests incl. property invariants + F1.3 intraday + gap fills).** Live path (core.ts) uses only the clean `evaluateStopHit` primitive, NOT the checkExitConditions/maxHoldDays machinery. Both seeded findings are CALLER-SIDE in `portfolioBacktest.ts`, which is in NO API route + NO CI gate (dev script only → not published). **Escalated** (ledger): **F-11** real bug — `holdDays = currentIdx − entryIdx` fed union-calendar indices (portfolioBacktest:151/316/464) → maxHold counts union slots not the instrument's trading days; **F-3** methodology note — `updatePosition` ratchets `highestPrice` on close (`row.close`), not intra-bar high (arguably deliberate; no same-bar look-ahead since checkExit gets the pre-update pos). Both owner-gated (dormant engine, no validating gate). No code change. |
| Q08 | `lib/backtest/benchmarkLabel.ts` | label parity with resolveBacktestSignal (signalParity test) | **done 2026-06-22 — parity-correct + SAFE fix.** Calls the same resolveBacktestSignal SSOT (signalParity guards it). **Latent bug FIXED:** exitPrice was unguarded (only entryPrice was) → a non-finite/≤0 exit close makes grossReturn NaN, which slips the caller's `==null` filter (NaN!=null) → counted as a LOSS + poisons avgReturn20d. Added the symmetric exit guard. **Benchmark-NEUTRAL (proven):** scanned all 56 backtestData files / 70,796 rows → 0 non-finite/≤0 closes → guard skips nothing today → CI benchmark WR unchanged. +benchmarkLabel.test.ts (corrupt-exit through the real AAPL BUY path). PR #68 → main `4e801b8`, prod ✓. SAFE → auto-merged. |
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

- 2026-06-22 — Q08 `benchmarkLabel.ts`: parity-correct; SAFE fix — added the missing exitPrice fail-closed guard (corrupt exit close was counted as a NaN loss). Benchmark-NEUTRAL (proven: 0 bad closes in 70,796 rows). +benchmarkLabel.test.ts. PR #68 → main `4e801b8`, prod ✓. SAFE → auto-merge. Next cell: **Q09** `liveSignal.ts`.
- 2026-06-22 — Q07 `exitRules.ts`: VERIFIED CLEAN (no fix; 50 existing tests, live path uses only `evaluateStopHit`). F-3 + F-11 are caller-side in `portfolioBacktest.ts` (dormant — no API route / no CI gate). ESCALATED to ledger: F-11 union-calendar holdDays (real bug, dormant); F-3 close-not-high peak ratchet (methodology, arguably deliberate). No code change → tracking-only. Next cell: **Q08** `benchmarkLabel.ts`.
- 2026-06-22 — Q06 `executionModel.ts`: cost SSOT VERIFIED CLEAN. F-9 entry-slippage double-count CONFIRMED REAL (entry ~13bps vs 11bps SSOT) but ESCALATED to ledger (changes published numbers → owner re-baseline). SAFE shipped: +2 custom-config tests + parity-safe F-9 doc-comment in core.ts. PR #67 → main `0c138fc`, prod ✓. SAFE → auto-merge. Next cell: **Q07** `exitRules.ts`.
- 2026-06-22 — Q05 `regimeSignal.ts`: VERIFIED CLEAN + parity-safe cleanup (dropped 6 dead `dev != null &&` guards, fixed a wrong zone comment) + 11 deterministic/invariant tests. PR #66 → main `ac4ce09`, prod deploy READY. SAFE → auto-merge. Next cell: **Q06** `executionModel.ts`. _(Manual Opus-4.8 run — recovered the queue after the 09:08 scheduled fires 400-failed on the now-disabled Fable 5 model every day since 06-16; root-cause fix = owner re-points the schedule model to Opus.)_
- 2026-06-15 — Q04 `signalHelpers.ts`/`signalTypes.ts`: detectVolumeClimax corrupt-bar guard FIXED (+new test file); types clean. SAFE → auto-merge. Next cell: **Q05** `regimeSignal.ts`.
- 2026-06-15 — Q03 `signals.ts`: VERIFIED CLEAN (no code change; heavily hardened, well-tested). Next cell: **Q04** `signalHelpers.ts`/`signalTypes.ts`.
- 2026-06-15 — Q02 `core.ts`: corrupt-next-open NaN guard FIXED (PR auto/wsq-q02-core-2026-06-15, SAFE → auto-merge); +5 invariant tests. F-4/F-8 escalated. Next cell: **Q03** `signals.ts`.
- 2026-06-15 — Q01 `engine.ts`: profit-factor display crash FIXED (PR auto/wsq-q01-engine-2026-06-15, SAFE → auto-merge). 3 escalations logged. Next cell: **Q02** `core.ts`.
- 2026-06-15 — queue seeded (claude opus-4.8, consolidation session). First run picks **Q01**.
