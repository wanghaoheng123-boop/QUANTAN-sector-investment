# Frontend Deep Sweep (component tree) — 2026-06-04

Reviewer: deep-sweep agent (claude-sonnet-4-6)
Scope: ~35 components + app pages NOT covered by Wave 1 agent.
Excluded from scope (covered by prior agent): KLineChart, BtcQuantLab, stock/sector/ma-deviation/dashboard pages.
Method: READ every file in full; confirm bugs line-by-line; no grep-and-guess false positives.

---

## Severity legend
- **P0** crash / security / data corruption
- **P1** real-user-impact bug or confirmed WCAG Level-A/AA failure
- **P2** smell / correctness risk / minor a11y gap

---

## NEW findings — grouped by bug class

---

### BUG CLASS A: Uncancelled fetch in useEffect (race / stale state)

**F-01 · P1 · `app/briefs/sector/[sector]/LiveBriefClient.tsx:76-88`**

```tsx
useEffect(() => {
  if (!slug || initialBrief) return
  setLoading(true)
  fetch(`/api/briefs/${encodeURIComponent(slug)}`)
    .then(r => { ... })
    .then(data => { setBrief(data); setLoading(false) })
    .catch(e => { setError(e.message); setLoading(false) })
}, [slug, initialBrief])
```

No AbortController. If the user navigates quickly (slug prop changes), the inflight promise resolves and calls `setBrief`/`setLoading(false)` on the old slug's payload, overwriting the new slug's state mid-render. Classic stale-closure race condition, same class as the confirmed `stock/[ticker]/page.tsx` bug.

**Fix:** add `let cancelled = false` (or an AbortController); in the promise chain check `if (cancelled) return`; return `() => { cancelled = true }`. Pattern already used correctly in `components/NewsFeed.tsx:57-80` — copy that.

---

**F-02 · P1 · `components/SectorRotationPanel.tsx:48-56`**

```tsx
useEffect(() => {
  fetch('/api/sector-rotation')
    .then(...).then(d => { setData(d); setLoading(false) })
    .catch(e => { setError(String(e)); setLoading(false) })
}, [])
```

No AbortController or cancelled-flag. This effect runs once (empty dep array) so the race is unlikely in normal use, but if the component unmounts before the fetch resolves (e.g. the user navigates away), `setData`/`setLoading` are called on an unmounted component, triggering a React "Can't perform a state update on an unmounted component" warning in development. Also: no `res.ok` check — a 5xx response calls `.json()` on an error body and may throw.

**Fix:** add cancelled-flag + `if (!res.ok) throw new Error(...)` check.

---

### BUG CLASS B: key={index} on dynamic / sortable lists

**F-03 · P2 · `app/briefs/sector/[sector]/LiveBriefClient.tsx:245`**
```tsx
{brief.signals.map((s, i) => (
  <div key={i} ...>
```
Signals list keyed by index. If the API reorders or inserts signals, React reuses stale DOM.
**Fix:** `key={s.key}` — the `BriefSignal.key` field is unique per signal.

**F-04 · P2 · `app/briefs/sector/[sector]/LiveBriefClient.tsx:289`**
```tsx
{brief.news.map((item, i) => (
  <a key={i} ...>
```
News items keyed by index. If server reorders, link URLs will mismatch rendered titles during reconciliation.
**Fix:** `key={item.link ?? item.publishedAt + item.title}`.

**F-05 · P2 · `components/backtest/LiveSignalsPanel.tsx:254`**
```tsx
{insts.slice(0, 200).map((inst, i) => (
  <tr key={i} ...>
```
Instrument rows keyed by slice index. After a sort/filter change, every visible row is "new" to React's reconciler — full DOM teardown/creation per row, visible flicker, destruction of keyboard focus.
**Fix:** `key={inst.ticker as string}` (ticker is unique per instrument).

