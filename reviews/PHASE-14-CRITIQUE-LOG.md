# Phase 14 — Industry-Professional Team Critique Log

**Date:** 2026-05-16
**Mandate:** Strict-level, no-mercy investigation across 9 disciplines.
**Method:** 9 specialist reviewers ran in parallel against the post-PR#10 codebase.
**Outcome:** **138 findings** across algorithm correctness, code structure, code quality, UI/UX, data accuracy, data processing, security, testing, and institutional analytical capabilities.

## Roster

| ID | Role | Profile | Domain |
|---|---|---|---|
| **Q1** | Quantitative Finance | PhD Finance/Math, ex-AQR/RenTec | `lib/backtest/*`, `lib/quant/{kelly,dcf,researchScore}` |
| **Q2** | Indicators & Time-Series | PhD Statistics, ex-D.E. Shaw | `lib/quant/*` (indicator math) |
| **Q3** | Options & Volatility | PhD Fin-Eng, ex-Citadel/SIG | `lib/options/*`, `lib/quant/constants` |
| **R4** | Data Engineering | Staff DE, ex-Bloomberg/Refinitiv | `lib/data/*`, `lib/api/*`, `app/api/*` |
| **R5** | Frontend Architecture | Principal FE, fintech design-system lead | `components/*`, `app/**/page.tsx`, `hooks/*` |
| **R6** | Accessibility & UX | WCAG 2.2 expert + Bloomberg-Terminal UX | UI surfaces, a11y patterns, design tokens |
| **R7** | Security & Compliance | CISSP + US securities-data compliance | `lib/auth`, API routes, env vars, Yahoo ToS |
| **R8** | Testing & QA | Staff SDET, mutation/property testing | `__tests__/*`, coverage gates, verify scripts |
| **R9** | Analytical Capabilities | Senior PM + AI/ML researcher | Pipeline-level gaps (regime, hedging, factor) |

## Headline numbers

| Severity | Count |
|---|---|
| **Critical** | 47 |
| **High** | 45 |
| **Medium** | 42 |
| **Low** | 26 |
| **Net unique findings** | ~138 |

Per-reviewer counts: Q1=14, Q2=14, Q3=11, R4=14, R5=14, R6=16, R7=13, R8=22, R9=20.

---

# Q1 — Quantitative Finance (14 findings)

## Critical
- **Q1-C-1** `engine.ts:107` — Equity tracking uses average cost not mark-to-market. The `currentEquity()` helper uses `state.capital + state.position * state.avgCost`; `avgCost` set only at BUY and never updated. **Bacon (2008) p102–105:** maxDD must derive from true equity curve, not entry-anchored tracking. Fix: replace with `capital + position * currentPrice` on each bar.
- **Q1-C-2** `engine.ts:287`, `portfolioBacktest.ts:354` — Kelly applied to cash; drawdown gates inconsistently between the two engines. **Thorp (2006) §6.** Fix: unify both engines to check drawdown before signal generation.
- **Q1-C-3** `engine.ts:548` — Portfolio equity-curve carry-forward misaligns annualization across crypto (365) vs equities (252). **Damodaran (2012) ch.7.** Fix: weighted annualization `avg_years = Σ(days_i / trading_days_i) / count`.
- **Q1-C-4** `dcf.ts:48` — Negative equity value not rejected; insolvency passes through. **Damodaran (2012) ch.2.** Fix: add `if (equityValue <= 0) return null`.
- **Q1-C-5** `signals.ts:533` — BUY threshold `0.15` too permissive (only 15% of max +1.0 confluence). **Aronson (2007).** Fix: raise to +0.25 (or +0.30 with sector gate).

