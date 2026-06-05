# Master Inspection & Review — 2026-06-04

**Mode:** READ-ONLY inspection. **No application code or algorithms were modified.**
**Coordinator:** Claude Code (Opus 4.8) + 7 dispatched review agents + coordinator inline verifications.
**Trigger:** Owner request — inspect all work to date, focus on what Cursor shipped this week,
check every line of code + algorithms + structure, recommend optimizations. Do not touch code.

**Detailed per-domain findings live in `reviews/inspection-2026-06-04/`:**
`quant-algorithm.md` + `quant-algorithm-part2.md` · `api-backend.md` · `frontend-ui.md` ·
`structure-architecture.md` · `cursor-pr41-part2.md` · `test-coverage.md` ·
`coordinator-verifications.md` (hypothesis resolutions). This file is the prioritized rollup.

---

## 0. Coverage honesty (read this first)

Literal "every single line of 35k LOC" was **not** mechanically proven by any single agent.
What was actually done — risk-triaged deep reads:

| Domain | Depth achieved | Files read fully |
|---|---|---|
| Quant / algorithms (`lib/backtest`, `lib/quant`, `lib/portfolio`, `quant_framework`, `scripts`) | **~95%** — two agents, all critical math | ~30 |
| API routes (`app/api/**`, `middleware.ts`, `lib/api`) | **26/30 routes** (4 minor GETs sampled) | ~26 |
| Frontend (`app/**`, `components/**`, `hooks/**`) | God-files fully; rest skim+spot | ~40 |
| Structure / architecture (whole repo, madge graph) | **Whole-repo graph + 9 god-files** | graph + ~15 |
| Tests (`__tests__/**`, CI, stryker) | ~12 highest-value of 88 read fully | ~12 |
| Cursor PR #41 (commit `27186af`, 19 source files) | **100% of the diff** | 19 |
| Security (secrets, sidecar, auth) | Full scan + sidecar | scan + ~6 |

**Gap-closure pass (inline, `reviews/inspection-2026-06-04/gap-closure.md`) — now CLOSED:**
the 8 previously-pending API routes (all clean — confirms P0-B is the lone `sanitizeError`
bypass, 30/30 accounted for); the Python research trees (coherent offline/separate-service
tier, **not in the Vercel request path**, no subprocess bridge, **no hardcoded secrets**);
`src/` (a single stub file — non-issue); stryker scope + coverage-threshold mode confirmed.
**One new P1 surfaced** — escapable sandboxed `eval()` in offline research Python (P1-L below).

**Round 2 — "more issues" sweep (`reviews/inspection-2026-06-04/round2-deeper-sweep.md`):** the
full component tree (55 components verified + 26 new findings, `frontend-deep-sweep.md`) and the
entire data/provider layer (~4k LOC, `data-layer.md`) — both previously only skim/spot covered.
Plus `npm audit`, `next.config.js`/`middleware.ts` config, and source-verification of the
remaining Wave-1 frontend P0s. Net: 0 new P0, ~12 new P1, ~25 new P2, **2 agent false positives
withdrawn**, large verified-clean expansion.

**Still not exhaustively read** (low-risk remainder): ~50 lower-risk test files,
the offline `quant_framework`/`alpha_miner`/`options_*.py` internals beyond their security
surface (research code, not web-reachable).

---

## 1. What Cursor shipped this week — verdict: **ACCEPT-WITH-FOLLOWUP** ✅

Cursor's verified contribution is **PR #41 / commit `27186af`** (merged to main `de9a3d5`,
2026-06-02): "portfolio sim realism, backtest core split, BTC page decomp" — **45 files, 19
source.** (The "547 files" that `git show` reports is a git rendering artifact — the real PR
diff vs base `532f0c4c` is 45 files; confirmed via GitHub API.) Plus a coordination role on
2026-06-03 and 4 **stale** April `cursor/*` branches.

**The headline claims hold up under independent review:**
- ✅ **T+1 fills are real and correct** — signal computed at bar `idx` close, fill at `idx+1`
  open; signal/panic/time/max-DD exits all route through T+1; intraday stops use correct
  resting-order semantics (`evaluateStopHit`). The look-ahead removal that re-baselined WR
  54.66% → 48.37% is genuine, not cosmetic.
