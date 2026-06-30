# Coordinator (Supervisor) findings — Python/Data + Testing cluster — 2026-06-30

Baseline: main @ 2f2507a. READ-ONLY. Coordinator handled these two domains inline (Python is
the most dormant/offline; testing is cross-cutting). Gates run centrally — results in §3.

## 1. Python / Data tier — VERIFIED

**Framing (source-verified):** zero `child_process`/`spawn`/`execFile`/`.py` bridges in `app/`
or `lib/` → the Python tier is **offline-only**, reached (if at all) over HTTP to separate
services (`BLOOMBERG_BRIDGE_URL`, `TRADING_AGENTS_BASE`). A Python defect is research-tooling
severity, NOT web-exploitable in the Vercel request path. This gates every Python finding below.

| Claim (load-bearing) | Verdict | Evidence |
|---|---|---|
| API-key leak guard (F-PY-12) fixed | **CONFIRMED present** | `trading_agents_env_guard.py:59-70` — `__exit__` checks `_injected`, `os.environ.pop(env_var)` when `_orig_value is None` (no leak past request); reset for reuse. |
| GARCH(1,1) MLE dead-code bug fixed | **CONFIRMED present** | `quant_framework/garch.py:42-49` — vectorized `np.atleast_1d(np.asarray(forecast.variance.values[-1], dtype=float))`, de-scale, annualize, returns `method:"garch11_mle"`; narrowed except. (NOTE: dormant — no `/garch` sidecar route wired; live BTC vol still uses the TS EWMA in `garchClient.ts`, which is the Q25-1 owner-gated item.) |
| Restricted-AST evaluator escape-proof (F-PY-01) | **CONFIRMED present** | `alpha_miner.py:267 safe_eval_formula` — AST walk; rejects non-numeric `Constant` (:289), whitelisted `_SAFE_BINOPS`/`_SAFE_UNARYOPS` only, direct named-`Call` only, no kwargs (:302), `raise ValueError` on any other node (:307). `Pow`/`**` excluded (:256, F-PY-01 bignum-DoS). This is the AST evaluator, NOT the bypassable empty-`__builtins__` sandbox. |

**Known open Python items — verdicts (no re-report):**
- **F-PY-04 / F-PY-05** (`multi_agent_factor_mining/agents.py`, `server.py`) — factor-mining pipeline
  is a NO-OP (evaluator drops factor_values → 0 selected) and the server can't boot under the
  Procfile path. **Still DORMANT + offline** (research module, not in Vercel path). Owner-gated
  complete-or-retire — unchanged. pytest exercises it (passes with a benign `ConstantInputWarning`).
- **PY3-2** (`alpha_miner.py` safe_div vs FUNCTION_SET 'div' key) — **still open-low, offline.**
  Needs call-resolution flow tracing, not a one-line registry add. Unchanged.

**pytest gate: 127 passed / 1 skipped / 4 benign warnings (8.14s).** Clean runner on this FUSE mount.

## 2. Testing cluster (F8.x) — STALE-LEDGER RECONCILIATION (supervisor accuracy correction)

These rows are terse one-liners from an early review wave (Phase 14–16 / "R8-testing") that was
**never reconciled** when the later program waves did the actual work. Their HIGH/CRITICAL
severities are **no longer true**. Verified against current bytes:

| id | ledger one-line | severity | **VERDICT** | evidence (current bytes) |
|----|-----------------|----------|-------------|--------------------------|
| F8.1 | "hot-path modules have zero tests (11 modules)" | CRITICAL | **STALE → RESOLVED** | 90 test files, 1007 `it/test` cases; coverage gate lines80/func80/branch70/stmt80 (`vitest.config.ts:76-80`); Stryker on quant/backtest/options. A "CRITICAL" for a coverage gap was severity-inflated to begin with. |
| F8.2 | "zero component tests in repo" | HIGH | **STALE → RESOLVED** | `__tests__/components/` = `KLineChart.test.tsx` + `backtest/` + `stock/` + `smoke.test.ts`. |
| F8.3 | "no mutation testing" | HIGH | **STALE → RESOLVED** | `stryker.conf.mjs` (vitest runner, mutate quant/backtest/options, break=70) + `.github/workflows/stryker-weekly.yml` (cron Sun 08:00). |
| F8.4 | "zero API integration tests" | HIGH | **STALE → RESOLVED** | `__tests__/api/` = 13 files (briefId, csrf, csrfClient, rateLimit.kv, reliability, sanitize.fuzz, trading-agents-auth, sector-rotation, prices, route-rate-limit…). |
| F8.6 | "coverage thresholds not verified" | MEDIUM | **STALE → RESOLVED** | thresholds in `vitest.config.ts:76-80`; CI `coverage` job runs `npm run test:coverage` on push+PR (`ci.yml:44-56`). |
| F8.7 | "smoke tests likely not in PR CI" | MEDIUM | **STALE → RESOLVED** | `ci.yml:103-117` `smoke` job (needs typecheck+test) runs on push+PR; full production HTTP smoke runs on deploy. |
| F8.5 | "no property-based tests for math" | MEDIUM | **PARTIALLY VALID → downgrade LOW/INFO** | `sanitize.fuzz.test.ts` (fuzz) + invariant tests exist; true generative property-based (e.g. fast-check) for quant math is genuinely absent. Real enhancement, but not MEDIUM and not a defect. |
| F8.8 | "space-in-path blocks local vitest from worktree" | LOW | **TRUE but ENV-quirk, not a code defect** | The documented `@`-path/FUSE vitest worker-start freeze. Keep as INFO env-note (CI is the gate; pytest runs clean locally). |