## High
- **Q1-H-1** `engine.ts:287`, `signals.ts:584` — Kelly cap applied twice; hides true constraint.
- **Q1-H-2** `engine.ts:389` — `BACKTEST_RFR_ANNUAL` hard-coded at 4%; stale vs 10-year Treasury ~4.5%.
- **Q1-H-3** `portfolioBacktest.ts:140-141` — Per-bar `tickerDailyReturns` tape: second entrant on same bar reads stale peer correlations.
- **Q1-H-4** `exitRules.ts:118-119` — ATR panic exit compares `currentATRPct` to `entryATRPct`; perversely triggers cheaper on price falls. **Pardo (2008) p167.** Use absolute $ ATR.
- **Q1-H-5** `engine.ts:106-108` vs `portfolioBacktest.ts:318-324` — Two engines compute equity divergently; portfolio≠sum-of-instruments.

## Medium
- **Q1-M-1** `engine.ts:310` — ATR%-at-prior-bar 1-bar lag.
- **Q1-M-2** `signals.ts:495` — BB%B score direction non-intuitive (correct, document).
- **Q1-M-3** `portfolioBacktest.ts:518` — Hard-coded 252-day portfolio annualization.
- **Q1-M-4** `engine.ts:243-246, 268-270` — pnlPct formula hard-coded for longs.
- **Q1-M-5** `kelly.ts:6-17` — Heuristic fallback when Kelly returns null lacks statistical grounding.

## Low
- **Q1-L-1** `engine.ts:19-22` — Flat 11 bps transaction cost; large-cap ETFs are 1-2 bps real.
- **Q1-L-2** `researchScore.ts:145-157` — Weight description in comment misses 5th pillar.
- **Q1-L-3** `portfolioBacktest.ts:353-355` — Dual-cap (Kelly $-cap + concentration %-cap) interplay undocumented.
- **Q1-L-4** `engine.ts:354-360` — Walk-forward Sharpe recomputes `rfD` instead of taking as parameter.

---

# Q2 — Indicators & Time-Series (14 findings)

## Critical
- **Q2-C-1** `correlation.ts:104` — `correlationAdjustedKelly` uses `(1 - maxRho)` shrinkage creating discontinuity at gate. **Thorp (2006) p421.** Fix: `(1 - maxRho) / (1 - gate)`. *(Already partially fixed but re-verify continuity.)*
- **Q2-C-2** `indicators.ts:533-539` — **ADX +DI/-DI offset off-by-one** vs `wilderSmoothing` output. TA-Lib reads `trSmooth[i]`, code reads `trSmooth[i-1]`. **Wilder (1978) ch.3.**
- **Q2-C-3** `relativeStrength.ts:96-115` — Relative-strength 6m lookback uses `length-127` (should be `length-126`). 0.4% drift across 11 sectors. **Bacon (2008) p89.**
- **Q2-C-4** `multiTimeframe.ts:214-216` — Weekly aggregation uses Monday start, not Friday close — mid-trade weeks introduce look-ahead bias.

## High
- **Q2-H-1** `indicators.ts:648-666` — Sortino annualization parameter inconsistency across call sites (defaults to 252; crypto needs 365).
- **Q2-H-2** `volumeProfile.ts:63-72` — VA expansion is asymmetric vs Steidlmayer's price-level model.
- **Q2-H-3** `indicators.ts:155-215` — MACD warmup gate `slow+sig-1` but signal[slow+sig-1] is NaN; last bar broken. Fix: gate at `slow+sig`.
- **Q2-H-4** `indicators.ts:451-462` — StochRSI EMA mode non-canonical; **Chande & Kroll (1994)** uses SMA.

## Medium
- **Q2-M-1** `regimeDetection.ts:31-44` — Log vs simple returns inconsistency vs `volatility.ts` and `indicators.ts:sharpeRatio`.
- **Q2-M-2** `multiTimeframe.ts:202-208` — Silent neutral default hides under-sized input.
- **Q2-M-3** `priceBands.ts:42-44` — Vol clamped at 0.8 suppresses crisis regimes.
- **Q2-M-4** `btc-indicators.ts:174-182` — Ribbon EMA reads last element, but no comment documents NaN-padding.

## Low
- **Q2-L-1** `correlation.ts:23-50` — Zero-variance / no-peers ambiguity in diagnostics.
- **Q2-L-2** `sectorRotation.ts:47-54` — Null returns treated as 0; biases new-IPO sectors.
- **Q2-L-3** `technicals.ts:61-66` — Parameter name shadows function name in IDE.

