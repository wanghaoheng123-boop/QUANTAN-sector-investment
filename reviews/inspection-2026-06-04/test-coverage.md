# Test Coverage & Quality Review — 2026-06-04

> Authored inline by the coordinator after the dispatched test-coverage agent
> (`a6d77a905545bddee`) died on a transient socket error at 69 tool-uses before
> its first incremental write. Read-only.

## Severity legend: P0 (false safety / critical gap) / P1 (weak test) / P2 (cleanup)

## Headline: is the 89% coverage claim defensible? → **QUALIFIED YES**
- 88 test files; CI enforces vitest coverage thresholds **80/80/80/70** (lines/funcs/
  stmts/branches, Q-022 in `vitest.config.ts`) — so 80% is a HARD floor, not a vanity
  number. The 89% "weighted function coverage" in `reviews/MASTER-FUNCTION-COVERAGE-2026-06-03.md`
  is defensible for API (100%) and Quant (87%) but **generous for UI**: that same doc
  admits "Formal UI audit file not on disk" and marks 8/16 pages as "INVENTORY" (not
  audited). Treat UI coverage as ~83% claimed / lower in practice.

## Invariant vs regression-pin verdict (the key question) → **MOSTLY INVARIANT (good)**
The critical quant tests assert true mathematical properties, NOT frozen output numbers:
- **`engine.equity.invariant.test.ts`** — multi-seed property tests: equity finite &
  positive at EVERY bar; closed-trade `pnlPct ≈ (exit−entry)/entry` to 8 decimals;
  flat-position equity == capital exactly. **Strong.**
- **`signalParity.test.ts`** — proves benchmark-label == `resolveBacktestSignal` ==
  live-adapter signal (action, confidence, KellyFraction all equal). **This is the
  single most valuable test in the suite** — it guards backtest/live drift.
- **`portfolioBacktest.test.ts`** (Cursor modified in PR #41) — invariants, not pins:
  maxDD ∈ [0,1), finalCapital > 0, maxConcurrentPositions ≤ maxPositions, correlation-
  gate behavior at 0/0.99, null VaR on short series. **Cursor STRENGTHENED, did not
  just re-baseline.**
- **`factorAttribution.test.ts`** (Cursor added in PR #41) — recovers β_MKT≈1 when
  asset==MKT; recovers intercept when asset==2×MKT+const. **Ground-truth recovery,
  genuine correctness test.** Corroborates that Cursor's factor work is real.
- **`exitRules.test.ts`** (567 LOC) — the Part-2 quant agent independently verified it
  proves invariants (precedence, resting-order semantics), not number-pinning.

## P1 — Genuine gaps

### [P1-1] No dedicated look-ahead regression guard
The 54.66%→48.37% WR look-ahead removal (PR #41) is NOT pinned by a test that injects
a future bar and asserts the signal is unchanged. It is only indirectly protected by
(a) `signalParity` and (b) the CI net-WR floor (≥53.29%). **A future re-introduction of
look-ahead that kept WR above 53.29% would pass CI silently.** Recommend an explicit
"signal at bar i is invariant to mutations of bars > i" property test.

### [P1-2] Survivorship bias is untested and undocumented in tests
`grep -rln survivorship|delisted|universe __tests__` → **empty.** The hard-coded
mega-cap survivor universe (flagged by the quant agent across `scripts/*`) has no test
asserting or even documenting the limitation. The CI WR floor is therefore measured on
a survivor-biased universe — a structural caveat the test suite is silent on.

### [P1-3] CI WR floor is a weak correctness gate
`ci.yml` gates `aggregate.aggregateNetWinRate ≥ 53.29%` (frozen 53.79% − 50bps). A
single scalar floor cannot distinguish "algorithm correct" from "algorithm wrong but
still >53.29% on survivor data." Pair it with the invariant/parity tests (which DO
catch structural breaks) — those are the real guard; the floor is a coarse backstop.

## P1 — Mock / fixture realism
### [P1-4] Upstream error/partial-failure paths under-tested at the route layer
API happy-path 200s are well covered (`__tests__/api/*`), and `trading-agents-auth.test.ts`
+ `rateLimit*.test.ts` cover fail-closed auth / 429 / CSRF. But the multi-upstream
fan-out partial-failure branches (briefs outer `Promise.all`, crypto metrics `_errors`
mapping — see api-backend.md P1-3/P1-4) are not exercised with a partial-failure mock.
The bug api-backend P1-4 (outer `Promise.all` not `allSettled`) would not be caught.

## P2
### [P2-1] Snapshot tests track styling, not behavior
`QuantLabPanel.test.tsx.snap` / `BacktestPage.test.tsx.snap` had to be refreshed for
lucide-react 1.x (commit a0fa737) — confirming they freeze rendered markup, so they
break on cosmetic dep bumps and don't assert behavior. Low value; keep but don't trust
as correctness gates.
### [P2-2] `lib/qa/{dataValidator,signalTracker}.ts` and `lib/portfolio/riskParity.ts`
are TESTED but NOT wired into any production path (per structure agent). The tests pass
and the math is correct (quant agent verified riskParity ERC), but they guard dormant
code — coverage % is inflated by exercising unused modules.

## Mutation testing
- Stryker IS wired (`stryker.conf.mjs`: thresholds high 80 / low 70 / **break 70**) and
  scheduled weekly (`.github/workflows/stryker-weekly.yml`). Break-at-70 means a mutation
  score below 70% fails the weekly run — a real (if lagging, non-blocking-on-PR) guard.
  Confirm the `mutate:` glob actually includes `lib/backtest/*` and `lib/quant/*` (the
  high-value files) and isn't scoped to a trivial subset.

## CI gate gaps (can a look-ahead regression pass CI?) → **YES, narrowly**
typecheck ✓ · vitest ✓ · coverage 80/80/80/70 ✓ · net-WR floor ≥53.29% ✓ · smoke ✓.
A look-ahead regression that (a) preserved signal-parity outputs and (b) kept WR above
53.29% could pass. The parity + invariant tests make (a) hard, but there is no direct
future-bar-immunity assertion. Net: strong suite, one targeted guard missing (P1-1).

## What I did NOT cover (inline pass was time-boxed)
- Per-file reading of all 88 test files (sampled the ~12 highest-value quant/API ones).
- Exact stryker `mutate:` glob contents (flagged for confirmation above).
- `__tests__/components/**` beyond the snapshot observation.
- `__tests__/data/**` warehouse/provider mock fidelity (250-LOC warehouse.test.ts).
- Whether `test:coverage` thresholds are per-file or global (global thresholds can hide
  a 0%-covered critical file behind well-covered trivial ones — worth checking).
