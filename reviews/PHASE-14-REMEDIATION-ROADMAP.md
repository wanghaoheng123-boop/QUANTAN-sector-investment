# Phase 14 — Remediation Roadmap

**Companion to:** `PHASE-14-CRITIQUE-LOG.md` (138 findings).
**Authored:** 2026-05-16.
**Mandate:** No-compromise, best-practice resolution for every finding.
**Methodology:** Each remediation cites a primary source, names the canonical industry pattern, gives a concrete code-level fix, and estimates engineering effort.

## Roadmap structure

Four sprints, ~9 working days each, sequenced by **risk-mitigation priority**:

| Sprint | Theme | Findings closed | Cumulative gates |
|---|---|---|---|
| **S1** | Math & algorithm correctness | 14 Critical, 7 High | WR ≥ 56.96%, all Critical Q-tier closed |
| **S2** | Data, security, compliance | 9 Critical, 6 High | OWASP top-10 cleared, Polygon plan signed |
| **S3** | UI/UX + Frontend architecture | 12 Critical, 11 High | god-components ≤ 500 LOC, axe-core 0 critical |
| **S4** | Testing depth + Institutional analytics | 12 Critical (R8 + R9), 10 High | mutation ≥ 70%, GARCH+HMM live, scenario engine |

Each remediation is keyed back to the critique log finding ID for traceability.

---

# Sprint S1 — Math & Algorithm Correctness

**Goal:** Eliminate every Critical finding in Q1/Q2/Q3 (algorithm correctness). Backtest WR cannot regress below the current **56.96%** floor. Each fix lands with regression tests and the relevant primary-source citation.

## S1.1 — Unify the two backtest engines (closes Q1-C-1, Q1-C-2, Q1-H-1, Q1-H-5, Q1-M-4)

**Problem:** `engine.ts` uses entry-anchored equity (`capital + position * avgCost`); `portfolioBacktest.ts` uses mark-to-market with fallback. Invariant "portfolio = Σ instruments" is broken; maxDD circuit breaker is poisoned.

**Best-practice solution (Bacon 2008 §4.2):**
A trading engine must compute equity as `cash + Σ (shares × last_observed_close)` on every bar, AND mark each open position's unrealized P&L to that close. Both backtests must share a single `EquitySnapshot` primitive.

**Concrete fix:**
1. Extract `computeEquitySnapshot(state, currentBar)` into a new module `lib/backtest/equity.ts`. The function returns `{ cash, mtmValue, totalEquity, unrealizedPnl }`.
2. Replace `engine.ts:106-108` and `portfolioBacktest.ts:318-324` with calls to this primitive.
3. Delete `state.avgCost` tracking entirely (only used for the broken equity calc; entry price stays on the open-trade record).
4. Refactor `pnlPct` formula into helper `pnl(direction, entry, exit)` so adding shorts in Phase 15 is a one-line change.

**Tests:** Property test (`fast-check`) — for any sequence of BUY/HOLD/SELL on random prices, the portfolio backtest's final equity equals the sum of its per-instrument backtest equities ± 1 cent.

**Effort:** 1.5 days (1 engineer).

## S1.2 — Restore intraday-aware drawdown circuit breaker (closes Q1-C-2, Q1-H-2)

**Problem:** Drawdown gate fires INSIDE the bar-loop after equity update; new entries can be sized at Kelly fraction of a portfolio already in stop-loss. Two engines disagree on gate timing.

**Solution (Thorp 2006 §6):** Gate ALL new risk (entries) BEFORE signal generation, not just exits. Use the previous-bar mark-to-market equity (not today's bar's update) so we don't accidentally pre-position into the drawdown.

**Fix:**
1. Compute `equity_prior = computeEquitySnapshot(state, yesterdaysBar).totalEquity` at the top of every bar-loop iteration.
2. If `(peakEquity - equity_prior) / peakEquity >= cfg.maxDrawdownCap`, skip new-entry path entirely (continue to exits).
3. Add `BACKTEST_RFR_ANNUAL` source from FRED API at runtime; cache 24h. Until FRED hookup, accept `cfg.rfrAnnual` config override.

**Effort:** 1 day.

## S1.3 — Honest portfolio annualization (closes Q1-C-3, Q1-M-3, Q1-L-4)

**Problem:** Hard-coded `years = (lastValid - firstValid) / 252` for mixed crypto-equities portfolio. ~44% mismatch when BTC (365) mixes with SPY (252).

