# Frontend/UI Review — 2026-06-04

## Severity legend
- **P0** — broken UX, React invariant violation, or confirmed runtime bug
- **P1** — accessibility (WCAG), performance regression, or hook discipline issue with real user impact
- **P2** — cleanup / quality: dead code, misleading copy, minor pattern smell

---

## P0 Findings

### P0-1 · `components/crypto/BtcQuantLab.tsx:92-107` — Early return before hooks (React Rules of Hooks violation)

```tsx
export default function BtcQuantLab({ candles }: Props) {
  if (candles.length < 30) {        // ← early return
    return <div>Not enough history…</div>
  }

  const [metrics, setMetrics] = useState<MetricsData | null>(null)  // ← hooks after conditional return
  const [liq, setLiq] = useState<LiqData | null>(null)
  // … 8 more useState / useEffect / useCallback calls
```

React requires that hooks are called in the same order on every render. An early `return` before any hook call changes the number of hooks called when `candles.length < 30`, which violates the Rules of Hooks. React will throw in strict mode and produce erratic state corruption in production when the candle count crosses the threshold (e.g., initial render with < 30 candles, then subsequent render with >= 30 candles).

**Fix:** Move the early-return guard to a *wrapper* component, or hoist all hooks above the guard and render the empty state conditionally inside the return JSX.

**Additional blast radius:** `app/crypto/btc/page.tsx:111` renders `<BtcQuantLab candles={candles} />` bare — it is **not** wrapped in `CryptoChartBoundary` or any error boundary (only `BtcChartPanel` is boundary-wrapped on line 93). When the Rules-of-Hooks throw fires in React strict mode, it propagates all the way to the route's `app/error.tsx`, blanking the entire `/crypto/btc` page. `BtcQuantLab` should be wrapped in `<CryptoChartBoundary title="BTC Quant Lab crashed">` at the call site.

---

### P0-2 · `app/ma-deviation/page.tsx:179` — Component function defined inside render body

```tsx
export default function MADeviationPage() {
  // … state …
  function SortTh({ label, skey }: { label: string; skey: SortKey }) {  // ← defined here
    …
  }
  return (…<SortTh label="Dev %" skey="deviation" />…)
}
```

Defining a component inside another component body means `SortTh` gets a *new identity* on every render of `MADeviationPage`. React reconciles by component reference, so every render **unmounts and remounts** all `SortTh` instances — losing DOM focus and any local state. It also breaks React DevTools identity tracking.

**Fix:** Hoist `SortTh` to module scope outside `MADeviationPage`, passing `sortKey`/`sortDir`/`handleSort` as props or via a shared closure param.

---

### P0-3 · `app/stock/[ticker]/page.tsx:103-131` — `fetchChartData` callback missing AbortController / cancellation

The sector page (`app/sector/[slug]/page.tsx`) was correctly updated at wave 18 to accept `signal?: AbortSignal` in `fetchChartData` and thread it through every `fetch()` call and state setter. The stock page `fetchChartData` (lines 103-131) does **not** — no signal parameter, no abort check.

**Primary failure mode (range switching):** The chart polling effect at lines 162-169 (`[activeTab, activeRange, fetchChartData]`) re-runs whenever the user changes timeframe. The previous fetch is **not** cancelled, so two concurrent fetches race. The one that resolves last wins — meaning the chart can end up showing candles for the *old* range after the user has already switched. This is a deterministic race on slow network or Yahoo throttle.

**Secondary failure mode (ticker navigation):** Although Next.js remounts the route component on ticker change (clearing local state), the in-flight fetch from the previous ticker can race the new mount's initial fetch. The `cancelled = false` flag pattern visible in the darkpool effect (line 211/226) and options effect (lines 235/261) of the *same file* shows the correct approach — the chart fetch is the only one that skipped it.

**Fix:** Mirror the sector-page pattern: add `signal?: AbortSignal` to `fetchChartData`, pass `{ signal }` to `fetch()`, and `if (signal?.aborted) return` before each `setState`. Wrap the chart-fetch effects in `AbortController` / cleanup — the same pattern already applied to the darkpool and options effects in this file.

