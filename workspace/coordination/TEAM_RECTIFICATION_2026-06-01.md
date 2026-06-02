# QUANTAN — Parallel Team Rectification (Coordination SSOT) — 2026-06-01

**Coordinator:** Claude Code (Opus 4.8), inspector-lead.
**Builds on (do NOT re-run):** `workspace/INSPECTION_PROGRAM_2026-05-30.md` — the D1–D5 inspection
(52 findings, severity-ranked, A/B/C bucketed). Also PR #33. This file coordinates a parallel
*full-stack developer team* (sub-agents) executing the rectification.

**Baseline:** `main` @ `8d56955` — unchanged since the inspection, so the 52 findings are CURRENT.
tsc clean · vitest 979 pass / 17 skip · build PASS · benchmark 53.79% net (frozen §1b).

---

## Guardrails (every agent obeys — non-negotiable)

1. **NO merges to `main`. No push to `main`. Never force-push.** Merges = production deploys = OWNER-ONLY.
2. **Work in your OWN worktree/branch.** Read-only agents make zero edits.
3. **Bucket A** (safe-mechanical / cosmetic / additive) → may land as a scoped branch autonomously.
   **Bucket B** (signal math / WR re-baseline / security-sensitive / large refactor) → **NO autonomous
   merge.** Editing agents may produce a reviewable *draft* branch but must NOT push/PR; the coordinator
   runs an advisor checkpoint before greenlighting Bucket-B.
4. **Verify before declaring green** (path contains `@`, which breaks npm-script ESM resolution):
   from your worktree root —
   `ln -s "/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment/node_modules" node_modules`
   then `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/vitest/dist/cli.js run`.
5. **No secrets** in code or logs. Env vars only.
6. **Dedup:** cite existing-tracker status per item (already triaged in the inspection doc).
7. **Report** to `workspace/coordination/reports/<WS-id>.md`. Commit your branch BEFORE writing the report.

---

## OFF-LIMITS files (in-flight on open PRs — READ only, never edit; editing → merge conflicts)

| Open PR | Branch | Files locked |
|---|---|---|
| #28 | fix/exit-fill-next-open-symmetry | `lib/backtest/engine.ts`, `reviews/invariants-baseline.md` |
| #29 | refactor/exec-cost-ssot-fmtpct | `lib/backtest/executionModel.ts`, `lib/backtest/portfolioBacktest.ts`, `components/options/OptionsChainTable.tsx`, quantlab formatters |
| #31 | fix/api-reliability-hygiene | `app/api/backtest/live/route.ts`, `app/api/chart/[ticker]/route.ts`, `app/api/crypto/btc/metrics/route.ts`, `app/api/ma-deviation/route.ts`, `app/api/sector-rotation/route.ts`, `lib/options/chain.ts` |
| #32 | fix/a11y-sweep | `app/crypto/btc/page.tsx`, `app/ma-deviation/page.tsx`, `app/page.tsx`, `app/sector/[slug]/page.tsx`, `app/stock/[ticker]/page.tsx`, `components/DarkPoolPanel.tsx`, `components/SectorRotationPanel.tsx`, `components/SignalCard.tsx`, `components/backtest/AnalysisTab.tsx`, `components/backtest/SectorHeatmap.tsx`, `components/options/FlowScanner.tsx`, `components/options/MaxPainGauge.tsx`, `components/stock/quantlab/tabs/LlmTab.tsx` |
| #24/#26 | (deps) | `package.json`, `lib/optimize/canonicalBenchmark.ts`, `scripts/optimize-batch.ts`, `components/backtest/BacktestMetricsGrid*` |
| #25/#27/#30 | (isolated) | `.github/workflows/nightly-backtest.yml`, `scripts/fetchBacktestData.mjs`, `*.db` |