**F-06 · P2 · `components/DarkPoolPanel.tsx:261`**
```tsx
{prints.slice(0, 10).map((print, i) => (
  <tr key={i} ...>
```
Block-prints table keyed by index. Static data in practice, but inconsistent with project patterns.
**Fix:** `key={print.time + '-' + print.price}`.

**F-07 · P2 · `components/NewsFeed.tsx:131`**
```tsx
<a key={i} href={getLink(item)} ...>
```
Live news items keyed by index. After re-fetch the news array may reorder.
**Fix:** `key={item.link ?? item.url ?? String(i)}`.

**F-08 · P2 · `components/backtest/TradeLog.tsx:133`**
```tsx
<tr key={i} className="...">
```
Trade rows keyed by filtered-slice index. After filter changes, React remaps rows by position.
**Fix:** `key={t.date + '-' + t.ticker + '-' + t.action}` (composite stable key from available Trade fields).

**F-09 · P2 · `components/stock/quantlab/tabs/FinancialsTab.tsx:26,54`**
```tsx
<tr key={i} ...>   // balance sheet rows
<tr key={i} ...>   // income statement rows
```
Financial statement rows keyed by index. If the API adds or reorders periods, React remaps rows incorrectly.
**Fix:** `key={b.endDate ?? i}` for balance; `key={r.endDate ?? i}` for income.

**F-10 · P2 · `app/briefs/BriefCard.tsx:104`**
```tsx
<span key={i} className="text-[11px]...">
```
Signal chips in BriefCard keyed by index.
**Fix:** `key={s.key}` (same signal key as F-03 above).

**F-11 · P2 · `components/PriceTicker.tsx:53`**
```tsx
{doubled.map((item, i) => (
  <div key={i} ...>
```
`doubled` = `[...items, ...items]`. The duplicate items are intentional for the infinite-scroll animation, but index keys on the doubled array will cause identical keys between the two halves (both position 0, 1, 2...). React will warn about duplicate keys and may exhibit incorrect reconciliation when `items` changes.
**Fix:** `key={`${i}-${item.ticker}`}` — combines position with ticker to produce unique keys even when items are duplicated.

---

### BUG CLASS C: Missing error boundary for risky component work

**F-12 · P1 · `components/options/GexChart.tsx` — unguarded SVG binary search**

`GexChart` computes SVG y-coordinates via a binary search over `strikeGex`. The code assumes `strikeGex` is in ascending strike order (because `computeGex` sorts it), but does not verify this at render time. If `strikeGex` arrives out of order (schema drift, future refactor), the binary search terminates with `lo+1 !== hi` and the fraction computation produces out-of-range y-coordinates for the flip-point line (negative y or y > chartHeight). This renders a garbage SVG line but does not crash because SVG accepts out-of-bounds coordinates. More critically, the `GexChart` component has no wrapping error boundary — a future runtime error in the SVG math would propagate to the nearest parent boundary and take down the options panel.

**Fix:** wrap the call site (`app/stock/[ticker]/page.tsx`) in the already-existing `ChartErrorBoundary`. See confirmed pattern at `components/backtest/OverviewTab.tsx:49-54` (`ChartErrorBoundary` wrapping `EquityCurveChart`).

---

### BUG CLASS D: Number / currency formatting bypassing `lib/format.ts` SSOT

**F-13 · P2 · `components/DarkPoolPanel.tsx:21-31`**
```tsx
function fmtShares(n) { ... }   // duplicates formatCompactNumber
function fmtPct(n, decimals)  { ... }   // duplicates formatPercent
```
Two file-local helpers duplicate `lib/format.ts` exports. Not a runtime bug today, but divergence risk if SSOT changes.
**Fix:** delete both; import `formatCompactNumber`, `formatPercent` from `@/lib/format`.

