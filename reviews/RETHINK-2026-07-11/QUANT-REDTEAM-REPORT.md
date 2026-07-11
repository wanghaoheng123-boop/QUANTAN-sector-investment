# QUANTAN Red-Team Report — Methodology Challenge (2026-07-11)

**Author:** Quant red-team agent (isolated worktree) · **Coordinator verification:** see MASTER-RETHINK doc §2.
**Validity check:** the agent independently reimplemented the regime signal and reproduced the SSOT **bar-for-bar (0 mismatches**, exact 3,435 BUYs / 56.33% net WR / all bucket stats) before challenging it. Reproduction scripts preserved as `redteam.ts.txt` / `redteam2.ts.txt` in this directory.

## §1 Ranked challenges (severity × confidence)

**C1. The headline 56.33% is ~2pp of signal on ~54pp of beta+survivorship.** [CRITICAL × HIGH — computed; coordinator-reproduced]
"BUY every instrument, every day" with the identical 20d net label/costs/warmup scores **54.02% net WR (n=58,420), avg +1.066%**. The signal: 56.33%, +1.704%. The real edge is **+2.31pp WR / +0.64pp expectancy** — not "6.33pp over a coin flip"; the coin is bent by construction (56 current mega caps, bull window). Bars above the 200SMA score only 52.8%. **The CI floor (53.29) sits BELOW the do-nothing base rate.**

**C2. Overlap inflates n ~10×; the trade-level edge is not yet statistically distinguishable from the base rate.** [CRITICAL × HIGH — computed; coordinator-reproduced in SSOT]
Non-overlapping sampling leaves **n=351**: net WR **54.99%, Wilson 95% CI [49.76, 60.11]** — the CI includes 50% and swallows the base-rate CI (53.13% [51.29, 54.96], n=2,827). PSR/DSR ≈ 1.0 are overlap artifacts (labeled optimistic, but at effective n they are uninformative).

**C3. Label-vs-engine schism — and the layer-by-layer diagnosis of what kills the engine.** [CRITICAL × HIGH — ablation]
Agent's engine re-run: 250 trades, 23.2% net trade WR, +2.63% avg per-instrument 5y return, −102pp excess vs B&H. Ablation (T+1, 11bps/side, 100% sizing):
| Config | trades | net WR | time-in-mkt | eq-wt return (B&H 89.8%) |
|---|---|---|---|---|
| E1: BUY→hold 20d, time exit only | 362 | 53.6% | 11.9% | **+7.9%** |
| E2: + ATR stop (3% floor) | 496 | 40.7% | 11.0% | +6.0% |
| E3: + trailing/BE stops | 505 | 40.2% | 11.0% | +5.4% |
| E4: engine exits (no time exit) | 254 | 23.2% | 31.0% | +20.0% |
| E5: full engine (+15% flat sizing, DD breaker) | 250 | 23.2% | — | **+2.63%** |
Damage ranking: (1) **signal sparsity** (BUY on 5.88% of instrument-days → ~12% exposure cap); (2) **the ATR stop is a design contradiction** — buy weakness, then stop 3% below, exactly where pullback noise lives (257 stop-outs averaging −4.73% vs surviving exits +6.78%); (3) **flat 15% sizing** scales the remainder by ~0.15.

**C4. The edge is non-stationary — negative for two full years.** [HIGH × HIGH — computed; coordinator-reproduced in SSOT]
Edge over base by signal year: **2022 +9.7pp · 2023 +8.5pp · 2024 −3.3pp · 2025 −3.2pp · 2026H1 +5.5pp.** The pooled 56.33% is carried by 2022–23; in 2024–25 the signal underperformed buying on random days.

**C5. The zone/confidence architecture is largely decorative.** [HIGH × HIGH — code fact; coordinator source-verified]
Every dip zone's BUY requires the identical `canBuyDip = slope>0.005 && nearSma` — the −10/−20/−30 thresholds never gate a BUY, only the label/confidence. In production the confidences (75/88/90/80/78) are unused: the regime-only path assigns **flat Kelly 0.15 to every BUY** (`signals.ts` regime-only branch — verified at source by coordinator). Ablations: dropping `nearSma` RAISES WR to 56.39% (the gate is inert); "any dip below rising SMA" ≈ the whole classifier (~+0.4pp over "any dip"). DEEP_DIP's 64.5% is ~30 effective trades of "deeper dip → bigger bull bounce".