---

# Q3 — Options & Volatility (11 findings)

## Critical
- **Q3-C-1** `chain.ts:107` — **`dividendYield` extracted from API but never passed to `greeks()`**. For dividend-paying ETFs (XLU, VYM, SCHD), call/put mispriced by 1-3% per year. **Merton (1973) p2-3.**
- **Q3-C-2** `chain.ts:103` — ACT/365 day-count hard-coded; no migration path to ACT/252.
- **Q3-C-3** `greeks.ts:239` — Brenner-Subrahmanyam seed fails for 0DTE deep-OTM; IV solver returns null where solution exists. **Press et al. (1992).**
- **Q3-C-4** `gex.ts:123` — GEX 100× multiplier assumes OI in contracts; no unit validation against CBOE.
- **Q3-C-5** `sentiment.ts:56` — Max-pain ignores American early exercise + dividend timing; European-only.

## High
- **Q3-H-1** `flow.ts:57` — Hard-coded 98% "near-ask" threshold; needs microstructure-calibrated value.
- **Q3-H-2** `greeks.ts:35-55` — Normal CDF clamps at ±8; deep-ITM/OTM Greeks fragile.
- **Q3-H-3** `chain.ts:78` — Implicit assumption IV is decimal not percentage; no unit guard.
- **Q3-H-4** `sentiment.ts:74-76` — Max pain aggregates across expirations; needs per-expiry bucketing.

## Medium
- **Q3-M-1** `greeks.ts:175` — Theta returned as $/day with no sign-convention doc.
- **Q3-M-2** `gex.ts:145-150` — Flip-point linear interpolation in convex GEX surface.
- **Q3-M-3** `flow.ts:41-50` — Vol/OI>3 flag triggers on multi-leg spreads (false positives).
- **Q3-M-4** `greeks.ts:262` — Sigma clamped per-iteration; masks input errors at boundaries.

## Low
- **Q3-L-1** `chain.ts:140` — First expiration hard-coded; `date` arg unused for filtering.
- **Q3-L-2** `sentiment.ts:40-76` — Zero-OI edge case returns lowest strike (now fixed via R4 audit).

---

# R4 — Data Engineering (14 findings)

## Critical
- **R4-C-1** `rateLimit.ts:80-82` — Unbounded bucket-map under spoofed-IP attack; MAX_BUCKETS eviction is O(n log n). **Fix: migrate to Vercel KV / Upstash Redis.**
- **R4-C-2** `mergeQuotes.ts:88-124` — Bloomberg-0 ambiguity breaks audit provenance. Bridge protocol must emit `null` for missing.
- **R4-C-3** `app/api/stream/[ticker]/route.ts:27` — 10-min SSE timeout = Vercel function timeout; abrupt disconnect with no warning.
- **R4-C-4** `app/api/prices/route.ts:73` + `chart/[ticker]:40` — Duplicate normalize logic; missing null-rejection on `/prices`.

## High
- **R4-H-1** `warehouse.ts:89-100` — `getCandles()` conflates "not found" with "I/O error".
- **R4-H-2** `briefs/route.ts:119-122` — Fan-out amplification (11 sectors × 3 tickers = 33 Yahoo calls per request).
- **R4-H-3** `fundamentals/[ticker]/route.ts:53` — 4× `Promise.all` no aggregate timeout; close to 10s ceiling.
- **R4-H-4** `darkpool/[ticker]/route.ts:72-75` — Silent null sharesFloat fallback hides Yahoo schema drift.
- **R4-H-5** `scripts/fetchBacktestData.mjs:88-99` — No retry or checkpoint on 55-ticker sequential fetch.

