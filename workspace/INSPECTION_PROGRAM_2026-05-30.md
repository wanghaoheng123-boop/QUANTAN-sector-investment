# QUANTAN Full-Platform Inspection & Rectification Program — 2026-05-30

**Program owner (agent):** Claude (Opus 4.8) · **Mode:** autonomous, multi-cycle, token-aware
**Mandate:** Full inspection (structure / code / algorithms / UI / UX) → consolidated severity-ranked
review + detailed rectification list → dispatch rectification teams (agents) under inspector
supervision → land safe fixes as PRs. Decisions made autonomously by an expert panel; owner
actions (PR merges = production deploys) surfaced, never executed by the agent.

**This file is the SSOT for the program.** All state lives here, not in the context window, so
the work resumes cleanly when the token budget recovers. Update it as phases complete.

---

## 0. Guardrails (non-negotiable, per standing orders + advisor)

- **NO PR merges.** Merge to `main` = production deploy = owner-only. Agent produces PRs + a
  recommended merge order; the owner merges.
- **No push to `main`, never force-push `main`.** PRs come from a worktree, not the repo root.
- **Read-only inspection fans out to parallel agents. Auto-rectification is GATED:**
  - Bucket A (safe-mechanical/cosmetic) → may become scoped PRs autonomously.
  - Bucket B (signal math / benchmark / WR re-baseline / security-sensitive) → **needs-decision**;
    no autonomous edits. Re-checkpoint (advisor) before dispatching any Bucket-B edit.
- **Dedup against existing trackers.** Every finding must cite the status of any existing tracker
  entry (INSPECTION-WAVE-3/4/5, FULL_PLATFORM_QA_2026-05-26, REAL_WORLD_VALIDITY_CRITIQUE,
  IMPROVEMENT_BACKLOG.json, invariants-baseline.md §7). Reconcile; do not re-litigate tracked items.
- **No secrets** in code/logs; env vars only.

---

## 1. Baseline platform health — captured 2026-05-30 (main @ 8d56955)

| Check | Result |
|-------|--------|
| `npm run build` (Next.js 14.2.35 production) | ✅ PASS (exit 0, bundle generated) |
| `npx tsc --noEmit` | ✅ PASS |
| `npx vitest run` | ✅ 979 passed / 17 skipped (96 files) — above 816 floor |
| `npm run benchmark` (SSOT label) | ✅ 54.77% gross / 53.79% net (matches frozen §1b) |
| Node | v25.6.1 (note: CI uses Node 20) |

### Structural metrics (main @ 8d56955)

| Metric | Value | Note |
|--------|-------|------|
| Source LOC (app+components+lib+scripts+hooks) | ~35,670 | lib 15,044 / app 9,543 / components 8,794 |
| Source files | 212 | lib 93 / components 56 / app 52 / hooks 6 / scripts 5 |
| Largest files | KLineChart.tsx **1039**, app/crypto/btc/page.tsx 813, signals.ts 732, indicators.ts 667, stock/[ticker]/page.tsx 654, engine.ts 643, portfolioBacktest.ts 608 | invariants §4 is STALE (listed QuantLabPanel 1684 / engine 807 — both since decomposed) |
| API routes | 27 `route.ts` | |
| Test files | 85 | |
| TODO/FIXME/HACK | 0 | clean |
| `@ts-ignore` / `@ts-expect-error` | 0 | clean |
| `any` casts (grep `: any`/`as any`) | 13 | vs invariants §4 "≤5 / ~7 sites" — **verify counting method before flagging** |
| `console.*` in app/components/lib | 84 | triage: debug leftovers vs intentional |
| `eslint-disable` comments | 9 | **vestigial — repo has NO eslint config** (lead) |

**Interpretation:** mature, healthy, green codebase that has been through multiple inspection
waves. Inspection must find *real* issues, not rubber-stamp. Expect diminishing returns on broad
re-sweeps; focus on depth + reconciliation.

---

## 2. Open PR backlog (the real bottleneck) — 7 unmerged, all fork from 8d56955

