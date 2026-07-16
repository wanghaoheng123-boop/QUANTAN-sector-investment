# Program Day — 2026-07-13 (Mon) — weekly §7 sweep (first under the D1 gate + D2/D4 exits)

## Pre-sweep: PR #105 merged
D1 + D2/D4 ship (opened Sat) had all 7 checks green → merged to main (3510b73), main CI green,
Vercel production deployed. Branch cleaned up; root checkout synced.

## Gates (post-#105 main)
- tsc CLEAN · targeted pure-node vitest **738/738** (backtest/quant/optimize/lib/api) ·
  pytest sidecar **131p/1s** · verify:integrity 56 files / 70,796 rows / 0 hard failures.
- **Benchmark (first Monday under the D1 gate):** net 56.33 / gross 57.35, base 54.02,
  **edge +2.31pp ≥ +1.81 floor → PASS**; significance WARN prints as designed
  (Wilson-lower 49.76 < base — expected until effective-n grows).
- **WF OOS (first sweep use of `benchmark:oos:wf`):** pooled OOS edge **+2.66pp → PASS**;
  per-fold +9.7/+9.3/−3.1/−3.2/+6.8pp (2024–25 negative-edge picture unchanged).
- **PROD LIVE-VERIFIED:** /api/analytics/AAPL + /api/sector-rotation 200 (curl; local undici
  quirk still makes verify:btc time out locally — CI ran it green, authoritative).
  **/api/backtest now serves the D2/D4 engine: winRate 54.28%, 339 trades, avgReturn 1.23% —
  byte-matches the fixture measurement. The ship is live and correct.**
- Data refresh note: the Saturday cron (23:00 UTC) had not fired yet at sweep time (UTC still
  Sat evening) — fixtures are the 07-05 set; F1.5 dividends activate when it lands tonight.

## Stryker — first complete per-domain scores + the 6h limit strikes again
The 07-12 scheduled run (first sharded, post-#101):
| Shard | Outcome | Score |
|---|---|---|
| backtest | **completed** (52m) | **31.22** — real coverage gap (exitRules.ts alone 79.33; gap = core/portfolioBacktest/walkForward) → **Q-075 (P1)** |
| options | **completed** (1m) | **62.25** |
| quant | **6h-cancelled at 97% tested** (4,124/4,154; 1,324 survived + 38 TO) | interim ≈68 |
Shard "failures" on backtest/options are the sub-70 break threshold working as designed
(advisory continue-on-error). **Fix shipped this sweep:** quant split into `quant-indicators` +
`quant-rest` (each well inside 6h) — next Sunday's schedule validates; a dispatch is optional.

## Portfolio optimizer grid — stale post-D2/D4
`portfolio:backtest` (deferred since 07-06): ALL grid members are retired-stop-family variants
and ALL score negative Sharpe (best −0.825, "default"−legacy −1.002) — corroborates the D2
decision; the shipped label-matched default measures +8.52% / maxDD 9.88% on the same data.
Grid refresh filed as **Q-076 (P2, D6-adjacent)**.

## Axe
No new run since 07-09 (reviewed 07-10; NEW-C-5 contrast ×34 design-gated + NEW-C-6 standing).
Weekly Monday schedule fires later today — review at next touch.

## Session 2 — owner: "proceed" on scheduled-task + D6 + D7
1. **Scheduled task**: 07-12 run left NO trace again (3rd occurrence). I cannot click Run-now
   from a session — but the task is now updated with (a) a FIRST-ACTION HEARTBEAT write to
   `workspace/coordination/daily/RUN-HEARTBEAT.log` (distinguishes "never started" from
   "stalled mid-run"), (b) an approval-free FALLBACK for the runtime-errors sweep (gh + curl),
   (c) refreshed post-rethink facts (D1 gate, D2/D4 exits, benchmark:oos:wf, Stryker shards,
   current backlog), (d) completion notifications to this session. Next fire ~09:07 local —
   the heartbeat will finally localize the failure. **Owner one-click still the clean fix.**
2. **D6 EXPERIMENT — REJECTED as specified, with the program's best lead.**
   `npm run experiment:calibrated-score` (129k samples, 47k OOS, D5 purge/embargo folds):
   calibration FAILS (Brier −1.2% vs base; recency-isotonic recal WORSE pooled −2.2% — base-rate
   regime shift is binding) → **real-Kelly sizing stays blocked**. Discrimination PASSES:
   **top-decile non-overlap WR 60.71%, Wilson95 [56.12, 65.13] — first honest CI lower bound
   above the base rate (54.71%)**; positive edge all 4 OOS years incl. 2024–25; only 17.8%
   overlap with SSOT BUYs. → **Q-077 (P1)**: score-RANKED selection + label-matched exits as
   the v2 entry-rule candidate (ranking needs no calibration).
3. **D7 memo shipped**: `reviews/RETHINK-2026-07-11/D7-POINT-IN-TIME-UNIVERSE.md`. First-order
   survivorship already neutralized by D1 reporting; second-order (edge on delisted losers)
   needs delisted-inclusive data → recommend Sharadar ≈$49/mo for ONE month + PIT re-benchmark
   on the D5 harness. **Subscribing = owner decision.**

## Owner attention
- Scheduled-task one-click (Run now + approve Vercel tools) still the clean fix; heartbeat
  diagnostic now armed, completion notification subscribed.
- **Decisions now open: D7 data purchase (≈$49 one month, cancellable)**; Q-077 is the next
  experiment (agent-runnable, no gate). CSP flip / Q09-1 / npm audit unchanged.

## Verify (A–F)
A tests 738/738 targeted + CI · B tsc PASS · C benchmark PASS (D1 gate) + WF OOS PASS ·
D data integrity PASS (refresh pending tonight) · E prod live-verified (incl. new engine) ·
F records this file + SESSION_STATE + MEMORY_LOG + backlog Q-075/Q-076 + stryker re-shard.
