# QUANTAN — Master Full-Code Review (2026-06-10/11)

**Coordinator:** Claude (Opus 4.8) · **Base commit:** `main` @ `6945e34`
**Method:** 4 parallel domain experts (quant/algorithms, frontend/UX, API/security, Python/ML) writing
durable incremental reports, + coordinator source-verification of every elevated finding.
**Reconciled against:** `reviews/MASTER-INSPECTION-2026-06-04.md` and its merged remediation (PR #53/#54/#55).

Per-domain detail lives beside this file:
- [`quant-algorithms.md`](quant-algorithms.md) — 20 findings
- [`frontend-quality.md`](frontend-quality.md) — KL-1..KL-10 + a11y/UX
- [`api-security.md`](api-security.md) — V-1..V-10, B-1..B-4, coverage matrix
- [`python-ml.md`](python-ml.md) — F-PY-01..F-PY-19 + GARCH fix spec

> **Standing rule honored:** every P0/P1 below was source-verified by the coordinator (agents
> reproduce Read-tool false positives). Verified items are marked ✅-VERIFIED with file:line.

---

## 0. Baseline health (all green)

| Gate | Result |
|---|---|
| `tsc --noEmit` | PASS (clean) |
| `vitest run` | 972 passed / 17 skipped / 0 fail (82 files) |
| `python3 -m pytest quant_framework/` | 4 passed (was 2; +2 from this session) |

The 2026-06-04 inspection→remediation→refactor cycle is confirmed **intact in production**: the two
prior live P0s (BtcQuantLab Rules-of-Hooks + error boundary; liquidations `sanitizeError` leak) remain
fixed; data-provider timeouts, AlphaVantage non-finite skip, polygon ns/ms, warehouse prepared
statements, uuid override, and the atomic rate-limit SET-NX are all present and verified correct.

---

## 1. What was FIXED this session

### ✅ GARCH(1,1) MLE dead-code bug — FIXED + verified live (`quant_framework/garch.py`)
The one explicitly-undone item from the 2026-06-04 inspection. Root cause confirmed: line 21
`float(vol)` ran `float()` on a length-`horizon` ndarray → `TypeError`, swallowed by a bare
`except Exception: pass`, so `fit_garch11` **always** returned the EWMA proxy — the `garch11_mle`
branch was dead.

**Fix applied:** vectorized the forecast (per-step variance row → sqrt → de-scale → annualize),
emitting the real GARCH **term structure**; narrowed the exception handling (`ImportError` = expected
EWMA fallback; numerical/convergence failures now logged before fallback); cast to plain `float` for
clean JSON; added `arch>=6.0.0` to `requirements.txt`.

**Verified:** installed `arch` 8.0.0 and exercised the previously-unreachable branch — it now returns
`method:"garch11_mle"`, 20 finite positive floats, with a **decaying** term structure (0.1165→0.1151→
0.1148; 12 distinct values vs the flat EWMA's 1). Added 2 regression tests (`test_garch_mle_branch_is_live_and_finite`
is `skipif`-guarded so CI without `arch` still passes). All 4 python tests green.

> **Caveat (carried from python-ml.md §1d):** `fit_garch11` is *also* not wired to any HTTP route —
> no Python service exposes `/garch/{ticker}`, and `lib/quant/garchClient.ts` therefore always uses
> its TS EWMA fallback. The library function is now correct; **wiring the sidecar route is a separate
> owner-scoped task** (and would need the `step → business-day date` mapping garchClient expects).

---

## 2. NEW elevated findings (source-verified) — recommend owner-authorized fix PRs

### P1 — Backtest portfolio summary silently collapses to all-zeros (LIVE on `/api/backtest`)
✅-VERIFIED. `backtestInstrument` returns a length-1 `equityCurve:[initialCapital]` stub for any
instrument with `<252` rows (`lib/backtest/core.ts:209-221`). `aggregatePortfolio` filters only
`equityCurve.length > 0` (`lib/backtest/engine.ts:78`), so a stub drags `minLen → 1`; the combine
block requires `minLen > 30` (`engine.ts:96`), so the **entire portfolio block zeroes**: totalReturn 0,
finalCapital $0, Sharpe/Sortino null, alpha = −bnhAvg. The live route includes any instrument with
`≥100` rows (`app/api/backtest/route.ts:74`), so **any ticker with 100–251 candles** (recently listed
or partially backfilled) reports "finalCapital $0" for the whole portfolio. The two gates disagree.
**Fix:** make the route gate and the engine stub gate agree (both `≥252`), or have `aggregatePortfolio`
drop stub results (`equityCurve.length ≤ 30` / `totalTrades===0 && days<252`) before taking the min,
and disclose the exclusion. *(quant F-1/F-1a — highest-impact new finding.)*

### P1 — Chart "Fib" preset is a no-op; "Vol SMA(20)" line can never render
✅-VERIFIED. (a) The Fib preset/toggle/legend exist (`app/stock/[ticker]/page.tsx`,
`components/IndicatorPanel.tsx`, `lib/chartEma.ts`) but **no fibonacci rendering code exists** —
`createPriceLine` appears nowhere in the repo. Selecting "Fib" turns all EMAs off and draws bare
candles with a misleading legend chip. (b) The Vol SMA series is created `visible:false`
(`hooks/useKLineChart.ts:301-310`) and **nothing ever toggles it visible** (`volSmaRef` isn't returned;
no `applyOptions({visible})` path), yet `buildVisFromProps` hardcodes `volSma:true` so the legend and
sidebar always show it "ON." Data is computed every tick for a line that can't display.
**Fix:** implement fib retracement price-lines + a Vol-SMA visibility path, or remove the
preset/toggle/legend entries until implemented. *(frontend KL-1, KL-2; related dead API KL-3.)*

### P1 — `onIndicatorsChange` / `toggleIndicator` are dead; documented chart→page sync does not exist
✅-VERIFIED (grep). `toggleIndicator` (`KLineChart.tsx:263-282`) is referenced nowhere in JSX; the
legend renders passive `<span>`s, not buttons. The prop contract "fires when a user toggles an
indicator via overlay buttons" is false — there are no overlay buttons. Page→chart (`indicators` prop)
carries all real behavior, so nothing user-visible breaks today, but ~40 lines of dead API + 2
misleading comments invite a future regression. **Fix:** delete the dead callback/prop, or render real
overlay buttons. *(frontend KL-3.)*

### P1 — Per-trade win-rate / profit-factor are GROSS of costs (published WR is a gross-trade WR)
✅-VERIFIED. `closePosition` books `pnlPct=(fill−entry)/entry` with no cost subtraction
(`lib/backtest/core.ts:171-173`); the 11bps/side fee hits only capital (`netProceeds`). So
`winRate`/`profitFactor`/`avgTradeReturn` — and the CI WR floor and the published ~54% re-baseline —
measure **gross-of-cost** trade win rate: a +5bps-gross / −17bps-net trade counts as a WIN. Equity,
returns, and Sharpe are correctly net. This survived the prior "Q-063 honest WR" disclosure pass.
**Fix:** subtract `2×perSideCostPct` inside `closePosition`, then re-baseline the WR floor (a
deliberate metric change → owner sign-off, like PR #41). *(quant F-4; cross-engine inconsistency F-10.)*

### P1 (offline tier) — `server_trading_agents.py` lost its Phase-11 hardening; user API key leaks into process env
✅-VERIFIED (grep: `_failures`=0, `threading.Lock`=1 (not per-provider), `smoke`=0). The current
`main` file is the PR #41 (2026-06-02) version; the Phase-11 hardening documented in
`phase_11_state.md` (per-provider mutex, `_failures` TTL, `/smoke`, key-leak-safe guard,
`copy_context`) **never reached main**. Concretely:
- `_ApiKeyEnvGuard.__exit__` (`:217-222`) has an **unreachable** inner branch: the outer guard
  `self._orig_value is not None` means that when the server had no pre-existing key for the provider
  (`_orig_value is None`, the normal case), `__exit__` does **nothing** → the user's key **stays in
  `os.environ`** after the request and bleeds into subsequent keyless requests (cross-user key reuse +
  billing). *(python F-PY-12.)*
- No per-provider lock around the env mutation, and `run_in_executor` does **not** propagate
  contextvars → concurrent same-provider requests race on the env var. *(F-PY-13, F-PY-14.)*
- The advertised 120s timeout can't unblock the request (the `with ThreadPoolExecutor` exit joins the
  still-running worker). *(F-PY-15.)*

**Live-risk note:** this tier is OFFLINE / separate-service (not in the Vercel request path), and the
`TRADING_AGENTS_BASE` sidecar is unset, so this is not a live-prod web exposure — but it is the exact
privacy contract the module promises. **Fix:** track an `_injected` flag and pop-on-None in `__exit__`;
restore the per-provider lock; fix the timeout to `shutdown(wait=False, cancel_futures=True)`; delete
the dead ContextVar machinery. (Small, self-contained, offline — safe to batch in a Python-tier PR.)

### P1 (offline tier) — Multi-agent factor mining is a no-op and its service can't boot
✅ Agent-verified empirically (python F-PY-04, F-PY-05). `EvaluatorAgent.evaluate` drops
`factor_values`, so `PortfolioComposerAgent.compose` always `continue`s (`len(fv)<30` always true) →
`/mine-factors` always returns `new_factors:[]`, library never grows. Separately the Procfile `alpha`
service crashes at boot (relative import + missing `import os`). **Fix:** carry `factor_values` through
the evaluated dict (strip before persist), `python -m multi_agent_factor_mining.server` + add `import
os`, tighten the test. Offline tier; owner decides whether this feature is in scope at all.

---

## 3. P2/P3 worth scheduling (not exhaustive — see domain files)

- **Quant:** alpha compares mismatched windows after the common-window fix (F-2); trailing-stop
  intra-bar look-ahead + non-ratcheting peak (F-3); entry-slippage double-count vs the 22bps SSOT
  (F-9); T+1 exit MTM booked one bar early in the portfolio equity curve (F-8); `maxHoldDays` counted
  in union-calendar days not instrument trading days in mixed crypto+equity portfolios (F-11);
  `walkForward.ts` hardcodes 252/rf-252 for BTC (F-12); `sma200DeviationPct`/`sma200Slope` +
  regime-zone thresholds duplicated between `signalHelpers.ts` and `technicals.ts` with no sync test
  (F-6).
- **Frontend:** async chart `init()` has no `.catch()` → a failed dynamic import leaves a permanently
  blank chart that error boundaries can't catch (KL-4); runtime `showRSI` flip unsupported (mount `[]`
  vs data-dep, KL-5); every WS tick recomputes all 20 EMA series incl. 16 hidden ones (KL-6); the
  coverage exclusion leaves the 712-line chart hook formally untested with no render test (KL-10);
  systemic a11y gaps (aria-sort, aria-expanded, tabpanel) per the domain file's a11y list.