| PR | Branch | Scope | Key files | Notes |
|----|--------|-------|-----------|-------|
| #24 | chore/expert-team-program | optimize research framework | scripts/optimize-batch.ts, lib/optimize/canonicalBenchmark.ts | "research proxy" — imported by #29's file |
| #25 | fix/nightly-benchmark-floor | nightly CI gross→net floor | .github/workflows/nightly-backtest.yml | |
| #26 | chore/cleanup-orphan-unused-deps | remove dead component + unused deps | package.json, components/backtest/BacktestMetricsGrid* | |
| #27 | fix/data-refresh-integrity-guard | fixture integrity guard | scripts/fetchBacktestData.mjs | |
| #28 | fix/exit-fill-next-open-symmetry | engine T+1 exit symmetry | lib/backtest/engine.ts, reviews/invariants-baseline.md | |
| #29 | refactor/exec-cost-ssot-fmtpct | cost SSOT + fmtPct dedup | executionModel.ts, portfolioBacktest.ts, OptionsChainTable, quantlab/formatters | touches file that imports #24's canonicalBenchmark |
| #30 | chore/untrack-db-and-doc-sync | untrack 3 .db binaries | (deletes .db) | |

**Collision analysis (all 7 fork from 8d56955):** Source-file overlaps are minimal.
- #25, #27, #30 are fully isolated (1 file / deletions only).
- #28 (engine.ts + invariants-baseline.md) and #29 (executionModel.ts, portfolioBacktest.ts,
  OptionsChainTable, quantlab/formatters, test) share NO files. invariants-baseline.md is touched
  ONLY by #28.
- #24 ∩ #26 = `package.json`, but **different sections** (#24 adds `optimize:batch` script; #26
  removes `date-fns`+`framer-motion` deps) → trivially auto-mergeable, not a real conflict.
- **PR #24 needs REWORK before merge (3 issues, confirmed):** (1) reintroduces
  `scripts/backtest/dataLoader.ts` which main DELETED as a duplicate (regression hazard);
  (2) commits **223 `workspace/optimization-runs/*` artifacts** + a `.log` (230 files total —
  generated artifacts that should be `.gitignore`d, same class as the just-untracked `.db` files);
  (3) trivial package.json rebase vs #26.

**RECOMMENDED MERGE ORDER (owner action — merges = production deploys):**
1. **#30** untrack `.db` (deletions only; shrinks repo) — zero risk
2. **#27** data-integrity guard (`scripts/fetchBacktestData.mjs` only) — isolated
3. **#25** nightly CI floor (`nightly-backtest.yml` only) — isolated
4. **#28** engine T+1 exit symmetry (`engine.ts` + invariants §1c) — isolated; establishes §1c
5. **#29** cost/format SSOT (executionModel/portfolioBacktest/2 components/test) — isolated source files
6. **#26** cleanup + unused-deps (package.json deps section + dead BacktestMetricsGrid) — isolated
7. **#24** research framework — **REWORK FIRST**: drop the 223 artifacts (gitignore), drop the
   reintroduced `scripts/backtest/dataLoader.ts`, rebase package.json (trivial). Merge LAST.

Steps 1–6 are mutually non-conflicting and may merge in any order; the sequence above is
low-risk-first. Only #24 requires pre-merge rework.

Also stale: PR #8 (cursor/trading-simulator), PR #9 (fix/dead-ema-and-progress-audit) — UNKNOWN
mergeability, predate the current work. Recommend owner **close** (their content is long superseded)
or explicitly reassess.

---

## 3. Inspection domains (read-only agents, parallel)

| # | Domain | Agent | Status | Findings → |
|---|--------|-------|--------|-----------|
| D1 | Architecture & code structure (god files, dead code, dup, SSOT, circular deps, boundaries) | general-purpose (read-only) | PENDING | §5 |
| D2 | Algorithms & quant correctness (signals, engine, indicators, look-ahead, stats validity, costs) | general-purpose (read-only) | PENDING | §5 |
| D3 | UI/UX (components, a11y, loading/error states, responsive) + live run-through (Preview) | general-purpose (read-only) | PENDING | §5 |
| D4 | Security & API robustness (input validation, secrets, error leakage, headers, auth) | general-purpose (read-only) | PENDING | §5 |
| D5 | Data layer & reliability (warehouse, dataLoader, yahoo feed, caching, fail-closed) | general-purpose (read-only) | PENDING | §5 |

