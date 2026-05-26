# Claude Code — QUANTAN Quick Start

**Repo:** `QUANTAN-sector-investment`
**Last update:** 2026-05-23 (post PR #16 — wave 40-41 options audit)
**Canonical plan:** `reviews/PHASE-15-PLAN.md` ← **START HERE**
**Task queue:** `workspace/IMPROVEMENT_BACKLOG.json` (50 tasks; 9 done, 3 partial, 38 pending)
**Legacy plan:** `workspace/FUTURE_IMPROVEMENT_PLAN.md` (May-21 audit; superseded but kept for context)

---

## Read first (in order)

1. **`reviews/PHASE-15-PLAN.md`** — canonical Phase 15 plan with team tracks, 4 sprints, gates, risk register
2. **`workspace/IMPROVEMENT_BACKLOG.json`** — work P0 → P1 → P2 → P3; each task tagged with `phase15_sprint` slot
3. **`AGENT.md`** — boot rules, VERIFY A–F, memory logging
4. **`workspace/SESSION_STATE.json`** — active tasks and blockers
5. **`reviews/invariants-baseline.md`** — frozen floors (WR ≥ 56.35% pre-FRED; re-baselines post-S2)
6. **`reviews/findings-ledger.csv`** — 90-row finding ledger (F1.x–F8.x)

---

## Execution order

1. **Inspect** — `grep`/read every `files[]` entry for the task before editing.
2. **Implement** — smallest diff that meets `acceptance_criteria`.
3. **Verify** — run every command in `verify_commands` for that task.
4. **Log** — append VERIFY row to `workspace/MEMORY_LOG.md`.
5. **Mark done** — in backlog JSON set `"status": "done"` + `"completed_at"` + `"notes_<date>"` only after verify passes.
6. **Next task** — respect `depends_on` if present; otherwise pick the next P0 in the active sprint (S1 first).

**Default first tasks for Phase 15** (Q-039-NEW WITHDRAWN as false-positive 2026-05-23 — see HANDOFF.md):
1. **Q-029** (P2 promoted to S1) — Restrict `next/image` `remotePatterns` (currently `hostname: '**'` — confirmed SSRF amplification risk)
2. **Q-001** (P0, S1) — CI gates (test + benchmark + check:ci in `.github/workflows/ci.yml`)
3. **Q-014** (P1, S1) — Re-baseline invariants doc: tests 279→798, files 21→48
4. **Q-040-NEW** (P0, S1) — CSP enforcing (flip from Report-Only; remove `unsafe-inline`) — REQUIRES nonce middleware design; defer if not ready
5. **Q-023** (P1, S1) — sanitizeError on `lib/api/reliability.ts:50` (last F7.2 holdout)

---

## What NOT to do

| Rule | Reason |
|------|--------|
| **No `git commit` / `git push`** unless the user explicitly asks | Owner controls main |
| **No force push to `main`** | Production deploys from main |
| **Never read or edit `.env`** | Secrets policy in `AGENT.md` |
| **Never commit secrets** | Env names only in `.env.template` |
| **Do not ship enhanced signal as default** while WR < 56.35% | Current enhanced WR 52.63% (−3.72pp vs baseline) — Q-009 P0 |
| **Do not drop test count** below **798** without written approval | `npm run test` floor (was 486; raised 2026-05-23) |
| **Do not regress benchmark WR** below 56.55% (50bps tolerance) | Auto-block in CI once Q-001 wired |
| **No new `any` casts** without `// reason:` comment + reviewer ack | 5 documented sites cap |
| **No silent `.catch(() => {})`** | 0 in lib/app/components — must stay 0 |

---

## Verify commands (standard)

```bash
npm run typecheck          # after TS changes
npm run test               # after quant/signal/API changes — 798 tests must pass
npm run benchmark          # floor check — aggregate WR must stay ≥ 56.35%
npm run benchmark:enhanced # only when tuning sector gates / signals; do NOT ship as default if < 56.35%
npm run check:ci           # smoke + verify scripts (before PR-ready work)
npm run check:smoke:local  # local-only smoke for UI changes
```

Benchmark parses `scripts/benchmark-results.json` (canonical) and `scripts/benchmark-results-enhanced.json` (enhanced).

CI floor target once **Q-001** wires it: fail if WR < **55.85%**.

---

## Marking tasks done in backlog

Edit `workspace/IMPROVEMENT_BACKLOG.json` for the task object:

```json
{
  "status": "done",
  "completed_at": "2026-05-23",
  "phase15_sprint": null,
  "notes_2026_05_23": "Evidence: 798 tests pass; benchmark WR 57.05%; commit abc123"
}
```

Update `workspace/SESSION_STATE.json` → relevant task `status: "DONE"` and `verify_status` A–F.

---

## Escalation if blocked

1. Log blocker in `workspace/SESSION_STATE.json` → `blockers[]`.
2. Append HAND-OFF snippet to `workspace/MEMORY_LOG.md` with exact file, command output, and next instruction.
3. **Do not stop** on test failures — fix or document workaround and continue other independent tasks.
4. Ask the user only when:
   - Destructive git choice (commit/revert large deletes)
   - New secrets / provider accounts (e.g., POLYGON_API_KEY, FRED_API_KEY, KV_URL for Vercel KV)
   - Benchmark regression you cannot fix in-session
   - Legal opinion needed (e.g., Yahoo ToS / Polygon migration)

---

## Key paths

| Area | Path |
|------|------|
| Signal engine | `lib/backtest/signals.ts`, `lib/backtest/engine.ts` (807 LOC — needs walkForward extract) |
| Indicators SSOT | `lib/quant/indicators.ts` |
| Options | `lib/options/chain.ts`, `lib/options/greeks.ts`, `lib/options/{flow,gex,sentiment}.ts` |
| Real-time hooks | `hooks/{useLiveQuote,useLiveQuotes,useLivePrices}.ts` |
| SSE endpoint | `app/api/stream/[ticker]/route.ts` |
| Data warehouse | `lib/data/warehouse.ts`, `lib/data/mergeQuotes.ts` |
| Data providers | `lib/data/providers/{yahoo,polygon,fred,alphavantage}.ts` |
| API routes | `app/api/*/route.ts` (25 routes) |
| Stock UI | `app/stock/[ticker]/page.tsx`, `components/stock/QuantLabPanel.tsx` (1684 LOC — needs decomp) |
| Backtest UI | `app/backtest/page.tsx` (887 LOC — needs decomp) |
| Chart | `components/KLineChart.tsx` (1014 LOC — needs plugin registry) |
| CI | `.github/workflows/ci.yml` (typecheck-only — Q-001 expands it) |
| Findings | `reviews/findings-ledger.csv` (33 open / 90 total) |
| Phase 15 plan | `reviews/PHASE-15-PLAN.md` (479+ lines, canonical) |

---

## Verified snapshot (2026-05-23)

- Branch: `fix/options-investigation` (worktree); main contains wave 40-41 via PR #16 (commit `7321b54`)
- Tests: **798 passed / 48 files**
- Canonical WR: **57.05%** (above 56.35% floor)
- Enhanced WR: **52.63%** (vsBaseline −3.72pp) — **do not regress production path**
- Open findings: **33 / 90** in `reviews/findings-ledger.csv`
- Open backlog tasks: **38 / 50** in `workspace/IMPROVEMENT_BACKLOG.json`
- God components: QuantLabPanel 1684, KLineChart 1014, backtest page 887 (all over target)
- Largest lib file: engine.ts 807 (over 600 target)
- Silent catches: 0 — must stay 0
- Circular imports: 0 — must stay 0

---

## Phase 15 sprint summary

| Sprint | Theme | Days | Key items |
|---|---|---|---|
| **S1** | Security P0 + Phase 14 carry-over | ~5d | Q-039-NEW (auth regex), Q-001 (CI), Q-040-NEW (CSP), Q-029 (hostname), Q-014 (rebaseline) |
| **S2** | Quant + Data platform | ~6d | Q-004 (FRED RFR), Q-005 (Vercel KV), Q-021 (B&H dividends), Q-009 (enhanced flag), Q-041-NEW (GARCH), Q-050-NEW (crypto WS) |
| **S3** | God-component decomp + Scenarios | ~10d | Q-008 (QuantLab), Q-019 (backtest page), Q-043-NEW (scenarios), Q-045-NEW (tail risk), Q-046-NEW (portfolio Greeks) |
| **S4** | HMM + Factor + Testing depth | ~8d | Q-042-NEW (HMM), Q-044-NEW (factor), Q-047-NEW (Stryker), Q-027 (component tests), Q-020 (API integration), Q-048-NEW (Polygon) |

Full plan: `reviews/PHASE-15-PLAN.md`.

---

*Full Phase 15 detail in `reviews/PHASE-15-PLAN.md`; legacy May-21 audit context in `workspace/FUTURE_IMPROVEMENT_PLAN.md`.*
