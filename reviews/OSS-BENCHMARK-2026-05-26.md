# OSS Benchmark — High-star quant projects (2026-05-26)

**Purpose:** Compare QUANTAN patterns to popular GitHub repos; adopt/defer/reject with backlog links.  
**Scope:** Public repos with large star counts; read-only research — no code copy without license review.

---

## Summary table

| Project | Stars (approx.) | License | QUANTAN advantage | QUANTAN gap | Decision |
|---------|-----------------|---------|-------------------|-------------|----------|
| [OpenBB-finance/OpenBB](https://github.com/OpenBB-finance/OpenBB) | 30k+ | AGPL-3.0 | Integrated desk UI + sector signals + Vercel deploy | Provider breadth, terminal UX | **Adopt patterns** — provider interface ideas for `lib/data/dispatcher.ts` |
| [mementum/backtrader](https://github.com/mementum/backtrader) | 14k+ | GPL-3.0 | Modern Next.js stack, options/GEX, regime gates | Event-driven clarity, broker adapters | **Defer** — GPL; learn API shape only |
| [polakowo/vectorbt](https://github.com/polakowo/vectorbt) | 10k+ | Apache-2.0 | Simpler deploy, Yahoo-first, sector profiles | Vectorized WFA, parameter sweeps | **Adopt patterns** — WFA windowing, grid search ergonomics |
| [QuantConnect/Lean](https://github.com/QuantConnect/Lean) | 12k+ | Apache-2.0 | Lighter weight, retail-accessible | Multi-asset brokerage, algo structure | **Defer** — scope; stress-test ideas for portfolio sim |
| [stefan-jansen/zipline-reloaded](https://github.com/stefan-jansen/zipline-reloaded) | 2k+ | Apache-2.0 | Active App Router UX | Corporate actions pipeline | **Adopt patterns** — data bundle / calendar discipline in loader |
| [hudson-and-thames/mlfinlab](https://github.com/hudson-and-thames/mlfinlab) | 4k+ | BSD-3 | Own signal engine + benchmarks | Purged CV, meta-labeling | **Adopt patterns** — enhanced signal validation (Q-009), no import |
| [ranaroussi/yfinance](https://github.com/ranaroussi/yfinance) | 13k+ | Apache-2.0 | Uses `yahoo-finance2` (typed, maintained) | Community examples volume | **Reject duplicate** — stay on yahoo-finance2 |
| [microsoft/qlib](https://github.com/microsoft/qlib) | 15k+ | MIT | Faster path to production desk | Full ML pipeline | **Defer** — optional ML sidecar already stubbed |

---

## Per-repo notes

### OpenBB

- **Learn:** Provider plugin registry, credential handling, command surface.
- **Apply:** Extend [`lib/data/providers/index.ts`](lib/data/providers/index.ts) factory docs; optional Q-048 Polygon primary stays gated on owner sign-off.
- **Risk:** AGPL — do not embed OpenBB code; pattern-only.

### vectorbt

- **Learn:** Partitioned backtest, broadcasting signals over OHLC matrices.
- **Apply:** Document WFA approach in [`lib/backtest/walkForward.ts`](lib/backtest/walkForward.ts); Phase 8 grid already exists — align reporting with OOS metrics.
- **Risk:** Heavy numpy/pandas — incompatible with Vercel serverless default bundle.

### Lean / Zipline

- **Learn:** Explicit algorithm lifecycle, slippage/fees hooks.
- **Apply:** Backlog item for commission/slippage flags in `engine.ts` (future Q-*).
- **Risk:** Operational complexity — defer full port.

### mlfinlab

- **Learn:** Combinatorial purged cross-validation, deflated Sharpe.
- **Apply:** Gate enhanced signals until WR ≥ 56.35%; add research note to `reviews/optimization-loop1.md`.
- **Risk:** Overfitting if promoted without OOS discipline.

---

## Sibling product (not OSS)

**antigravity-sectors** — legacy production URL in README/smoke/briefs. QUANTAN production is **quantan.vercel.app**. Consolidate URLs (Q-065-NEW).

---

## Backlog actions filed

| ID | Title | Priority |
|----|-------|----------|
| Q-065-NEW | Replace antigravity hardcoded URLs with env `NEXT_PUBLIC_APP_URL` | P2 |
| Q-066-NEW | Document OSS adoption matrix in AGENT_BOOT yearly refresh | P3 |

---

## Quarterly refresh

Re-run star counts and license check; update this file append-only section `## Amendment YYYY-MM-DD`.