**Solution (Damodaran 2012 ch.7):** Each instrument has its own annualization. Portfolio annualization is the time-weighted harmonic mean of per-instrument trading-days. For a portfolio with N tickers:

```
years_portfolio = Σ (days_i / trading_days_per_year_i) / N
```

For Sharpe/Sortino on the portfolio equity curve, use the same per-instrument-aware factor.

**Fix:** New helper `lib/backtest/annualization.ts` exporting `effectivePortfolioYears(instrumentMeta[])`. Pass through `windowSharpe()` and full-period Sharpe.

**Effort:** 0.5 day.

## S1.4 — DCF insolvency rejection (closes Q1-C-4)

**Problem:** Negative `equityValue` (EV − netDebt < 0) silently produces non-finite `valuePerShare`; `<= 0` gate caught zero but signed negatives slip through.

**Solution (Damodaran 2012 ch.2):** Negative equity = insolvency. Valuation models must NEVER output buy/sell signals on insolvent capital structures.

**Fix:** `lib/quant/dcf.ts:48` add `if (equityValue <= 0) return null` BEFORE the value-per-share computation. Add regression test with synthetic high-debt company.

**Effort:** 0.25 day.

## S1.5 — Raise BUY confluence threshold + tier transaction costs (closes Q1-C-5, Q1-L-1)

**Problem:** BUY at +0.15 weighted score is ~21% of max; 7-factor ensemble triggers on a single moderately-bullish indicator. Flat 11 bps tx-cost penalizes SPY (real: ~2 bps round-trip) and undercounts mid-caps.

**Solution (Aronson 2007, Pardo 2008 p146):** Statistical-confluence entries require ≥50% of indicators agreeing → +0.25 BUY threshold. Costs must be liquidity-tiered: SPY/QQQ class (~1 bps/side), large-cap (~3 bps), mid/small-cap (~8 bps).

**Fix:**
1. `signals.ts:533` raise default `buyThresh` from `0.15` → `0.25`. Re-run benchmark; if WR drops below 56.96%, scan sector-gate overrides to find the right balance.
2. New helper `txCostBps(ticker)` using the liquid-tier dictionary. Apply in `engine.ts` line 213 and `portfolioBacktest.ts` line 386.

**Effort:** 1 day (mostly benchmark stability).

## S1.6 — ADX +DI/-DI offset fix (closes Q2-C-2)

**Problem:** `indicators.ts:533-539` reads `trSmooth[i-1]` (off-by-one vs TA-Lib). Production "ADX" values are 1-bar lagged compared to Bloomberg / TradingView.

**Solution (Wilder 1978 ch.5, TA-Lib reference):** DI at bar `i` is computed against `trSmooth[i]`, not `[i-1]`. TA-Lib is the de-facto reference; mismatch will surface immediately when institutional users compare values.

**Fix:** Change lines 535-536 to `trSmooth[i]`. Add golden-file regression: 100-bar canonical TA-Lib ADX/DI output → assert exact agreement to 5 decimal places.

**Effort:** 0.5 day.

## S1.7 — Relative-strength lookback off-by-one (closes Q2-C-3)

**Problem:** `relativeStrength.ts:96-115` uses `length-127` (3.8h drift from intended 126 bars).

**Solution:** Change `127` → `126`. Document that "63-bar 3m" and "126-bar 6m" are *trading-bar* indices, not calendar.

**Effort:** 0.25 day.

## S1.8 — Weekly aggregation Friday-close convention (closes Q2-C-4)

**Problem:** `aggregateToWeekly()` uses Monday start → mid-trade week leaks look-ahead bias into EMA(21).

**Solution (Murphy 1999 p117):** Aggregate by ISO week, emit at Friday's close. Bar's `time` field set to Friday's timestamp.

**Fix:** Refactor `aggregateToWeekly()` to fix the boundary at Friday's close; partial weeks at end of dataset emit `incomplete: true` flag for downstream gating.

**Effort:** 1 day.

## S1.9 — MACD signal-line warmup fix (closes Q2-H-3)

**Problem:** Gate at `slow + sig - 1`; signal[length-1] = NaN.

**Solution:** Gate at `slow + sig`; signal[length-1] valid.

**Fix:** Change `indicators.ts:173` and verify against TA-Lib golden file for `closes.length = slow+sig`.

**Effort:** 0.25 day.

## S1.10 — Options dividend-yield wiring (closes Q3-C-1)