- ✅ **Cost model correct** — 22 bps round-trip (11/side), clean SSOT in `executionModel.ts`.
- ✅ **`lib/backtest/core.ts` extraction is clean** — breaks a circular dep; logic unchanged.
- ✅ **`chartEma.ts` is a real SSOT split** (config vs math), NOT duplication.
- ✅ **Cursor's NEW tests prove correctness** — `factorAttribution.test.ts` recovers
  β_MKT≈1 / intercept from known data; `portfolioBacktest.test.ts` was STRENGTHENED with
  invariants, not just re-baselined to new numbers.
- ✅ **Coordination doc accurate** — `PROGRESS_COORDINATION_2026-06-03.md` is a pre-#46
  snapshot; `SESSION_STATE.json` correctly reflects the later #46–#52 merges. No false claims.

**Follow-ups Cursor left (none are release-blockers, all are real):**
- ⚠️ **GARCH MLE is dead code** (`quant_framework/garch.py`) — corroborated by TWO agents
  independently. `arch` is not in `requirements.txt` (ImportError) AND the MLE path has a
  `float(np.array)` TypeError; both are swallowed by bare `except`, so it **always** returns
  the EWMA proxy. "GARCH" never actually runs. (P1, research-only — no prod caller.)
- ⚠️ **`useBtcPriceWs` unmount memory leak** — `ws.onclose` is not nulled before `.close()`,
  so after navigating away the close handler fires, schedules a reconnect, and leaks a zombie
  Coinbase socket per navigation (+ setState on unmounted component). Its sibling
  `useBtcKlineWs` is clean (gen-counter guard) — apply the same pattern. (P1, live `/crypto/btc`.)
- `factorAttribution.ts` statistical weaknesses (§2, **P1-K**) — Cursor built the multivariate
  OLS (solver verified correct) but it lacks the diagnostics (SE/t-stats, date-alignment,
  cond-number guard) that would make attribution trustworthy if ever promoted past "demo."
- Naming: `priceFromBinanceWsRef` is a **Coinbase** hook (misleading). (P2.)

**Unmerged `cursor/*` branches (all April, not "this week"):**
| Branch | Verdict |
|---|---|
| `cursor/backtest-ui-fixes` | **DEAD** — superseded. |
| `cursor/fix-briefs-url` | **DEAD** — superseded. |
| `cursor/institutional-research-platform` | **HOLDS VALUE** — options Greeks, floor/ceiling, market-maker analytics not on main. Owner decision: harvest or formally close. |
| `cursor/trading-simulator` | **HOLDS VALUE** — paper-trading simulator UI. Owner decision. |

---

## 2. Prioritized findings (live-production impact)

### P0 — fix first (real, on a live code path — both coordinator-verified at source)
| # | Area | File:line | Issue |
|---|---|---|---|
| P0-A | Frontend | `components/crypto/BtcQuantLab.tsx:92` | **Rules-of-Hooks violation** — early `return` (candles<30, line 92) precedes the `useState`/`useCallback` hooks (lines 100+); React throws when candle count crosses the threshold mid-session. ✅ Verified: mounted at `app/crypto/btc/page.tsx:111` with **no error boundary** → a throw blanks the whole `/crypto/btc` route. |
| P0-B | API | `app/api/crypto/btc/liquidations/route.ts:60` | **CWE-209 info leak** — raw upstream OKX error body forwarded to client unsanitized (`error: text.slice(0,200)`, line 60); the lone route bypassing the `sanitizeError` policy. ✅ Verified at source. |

> **Note — only 2 P0s.** A third candidate (factorAttribution statistical validity) was
> **downgraded to P1 (P1-K below)** after source verification: the function carries a
> `disclaimer` field and the page renders it in an amber warning box, labels the data
> "demo series," and shows "N/A (multivariate OLS deferred)" for R² — so the output is
> NOT presented as authoritative. The solver itself is correct (test recovers β_MKT≈1).
> A fourth candidate (auth.ts regex) was a **false positive** — see §4 / `coordinator-verifications.md`.

