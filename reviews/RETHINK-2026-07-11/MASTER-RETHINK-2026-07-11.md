# MASTER RETHINK — 2026-07-11 (owner-directed "new team to challenge and rethink")

**Structure:** two independent red-team agents (Medallion research + quant methodology challenge) + coordinator (code/data challenge, source-verification of every elevated claim, synthesis). Companion documents in this directory: `MEDALLION-RESEARCH.md`, `QUANT-REDTEAM-REPORT.md`, experiment scripts (`redteam*.ts.txt`).

## §1 Re-baseline (all green before the challenge)
tsc CLEAN · pytest 131p/1s · vitest (pure-node) 1,004p/17s · benchmark deterministic (56.33/57.35) · OOS 6.49pp · fixtures 56×~1,254 rows fresh 07-05 · live quotes flowing · runtime errors 0 (24h) · Stryker interim score ≈72% (run now sharded ×3).

## §2 Coordinator verification of elevated red-team claims
| Claim | Verification | Verdict |
|---|---|---|
| C1 base rate 54.02% | Computed INDEPENDENTLY by coordinator before the agent reported (identical to 2dp) | **RATIFIED — convergent** |
| C2 non-overlap 351 / 54.99% / Wilson [49.76, 60.11] | Reproduced inside the SSOT benchmark itself (wave-2 code) | **RATIFIED — reproduced** |
| C4 per-year edge +9.7/+8.5/−3.3/−3.2/+5.5 | Reproduced inside the SSOT benchmark (wave-2 code) | **RATIFIED — reproduced** |
| C5 zones decorative + flat Kelly 0.15 | Source-read: all four dip-zone BUYs gate on identical `canBuyDip`; regime-only path `kellyFrac = 0.15` for every BUY (signals.ts) | **RATIFIED — source-verified** |
| C3 ablation table (E1–E5) | Method sound (agent reproduced SSOT bar-for-bar first); trade-count discrepancy vs the 07-06 coordinator snapshot (250 vs 52) RECONCILED same-day follow-through: 250 = committed per-instrument engine, reproduced exactly; 52 = unrecorded scratch harness, superseded — see `TRADE-COUNT-RECONCILIATION.md` | **RATIFIED** (flag closed 2026-07-11) |
| C6 SELL bars +2.67%/60.1% forward | Recomputed directly on the SSOT (follow-through session, `npm run experiment:sell-check`): n=7,280, net WR 60.12%, avg +2.67% — matches to the digit; SELL bars beat the base rate in EVERY year (+7.3/+14.7/+2.5/+6.9/+4.9pp), including 2024–25 | **CONFIRMED** (2026-07-11) |
| C7 H=40 dominance | Single-pass sensitivity, no holdout; treat as hypothesis for R2's experiment, not a conclusion | **HYPOTHESIS** |
| Data integrity (coordinator) | 70,796 rows: 0 dup/0 gaps/0 zero-vol; 1 partial-final-bar defect (fixed at fetch); NFLX 2022-04-20 genuine | **DONE — gate shipped** |

## §3 What shipped TODAY (waves 1–2, PR #101 + #102)
1. **Base-rate honesty**: every benchmark run computes the always-buy base rate (54.02%) + `edgeOverBaseRatePp` (+2.31pp).
2. **Effective-n honesty**: non-overlapping WR + Wilson 95% CI (351 trades, 54.99% [49.76, 60.11]).
3. **Decay visibility**: per-year edge-over-base table (exposes the 2024–25 negative-edge years the pooled number hid).
4. **Data-integrity gate** (`verify:integrity` in `verify:data`/CI) + **partial-final-bar clamp** in the fetch pipeline.
5. **Stryker sharded ×3** (the 6h-limit fix; first per-domain scores next Sunday).
6. **Medallion research** committed with confidence-rated sourcing (what transfers: process, not alpha).

## §4 Owner decision menu (published-number / strategy changes — NOT auto-shipped)
| # | Decision | Evidence | Recommendation |
|---|---|---|---|
| D1 | **Re-found the headline metric** around edge-over-base + non-overlap CI (retire raw-WR-vs-floor as the lead number; floor 53.29 currently sits BELOW the 54.02% base rate) | C1/C2 ratified | **Yes** — reporting shipped; flip the UI headline + CI gate to "CI lower bound ≥ base rate" |
| D2 | **R1: remove ATR stops from dip entries** (time/regime-repair exits) | E1 vs E3 ablation | Run the acceptance experiment on frozen data, then ship if it holds (changes engine numbers) |
| D3 | **R2: K-slot rotation engine at H=40** (+71.0% vs B&H +93.8%, maxDD 13.8% vs 18.4% in prototype) | Prototype, single pass | Build as EXPERIMENT with walk-forward yearly validation + locked holdout (Q-068) before any display |
| D4 | **R4: retire/invert the falling-knife SELL** | C6 credible | Bundle with D2's experiment |
| D5 | **OOS redesign**: all 56 instruments, yearly walk-forward folds, purge+embargo (interim to Q-064 CPCV) | C8 code-fact | **Yes** — research-infra change, no published number; queue next |
| D6 | **R3: calibrated continuous score replacing zones/confidences** (real Kelly inputs) | C5 ratified | After D5 exists (needs honest validation harness first) |
| D7 | Point-in-time universe membership (kill survivorship at the root) vs documented haircut | Medallion rec #1 | Investigate data cost; disclosure already live |