---

## P1 Findings

### P1-1 · `app/stock/[ticker]/page.tsx:356-363` / `app/sector/[slug]/page.tsx:410-427` — Tab role pattern incomplete (missing `aria-controls`, `role="tabpanel"`, keyboard navigation)

Both pages render a `role="tablist"` container with `role="tab"` + `aria-selected` buttons — correct scaffolding. However:
- The tab buttons do NOT have `aria-controls="<panel-id>"` pointing to the rendered panel.
- The rendered panel content (`{activeTab === 'chart' && …}`) does NOT have `role="tabpanel"` or `id` / `aria-labelledby`.
- There is no arrow-key navigation handler (WAI-ARIA Tabs pattern requires Left/Right arrows to move between tabs; only click works).

**Impact:** Screen readers announce "tab, selected, 1 of N" but cannot navigate to the controlled panel or traverse tabs via keyboard. WCAG 2.1 SC 4.1.2 (Name, Role, Value) + SC 2.1.1 (Keyboard).

**Fix:** Add `id="tab-chart"` / `aria-controls="panel-chart"` to each `<button role="tab">`, add `<div role="tabpanel" id="panel-chart" aria-labelledby="tab-chart">` around each panel, and add an `onKeyDown` arrow-key handler on the `role="tablist"` element.

---

### P1-2 · `components/ComplianceBanner.tsx` — Collapse button missing `aria-expanded` + `aria-controls`

The `<button>` that expands/collapses the detail section does not set `aria-expanded={open}` or `aria-controls` pointing to the collapsible `<div>`. Screen readers have no way to tell users the section can be expanded or that it is currently collapsed.

**Fix:** Add `aria-expanded={open}` to the button and `aria-controls="compliance-detail"` + `id="compliance-detail"` on the collapsible div.

---

### P1-3 · `components/crypto/BtcQuantLab.tsx:157-166` — Two polling intervals with no cross-cancellation

```tsx
// metrics every 30s
useEffect(() => {
  const id = setInterval(() => { void fetchMetrics() }, 30_000)
  return () => clearInterval(id)
}, [fetchMetrics])

// liquidations every 60s
useEffect(() => {
  const id = setInterval(() => { void fetchLiq() }, 60_000)
  return () => clearInterval(id)
}, [fetchLiq])
```

Both `fetchMetrics` and `fetchLiq` are `useCallback` wrapped but do **not** receive or check an `AbortSignal`. A tab switch (which leaves the component mounted) means in-flight fetches from a prior interval tick can complete and call `setMetrics`/`setLiq` even after the user has navigated to a different page's mounting cycle. Also, if `candles.length` drops below 30 mid-session (data refresh), the P0-1 rules-of-hooks violation ensures these effects ran on previous renders but now produce no hooks at all.

**Fix (after fixing P0-1):** Pass an `AbortController.signal` through `fetchMetrics`/`fetchLiq`, cancel it in the interval cleanup, and gate `setState` calls on `signal.aborted`.

---

### P1-4 · `app/crypto/btc/page.tsx:63-73` — `connectKlineWs` / `disconnectKlineWs` in effect deps array but those functions close over `activeRangeRef` + `candleCacheRef`

```tsx
useEffect(() => {
  if (activeTab !== 'chart') {
    disconnectKlineWs()
    return
  }
  fetchCandles(activeRange)
  connectKlineWs(activeRange)
  return () => {
    clearKlineReconnectTimer()
  }
}, [activeTab, activeRange, fetchCandles, connectKlineWs, disconnectKlineWs, clearKlineReconnectTimer])
```