**Net:** the testing posture is **strong** (5 CI gates on every PR + weekly mutation). The ledger
was misrepresenting it with 1 phantom CRITICAL + 3 phantom HIGH. Recommend reclassifying F8.1–8.4,
F8.6, F8.7 to RESOLVED-STALE and F8.5 to LOW in the ledger reconciliation.

## 2b. Priority stale-HIGH verdicts (supervisor independent source-verify)

The two HIGH rows that had been "open" across many shipped waves both have **rotted line
citations** and resolve on inspection — confirming the F1.x/F7.x/F8.x block is an unreconciled
early wave, not live risk. Verified independently of the agents (cross-check):

- **F1.5 HIGH "B&H ignores dividends" (cited `engine.ts:343` — DEAD: engine.ts is 219 lines).**
  **VERDICT (CORRECTED after Agent A's deeper trace): reclassify HIGH → LOW, still-real-LIVE — the
  fix is implemented but INERT.** My first read found the dividend-aware, F1.5-tagged code
  (`core.ts:25` "Total-return buy-and-hold including optional per-bar dividends (F1.5)", `:32`
  `const div = rows[i].dividend ?? 0`, `:422` consumes it) and I called it FIXED. Agent A traced one
  level deeper and I independently confirmed: **no data source ever populates `dividend`** —
  `scripts/fetchBacktestData.mjs:148-176` persists only `{time,open,high,low,close,volume}` and
  discards `adjclose`; `dataLoader.ts:14` only *mentions* `dividend?` in a comment; every
  `backtestData/*.json` candle = `{time,open,high,low,close,volume}` (verified AAPL.json). So
  `rows[i].dividend ?? 0` is always 0 → B&H still omits dividends in effect. Impact: the *displayed*
  B&H/alpha benchmark is understated ~1–2%/yr; the strategy WR is unaffected. **This is the supervisor
  lesson of the run:** a tagged + present code path is NOT proof of a fixed effect — trace the data to
  the boundary. Neither the supervisor nor the agent had it fully right alone (I had "mechanism
  present," Agent A had "effect inert"); the ratified verdict is the union.

- **F7.2 HIGH "error responses leak internals" (cited `reliability.ts:50`).**
  **VERDICT: STALE/MISCLASSIFIED.** `reliability.ts` is a pure retry/backoff/timeout utility;
  line 50 is `const sleep = opts.sleep ?? defaultSleep` — it does NOT format any client HTTP
  response. The only `throw` (`:68`) is an internal retry-exhaustion Error caught upstream and
  sanitized at the route boundary. The real CWE-209 control is route-level `sanitizeError`, which
  the program already verified covers all routes (the lone historical bypass — `crypto/btc/liquidations`
  — was fixed). Not a live leak at this location/severity. (Agent B confirming full route coverage.)

## 3. Central gates (the fresh signal — "truth in the numbers")

| Gate | Result | Floor / prior | Verdict |
|------|--------|---------------|---------|
| tsc --noEmit | clean (no diagnostics) | — | PASS |
| benchmark WR (SSOT, production path) | net **55.89%** / gross 56.91%; 56 instruments, 3444 signals | floor net 53.29; prior recorded 54.34 (2026-06-03) | **PASS** — drift +1.55pp vs June, consistent with the weekly data refresh; comfortably above floor |
| OOS validation | IS/OOS gap **6.19pp**, OOS WR 61.92%, collapseOver10pp=false | overfit guard <10pp | **PASS** — no overfit collapse |
| npm audit (--omit=dev) | 14 vulns (5 high, 8 moderate, 1 low, **0 critical**) | — | known build-chain/PWA advisory, owner-deferred (V-8); no critical, not runtime-exploitable |
| pytest | 127 passed / 1 skipped | — | PASS |

Gate-regenerated artifacts (`scripts/benchmark-results.json`, `oos-validation.json`) restored to
keep the read-only worktree clean.