- **API/security:** residual ms-window race in the KV rate-limiter if a key expires between SET-NX and
  INCR (re-creates a TTL-less key → self-inflicted IP DoS; add `EXPIRE … NX` after INCR, V-1); `npm
  audit --omit=dev` now reports **13 vulns (5 high)**, mostly the build-time PWA/workbox chain — `npm
  audit fix` clears most without breaking changes (V-8); `briefs` `id` is base64 of the first 12 URL
  bytes → near-universal collisions (B-1); `backtest/live` + `briefs/[sector]` have no try/catch →
  framework-default 500 (no leak in prod, but breaks the JSON-envelope contract, V-6); TA POST forwards
  unbounded model-id/date strings upstream (B-2); polygon/yahoo ingest miss the finite-OHLC guard that
  AlphaVantage has (B-3).
- **Python:** `Pow` allowed in the AST evaluator → `9**9**9**9` CPU/mem hang on LLM-generated formulas
  (offline, F-PY-01); `alpha_miner` registers `div` not `safe_div` → 2 of 13 formula candidates
  permanently dead (F-PY-03); `_results` cache unbounded (F-PY-16). **The restricted-AST evaluator is
  genuinely escape-proof** — 23 RCE vectors probed, all structurally blocked (good news, no action).

---

## 4. UI / UX review (interface)