## §5 The honest position (for the owner, plainly)
The platform's **engineering is sound** — the red team reproduced the SSOT to the bar and found zero look-ahead. The **strategy's selection edge is real but small** (+2.31pp over always-buy, per-dollar-day expectancy 0.085% vs 0.053%), **not yet statistically significant** at honest sample sizes, **concentrated in 2022–23**, and the current engine wrapper (stops+sparsity+flat sizing) reduces even that to ~nothing tradeable. The Medallion lesson correctly applied is not "add HMMs" — it is: clean data (done), honest base rates and error bars (done today), cost realism (in progress), ensembles of small validated signals and ruthless OOS discipline (the D-menu above). The next real number to move is D3's walk-forward-validated rotation experiment — the first candidate "materially better v2" with measured evidence behind it.

## §6 Same-day follow-through (2026-07-11, post-ratification session)
1. **D5 SHIPPED** — `scripts/oos-walkforward.ts` (`npm run benchmark:oos:wf`): all 56 instruments, yearly walk-forward folds, 20d purge + 5-bar embargo, NET WR, per-fold edge-over-base + non-overlap Wilson CI. First run: pooled OOS edge **+2.66pp** (PASS informational), per-fold edge **+9.7 / +9.3 / −3.1 / −3.2 / +6.8pp** (2022–2026) — independently confirms C4's decay picture under the honest design. Supersedes the 12-instrument alphabetical 70/30 gross split for sweep purposes.
2. **D3 EXPERIMENT RUN — REJECTED.** `scripts/experiments/rotation-walkforward.ts` (`npm run experiment:rotation`): K×H×rank grid (18 configs), expanding-window selection by IS Sharpe, OOS years 2023/2024/2025 + **locked 2026H1 holdout**, fail-closed SSOT parity check (0 mismatches). The full-period reference reproduces the prototype exactly (+70.96%, maxDD 13.8%) — but under honest validation the rotation beats equal-weight B&H (Sharpe or MAR) in **1 of 4** OOS segments (only 2025; acceptance needed ≥3). Robust to selecting by MAR instead (also 1/4). Walk-forward selection also prefers **H=60**, not the H=40 that C7's single-pass crowned — C7 stays HYPOTHESIS, weakened. **The prototype's +71% was real but not walk-forward-honest; D3 as prototyped is NOT a v2 candidate.** The D-menu D3 row should be read as: experiment done, acceptance failed, do not build.
3. **C3 flag CLOSED** — 250 confirmed as the committed per-instrument engine (reproduced exactly at two commits); 52 was an unrecorded scratch figure. Bonus: the committed PORTFOLIO engine measures +6.90% total (~5y) vs B&H ≈ +94% — C3's conclusion confirmed on the real engine. See `TRADE-COUNT-RECONCILIATION.md`.
4. **C6 VERIFIED → CONFIRMED** (`npm run experiment:sell-check`): SSOT SELL bars forward 20d net WR **60.12%, avg +2.67%, n=7,280** — the red-team numbers to the digit — and the per-year table is stronger than the claim: SELL bars beat the base rate **every year** (+7.3/+14.7/+2.5/+6.9/+4.9pp), including 2024–25 when the BUY edge was negative. The falling-knife SELL is consistently anti-predictive on this universe.
5. **D2/R1 + D4/R4 acceptance experiment RUN** (`npm run experiment:stop-removal`; single-slot, T+1 open fills, anchors computed in-run: label 56.33%, committed engine 250 trades/+2.63% eq-weight, B&H +89.77%):
   - **A (time-only H=20)**: 351 trades, net WR **54.13%**, eq-weight **+8.68% = 3.3× engine**, 12.4% in-market. R1's return criterion (≥3×) **passes**; the WR criterion (within 2pp of the POOLED label) misses by 0.2pp — but per C2 the pooled label is the wrong yardstick: against the honest **non-overlap** anchor (54.99%, n=351 — note A's trade structure IS the non-overlap sample) A is within **0.86pp**. **R1 direction confirmed: removing stops takes the engine from 24.0% → 54.13% trade WR and 1.0× → 3.3× return.**
   - **B (time + regime-repair exit)**: WR 70.41% but avg/trade 0.58%, eq-weight +5.9% (2.24×) — the repair exit truncates winners (high WR, low expectancy); **rejected**.
   - **C (time + SELL exit)**: 53.28% WR, +8.42% — the SELL exit only subtracts. **R4 PASSES for A vs C** (no per-year regression; A ≥ C on WR and total): **retiring the falling-knife SELL exit costs nothing and slightly helps.**
   - Sobering context stands: even A's +8.68% is ~10× below B&H because of signal sparsity (C3 damage-rank #1) — D2 stops the engine from destroying the edge; it does not manufacture exposure. Shipping any of this into `lib/backtest` remains the owner's D2/D4 decision, now with the acceptance evidence in hand.
