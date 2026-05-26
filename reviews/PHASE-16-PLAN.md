# Phase 16 — Architectural Refactor & Institutional Analytics Promotion

**Authored:** 2026-05-24 (Phase 15 closure + kickoff PR landed on `main`)
**Predecessor:** Phase 15 (50/56 backlog items done, 945 tests, 57.05% WR, 4-job CI gate live on `main`)
**Mandate:** Promote Phase 15's stubs + disclaimers to canonical implementations, decompose the remaining god components, and broaden test coverage to all `lib/**` modules.
**Duration target:** ~5 calendar weeks, 2 engineers + 1 quant in parallel.

---

## Team tracks (continuation of Phase 15 roster)

| Track | Owner | Mandate |
|---|---|---|
| **PM** | C1 | Sprint sequencing, gate enforcement, scope discipline |
| **Quant Research** | Q1 | Promote stubs to canonical models (multivariate OLS, full Taylor, GARCH MLE, HMM Viterbi); FRED prod activation |
| **Frontend** | F1 | QuantLabPanel + backtest page decomposition; KLineChart plugin registry |
| **Data / Platform** | D1 | Polygon migration completion; CSP enforcing flip; Stryker CI cron |
| **Security** | S1 | npm-audit triage; CSP monitoring before flip |
| **Testing** | T1 | Q-051-NEW coverage backfill; component-test infrastructure (Phase 16 kickoff laid the foundation); Stryker baseline |

---

## Frozen baseline (Phase 16 invariants — must not regress)

Captured 2026-05-24, post Phase 16 kickoff merge (commit `<TBD>` after this plan lands).

| Metric | Value | Floor |
|---|---|---|
| Aggregate WR (`npm run benchmark`) | **57.05%** | ≥ 56.55% (50 bps tol below 56.35%) |
| Tests passing | **945 passed + 17 skipped (962 total)** across 73 + 1 files | ≥ 945 / 73 |
| Coverage — Statements | 86.87% | ≥ 80% |
| Coverage — Branches | 76.26% | ≥ 70% |
| Coverage — Functions | 89.93% | ≥ 80% |
| Coverage — Lines | 88.9% | ≥ 80% |
| Largest component LOC | 1,684 (`QuantLabPanel.tsx`) | S2 target ≤ 500 |
| Largest lib LOC | 832 (`engine.ts`) | S1 target ≤ 600 |
| Largest page LOC | 887 (`app/backtest/page.tsx`) | S2 target ≤ 200 |
| CI runner versions | `actions/checkout@v5`, `setup-node@v5` | Node 24 by 2026-06-02 |
| Silent `.catch(() => {})` | 0 | 0 |
| Circular imports | 0 | 0 |

**Re-freeze trigger:** When the FRED RFR is activated in production (`QUANTAN_FRED_PREWARM=1` in Vercel env), C2 re-runs benchmark and amends this row — pre-FRED floor stands until then.

---

## Sprint plan (4 sprints × ~6 working days each = ~5 calendar weeks)

### Sprint S1 — Foundations (~4 days)

Already laid in the Phase 16 kickoff that ships with this plan:

| Item | Status |
|---|---|
| CI Node 24 bump (`actions/{checkout,setup-node}@v5`) | ✓ done (kickoff) |
| React Testing Library + jsdom + `@testing-library/jest-dom` installed | ✓ done (kickoff) |
| Component-test infrastructure (per-file `// @vitest-environment jsdom` pragma, setup file, PoC snapshot test) | ✓ done (kickoff) |
| Coverage backfill: `lib/optimize/{parameterSets, sectorProfiles}`, `hooks/useErrorToast` | ✓ done (kickoff) |
| Strategic file-level coverage excludes (no dir-level blanket excludes remaining) | ✓ done (kickoff) |

Remaining S1 work:

| Task | Owner | Effort | Notes |
|---|---|---|---|
| **P15-NEW-10** — Extract `walkForwardAnalysis` from `lib/backtest/engine.ts` (832 → ≤600 LOC) into `lib/backtest/walkForward.ts` | E1 | 1.5d | Engine has tests; extract should not change behaviour. Use existing walk-forward unit test as regression. |
| **Q-004 prod activation** — Set `QUANTAN_FRED_PREWARM=1` in Vercel env; C2 re-runs benchmark, amends `reviews/invariants-baseline.md` §1 with new Sharpe/Sortino | C2 + S1 | 0.5d code + 1d monitoring | WR (count-based) won't shift; Sharpe/Sortino will. |
| **npm-audit triage** — Run `npm audit --omit=dev`; investigate the 1 critical from Stryker install tree; document or pin | S1 | 0.5d | |
| **Snapshot tests** for QuantLabPanel + backtest page (preconditions for S2 decomp) | F1 + T1 | 2d | Mock fetch, mock useSession, capture representative prop snapshots. |