### P1 — methodology & resilience (degrade trust or robustness, not crashing)
| # | Area | File:line | Issue |
|---|---|---|---|
| P1-A | Quant ⭐ | `scripts/*` (e.g. `optimize-grid.ts:41-54`) | **Survivorship bias** — every backtest/benchmark uses a hard-coded list of *today's* mega-cap survivors. Inflates ALL reported WR/return/Sharpe **including the CI WR floor.** Untested, undocumented. Most important methodology issue for an "institutional" claim. |
| P1-B | Quant | `lib/optimize/gridSearch.ts:247-279` | Grid search **selects the winner ON the OOS set** (no third holdout / no multiple-testing correction) AND optimizes a cost-free non-SSOT signal AND **3 of 5 grid params are inert/never read** → the "optimal" thresholds in the results JSON are statistical artifacts. |
| P1-C | Frontend | `app/ma-deviation/page.tsx:179` | `SortTh` component **defined inside render body** → new identity every render → unmount/remount → focus lost on every sort interaction. |
| P1-D | Frontend | `app/stock/[ticker]/page.tsx` chart fetch | Missing `AbortController` → rapid timeframe switches race; last-resolved wins (can paint wrong-range candles). Pattern already applied to darkpool/options effects in the same file. |
| P1-E | Quant | `lib/backtest/engine.ts:80-131` | `aggregatePortfolio` combines instruments by **bar index, not date**, forward-pads the shorter curve (flat zero-vol tail), and hardcodes 252-day annualization → wrong portfolio Sharpe/Sortino/maxDD for any mixed crypto+equity portfolio. ✅ **Confirmed LIVE** — called at `app/api/backtest/route.ts:82` (`aggregatePortfolio(results, 100_000)`), so this is a real `/api/backtest` GET defect, **not** dead code. (Distinct from `aggregatePortfolioGreeks` in `lib/portfolio/greeks.ts`, which is fine.) |
| P1-K | Quant | `lib/portfolio/factorAttribution.ts:33-53` | Factor attribution diagnostics (downgraded from P0): min-N guard allows n<10 for a 6-param OLS (≈4 dof → β are noise); no SE/t-stats/adj-R²; normal-equations solve squares the condition number (fails on collinear factors); **positional tail-slice, not date-aligned** (pairs asset Friday with factor Wednesday under async staleness). Solver is correct (recovers β≈1 on clean data) and the UI discloses "demo/research, not authoritative" — hence P1, not P0. Make it trustworthy or keep it explicitly labeled. |
| P1-F | API | `app/api/briefs/route.ts:149` | Outer sector fan-out uses `Promise.all` (inner is `allSettled`) → one sector's runtime throw rejects the whole payload → 502 instead of partial. |
| P1-G | API | `lib/api/rateLimit.ts:82-86` | KV path: if `INCR` succeeds but `EXPIRE` fails (network blip), the key **never expires** → permanent rate-limit DoS for that IP. Use `SET … EX … NX`. |
| P1-H | API | `app/api/stream/[ticker]/route.ts:79` & `trading-agents` POST | Rate-limit consumed **before** ticker validation (invalid-ticker probing drains the bucket); POST `max_debate_rounds`/`max_risk_discuss_rounds` forwarded to the Python sidecar **un-clamped** in the body (query params are clamped). |
| P1-I | WS leak | `components/crypto/hooks/useBtcPriceWs.ts` | Zombie-socket leak on unmount (see §1). |
| P1-J | Tests | suite-wide | **No dedicated look-ahead regression guard** — the 48.37% re-baseline is protected only by signal-parity + the WR floor; a future look-ahead that kept WR>53.29% would pass CI. |
| P1-L | Security (offline) | `alpha_miner.py:275`, `multi_agent_factor_mining/agents.py:103` | **Escapable sandboxed `eval()`** on factor-formula strings (`eval(formula, {"__builtins__": {}}, ns)`). The empty-builtins guard is bypassable (`().__class__.__bases__[0].__subclasses__()` → `os` → RCE). LOW live risk (offline research, no web input) BUT `multi_agent_factor_mining` **LLM-generates the formulas** → semi-untrusted source. Replace with an AST-allowlist evaluator (not in the Vercel request path; not web-exploitable). |
| P1-M | Deps | `package.json` (`next-auth`→`uuid`) | **`npm audit`: 15 vulns (5 high, 10 moderate).** Runtime auth chain `next-auth ≤4.24.14 → uuid <11.1.1` (GHSA-w5hq-g745-h8pq) + build-time `next-pwa → workbox`. `audit fix --force` downgrades next-auth (wrong) → needs a real Auth.js v5 migration plan. |
| P1-N | Data | `lib/data/providers/{alphavantage,polygon,fred}.ts` | **3 providers have NO fetch timeout** (alphavantage:27,62 · polygon:16 · fred:67,85) → a hung upstream pins the serverless worker to the 300s platform timeout. Bloomberg/Bybit/OKX/Yahoo already use `AbortSignal.timeout`; mirror it. |
| P1-O | Data | `lib/data/providers/polygon.ts:69` + `alphavantage.ts:44-71` | polygon last-trade `t` treated as ns (÷1e6) while `fetchDaily` treats it as ms (undocumented split → silent year-2970 dates if endpoint changes); alphavantage `parseFloat` lacks `Number.isFinite` guard → **NaN can reach the warehouse at ingest** (before the D5-1 read-side filter). |
| P1-P | Frontend | `app/briefs/sector/[sector]/LiveBriefClient.tsx:76` + `lib/yahooQuoteFields.ts:14-18` + `components/options/GexChart.tsx` | 3rd uncancelled-fetch race (slug-driven, stale overwrite); Yahoo decimal-vs-percent heuristic misclassifies <0.5% moves (wrong % shown); GexChart math not wrapped in the project's `ChartErrorBoundary`. |
| P1-Q | a11y (systemic) | `SignalCard.tsx:57,101` · `LiveSignalsPanel.tsx:163` · `FrameworksTab.tsx:24` (+ Wave-1 tab/banner findings) | Systemic ARIA gap: aria-label on role-less divs (ignored by AT), sortable `<th>` missing `aria-sort`, disclosure/accordion triggers missing `aria-expanded`/`aria-controls`, tablists missing `aria-controls`/`role=tabpanel`/arrow-keys. WCAG 4.1.2 / 1.3.1 / 2.1.1. |

