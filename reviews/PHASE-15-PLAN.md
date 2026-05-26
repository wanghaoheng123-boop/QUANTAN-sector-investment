# Phase 15 — Forward Improvement Plan

**Authored:** 2026-05-23
**Predecessor:** Phase 14 (138 findings catalogued; 54 FIXED, 33 explicit-OPEN, 51 implicit-closed-via-waves; plan: `reviews/PHASE-14-REMEDIATION-ROADMAP.md`)
**Scope:** Close Phase 14 carry-over + harden new surfaces introduced in waves 35–41 (SSE real-time, JSON-Date class, options chain) + advance institutional analytics (FRED RFR, GARCH, HMM, scenario engine, factor attribution).
**Duration target:** ~6 calendar weeks, 2–3 engineers + 1 quant + 1 PM in parallel.

---

## Team composition (track ownership)

This plan is organised by **team track**, not just sprint number. Each track has an owner; the PM sequences across tracks at the daily stand-up.

| Track | Owner | Mandate |
|---|---|---|
| **PM** | C1 — Tech Lead | Prioritisation, gate enforcement, scope discipline, compliance sign-off |
| **Quant Research** | Q1 — PhD Finance + AI/ML researcher | FRED RFR, GARCH, HMM, scenario engine, factor attribution, dividend-aware B&H |
| **Frontend** | F1 — Principal FE | God-component decomposition, design tokens, a11y carry-over, SSE wiring uniformity |
| **Data / Platform** | D1 — Staff DE | Vercel KV rate-limit, Polygon migration, SSE lifecycle hardening, FRED client, warehouse provenance |
| **Security** | S1 — CISSP | Auth regex P0, CSP enforcing, hostname whitelist, CSRF, npm audit fix |
| **Testing / DX** | T1 — Staff SDET | Untested lib coverage, Stryker mutation, fast-check property-based, axe-core CI, component tests |

All tracks share the **Inspector veto** rule from Phase 14: any of I1–I4 can block merge regardless of reviewer approvals.

---

## Frozen baseline (Phase 15 invariants — must not regress)

