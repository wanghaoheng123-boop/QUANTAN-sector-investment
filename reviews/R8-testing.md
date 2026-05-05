# R8 — Testing & Reliability Review (Phase 13 S1)

**Reviewer:** R8 — Staff SDET, mutation/property-based testing
**Sprint:** S1 (read-only)
**Date:** 2026-05-05
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| Area | Read |
|------|------|
| `__tests__/` directory tree (all 21 files counted) | by-file headers + grep-based test-case count |
| `vitest.config.ts` | not read (deferred) |
| `scripts/verify-*.mjs` (3 scripts) | not read |
| `scripts/run-smoke-*.mjs` (5 scripts) | not read |
| `scripts/benchmark-signals.mjs` output | run + captured baseline |

**Disclosure:** Coverage assessment is module-presence-based, not line-coverage-based. Real coverage requires running `npm run test:coverage` from a path without spaces (worktree path bug); I4 captures this in S1 day 2.

---

## Test inventory

| Directory | Files | Test cases |
|-----------|-------|-----------|
| `__tests__/backtest/` | 2 | 38 |
| `__tests__/options/` | 4 | 53 |
| `__tests__/qa/` | 2 | 21 |
| `__tests__/quant/` | 13 | 167 |
| **Total** | **21** | **279** |

---

## Findings

### F8.1 [CRITICAL] — Hot-path modules have ZERO unit tests

**Location:** Eleven modules with no corresponding `*.test.ts`:

| File | LOC | Risk |
|------|-----|------|
| `lib/backtest/portfolioBacktest.ts` | 493 | HOT — multi-instrument engine |
| `lib/backtest/exitRules.ts` | (~200) | HOT — ATR stops, profit-taking, trailing, panic exits |
| `lib/backtest/dataLoader.ts` | — | data ingest into engine |
| `lib/data/mergeQuotes.ts` | 81 | HOT — Bloomberg/Yahoo merge (R4 found 2 HIGH bugs) |
| `lib/data/warehouse.ts` | — | SQLite persistence |
| `lib/api/rateLimit.ts` | 121 | resilience layer |
| `lib/api/reliability.ts` | 60 | retry/timeout |
| `lib/options/chain.ts` | 156 | options enrichment + greeks composition |
| `lib/quant/buildFundamentalsPayload.ts` | 413 | fundamentals + DCF inputs |
| `lib/quant/earningsParse.ts` | — | earnings text parsing |
| `lib/quant/technicals.ts` | — | legacy/wrapper |

**Why critical:** `portfolioBacktest.ts` is referenced by R1 finding F1.7 (correlation-adjusted Kelly) and F1.2 (max DD). Any S2 fix to that module will be unverified — engineers can introduce regressions silently. Same for `exitRules.ts`, which contains the trailing-stop / profit-take logic that R1's F1.3 (intraday-low stop check) depends on.

**Patch sketch (S2 work — must land BEFORE the corresponding S2 fix):**
1. `__tests__/backtest/portfolioBacktest.test.ts`:
   - Synthetic 10-instrument input → assert max DD ≤ min(individual DDs) × 1.1 (catches F1.2)
   - sectorGates per-ticker override path → assert AAPL with `goldenCrossGate=true` produces zero BUYs when EMA50 < EMA200
   - Correlation-adjusted Kelly path (after F1.7 fix lands) → assert no concentration > 30% in correlated names
2. `__tests__/backtest/exitRules.test.ts`:
   - Intraday low piercing stop → assert exit fires at fill price not close (catches F1.3)
3. `__tests__/data/mergeQuotes.test.ts`:
   - Bloomberg returns volume=0 (halt) → assert merged quote.volume === 0 (catches F4.2)
   - Field-level provenance contains both sources
4. `__tests__/api/rateLimit.test.ts`:
   - Token bucket exhaustion + refill timing
   - Stale cleanup after 15 minutes
5. `__tests__/api/reliability.test.ts`:
   - withRetry exponential backoff + jitter (after F4.4 fix lands)
   - withTimeout fires after exact ms

**Acceptance test:** Module-presence audit script:
```bash
for f in lib/backtest/exitRules.ts lib/backtest/portfolioBacktest.ts ...; do
  test_file=$(find __tests__ -name "$(basename $f .ts).test.ts")
  if [ -z "$test_file" ]; then echo "MISSING: $f"; exit 1; fi
done
```
CI-enforced after S2.

**Severity:** Critical — gates the entire S2 sprint.

---

### F8.2 [HIGH] — Zero component tests in the entire repo

**Location:** Search for `__tests__/components/` — directory does not exist.

**Evidence:** No component snapshot tests, no React Testing Library tests, no behavior tests for `KLineChart`, `QuantLabPanel`, `MetricTooltip`, `DashboardGuide`, etc. Phase 12 introduced 6+ new components; none are tested.