`connectKlineWs` is `useCallback` with deps `[activeRangeRef, candleCacheRef, setCandles]`. Refs are stable, so `connectKlineWs` is stable — good. However, the `ws.onclose` inside `connectKlineWs` calls `connectKlineWs(activeRangeRef.current)` recursively. This recursive call is captured in a closure at the time `connectKlineWs` was defined. If the `activeRange` changes rapidly (e.g., user switches timeframes quickly), the `onclose` reconnect fires using the stale `activeRangeRef.current` but the old `gen` check should protect correctness. No clear bug, but the self-recursive pattern is fragile and leaks a pending reconnect timer if the outer cleanup does not fire (i.e., if `useEffect` re-runs before the WebSocket closes and fires `onclose`).

**Recommendation:** Wrap the reconnect in a check that `klineReconnectTimerRef.current` is null before scheduling (already done), and add a `mounted` flag to the `connectKlineWs` callback to guard against the race.

---

### P1-5 · `components/KLineChart.tsx:252-259` — `console.warn` fires on every render when `indicatorsIn` is partial

```tsx
if (process.env.NODE_ENV !== 'production' && indicatorsIn) {
  for (const k of Object.keys(DEFAULT_INDICATORS)) {
    if (!(k in indicatorsIn)) {
      console.warn(`KLineChart: indicators prop missing key "${k}" — using default`)
    }
  }
}
```

This runs unconditionally on every render (not in a `useEffect`), including re-renders caused by crosshair movement updating `crosshairData` state. On a chart with active crosshair, this fires `~20 warnings × render frequency`. In dev this is noisy; it's correctly excluded from production, but the intent was clearly to warn once.

**Fix:** Wrap in a `useEffect` with `[indicatorsIn]` dep and a `useRef` to track whether the warning already fired for this prop object.

---

### P1-6 · `app/not-found.tsx` — Uses `<a href="/">` instead of Next.js `<Link>`

```tsx
<a href="/" className="px-6 py-2.5 rounded-xl …">
  ← Back to Markets
</a>
```

A bare `<a href="/">` triggers a full browser navigation (hard reload), bypassing Next.js client-side routing and the PWA router cache. **Fix:** Replace with `<Link href="/">`.

---

### P1-7 · `components/crypto/BtcChartPanel.tsx:27-28` — Stable empty arrays declared as module constants (good) but typed as `never[]`

```tsx
const EMPTY_DARK_POOL_MARKERS: never[] = []
const EMPTY_NEWS_MARKERS: never[] = []
```

`KLineChart` accepts `darkPoolMarkers?: DarkPoolMarker[]` and `newsMarkers?: NewsMarker[]`. Passing `never[]` is technically valid (assignable to any array type), but it loses static guarantees — if `KLineChart`'s prop type ever becomes `readonly DarkPoolMarker[]`, the `never[]` cast will break silently at runtime. Prefer `const EMPTY_DARK_POOL_MARKERS: DarkPoolMarker[] = []` with the appropriate import.

---

### P1-8 · `hooks/useLiveQuotes.ts:79-81` — `activeKey` computed outside the effect but used as the effect dep

```tsx
const cleaned = Array.from(new Set(tickers.filter(…)))
const active = cleaned.slice(0, MAX_LIVE_STREAMS)
const activeKey = active.join(',')  // stable string fingerprint

// …
useEffect(() => { … }, [activeKey, supported])
```

`activeKey` is recomputed on **every render** (the comment says "stable string for effect dep comparison", which is correct logic, but the variable itself is not memoized). If the parent re-renders frequently (e.g. every SSE tick on `app/page.tsx`), this computes a new string 13+ times per second, even though the value is identical. The dep comparison still works (strings are compared by value), but it wastes CPU. **Fix:** `const activeKey = useMemo(() => active.join(','), [active])` — or memoize `cleaned/active` via `useMemo`.

---

### P1-9 · `app/backtest/page.tsx:110-116` — Retry button in error state calls `fetchData(true)` without AbortController

```tsx
<button onClick={() => fetchData(true)} …>Retry</button>
```

The function signature `fetchData(showRefresh, tickers?, signal?)` accepts an optional signal. The retry call omits it. If the user clicks Retry while a previous fetch is in flight (network slow + double-click), two concurrent fetches can race. The page-level `useEffect` always passes a controller, but manual retry does not.