Each inspector: STRICTLY read-only (no edits/branches/commits), cites existing-tracker status per
finding, returns a severity-ranked findings report to the program owner. Owner consolidates.

---

## 4. Consolidated review — [IN PROGRESS — agents returning]

### Live UI run-through: NOT RUN LOCALLY (environment limitation)
Both `next dev` and `next start` failed to bind port 3000 within 30–240s on the Google-Drive-mounted
working path (cold FS reads too slow). Substitutes: (a) production `npm run build` PASSED (all routes
compiled), (b) D3 static UI/a11y review, (c) the app is verified LIVE in production — SESSION_STATE
records `smoke_production: PASS` + a successful Vercel deploy. A local browser pass is redundant with
real production smoke. `.claude/launch.json` (gitignored) left in place for future use.

### D2 — Algorithms & Quant Correctness (RETURNED) — 8 findings
Headline: the MULTI-INSTRUMENT `portfolioBacktest.ts` path (distinct from `engine.ts`, which is
already T+1-correct) uses looser execution semantics and is the locus of the real new risks. The
production LABEL benchmark (53.79% net) is correct & honest; concern is the §2 portfolio-sim metrics
(shown in UI).

| ID | Sev | Finding | File:line | Bucket | Tracker |
|----|-----|---------|-----------|--------|---------|
| D2-1 | HIGH | portfolioBacktest BUY entry fills at same-bar close (look-ahead; violates engine.ts T+1 FIX-C2) — biases §2 WR/return up ~0.3–0.5%/trade | portfolioBacktest.ts:344–432 | **B** (re-baselines §2) | NEW |
| D2-2 | MED | portfolioBacktest `pnlPct` is gross-of-cost while equity is net → WR/PF inflated ~3–5pp | portfolioBacktest.ts:300–523 | **B** | NEW |
| D2-6 | MED | enhanced-path ATR score is BULLISH when ATR HIGH (inverted for dip-buy); partially cancels volRegimeScore | signals.ts:553 | **B** (enhanced path, flagged OFF in prod) | NEW |
| D2-3 | MED | portfolioBacktest tx cost hardcoded `0.0011` ×4 (not executionModel SSOT) | portfolioBacktest.ts:303,416,454,491 | A | **FIXED by open PR #29** ✅ |
| D2-5 | LOW | `priceWasNearSmaRecently` compares past prices vs *today's* SMA (mild look-ahead) | signals.ts:183–187 | B | NEW |
| D2-7 | LOW | portfolioBacktest annualization hardcoded 252 → overstates annualized return when BTC in portfolio (~+1.45%/yr) | portfolioBacktest.ts:507 | A | NEW |
| D2-4 | LOW | regimeSignal docstring zone bounds (−5/−10/−20) disagree with code (0/−10/−20/−30); FIRST_DIP zone 2× wider than documented | signals.ts:219–221 vs 271/281/290 | A | NEW |
| D2-8 | INFO | findings-ledger F1.11 marked "open" but piecewiseRsiScore already implemented | signals.ts:35–41; ledger row 12 | A | stale-tracker |

D2 verified ALL indicators (RSI/ATR/EMA/MACD/Bollinger/Sharpe/Sortino/ADX/Kelly/correlation +
btc-indicators) against standard defs → ALL PASS. Confirmed many prior fixes (F1.1/1.2/1.3/2.1/2.2,
MACD off-by-one, Bollinger clamp) still hold.

### D5 — Data Layer & Reliability (RETURNED) — 10 findings
Fail-closed invariant (§5) upheld at all 3 decision points (engine/liveSignal/sector-rotation gates).
Retry+backoff+jitter correct. Primary new risks are cache + timeout + OHLC-filter gaps.