**Why high:** Plan S3 calls for god-component decomposition (F5.2 QuantLabPanel 1649 → multi-component, F5.3 backtest/page 934, etc.). Without snapshot/behavior tests, refactor regressions are invisible. The plan's S3 exit gate ("behavior-equivalence tests for representative props") is impossible without a testing infrastructure.

**Citation:** Kent C. Dodds (2018). "The Testing Trophy." Better than the Pyramid for component-heavy codebases.

**Patch sketch:**
1. Add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` to devDeps.
2. Configure `vitest.config.ts` for jsdom environment on `*.test.tsx` files.
3. Create `__tests__/components/` with one starter test per top-component:
   - `QuantLabPanel.test.tsx`: renders for known ticker, shows expected tabs.
   - `KLineChart.test.tsx`: receives candles, renders canvas, accessibility name set (F6.2).
   - `MetricTooltip.test.tsx`: opens on hover, closes on Escape, restores focus.
4. Snapshot tests for `SectorCard`, `SignalCard`, `DashboardGuide`.

**Acceptance test:** `find __tests__/components -name "*.test.tsx" | wc -l ≥ 10` after S3 setup.

**Severity:** High — blocks S3 architectural work; current zero-coverage on UI is unacceptable for institutional-grade product.

---

### F8.3 [HIGH] — No mutation testing — high test count does not imply high test quality

**Location:** `package.json` devDeps; no Stryker / mutation tooling.

**Evidence:** 279 tests sounds robust, but tests can pass while assertions are weak (e.g., `expect(x).toBeTruthy()` instead of `expect(x).toBe(42)`). Mutation testing systematically introduces bugs and verifies tests catch them. Plan S4 lists this as a target (mutation score ≥ 70% on backtest/quant/options).

**Citation:**
- Jia, Y. & Harman, M. (2011). "An Analysis and Survey of the Development of Mutation Testing." *IEEE Transactions on Software Engineering* 37(5), p649–678.
- Petrovic, G. & Ivankovic, M. (2018). "State of Mutation Testing at Google." ICSE-SEIP.

**Patch sketch (S4):**
1. Add `@stryker-mutator/core`, `@stryker-mutator/vitest-runner` to devDeps.
2. Create `stryker.conf.json` with mutation targets: `lib/backtest/**`, `lib/quant/**`, `lib/options/**`.
3. CI gate: mutation score ≥ 70% on those modules; ≥ 50% on the rest.

**Acceptance test:** `npx stryker run` produces a report; CI fails if score < threshold.

**Severity:** High — quality-vs-quantity gap.

---

### F8.4 [HIGH] — No integration tests for API routes (every route is unverified end-to-end)

**Location:** No `__tests__/api/` directory.

**Evidence:** 30+ API routes, zero integration tests. Each route's contract (input → output schema, error envelope, status codes) is established only by manual / smoke testing.

**Why high:** Phase 12's `useLivePrices` schema mismatch with `/api/prices` (caught only by manual code-read in the previous session) is exactly the class of bug integration tests catch automatically.

**Patch sketch:**
1. Use `next-test-api-route-handler` or fetch-against-test-server.
2. Smoke per route:
   - 200 happy path with valid input
   - 400 on malformed ticker (ties to F7.3 fuzz)
   - 429 on rate-limit exceeded (after F4.3/F7.7 fix)
   - 500 path returns sanitized error (after F4.8/F7.2 fix)
3. Schema validation: assert response matches a `zod` or `io-ts` schema.

**Severity:** High — every API change is a Russian-roulette merge.

---

### F8.5 [MEDIUM] — No property-based tests for indicator math

**Location:** `__tests__/quant/indicators.test.ts` (assumed example-based).

**Evidence:** With 13 quant test files / 167 cases, the test approach is example-based (specific inputs → expected outputs). For mathematical functions, property-based testing (e.g., fast-check) provides far stronger coverage. Examples:
- EMA: `ema(reverse(values), n)` ≠ `reverse(ema(values, n))` (asymmetric — but the property "EMA of constant series equals that constant" SHOULD hold).
- RSI: bounded in [0, 100] for any non-empty input.
- ATR: monotonic in volatility — synthetic sigma=0.1 vs sigma=1.0, ATR(1.0) > ATR(0.1).
- Sharpe: invariant to scale (multiply all returns by constant > 0 → Sharpe unchanged).

**Citation:** Hughes, J. (2007). "QuickCheck: Lightweight Tools for Random Testing of Haskell Programs." *Communications of the ACM* — original property-based testing foundation.

**Patch sketch:**
```ts
import fc from 'fast-check'
import { rsiArray } from '@/lib/quant/indicators'

it('RSI is bounded in [0, 100]', () => {
  fc.assert(fc.property(
    fc.array(fc.float({ min: 1, max: 1000 }), { minLength: 50, maxLength: 500 }),
    (closes) => {
      const rsi = rsiArray(closes)
      return rsi.every(r => !Number.isFinite(r) || (r >= 0 && r <= 100))
    }
  ), { numRuns: 1000 })
})
```

**Severity:** Medium — strong test enhancement; not blocking.

---

### F8.6 [MEDIUM] — `vitest.config.ts` coverage thresholds — verify in second pass

**Location:** `vitest.config.ts` (deferred, but `package.json` has `"test:coverage": "vitest run --coverage"`).

**Evidence:** AGENTS.md mentions "80% coverage thresholds" as Phase 1. Need to confirm `vitest.config.ts` actually enforces them and CI fails on regression. If thresholds are merely reported (not enforced), coverage drift is invisible.

**Patch sketch:**
```ts
// vitest.config.ts
coverage: {
  provider: 'v8',
  thresholds: {
    statements: 80,
    branches: 75,
    functions: 80,
    lines: 80,
  },
  // Per-module thresholds (Phase 13 plan):
  perFile: false,  // global
  include: ['lib/**/*.ts'],
  exclude: ['lib/mockData.ts', '**/*.d.ts'],
}
```
Plus a per-directory enforcement layer (custom CI check) for `lib/backtest/`, `lib/quant/`, `lib/options/` ≥ 90%.

**Severity:** Medium — process gap.

---

### F8.7 [MEDIUM] — Smoke tests likely don't run in CI — verify

**Location:** `scripts/run-smoke-*.mjs` (5 variants), `package.json` `check:smoke:*` scripts.

**Evidence:** 5 smoke-script variants exist (extended, local, nosearch combinations). Need to confirm CI runs at least one per push to main. The `check:ci` target only runs `verify:data` + `check:smoke` (one variant); the extended one is left to manual.

**Patch sketch:** Add `check:smoke:extended` to CI on a nightly cron (avoid blocking PRs). Document in `docs/RUNBOOK.md`.

**Severity:** Medium — process gap.

---

### F8.8 [LOW] — `vitest run` blocked by space-in-path on the worktree shell

**Location:** Captured during S1 baseline collection.

**Evidence:** Running `node node_modules/vitest/dist/cli.js run` from the worktree shell context fails with vite-internal `_setServer` URL parsing issue. This is a worktree CWD reset behavior (the shell-cwd-reset at session start drops into a subdirectory with spaces in the path, then vitest's URL handling chokes).

**Patch sketch:** Either:
1. Patch vite/vitest to URL-decode internal server-config paths (upstream fix).
2. Document a workaround in docs/RUNBOOK.md: run from main worktree, not `.claude/worktrees/`.

**Severity:** Low — local-dev nuisance, not a CI/test issue.

---

## Cross-domain handoffs

- **R1, R2, R3, R4:** every finding from those reviewers has an acceptance test specified — R8 verifies they ALL land before the corresponding fix commit (rule 5).
- **R5:** F8.2 (component tests) is the architectural prerequisite for S3 god-component refactor.
- **R7:** F8.4 (API integration tests) covers F7.3's fuzz-test handoff.
- **C1, C2:** F8.1 directly affects S2 readiness. C2 must approve any S2 fix that lacks a pre-landed red test.

---

## Self-dissent

I have NOT counted lines covered (only files present). It's possible some hot-path modules are exercised transitively through other tests (e.g., `portfolioBacktest.ts` may be partially covered via `engine.test.ts` if it imports the portfolio aggregator). A real coverage report from `npm run test:coverage` (S1 day 2 task for I4) will refine my severity calls.

I have NOT read `vitest.config.ts` to confirm whether 80% thresholds are enforced. F8.6 is contingent.

---

## Findings summary table

| ID | Severity | Loc | One-line |
|----|----------|-----|----------|
| F8.1 | CRITICAL | (11 modules) | hot-path modules have zero tests (incl portfolioBacktest, exitRules, mergeQuotes) |
| F8.2 | HIGH | __tests__/components/ | zero component tests in the repo |
| F8.3 | HIGH | package.json | no mutation testing |
| F8.4 | HIGH | __tests__/api/ | zero API integration tests |
| F8.5 | MEDIUM | __tests__/quant/* | no property-based testing for math |
| F8.6 | MEDIUM | vitest.config.ts | coverage thresholds not verified |
| F8.7 | MEDIUM | CI config | smoke tests likely not in PR CI |
| F8.8 | LOW | (vitest internal) | space-in-path blocks local vitest from worktree |

Total: 8 (1 Critical, 3 High, 3 Medium, 1 Low).

---

**Reviewer signature:** R8
**Cross-checked by:** all reviewers (every finding's acceptance test lands here) — pending
**Inspector spot-check:** I4 (E2E coverage report) — pending
