# Medallion Fund Red-Team Research: Verified Principles & QUANTAN Applicability Map

**Prepared by:** Red-team RESEARCH member (agent) · **Date:** 2026-07-11 · **Coordinator-reviewed:** yes
**Scope:** Publicly verifiable knowledge of Renaissance Technologies' Medallion Fund, mapped to QUANTAN (daily-bar, 57-instrument, long-only research platform).
**Method:** Primary/reported sources only — Zuckerman's *The Man Who Solved the Market* (2019), Nick Patterson's *Talking Machines* interview, Peter Brown's Goldman Sachs *Exchanges* interview (2023), Robert Frey interviews, Bloomberg's 2016 Medallion profile, Cornell (2019), and the 2014 US Senate PSI report + 2021 IRS settlement. Confidence scale: **VERIFIED** (multiple credible sources), **CREDIBLE** (single good source), **FOLKLORE** (widely repeated, weakly sourced).

---

## §1 Verified principles

### 1.1 Many weak signals; barely-better-than-chance accuracy at enormous trade count
Robert Mercer, per Zuckerman: *"We're right 50.75 percent of the time… but we're 100 percent right 50.75 percent of the time. You can make billions that way."* The edge is a huge number of small, weakly-predictive, largely uncorrelated bets — not a few high-conviction calls. **VERIFIED.**
**Critical caveat for benchmarking:** 50.75% refers to per-trade accuracy on short-horizon, long/short, high-frequency bets where the base rate is ~50%. It is **not comparable** to a long-only 20-day-forward win rate on US large caps, where the unconditional base rate is well above 50% due to equity drift.

### 1.2 Short holding periods and deliberate capacity limits
Berlekamp-era average holds of ~1.5 days to 1.5 weeks; later Medallion held thousands of positions from minutes to weeks (Bloomberg 2016). Medallion capped near ~$10B; profits distributed annually; closed to outsiders 1993, last external investors bought out 2005. Capacity discipline — accepting a smaller fund to preserve per-dollar edge — is a core, deliberate choice. **VERIFIED** (Bloomberg, Zuckerman, Cornell 2019).

### 1.3 Data-cleaning obsession and deep-history data collection
Nick Patterson (*Talking Machines*): Renaissance had *"7 PhDs just cleaning data and organizing the databases"*; *"the data you can buy will be full of trash"*; the most important thing is *"to do the simple things right"*; their *"most important statistical tool was simple regression with one target and one independent variable."* Zuckerman reports staff hand-collecting historical prices (Fed records reaching back centuries). **VERIFIED** for the cleaning obsession (first-hand interview + book); **CREDIBLE** for the deep-history detail (book only).

### 1.4 HMM / Baum-Welch lineage — real, but historically bounded
Leonard Baum (co-inventor of Baum–Welch) was Simons' first trading partner; the IBM speech-recognition group — Peter Brown, Robert Mercer, later the Della Pietra twins — was hired 1993+. HMM-style thinking (markets as observable emissions of hidden states) shaped early currency/futures models; but Patterson explicitly says the workhorse was **simple regression done right**, not exotic models. **VERIFIED** for lineage/hires; "Medallion runs on HMMs" is **FOLKLORE** (§2).

### 1.5 One unified model, not siloed strategies
Zuckerman: Medallion runs a **single monolithic trading model** across asset classes, so every improvement compounds firm-wide. Confirmed first-hand by Brown (2023): *"We use the equities code… to trade these other instruments."* **VERIFIED** (book + CEO primary interview).

### 1.6 Transaction-cost and market-impact modeling as first-class edge
Brown (2023): *"If you don't get those details straight, the transaction costs will just eat you alive."* Zuckerman documents Laufer-era slippage/impact research as a named internal program; execution modeling is alpha, not plumbing. **VERIFIED.**

### 1.7 Kelly-flavored sizing; leverage delivered via basket options
Zuckerman describes Kelly-spirit sizing (Berlekamp worked with J. L. Kelly Jr.) with average leverage ~12.5x, up to ~20x. Leverage vehicle documented at government level: 2014 Senate PSI report (60 basket options, ~$34B pre-tax profits, up to 20:1); insiders later paid ~$7B to the IRS (CNBC 2021). **VERIFIED** for basket options/leverage (Senate + IRS); **CREDIBLE** for Kelly framing (book).