**Already covered, do NOT redo:** PR-A1 (API reliability → #31), PR-A2 (a11y → #32),
PR-A4 (KLineChart SSOT → FALSE POSITIVE, no-op). DarkPoolPanel `fetchedAt` D3-11 residual already
fixed on `fix/darkpool-fetchedat-freshness` (commit `6b371d1`, stacks on #32).

---

## Workstream assignments (parallel)

| WS | Role | Bucket | Mode | Findings | Branch |
|----|------|--------|------|----------|--------|
| **WS1** | Backend / API security | B (HIGH) | draft branch (no push/PR) | D4-1 (X-API-Key bypass), D4-3 (rate-limit gaps), D4-2 residual | `fix/ws1-api-security` |
| **WS2** | Quant / algorithms | B | **READ-ONLY spec** | D2-1, D2-2, D2-6, D2-5, D2-7 | n/a |
| **WS3** | Architecture / SSOT | A (1 safe edit) + specs | branch + spec | **D1-3 SAFE prune** (do it); D1-5 / D1-1 / D1-6 (spec only — blocked) | `fix/ws3-structure-safe` |
| **WS4** | Frontend / refactor | A (collides #32) | **READ-ONLY blueprint** | D3-2, D3-8, D3-9 | n/a |
| **WS5** | Docs / tracker reconcile | A | branch (safe) | tracker truth + D2-4 docstring + F1.11 | `fix/ws5-tracker-reconcile` |

### Collision-verified scopes (coordinator pre-checked 2026-06-01 — CORRECTED)

- **WS3 / D1-3 (SAFE — DO IT):** `lib/mockData.ts` has **5 DEAD exports** (zero real importers
  repo-wide), safe to delete because the edit touches ONLY `mockData.ts` (not in any open PR):
  `generateCandles`, `generateQuote`, `generateSignals`, `generateSparkline`, `BRIEFS`. (Matches the
  inspection's "5/8 dead." NOTE: a repo grep for `generateSignals` also hits an unrelated
  same-named function in `lib/quant/btc-indicators.ts:222` — that is NOT a mockData import; verified.)
  **KEEP** the 3 LIVE exports: `generateDarkPoolPrints` (→app/sector/[slug]/page.tsx,
  app/stock/[ticker]/page.tsx), `generateDarkPoolMarkers` (→app/api/chart/[ticker]/route.ts),
  `getNewsForSector` (→app/stock/[ticker]/page.tsx). Those importers are OFF-LIMITS (#31/#32) but
  deleting DEAD exports leaves the live ones untouched, so no off-limits file is edited. Also remove
  any private helpers orphaned by the deletions; tsc must stay green. The "mock-data-feeds-prod-UI"
  concern (the 3 live ones) is **Bucket B → document, don't fix.**
- **WS3 / D1-5 (BLOCKED → SPEC ONLY):** eliminating the `lib/quant/technicals.ts` wrapper is NOT safe
  now — its importers include `lib/backtest/engine.ts` (OFF-LIMITS #28) and
  `app/api/ma-deviation/route.ts` (OFF-LIMITS #31), plus editable
  `app/api/analytics/[ticker]/route.ts`, `lib/backtest/liveSignal.ts`, `lib/backtest/dataLoader.ts`,
  `components/crypto/BtcQuantLab.tsx`. Migrating all importers requires touching off-limits files →
  **defer; spec the migration to run AFTER #28 + #31 merge.**
- **WS5 / signals.ts docstring (SAFE):** `lib/backtest/signals.ts` is NOT in any open PR. WS5 edits
  ONLY the `regimeSignal` docstring comment (D2-4). WS2 reads signals.ts (read-only). No collision.
- **WS1 (SAFE to draft):** `app/api/trading-agents/[ticker]/route.ts`, `lib/api/rateLimit.ts`,
  `app/api/analytics/[ticker]/route.ts`, `app/api/fundamentals/[ticker]/route.ts` — none in any open PR.

---

## Status board (coordinator updates as agents return)

Dispatched 2026-06-01 (all background, parallel). Agent IDs (for SendMessage continuation):

| WS | Status | Branch | Verify | Report |
|----|--------|--------|--------|--------|
| WS1 | ✅ FIXED + owner decision implemented (provision QUANTAN_API_KEY → env-var documented) | fix/ws1-api-security-fixed @ 01b3267 (supersedes 32506bd) | tsc clean · 992/17/0 | WS1_FIX_PLAN_2026-06-01.md |
| WS2 | ✅ DONE | n/a (read-only) | n/a | reports/WS2.md |
| WS3 | ✅ RECOVERED by coordinator inline | fix/ws3-structure-safe @ d4e409e | tsc clean · 979/17 | (in CONSOLIDATION) |
| WS4 | ✅ DONE | n/a (read-only) | n/a | reports/WS4.md |
| WS5 | ✅ DONE — docstring (9834ed5) + tracker reconciliation (1f6e01c) | fix/ws5-tracker-reconcile @ 1f6e01c | tsc clean · 979/17 · JSON valid | reports/WS5.md |

**The 5 sub-agents were all cut off by a shared session limit. WS2/WS4 specs survived; WS1 landed a
partial/broken draft; WS3 + WS5 lost everything. After the limit reset, the coordinator RECOVERED the
two lost SAFE streams inline (mockData dead-code prune + regimeSignal docstring) — both committed,
tsc-clean, 979/17. WS1 still needs its route wiring finished (Bucket B, owner decision). Full verified
status + resume plan: `workspace/coordination/CONSOLIDATION_2026-06-01.md`.**

## Coordinator next actions
1. Agents run in background (parallel). As each returns: update board, dedup, collect branch + report.
2. Advisor checkpoint before greenlighting Bucket-B code (WS1 draft, WS2 spec).
3. Assemble master plan `workspace/TEAM_RECTIFICATION_PLAN_2026-06-01.md` (roles, sequencing, deps,
   acceptance criteria, owner-only callouts).
4. Surface to owner: full PR merge order (inspection §2) + new branches + tracker corrections.
   Merges = deploys = owner-only.