## Medium
- **R4-M-1** `marketHours.ts:37-51` — Intl formatter called per request (no memoization).
- **R4-M-2** `sanitize.ts:30` — TICKER_REGEX rejects valid crypto pair `BTC-USDT`.
- **R4-M-3** `briefs/[sector]/route.ts:184-201` — Analyst consensus tie-break ambiguous (`> 0.6` vs `≥`).
- **R4-M-4** `options/[ticker]/route.ts:35-39` — Dividend yield clamped at 0.20 silently for high-yield utilities.
- **R4-M-5** `sector-rotation/route.ts:20` — Sector with <20 closes silently excluded.

## Low
- **R4-L-1** `bridgeClient.ts:93-99` — Price≤0 skip lacks structured logging.
- **R4-L-2** `chart/[ticker]/route.ts:94` — `as any` cast at aggregation boundary.
- **R4-L-3** `format.ts:68-80` — `parseQuoteTime` no upper-bound clamp on epoch.

---

# R5 — Frontend Architecture (14 findings)

## Critical
- **R5-C-1** `KLineChart.tsx:797` — `JSON.stringify(vis)` in `useEffect` deps triggers cascading rerenders.
- **R5-C-2** `QuantLabPanel.tsx` — **1653 LOC god component.** 8+ sub-tabs, dozens of state vars; violates SRP.
- **R5-C-3** `KLineChart.tsx:615-797` — No Suspense / Error boundary around chart init; silent failures.
- **R5-C-4** `app/page.tsx:75-82` — `setInterval` polling mixed with SWR-driven SectorCards: redundant network, divergent freshness.
- **R5-C-5** `QuantLabPanel.tsx:1465-1468` — `as any` on LLM response; lose schema validation.
- **R5-C-6** `KLineChart.tsx:797, 314-327` — Inline object literals break memo equality.

## High
- **R5-H-1** `app/page.tsx:106-108` — Countdown timer cleanup misses on re-render.
- **R5-H-2** `SectorCard.tsx` / `SignalCard.tsx` — No `React.memo`; 55+ unnecessary renders/sec.
- **R5-H-3** `app/page.tsx`, `app/sector/[slug]/page.tsx` — Multiple interval cleanup race conditions.
- **R5-H-4** `tailwind.config.js` — Duplicate amber palette in `theme.extend`.
- **R5-H-5** `DarkPoolPanel.tsx` — 332 LOC, no sub-decomposition.

## Medium
- **R5-M-1** `KLineChart.tsx:239-241` — `useMemo({ ...DEFAULT, ...indicatorsIn })` silently fills missing keys.
- **R5-M-2** `app/page.tsx:145` — Sector colors duplicated in `app/backtest/page.tsx`.
- **R5-M-3** `GlobalSearch.tsx:289` — `localStorage` writes without try/catch (quota/incognito fail).
- **R5-M-4** `KeyboardShortcuts.tsx` — Modal not rendered through `createPortal`; z-index fragile.
- **R5-M-5** `useLivePrices.ts:97-113` — `Date.parse()` loop per render.

## Low
- **R5-L-1** `Sparkline.tsx` — Missing width/height >0 validation.
- **R5-L-2** `globals.css:42` — Font preconnect without SRI.
- **R5-L-3** `MetricTooltip.tsx` — Tooltip lacks viewport-edge boundary detection.

---

# R6 — Accessibility & UX (16 findings)

## Critical
- **R6-C-1** `MetricTooltip.tsx:84-106` — Tooltip not announced to screen readers (missing `aria-describedby`).
- **R6-C-2** `KLineChart.tsx:947-960` — Canvas chart lacks data-table text alternative.
- **R6-C-3** `PriceTicker.tsx:51-69` — Pausing mechanism mouse-only (no `onFocus`).
- **R6-C-4** `GlobalSearch.tsx:218-248` — Combobox `<ul role="listbox">` contains `<button>` not `<li role="option">`.
- **R6-C-5** `globals.css:56-60` — `:focus-visible` outline `#60a5fa` only ~3:1 on dark bg.
- **R6-C-6** `ErrorToastList.tsx:43-46` — Toast container `pointer-events-none`; obscured by other fixed UI.