### P2 — cleanup / structure (the owner emphasized structure)
- **God files needing split:** `components/KLineChart.tsx` (1039 → extract `useKLineChart`
  hook) and `lib/backtest/signals.ts` (735 → split helpers/regime/types/enhanced). Cohesive,
  no split needed: `lib/quant/indicators.ts` (667).
- **4 dead modules** (present, some tested, zero prod callers): `lib/tickerNormalize.ts`,
  `lib/qa/dataValidator.ts`, `lib/qa/signalTracker.ts`, `lib/portfolio/riskParity.ts`
  (math is correct per quant agent — it's *dormant*, not wrong).
- **SSOT violations:** `lib/backtest/signals.ts` re-exports indicators and `core.ts`/
  `liveSignal.ts` import them via that re-export instead of `lib/quant/indicators.ts`;
  `OhlcvRow` defined twice (`core.ts` + `dataLoader.ts`); `lib/crypto.ts` inlines
  `calcMVRV`/`calcS2FPrice` duplicating `btc-indicators.ts` (guarded by a sync test —
  replace with a re-export, the pattern already used for `calcVWAP`).
- **Phantom config:** `yieldCurveGate` declared + documented in `SectorGateConfig` but never
  applied in `enhancedCombinedSignal` (and the whole enhanced path is prod-OFF anyway).
- Stale doc comments in `signals.ts`; `(c:any)` casts in `ma-deviation` route; `require()`
  vs ES import in `briefs/[sector]`.
- **0 circular dependencies** (madge, full graph) — good.

---

## 3. Strategic finding (not a bug — an owner decision) ⭐

**The entire Phase-11 "enhanced signal" + macro-gate subsystem is switched OFF in production.**
`lib/featureFlags.ts`: `useEnhancedCombinedSignal()` returns `false` in prod because
`enhancedCombinedSignal` **underperforms the simple baseline (52.63% vs 57.05% WR)**. So
`enhancedCombinedSignal`, the sector gates, Parkinson/DXY/yield-curve macro gates, and the
divergence/volume/MA-compression bonuses are sophisticated, well-tested, but **dormant research
code in the live product.** This recontextualizes several quant findings (the dead
`yieldCurveGate`, the sectorGates-only bonuses) as research-path-only. **Decision for owner:**
invest to make it beat the baseline, or formally retire it to shrink the maintained surface.

---

## 4. Verified-CLEAN (independently confirmed correct — bank these)
- Indicator SSOT (`lib/quant/indicators.ts`): SMA/EMA/RSI/Wilder/MACD/ATR/ADX/Bollinger/
  Sharpe/Sortino all correct.
- `correlation.ts` min-window guard EXISTS (`<minWindow → null`, Kelly fails closed) — a
  hypothesized P0 **disproved**.
- `getRiskFreeRateSync(365)` is correct (tenor selector returning annualized rate; no
  double-divide) — a hypothesized P0 **disproved**.
- Options Greeks/GEX/max-pain (BSM-Merton), VaR/Kupiec, riskParity ERC, tracker PnL
  (no double-count), `walkForward` equity mapping, `exitRules` (proves invariants).
- `lib/auth.ts:124` regex `/[\x00-\x1f\x7f]/` is the correct OWASP control-char class —
  an agent's "rejects all names" P0 was the **documented Read-tool false positive** (verified
  via Python `repr()` of raw bytes). See `coordinator-verifications.md`.