### 1.8 Mean-reversion origins, evolution toward scalable equities
The 1989 Ax→Berlekamp revamp shortened horizons and leaned on mean-reverting effects; 1990 returned ~55–56% net. Under Brown/Mercer/Laufer the growth engine became equities stat-arb — higher capacity, thousands of names, hedged books. **VERIFIED.**

### 1.9 Anti-overfitting discipline — and the honest nuance on "never override"
Documented (Zuckerman): non-intuitive signals admitted **only at small allocations** until understood; signals had to persist across time and instruments; the vast majority of candidates discarded. Simons publicly: *"The only rule is that we never override the computer."* **Nuance:** accounts conflict on August 2007 — Zuckerman reports Simons DID order deleveraging over Brown's objections; Brown's 2023 telling is a compromise. Honest lesson: model discipline is the ideal; the one famous human intervention was on **risk**, not signal, grounds. **VERIFIED** (nuance flagged).

### 1.10 Hiring scientists, single bonus pool, open internal code
Brown (2023): *"We just hire mathematicians, physicists, computer scientists with no background in finance"*; *"We pay everyone from the same pot."* Zuckerman corroborates open internal code/seminars. Frey: *"We always believed that there was a wolf at the door."* **VERIFIED** for hiring/comp; **CREDIBLE** for open-code specifics.

### 1.11 The performance record itself (context)
Cornell (2019): $100 in Medallion (1988) → ~$398.7M by 2018 (~63.3% gross CAGR, ~39% net), no losing year, negative market beta — "no adequate rational market explanation." Inputs derive from Zuckerman's appendix — reported, not audited. **VERIFIED as published record; CREDIBLE as to precision.**

---

## §2 Folklore to ignore
- **"Medallion is a hidden Markov model printing money."** Lineage real (§1.4); no source documents current methods; Patterson says simple regression was the workhorse. **FOLKLORE.**
- **"Chaos theory / string theory / quantum methods / secret AI."** No credible source. **FOLKLORE.**
- **"50.75% is a universal benchmark constant."** Horizon- and base-rate-specific colorful remark. Comparing a long-only 20-day WR to it is a category error. **FOLKLORE-as-commonly-used.**
- **"The returns are audited public data."** All numbers trace to reporting, not audited filings. Directionally solid, precision unknowable.
- **"They never intervene, ever."** Contradicted for Aug 2007. Defensible claim: no discretionary *signal* overrides.
- **"Anyone can replicate it with enough ML."** The documented moat is decades of cleaned data, execution infrastructure, cost modeling, capacity discipline, organizational compounding. RIEF's public struggles prove the edge doesn't trivially generalize even inside RenTech.

---

## §3 Applicability map for QUANTAN

**The gap, stated plainly:** Medallion = tick-level data, thousands of instruments, ~10⁵ trades/day, 20:1 leverage, in-house execution, ~300 scientists, 30+ years of proprietary cleaned data. QUANTAN = daily bars, 57 instruments (56 *current* S&P large caps + BTC), 20-day labels, no execution, research/intelligence use. **What transfers is process, not alpha.**