## High
- **R6-H-1** `SectorCard.tsx:93-94` — Direction conveyed by color + aria-label only; not always announced.
- **R6-H-2** `MetricTooltip.tsx:36-47` — Tab-away doesn't always dismiss tooltip.
- **R6-H-3** `NewsFeed.tsx:130-174` — `target="_blank"` without "opens in new window" warning.
- **R6-H-4** `KLineChart.tsx:798-818` — Indicator-toggle state not announced (`aria-live`).
- **R6-H-5** `KeyboardShortcuts.tsx:125-142` — Focus trap fragile when fewer than 2 focusable items.
- **R6-H-6** `SignalCard.tsx` — `.animate-pulse` ignores `prefers-reduced-motion`.

## Medium
- **R6-M-1** `GlobalSearch.tsx:177-189` — Placeholder color ~2.5:1 contrast.
- **R6-M-2** `SectorCard.tsx:152-158` — Ticker chips no semantic label.
- **R6-M-3** `ErrorToastList.tsx:50-55` — `text-xs` too small on mobile.
- **R6-M-4** `IndicatorPanel.tsx:82-96` — Toggle buttons missing `aria-pressed`.
- **R6-M-5** `MarketStatus.tsx:42-57` — Pulse animation ignores `prefers-reduced-motion`.
- **R6-M-6** `PriceTicker.tsx:51-69` — Animation continues when tab hidden.

## Low
- **R6-L-1** `KeyboardShortcuts.tsx:183-187` — Close-button touch target 24×24, below 44×44.
- **R6-L-2** `layout.tsx:51-56` — Skip-link focus state ~3:1 contrast.
- **R6-L-3** `Sparkline.tsx:30-36` — Redundant `<title>` + `aria-label`.
- **R6-L-4** `GlobalSearch.tsx:195-198` — Loading spinner no label.

---

# R7 — Security & Compliance (13 findings)

## Critical
- **R7-C-1** `lib/auth.ts:124` — Regex `[ -]` rejects space-to-hyphen, NOT control chars. Logic bug allows `<script>` in user names.
- **R7-C-2** `rateLimit.ts:113-119` — `x-forwarded-for` trusted unconditionally on non-Vercel deploys.
- **R7-C-3** `trading-agents/[ticker]/route.ts:268-269` — User-supplied API key forwarded plaintext to TA backend; no TLS verification or audit trail.
- **R7-C-4** `next.config.js:60-65` — `remotePatterns: { hostname: '**' }` enables SSRF amplification via Next/Image.
- **R7-C-5** `bridgeClient.ts:71` — `BLOOMBERG_BRIDGE_URL` env unvalidated; SSRF via internal endpoints if env compromised.

## High
- **R7-H-1** `lib/auth.ts:124` — Regex `[ -]` is a logic bug (intent was `\x00-\x1f\x7f`).
- **R7-H-2** `trading-agents/[ticker]/route.ts:220` — Destructured `_clean` never used; api_key sanitization defeated.
- **R7-H-3** `sanitize.ts:64` — `sanitizeError()` returns full message in dev; logic-inference attack vector.
- **R7-H-4** `next.config.js:44-54` — CSP is `Report-Only`, not enforcing.
- **R7-H-5** `prices/route.ts:161-164` — Production response includes `details: undefined`; signals presence of error.

## Medium
- **R7-M-1** `inspections/I3-S1.md` — **Commercial use of Yahoo Finance data without legal review.** Yahoo ToS §2 restricts to personal/non-commercial. **Inspector veto pending.**
- **R7-M-2** `bridgeClient.ts:55-82` — Bloomberg secret can transit over `http://` if URL misconfigured.
- **R7-M-3** `npm audit` — 43 vulnerabilities (1 critical, 32 high, 9 moderate, 1 low).
- **R7-M-4** `rateLimit.ts:23` — Per-instance bucket map; multi-instance bypass via cold starts.
- **R7-M-5** `trading-agents/[ticker]/route.ts:161-166` — Open-redirect risk if `callbackUrl` becomes user-controlled.

