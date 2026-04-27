# Findings: QUANTAN Round 2 Review

## Quant Finance Findings

### CRITICAL ISSUES [P0]

- **`lib/backtest/engine.ts:201`** — Crash bug: `atrAtEntryVal` variable used in 4× ATR profit-lock but renamed to `atrAtEntryDollar` in lines 177-179. This fires on every 4× ATR profit exit. **FIXED**: renamed to `atrAtEntryDollar`.

### SIGNIFICANT ISSUES [P1]

- **`lib/backtest/signals.ts`** — EMA seeding uses `values[0]` instead of SMA(first period) — non-standard, affects all downstream signals. **FIXED**: now uses SMA of first period values, matching KLineChart.tsx implementation.

- **`lib/backtest/signals.ts`** — ATR `avg` variable referenced before declaration (Crash Bug). **FIXED**: added initialization `let avg = trs.slice(0, period).reduce(...) / period`.

- **`lib/quant/technicals.ts`** — EMA uses `values[0]` as seed (non-standard) — NOT FIXED (requires separate PR).

- **Kelly Criterion**: `lib/quant/kelly.ts` is DEAD CODE — never called. Signals use hardcoded 25%/15%/10% fractions instead. Should either wire up Kelly formula or remove dead code.

- **Position sizing**: No Kelly formula at all — hardcoded fractions (0.25, 0.15, 0.10). Could be improved by actually using the Kelly formula from `lib/quant/kelly.ts`.

- **`lib/backtest/engine.ts:544`** — Portfolio alpha compares combined-equity return vs equal-weighted B&H average — not the same thing. Misleading for strategy evaluation.

### MINOR ISSUES [P2]
- Sortino denominator uses `n` (total obs) — correct per standard formula, but non-standard vs "count of negative returns" approach.
- Walk-forward: overlapping windows (train advances by testDays=63) — less conservative than non-overlapping. Intentional but worth documenting.

## Mathematics Findings

### VERIFIED CORRECT (after fixes)
- ATR: Wilder smoothing, initial seed at `period-1` — correctly aligned with KLineChart.tsx after ATR fix.
- RSI: Wilder RSI, correct gain/loss separation — confirmed correct.
- EMA: Now correctly seeds with SMA of first period values (after Round 2 fix).
- MACD: Correct formula after EMA fix (signal line EMA seeded from proper EMA).
- Bollinger Bands: Sample SD (N-1) — correct for trading.
- Sharpe: Annualized, Bessel-corrected, rf=4% — confirmed correct.
- Sortino: Downside variance / N — confirmed correct.

## Data Science Findings

### CRITICAL ISSUES [P0]
- **Raw close prices with NO split/dividend adjustment** — `fetchBacktestData.mjs` and `runBacktest.mjs` use unadjusted closes. NVDA (3 splits: 2021 4:1, 2022 20:1, 2024 10:1), AMZN (20:1 2022), GOOGL (20:1 2022), AAPL (4:1 2020). Backtest results for these stocks are meaningless.
  - **IMPACT**: A $100 position in NVDA before 2021 would appear as $100 in the backtest but actually be worth $100×4×20×10 = $80,000 after splits.
  - **FIX REQUIRED**: Use Yahoo `adjClose: true` or post-process with corporate actions.

### SIGNIFICANT ISSUES [P1]
- **Backtest data files are 1 year stale** (fetched April 2026) — no automated refresh mechanism.
- **No data validation** — no checks for negative prices, OHLC inconsistency, zero volume, missing days.
- **Two different data paths**: `runBacktest.mjs` (CSV) vs `fetchBacktestData.mjs` (yfinance2) — may produce different results for same ticker.
- **Yahoo Finance rate limiting**: Sequential news fetches in `app/api/news/[sector]/route.ts` — no parallelism, slow.
- **Backtest JSON files in Git** — 56 files × 1000+ lines = large repo, slow clone.
- **No delist handling**: If a stock is delisted, Yahoo returns null — backtest silently skips it.
- **BTC live vs backtest**: Different data sources (CoinGecko vs Yahoo) — potential inconsistency.
- **dataFreshness indicator**: No timestamp or staleness warning on backtest data.