**Exit gate:** Engine ≤600 LOC, FRED active in prod (Sharpe/Sortino reflect FRED rate), pre-decomposition snapshots captured.

---

### Sprint S2 — God-component decomposition (~10 days)

| Task | Owner | Effort | Acceptance |
|---|---|---|---|
| **Q-053-NEW** — `components/stock/QuantLabPanel.tsx` 1684 → 5 sub-tabs ≤ 400 LOC each | F1 + F2 | 5d | All snapshot tests pass; smoke routes intact; no new `any` |
| **Q-054-NEW** — `app/backtest/page.tsx` 887 → page ≤ 200 LOC + presentational panels | F1 | 2d | Same |
| **`KLineChart.tsx`** plugin registry (1014 → ≤ 500 LOC core) | F2 | 3d | Each indicator becomes a `ChartPlugin`; core chart loads plugins via prop |
| **`app/crypto/btc/page.tsx`** decomposition (806 → ≤ 300 LOC) | F1 | 2d | Extract WS-feed orchestration, chart, indicator panel |

**Exit gate:** zero components > 500 LOC; zero pages > 300 LOC; zero lib files > 600 LOC; visual-regression snapshots pass.

---

### Sprint S3 — Math correctness promotions (~10 days)

Promote Phase 15 stubs / disclaimers to canonical implementations:

| Task | Owner | Effort | Promotion path |
|---|---|---|---|
| `lib/portfolio/factorAttribution.ts` — naive univariate β → real multivariate OLS via QR decomposition; real R² (1 − SSres/SStot); 5-factor alpha | Q1 | 4d | Remove top-of-file disclaimer once landed |
| `lib/scenarios/engine.ts` — linear delta-only → full Taylor expansion (`Δ·dS + ½Γ·dS² + ν·dVol + θ·dT + ρ·dR`) | Q1 | 3d | Separate portfolio-Greeks output (Σ position Greeks) from scenario-P&L output |
| `quant_framework/garch.py` — 18-LOC EWMA stub → real `arch.arch_model(returns, vol='Garch', p=1, q=1).fit()` | Q1 + D1 | 3d | Python sidecar deploy; daily forecast cron writing to KV |
| `quant_framework/regime_hmm.py` — 27-LOC vol-ratio classifier → real `hmmlearn.GaussianHMM(n_components=3).fit()` + Viterbi | Q1 + D1 | 4d | Weekly retrain on trailing 5y |
| `lib/portfolio/riskParity.ts` — add property-based tests for ERC equal-RC invariant + Maillard-Roncalli-Teiletche reference convergence | Q1 + T1 | 1d | Bug already fixed in Phase 15 closure; this is regression hardening |

**Exit gate:** all 4 disclaimers removed from the corresponding source files; canonical model outputs match prior-art benchmarks to within published tolerances (cite specific Carhart / Jorion / Engle test vectors).

---

### Sprint S4 — Productionization + coverage closure (~6 days)

| Task | Owner | Effort | Acceptance |
|---|---|---|---|
| **Q-040-NEW completion** — Flip CSP from Report-Only to enforcing | S1 | 0.5d code + 7d monitoring | Wait 7 days of clean Report-Only with no console violations; set `QUANTAN_CSP_ENFORCE=1` in Vercel env |
| **Polygon migration** — Sign $199/mo plan; legal opinion on Yahoo/Polygon use split; set `POLYGON_API_KEY` in Vercel | D1 + C1 + external counsel | 2d code + ~1 week external | Provider dispatcher auto-routes equity-eod + equity-quote to Polygon |
| **Stryker baseline** — Schedule CI cron (weekly?) running `npm run stryker` on `lib/quant + lib/backtest + lib/options` | T1 | 2d setup + ~1h baseline run | Set realistic break threshold based on baseline; gate PRs that drop ≥ 5pp |
| **Coverage backfill — completion** — Remove the remaining file-level excludes in `vitest.config.ts` by writing the corresponding tests | T1 | 3d | hooks/useLiveQuote, useLiveQuotes, useLivePrices, useDialogA11y, useWatchlist; lib/data/providers/{yahoo, polygon, alphavantage}; lib/data/bloomberg/toBloombergSecurity.ts; lib/data/warehouse.ts; lib/ml/client.ts; lib/optimize/gridSearch.ts; lib/quant/frameworks.ts |
| **axe-core in CI** — `@axe-core/playwright` on 5 priority routes (`/`, `/sector/[slug]`, `/stock/[ticker]`, `/backtest`, `/options/[ticker]`) | F1 + R6 | 3d | Zero critical violations |

