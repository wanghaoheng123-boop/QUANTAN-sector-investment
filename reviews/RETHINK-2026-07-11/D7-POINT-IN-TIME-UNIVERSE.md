# D7 — Point-in-time universe investigation (2026-07-13)

**Question (MASTER §4 D7):** kill survivorship at the root (point-in-time universe membership)
vs keep the documented haircut. **Deliverable:** options, indicative costs, recommendation.

## 0. What the bias actually is HERE
The universe is **56 instruments = ~5 current top holdings per GICS sector ETF + BTC** — i.e.
*today's winners*, held fixed across the 2021–2026 window. This is NOT S&P-500 membership bias;
it is "top-holdings-as-of-2026" bias, which is stronger (mega-cap momentum selection).

Two mitigations are ALREADY LIVE and materially blunt the problem:
1. **Base-rate-relative reporting (D1, shipped):** the headline is now *edge over the always-buy
   base rate measured on the SAME survivor universe* — survivorship inflates both sides, so the
   EDGE is survivorship-adjusted to first order. What remains unmeasured is second-order: whether
   the signal's selection quality differs on stocks that later delisted/fell out (plausible —
   dip-buying a terminal decliner is exactly the falling-knife case).
2. **User-facing disclosure** (NEW-Q-1 universe note on the backtest page).

## 1. Options

| Tier | What | Cost (indicative — verify at purchase) | Fit |
|---|---|---|---|
| **0. Status quo+** | Keep base-rate-relative metrics + disclosure; optionally add a "second-order caveat" line to the universe note | $0 | Already live; does not close the second-order gap |
| **1. Free reconstruction** | Wikipedia "List of S&P 500 companies — Selected changes" table → PIT S&P membership for 2021–26; rebuild a PIT mega-cap universe from it (still needs delisted PRICE data, which Yahoo partially lacks) | $0 + engineering | Membership is solvable; **delisted price history is the real blocker** on the current Yahoo pipeline |
| **2. Sharadar Core US Equities bundle** (Nasdaq Data Link) | Delisted-inclusive EOD prices since 1998 + market caps + sectors + S&P 500 add/remove history since 1957 — everything needed to rebuild "PIT top-5 market cap per sector incl. delisted" and re-run the D5 harness | ≈ **$49/mo** (bundle; verify current) | **Best fit** — one dataset closes both membership AND delisted prices |
| 3. Norgate Data | Survivorship-bias-free US EOD + PIT index constituency; requires **Platinum+** tier and delivery via platform plugins (AmiBroker/Python/etc.), not raw files | ≈ $40–55/mo at Platinum (verify) | Good, but plugin-based delivery fits the pipeline less cleanly than Sharadar's flat files |
| 4. EODHD + UnicornBay marketplace | EOD All-World ≈ €20/mo + Indices Historical Constituents add-on **$50/mo** (~12y S&P/DJ coverage) | ≈ $70+/mo combined | Workable; two subscriptions, constituents add-on is index-only (not sector top-holdings) |

## 2. Cost-benefit
- The **first-order** survivorship distortion is already neutralized in the headline (D1).
- The **second-order** question ("does the dip edge survive on losers?") is worth exactly one
  experiment: rebuild the universe PIT and re-run `benchmark` + `benchmark:oos:wf` on it. If the
  edge-over-base holds on a PIT universe, the strategy claim hardens substantially; if it
  collapses, that is decisive information available no other way.
- That experiment needs **~1 month of Tier-2 data (≈$49)** plus a fetch-adapter (Sharadar SEP →
  the existing fixture schema) — modest engineering on top of the existing D5 harness.

## 3. Recommendation
**Do Tier 0 now (free, this PR):** the second-order caveat is documented here and referenced
from the records. **Recommend Tier 2 (Sharadar, ≈$49/mo, cancellable) for ONE month** to run
the PIT re-benchmark experiment; keep the subscription only if the platform moves toward
publishable/commercial claims (QUANTAN_EXPERT_TEAM_COMMERCIALIZATION.md), where a
survivorship-free benchmark is table stakes. **Subscribing is an owner decision** (recurring
cost + new data-vendor dependency) — the fetch-adapter work is ~1 session once credentials
exist.

Sources: [Norgate data tables](https://norgatedata.com/data-content-tables.php) ·
[Norgate FAQ](https://norgatedata.com/data-package-faq.php) ·
[Sharadar via Nasdaq Data Link SEP](https://data.nasdaq.com/databases/SEP) ·
[Sharadar datasheet](https://resources.quandl.com/a/res-hub/Sharadar_Datasheet_final.pdf) ·
[EODHD pricing](https://eodhd.com/pricing) ·
[EODHD/UnicornBay historical constituents ($50/mo)](https://eodhd.com/marketplace/unicornbay/spglobal)