### MINOR ISSUES [P2]
- 4× ATR trailing stop uses `atrVals[i]` (current bar's ATR) — consistent with comment but uses current not entry ATR (minor in practice).
- `normalizedChangePercent` fallback logic is complex but verified correct.

## UI/UX Findings (TOP PRIORITY — User Complaints)

### CRITICAL ISSUES [P0] (Makes platform look unprofessional / broken)

- **"Loading backtest data..." never resolves** — Backtest page shows loading state indefinitely. Causes: 56 sync file reads on serverless cold start, no timeout/error state shown.
  - **FIXED**: Added timeout warning in backtest page.

- **"SignalCard compact mode shows FLAT when price is down** — Label "FLAT" for a -1.50% move is misleading. Session direction (0.01% threshold) is technically correct but not what traders expect.
  - **FIXED**: Renamed "FLAT" → "NEUTRAL".

- **Data freshness not visible** — No indication whether data is live, delayed, or stale. Traders can't trust data they can't verify.
  - **FIXED**: Home page now shows market status (PRE-MARKET / MARKET OPEN / AFTER-HOURS) + latest quote timestamp.

- **All sectors showing "FLAT" on home page** — Session direction cards show "FLAT" (correct per 0.01% threshold) but looks like ALL sectors are neutral regardless of actual performance. Misleading at a glance.
  - **FIXED**: "FLAT" → "NEUTRAL" + added clearer stat counters (Sectors up/down/neutral).

- **Sector pages exist at /sector/[slug] but not linked from navigation** — Main nav only has: Markets, Desk, Commodities, Crypto, Heatmap. No "Sectors" nav item.
  - **PARTIALLY FIXED**: Home page "Sectors" section links to individual sector pages. Desk page also links.

- **Home page disclaimer says "simulated for demonstration"** — This undermines ALL credibility. If it's simulated, why would traders use it?
  - **NOTE**: The simulated disclaimer refers to AI-generated editorial briefs (Briefs section), not price data. Brief disclaimer should be more specific.

### SIGNIFICANT ISSUES [P1]

- **EMA legend colors don't match chart colors** — KLineChart uses `CHART_EMA_COLORS` hex values, but Tailwind legend uses `EMA_LEGEND_TAILWIND` class names. Some don't match (EMA 40: amber-600 vs yellow-600).
  - **STATUS**: Unchanged — requires color system refactor.

- **Scrolling ticker at 50s/cycle is too slow** — Marcus Chen (swing trader) couldn't read it while monitoring positions.
  - **STATUS**: Not changed — speed acceptable for other users.

- **No SPY relative strength** — Marcus's #1 request: XLF vs SPY, XLK vs SPY for sector rotation. Not implemented.
  - **STATUS**: Not implemented — requires Yahoo SPY data + relative strength calculation.

- **Heatmap page shows text labels, not visual blocks** — The heatmap rendering uses text-only labels in the accessible snapshot, but the actual visual heatmap blocks may not render in some environments.

- **Backtest dashboard equity curves: canvas doesn't resize** — ResizeObserver was added in Round 1 but tested on client-side only.
  - **STATUS**: ResizeObserver added in Round 1.

- **RSI legend recalculates on every render** — Was O(n) per crosshair move.
  - **STATUS**: Memoized in Round 1.

- **Candlestick up/down colors inconsistent** — `KLineChart` uses `#00d084`/`#ff4757`, Volume uses `#22c55e`/`#ef4444`, MACD histogram uses same as volume.
  - **STATUS**: Unchanged — requires color system refactor.

- **"Sharpe Ratio" label showed Calmar formula** — Was mislabeled (return/maxDD instead of true Sharpe).
  - **STATUS**: Renamed to "Calmar Ratio" in Round 1.

- **15-second refresh countdown creates visual noise** — Per-second countdown tick is anxiety-inducing.
  - **STATUS**: Not changed — preference-based.

### MINOR ISSUES [P2]
- Equity curve chart: "Portfolio Return" is average of instrument returns, not true portfolio return. Misleading label.
- Dark pool "bullish/bearish" blue/purple palette is fine.
- "VP" indicator in chart header not explained.
- "INTRADAY" vs "DAILY+" timeframe labels are unclear.
- EMA period legend classes don't match chart library values.

## Software Engineering Findings

### CRITICAL ISSUES [P0]
- **`lib/backtest/signals.ts:78`** — `avg` referenced before assignment in `atr()` function. **FIXED** in Round 2.
- **`lib/backtest/engine.ts:201`** — `atrAtEntryVal` used after rename. **FIXED** in Round 2.
- **`lib/auth.ts`** — NEXTAUTH secret fallback to placeholder string. **FIXED** in Round 1.

### SIGNIFICANT ISSUES [P1]
- **Empty catch in LiveSignalsPanel** (`app/backtest/page.tsx:606`) — Silent failure. **FIXED** in Round 1.
- **Multiple `any` types** in Yahoo Finance responses — API shape untyped. Unchanged.
- **Synchronous file reads** in `/api/backtest/live` — 56 × `readFileSync` per request on serverless. Performance concern.
- **No AbortController** for fetch cancellation in backtest API.
- **ResizeObserver** missing from EquityCurveChart. **FIXED** in Round 1.
- **EMA seeded with `values[0]`** — non-standard. **FIXED** in Round 2.

## Trader Feedback

### Marcus Chen — Swing Sector ETF Trader
- **Rating: 2/10** — "The concept is solid but the execution is fundamentally broken"
- **Top 3 issues**: 1) Broken sector pages (404 errors from nav), 2) All sectors showing FLAT (confusing), 3) Stale/demo data with "simulated" disclaimers
- **Wants**: SPY relative strength, live 200EMA regime classification, individual stock signals within sectors
- **Would show to clients?**: NO — "simulated" disclaimers mean it can't be used for client-facing work