**Fix:** Give the component a `useRef<AbortController>` for its active request, abort it before each new fetch (including the retry), and pass the new signal.

---

### P1-10 · `app/sector/[slug]/page.tsx` — SSE + setInterval coexistence (memory flag Q-015)

The file uses:
1. `useLiveQuote(sector.etf)` — persistent SSE connection, no interval.
2. A one-shot REST boot fetch on mount.
3. A `setInterval` for **chart candle** polling when `isStockIntradayPollRange(activeRange)` is true (lines 119-133).

The memory flag Q-015 asked whether SSE and `setInterval` were redundant. **They are NOT redundant**: the SSE is for the *quote header* only (price/change), while the setInterval is for the *chart candles* (OHLC bars). The comment at line 118 explicitly calls this out. The intervals are properly cleaned up on unmount. **No memory leak confirmed.** This flag can be closed.

---

## P2 Findings

### P2-1 · `app/stock/[ticker]/page.tsx:405` — Inline `activeRange` string comparison for bar type label should use `isStockIntradayPollRange`

```tsx
<span>{activeRange === '1D' || activeRange === '1W' || activeRange === '5m' || activeRange === '15m' || activeRange === '1H' || activeRange === '4H' ? 'INTRADAY' : 'DAILY+'} BARS</span>
```

`isStockIntradayPollRange` already exists in `@/lib/chartYahoo`. The inline condition misses `'1m'` and `'3m'` (which the sector page correctly includes). Using the utility function would fix the gap and be DRY.

---

### P2-2 · `components/DarkPoolPanel.tsx:206` — Dead `(hasRealData || true)` guard

```tsx
{(hasRealData || true) && (
  <div … role="region" aria-label="Off-exchange flow sentiment">
```

The `|| true` makes this always render — `hasRealData` is never checked. Either the guard should be removed (making the intent explicit) or `hasRealData` should be used to conditionally render a real vs. synthetic version of the bar.

---

### P2-3 · `app/page.tsx:173-176` — `showToast` excluded from `useEffect` dep array via ESLint disable

```tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

The comment says "showToast is intentionally excluded — it's stable". `showToast` is wrapped in `useCallback` with `[]` deps in `useErrorToast`, so it is stable. But the ESLint disable comment suppresses the warning rather than letting the linter verify stability. If `useErrorToast` ever adds a dep that makes `showToast` unstable, this will silently become a stale closure bug. Preferred approach: add `showToast` to the dep array (it's provably stable, so the effect won't re-run) or add an explicit comment that the linter can verify.

---

### P2-4 · `components/crypto/BtcQuantLab.tsx:384` — Indent error in liquidations tab

```tsx
{activeMetricTab === 'liquidations' && (
  <div>
    {liqLoading && <div …>Refreshing liquidations data…</div>}
  {liqFetchedAt && …}    ← dedented by one level — misaligned with outer div
```

Line 384 (`{liqFetchedAt && …}`) is at the wrong indentation level. Does not affect runtime behavior but indicates the block was edited without reformatting. Should be inside the wrapping `<div>`.

---

### P2-5 · Snapshot tests pin loading/error states only — insufficient behavioral coverage

The two snapshot files (`BacktestPage.test.tsx.snap`, `QuantLabPanel.test.tsx.snap`) pin only the loading spinner and the error fallback UI. They do not snapshot the settled/data state. This means regressions in the data-loaded render tree (e.g., an F-04 percentage formatting change) will not be caught by the snapshots. The snapshots do pin behavior (copy text, not just class names), so they are useful, but they only cover a thin slice.

---

### P2-6 · `components/ComplianceBanner.tsx` — Missing `aria-expanded` on toggle button (duplicate of P1-2, flagged separately for backlog)

Already filed as P1-2 but worth noting as a standalone compliance-disclosure accessibility issue given its regulatory nature.

---

### P2-7 · `app/page.tsx:341` — Stat grid uses array index as key

```tsx
{[…stat items…].map((stat, i) => (
  <div key={i} …>
```

The array is static and never reordered, so there is no actual bug, but using `key={stat.label}` is the correct pattern and will survive future reordering.

---

### P2-8 · `components/crypto/BtcTabBar.tsx` + `components/crypto/BtcChartPanel.tsx` — indicator preset buttons missing `aria-pressed` attribution in BtcChartPanel

The indicator preset buttons in `BtcChartPanel.tsx` (lines 122-133) do not set `aria-pressed={activeIndicator === val}`. The equivalent buttons in `app/stock/[ticker]/page.tsx` and `app/sector/[slug]/page.tsx` correctly set `aria-pressed`. This is inconsistently applied post-decomposition.

---

## Checklist Outcomes

| Item | Status |
|------|--------|
| `ComplianceBanner` mounted in `app/layout.tsx` | ✅ Line 109 |
| Q-015 SSE + setInterval in sector page | ✅ Not redundant — different data (see P1-10) |
| `ChartErrorBoundary` wrapping charts | ✅ All chart renders wrapped in `app/stock`, `app/sector`, `app/crypto/btc` |
| `app/error.tsx` resets correctly (`autoFocus` + `reset()`) | ✅ Correct |
| `app/global-error.tsx` wraps in `<html><body>` | ✅ Correct |
| Skip-to-main link in `app/layout.tsx` | ✅ Present, focusable, WCAG 2.4.1 |
| `next.config.js` image host allowlist (7 hosts, no `**`) | ✅ 7 patterns, wildcard removed per Q-029 |
| Lucide-react 1.x icon names | ✅ `AlertTriangle`, `RefreshCw`, `Eye`, `EyeOff`, `Lock`, `CheckCircle2`, `ChevronDown/Up`, `ShieldAlert` — all valid in 1.x |
| Q-063 backtest WR/cost disclosure | ✅ Present in `app/backtest/page.tsx:228-235` and `LiveSignalsPanel.tsx:354-358` |
| F-04 win rate display (ratio → percent) | ✅ `(portfolio.winRate * 100).toFixed(1)%` in `KeyMetricsStrip.tsx:83` and `AnalysisTab.tsx:138` — correctly multiplied. Confirmed as 0–1 ratio by the guard `portfolio.winRate > 0.5` (line 85) which would be absurd if the value were already a percentage. |
| F-04 max drawdown display | ✅ `-(Math.abs(portfolio.maxPortfolioDd) * 100).toFixed(1)%` — correctly shown as negative percent |
| `app/not-found.tsx` skip-link / accessibility | ⚠️ See P1-6 (bare `<a href="/">`) |
| PR #41 decomposition cohesion | ✅ `BtcHeader`, `BtcTabBar`, `BtcChartPanel` are well-cohesive; hooks (`useBtcCandles`, `useBtcKlineWs`, `useBtcPriceWs`) extracted to `components/crypto/hooks/` — good colocation |
| PR #41 prop drilling | ⚠️ `BtcChartPanel` receives 12 props from `BtcPage` (indicator state, callbacks, vis toggles) — borderline but acceptable for this decomposition depth |
| `useLiveQuote` cleanup on unmount | ✅ `closedManuallyRef = true`, `cleanupTimer()`, `es.close()` in effect return |
| `useLiveQuotes` cleanup on unmount | ✅ All trackers closed, `trackers.clear()` in return |

---

## God-file decomposition recommendations

| File | LOC | Recommended split |
|------|-----|-------------------|
| `components/crypto/BtcQuantLab.tsx` | 516 | Extract `<DerivativesMetricsTabs>` (lines 342-503) and `<SignalGrid>` (lines 330-340) into sibling components; keep quant calculation logic in-file or move to a `useBtcQuant(candles)` hook |
| `app/stock/[ticker]/page.tsx` | 638 | Already has `QuantLabPanel` for the quant tab. Extract `<StockHeader>` (lines 275-350) and `<OptionsTabContent>` (lines 454-562) into dedicated components. Chart panel already wrapped in `BtcChartPanel`-style pattern from BTC decomposition — apply same here |
| `app/sector/[slug]/page.tsx` | 591 | Extract `<SectorHeader>` (lines 237-350) — identical structural pattern to `StockHeader`. The `DashboardGuide` content block (lines 355-403) is already a component call but could be data-driven from `lib/sectors.ts` to reduce JSX noise |
| `app/page.tsx` | 585 | Extract `<MarketBreadthBar>` (lines 352-432) and `<NewsBriefList>` (lines 499-563) into components; `app/page.tsx` becomes an orchestration shell similar to `app/backtest/page.tsx` post-Q-054 |
| `app/ma-deviation/page.tsx` | 569 | Move `SortTh` to module scope (P0-2 fix already does this); extract `<DeviationSpectrumChart>` (lines 449-516) |

---

## Files inspected

**God files (full reads):**
- `components/KLineChart.tsx` (1039 LOC)
- `app/stock/[ticker]/page.tsx` (638 LOC)
- `app/sector/[slug]/page.tsx` (591 LOC)
- `app/page.tsx` (585 LOC)
- `app/ma-deviation/page.tsx` (569 LOC)
- `components/crypto/BtcQuantLab.tsx` (516 LOC)
- `components/stock/quantlab/tabs/LlmTab.tsx` (470 LOC)
- `components/backtest/LiveSignalsPanel.tsx` (361 LOC)
- `components/DarkPoolPanel.tsx` (341 LOC)

**Layout / error pages:**
- `app/layout.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`

**Hooks:**
- `hooks/useLiveQuote.ts`, `hooks/useLiveQuotes.ts`, `hooks/useLivePrices.ts`, `hooks/useErrorToast.ts`, `hooks/useDialogA11y.ts`, `hooks/useWatchlist.ts` (skimmed)

**PR #41 decomposition:**
- `app/crypto/btc/page.tsx`, `components/crypto/BtcHeader.tsx`, `components/crypto/BtcTabBar.tsx`, `components/crypto/BtcChartPanel.tsx`
- `components/crypto/hooks/useBtcCandles.ts` (skimmed), `useBtcKlineWs.ts` (full), `useBtcPriceWs.ts` (full)

**Other components (full):**
- `components/ChartErrorBoundary.tsx`, `components/ComplianceBanner.tsx`
- `components/backtest/KeyMetricsStrip.tsx`, `components/backtest/OverviewTab.tsx`
- `app/backtest/page.tsx` (partial — lines 1-180)

**Config:**
- `next.config.js`

**Snapshots:**
- `__tests__/components/backtest/__snapshots__/BacktestPage.test.tsx.snap`
- `__tests__/components/stock/__snapshots__/QuantLabPanel.test.tsx.snap`

---

## What I did NOT cover

- `components/stock/QuantLabPanel.tsx` and all `quantlab/tabs/` except `LlmTab.tsx` — skim only
- `components/Sparkline.tsx`, `components/SectorCard.tsx`, `components/SignalCard.tsx`, `components/PriceTicker.tsx`, `components/GlobalSearch.tsx`, `components/KeyboardShortcuts.tsx`, `components/IndicatorPanel.tsx`, `components/NewsFeed.tsx`, `components/WatchlistButton.tsx`, `components/SafeAuth.tsx`, `components/Providers.tsx`, `components/DataFreshnessIndicator.tsx`, `components/MarketStatus.tsx`, `components/MetricTooltip.tsx`, `components/Breadcrumbs.tsx`, `components/DashboardGuide.tsx` — not read
- `components/options/` — not read
- `components/risk/TailRiskBanner.tsx` — not read
- `app/portfolio/`, `app/risk/`, `app/heatmap/`, `app/desk/`, `app/briefs/`, `app/commodities/`, `app/crypto/page.tsx` — not read
- `components/backtest/` except `LiveSignalsPanel.tsx`, `KeyMetricsStrip.tsx`, `OverviewTab.tsx` — partial reads only
- Test files beyond snapshots mentioned above
- `lib/` modules (indicators, backtest engine, chartEma, sectors) — out of scope for UI review