| ID | Sev | Finding | File:line | Bucket | Tracker |
|----|-----|---------|-----------|--------|---------|
| D5-3 | MED | `/api/backtest/live` cache not keyed on `specificTickers` → filtered req poisons unfiltered cache 60s (backtest/route.ts has correct pattern to copy) | app/api/backtest/live/route.ts:70–74,113 | **A** | NEW |
| D5-4 | MED | 4 Yahoo routes lack app-level timeout → can hang serverless slot (sector-rotation/ma-deviation/chart/options) | route.ts:61/37/183 + chain.ts:207 | **A** | NEW |
| D5-1 | MED | warehouse path emits UN-filtered OHLC; JSON path filters non-finite (defense-in-depth gap) | dataLoader.ts:56–63 vs 71–81 | B | NEW |
| D5-5 | MED | YahooProvider substitutes null O/H/L→close (flat candle) → distorts ATR/stops | lib/data/providers/yahoo.ts:37–40 | B | NEW |
| D5-7 | LOW | `/api/chart` filters only `close`; passes O/H/L unguarded to client | app/api/chart/[ticker]/route.ts:198–214 | A | NEW |
| D5-9 | LOW | 3 routes emit `details: null` via `?? null` (inline, not errorResponse SSOT) | chart:245/options:92/sector-rotation:97 | A | **CONTRADICTS Q-023 closure** (D4 owns) |
| D5-8 | LOW | rate limiter per-process Map (KV path opt-in via env) | lib/api/rateLimit.ts:9 | A | **CONTRADICTS Q-005 "done"** |
| D5-2 | MED | fixture integrity guard absent on main | scripts/fetchBacktestData.mjs | B | **FIXED by open PR #27** ✅ |
| D5-6 | MED | FRED RFR cache inert w/o QUANTAN_FRED_PREWARM=1 → stale 4.5% in Sharpe/Greeks | lib/quant/riskFreeRate.ts:103–110 | B | tracked Q-004/Q-052 (owner) |
| D5-10 | INFO | engine SELL exit same-bar close (T+1 asymmetry) | engine.ts:369–371 | B | **FIXED by open PR #28** ✅ |

### D3 — UI/UX & Frontend (RETURNED) — 13 findings
Platform much healthier than 25-day-old R5/R6 baseline. **CONTRADICTS Q-008** (QuantLabPanel
1684→**148 LOC**, decomposed) and **Q-019** (backtest page 934→**268 LOC**) — both closeable.
Confirmed resolved: skip-link, focus-trap hook, KLineChart SSOT, 4/7 table captions, html lang,
4 chart aria-labels. Strong Bucket-A a11y cluster remains.

| ID | Sev | Finding | File:line | Bucket | Tracker |
|----|-----|---------|-----------|--------|---------|
| D3-1 | HIGH | 3 data tables missing `scope`+`<caption>` (a11y) | DarkPoolPanel:246, AnalysisTab:56/102, ma-deviation:260 | A | partial F6.4 gap |
| D3-5 | HIGH | LlmTab API-key input no label; show/hide icon `title` not `aria-label` | quantlab/tabs/LlmTab.tsx:182–198 | A | NEW |
| D3-4 | HIGH | ma-deviation expand button missing `aria-expanded`/`aria-controls`; SortTh no aria-label | app/ma-deviation/page.tsx:326–375 | A | NEW |
| D3-3 | HIGH | ma-deviation 8-col grid no `overflow-x` wrapper → mobile clip | app/ma-deviation/page.tsx:302–328 | A | NEW |
| D3-2 | HIGH | crypto/btc/page.tsx 813 LOC god component (now largest page) | app/crypto/btc/page.tsx | A (refactor, L) | NEW |
| D3-6 | MED | 7 `text-gray-600` contrast fails (3.4:1) survived Q-035 close | OptionsChainTable:215, FlowScanner:144, SectorRotationPanel:124+, MaxPainGauge:76 | A | **CONTRADICTS Q-035 "done"** |
| D3-7 | MED | home `<section>` no aria-labelledby; BUY/SELL/HOLD filters no `aria-pressed` | app/page.tsx:288–565 | A | NEW |
| D3-10 | MED | stock/btc/sector tab + range buttons no `aria-selected`/`role=tab` | stock/[ticker]/page.tsx:375–400 (+btc,sector) | A | NEW |
| D3-8 | MED | LlmTab 20-prop drilling; no memo (co-locate useQuantLabLlm) | LlmTab.tsx:10–36 | B | NEW |
| D3-9 | MED | buildVisFromIndicatorPreset dup'd inline stock vs btc page | stock:82–96 / btc:91–96 | B | NEW |
| D3-11 | LOW | bare `.toLocaleString()` (locale-inconsistent) ×3 | SectorRotationPanel:153, SignalCard:155, DarkPoolPanel:187 | B | NEW |
| D3-13 | LOW | `key={i}` on re-sorting topSignals list → remount churn | app/page.tsx:325 | B | NEW |
| — | OPEN | SectorHeatmap still zero aria (color-only grid) — F6.2 holdout | components/SectorHeatmap.tsx | A | ALREADY-TRACKED F6.2 |