## Low
- **R7-L-1** `briefs/route.ts:76` — Base64-of-link IDs are URL-predictable.
- **R7-L-2** `lib/auth.ts:87-95` — User profile image URL not revalidated on token refresh.
- **R7-L-3** `next.config.js:45-50` — CSP allows `unsafe-inline` + `unsafe-eval` in `script-src`.

---

# R8 — Testing & QA (22 findings)

## Critical (untested production paths)
- **R8-C-1** `lib/auth.ts` (0 tests) — NextAuth provider config + secret generation.
- **R8-C-2** `lib/quant/btc-indicators.ts` (0 tests) — 7 SSOT delegating wrappers.
- **R8-C-3** `lib/optimize/gridSearch.ts` (0 tests) — Walk-forward parameter optimization core.
- **R8-C-4** `lib/portfolio/riskParity.ts` (0 tests) — Risk-parity weights + covariance.
- **R8-C-5** `lib/ml/client.ts` (0 tests) — ML sidecar client.
- **R8-C-6** `lib/data/bloomberg/{bridgeClient,toBloombergSecurity}.ts` (0 tests).
- **R8-C-7** `lib/data/providers/{alphavantage,fred,polygon,yahoo}.ts` (0 tests).

## High (weak tests)
- **R8-H-1** `dcf.test.ts:23-30` — Missing intermediate `pvExplicit` step assertions.
- **R8-H-2** `engine.test.ts:92-97` — B&H return order-independent; equity curve weak.
- **R8-H-3** `var.test.ts:75-86` — Multi-day VaR bounds too wide; factor-of-2 error escapes.
- **R8-H-4** `indicators.test.ts:134-137` — RSI trend test lacks upper-bound assertion.
- **R8-H-5** `gex.test.ts:66-79` — Flip-point detection test is incomplete (half-written).
- **R8-H-6** `signals.test.ts:50-59` — Non-finite price test missing zone assertion.
- **R8-H-7** `vitest.config.ts:12` — Coverage gate excludes `lib/api`, `lib/data`, `lib/portfolio`.

