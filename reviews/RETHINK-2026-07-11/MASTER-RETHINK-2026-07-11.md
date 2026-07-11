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
| C3 ablation table (E1–E5) | Method sound (agent reproduced SSOT bar-for-bar first); trade-count discrepancy vs the 07-06 coordinator snapshot (250 vs 52) NOT yet reconciled — flagged, does not change the conclusion (both show minimal participation + deeply sub-B&H returns) | **RATIFIED-WITH-FLAG** |
| C6 SELL bars +2.67%/60.1% forward | Plausible mechanism + bull-window caveat noted; not independently recomputed | **CREDIBLE (verify at next sweep)** |
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