Dev server launched (`next dev`, port 3000) with a minted local NextAuth session. **Homepage renders
correctly** — "Sector Intelligence" hero, nav (Markets/Desk/Commodities/Crypto/Heatmap/200MA/Briefs),
⌘K search, RTH badge, the "Institutional Backtest Dashboard" card with honest WR disclosure
("~55% gross / ~54% net after costs … not a live accuracy guarantee"), and a live-streaming
"Largest session moves" feed. Screenshot captured.

**Could not complete the authenticated chart-canvas render check** (the standing manual residual from
the 2026-06-04 refactor): two blockers, both environmental, not code defects —
1. **No data credentials locally:** Yahoo quote/crumb returns **403 Forbidden** from this environment
   (`/api/stream/*` and `/api/prices` 500 as a result). Charts need OHLC the local box can't fetch.
2. **Preview renderer hung** on the heavy `/stock/[ticker]` route (20+ chart series); the server
   returned `200` in 1.5s but the headless renderer stopped responding to screenshot/eval.

The chart **split correctness** is otherwise well-covered: the quant+frontend agents both mechanically
diffed the pre/post-split source and confirmed the extraction is **behavior-preserving** (verbatim
effects, dep arrays, cleanup ordering). The remaining gap is purely the lack of an automated render
test (KL-10) — recommend a jsdom smoke test mocking `lightweight-charts`. **A genuine authenticated
chart glance against *production* (`quantan.vercel.app`, which has real data creds) remains the one
human-eye residual.**