| # | Medallion principle | Verdict | Concrete minimal implementation | Benefit | Risk |
|---|---|---|---|---|---|
| 1 | Many weak signals, ensemble | **Partially applicable** | Extend from one dip rule to 3–5 small orthogonal signals (dip-depth, vol-compression, gap reversion, relative strength), combined by simple weighted vote; each individually floor-gated in CI | Redundancy; graceful decay | 57 instruments × daily bars = low power; cap ensemble size, demand per-signal t-stats |
| 2 | Short holding periods | **Not applicable** at this data scale | None — keep 20d; do not chase intraday without tick data | — | Cosplay risk |
| 3 | Data-cleaning obsession | **Fully applicable — highest transfer** | Data-quality gate (stale bars, split/dividend audit, outlier z-checks); **fix/quantify survivorship** (point-in-time membership or documented haircut) | Every downstream number more honest | Point-in-time data costs money; minimum: quantify + disclose |
| 4 | HMM regime modeling | **Partially applicable** | A/B a ≤3-state HMM regime gate (python sidecar) vs the 200SMA zones, refit only inside walk-forward folds | Tests learned vs heuristic regime honestly | HMMs on daily bars overfit; unstable state labels |
| 5 | Single unified model | **Applicable as SSOT discipline** | CI check that live + backtest consume identical signal/cost/label functions | Eliminates backtest/live drift | Low |
| 6 | Cost modeling as edge | **Applicable (costs), N/A (impact)** | Per-instrument costs (BTC ≠ AAPL spread); CI **cost-sensitivity sweep** (edge must survive 2–3× the 11 bps assumption) | Confidence the edge isn't a cost artifact | None material |
| 7 | Kelly sizing + leverage | **Partially applicable (sizing only)** | Fractional Kelly cap (¼–½); shrink the edge input via deflatedSharpe before sizing | Prevents backtest-Kelly blowup | Basket-option leverage out of scope (Senate/IRS cautionary tale) |
| 8 | Anti-overfitting discipline | **Fully applicable — highest value** | **Signal graduation protocol** (untouched holdout + cross-instrument consistency + parameter plateau) + **trial ledger** feeding deflated-Sharpe trial counts + OOS-gap hard gate | Attacks the main failure mode of small-universe research | Process overhead |
| 9 | "Never override the model" | **Partially applicable** | No post-peek hand-tuning; parameter changes re-enter walk-forward from scratch; documented risk interventions allowed, signal overrides never | Protects OOS integrity | Requires discipline |
| 10 | Win-rate framing | **Applicable as re-benchmark** | Report WR against the unconditional 20d base rate of the same universe/period; KPI = conditional edge over base | Stops marketing a possibly-thin edge | The honest number will look smaller — that's the point |
| 11 | Deep-history data | **Partially applicable** | Extend history as far as providers allow (≥2 full regimes incl. a bear market); document depth per instrument | Fewer OOS surprises | Old data quality traps; pairs with row 3 |
| 12 | Hiring / bonus pool / open code | **Not applicable** (org-scale) | Cultural analog: one repo, SSOT docs, CI-reproducible results | — | — |

---

## §4 Top-5 recommendations (evidence strength × applicability)
1. **Fix data honesty first: survivorship-bias remediation + data-quality gate.** Nothing else is trustworthy until this is. *(Coordinator note: data-quality gate shipped 2026-07-11 — scripts/verify-data-integrity.mjs; survivorship quantification = roadmap.)*
2. **Re-benchmark the 56.33% WR against the unconditional base rate; institute the signal-graduation protocol.** *(Coordinator note: base rate = 54.02%; edge = +2.31pp; now computed in every benchmark run. The CI floor (53.29) sits BELOW the base rate — floor re-baseline is an owner decision.)*
3. **Per-instrument costs + CI cost-sensitivity sweeps** (edge must survive 2–3× cost assumptions).
4. **Small weak-signal ensemble** (3–5 orthogonal, individually-gated; resist more at 57 instruments).
5. **Unify the signal SSOT and A/B the HMM regime gate vs the 200SMA zones** under walk-forward rules.

**Closing honesty note:** none of this makes QUANTAN Medallion-like, and it shouldn't try. What Renaissance actually proves, on the best evidence, is that *process* — clean data, simple methods done right, ruthless out-of-sample discipline, cost realism, and one source of truth — is the durable, transferable edge. That is fully within QUANTAN's reach.

**Key sources:** Zuckerman (2019) · Patterson, *Talking Machines* · Brown, Goldman Sachs *Exchanges* (2023) · Bloomberg Medallion profile (2016) · Cornell, SSRN 3504766 (2019) · US Senate PSI basket-options report (2014) · CNBC IRS settlement (2021) · Simons "never override" talk · Frey, *Hedge Fund Journal* · Berlekamp Berkeley finance page.