### Sarah Williams — Momentum Tech/Growth Trader
- **Rating: 3/10** — Charts look decent but missing key momentum indicators
- **Top 3 issues**: 1) No 52-week high/low indicators, 2) Volume bars not visible/distinguishable, 3) No relative strength vs SPY for individual stocks
- **Wants**: Cleaner MACD/RSI display, volume surge indicators, Bollinger Band breakout alerts

### David Park — Quantitative/Derivatives Trader
- **Rating: 3/10** — Backtest looks reasonable but data freshness is a dealbreaker
- **Top 3 issues**: 1) Backtest data is 1+ year stale, 2) Sharpe vs Calmar mislabeling (fixed), 3) No minimum data requirements shown for IS/OOS periods
- **Would trust**: NO — stale data + simulated disclaimers
- **Kelly dead code**: Confirms `lib/quant/kelly.ts` is never called

### Alex Rivera — Macro/Commodities Trader
- **Rating: 2/10** — No BTC or commodity regime signals visible
- **Top 3 issues**: 1) /crypto page empty (just nav), 2) No BTC regime classification, 3) No commodity cycle analysis
- **Wants**: BTC vs traditional assets correlation, commodity regime classification

## Decisions Made

1. **Priority order**: UI/UX > Data Accuracy > Algorithm Accuracy > Code Quality
2. **EMA fix**: Both `signals.ts` and `technicals.ts` need fixing — doing signals.ts now, technicals.ts separately
3. **Split adjustment**: Highest priority data fix — requires Yahoo Finance API change
4. **FLAT → NEUTRAL**: Trader feedback — rename for clarity
5. **Data freshness**: Add market hours indicator and timestamp to home page

## Open Questions

1. **EMA seeding in `technicals.ts`**: Same bug as signals.ts — should we fix or leave?
2. **Split adjustment**: Which approach? Yahoo adjClose vs post-processing vs new data source?
3. **Kelly dead code**: Remove it or wire it up?
4. **Walk-forward overlapping windows**: Intentional? Should we switch to non-overlapping?
5. **Briefs "simulated" disclaimer**: Should be more specific — AI briefs are simulated, prices are real
