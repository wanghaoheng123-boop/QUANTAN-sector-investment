# QUANTAN — Complete Review (2026-06-15)

Scope: **current program progress**, **code structure/architecture**, and **algorithms**.
Read-only. `main` @ `c2f9a1d`. Author: claude opus-4.8.

---

## A. Program progress

**Autonomous verification & optimization program** (set up 2026-06-15) is live: master
plan `workspace/AUTONOMOUS_PROGRAM_2026-06-15.md`, queue `workspace/coordination/
PROGRAM_QUEUE_2026-06-15.md`, daily cron routine `quantan-autonomous-program` (09:00
local, one cell/run, auto-merge under §4 guardrails). WS-Q (quant) leads.

| Cell | Module | Result | Shipped |
|------|--------|--------|---------|
| Q01 | `backtest/engine.ts` | profit-factor `Infinity`→`null` render crash fixed (+3 tests) | #61 live |
| Q02 | `backtest/core.ts` | corrupt next-open → `shares` NaN poisons equity curve; guard (+5 tests) | #62 live |
| Q03 | `backtest/signals.ts` | **verified clean** (no fix) | #63 |
| Q04 | `backtest/signalHelpers.ts` | `detectVolumeClimax` corrupt-bar guard (+new test file) | #64 live |

4 of 27 WS-Q cells done. **Theme:** 2 of 3 fixes are the same *NaN/Infinity-on-corrupt-
data* class. Next cell Q05 `regimeSignal.ts`.

**Open escalations (guardrails held — owner decisions):**
- **F-4** per-trade win-rate/profit-factor are **gross of cost** while equity is net →
  published WR is optimistic; fixing re-baselines the headline number (owner sign-off).
- **F-8** portfolio T+1 mark-to-market booked one bar early (affects Sharpe/maxDD).
- `profitFactor` API type is `number` but the route can emit `null` → contract should be `number | null`.
- Carried from prior reviews: **F-2** alpha mismatched windows, **F-9** entry-slippage
  double-count vs 22bps SSOT, **F-11** maxHoldDays union-calendar vs trading days,
  **F-12** walkForward hardcoded 252/rf for BTC, gridSearch survivorship+OOS-selection bias.

---

## B. Code structure / architecture

Next.js 15 (App Router) + TypeScript front/edge; Python sidecars for heavy ML (offline tier).

```
app/            52 files / 9.1k LOC — App Router pages + 27 API routes (app/api/**)
components/     62 files / 9.0k LOC — UI (charts, panels, tables); KLineChart split done
hooks/           7 files / 1.7k LOC — data hooks (useKLineChart, useLiveQuote SSE, …)
lib/backtest/   13 files / 3.1k LOC — signal engine, backtest core, portfolio, exits, costs
lib/quant/      26 files / 4.1k LOC — indicators + analytics SSOT (the math library)
lib/optimize/    3 files / 0.8k LOC — grid search, sector profiles, parameter sets
lib/portfolio/   7 files / 1.5k LOC — VaR, stress tests, factor regression, greeks, ERC
lib/data/       11 files / 1.2k LOC — providers (yahoo/alphavantage/polygon/fred), warehouse
lib/api/         6 files          — rate-limit, csrf, sanitize, auth helpers
quant_framework/ + server_*.py    — 34 py: GARCH, HMM regime, options, trading-agents sidecar
```

**Layering (clean, 0 circular deps per madge):** `lib/quant` (pure math, SSOT) ←
`lib/backtest` (signals/engine) ← `app/api` (routes) ← `app`/`components`/`hooks` (UI).
`lib/data` feeds the warehouse + providers. Python sidecars are reached via HTTP
(`*_BRIDGE_URL` / sidecar base), **not** in the Vercel request path.

**SSOT discipline (good):** indicators live once in `lib/quant/indicators.ts`;
`lib/quant/technicals.ts` and `lib/backtest/signalHelpers.ts` re-export (sma200* unified
in F-6). Single `OhlcvRow` source (`core.ts`). One signal resolver (`resolveBacktestSignal`).

**Security/ops baseline (verified live in prior waves):** CSRF double-submit + CSP
(report-only) + OWASP headers in middleware; `sanitizeError` on all routes; rate-limit
with atomic KV `SET…NX`+`EXPIRE…NX`; strict `TICKER_REGEX` whitelist; fail-closed
`isValidApiKey`. Restricted-AST evaluators (no `eval`) for LLM-generated formulas.

**Test/CI:** 85 vitest + 8 pytest; CI gates = typecheck · test · coverage (80/80/80/70) ·
benchmark (WR floor) · smoke · Vercel; nightly benchmark, weekly stryker + data refresh,
axe a11y. **Env caveat:** full vitest freezes on the Google-Drive FUSE mount → CI is the gate.

---

## C. Algorithms