**Concrete UX defects found (from code, high confidence):** the Fib preset and Vol-SMA toggle are
**user-visible lies** (§2) — they show as active but do nothing. These are the highest-value UX fixes:
a user toggling "Fib" sees all indicators vanish with a label claiming otherwise.

---

## 5. Recommended fix sequence (owner-authorize per the established pattern)

1. **DONE** — GARCH MLE fix (this session; safe, offline, tested).
2. **Python-tier PR (low risk, offline):** `__exit__` key-leak + per-provider lock + timeout fix
   (F-PY-12/13/15); `safe_div` registration (F-PY-03); factor-mining boot + no-op (F-PY-04/05) *if the
   feature is in scope*.
3. **Backtest portfolio-zeroing PR (P1, LIVE):** align the route/engine row-count gates (F-1/F-1a).
   Self-contained, add a test for the 100–251-row case.
4. **Frontend chart-honesty PR (P1 UX):** fix or remove Fib + Vol-SMA + dead `onIndicatorsChange`
   (KL-1/2/3); add the jsdom chart smoke test (KL-10).
5. **WR-honesty PR (deliberate metric change → owner sign-off):** net-of-cost per-trade WR (F-4) +
   re-baseline the CI floor; reconcile the two engines' pnl conventions (F-10).
6. **Hygiene:** `npm audit fix` (V-8); rate-limiter `EXPIRE NX` (V-1); SSOT-dedup the duplicated
   technicals (F-6).

Owner-decision (no obviously-correct answer): whether the dormant Phase-11 enhanced-signal stack and
the offline GARCH/regime/factor-mining sidecars are **retired or invested in** — they are research code
not in the production request path.