**Exit gate (Phase 16 sign-off):**
1. Every Phase 15 disclaimer module is now canonical (multivariate OLS, full Taylor, real GARCH MLE, real HMM Viterbi)
2. Every component ≤ 500 LOC; every lib file ≤ 600 LOC; every page ≤ 200 LOC (presentational components OK)
3. Coverage ≥ 80% lines / ≥ 70% branches with zero file-level excludes
4. Stryker mutation score baseline set; CI gate active
5. CSP enforcing in production for ≥ 7 days zero violations
6. Polygon primary in production (or legal counsel opinion documenting Yahoo retention)
7. axe-core zero criticals on 5 priority routes
8. Reproducibility hash matches across 2 benchmark runs
9. All Phase 16 backlog tasks (Q-051-NEW continuation, Q-053-NEW, Q-054-NEW) marked done

---

## Cross-sprint quality gates (every PR must clear)

| Gate | Tool | Threshold |
|---|---|---|
| Type check | `tsc --noEmit` | zero errors |
| Test suite | `vitest run` | ≥ 945 tests passing |
| Coverage | `vitest --coverage` | thresholds in `vitest.config.ts` |
| Mutation (from S4) | `stryker run` | TBD baseline + no regress > 5pp |
| Lint | `eslint . --ext .ts,.tsx` | zero errors |
| Benchmark | `npm run benchmark` | WR ≥ 56.55% (or post-FRED re-baseline floor) |
| Reproducibility | hash-match across 2 runs | identical |
| Component snapshots | RTL `toMatchSnapshot` | no unexpected drift |
| Accessibility (from S4) | axe-core | zero critical |
| `npm audit` | `--audit-level=high --omit=dev` | zero high+ prod-affecting |

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| QuantLabPanel decomp introduces visual regression | High | High | Snapshot tests captured in S1 BEFORE refactor begins; reviewer must verify snapshots empty-diff |
| Polygon free tier insufficient (5 req/min) | High | Medium | Stay on Yahoo as fallback per provider dispatcher; gate migration on paid plan |
| CSP enforcing breaks third-party widget | Medium | Medium | 7-day Report-Only monitoring before flip; nonce middleware ready |
| GARCH/HMM Python sidecar latency > 500ms | Medium | Low | Cache forecast for 24h; UI shows stale-with-asof |
| HMM model regimes don't stabilise | Medium | Medium | Viterbi-decoded states with min-duration ≥ 5 bars; reject single-bar flips |
| FRED prod activation shifts Sharpe enough to fail benchmark | Low | Medium | Re-baseline in same PR; C2 sign-off |
| Stryker baseline so low that 70% threshold is unattainable | Medium | Low | Set threshold based on baseline run, not aspiration |
| `@stryker-mutator/*` install brings new prod-affecting CVEs | Low | Medium | Run `npm audit --omit=dev`; Stryker is dev-only — most CVEs will filter out |

---

## Out of scope for Phase 16 (Phase 17+)

- Mobile-native app
- Multi-tenancy / billing
- Order routing / live brokerage integration
- HFT / sub-second execution
- International / FX-hedged sector overlay
- Alternative data sources beyond Polygon (no Refinitiv, no Bloomberg redistribution)

---

## Open questions for the PM (resolve before S2 starts)

1. Polygon plan tier — $199/mo Stocks-Currencies-Indices-Equities, or larger?
2. CSP monitoring — what's the violation collector? (Sentry, Vercel Log Drain, or build a tiny collector?)
3. Stryker CI cron cadence — weekly Sunday night? On every merge to main? Out of band?
4. Snapshot test scope for QuantLabPanel — exhaustive (10+ prop combinations) or representative (3–4)?
5. axe-core tool — vitest-jsdom (cheap, limited) or Playwright (richer but heavier)?

---

## Companion documents

- `reviews/PHASE-15-PLAN.md` — Phase 15 canonical plan (read-only history)
- `reviews/PHASE-14-CRITIQUE-LOG.md` — 138 historical findings (read-only)
- `reviews/findings-ledger.csv` — F1.x–F8.x ledger
- `reviews/invariants-baseline.md` — frozen floors (re-baselined Phase 15 Q-014)
- `workspace/IMPROVEMENT_BACKLOG.json` — 56 tasks Q-001..Q-056-NEW (Phase 16 adds Q-057-NEW..Q-060-NEW as continuations land)
- `workspace/HANDOFF.md` — session-to-session handoff

**Authored by:**
- C1 (Tech Lead) — sprint cuts, gate enforcement, scope discipline
- Q1 (Quant Research) — stub → canonical promotions, FRED activation
- F1 (Principal FE) — god-component decomposition, plugin registry
- D1 (Staff DE) — Polygon migration, CSP flip, Stryker CI
- S1 (CISSP) — npm-audit triage, CSP monitoring
- T1 (Staff SDET) — coverage backfill closure, Stryker baseline