**C6. The falling-knife SELL is anti-predictive on this universe.** [HIGH × HIGH — computed; bull-window caveat]
Bars where the SSOT emits SELL: forward 20d net WR **60.12%, avg +2.67% (n=7,280)** — better than the BUY signal. As a long-only exit it systematically sells before rebounds. The 82–95% SELL confidences are the least-supported numbers in the codebase.

**C7. The 20-day horizon is arbitrary; H=40 dominates.** [MEDIUM × HIGH — computed]
Edge over base by horizon: H=5 +1.85pp · H=10 +1.55pp · H=20 +2.31pp · **H=40 +5.79pp (avg +4.76%, per-day expectancy 0.119% vs 0.085%)**. Nobody validated 20; it is an unexamined constant.

**C8. The OOS design cannot support its conclusion.** [MEDIUM-HIGH × HIGH — code fact]
`loadTickers(12)` = first 12 files **alphabetically** (a prefix, not a sample; IS gross 68.72% vs universe 57.35% shows how unrepresentative). One 70/30 split, gross-only, no purge/embargo (label windows straddle the boundary), and the OOS period lands on 2024–26 where the edge went negative — the 6.49pp "gap" conflates regime shift with overfitting.

## §2 The metrics that should accompany/replace the headline WR
1. **Selection edge with honest error bars**: non-overlapping net WR minus base-rate WR, with Wilson CI. Today: **+1.9pp, 95% CI ≈ [−3.4, +7.1]pp** — "positive point estimate, not yet significant". Gate on the CI lower bound vs the base rate, not a raw floor below it. *(Coordinator: SHIPPED into the benchmark 2026-07-11, wave 2.)*
2. **Tradeable alpha**: implementable T+1 cost-netted portfolio return vs B&H over the identical window. Today: +7.9% vs +89.8% (single-slot), or **+71.0% vs +93.8% with maxDD 13.8% vs 18.4%** for the K=10/H=40 rotation prototype.

## §3 Redesign hypotheses, ranked (validation experiment each)
- **R1. Delete the ATR stop for dip entries; exit on time/regime repair, matching the label.** Validated in-session (E1 vs E3). Acceptance: trade WR within 2pp of label WR; ≥3× current engine return on frozen data.
- **R2. Cross-sectional K-slot rotation at H=40.** Prototyped: K=10 deepest-dip-first → **+71.0%, 202 trades, 75% exposure, maxDD 13.8%** (return/maxDD ≈ B&H with a tradeable structure). Experiment: K×H×rank-key grid, walk-forward yearly, purged; acceptance = beats B&H on Sharpe or MAR in ≥3 of 5 years.
- **R3. Replace zones/confidences with one continuous calibrated score** (logistic/GBM in the sidecar, purged CPCV), used for REAL Kelly sizing. Acceptance: calibration (Brier/reliability) + top-decile non-overlap WR beats pooled WR with CI excluding base rate.
- **R4. Retire or invert the falling-knife SELL** (positive forward returns); test deferred-entry watchlist instead. Acceptance: no per-year regression vs current exits.
- **R5. Re-found the benchmark reporting**: edge-over-base + per-year + non-overlap CI *(SHIPPED, wave 1+2)*; upgrade OOS to all 56 instruments, walk-forward yearly folds, 20d purge + 5d embargo, net WR (interim to Q-064 CPCV).

## §4 What the current design gets right
- **Execution hygiene is genuinely good**: T+1 open fills, signal-at-close, prior-bar ATR, gap-aware stop fills, fail-closed guards, symmetric net-of-cost accounting. Independent reimplementation: **zero divergences** — no look-ahead bug is hiding the problem; the strategy is honestly measured.
- **The caveats exist**: overlap disclosed, survivorship disclosed, PSR/DSR labeled optimistic, and the enhanced path was benchmarked, found worse (52.63%), and turned OFF — the decision most teams fail to make.
- **The dip-buy selection is not nothing**: per-deployed-dollar-day expectancy 0.085% vs 0.053% base; +9.7pp edge in the 2022 bear. It is small, sparse, decaying since 2024, and wrapped in an engine that annihilates it.
- **SSOT structure** made this audit possible in hours. An auditable system is a fixable system.

**Bottom line:** engineering A−; headline metric conflates ~54% ambient base rate with ~2pp of real-but-not-yet-significant selection edge; the engine then discards even that through stops, sparsity, and sizing. The honest v2 is R1+R2 (+71% vs +2.6% measured on identical data) with R5's reporting so the next 56.33% cannot happen.