**Problem:** Merton extension exists in `greeks.ts` but `chain.ts:107` omits `q`. Dividend-paying ETF Greeks are wrong by 1-3% per year.

**Solution (Merton 1973 p2-3):** Extract `dividendYield` from Yahoo quote in `chain.ts` (it's in `summaryDetail.dividendYield` for ETFs), pass into every `greeks()` call.

**Fix:**
1. `chain.ts:107` add `q = num(rawQuote?.dividendYield ?? 0)`.
2. Pass `q` to every `enrichContract()` call.
3. Add regression test on XLU (~3.4% yield): verify call price strictly less than the no-dividend case.

**Effort:** 0.5 day.

## S1.11 — IV solver bisection fallback for deep-OTM (closes Q3-C-3, Q3-H-2, Q3-M-4)

**Problem:** Brenner-Subrahmanyam seed underestimates for 0DTE deep-OTM; Newton stalls in low-vega region.

**Solution (Press et al. 1992 ch.9):** Hybrid Newton + Brent. If `vegaFull < 1e-10` OR Newton step exits [SIGMA_MIN, SIGMA_MAX] OR oscillates between bounds 2 iterations in a row → fall back to bisection on `[SIGMA_MIN, SIGMA_MAX]`. Track a `convergenceFlag: 'newton'|'bisect'|'boundary'` so downstream can warn on `'boundary'`.

**Fix:** Refactor `greeks.ts:impliedVolatility()` into a `solveIVHybrid()` function with explicit state machine.

**Effort:** 1.5 days (including 0DTE regression test).

## S1.12 — Max-pain per-expiry bucketing (closes Q3-C-5, Q3-H-4)

**Problem:** `sentiment.ts:maxPain()` sums OI across ALL expirations; near-dated and far-dated positions cancel.

**Solution (Natenberg 2015 ch.5):** Compute max-pain per expiration date; return `{ expirationDate: painStrike }[]`. Route exposes per-expiry array.

**Fix:** Restructure `maxPain()` to accept `{ calls, puts }` grouped by expiration; return per-expiry strikes; sort by expiration.

**Effort:** 1 day.

## S1.13 — ATR panic exit uses $-ATR not %-ATR (closes Q1-H-4)

**Problem:** `currentATRPct > entryATRPct * 3` triggers cheaper on price falls.

**Solution (Pardo 2008 p167):** Store `entryATRDollar` at entry. Compare `currentATRDollar` (computed from last 14 bars HL) vs `entryATRDollar * 3`.

**Fix:** `exitRules.ts:OpenPosition` add `entryATRDollar: number`. `checkExitConditions` panic branch compares dollar values.

**Effort:** 0.5 day.

## S1.14 — Auth control-char regex bug (closes R7-C-1, R7-H-1)

**Problem:** `lib/auth.ts:124` regex `/[ -]/` rejects space-to-hyphen ASCII range, NOT control chars. `<script>` slips through.

**Solution (CWE-697):** Replace with `/[\x00-\x1f\x7f]/` (actual C0 controls + DEL).

**Fix:** One-line regex change + add unit test with `'user\x00name'` (should reject) and `'O\'Brien'` (should accept).

**Effort:** 0.25 day.

**Sprint S1 total:** ~9 person-days. Closes 14 Critical + 7 High findings.

---

# Sprint S2 — Data Engineering, Security, Compliance

## S2.1 — Migrate rate-limiter to Vercel KV (closes R4-C-1, R7-M-4)

**Problem:** Per-process token-bucket map; unbounded growth under spoofed-IP DDoS; multi-instance bypass by forcing cold starts.

**Solution (Vercel docs + AWS Lambda BP):** Use Vercel KV (Upstash Redis under the hood) for shared state across all instances. Operations are atomic via Lua script for the token-bucket update.

**Fix:**
1. New `lib/api/rateLimitKv.ts` that calls `kv.eval(luaScript)` with `tokens, lastRefill` keys.
2. Migrate every `applyRateLimit()` call.
3. Document in README; document fallback (in-memory) when KV not configured (`process.env.KV_URL` absent).

**Citation:** AWS Lambda best practices — distributed rate-limit requires external store. Vercel KV docs §"Atomic operations".

**Effort:** 1.5 days.

## S2.2 — `x-forwarded-for` guard on non-Vercel (closes R7-C-2)

**Problem:** Trusted unconditionally; spoofed on Railway / self-hosted.

**Solution (CWE-770):** Trust `x-forwarded-for` ONLY when `process.env.VERCEL === '1'`. Otherwise fall back to `req.socket.remoteAddress`.

**Fix:** `getRateLimitKey()` guard.

**Effort:** 0.5 day.

## S2.3 — Bloomberg-bridge protocol upgrade: null for missing (closes R4-C-2)

**Problem:** `num()` coerces missing → 0; merge can't distinguish halt-zero from absent-zero.

**Solution:** Extend bridge wire format to emit `null` for absent fields. Update `BloombergQuoteNormalized` type to `volume: number | null`. Use `??` instead of `||` in merge.

**Fix:**
1. `bridgeClient.ts:num()` return `null` instead of `0`.
2. Type update.
3. `mergeQuotes.ts` replace `||` with `??`.
4. Backward-compat: keep legacy 0-fallback for one release behind a feature flag.

**Effort:** 1.5 days.

## S2.4 — SSE stream graceful shutdown (closes R4-C-3)

**Problem:** Vercel kills function at 10min; abrupt disconnect.

**Solution (RFC 6202):** Pre-shutdown notice at 9:30 mark. Client SDK can reconnect cleanly.

**Fix:** `stream/route.ts` add `setTimeout(() => emit('stream_closing', { reconnect: true }), 9.5 * 60_000)` then `setTimeout(close, 10 * 60_000)`.

**Effort:** 0.25 day.

## S2.5 — Single ticker-validation pipeline (closes R4-C-4)

**Problem:** Duplicate normalize logic in `prices/route.ts` and `sanitize.ts`; injection risk.

**Solution:** Remove the local duplicate; call `normalizeTicker(t)` from sanitize SSOT. Filter null.

**Effort:** 0.25 day.

## S2.6 — Restrict `next.config.js` remotePatterns (closes R7-C-4)

**Problem:** `hostname: '**'` enables SSRF amplification via `<Image>`.

**Solution:** Whitelist Yahoo + known news CDNs.

**Fix:**
```js
remotePatterns: [
  { protocol: 'https', hostname: '*.yimg.com' },
  { protocol: 'https', hostname: 's.yimg.com' },
  { protocol: 'https', hostname: 'finance.yahoo.com' },
  // add other approved domains
]
```

**Effort:** 0.25 day (test image loads after).

## S2.7 — Validate `BLOOMBERG_BRIDGE_URL` (closes R7-C-5)

**Problem:** Env var unvalidated; internal-IP redirection possible.

**Solution:** At module load, parse URL, reject if hostname is private-IP (10/8, 192.168/16, 127/8, ::1) or non-https in production.

**Fix:** `bridgeClient.ts` add `validateBridgeUrl()` at the top of `isBloombergBridgeConfigured()`. Use `ipaddr.js` to detect private ranges.

**Effort:** 0.5 day.

## S2.8 — Trading-agents API-key audit + TLS enforcement (closes R7-C-3, R7-H-2)

**Problem:** User-supplied `api_key` forwarded plaintext; `_clean` destructure unused; no audit trail.

**Solution:**
1. Validate `TA_BASE` is https in production.
2. Log key fingerprint (`sha256(key).slice(0,12)`) only — never the key.
3. Use the `safeBody = { ...body, api_key: undefined }; if (apiKey) safeBody.api_key = apiKey` pattern.

**Effort:** 0.75 day.

## S2.9 — CSP enforcing mode + `unsafe-inline` removal (closes R7-H-4, R7-L-3)

**Problem:** CSP is Report-Only; allows `unsafe-inline` + `unsafe-eval`.

**Solution (OWASP Secure Headers):**
1. Run 1 week in Report-Only to verify no violations.
2. Flip header to `Content-Security-Policy:` (no `-Report-Only`).
3. Add nonces via `next.config.js` middleware: every request generates a nonce, inline scripts/styles include it.

**Effort:** 2 days.

## S2.10 — Production error response: omit undefined details (closes R7-H-5)

**Problem:** `details: undefined` leaks error-occurred signal in JSON.

**Fix:** Spread guard: `{ ...(details ? { details } : {}) }`.

**Effort:** 0.25 day (sweep all `errorResponse()` call sites).

## S2.11 — Fan-out concurrency cap on briefs API (closes R4-H-2)

**Problem:** 11 sectors × 3 tickers = 33 parallel Yahoo calls per request.

**Solution (Polly circuit-breaker pattern):** Wrap each yahoo call with `pLimit(3)`.

**Fix:** `npm i p-limit` + wrap fetch loop.

**Effort:** 0.25 day.

## S2.12 — Aggregate timeout on fundamentals route (closes R4-H-3)

**Fix:** Wrap `Promise.all([...])` with `withTimeout(..., 9000)`.

**Effort:** 0.25 day.

## S2.13 — `npm audit fix` + Vercel CLI upgrade (closes R7-M-3)

**Problem:** 43 vulnerabilities (1 critical, 32 high).

**Solution:** Run `npm audit fix`, address breaking changes in a separate PR. Add `npm audit --audit-level=high` to CI.

**Effort:** 1 day (including manual breaking-change resolution).

## S2.14 — Yahoo compliance + Polygon migration plan (closes R7-M-1)

**Problem:** Yahoo ToS §2 restricts to personal/non-commercial. Inspector I3 veto in place.

**Solution:**
1. **Immediate:** Update `components/ComplianceBanner.tsx` with explicit "non-commercial research use only" + link to Yahoo ToS. Add `YAHOO_RESEARCH_ONLY=true` env flag that disables `/api/prices`, `/api/chart`, `/api/options` if not set.
2. **Phase 14+:** Sign Polygon Stock Data Plan ($199/mo Currencies+Indices+Equities). Migrate `lib/data/providers/polygon.ts` to be the primary feed. Yahoo becomes fallback only.
3. **Legal opinion:** Engage securities-data compliance counsel to opine on educational/demo use.

**Effort:** 2 days code + 1 week external (legal opinion timeline).

**Sprint S2 total:** ~10 days code + 1 week legal (parallel). Closes 9 Critical + 6 High.

---

# Sprint S3 — UI/UX + Frontend Architecture

## S3.1 — QuantLabPanel decomposition (closes R5-C-2)

**Problem:** 1653 LOC god component; 8+ sub-tabs combined into one file.

**Solution (Martin 2008 "Clean Architecture" §SRP):** Split into focused sub-components, each ≤ 400 LOC:
1. `QuantLab/ValuationTab.tsx` (DCF, anchors, sliders)
2. `QuantLab/TechnicalsTab.tsx` (indicators panel, regime, MTF)
3. `QuantLab/FrameworksTab.tsx` (research-score pillars)
4. `QuantLab/LlmAnalysisTab.tsx` (provider/model selection, deploy assistant)
5. `QuantLab/EarningsTab.tsx` (earnings parse + calendar)
6. `QuantLab/index.tsx` orchestrates tab switching and shared state via Context.

**Effort:** 5 days.

## S3.2 — KLineChart plugin registry (closes R5-C-1, R5-C-3, R5-C-6)

**Problem:** 1011 LOC, hardcoded indicators, JSON.stringify in deps, no Suspense.

**Solution:**
1. **Plugin registry:** Each indicator becomes a `ChartPlugin` with `{ name, init(chart), update(data, vis), destroy() }`. Core chart loads plugins via array prop. New indicator = new plugin file, no chart-core edit.
2. **Suspense boundary:** Move chart init to a dynamic-imported child wrapped in `<Suspense fallback={<ChartSkeleton />}>` + `<ChartErrorBoundary>`.
3. **Stable equality:** Move `INDICATOR_DEFS` and `EMA_LEGEND_TAILWIND` to module scope. Use a `useDeepMemo(vis)` hook OR encode `vis` as a stable string fingerprint.

**Effort:** 6 days (largest single refactor; needs visual-regression tests).

## S3.3 — Unified price polling via Context (closes R5-C-4, R5-H-3)

**Problem:** `setInterval` in pages mixed with SWR in children; redundant network.

**Solution:** Single `PricesProvider` at `app/layout.tsx` level that owns `useLivePrices(tickerSet)`. Children read via `usePrices()` hook. Remove all page-level `setInterval`.

**Effort:** 2 days.

## S3.4 — Typed LLM-response schema (closes R5-C-5)

**Problem:** `as any` casts; schema drift not caught at compile time.

**Solution:** Define `LlmAnalysisResult` interface with discriminated unions. Validate at runtime with `zod` parse → fall through to error UI if shape wrong.

**Effort:** 1 day.

## S3.5 — `React.memo` on list items + `useDeferredValue` (closes R5-H-2)

**Fix:** Wrap `SectorCard`, `SignalCard`, `InstrumentTable` rows in `React.memo` with custom equality. Use `useDeferredValue(quotes)` in parent for non-blocking updates.

**Effort:** 1 day.

## S3.6 — MetricTooltip aria-describedby linkage (closes R6-C-1)

**Solution (WAI-ARIA APG Tooltip pattern):** Trigger button gets `aria-describedby="tooltip-<id>"`; tooltip span has matching `id`. Use `useId()` from React for collisions.

**Effort:** 0.5 day.

## S3.7 — Chart text alternative (closes R6-C-2)

**Solution:** Below the canvas, render a collapsible `<details>` containing a `<table>` with caption + scope of OHLCV last 30 bars. AT users can expand on demand.

**Effort:** 1 day.

## S3.8 — PriceTicker keyboard pause + visibility pause (closes R6-C-3, R6-M-6)

**Fix:** Add `onFocus={() => setIsPaused(true)} onBlur={...}` on the ticker container (tabIndex=0). Add `useEffect` on `document.visibilityState` to pause when tab hidden.

**Effort:** 0.5 day.

## S3.9 — GlobalSearch combobox correct role nesting (closes R6-C-4)

**Solution (WAI-ARIA APG Combobox v1.2 pattern):** Container = `role="combobox"` on the input; results popup = `role="listbox"`; each item = `role="option" aria-selected={hover}`.

**Effort:** 1 day.

## S3.10 — Focus-visible contrast fix (closes R6-C-5)

**Fix:** Change `globals.css` outline color from `#60a5fa` (blue-400, ~3:1) to `#93c5fd` (blue-300, ~5:1) on `bg-slate-900`. Add `outline-offset: 2px` (already present).

**Effort:** 0.25 day.

## S3.11 — Toast container z-index + role refinement (closes R6-C-6)

**Solution:** Bump container z-index above floating widgets; move focus to first toast on appear for assertive errors only.

**Effort:** 0.5 day.

## S3.12 — `prefers-reduced-motion` global override (closes R6-H-6, R6-M-5)

**Fix:** `globals.css`:
```css
@media (prefers-reduced-motion: reduce) {
  .animate-pulse, .animate-pulse-subtle, .animate-confidence-ring,
  .animate-ticker, .animate-fade-in, .animate-card-enter {
    animation: none !important;
  }
}
```

**Effort:** 0.25 day.

## S3.13 — Design-token system (closes R5-M-2)

**Problem:** Sector colors duplicated across files.

**Solution:** New `lib/theme/tokens.ts` exporting `SECTOR_COLOR_MAP`, `SEMANTIC_COLORS` (up/down/neutral/warn/info), `SPACING_SCALE`. Use everywhere; remove all hard-coded color literals.

**Effort:** 2 days.

## S3.14 — Modal primitive (closes R5-M-4, R6-H-5)

**Problem:** Modal patterns duplicated in `KeyboardShortcuts`, `LlmDeployAssistant`. Both need focus trap, return focus, body lock, portal.

**Solution:** New `components/primitives/Modal.tsx` with all dialog-pattern requirements. Both call sites adopt the primitive.

**Effort:** 2 days.

**Sprint S3 total:** ~22 days. Closes 12 Critical + 11 High.

---

# Sprint S4 — Testing Depth + Institutional Analytics

## S4.1 — Test the 33 untested lib files (closes R8-C-1 through R8-C-7)

**Priority order (by risk):**
1. `lib/auth.ts` (auth flow, secret generation) — 1 day.
2. `lib/optimize/gridSearch.ts` (walk-forward overfitting guard) — 1 day.
3. `lib/portfolio/riskParity.ts` (covariance + inverse-vol weights) — 1 day.
4. `lib/data/bloomberg/{bridgeClient, toBloombergSecurity}.ts` — 1 day.
5. `lib/data/providers/{alphavantage, fred, polygon, yahoo}.ts` — 2 days (mocked HTTP).
6. `lib/ml/client.ts` — 0.5 day.
7. `lib/quant/btc-indicators.ts` (SSOT wrappers) — 0.5 day.
8. `lib/quant/buildFundamentalsPayload.ts` (orchestrator) — 1 day.
9. Remaining ~25 files: pure-helper layer; one test file per logical group — 3 days.

**Total:** 11 days.

## S4.2 — Mutation testing via Stryker (closes R8-strategic)

**Problem:** No mutation testing; subtle off-by-one / operator-flip errors leak to production.

**Solution (Stryker docs §Quick Start):**
1. `npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner`.
2. Config `stryker.conf.mjs` targeting `lib/quant/**`, `lib/backtest/**`, `lib/options/**`.
3. Run on PR; gate at **70% mutation score** (raise to 80% over time).

**Effort:** 2 days setup + iterative improvement.

## S4.3 — Property-based testing via fast-check (closes R8-strategic)

**Solution:**
1. `npm i -D fast-check`.
2. Property tests for key primitives:
   - `pearsonCorrelation`: bounds [-1, +1], symmetry.
   - `kellyFraction`: monotonic in winProb.
   - `evaluateStopHit`: never returns negative.
   - `safeFixed`: always returns string or fallback.
   - Portfolio backtest: equity ≥ 0 invariant under any signal sequence.

**Effort:** 2 days.

## S4.4 — Coverage gate expansion (closes R8-H-7)

**Fix:** `vitest.config.ts` set `coverage.include = ['lib/**']`, threshold `lines: 80, branches: 75, functions: 80, statements: 80`.

**Effort:** 0.5 day (after S4.1 increases coverage above thresholds).

## S4.5 — GARCH(1,1) Python sidecar (closes R9-C-1)

**Problem:** No conditional-vol forecasting.

**Solution (Engle 1982, Bollerslev 1986):**
1. New Python module `quant_framework/garch.py` using `arch` library:
   ```python
   from arch import arch_model
   model = arch_model(returns, vol='Garch', p=1, q=1)
   res = model.fit(disp='off')
   forecast = res.forecast(horizon=20).variance
   ```
2. Expose via HTTP route `/conditional-vol?ticker=SPY` (under existing TradingAgents sidecar).
3. New TS client `lib/quant/garchClient.ts` fetches forecast.
4. Feed conditional sigma into Greeks pricing (override flat IV) and regime-adaptive Kelly.

**Effort:** 4 days.

## S4.6 — Hidden Markov 3-state regime detector (closes R9-C-2)

**Problem:** Ad-hoc volRatio + ADX thresholds; no latent state.

**Solution (Hamilton 1989, Guidolin & Timmermann 2007):**
1. Python `quant_framework/regime_hmm.py`:
   ```python
   from hmmlearn import hmm
   model = hmm.GaussianHMM(n_components=3, covariance_type='full', n_iter=100)
   model.fit(returns_2d)  # 2-D: returns + realized-vol
   states = model.predict(returns_2d)
   probs = model.predict_proba(returns_2d)
   ```
2. States labeled "Bull / Normal / Bear" by stationary-distribution analysis.
3. Forecasted regime probabilities published daily as JSON to the FE.
4. `regimeDetection.ts` consumes the HMM output as PRIMARY signal; ADX becomes a confirmer.

**Effort:** 5 days.

## S4.7 — ScenarioEngine for stress testing (closes R9-C-3, R9-H-2)

**Problem:** No "what-if" support; no portfolio-Greeks aggregation.

**Solution (Jorion 2006 ch.7):**
1. `lib/scenarios/engine.ts`:
   - `ScenarioSpec = { spotShock: number, volShock: number, rateShock: number, ... }`
   - `applyScenario(portfolio, scenario)` re-prices each open position; aggregates portfolio Greeks (Δ, Γ, ν, θ, ρ).
2. Standard scenarios: Fed +100bps, S&P -10%, VIX +50%, 2008-style crisis, Flash Crash, COVID-shock.
3. UI: `/risk/scenarios` page renders the matrix; PM can edit shocks.

**Effort:** 6 days.

## S4.8 — Tail-risk hedging rules (closes R9-C-4)

**Solution (Bhansali 2014):** Trigger automated alerts when:
- Realized skew < −0.5 AND vol > historical_mean
- Portfolio vega < −$500k (unhedged short-vol exposure)
- Drawdown > 8% mid-month

Suggest hedges: protective puts (3-month 10-delta), put spreads, VIX-call calendars.

**Effort:** 3 days.

## S4.9 — Factor exposure attribution (closes R9-C-5)

**Solution (Carhart 1997 + Fama-French 2015):**
1. Regress each position's daily returns on (MKT, SMB, HML, MOM, QMJ) — 5 factors.
2. Aggregate portfolio factor exposures + factor-attribution P&L waterfall.
3. UI: monthly attribution report.

**Effort:** 4 days.

## S4.10 — Bayesian shrinkage in signal weights (closes R9-C-6)

**Solution (Ledoit & Wolf 2004):** When indicator triggers are rare (e.g. RSI divergence fires in 5% of bars), shrink the +0.15 bonus by a posterior-credibility factor. Use Beta-Binomial: prior `Beta(2, 8)` (skeptical), update with observed hit rate.

**Effort:** 3 days.

## S4.11 — Walk-forward expanding-window CV (closes R9-H-1)

**Solution (López de Prado 2018 ch.7):**
1. Already-present `walkForwardAnalysis` in `engine.ts` uses fixed window; upgrade to expanding window.
2. Compute median Sharpe across windows + fraction of windows where OOS beats IS (overfit detector).
3. Gate parameter changes: any tunable change must improve median OOS Sharpe by ≥0.1 stddev.

**Effort:** 3 days.

## S4.12 — Tax-loss harvesting + dynamic rebalancing (closes R9-H-4)

**Solution (Arnott et al. 2016):**
1. New module `lib/portfolio/taxOptimization.ts`: identify realized losses, suggest similar-exposure swap, respect IRS Wash-Sale (30-day rule).
2. Rebalance cadence grid search: 5/10/20/30-day intervals; optimize for after-tax Sharpe.

**Effort:** 4 days.

**Sprint S4 total:** ~52 days, ~6 person-weeks (2-3 engineers parallel). Closes 12 Critical (R8 + R9) + 10 High.

---

# Cross-sprint quality gates

Every PR in Phase 14 must clear:

| Gate | Tool | Threshold |
|---|---|---|
| Type check | `tsc --noEmit` | zero errors |
| Test suite | `vitest run` | 100% pass |
| Coverage | `vitest --coverage` | ≥80% lines, ≥75% branches on `lib/**` |
| Mutation | `stryker run` | ≥70% mutation score on quant + backtest + options |
| Lint | `eslint . --ext .ts,.tsx` | zero errors |
| Dead-code | `knip` | zero unused exports outside skiplist |
| Duplication | `jscpd lib app components --threshold 3` | <3% duplicate-block ratio |
| Bundle size | `next build --profile` | ≤10% growth per sprint |
| Benchmark | `npm run benchmark` | WR ≥ 56.96% (current baseline) |
| Portfolio test | `scripts/portfolio-backtest.ts` | WR ≥ 55%, maxDD ≤ 20% |
| Reproducibility | hash-match across 2 runs | identical |
| `npm audit` | level=high | zero high+ vulnerabilities |
| Accessibility | `axe-core` in CI on 5 priority routes | zero critical |
| Security | `next-safe` headers + CSP enforcing | passes |

---

# Effort summary

| Sprint | Days | Findings closed | Cumulative gates |
|---|---|---|---|
| **S1** | 9 | 14 C + 7 H | Math correctness, WR floor held |
| **S2** | 10 | 9 C + 6 H | Security cleared, compliance plan signed |
| **S3** | 22 | 12 C + 11 H | god-components decomposed, axe-core clean |
| **S4** | 52 | 12 C + 10 H | Testing depth + institutional analytics live |
| **Total** | **93 days** | **47 C + 34 H** | Production-grade institutional platform |

With 2-3 engineers in parallel: **~3-5 calendar months**.

---

# Acceptance criteria for Phase 14 sign-off

1. All 47 Critical findings closed with regression tests.
2. All 34 High findings closed or formally deferred with C1+C2 written approval.
3. Mutation score ≥70% on `lib/quant/**`, `lib/backtest/**`, `lib/options/**`.
4. Coverage ≥80% on every directory under `lib/**`.
5. GARCH + HMM regime + ScenarioEngine operational; institutional users have access to portfolio Greeks, factor attribution, stress test, walk-forward CV reports.
6. Yahoo compliance: either Polygon migration complete OR legal counsel opinion in writing.
7. axe-core zero criticals on the 5 priority routes (`/`, `/sector/[slug]`, `/stock/[ticker]`, `/backtest`, `/options/[ticker]`).
8. CSP enforcing in production; 1-week of zero violation reports.
9. PR#10's WR baseline (56.96%) preserved or improved.
10. Documentation: every closed finding has a commit message citing the finding ID and primary source.

---

# Out of scope for Phase 14 (Phase 15+)

- ML model retraining (Python sidecar in maintenance mode).
- Mobile-native app.
- Multi-tenancy / billing.
- International / FX-hedged sector overlay.
- Order routing / live brokerage integration.
- Full-blown HFT or sub-second-latency execution.

---

# Companion document

See `reviews/PHASE-14-CRITIQUE-LOG.md` for the 138-finding ledger.