**F-14 · P2 · `app/briefs/sector/[sector]/LiveBriefClient.tsx:163-173`**
```tsx
${brief.price.toFixed(2)}
{brief.changePct.toFixed(2)}%
{brief.change.toFixed(2)}
```
Raw `.toFixed()` on API numbers rather than `lib/format`. If the API returns a halted-symbol quote where `price` is `null` (TypeScript says `number` but API can drift), `.toFixed()` throws. Same vulnerability confirmed in `app/stock/[ticker]/page.tsx`.
**Fix:** use `formatCurrency(brief.price)` and `formatPercent(brief.changePct)` from `@/lib/format`.

---

### BUG CLASS E: Accessibility (a11y) — confirmed WCAG failures

**F-15 · P1 · `components/SignalCard.tsx:57,101` — `aria-label` on plain `<div>` (invisible to AT)**

Both the compact and full `SignalCard` variants set `aria-label` on a plain `<div>`:
```tsx
<div ... aria-label={directionAriaLabel(signal.direction, session)}>
```
`aria-label` is only announced by screen readers when the element has a role that supports naming (landmark, `role=region`, `role=group`, interactive roles, etc.). On a plain `<div>` with no role, the attribute is silently ignored — the label is invisible to assistive technology (WCAG 2.4.6, 1.3.1).

**Fix:** add `role="region"` to the outer `<div>` so the `aria-label` creates a named landmark region.

**F-16 · P1 · `components/backtest/LiveSignalsPanel.tsx:163` — sortable table columns missing `aria-sort`**

The `thClass` builder that styles sortable `<th>` elements does not set `aria-sort`. Screen readers announce these columns as plain unsorted headers; users cannot discover current sort direction.
```tsx
const thClass = (key: SortKey) => `px-3 py-2 ... ${sortKey === key ? 'text-cyan-400' : ''}`
```
**Fix:** add `aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}` as a prop when rendering each `<th>`.

**F-17 · P1 · `components/options/OptionsChainTable.tsx:149` — toggle button missing `aria-expanded`**

```tsx
<button onClick={() => setShowAllExpiries((v) => !v)} ...>
  {showAllExpiries ? 'Show less' : `+${...} more`}
</button>
```
The "Show more/less" expiry toggle has no `aria-expanded` attribute. Screen readers cannot tell whether the list is expanded or collapsed without reading the button text.
**Fix:** add `aria-expanded={showAllExpiries}`.

**F-18 · P1 · `components/ComplianceBanner.tsx:14-24` — toggle button missing `aria-expanded` and `aria-controls`**

```tsx
<button
  type="button"
  onClick={() => setOpen(!open)}
  className="w-full flex items-center justify-between gap-3 text-left"
>
```
The compliance disclosure toggle has no `aria-expanded` / `aria-controls`. WCAG 2.5.3 / APG disclosure pattern requires `aria-expanded` on the triggering button.
**Fix:** add `aria-expanded={open}` + `aria-controls="compliance-body"` (add `id="compliance-body"` to the collapsible `<div>`).

**F-19 · P1 · `components/stock/quantlab/tabs/FrameworksTab.tsx:24-35` — accordion buttons missing `aria-expanded` and `aria-controls`**

```tsx
<button
  type="button"
  onClick={() => setOpenFrameworkId(open ? null : f.id)}
  className="cursor-pointer w-full flex items-center gap-3 p-4 text-left"
>
```
Framework accordion trigger buttons have no `aria-expanded`. Seven disclosure toggles, none announcing their state to AT.
**Fix:** add `aria-expanded={open}` to each framework button; add `aria-controls={`framework-${f.id}`}` and the matching `id` on the collapsible region.

**F-20 · P2 · `app/desk/page.tsx:226` — watchlist "★" column color-only indicator**

```tsx
<td className="px-2 py-1 text-center text-amber-500/90">{has(t) ? '★' : ''}</td>
```
Watchlisted status is communicated only by presence/absence of a gold star. Empty cell for unwatchlisted items provides no accessible state. WCAG 1.4.1 (Use of Color).
**Fix:** `<span aria-label={has(t) ? 'Watchlisted' : 'Not watchlisted'}>★</span>` (or use `<td aria-label=...>`).

