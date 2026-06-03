# Invariants Baseline

**Original capture:** 2026-05-04 (Phase 13 S1 day 0)
**Phase 15 re-baseline:** 2026-05-23 (post PR #16, wave 40-41 merge) — closes Q-014
**Captured-by:** C2 (Algorithm Lead)
**Status:** FROZEN. Any subsequent PR that regresses any line below the 0.5pp / one-tier tolerance requires C1+C2 written approval.

> **Phase 15 amendment (2026-05-23, Q-014):** Test floor raised 279 → **798**; test-file floor 21 → **48**; canonical WR re-measured at **57.05%** (above 56.35% floor); largest-component LOC drift recorded (QuantLabPanel 1649 → **1684**). Historical Phase 13 baseline preserved at §H below for audit continuity.

---

## 1. Algorithm performance (canonical benchmark) — re-measured 2026-05-23

```
$ node scripts/benchmark-signals.mjs
Loading data...
Loaded 56 instruments

=== BENCHMARK RESULTS ===
Instruments: 56
Instruments with trades: 55
Total BUY signals: 1390
Wins: 793 | Losses: 597
Aggregate Win Rate: 57.05%
Avg Win Rate per Instrument: 58.57%
Avg 20d Return per Signal: 1.409%
```

**Floor (legacy, superseded):** **56.35%** aggregate WR from Phase 13 `benchmark-signals.mjs` inline signal. **Do not use for CI after 2026-05-26.**

**Re-freeze trigger:** When Q-004 (FRED RFR) and Q-021 (B&H dividend-aware) land in Phase 15 S2, C2 will re-run benchmark on the post-merge tip and amend §1b. Legacy §1 preserved for audit.

## 1b. SSOT label benchmark — frozen 2026-05-26 (production regime-only)

```
$ npm run benchmark   # scripts/benchmark-signals.ts, QUANTAN_USE_ENHANCED_SIGNAL=0
=== BENCHMARK RESULTS (SSOT) ===
Aggregate Win Rate (gross label): 54.77%
Aggregate Win Rate (net after costs): 53.79%
Expectancy gross/net: 1.3577% / 1.1377%
Round-trip cost: 22 bps (lib/backtest/executionModel.ts)
```

**CI hard floor (net label WR):** **53.29%** (50 bps below frozen 53.79%). **Soft reference (gross):** 54.77% frozen; warn below 54.27%.

**Why re-baselined:** Prior §1 measured a **different** inline `generateSimpleSignal()` (~57%). SSOT now gates `resolveBacktestSignal()` (regime-only) + net costs — honest production path. **No metric gaming** to restore 55%+ without real signal improvement.

## 1c. Engine exit timing — T+1 symmetry (2026-05-29)

The walk-forward **engine** (`lib/backtest/engine.ts`, `backtestInstrument`) now
fills its **signal-driven exits at the next bar's open**, symmetric with entries:

- BUY entries already filled at the T+1 open (`nextOpen`). The **SELL-signal** and
  **max-drawdown circuit-breaker** exits previously filled at the **same bar's
  close** (`signalPrice`) — a look-ahead asymmetry, since you cannot transact at a
  close you have only just observed to generate the signal. Both now fill at
  `nextOpen`.
- Intraday **stop-loss** exits are unchanged: a resting stop legitimately fills
  same-bar via `evaluateStopHit` (the level was placed in advance). The final
  forced liquidation also stays at the last close (no future bar exists).
- `ENTRY_SLIPPAGE_BPS` is intentionally **not** mirrored onto the exit price; the
  11 bps/side cost in `closePosition` already carries a slippage component
  (`executionModel.ts`). A separate exit-side price bump is a distinct methodology
  question, deferred.

**This does NOT move the §1b numbers.** §1b is a *label* benchmark
(`scripts/benchmark-signals.ts` → `runInstrumentLabelBenchmark`): win rate = sign
of the fixed 20-day forward return after each BUY, computed directly from prices.
It never calls `backtestInstrument`, so the engine's exit timing is independent of
the label WR — the §1b CI/nightly floors are unaffected by this change. The engine
path instead feeds the backtest **page/API** (`app/api/backtest`),
`walkForward.ts`, and the engine unit tests (all 30 green post-change). Verified:
`npm run benchmark` is byte-identical before/after (54.77% gross / 53.79% net).

**Observation — regime-SELL is rarely reached:** the ATR stop-loss floor (3% min
for stocks), checked *before* the SELL/dd-breaker each bar and measured from
entry, preempts the regime-SELL threshold (`dev < -10%`, i.e. ~10% below the
200SMA) for any FIRST_DIP entry near the SMA. A deterministic single-instrument
fixture that fires the SELL before the stop is therefore impractical — which is
why this change ships without a behavioral pin. The SELL branch may be near-dead
under the current stop floor; worth a separate review (the fix is correct
regardless, and the dd-breaker shares the same exit-fill path).

## 2. Portfolio backtest — captured 2026-05-23 (Q-002 closed)

```
$ npm run portfolio:backtest
File: scripts/portfolio-backtest-results.json
Version: v1.0-phase8-loop3
Elapsed: 124.9s
Instruments: 56
Best config: hold25_pt10_trail6_panic4 (ranked by risk-adjusted Sharpe)
  Win rate:     54.66%  (236 trades)
  Max drawdown: 14.24%
  Sharpe:       -1.0655
  Sortino:      -1.3642
```

**Reader:** metrics live at `ranking[0].metrics` (best config) or `bestConfig.label` + matching `ranking[]` row. Win rate is stored as percent (55.3 = 55.3%); max drawdown as percent (19.66 = 19.66%).

Targets per plan: WR ≥ 60%, max DD ≤ 12%. **Current baseline misses both targets** — Loop 3 optimization deferred to Phase 8 execution; baseline is frozen for regression tracking only.

### 2b. Portfolio-sim re-baseline — C1/C2 (2026-06-02, handover WS2 D2-1/2/7)

**C1 (pre-fix, post-#28+#29 main @ 532f0c4):**

| Metric | Value |
|--------|-------|
| Win rate | 54.66% (236 trades) |
| Max drawdown | 14.24% |
| Sharpe | -1.0655 |
| Best config | hold25_pt10_trail6_panic4 |

**C2 (post-fix `fix/handover-menu-2026-06-02`, D2-1 T+1 entry + D2-2 net pnlPct + D2-7 calendar annualization):**

Command: `npm run portfolio:backtest` (2026-06-02, 121s elapsed)

| Metric | Old | New | Justification |
|--------|-----|-----|---------------|
| Win rate | 54.66% | **48.37%** (184 trades) | D2-1 removes same-bar close look-ahead; D2-2 counts net-of-cost trade WR |
| Max drawdown | 14.24% | **15.20%** | T+1 entry + net accounting |
| Sharpe | -1.0655 | **-0.9422** | Combined execution + cost honesty |
| Profit factor | (prior) | **1.29** | Net pnlPct series |

**Frozen §2 values (update regression tracking):** WR **48.37%**, max DD **15.20%**, Sharpe **-0.9422**, best config **hold25_pt10_trail6_panic4**.

References: WS2.md D2-1 (engine FIX-C2 T+1), D2-2 (net round-trip costs), D2-7 (`tradingDaysPerYear` 365 when BTC in universe).

## 3. Test inventory — re-measured 2026-06-03 (Wave 12 rectification)

```
Test files: 85 (was 48 on 2026-05-23; 21 in Phase 13 S1)
Total test cases: 1017 (was 816 on 2026-05-23; 279 in Phase 13 S1)
```

**Floor:** test count never drops below **1017**. Test-file count never drops below **85**. Coverage by module captured per-sprint by R8 in `reviews/R8-testing.md`.

**Coverage scope (vitest.config.ts):** currently includes `lib/quant`, `lib/backtest`, `lib/qa`, `lib/options`. Phase 15 Q-022 expands to `lib/api`, `lib/data`, `lib/portfolio`, `lib/optimize`, `lib/ml`, `hooks`.

**Worktree path workaround:** Phase 13 S1 noted vitest's `_setServer` chokes on URL-encoded paths from the worktree. Phase 15 verifies vitest runs cleanly from the worktree at `.claude/worktrees/competent-wu-a84629` — issue likely resolved by a vitest upgrade (currently `^4.1.4`).

## 4. Code-quality baseline — 2026-05-23

| Metric | Phase 13 (2026-05-04) | Phase 15 (2026-05-23) | Floor |
|--------|----------------------|------------------------|-------|
| TODO/FIXME/HACK in `lib/`+`app/`+`components/` | 0 | 2 (intentional, in `constants.ts` re. FRED) | ≤ 2 |
| Silent `.catch(() => {})` | 4 | **0** (Q-012 closed via wave 35) | 0 |
| `Math.random` in `lib/` | 0 | 1 (`reliability.ts` retry-jitter, intentional) | 1 (documented) |
| Largest component LOC | 1649 (`QuantLabPanel.tsx`) | **1684** (`QuantLabPanel.tsx`) | S3 target ≤ 500 |
| Largest lib LOC | 691 (`signals.ts`) | **807** (`engine.ts`) | S3 target ≤ 600 |
| Largest page LOC | n/a | 887 (`app/backtest/page.tsx`) | S3 target ≤ 200 (page) |
| `any` casts in `lib`+`app`+`components` | n/a | 5 files / ~7 sites (all documented) | ≤ 5 (no new without reviewer ack) |
| Circular imports (madge) | 0 | 0 | 0 |

> **Note on growth:** QuantLabPanel.tsx grew from 1649 → 1684 (+35 LOC) between Phase 13 and Phase 15. `engine.ts` grew from 691 → 807 (+116 LOC) and overtook `signals.ts` as the largest lib file. Both decompositions are Phase 15 S3 work (Q-008 QuantLab, P15-NEW-10 engine.ts walkForward extract).

## 5. External invariants (cannot regress in any sprint)

- yahoo-finance2 stays primary feed; Polygon migration via Q-048-NEW gated on legal opinion.
- All macro/sector gates fail closed on missing/insufficient/non-finite data.
- No secrets in code or error responses; all keys via env vars.
- Single canonical `ema`/`rsi`/`macd` from `lib/quant/indicators.ts`. Duplicate `ema` in `technicals.ts` deleted Phase 10 (`7fc76ff`); duplicate `rsi`/`sharpeRatio` in `technicals.ts` migration is Phase 15 Q-032.
- `next.config.js` `remotePatterns` is an EXPLICIT allowlist (no `**` wildcard) — Phase 15 Q-029 closed 2026-05-23.

## 6. Reproducibility check

```bash
npm run benchmark > /tmp/run1
npm run benchmark > /tmp/run2
diff /tmp/run1 /tmp/run2     # must be identical, modulo timestamps
# (benchmark-signals.mjs is a thin wrapper to benchmark-signals.ts)
```

Verified deterministic at Phase 13 S1 and Phase 14 closure (PR #16). Phase 15 reruns this at each sprint exit.

## 7. Security baseline — 2026-05-23

| Item | Status | Notes |
|------|--------|-------|
| Auth control-char regex (F7.9 / Q-039-NEW) | ✅ Correct | `/[\x00-\x1f\x7f]/` — verified via `od -c` + live JS eval 2026-05-23. False-positive flagged P0 withdrawn. |
| `remotePatterns` allowlist (R7-C-4 / Q-029) | ✅ Restricted | 7 explicit hosts; no `**` wildcard. Closed 2026-05-23. |
| CSP enforcing (R7-H-4 / Q-040-NEW) | ❌ Open | Still `Content-Security-Policy-Report-Only`; allows `unsafe-inline`/`unsafe-eval`. Phase 15 S1. |
| Distributed rate-limit (F4.3 / Q-005) | ❌ Open | Per-process Map; Vercel KV migration in S2. |
| `sanitizeError` in `lib/api/reliability.ts` (F7.2 / Q-023) | ❌ Open | Last holdout. Phase 15 S1. |
| Ticker validation (F7.3 / Q-015) | 🟡 Partial | `normalizeTicker` exists + applied; fuzz test absent. Phase 15 S1. |
| CSRF on POST (F7.4 / Q-036) | ❌ Open | Phase 15 S4. |
| Bloomberg timing-safe compare (F7.5 / Q-037) | ❌ Open | Phase 15 S4. |

---

## §H. Historical Phase 13 baseline (preserved for audit)

> Original entries below — superseded by §§1–7 above as of 2026-05-23. Kept verbatim for traceability of how the floors evolved.

### H.1 Algorithm performance (Phase 13 S1 baseline)

```
Total BUY signals: 1393
Wins: 785 | Losses: 608
Aggregate Win Rate:        56.35%
Avg Win Rate per Instrument: 58.97%
Avg 20d Return per Signal:   1.2541%
```

### H.3 Test inventory (Phase 13 S1 baseline)

```
Total test cases: 279
Test files:        21
```

### H.4 Code-quality (Phase 13 S1 baseline)

| Metric | Current |
|--------|---------|
| Silent `.catch(() => {})` | 4 |
| Largest component LOC | 1649 (`QuantLabPanel.tsx`) |
| Largest lib LOC | 691 (`signals.ts`) |

---

**Sign-off:**
- **Phase 13 S1 (2026-05-04):** C2 (Algorithm Lead) — frozen.
- **Phase 15 re-baseline (2026-05-23):** Pending C2 sign-off — Q-014 closure. Numbers re-measured from `scripts/benchmark-signals.mjs` (commit `7321b54`) and `vitest run`.

Any change to floors requires written C1+C2 approval and a dated amendment block.
