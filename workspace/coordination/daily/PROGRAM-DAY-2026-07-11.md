# Program Day — 2026-07-11 (owner: "new team to challenge and rethink" → red-team rethink + same-day follow-through)

## Session 1 — supervised red-team rethink (merged #101, #102)
Two independent red-team agents (Medallion research + quant methodology challenge) + coordinator
verification. Full synthesis: `reviews/RETHINK-2026-07-11/MASTER-RETHINK-2026-07-11.md`.

**Ratified core findings:** always-buy base rate on this universe/window = **54.02%** net WR →
headline 56.33% carries only **+2.31pp** selection edge (CI floor 53.29 sits BELOW the base
rate); effective n = **351** non-overlapping trades, WR 54.99%, Wilson95 [49.76, 60.11] — not yet
significant; per-year edge +9.7/+8.5/**−3.3/−3.2**/+5.5pp (2024–25 NEGATIVE); zones/confidences
decorative in prod (identical `canBuyDip` gate, flat Kelly 0.15); engine ablation shows
stops+sparsity+sizing crush the label edge.

**Shipped (additive, label WR byte-identical):** base-rate + edge metric, non-overlap Wilson CI,
per-year edge table (all in `npm run benchmark`), data-integrity gate (`verify:integrity`),
partial-final-bar clamp at fetch, Stryker ×3 shard. Owner decision menu **D1–D7** in MASTER §4.

## Session 2 — follow-through (owner: "continue with the tasks")
| Item | Result |
|---|---|
| **D5 OOS redesign** (ratified "queue next") | **SHIPPED** — `npm run benchmark:oos:wf` (`scripts/oos-walkforward.ts`): all 56 instruments, yearly walk-forward folds, 20d purge + 5-bar embargo, NET WR, per-fold edge-over-base + non-overlap Wilson CI. First run: pooled OOS edge **+2.66pp**, per-fold **+9.7/+9.3/−3.1/−3.2/+6.8pp** — confirms C4 decay under the honest design. Supersedes the 12-ticker alphabetical 70/30 gross split for sweep purposes (interim to Q-064 CPCV). Verdict informational until owner D1. |
| **D3/R2 rotation experiment** | **RUN — REJECTED.** `npm run experiment:rotation`: 18-config K×H×rank grid, expanding-window IS-Sharpe selection, OOS 2023/24/25 + **locked 2026H1 holdout**, fail-closed SSOT parity (0 mismatches). Full-period reference reproduces the prototype (+70.96%, maxDD 13.8%) but rotation beats B&H (Sharpe or MAR) in **1/4 OOS segments** (needed ≥3); robust to MAR selection (also 1/4). WF selection prefers H=60, weakening C7's H=40 hypothesis. **The +71% prototype was not walk-forward-honest; D3 as prototyped is NOT a v2 candidate.** |
| **C3 trade-count flag (250 vs 52)** | **CLOSED** — 250 confirmed = committed per-instrument engine summed (reproduced exactly at HEAD and pre-#91); 52 = unrecorded scratch harness, superseded. Bonus finding: committed PORTFOLIO engine = +6.90% total (~5y) vs B&H ≈ +94% — C3 confirmed on the real engine; #91 moved it −1.61% → +6.90%. See `reviews/RETHINK-2026-07-11/TRADE-COUNT-RECONCILIATION.md`. Process lesson: numbers entering records must name their harness. |

Published numbers untouched: no lib/ changes this session; benchmark not re-baselined; UI unchanged.

## Owner attention (updated)
- **D1** (re-found headline metric + gate on CI-lower-bound ≥ base rate) is now the highest-value
  open decision — D5's harness gives it a home; the current floor certifies nothing.
- **D3 is answered** (rejected as prototyped). D2/D4 (stop removal + SELL retirement) remain the
  open engine experiments; D6 (calibrated score) now has its validation harness prerequisite (D5) met.
- Standing: scheduled-task one-click (Run now + approve tools); CSP enforce flip stays owner-gated;
  Monday 07-13 sweep should review the first sharded Stryker score + use `benchmark:oos:wf`.

## Verify (A–F)
A tests: CI (jsdom CI-only on this machine; no test changes) · B typecheck: PASS local ·
C benchmark: untouched (no lib changes) · D data: fixtures 07-05, integrity gate in CI ·
E prod: no deploy-affecting changes · F records: this file + SESSION_STATE + MEMORY_LOG.