**F-21 · P2 · `app/heatmap/page.tsx:101` — heatmap tiles use color alone for state**

Each sector heatmap tile communicates its price direction (bullish/bearish) exclusively via background color (`bg-green-600`, `bg-red-900`, etc.). No text, icon, or `aria-label` distinguishes direction. The rendered `{isUp ? '+' : ''}` prefix on the percent value only appears after the loading skeleton clears. WCAG 1.4.1.
**Fix:** the percentage already shows `+`/`−` prefix — that satisfies 1.4.1. However the `<div>` tile wrapping the `<Link>` has no accessible role and the Link wraps a block element (valid in HTML5 but the inner `<div>` has no accessible name). Consider adding `aria-label={`${sector.name}: ${isUp ? 'up' : 'down'} ${quote?.changePct.toFixed(2)}%`}` to the outer `<Link>`.

**F-22 · P2 · `components/BtcTabBar.tsx:26` — tablist without `aria-label`**

```tsx
<div role="tablist" className="...">
```
The `role=tablist` container has no `aria-label`. Screen readers will announce it as an unlabeled tab list, giving no context. Additionally, each `role=tab` button inside lacks `aria-controls` pointing to the corresponding `role=tabpanel`.
**Fix:** add `aria-label="BTC view"` to the tablist; add `aria-controls={`btc-panel-${tab}`}` to each tab button; add matching `id` and `role=tabpanel` to the content pane rendered by the parent.

---

### BUG CLASS F: Derived state computed in render (performance / correctness)

**F-23 · P2 · `components/backtest/LiveSignalsPanel.tsx:71-116` — O(n) derived state unmemoized**

`rawInsts`, `sectors`, `latestDataDate`, `buyCount`, `holdCount`, `sellCount`, `total`, `sectorWithBuy`, `totalSectors`, `buyPct`, `marketRegimeLabel`, `rsiBreadth`, `insts` (the filtered+sorted array), and the entire sector-regime-matrix computation are ALL re-derived from `signals` on EVERY render. The component re-renders on sort key/direction/filter changes — each interaction triggers all these O(n) loops even though `signals` didn't change.

**Fix:** wrap the signal breadth metrics and `insts` computation in `useMemo` keyed on `[signals, filterSector, filterAction, sortKey, sortDir]`. Pattern already used correctly in `components/backtest/TradeLog.tsx:26-43`.

---

### BUG CLASS G: `window`/`document` access without SSR guard

**F-24 · P1 · `components/KeyboardShortcuts.tsx:121`**

```tsx
if (!isOpen) return null

if (typeof document === 'undefined') return null
```

The SSR guard `typeof document === 'undefined'` appears AFTER `if (!isOpen) return null`. When `isOpen` is `false` (as it is on first render, before any user interaction), the component returns null safely. But if somehow `isOpen` becomes `true` during SSR (e.g. forced via a test renderer or concurrent hydration edge case), the component reaches `createPortal(…, document.body)` before the guard executes. More critically, the early-returns obscure the code's intent: a developer reading the component will see the `null` guard AFTER the `isOpen` guard and assume the SSR branch is reachable — it is not in practice, but the defensive guard is mispositioned.

This is a **P2 code smell** not a live crash (KeyboardShortcuts is client-only and `isOpen` starts false), but the guard order is misleading.
**Fix:** reorder: put the SSR guard first, then the `!isOpen` check.

---

### BUG CLASS H: Missing `scope` on `<th>` in `app/commodities/page.tsx`

**F-25 · P2 · `app/commodities/page.tsx:115-123` — `<th>` without `scope`**