- Security: no hardcoded secrets, none logged, no `.env` tracked; Python sidecar key handling
  is leak-safe (per-request `os.environ` guard + pop, cache never stores keys).
- Test suite is genuinely invariant-based on the quant side (equity-invariant, signal-parity,
  exit-rules, factor-attribution all assert properties, not frozen numbers). Stryker mutation
  testing wired (break@70), CI gates typecheck+test+coverage(80/80/80/70)+WR-floor+smoke.
- **(Round 2)** `hooks/useLiveQuote.ts` SSE backbone (every stock page + dashboard) — leak-safe
  (`closedManuallyRef` guards all reconnects; full unmount cleanup). `middleware.ts` — double-submit
  CSRF + per-request CSP nonce, sound. **Security headers DO exist** (`next.config.js`
  `SECURITY_HEADERS`: HSTS/nosniff/X-Frame-Options:DENY/Referrer-Policy/Permissions-Policy) →
  **API agent's P1-7 WITHDRAWN.** Warehouse SQL is injection-safe (prepared statements). 55
  components + all timer/listener cleanups verified clean (→ the `app/page.tsx`/desk/LlmDeploy
  "timer leaks" were comment-match **false positives, withdrawn**). No `dangerouslySetInnerHTML` anywhere.

---

## 5. Recommended sequence (when the owner authorizes touching code — NOT done here)
1. **P0-A / P0-B** — two surgical, low-risk fixes (hooks ordering + error sanitization).
2. **P1-A survivorship** — biggest credibility issue; at minimum document the caveat in the
   benchmark + invariants baseline; ideally add point-in-time universe.
3. **P0-C factorAttribution** — add date-alignment + SE/t-stats + cond-number guard, or label
   the dashboard output "indicative."
4. **P1-E engine.ts** — first confirm whether `aggregatePortfolio` has any live caller.
5. Structure pass (god-file splits, dead-module removal, SSOT re-export) — one reviewable PR
   each, behind the existing invariant tests.
6. Owner decisions: enhanced-signal retire-or-invest (§3); harvest-or-close the two
   value-holding `cursor/*` branches (§1).

## 6. Build/gate state (coordinator ran the gates, read-only)
- **`tsc --noEmit`: CLEAN** (exit 0, zero type errors) — React 19 / Next 15 upgrade left no type fallout.
- **`vitest run`: 1006 passed · 17 skipped · 0 failed** (85 files). Suite is healthy.
- **Next.js 15 async-params migration COMPLETE** — zero routes use un-awaited `params` (#46 codemod done right).
- **⚠️ Meta-point:** *every finding in this report passes CI green.* Survivorship bias (P1-A), the live
  `aggregatePortfolio` misalignment (P1-E), the no-timeout providers (P1-N), NaN-at-ingest (P1-O), and
  the whole a11y cluster (P1-Q) all sail through typecheck + tests + WR-floor + smoke. That is precisely
  why they need human/review attention — the green pipeline is necessary but not sufficient. Reinforces
  test P1-J (no look-ahead guard) and P1-A (survivor-biased WR floor): CI proves "didn't break," not "correct."

---

*All findings above are review observations. No code, algorithms, configs, or tests were
modified in this inspection. Two CI gates (tsc, vitest) were executed read-only to confirm state.*