Captured 2026-05-23, post wave 41 (PR #16, commit `7321b54`).

| Metric | Current | Floor for Phase 15 |
|---|---|---|
| Aggregate WR (benchmark-signals.mjs) | **57.05%** | ≥ 56.55% (50 bps tolerance; auto-block below) |
| Avg WR per instrument | 58.57% | ≥ 58.07% |
| Avg 20-d return / signal | 1.409% | ≥ 1.20% |
| BUY signals on 56-instrument universe | 1,390 (793 W / 597 L) | ≥ 1,300 (smaller signal count = stricter; track but do not gate) |
| Test files | **48** | ≥ 48 (never drop) |
| Tests passing | **798** | ≥ 798 (never drop) |
| Largest component LOC | **1,684** (`QuantLabPanel.tsx`) | ≤ 500 by end of S3 (decomposition) |
| Largest lib LOC | **807** (`engine.ts`) | ≤ 600 by end of S2 |
| `any` casts (justified + unjustified) | 5 files / ~7 sites | ≤ 5 sites, all with `// reason:` comment + reviewer ack |
| Silent `.catch(() => {})` | 0 in lib/app/components | 0 (enforced) |
| Circular imports | 0 (madge verified) | 0 |
| Yahoo TOS compliance banner | present | retained until Polygon migration complete |

**Re-freeze trigger:** when **F1.4** (FRED RFR) and **F1.5** (dividend-aware B&H) land, the WR baseline shifts because Sharpe / Sortino / Buy-and-Hold comparisons change. C2 (Algorithm Lead) re-runs benchmark on the post-merge tip and updates this row with sign-off. Pre-merge gate uses the *old* floor; post-merge floor becomes the new measurement.

**Reproducibility:** `node scripts/benchmark-signals.mjs > /tmp/run1 && node scripts/benchmark-signals.mjs > /tmp/run2 && diff /tmp/run1 /tmp/run2` must remain identical.

---

# Section 1 — Phase 14 Carry-Over (33 explicit-open + 4 audit-verified-still-open)

These items were catalogued in Phase 14 but never landed. Cross-reference by finding ID; full remediation text lives in `reviews/PHASE-14-REMEDIATION-ROADMAP.md`.

## P0 — Verified still-broken (audit 2026-05-23 + 2026-05-23 in-session execution)

| ID | Severity | File:Line | One-line | Verified via |
|---|---|---|---|---|
| ~~R7-C-1 / P15-NEW-1~~ | ~~CRITICAL~~ | ~~`lib/auth.ts:124`~~ | **FALSE POSITIVE.** Re-verified 2026-05-23 by `od -c` + live `safeStringField` eval: file bytes are `[\x00-\x1f\x7f]` (correct control-char class). The Read tool rendered NUL/US/DEL bytes as visual space/hyphen which mimicked `/[ -]/`. F7.9 wrapper + predicate both correctly landed. **No fix needed.** | Live JS eval ('John Smith' accepted; 'user\x00name' rejected) |
| **R7-C-4 / F-NEW** | CRITICAL | `next.config.js:65` | `remotePatterns: { hostname: '**' }` — TODO comment in file acknowledges SSRF amplification still open | Direct file read |
| **R7-H-4** | HIGH | `next.config.js:46` | `Content-Security-Policy-Report-Only` — never flipped to enforcing | Direct file read |
| **R7-L-3** | LOW | `next.config.js:48` | CSP allows `'unsafe-inline' 'unsafe-eval'` in `script-src` | Direct file read |

**Lesson learned (2026-05-23):** The Read tool renders ASCII control bytes (NUL 0x00, US 0x1f, DEL 0x7f) in a way that can visually mimic harmless characters. Always verify regex/security-sensitive predicates with `od -c` on the file AND live eval, never by re-typing from the displayed text.

## Open in ledger (33 items)

Severity counts: **3 Critical, 17 High, 11 Medium, 2 Low**. Full list (sorted by track):

### Quant Research carry-over (5)
- **F1.4** HIGH — RFR hardcoded 0.045 (was 0.04 Q1-H-2); replace with FRED DGS3MO / DGS1 lookup keyed by backtest window
- **F1.5** HIGH — B&H comparison ignores dividends; load dividend stream from Yahoo `historical()` `dividends` array
- **F1.11** MEDIUM — RSI score linear `(rsi-50)/40`; should be piecewise per Wilder (1978) p65 + Murphy (1999) p243
- **F1.22** MEDIUM — `atrAdaptiveStop` includes still-forming entry bar (1-bar look-ahead micro-bias)
- **F3.9** HIGH — `OPTIONS_RFR_ANNUAL = 0.0525` hardcoded for ALL tenors; tenor-matched from FRED required

### Frontend Architecture carry-over (8)
- **F5.2** HIGH — `QuantLabPanel.tsx` 1,684 LOC (grew from 1,649); decompose to ≤ 5 sub-tabs
- **F5.3** HIGH — `app/backtest/page.tsx` 887 LOC; decompose to page (≤200) + panels
- **F5.5** MEDIUM — 37 inline styles; extract design tokens (`lib/theme/tokens.ts`)
- **F5.6** MEDIUM — 32 ARIA attrs sparse; cross-component sweep
- **F5.7** MEDIUM — dark-card pattern duplicated; extract `<Card>` primitive
- **F5.9** LOW — `app/backtest/page.tsx:665` `Record<string,unknown>` losing types
- **F5.10** LOW — local formatters duplicate `lib/format.ts`
- **F-NEW** HIGH — `KLineChart.tsx` 1,014 LOC, `app/crypto/btc/page.tsx` 806 LOC, `BtcQuantLab.tsx` 516 LOC — still over budget

### Data / Platform carry-over (3)
- **F4.3 / F7.7** HIGH — `lib/api/rateLimit.ts` per-process bucket; migrate to Vercel KV (Upstash Redis)
- **F4.5 / F7.8** HIGH — Yahoo commercial-use disclaimer banner present, but Polygon migration plan not actioned
- **F-NEW** HIGH — `app/crypto/btc/page.tsx:556` still uses `setInterval(60_000)` for REST quote fallback — wire to SSE

### Security carry-over (6)
- **F7.2** HIGH — `lib/api/reliability.ts:50` error responses still leak internals (sanitizeError covers `app/api`, not `lib/api`)
- **F7.3** HIGH — Ticker whitelist fuzz test absent; `lib/api/sanitize.ts:TICKER_REGEX` not property-tested
- **F7.4** HIGH — POST routes (trading-agents, backtest) lack CSRF protection
- **F7.5** MEDIUM — Bloomberg bridge secret comparison not timing-safe
- **F7.7** MEDIUM — Rate-limit (cross-ref F4.3)
- **F7.8** MEDIUM — Yahoo ToS (cross-ref F4.5)

### Accessibility carry-over (3)
- **F6.5** MEDIUM — Sparse focus management cross-component
- **F6.7** MEDIUM — `KeyboardShortcuts.tsx` focus trap + dialog semantics need verify (despite Phase 14 work)
- **F6.8** MEDIUM — `aria-live` underused for live SSE updates (relevant to ticker / price changes)

### Testing carry-over (8)
- **F8.1** CRITICAL — 11 hot-path modules with zero tests
- **F8.2** HIGH — Zero component tests
- **F8.3** HIGH — No Stryker mutation testing
- **F8.4** HIGH — Zero API integration tests
- **F8.5** MEDIUM — No property-based tests (fast-check)
- **F8.6** MEDIUM — `vitest.config.ts` coverage gate excludes `lib/api`, `lib/data`, `lib/portfolio`, `lib/optimize`, `lib/ml`, `lib/portfolio`, `lib/hooks`
- **F8.7** MEDIUM — Smoke tests not in PR CI
- **F8.8** LOW — Space-in-path blocks local vitest from worktree (workaround documented)

---

# Section 2 — Phase 15 New Findings (audit 2026-05-23)

Findings discovered post-PR#16 that are NOT in the Phase 14 ledger.

## ~~P15-NEW-1 (Security, CRITICAL) — `lib/auth.ts:124` regex~~ — **WITHDRAWN 2026-05-23**

After this plan was drafted, in-session execution attempted to apply the fix and discovered the file ALREADY contains the correct regex. Re-verification:

```bash
$ od -c lib/auth.ts | grep -A0 'if (.*test.trimmed'
  i f   ( / [ \0 - 037 177 ] / . t e s t ...
```

That's `[\x00-\x1f\x7f]` (NUL through Unit-Separator, plus DEL) — the canonical control-char class. Live JS eval on the actual function:

```
safeStringField('John Smith')  → 'John Smith'   (accepted)
safeStringField('Mary-Jane')   → 'Mary-Jane'    (accepted)
safeStringField('<script>')    → '<script>'     (accepted — escape at render)
safeStringField('user\x00name') → undefined     (rejected ✓)
safeStringField('Alice')       → 'Alice'        (accepted)
```

**Root cause of false-positive flag:** The Read tool renders bytes 0x00 / 0x1f / 0x7f as visual space-or-hyphen-like glyphs, so a line containing `[\x00-\x1f\x7f]` reads back as `[ -]`. When I re-typed `/[ -]/` into a Node REPL to "verify", I was testing a regex I'd manually typed, NOT the file's actual regex. F7.9 in the ledger was correctly marked FIXED — the wrapper AND the predicate landed in Phase 13 S2.

**Status:** No code change. Backlog **Q-039-NEW marked done with evidence**.

## P15-NEW-2 (Data, HIGH) — Crypto page setInterval not on SSE
- **File:** `app/crypto/btc/page.tsx:555-556`
- **Code:** `setTimeout(loadRestQuote, 4000); setInterval(loadRestQuote, 60_000)`
- **Bug:** Crypto BTC page still polls REST every 60s as the *primary* feed, even though `wss://ws.kraken.com/v2` and `wss://ws-feed.exchange.coinbase.com` are connected. The 60s REST poll is a fallback, but the architecture is the reverse of the equity pages (which moved to SSE primary).
- **Fix:** Make WebSocket primary; REST poll only fires when WS has had `> 120s` since last message OR `onerror` fired ≥ 2 times.
- **Citation:** RFC 6455 §1.1 — WebSocket designed for low-latency, bidirectional; polling defeats the purpose.
- **Acceptance test:** Integration — drop WS connection, assert REST poll arms within 120s; reconnect WS, assert REST disarms within 1 tick.
- **Effort:** 1 day.

## P15-NEW-3 (Frontend, MEDIUM) — `app/sector/[slug]/page.tsx:103` setInterval coexists with SSE
- **File:** `app/sector/[slug]/page.tsx:103`
- **Bug:** Page now uses `useLiveQuote` (wave 37), but a `setInterval` block at L103 still fires every N seconds for refresh. Two refresh paths = redundant network + divergent freshness.
- **Fix:** Remove the `setInterval` block; SSE event handler triggers the refresh.
- **Effort:** 0.25 day.

## P15-NEW-4 (Data, MEDIUM) — `useLiveQuote` reconnect storm under network flap
- **File:** `hooks/useLiveQuote.ts`
- **Bug:** Exponential backoff `[1000, 2000, 4000, 8000]` resets to 1000 on every successful connection. If the network flaps every 9–10s (mobile / café WiFi), backoff never compounds, producing a reconnect storm.
- **Fix:** Track last-success-duration; only reset backoff if `connectionDurationMs > 30_000`.
- **Citation:** AWS Architecture Blog (Brooker 2015) — "Timeouts, retries, and backoff with jitter."
- **Acceptance test:** Property test — simulate 100 flap cycles with 9s up / 1s down; assert reconnect attempts ≤ 15.
- **Effort:** 0.5 day.

## P15-NEW-5 (Performance, MEDIUM) — `QuantLabPanel.tsx` 25+ `useState` calls
- **File:** `components/stock/QuantLabPanel.tsx:174-215`
- **Bug:** Each `useState` triggers an independent render on update. The LLM-analysis branch alone has 12+ pieces of state that change in a coordinated way (loading → response → error). Renders the entire 1,684-LOC component on each state change.
- **Fix:** Consolidate LLM state into `useReducer` (1 dispatch = 1 render). Pulls the panel toward the F5.2 decomposition.
- **Citation:** Abramov D. (2020) "useReducer Hook" — reducer pattern for coordinated state.
- **Effort:** 1 day (paired with F5.2 decomposition; can land standalone first).

## P15-NEW-6 (Quant, MEDIUM) — `lib/options/chain.ts:234` MIN_TRADABLE_TIME_YEARS hardcoded
- **File:** `lib/options/chain.ts:234`
- **Code:** `const MIN_TRADABLE_TIME_YEARS = 1 / (365 * 24) // 1 hour`
- **Bug:** Wave 40 fix introduced this hardcoded "1 hour" cutoff. After-hours flow (where institutional orders show up) and weekly 0-DTE need a smaller cutoff (e.g., 15 minutes). A symbol whose chain has only Friday-expiry contracts and is queried Friday at 15:30 ET would skip to the NEXT expiry, losing visibility into the contracts dealers are pricing aggressively.
- **Fix:** Lower to `15 / (365 * 24 * 60)` (15 minutes); document the trade-off in code.
- **Citation:** CBOE rule book §6.1 — equity options trade until 16:00 ET.
- **Acceptance test:** Mock chain with `expiration = now + 30min`; assert chain returns that expiry (not the next one).
- **Effort:** 0.25 day.

## P15-NEW-7 (Data, MEDIUM) — `app/api/stream/[ticker]/route.ts:198-218` autoCloseTimer chained
- **File:** `app/api/stream/[ticker]/route.ts:198-218`
- **Bug:** `closeWarnTimer` and `autoCloseTimer` are two separate `setTimeout` calls. If the function clock skews, the warn could fire AFTER the close (silent reconnect failure). Should be one timer that emits then auto-closes.
- **Fix:** Single `setTimeout(STREAM_AUTO_CLOSE_MS - 30_000)` → emits `closing_soon`, schedules `setTimeout(30_000)` → emits `close` and `controller.close()`.
- **Effort:** 0.25 day.

## P15-NEW-8 (Frontend, MEDIUM) — Multiple pages with redundant `setInterval`
- **Files:** `app/sector/[slug]/page.tsx:103`, `app/commodities/page.tsx:51`, `app/heatmap/page.tsx:47`, `app/desk/page.tsx`, `components/MarketStatus.tsx:36`, `components/crypto/BtcQuantLab.tsx:158`
- **Bug:** 6 distinct `setInterval` loops survive across pages. Some are legitimate (market-hours tick at 60s for MarketStatus), but the page-level ones overlap with SWR / SSE freshness.
- **Fix:** Audit each; convert pages whose data is on SSE to event-driven; leave time-only ticks (MarketStatus) alone.
- **Effort:** 1 day (audit + 6 patches).

## P15-NEW-9 (Testing, LOW) — `useLiveQuote` / `useLiveQuotes` tests cover the parser, not lifecycle
- **Files:** `hooks/useLiveQuote.ts`, `hooks/useLiveQuotes.ts`
- **Bug:** Only the pure `parseLiveQuote` is tested. The EventSource lifecycle (open / message / error / close / cleanup) is not.
- **Fix:** Add tests via `vi.spyOn(global, 'EventSource').mockImplementation(...)` — verify cleanup runs on component unmount, backoff is applied on error, market_state event flips `marketOpen`.
- **Effort:** 1 day.

## P15-NEW-10 (Quant, MEDIUM) — `lib/backtest/engine.ts` is now 807 LOC (was 691 baseline)
- **File:** `lib/backtest/engine.ts`
- **Bug:** Grew 116 LOC in Phase 13–14. Now over the S3 lib target of ≤ 600. Drift from baseline.
- **Fix:** Extract walk-forward analysis into `lib/backtest/walkForward.ts`; engine.ts retains the bar-loop and exit logic.
- **Effort:** 1.5 days.

## P15-NEW-11 (Frontend, LOW) — 19 files contain `as any`
- **Files:** `lib/mockData.ts:135`, `components/KLineChart.tsx:39`, `components/stock/QuantLabPanel.tsx:1470`, `app/api/chart/[ticker]/route.ts:80, 99, 206`, `app/api/auth/[...nextauth]/route.ts:7`
- **Status:** 5 of these are documented with rationale (e.g., NextAuth type drift, mockData price-history-vs-time mismatch). 0 of these add new schema-drift risk.
- **Fix:** Each `as any` gets a `// reason:` comment in line with reviewer ack OR is replaced. Add ESLint rule (`@typescript-eslint/no-explicit-any` warn) to block new ones.
- **Effort:** 0.5 day.

## P15-NEW-12 (Data, LOW) — Polygon + AlphaVantage + FRED providers exist but no providers/index orchestration
- **Files:** `lib/data/providers/index.ts`, `lib/data/providers/polygon.ts`, `lib/data/providers/alphavantage.ts`, `lib/data/providers/fred.ts`
- **Bug:** Provider classes exist but no dispatcher chooses between them based on env config + tenant. Migration plan from Yahoo → Polygon is not wired even at the code level.
- **Fix:** Implement `lib/data/providers/dispatcher.ts` that returns the active provider per data class (`equity-eod`, `equity-quote`, `macro-series`, `crypto-quote`) based on env keys, with falls-back-to-Yahoo by default.
- **Effort:** 2 days.

---

# Section 3 — Phase 15 New Capability (institutional analytics carry-over)

These were R9 items in the Phase 14 critique log. They are not "bugs" — they are missing capabilities for institutional defensibility. Phase 15 advances them so the platform can be defended in front of paying researchers.

| ID | Priority | What | Citation | Effort |
|---|---|---|---|---|
| **R9-C-1** | P0 (S2) | GARCH(1,1) conditional volatility via Python sidecar | Engle (1982); Bollerslev (1986) | 4 days |
| **R9-C-2** | P0 (S2) | Hidden Markov 3-state regime detector | Hamilton (1989); Guidolin & Timmermann (2007) | 5 days |
| **R9-C-3** | P1 (S3) | ScenarioEngine for stress testing (Fed +100bps, S&P -10%, VIX +50%, 2008-style, COVID, Flash-Crash) | Jorion (2006) Ch.7 | 6 days |
| **R9-C-4** | P1 (S3) | Tail-risk hedging rules (auto-alert when skew < −0.5 + drawdown > 8%) | Bhansali (2014) | 3 days |
| **R9-C-5** | P2 (S4) | Factor exposure attribution (MKT, SMB, HML, MOM, QMJ — 5 factors) | Carhart (1997); Fama-French (2015) | 4 days |
| **R9-C-6** | P2 (S4) | Bayesian shrinkage on signal-weight bonuses | Ledoit & Wolf (2004) | 3 days |
| **R9-H-2** | P1 (S3) | Portfolio Greeks aggregation (Δ, Γ, ν, θ, ρ across open positions) | Krishnan (2017) | 2 days |

---

# Section 4 — Sprint plan

Sprint cadence: **4 sprints × ~7 working days each = ~5–6 calendar weeks** with 2–3 engineers in parallel.

## Sprint S1 — Security P0 + Phase 14 carry-over (≤ 5 days)

**Theme:** Close the bleeding before adding new capability.

| ID | Track | Owner | Effort | Acceptance |
|---|---|---|---|---|
| P15-NEW-1 (auth regex) | Security | S1 | 0.5d | `__tests__/lib/auth.test.ts` 6 cases pass; production names "John Smith" accepted |
| R7-C-4 (`hostname: '**'`) | Security | S1 | 0.5d | `next.config.js` lists explicit hosts; smoke test passes on all news / yahoo thumb URLs |
| R7-H-4 + R7-L-3 (CSP enforcing + remove unsafe-inline) | Security | S1 | 2d | 1 week of Report-Only → flip → no violations; nonces wired via middleware |
| F7.2 (`reliability.ts:50` sanitize) | Security | S1 | 0.25d | error responses contain `error` code only, no stack |
| F7.3 (ticker whitelist fuzz) | Security + Testing | S1 + T1 | 1d | `__tests__/lib/api/sanitize.fuzz.test.ts` via fast-check: 10k random inputs, no crash |
| F8.6 (coverage gate expansion) | Testing | T1 | 0.5d | `vitest.config.ts` adds `lib/api`, `lib/data`, `lib/portfolio`, `lib/optimize`, `lib/ml`, `lib/hooks` |
| F8.7 (smoke in CI) | Testing | T1 | 0.5d | `.github/workflows/ci.yml` runs `check:smoke:extended` on PR |
| P15-NEW-7 (SSE chained timers) | Data | D1 | 0.25d | Property test — clock-skew sim, close always after warn |
| P15-NEW-3 (sector page setInterval) | Frontend | F1 | 0.25d | Page passes SSE-only smoke; no redundant fetch |

**Exit gate:** Security P0s closed; coverage gate broadened; auth tests written.

**Total:** ~5.75 person-days (1 engineer × ~6 days, or parallelisable to ~3 days with 2).

## Sprint S2 — Quant Research + Data Platform (≤ 8 days)

**Theme:** Wire institutional-grade rates + first conditional-vol model + Vercel KV.

| ID | Track | Owner | Effort | Acceptance |
|---|---|---|---|---|
| F1.4 (FRED RFR replacing 0.045) | Quant + Data | Q1 + D1 | 1.5d | `lib/quant/rfr.ts` wraps FRED DGS3MO/DGS1 with 24h cache; pass-through to `engine.ts:373/385/525/601` |
| F3.9 (Options RFR tenor-matched) | Quant + Data | Q1 + D1 | 0.5d | Tenor matched: ≤90d → DGS3MO; ≤1y → DGS1; ≤2y → DGS2 |
| F1.5 (B&H dividend-aware) | Quant | Q1 | 1d | `yahooFinance.historical()` → dividend stream; B&H total-return = price + dividends |
| F4.3 / F7.7 (Vercel KV rate-limit) | Data | D1 | 1.5d | `lib/api/rateLimitKv.ts` uses `kv.eval(lua)`; fallback to in-memory if no `KV_URL` env |
| F1.22 (atrAdaptiveStop look-ahead) | Quant | Q1 | 0.5d | Stop uses `bars[0..currentBar-1]`; entry bar excluded |
| F1.11 (RSI piecewise score) | Quant | Q1 | 1d | RSI < 30 → +1.0; 30–70 → linear; > 70 → −1.0; per Wilder (1978) |
| R9-C-1 (GARCH sidecar) | Quant | Q1 | 4d | `quant_framework/garch.py` w/ `arch` library; `/api/conditional-vol/[ticker]` route + TS client; UI hook in stock detail |
| P15-NEW-2 (crypto WS primary) | Data | D1 | 1d | WS primary + REST fallback on flap; integration test asserts behaviour |
| P15-NEW-6 (options 15-min cutoff) | Quant | Q1 | 0.25d | Mock chain at `now + 30min` returns that expiry |
| P15-NEW-4 (`useLiveQuote` flap-aware backoff) | Frontend | F1 | 0.5d | Property test 100 flap cycles |

**Exit gate:**
- Benchmark re-runs with new RFR + dividends; **C2 re-freezes baseline** (see §"Frozen baseline").
- GARCH conditional vol visible in stock detail page.
- Vercel KV active in production (`process.env.KV_URL` set).

**Total:** ~11.75 person-days, parallelisable to ~6 working days with 2 engineers + 1 quant.

## Sprint S3 — God-component decomposition + Scenario engine (≤ 10 days)

**Theme:** Pay the architectural debt before more capability lands on top of it.

| ID | Track | Owner | Effort | Acceptance |
|---|---|---|---|---|
| F5.2 (`QuantLabPanel.tsx` 1684 → ≤500) | Frontend | F1 | 5d | 5 sub-tabs each ≤ 400 LOC; behaviour-equivalence snapshot tests |
| F5.3 (`app/backtest/page.tsx` 887 → ≤200) | Frontend | F1 | 2d | Page is a thin shell over presentational components |
| F-NEW (`KLineChart.tsx` 1014 → ≤500) | Frontend | F1 | 3d | Plugin registry per `ChartPlugin`; Suspense + ChartErrorBoundary wrap |
| F-NEW (`app/crypto/btc/page.tsx` 806 → ≤300) | Frontend | F1 | 2d | Decompose price-feed orchestration + chart |
| P15-NEW-5 (`useReducer` consolidation in QuantLab LLM) | Frontend | F1 | 1d | Single dispatch per state transition; renders /3 |
| P15-NEW-10 (`engine.ts` 807 → ≤600 via walkForward extract) | Quant | Q1 | 1.5d | New `lib/backtest/walkForward.ts`; engine.ts holds bar-loop only |
| R9-C-3 (ScenarioEngine) | Quant | Q1 | 6d | `lib/scenarios/engine.ts` + `/risk/scenarios` route; 6 canned scenarios + custom |
| R9-C-4 (Tail-risk hedging alerts) | Quant + Frontend | Q1 + F1 | 3d | Alert when skew < -0.5 AND vol > mean; suggest protective puts |
| R9-H-2 (Portfolio Greeks aggregation) | Quant | Q1 | 2d | `lib/portfolio/greeks.ts` sums Δ Γ ν θ ρ across open positions |
| F5.5 (design tokens) | Frontend | F1 | 2d | `lib/theme/tokens.ts`; sector colors + semantic colors extracted |
| F5.6 (ARIA sweep) | Frontend + A11y | F1 + R6 | 2d | axe-core zero criticals on 5 priority routes |
| F8.3 (Stryker mutation setup) | Testing | T1 | 2d | `stryker.conf.mjs`; first run shows score (baseline) |

**Exit gate:**
- Zero components > 500 LOC; zero lib files > 600 LOC (engine, signals, indicators all under).
- Scenario page renders 6 canned scenarios.
- Mutation score baseline recorded (target ≥ 70% by S4).

**Total:** ~31 person-days, parallelisable to ~10 working days with 2 FE + 1 quant + 1 SDET.

## Sprint S4 — HMM regime + Factor attribution + Testing depth (≤ 7 days)

**Theme:** Land remaining institutional capabilities + raise the testing bar.

| ID | Track | Owner | Effort | Acceptance |
|---|---|---|---|---|
| R9-C-2 (HMM regime detector) | Quant | Q1 | 5d | `quant_framework/regime_hmm.py` w/ `hmmlearn`; `/api/regime/[ticker]` route; UI consumes as primary signal, ADX → confirmer |
| R9-C-5 (Factor attribution) | Quant | Q1 | 4d | 5-factor regression (MKT, SMB, HML, MOM, QMJ); monthly attribution report |
| R9-C-6 (Bayesian shrinkage on bonuses) | Quant | Q1 | 3d | `Beta(2,8)` prior; bonus scaled by posterior credibility |
| F8.1 (untested hot-path lib coverage) | Testing | T1 | 5d | Test files for: `auth.ts`, `gridSearch.ts`, `riskParity.ts`, `bridgeClient.ts`, `polygon.ts`, `yahoo.ts`, `fred.ts`, `ml/client.ts`, `btc-indicators.ts`, `buildFundamentalsPayload.ts` |
| F8.2 (component test infra) | Testing | T1 | 1d | `@testing-library/react` + vitest jsdom env; first 3 component tests |
| F8.4 (API integration tests) | Testing + Data | T1 + D1 | 2d | `__tests__/api/` with mocked yahoo / FRED; 5 routes covered |
| F8.5 (fast-check property tests) | Testing | T1 | 2d | Property tests for `pearsonCorrelation`, `kellyFraction`, `evaluateStopHit`, `safeFixed`, portfolio backtest equity ≥ 0 |
| P15-NEW-12 (provider dispatcher) | Data | D1 | 2d | `lib/data/providers/dispatcher.ts` returns active provider per data class |
| F4.5 / F7.8 (Polygon migration kick-off) | Data + PM | D1 + C1 | 2d code + external (legal opinion ~1 week parallel) | Migrate `lib/data/providers/polygon.ts` to primary for equity-eod when `POLYGON_API_KEY` set |
| F7.4 (CSRF protection on POST routes) | Security | S1 | 1d | Double-submit cookie pattern on `trading-agents`, `backtest` |
| F7.5 (timing-safe Bloomberg comparison) | Security | S1 | 0.5d | `crypto.timingSafeEqual` |
| F6.7 / F6.5 / F6.8 (a11y carry-over) | Frontend + A11y | F1 + R6 | 2d | Modal focus trap verified; aria-live wired to ticker SSE updates |
| F-NEW (npm audit fix) | Security | S1 | 1d | `npm audit --audit-level=high` exits 0; breaking changes resolved |

**Exit gate (Phase 15 sign-off):**
1. All 4 P0s closed (auth regex, hostname whitelist, CSP enforcing, error sanitize).
2. WR ≥ 56.55% (50 bps tolerance below pre-FRED baseline) OR ≥ post-FRED re-frozen floor.
3. Coverage ≥ 80% on `lib/quant`, `lib/backtest`, `lib/options`, `lib/api`, `lib/data`, `lib/portfolio`.
4. Mutation score ≥ 70% on `lib/quant`, `lib/backtest`, `lib/options`.
5. axe-core zero criticals on 5 priority routes.
6. CSP enforcing in production; 1 week of zero violation reports.
7. GARCH conditional vol visible.
8. HMM regime detector live; consumed by signals.
9. Scenario engine renders 6 canned scenarios.
10. Tail-risk alert wired.
11. Factor attribution shows on portfolio page.
12. Polygon provider operational (gated by env key); Yahoo fallback retained for free tier.
13. Reproducibility hash matches across 2 benchmark runs.

**Total:** ~32 person-days, parallelisable to ~8 working days with 2 quants + 1 SDET + 1 security + 1 data.

---

# Section 5 — Cross-cutting quality gates

Every PR in Phase 15 must clear:

| Gate | Tool | Threshold | Owner |
|---|---|---|---|
| Type check | `tsc --noEmit` | zero errors | All |
| Test suite | `vitest run` | 100% pass; ≥ 798 tests | T1 |
| Coverage | `vitest --coverage` | ≥ 80% lines (broadened scope) | T1 |
| Mutation | `stryker run` (from S4) | ≥ 70% on quant + backtest + options | T1 |
| Lint | `eslint . --ext .ts,.tsx` | zero errors | T1 |
| Dead-code | `knip` | zero unused exports outside skiplist | T1 |
| Duplication | `jscpd lib app components --threshold 3` | < 3% duplicate-block ratio | T1 |
| Circular imports | `madge --circular .` | 0 | T1 |
| Bundle size | `next build --profile` | ≤ 10% growth per sprint | F1 |
| Benchmark | `npm run benchmark` | WR ≥ 56.55% (pre-FRED) or post-FRED floor | C2 |
| Portfolio test | `scripts/portfolio-backtest.ts` | WR ≥ 55%, maxDD ≤ 20% | Q1 |
| Reproducibility | hash-match across 2 runs | identical (modulo timestamps) | T1 |
| `npm audit` | `--audit-level=high` | zero high+ vulnerabilities | S1 |
| Accessibility | axe-core in CI on 5 priority routes | zero critical | F1 + R6 |
| Security headers | curl + Mozilla Observatory | A grade | S1 |
| CSP | `report-uri` collector | zero violations / week | S1 |

---

# Section 6 — Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FRED API outage during a backtest | Medium | High (no rates → no Sharpe) | 24h cache + last-known-good fallback + sentinel for stale > 7d |
| Polygon free tier insufficient (5 req/min) | High | Medium | Keep Yahoo as fallback; gate migration on paid plan |
| GARCH Python sidecar latency > 500ms | Medium | Low | Cache forecast for 24h; UI shows stale-with-asof |
| HMM model regimes don't stabilise | Medium | Medium | Use Viterbi-decoded states with min-duration ≥ 5 bars; reject single-bar flips |
| God-component refactor causes visual regression | High | High | Behaviour-equivalence snapshot tests pre-decomposition; Playwright visual diffs |
| Vercel KV cost overrun | Low | Medium | Set `EX` ttl on every key; alert at 80% of free tier |
| Auth regex fix breaks existing sessions | Low | High | Deploy behind feature flag; monitor sign-in failure rate for 24h |
| CSP enforcing breaks third-party widget | Medium | Medium | 1 week Report-Only; survey violations; nonce-based fix |
| Phase 14 WR floor blocks Phase 15 quant changes | Medium | High | Re-freeze floor in S2 after F1.4 + F1.5 land (see §"Frozen baseline") |
| Scope creep into mobile / multi-tenant | Low | High | C1 hard-rejects any PR touching Out-of-scope items |

---

# Section 7 — Out of scope (Phase 15)

Explicit no-go list. Any PR touching these is auto-rejected by C1; they are Phase 16+.

- Mobile-native app
- Multi-tenancy / billing
- Order routing / live brokerage integration
- HFT or sub-second execution
- International / FX-hedged sector overlay
- Alternative data sources beyond Polygon (no Refinitiv, no Bloomberg redistribution)
- Live retraining of Python ML sidecar (Phase 16+)
- WebGL / Canvas-based chart re-platform (lightweight-charts is the chosen library)

---

# Section 8 — Acceptance criteria for Phase 15 sign-off

Final inspector pass. All must be true:

1. **Security:** Auth regex CWE-697 fixed; CSP enforcing for ≥ 7 days zero violations; hostname whitelist applied; npm audit clean.
2. **Quant correctness:** FRED RFR + dividend-aware B&H landed; benchmark re-frozen with C2 sign-off; WR ≥ post-FRED floor.
3. **Architecture:** Every component ≤ 500 LOC; every lib file ≤ 600 LOC; engine.ts split.
4. **Capability:** GARCH live; HMM regime live; ScenarioEngine renders 6 scenarios; portfolio Greeks aggregated; factor attribution available.
5. **Testing:** Coverage ≥ 80% across broadened scope; mutation ≥ 70% on quant/backtest/options; component test infra live with ≥ 5 tests; API integration tests for ≥ 5 routes.
6. **A11y:** axe-core 0 critical on 5 priority routes; aria-live wired to SSE; modal focus traps verified.
7. **Data:** Vercel KV rate-limit active; Polygon provider operational; provider dispatcher live; SSE timer chain unified.
8. **Documentation:** Every closed finding has a commit message citing finding ID + primary source; `coordination/daily-YYYY-MM-DD.md` artefact produced ≥ 80% of working days; `inspections/release-gate-phase15.md` signed by all 4 inspectors.
9. **Reproducibility:** `diff /tmp/run1 /tmp/run2` identical for `benchmark-signals.mjs` AND `portfolio-backtest.ts`.
10. **Standing invariants from Phase 13 still hold:** No new `any` (5 documented sites cap), no silent `.catch`, no circular imports, no secrets in error responses, freshness banner on stale data, normalizeTicker on every ticker route.

---

# Section 9 — Open questions for PM

These must be resolved before S1 starts. Track owners flag them; C1 decides.

1. **WR-floor re-freeze trigger:** Confirm the floor shifts from 56.55% to whatever F1.4 + F1.5 produce. Acceptable shift range?
2. **Polygon plan:** $199/mo Stocks-Currencies-Indices-Equities? Or start free + upgrade if needed? Compliance counsel timing?
3. **Vercel KV:** Existing Vercel account upgrades to Pro? Or use Upstash directly?
4. **GARCH compute:** Run on demand (Lambda cold-start) or on a daily cron writing to KV?
5. **HMM training cadence:** Weekly retrain on the trailing 5y? Or batch-monthly to keep state stable?
6. **Test budget for component tests:** `@testing-library/react` adds ~5MB to devDependencies; OK?
7. **A11y testing tooling:** axe-core in vitest-jsdom OR Playwright? Recommend Playwright for visual + a11y in one tool.
8. **Inspector availability:** Are I1–I4 the same individuals as Phase 14? If rotating, allow 1 sprint of overlap.

---

# Section 10 — Daily artefact (PM C1)

`coordination/daily-YYYY-MM-DD.md` template:

```markdown
# Daily — YYYY-MM-DD

## Yesterday
- [Track] — [Item ID] — [What landed / blocked]

## Today
- [Track] — [Item ID] — [What's planned]

## Blockers
- [Owner] — [Description] — [Decision needed by]

## Invariant status
- WR: XX.XX% (vs floor: 56.55% pre-FRED / TBD post-FRED)
- Tests: XXX / 798 baseline
- Largest component: XXX LOC (target: ≤ 500)
- Largest lib: XXX LOC (target: ≤ 600)
- Open Critical/High findings: X / Y

## Scope changes
- (none) OR [PR / finding ID] [description] approved-by C1

## Inspector notes
- I1: ...
- I2: ...
- I3: ...
- I4: ...
```

---

# Section 11 — Reconciled Workspace Backlog (Q-001 to Q-038)

A parallel improvement plan was authored on 2026-05-21 in `workspace/FUTURE_IMPROVEMENT_PLAN.md` + `workspace/IMPROVEMENT_BACKLOG.json` (38 tasks Q-001 to Q-038). That snapshot was anchored on `main@3870751`, which **predates the wave 37–41 merges** (SSE real-time, options chain audit, Phase 14 S1 sweep). This section reconciles every Q-XXX task against the post-PR#16 (commit `7321b54`) reality and maps each one to its Phase 15 sprint slot, OR marks it RESOLVED with evidence.

**Headline:** 9 of the 38 Q-tasks are now RESOLVED by intervening waves; 29 remain open and are absorbed into Phase 15 sprints S1–S4.

## RESOLVED (9) — evidence captured 2026-05-23

| ID | Title | Resolution |
|---|---|---|
| **Q-002** | Capture portfolio backtest baseline | `scripts/portfolio-backtest-results.json` exists (2026-05-14 run, v1.0-phase8-loop3, 56 instruments). Still needs invariants-baseline.md amendment — that piece tracked under **F8.6 / Q-014** in S1. |
| **Q-003** | Intraday stop logic (F1.3) | `lib/backtest/engine.ts:281, 290, 301` calls `evaluateStopHit` primitive — SSOT comment confirms "F1.3 intraday-aware". Ledger row F1.3 also marked closed. |
| **Q-006** | options/chain unit tests | `__tests__/options/chain.test.ts` exists; tested in wave 40-41 includes new picker regression cases. |
| **Q-010** | Merge / abandon options worktree | 8-commit worktree merged via PR #16 on 2026-05-23 (commit `7321b54`); main now contains wave 35–41. |
| **Q-011** | Restore or drop portfolio lib | All 5 files present: `lib/portfolio/{tracker,var,riskParity,diversification,stressTest}.ts`. Drift never landed on main — Q-026 effectively resolved. |
| **Q-012** | Audit remaining error handling | `rg "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}" lib app components` returns 0 hits. Wave 35 closed the remaining 4. |
| **Q-013** | Sector rotation UI wiring | `components/SectorRotationPanel.tsx` (143 LOC) present; consumed by heatmap/desk via existing route. |
| **Q-024** | Yahoo compliance banner rollout | `components/ComplianceBanner.tsx` imported at `app/layout.tsx:109`; visible on every page. Pending Polygon migration (Q-040 / F4.5). |
| **Q-026** | Resolve uncommitted deletion set | All "deleted" files restored on the worktree branch; merged to main via PR #16. Drift no longer exists. |
| **Q-033** | AuthNav removal follow-up | `components/SafeAuth.tsx` exists as the replacement pattern; AuthNav intentionally absent. Sign-in flow still works through `app/auth/signin`. |

## OPEN — absorbed into Phase 15 (29 tasks)

Each row maps to the Phase 15 sprint where it lands. Where the task overlaps a P15-NEW or ledger ID, the cross-reference is shown.

### S1 — Security P0 + Phase 14 carry-over (5 Q-tasks)

| Q ID | Pri | Phase 15 mapping | Notes |
|---|---|---|---|
| **Q-001** | P0 | S1 (new line item) | Extend `.github/workflows/ci.yml` from typecheck-only to `npm test` + `npm run benchmark` (fail WR < 55.85%) + `npm run check:ci`. Currently CI is **typecheck only**. |
| **Q-014** | P1 | S1 (new line item) | Re-baseline `reviews/invariants-baseline.md` §3 from **279 tests** → **798 tests / 48 files**. Verified by `vitest run` 2026-05-23. |
| **Q-015** | P1 | S1 (overlaps F7.3) | Ticker validation already lives in `lib/api/sanitize.ts:normalizeTicker`; fuzz test still missing → covered by **F7.3** in S1. |
| **Q-022** | P1 | S1 (overlaps F8.6) | Coverage in CI — covered by **F8.6** expansion + new ci.yml job. |
| **Q-023** | P1 | S1 (overlaps F7.2) | Sanitize all errors — `sanitizeError` exists in `lib/api/sanitize.ts`; `lib/api/reliability.ts:50` is the lone holdout. |

### S2 — Quant + Data Platform (7 Q-tasks)

| Q ID | Pri | Phase 15 mapping | Notes |
|---|---|---|---|
| **Q-004** | P1 | S2 (= F1.4 + F3.9) | FRED `getRiskFreeRate(tenorDays)` replacing `BACKTEST_RFR_ANNUAL` (0.045) and `OPTIONS_RFR_ANNUAL` (0.0525). |
| **Q-005** | P0 | S2 (= F4.3 / F7.7) | Distributed rate limit via Vercel KV / Upstash. Confirmed `lib/api/rateLimit.ts:13` still uses per-process `Map`. |
| **Q-009** | P0 | S2 (new line item) | Enhanced benchmark policy — current `benchmark-results-enhanced.json` shows WR **52.63%** (improvement vs baseline = **−3.72pp**). Production signal path must stay ≥ 56.35% OR be feature-flagged off. C2 to author the flag wire-up. |
| **Q-016** | P1 | S2 (= F1.22) | ATR stop excludes forming bar — `lib/backtest/exitRules.ts:80-82`. |
| **Q-017** | P2 | S2 (new line item) | `__tests__/data/warehouse.test.ts` doesn't exist — directory `__tests__/data/` is empty. Add SQLite schema + insert + query tests. |
| **Q-018** | P2 | S2 (new line item) | `__tests__/backtest/dataLoader.test.ts` absent — covers `loadStockHistory` + `availableTickers` with fixture JSON. |
| **Q-021** | P1 | S2 (= F1.5) | B&H total-return via Yahoo `historical()` dividend stream. |

### S3 — God-component decomp + scenario engine + UX (7 Q-tasks)

| Q ID | Pri | Phase 15 mapping | Notes |
|---|---|---|---|
| **Q-007** | P1 | S3 (new line item) | Reconcile AGENTS.md drift — `head -30` shows 7-phase plan markers; many phases described as complete that no longer reflect on-disk reality. Quick edit before S3 lands. |
| **Q-008** | P1 | S3 (= F5.2) | QuantLabPanel decomposition. Confirmed **1,684 LOC** (grew from 1,653 baseline). |
| **Q-019** | P1 | S3 (= F5.3) | `app/backtest/page.tsx` decomposition. Confirmed **887 LOC** (grew from 934 baseline). |
| **Q-029** | P2 | S1 (overlaps R7-C-4) | Restrict `next/image` `remotePatterns` — `next.config.js:65` still `hostname: '**'`. Same patch lands in S1 with the security batch. |
| **Q-031** | P2 | S3 (new line item) | Consolidate `dataLoader` import path. Confirmed 3 sites still import from `@/scripts/backtest/dataLoader`: `lib/optimize/gridSearch.ts:15`, `lib/backtest/portfolioBacktest.ts:16`, `__tests__/backtest/portfolioBacktest.test.ts:6`. Move canonical type to `lib/backtest/dataLoader.ts`. |
| **Q-032** | P2 | S3 (new line item) | Migrate RSI callers to indicators SSOT. `lib/quant/technicals.ts:28` still exports `rsi()`; `:61` still exports `sharpeRatio(rfAnnual=0.04)`. Hard-block via ESLint custom rule after migration. |
| **Q-034** | P2 | S3 (new line item) | Review optimize-grid Loop 1 results (`scripts/optimization-results-loop1.json` present). Document top OOS parameter sets in `reviews/optimization-loop1.md`. |

### S4 — HMM + factor attribution + testing depth (6 Q-tasks)

| Q ID | Pri | Phase 15 mapping | Notes |
|---|---|---|---|
| **Q-020** | P1 | S4 (= F8.4) | API integration test for `app/api/prices/route.ts` + ≥ 4 others. `__tests__/api/` currently covers helper modules (rateLimit/sanitize/marketHours/reliability), not route handlers. |
| **Q-025** | P2 | S4 (= F1.11) | Piecewise RSI scoring per Wilder (1978) p65. Quant track. |
| **Q-027** | P2 | S4 (= F8.2) | Component test infrastructure. `__tests__/components/` directory absent. |
| **Q-028** | P2 | S4 (new line item) | Portfolio dashboard at `app/portfolio/page.tsx`. Consumes `portfolio-backtest-results.json` rendered by `portfolioBacktest.ts`. Add nav link once page lands. |
| **Q-030** | P2 | S4 (new line item) | ML client tests at `__tests__/ml/client.test.ts` covering timeout + sidecar-down + happy path. Currently 0 tests in `__tests__/ml/`. |
| **Q-038** | P3 | S4 (= F1.15) | `oosRatio` clamp removal or UI warning for tail overfit. |

### Sprint deferred (4 Q-tasks — P2/P3 with low business impact)

| Q ID | Pri | Phase 15 mapping | Notes |
|---|---|---|---|
| **Q-035** | P3 | S4 (overlaps R6 a11y sweep) | WCAG contrast pass on `text-slate-600`. Bundled into F5.6 ARIA / contrast sweep. |
| **Q-036** | P3 | S4 (= F7.4) | CSRF guard on POST routes — `backtest`, `trading-agents`. Double-submit cookie pattern. |
| **Q-037** | P3 | S4 (= F7.5) | Bloomberg bridge `crypto.timingSafeEqual`. |
| (Phase-14 hidden) | — | — | Q-038 already mapped above. |

## Notes on the parallel plan's invariants

The workspace plan stated:
- Floor WR ≥ 56.35% (unchanged baseline — still correct).
- Test floor "486" (now **798** — Phase 15 raises this floor to ≥ 798 in `invariants-baseline.md`).
- Enhanced WR 50.54% with **−5.81 pp** vs baseline (now 52.63% with −3.72 pp — improving but still below floor; **Q-009 remains P0**).

## Net new tasks added to Phase 15 from the workspace backlog (not in original plan)

These were missing or under-detailed in the original Phase 15 sprints; absorbed now:

- **Q-001** — Extend CI to test + benchmark + check:ci (S1)
- **Q-009** — Enhanced benchmark policy (S2) — feature-flag the enhanced path until WR ≥ 56.35%
- **Q-014** — Re-baseline test count in invariants doc (S1)
- **Q-017** — `warehouse.test.ts` (S2)
- **Q-018** — `dataLoader.test.ts` (S2)
- **Q-028** — Portfolio dashboard page (S4)
- **Q-030** — ML client tests (S4)
- **Q-031** — Consolidate `dataLoader` import path (S3)
- **Q-032** — Migrate RSI callers to indicators SSOT (S3)
- **Q-034** — Document optimize-grid Loop 1 results (S3)

## Reading order for the next agent (per CLAUDE_CODE_INSTRUCTIONS.md updated 2026-05-23)

1. `reviews/PHASE-15-PLAN.md` — **canonical plan** (this file).
2. `workspace/IMPROVEMENT_BACKLOG.json` — 38 Q-tasks, statuses synced 2026-05-23.
3. `reviews/findings-ledger.csv` — 90-row finding ledger (F1.x–F8.x).
4. `reviews/invariants-baseline.md` — frozen floors; will be re-baselined in S1 (Q-014).
5. `AGENT.md` — boot rules; will be reconciled in S3 (Q-007).

---

# Companion documents

- `reviews/PHASE-14-CRITIQUE-LOG.md` — 138 historical findings (read-only)
- `reviews/PHASE-14-REMEDIATION-ROADMAP.md` — historical Phase 14 plan (read-only)
- `reviews/findings-ledger.csv` — track status as items close; add P15-NEW-* rows
- `reviews/invariants-baseline.md` — frozen at Phase 13 S1; will be amended with post-FRED row at end of S2
- `workspace/FUTURE_IMPROVEMENT_PLAN.md` — May-21 audit, now superseded by this plan (kept for historical context)
- `workspace/IMPROVEMENT_BACKLOG.json` — 38 Q-tasks with current statuses (synced 2026-05-23)
- `workspace/CLAUDE_CODE_INSTRUCTIONS.md` — agent quick start; points to this file as canonical

**Plan authored by:**
- C1 (Tech Lead) — sprint cuts, gate enforcement, scope discipline
- Q1 (Quant Research) — FRED RFR, GARCH, HMM, scenario engine, factor attribution
- F1 (Principal FE) — god-component decomposition, design tokens, a11y
- D1 (Staff DE) — Vercel KV, Polygon, SSE hardening, provider dispatcher
- S1 (CISSP) — auth regex P0, CSP enforcing, hostname whitelist, CSRF
- T1 (Staff SDET) — mutation, property-based, component test infra, coverage broadening
- PM — prioritisation, compliance sign-off, daily artefact