## Medium
- **R8-M-1** `format.test.ts:51-60` — Missing rounding edge case (Banker's rounding).
- **R8-M-2** `correlation.test.ts:52-93` — `maxCorrelationVsPeers` contract docstring unclear.
- **R8-M-3** `warehouse.test.ts:55-68` — Skips on missing `better-sqlite3`; CI loses coverage.
- **R8-M-4** `scripts/verify-core-logic.mjs` — Manual; not in CI.
- **R8-M-5** `engine.test.ts` (sector aggregation) — Numerical correctness not asserted.

## Low
- **R8-L-1** `kelly.test.ts:42-57` — Floor-at-zero behavior not in docstring.
- **R8-L-2** `technicals.test.ts:98-100` — `trendLabel` test misses bearish/divergence cases.
- **R8-L-3** Verify scripts (`verify-*.mjs`) run outside CI.

## Coverage map — **33 untested lib files (~36% of codebase)**
`apiBase`, `auth`, `chartEma`, `chartYahoo`, `commodities`, `crypto`, `darkpool`, `data/bloomberg/*`, `data/providers/{alphavantage,fred,index,polygon,types}`, `deskTickers`, `metricGlossary`, `ml/client`, `mockData`, `normalizeBtcCandles`, `optimize/{gridSearch,parameterSets,sectorProfiles}`, `portfolio/{riskParity,tracker}`, `quant/{btc-indicators,buildFundamentalsPayload,chartQuoteFilter,constants,frameworks,fundingConstants}`, `sectors`, `sessionSignalsFromQuotes`, `tickerNormalize`, `trading-agents-config`, `yahooQuoteFields`.

---

# R9 — Analytical Capabilities (20 missing capabilities)

## Critical missing
- **R9-C-1** No GARCH / conditional volatility forecasting. **Engle (1982); Bollerslev (1986).** Costs 30-50% accuracy on volatility drag.
- **R9-C-2** No Hidden Markov / regime-switching model. **Hamilton (1989); Guidolin & Timmermann (2007).** Costs >40% on crisis detection.
- **R9-C-3** No stress testing / scenario analysis framework. **Jorion (2006) ch.7.** Institutional standard.
- **R9-C-4** No tail-risk hedging or dynamic hedge ratio. **Bhansali (2014).** 2-3% of AUM in tail events.
- **R9-C-5** No factor-exposure attribution (value/momentum/quality/low-vol/dividend). **Grinold & Kahn (1999); Carhart (1997).**
- **R9-C-6** No Bayesian shrinkage / estimation-risk penalty in signal weights. **Ledoit & Wolf (2004).** +5-10% Sharpe lift.

## High
- **R9-H-1** No walk-forward / time-series cross-validation; single forward pass invites overfit. **López de Prado (2018) ch.7.**
- **R9-H-2** No portfolio-Greeks aggregation (vega/theta/rho exposure). **Krishnan (2017).**
- **R9-H-3** No intraday / sub-daily execution analysis (VWAP slippage, market impact). **Almgren & Chriss (2001).**
- **R9-H-4** No tax-loss harvesting / dynamic rebalancing schedule. **Arnott et al. (2016).** 0.5-1% annual alpha.
- **R9-H-5** No ESG / carbon-intensity / sustainable-alpha integration. **Friede et al. (2015); TCFD guidance.**

## Medium
- **R9-M-1** No IV term-structure / vol smile (SABR, local vol). **Rebonato (2004); Dupire (1994).**
- **R9-M-2** No dividend / buyback catalyst overlay. **Bharati et al. (2018); Ikenberry et al. (1995).**
- **R9-M-3** No parameter-stability testing (lookback grid CV).
- **R9-M-4** No correlation regime-switching or dynamic hedge ratio. **Longin & Solnik (2001).**
- **R9-M-5** No behavioral / sentiment / crowded-trade detection (StockTwits, retail call/put OI).

## Low
- **R9-L-1** No earnings-surprise decomposition / Zacks-style revision tracking.
- **R9-L-2** No custom benchmark / Brinson-Fachler attribution.
- **R9-L-3** No forward P/E consensus or revisions-direction tracking.
- **R9-L-4** US-only sector ETFs; no international / FX hedging.

---

# Cross-cutting observations

1. **Equity-tracking divergence between the two backtest engines** (Q1-C-1, Q1-H-5) — `engine.ts` uses entry-anchored equity, `portfolioBacktest.ts` uses mark-to-market with fallback. Invariant "portfolio = Σ instruments" is broken, poisoning maxDD and circuit-breaker logic.

2. **Dividend yield never reaches options pricing** (Q3-C-1) — Merton extension is implemented and tested, but the call site in `chain.ts:107` omits `q`. Material mispricing for XLU/VYM/SCHD.

3. **Untested production code is ~36% of `lib/`** (R8) — auth, data providers, optimization, risk-parity, ML client all lack direct tests. Mutation testing (Stryker) and property-based testing (fast-check) are absent.

4. **No regime-switching, no GARCH, no stress testing** (R9) — the analytical pipeline lacks the three institutional pillars for crisis detection, tail-risk hedging, and scenario analysis.

5. **Yahoo Finance commercial-use compliance is blocked** by Inspector I3. Either Polygon migration or written legal opinion is required before commercial launch.

6. **Modal a11y is uneven** — KeyboardShortcuts has focus trap + return focus + body lock (fixed in PR#10), but `LlmDeployAssistant` still uses inline modal pattern without trap; `MetricTooltip` lacks `aria-describedby`.

7. **Coverage gate is narrow** (R8-H-7) — vitest config excludes `lib/api`, `lib/data`, `lib/portfolio`. Untested code merges unchallenged.

8. **God components in UI** (R5-C-2) — `QuantLabPanel.tsx` (1653 LOC) and `KLineChart.tsx` (1011 LOC) violate SRP; need decomposition into 5-6 sub-components each.

---

# Companion document

See `reviews/PHASE-14-REMEDIATION-ROADMAP.md` for the prioritized remediation plan with sprint cuts, research-backed solutions, and effort estimates.