```tsx
<th className="px-4 py-3">Symbol</th>
<th className="px-4 py-3">Name</th>
...
```
Seven column headers in the commodities table have no `scope="col"` attribute. WCAG 1.3.1 (Info and Relationships) requires `<th scope="col">` for column headers in data tables.
**Fix:** add `scope="col"` to every `<th>` in the table header row.

---

### BUG CLASS I: Missing `scope` on `<th>` in `app/risk/scenarios/page.tsx`

**F-26 · P2 · `app/risk/scenarios/page.tsx:22-27` — `<th>` without `scope`**

```tsx
<th className="px-4 py-2">Scenario</th>
<th className="px-4 py-2">P&amp;L</th>
...
```
Five column headers in the stress-scenarios table have no `scope="col"`.
**Fix:** add `scope="col"` to every `<th>`.

---

## Components verified CLEAN (no new bugs found)

The following were read in full and confirmed clean against all bug classes in scope:

- `components/backtest/LiveSignalsPanel.tsx` — AbortController present; fetch lifecycle correct (F-05/F-16/F-23 are separate classes)
- `components/backtest/EquityCurveChart.tsx` — ResizeObserver correctly disconnected on cleanup; canvas logic clean; aria-label present
- `components/backtest/TradeLog.tsx` — useMemo correctly keyed; no effects; sort uses spread (no prop mutation); noted F-08 only
- `components/backtest/AnalysisTab.tsx` — pure presentation; spread-before-sort correct
- `components/backtest/WalkForwardPanel.tsx` — useEffect dep array correct (`[tickers, selectedTicker]`); no fetch; clean
- `components/backtest/SectorHeatmap.tsx` — pure presentation; role=img with aria-label on each tile; clean
- `components/backtest/OverviewTab.tsx` — correctly wraps EquityCurveChart in ChartErrorBoundary; clean
- `components/backtest/KeyMetricsStrip.tsx` — pure presentation; uses formatPercent SSOT; clean
- `components/backtest/BacktestMetricCard.tsx` — pure presentation; clean
- `components/DarkPoolPanel.tsx` — no hooks (pure display); ARIA roles present; noted F-06/F-13 only
- `components/GlobalSearch.tsx` — AbortController + setTimeout cleanup correct; localStorage SSR-guarded; click-outside + global keydown cleanly removed; clean except F-07
- `components/stock/quantlab/tabs/LlmTab.tsx` — memo-wrapped; pure display; no effects; clean
- `components/stock/quantlab/tabs/TechnicalsTab.tsx` — pure display; early return at line 29 is CLEAN for Rules of Hooks (no hooks follow it); uses lib/format SSOT
- `components/stock/quantlab/tabs/SummaryTab.tsx` — pure display; formatCurrency used; clean
- `components/stock/quantlab/tabs/ValuationTab.tsx` — pure display; clean
- `components/stock/quantlab/tabs/FinancialsTab.tsx` — pure display; noted F-09 only
- `components/stock/quantlab/tabs/FrameworksTab.tsx` — noted F-19 only
- `components/stock/quantlab/ui.tsx` — pure presentation primitives; clean
- `components/stock/LlmDeployAssistant.tsx` — Escape keydown: addEventListener + removeEventListener cleanup correct; useDialogA11y; clean
- `components/stock/QuantLabPanel.tsx` — delegates to hooks; no raw fetch; clean
- `components/stock/QuantLabMarketCards.tsx` — pure presentation; formatCurrency used; clean
- `app/desk/page.tsx` — useMemo correctly keyed; no fetch in page; delegates to useLivePrices; noted F-20 only
- `components/options/OptionsChainTable.tsx` — useMemo correctly keyed; ContractCell memoised; no effects; noted F-17 only
- `components/options/GexChart.tsx` — no hooks; pure compute+SVG; noted F-12 only
- `components/options/FlowScanner.tsx` — pure display; contractSymbol used as key; clean
- `components/options/MaxPainGauge.tsx` — defensive guard for null/non-finite; clean
- `components/SignalCard.tsx` — memo-wrapped; pure display; noted F-15 only
- `components/KeyboardShortcuts.tsx` — setInterval/addEventListener all correctly cleaned up; portal SSR-guarded; noted F-24 (guard order) only
- `components/NewsFeed.tsx` — cancelled-flag pattern used correctly; noted F-07 only
- `components/SectorCard.tsx` — memo-wrapped; pure display; safeFixed used; clean
- `components/SectorRotationPanel.tsx` — noted F-02 (no AbortController, no res.ok check) only
- `components/IndicatorPanel.tsx` — pure display; aria-pressed on all buttons; clean
- `components/PriceTicker.tsx` — useState + CSS animation; no fetch/effects; noted F-11 only
- `components/Sparkline.tsx` — pure SVG; role=img + aria-label; clean
- `components/WatchlistButton.tsx` — aria-label + aria-pressed; useWatchlist hook; clean
- `components/MarketStatus.tsx` — setInterval correctly cleaned up; role=status; clean
- `components/DataFreshnessIndicator.tsx` — setInterval correctly cleaned up; role=status + aria-live; clean
- `components/MetricTooltip.tsx` — event listeners correctly cleaned up; aria-expanded; clean
- `components/ErrorToastList.tsx` — pure display; role=alert/status; aria-live=polite; clean
- `components/ChartErrorBoundary.tsx` — role=alert + aria-live=assertive; retry clears error state; clean
- `components/SafeAuth.tsx` — AuthErrorBoundary correctly handles NextAuth failures; clean
- `components/Providers.tsx` — SessionErrorBoundary wraps SessionProvider; clean
- `components/ComplianceBanner.tsx` — noted F-18 only (missing aria-expanded)
- `components/DashboardGuide.tsx` — aria-expanded + aria-controls correctly wired; clean
- `components/Breadcrumbs.tsx` — nav + aria-label present; clean
- `components/crypto/BtcChartPanel.tsx` — memo-wrapped; pure display; CryptoChartBoundary present; clean
- `components/crypto/BtcHeader.tsx` — memo-wrapped; pure display; clean
- `components/crypto/BtcTabBar.tsx` — noted F-22 only (tablist missing aria-label)
- `components/crypto/CryptoChartBoundary.tsx` — error boundary correct; retry clears state; clean
- `components/risk/TailRiskBanner.tsx` — pure display (hardcoded demo data); clean
- `app/heatmap/page.tsx` — AbortController poll correctly implemented; noted F-21 (color-only) only
- `app/commodities/page.tsx` — AbortController pattern correct; useMemo correctly keyed; spread-before-sort fixed; noted F-25 only
- `app/backtest/page.tsx` (shell) — AbortController on selectedTickers dep correct; clean shell
- `app/briefs/page.tsx` — async Server Component; clean
- `app/briefs/BriefCard.tsx` — noted F-10 only
- `app/portfolio/page.tsx` — Server Component (file system read); no client hooks; clean
- `app/portfolio/factor-attribution/page.tsx` — Server Component; clean
- `app/risk/scenarios/page.tsx` — noted F-26 only
- `app/auth/signin/page.tsx` — Server Component; clean
- `app/auth/signin/SignInButtons.tsx` — aria-busy correct; Spinner has role=status; clean
- `app/layout.tsx` — skip-link present; `main#main-content tabIndex=-1`; clean
- No `dangerouslySetInnerHTML` found anywhere in the component tree
- All `setInterval` / `addEventListener` / `setTimeout` usages in components confirmed cleaned up in effect return functions