### C1. Live production signal — 200-SMA mean-reversion dip-buyer
`enhancedCombinedSignal` is **OFF in prod** (`featureFlags.ts`: underperforms baseline
52.63% vs 57.05%). The live path is `regimeSignal(price, closes, rsi14)`:
- Inputs: **deviation% from 200-SMA**, **200-SMA slope**, **"price near SMA recently"**, RSI(14).
- Zones by deviation: `EXTREME_BULL >+20%`, `EXTENDED_BULL >+10%`, `HEALTHY_BULL 0..+10%`
  (all HOLD), then **dip zones below SMA**. Buys a dip **only if** `slope > 0.5%` **and**
  price was recently near the SMA → filters secular downtrends / falling knives. RSI<35 → higher confidence.
- **Fail-closed** when deviation is non-finite (Phase-13 fix — no longer emits BUY/SELL from bad data).
- Sizing: half-Kelly 0.15 on BUY, full exit on SELL.
- **Verdict:** sound, conservative, well-guarded. Honest about being a simple rule set.

### C2. Research signal — weighted multi-factor confluence (dormant)
`enhancedCombinedSignal`: 7 factors (RSI, MACD-hist, ATR%, BB%-b, Volume-POC, Multi-TF,
Vol-Regime), each **score clamped to [-1,1]**, weighted by regime-adaptive `WEIGHT_PROFILES`
(Σw=1 → total ∈ [-1,1]); BUY > 0.25, SELL < -0.30; sector gates (golden-cross, momentum,
RSI-divergence/volume-climax/MA-compression bonuses, TLT & yield-curve penalties).
Clamping + thresholds are mathematically careful and cited. **Off because it underperforms**
— a genuine retire-or-invest decision, not a bug.

### C3. Indicator library (`lib/quant`) — verified-clean SSOT
RSI(Wilder), EMA/SMA, MACD, Bollinger, ATR/true-range, ADX, Stoch-RSI, OBV, VWAP/VWMA,
volume profile/POC, pivots, Parkinson/realized vol, EWMA vol, correlation/Pearson,
Sharpe/Sortino/maxDrawdown, Kelly (+correlation-adjusted/half), DCF, BTC on-chain
(MVRV/S2F/Pi-cycle/difficulty-ribbon), risk-free-rate cache. Broad, conventionally-correct,
generally finite-guarded.

### C4. Backtest engine (`lib/backtest`)
Single-instrument `backtestInstrument` → `aggregatePortfolio`. **Correct & live:** T+1
next-open fills, ATR-adaptive stops (1.5×ATR capped 5–15%), round-trip cost ~22 bps SSOT,
common-window alignment, <252-bar stub exclusion (F-1), 252/365 annualization, NaN guards
(Q01/Q02). **Known issues:** gross-of-cost trade WR (F-4), MTM one bar early (F-8),
slippage possible double-count (F-9), maxHold calendar vs trading days (F-11).

### C5. Optimization (`lib/optimize`)
`gridSearch` + sector profiles. **Documented biases (research-only, not auto-promoted):**
survivorship (hard-coded mega-cap survivors) and winner-selected-on-OOS-set + several inert
grid dims → result JSONs are artifacts, correctly labeled.

### C6. Portfolio analytics (`lib/portfolio`)
Historical/parametric **VaR**, marginal VaR, **Kupiec POF** backtest, stress tests,
**factor-loading regression** (SE/t-stats/adj-R²/cond#, min-N≥60), diversification/Herfindahl,
ERC risk-parity (Maillard-Roncalli-Teiletche). Solid quant; UI discloses demo/research where applicable.

### C7. Python tier (offline)
**GARCH(1,1) MLE** — was dead (swallowed `float(ndarray)` TypeError → always EWMA);
**fixed + arch≥6 + tests** (recovered & shipped this program). **HMM regime** via hmmlearn.
**Options/Greeks** sidecar. **trading-agents** sidecar hardened (per-provider lock,
unblockable shutdown, bounded cache, API-key-leak fix). Not in the web request path.

---

## D. Overall assessment

**Strengths:** clean layering (0 cycles), disciplined SSOT, conservative *honest* live
algorithm with fail-closed guards, strong security/CI baseline, methodology self-honesty
(biases & dormant code are labeled, not hidden).

**Top risks / next priorities:**
1. **F-4 gross→net WR re-baseline** — the published win rate is optimistic. *Highest value.*
2. **F-8 MTM timing** — Sharpe/maxDD slightly off.
3. **Performance pass (WS-P) not yet started** — per-bar recompute in the engine and the
   "recompute all 20 EMA series every WS tick" chart path (KL-6) are the known hot spots.
4. **Strategic:** decide retire-or-invest on the dormant enhanced/macro-gate stack.

**Health:** production is stable; the 4 program cells found 3 real (latent) bugs, all fixed
and live. No critical open issue on the live path. The recurring NaN-on-bad-data class is the
single most valuable pattern to keep hunting.