### D4 — Security & API Robustness (RETURNED) — 12 findings + clean non-findings
Cleared (no issue): hardcoded secrets, SQLi (parameterized throughout), SSRF (operator-env URLs +
normalizeTicker), path traversal (TICKER_REGEX blocks `/\..`), API-key leak in errors. Strong posture.

| ID | Sev | Finding | File:line | Bucket | Tracker |
|----|-----|---------|-----------|--------|---------|
| D4-1 | **HIGH** | `X-API-Key` header bypass: ANY non-null value satisfies auth+CSRF on trading-agents POST; no QUANTAN_API_KEY exists to validate against → unauth LLM-credit burn | app/api/trading-agents/[ticker]/route.ts:164–180 | **B** | NEW |
| D4-3 | MED | 9 routes make external calls with NO rate limit (analytics, fundamentals highest — 3 Yahoo calls/ticker, no in-proc cache) | analytics/fundamentals/btc-* routes | **B** (A for cached) | NEW (generic Q-005) |
| D4-2 | MED | raw upstream error bodies emitted in `_errors[]` (btc/metrics) unsanitized | app/api/crypto/btc/metrics/route.ts:37,51,125 | A | NEW |
| D4-6 | LOW | 6 routes still emit `details: null` via `?? null` (not errorResponse SSOT) | options:93,chart:245,sector-rotation:97,darkpool:282,briefs:216,backtest:146 | A | CONFIRMS Q-023 (open) — matches D5-9 |
| D4-9 | — | Bloomberg timing-safe compare IS implemented & correct | lib/data/bloomberg/bridgeClient.ts:17–27 | — | **CONTRADICTS Q-037 "open" → CLOSE it** ✅ |
| D4-4 | — | CSP still Report-Only (unsafe-inline/eval); enforce gated on QUANTAN_CSP_ENFORCE=1 | next.config.js:43, middleware.ts:55 | B | CONFIRMS Q-040-NEW (open, S1) |
| D4-5 | — | rate-limit per-process Map (KV path opt-in) | lib/api/rateLimit.ts:9 | B | CONFIRMS Q-005 (open, S2) — matches D5-8 |
| D4-7 | — | normalizeTicker SSOT applied 15 routes; fuzz test absent | lib/api/sanitize.ts:35–63 | B | CONFIRMS Q-015 (partial) |
| D4-8 | — | CSRF live on both POSTs (but trading-agents weakened by D4-1) | backtest:155, trading-agents:165 | — | CONFIRMS Q-036 (live) |
| D4-10/11/12 | — | auth control-char regex ✅, remotePatterns allowlist ✅, next@14.2.35 CVEs (deferred Q-057) | — | — | CONFIRMS closed/deferred |

### D1 — Architecture & Code Structure (RETURNED on re-run) — 9 findings
Boundaries well-maintained (no scripts→app/lib leak, no server-only-in-client). `console.*` is
~100% intentional — **0 debug leftovers** (drops that concern). Two real structural issues:

| ID | Sev | Finding | File:line | Bucket | Tracker |
|----|-----|---------|-----------|--------|---------|
| D1-1 | HIGH | Circular dep `engine.ts ↔ walkForward.ts` (created by P15-NEW-10 extraction; madge-confirmed) | engine.ts:629–643 ↔ walkForward.ts:19 | A | NEW (extract to core.ts) |
| ~~D1-2~~ | ~~HIGH~~ | **FALSE POSITIVE** — KLineChart calc* are already thin delegates to lib/quant/indicators.ts (PR #10/F5.1, 2026-05-06). NOT a §5 violation. D1 re-run misread. | components/KLineChart.tsx:179–231 | — | RESOLVED 2026-05-06 |
| D1-3 | MED | mockData.ts: 5/8 exports dead (~60% LOC); 3 live exports feed dark-pool MOCK data into PROD UI | lib/mockData.ts | B | NEW |
| D1-6 | MED | 11 `eslint-disable` but eslint NOT installed/run; 4 `exhaustive-deps` suppressions = unaudited stale-closure risks | app/page:175, KLineChart:637, WalkForwardPanel:39, useLiveQuotes:229 | B | NEW |
| D1-5 | MED | technicals.ts wrappers not eliminated (Q-032 "done" but 2 routes still import via it) | lib/quant/technicals.ts:28–62 | B | residual Q-032 |
| D1-4 | MED | portfolio lib 4/5 modules (var/riskParity/stressTest/diversification, ~1200 LOC) prod-orphaned | lib/portfolio/* | B | tracked Q-011/Q-028 |
| D1-7 | LOW | console.* triage: ~100% intentional, 0 leftovers | — | C | no action |
| D1-8 | LOW | KLineChart 1039 LOC cohesive but decomposable (blocked on D1-2) | components/KLineChart.tsx | C | no action |
| D1-9 | INFO | invariants §5 references `canonicalBenchmark.ts` — **absent on main** (added by PR #24); benchmarkLabel.ts is a clean adapter | reviews/invariants-baseline.md §5 | C | stale doc |

**Reconciliation:** D1-9 confirms the "research-proxy imported by production" boundary concern is
ONLY realized if PR #24 merges (canonicalBenchmark.ts doesn't exist on main) — reinforces the §2
recommendation to rework #24 before merge.

## 3b. Inspection phase: COMPLETE (D1–D5 all returned 2026-05-31)
52 findings total across 5 domains. Platform health: GREEN. No Critical. The genuinely NEW
high-severity items: D4-1 (security bypass), D2-1 (portfolio-sim look-ahead), D1-1 (circular dep),
D1-2 (KLineChart SSOT). The production LABEL benchmark (53.79% net) is verified honest.

## 5. Rectification list + triage (D2–D5 in; D1 pending)

**Top-line:** Platform is healthy and green. Highest-priority NEW items: **D4-1** (security: unauth
header bypass on trading-agents POST) and **D2-1** (quant: portfolio-sim BUY look-ahead biasing the
§2 WR). Neither affects the production LABEL benchmark (53.79% net), which D2 verified honest.

### Bucket A — safe-mechanical / cosmetic → land as scoped PRs autonomously
Grouped into 3 coherent PRs:

**PR-A1 · API reliability & error hygiene** (backend, tests must stay green):
- D5-3 — `/api/backtest/live` cache: gate read+write on `!specificTickers` (copy the correct pattern from `backtest/route.ts:135,141`). Fixes 60s cache-poisoning. (S)
- D5-4 — wrap Yahoo calls in `withRetry({timeoutMs})` on sector-rotation:61, ma-deviation:37, chart:183, options(chain.ts:207). (M)
- D5-7 — `/api/chart` candle filter: require finite O/H/L not just close (route.ts:198–214). (S)
- D4-2 — sanitize `_errors[]` in btc/metrics/route.ts:125. (S)
- D4-6 / D5-9 — 6 routes: drop `?? null`, omit `details` key when empty (options/chart/sector-rotation/darkpool/briefs/backtest). (S)

**PR-A2 · Accessibility sweep** (UI-only, snapshots may update):
- D3-1 — `scope`+`<caption>` on 3 tables (DarkPoolPanel, AnalysisTab×2, ma-deviation). (M)
- D3-5 — LlmTab API-key `aria-label` + show/hide `aria-label`. (S)
- D3-4 — ma-deviation expand button `aria-expanded`/`aria-controls`; SortTh `aria-label`. (S)
- D3-3 — ma-deviation `overflow-x-auto` wrapper (mobile). (S)
- D3-6 — 7 `text-gray-600`→`text-gray-400` contrast (OptionsChainTable/FlowScanner/SectorRotationPanel/MaxPainGauge). (S)
- D3-7 — home `<section>` aria-labelledby + filter `aria-pressed`. (S)
- D3-10 — stock/btc/sector tab+range `aria-selected`/`aria-pressed`/`role=tab`. (M)
- F6.2 — SectorHeatmap aria (color-only grid) holdout. (S)
- D3-13 — `key={signal.etf}` on topSignals list. (XS)
- D3-11 — bare `.toLocaleString()`→`formatFreshness` ×3. (S)

**PR-A3 · Docs/SSOT reconciliation** (no code behavior):
- D2-4 — fix regimeSignal docstring zone bounds to match code. (XS)
- Update `reviews/invariants-baseline.md` §4 (stale LOC) + §7: **close Q-037** (timing-safe done), **close Q-008/Q-019** (decomposed), **reopen Q-035 as partial** (7 contrast sites), note **Q-005 still per-process**, fix §5 stale `canonicalBenchmark.ts` ref (D1-9). NOTE: invariants-baseline.md is touched by open PR #28 — sequence A3 AFTER #28 merges, or keep A3 edits to non-§1c regions.
- D2-8 — mark findings-ledger F1.11 FIXED.

**PR-A4 · KLineChart SSOT (D1-2)** — route the 7 local `calc*` indicators (KLineChart.tsx:179–231)
through `lib/quant/indicators.ts`; verify chart values match before/after (should be identical or
more correct). Clean (no open-PR collision). (M) — dispatch after A1/A2 land.

**Blocked-on-merge (Bucket A but defer):**
- D1-1 circular dep fix touches `engine.ts` (in open PR #28) → do AFTER #28 merges (extract `backtestInstrument` to `lib/backtest/core.ts`).

### Bucket B — needs-decision (signal math / WR / metric / security / large refactor) → ADVISOR CHECKPOINT before any edit
- **D4-1 (HIGH security)** — X-API-Key bypass on trading-agents POST. Decision: provision `QUANTAN_API_KEY` + `timingSafeEqual`, OR remove the bypass (require session). Owner/security decision.
- **D2-1 (HIGH quant)** — portfolioBacktest BUY fills at same-bar close (look-ahead). Fix → re-baselines §2 portfolio WR. Needs C1+C2 per invariants freeze.
- **D2-2 (MED)** — portfolioBacktest gross-of-cost pnlPct → WR/PF inflated. Re-baselines §2.
- **D2-6 (MED)** — enhanced-path ATR score inverted for dip-buy (flagged OFF in prod). Re-run benchmark to measure.
- **D2-5 (LOW)** — priceWasNearSmaRecently uses today's SMA (mild look-ahead). Methodology decision.
- **D2-7 (LOW)** — portfolioBacktest annualization hardcoded 252 (crypto). Changes §2 reported metric → B.
- **D5-1 (MED)** — warehouse path emits unfiltered OHLC (changes data feeding signal). 
- **D5-5 (MED)** — YahooProvider null→close substitution distorts ATR. Substitute-vs-filter policy.
- **D4-3 (MED security)** — rate-limit gaps on analytics/fundamentals. Posture decision.
- **D3-2 / D3-8 / D3-9 (refactors)** — btc/page decomposition; LlmTab hook co-location; buildVisFromIndicatorPreset extraction. Larger, low-risk but cross-file — schedule deliberately.
- **D1-3 (MED)** — mockData.ts: 5 dead exports (prune = A) BUT dark-pool MOCK data feeding production UI = decision (gate behind flag / replace with real data).
- **D1-6 (MED)** — eslint absent: decide install `eslint-config-next` + `lint` script vs delete the 11 disables; either way AUDIT the 4 `exhaustive-deps` suppressions for real stale-closure bugs.
- **D1-5 (MED)** — eliminate technicals.ts wrappers (migrate 2 route importers to indicators.ts). Low-risk refactor.
- **D1-4 (MED)** — portfolio lib orphaned (tracked Q-011/Q-028 dashboard). No action until Q-028.

### Bucket C — already-tracked / fixed-by-open-PR / owner-action (reconcile only, no new work)
- **Fixed by open PRs:** D2-3→#29 · D5-2→#27 · D5-10/engine SELL→#28. (Merge per §2 order.)
- **Owner-action (env/infra):** Q-004/Q-052 FRED prewarm · Q-040 CSP enforce flip · Q-057 next upgrade.
- **Tracker corrections (fold into PR-A3):** close Q-037/Q-008/Q-019; reopen Q-035 (partial); Q-005 still open.

## 6. Dispatch log

**Inspection (read-only, all returned):** D1 architecture (re-run after 1st hit session limit), D2
algorithms, D3 UI/UX, D4 security, D5 data — 52 findings total, recorded in §4.

**Rectification agents (Bucket-A, worktree-isolated, supervised; guardrail = tsc+vitest green or
report, never push main, never merge):**
| Agent | Scope | Branch | Files (collision-checked) | Status |
|-------|-------|--------|---------------------------|--------|
| PR-A1 | API reliability (D5-3 cache, D5-4 timeouts, D5-7 chart filter, D4-2 sanitize) | fix/api-reliability-hygiene | api/backtest/live, sector-rotation, ma-deviation(route), chart, options/chain, btc/metrics | DISPATCHED |
| PR-A2 | a11y sweep (D3-1/3/4/5/6/7/10/11/13, F6.2) — SKIPS OptionsChainTable (in #29) | fix/a11y-sweep | DarkPoolPanel, AnalysisTab, ma-deviation(page), LlmTab, FlowScanner, SectorRotationPanel, MaxPainGauge, app/page, stock/btc/sector pages, backtest/SectorHeatmap, SignalCard | **DONE → PR #32** ✅ tsc clean, 979 pass/17 skip, no snapshot changes |
| PR-A4 | KLineChart indicator SSOT (D1-2) — numeric-equality gated | fix/kline-indicator-ssot | components/KLineChart.tsx | **NO-OP ✅** — D1-2 is a FALSE POSITIVE: the 7 calc* are ALREADY thin delegates to lib/quant/indicators.ts (PR #10 / commit 7340323 / F5.1, 2026-05-06). Agent verified + correctly refused to fabricate a PR. D3 was right ("F5.1 RESOLVED"); D1 re-run misread delegation as reimplementation. |

**Held / sequenced:**
- PR-A3 (docs/SSOT reconcile) — partial collision with #28 (invariants-baseline.md); do after #28 merges.
- D1-1 circular dep — touches engine.ts (in #28); after #28.
- **Bucket-B (D4-1 security, D2-1/2/5/6/7 quant, D5-1/5 data, D1-3/5/6 structure)** — ADVISOR
  CHECKPOINT required before any dispatch (task #21). NOT started.

## 6b. NEXT ACTIONS (for continuation / token recovery)
1. Await PR-A1/A2/A4 completions → review each agent's report + PR; if an agent stopped red, triage.
2. Advisor checkpoint → then dispatch Bucket-B (security D4-1 first; quant D2-1 needs C1+C2 re-baseline).
3. Surface to OWNER: 7-PR merge order (§2), PR #24 rework, the 3 new Bucket-A PRs, tracker
   corrections (close Q-008/Q-019/Q-037; reopen Q-035; Q-005 open). Merges = deploys = owner-only.

## 7. Cycle log

- **2026-05-30 cycle 1:** Landed PR #30 (.db untrack). Captured baseline health (all green) +
  structural metrics. Wrote this tracker. Next: fan out D1–D5 read-only inspectors.