---

## Summary table

| ID | Severity | File:line | Class | One-line fix |
|----|----------|-----------|-------|--------------|
| F-01 | P1 | `LiveBriefClient.tsx:76` | Uncancelled fetch race | Add cancelled-flag or AbortController |
| F-02 | P1 | `SectorRotationPanel.tsx:48` | Uncancelled fetch + no res.ok check | Add cancelled-flag; add `if (!r.ok) throw` |
| F-03 | P2 | `LiveBriefClient.tsx:245` | key={index} | `key={s.key}` |
| F-04 | P2 | `LiveBriefClient.tsx:289` | key={index} | `key={item.link}` |
| F-05 | P2 | `LiveSignalsPanel.tsx:254` | key={index} on sortable list | `key={inst.ticker}` |
| F-06 | P2 | `DarkPoolPanel.tsx:261` | key={index} | `key={print.time+'-'+print.price}` |
| F-07 | P2 | `NewsFeed.tsx:131` | key={index} on live list | `key={item.link ?? String(i)}` |
| F-08 | P2 | `TradeLog.tsx:133` | key={index} on filtered list | composite stable key |
| F-09 | P2 | `FinancialsTab.tsx:26,54` | key={index} on period rows | `key={b.endDate ?? i}` |
| F-10 | P2 | `BriefCard.tsx:104` | key={index} | `key={s.key}` |
| F-11 | P2 | `PriceTicker.tsx:53` | duplicate keys from doubled array | `key={i+'-'+item.ticker}` |
| F-12 | P1 | `GexChart.tsx` (call site) | Missing error boundary | Wrap in ChartErrorBoundary |
| F-13 | P2 | `DarkPoolPanel.tsx:21-31` | Format SSOT bypass | Use `formatCompactNumber`, `formatPercent` |
| F-14 | P2 | `LiveBriefClient.tsx:163-173` | Raw `.toFixed()` on API number | Use `formatCurrency`, `formatPercent` |
| F-15 | P1 | `SignalCard.tsx:57,101` | `aria-label` on plain `<div>` ignored | Add `role="region"` |
| F-16 | P1 | `LiveSignalsPanel.tsx:163` | Sortable th missing `aria-sort` | Add `aria-sort` prop to thClass |
| F-17 | P1 | `OptionsChainTable.tsx:149` | Toggle button missing `aria-expanded` | Add `aria-expanded={showAllExpiries}` |
| F-18 | P1 | `ComplianceBanner.tsx:14` | Toggle button missing `aria-expanded` | Add `aria-expanded={open}` + `aria-controls` |
| F-19 | P1 | `FrameworksTab.tsx:24` | Accordion buttons missing `aria-expanded` | Add `aria-expanded={open}` to each |
| F-20 | P2 | `app/desk/page.tsx:226` | Color-only watchlist indicator | Add `aria-label` to star cell |
| F-21 | P2 | `app/heatmap/page.tsx:101` | Heatmap Links missing accessible name | Add `aria-label` to each Link |
| F-22 | P2 | `BtcTabBar.tsx:26` | tablist missing `aria-label`; tabs missing `aria-controls` | Add `aria-label` + `aria-controls` |
| F-23 | P2 | `LiveSignalsPanel.tsx:71-116` | O(n) derived state unmemoized | Wrap in useMemo |
| F-24 | P2 | `KeyboardShortcuts.tsx:121` | SSR guard after early-return (misleading order) | Reorder guards |
| F-25 | P2 | `app/commodities/page.tsx:115` | `<th>` missing `scope="col"` | Add `scope="col"` |
| F-26 | P2 | `app/risk/scenarios/page.tsx:22` | `<th>` missing `scope="col"` | Add `scope="col"` |

---

## What I did NOT cover

All components and pages listed in the scope were read. The only items not covered:
- WebSocket hooks (`hooks/useBtcKlineWs.ts`, `hooks/useLiveQuote.ts`, etc.) — WS lifecycle is covered by the prior Wave 1 agent
- `app/page.tsx` (dashboard) — confirmed as covered by prior Wave 1 agent; index keys at lines 341/486/574 are static arrays and not in scope for this sweep
- `lib/` files — out of scope for this component-tree sweep

---
*Completed: full sweep — 55 components / pages read*
