# WS5 — Docs / Tracker Reconciliation — 2026-06-01

**Branch:** `fix/ws5-tracker-reconcile` @ `9834ed5` (off main `8d56955`).
**Status:** code part DONE + verified; tracker-JSON part SPEC'd (not applied — see "Why deferred").

## DONE (committed `9834ed5`, verified)
**D2-4 — `regimeSignal` docstring corrected to match code** (`lib/backtest/signals.ts` ~219–222).
The JSDoc dip-zone bounds disagreed with the implementation. Corrected comment-only:

| Zone | Docstring said (WRONG) | Code actually does (lines 271/281/290/298) |
|------|------------------------|--------------------------------------------|
| FIRST_DIP | −5 to 0% | **−10 to 0%** → BUY if slope+ & near SMA, else HOLD |
| DEEP_DIP | −10 to −5% | **−20 to −10%** → BUY if slope+ & near SMA, else SELL |
| BEAR_ALERT | −20 to −10% → HOLD | **−30 to −20%** → BUY with confirmation, else SELL (NOT hold) |
| CRASH_ZONE | <−20% | **<−30%** → BUY only slope+ & near SMA, else SELL |

Verified: tsc clean; vitest 979 pass / 17 skip (signals tests unaffected — comment-only).

## DONE — tracker-JSON reconciliations (applied 2026-06-01, committed on this branch)

Each claim was verified against live code on `main` @ `8d56955` (not just trusted from the
2026-05-30 inspection) before flipping any status. `workspace/IMPROVEMENT_BACKLOG.json` re-validated
as parseable JSON after editing.

| Item | Action | Verified evidence |
|------|--------|-------------------|
| **Q-008** | partial → **done** | `components/stock/QuantLabPanel.tsx` = **148 LOC** (≤600 criterion). `wc -l` + inspection D3. |
| **Q-019** | partial → **done** | `app/backtest/page.tsx` = **268 LOC** (<400 criterion). `wc -l` + inspection D3. |
| **Q-035** | done → **partial (reopened)** | 7 `text-gray-600/slate-600` sites still on main across 4 files (SectorRotationPanel, options/MaxPainGauge, FlowScanner, OptionsChainTable); fix in flight via PR #32 (+#29 for OptionsChainTable). `grep` + inspection D3-6. |
| **F1.11** (ledger) | open → **fixed** | `piecewiseRsiScore` implemented in `lib/backtest/signals.ts`. `grep` + inspection D2-8. |

**Already `done` — correctly NOT changed** (WS5's original spec wrongly listed these to close; reading
the file first caught it):
- **Q-037** — already `status: "done"` (completed 2026-05-24; Bloomberg timing-safe compare). No-op.
- **Q-005** — already `status: "done"` (distributed rate-limit). The per-process-Map nuance is a
  separate concern (inspection D4-5/D5-8) but the backlog item itself is correctly closed. No-op.

**OFF-LIMITS reminder:** did NOT edit `reviews/invariants-baseline.md` (in PR #28). Any §4/§5/§7
reconciliation there remains a sequenced-after-#28 follow-up.

## Cross-reference
- D3-11 DarkPoolPanel `fetchedAt` `.toLocaleString()` residual: fixed on
  `fix/darkpool-fetchedat-freshness` @ `6b371d1` (stacks on #32).
