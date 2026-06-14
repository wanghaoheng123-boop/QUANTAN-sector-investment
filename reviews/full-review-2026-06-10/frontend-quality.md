# Frontend Quality Review — 2026-06-10

**Reviewer:** frontend-quality agent (senior React/Next.js review)
**Base commit:** main @ 6945e34 (post-merge of PR #54 inspection remediation + PR #55 KLineChart/signals split)
**Prior inspection referenced:** reviews/MASTER-INSPECTION-2026-06-04.md §frontend, reviews/inspection-2026-06-04/frontend-deep-sweep.md

## Scope

- `components/**` (all), `hooks/**` (all), `app/**/page.tsx` + layouts (excludes `app/api/**`)
- **P1:** KLineChart split audit — `components/KLineChart.tsx` (~456 ln), `hooks/useKLineChart.ts` (~700 ln), `components/klineTypes.ts`. Effect deps, ref lifecycles, cleanup ordering, indicator flag wiring, resize handling, silently-stale state.
- **P2:** Verify prior remediation: BtcQuantLab Rules-of-Hooks; error boundary at app/crypto/btc/page.tsx; useBtcPriceWs zombie-socket (gen-counter parity with useBtcKlineWs); LiveBriefClient abort-race; InstrumentTable SortIcon nested component.
- **P3:** Systemic a11y pass (aria-sort, aria-expanded, tabpanel semantics, keyboard nav, focus management, alt/aria-label coverage).
- **P4:** UX-from-code heuristics — loading/error/empty states, spinner consistency, blank-panel fetch failures, layout shift.

**Severity scale:** P0 (broken/data-loss) / P1 (serious bug or UX failure) / P2 (defect, limited blast radius) / P3 (polish/hygiene). Each finding carries confidence (High/Med/Low).

---

## Findings

(appended incrementally below)

## Batch 1 — Priority 1: KLineChart split audit (KLineChart.tsx / useKLineChart.ts / klineTypes.ts)

### Extraction fidelity: VERIFIED behavior-preserving (High confidence)

Mechanically diffed `git show c47fe19^:components/KLineChart.tsx` (1039-line original) against the
extracted `hooks/useKLineChart.ts` effects. The mount effect (A), data effect (B), cleanup block,
and dep arrays are **verbatim identical** except: (a) comments trimmed, (b)
`const indMount = { ...DEFAULT_INDICATORS, ...indicatorsIn }` → `const indMount = indicatorsProp`
(equivalent — `indicatorsProp` is the same memoized spread, `KLineChart.tsx:181-184`). Cleanup
ordering (disconnect ResizeObserver → remove charts → null series refs) unchanged. Dep arrays
unchanged (`[]` for mount with eslint-disable; `[candles, darkPoolMarkers, newsMarkers, showRSI,
indicatorsProp, visSerialised, chartReadyGen]` for data). `chartReadyGen` handshake intact.
**No state silently stopped updating as a result of the split itself.** The findings below are
defects that the split preserved — none were reported by the 2026-06-04 inspection (its deep
sweep explicitly excluded KLineChart as "covered by prior agent"; the Wave-1 agent never filed these).

### KL-1 · P1 · High — "Fib" preset/toggle is a no-op: selecting it blanks all indicators and draws nothing
- `app/stock/[ticker]/page.tsx:49-55` (`['fib','Fib']` preset button, wired at `:408`) and
  `components/crypto/BtcChartPanel.tsx:19-25` (same preset row, `:122-131`) plus the
  `IndicatorPanel` "Fib" overlay toggle (`components/IndicatorPanel.tsx:46`).
- `lib/chartEma.ts:123,142`: the fib preset returns `{ ...allEmaOff(), fibonacci: true, ... }`.
- **There is no fibonacci rendering code anywhere.** `grep fibonacci` across components/hooks/lib:
  the flag exists in `components/klineTypes.ts:22`, `KLineChart.tsx:83,131,258` (legend chip only),
  and `lib/chartEma.ts` — `hooks/useKLineChart.ts` never creates a fib series/price-lines
  (`createPriceLine` appears nowhere in the repo).
- User impact: clicking the toolbar "Fib" preset on /stock/[ticker] or /crypto/btc turns **all
  EMAs off** and renders bare candles with a misleading rose "Fib" legend chip
  (`KLineChart.tsx:258,308,399-404`). The advertised feature silently does nothing.
- Fix options: draw fib retracement price-lines from visible-range high/low on the candle series,
  or remove the preset/toggle/legend entries until implemented.

### KL-2 · P1 · High — "Vol SMA(20)" line is permanently invisible while legend + sidebar toggle claim it is ON
- Series is created `visible: false` at `hooks/useKLineChart.ts:301-310` with the comment
  "visibility toggled via applyOptions" — but **no code path ever calls
  `volSmaRef.current.applyOptions({visible})`**:
  - The hook does not return `volSmaRef` (`UseKLineChartResult`, `useKLineChart.ts:160-170`).
  - The component's visibility-sync effect (`KLineChart.tsx:237-246`) handles EMA/VWAP/BB only.
  - `toggleIndicator` (`KLineChart.tsx:263-282`) has no `volSma` branch — and is dead anyway (KL-3).
- Meanwhile `buildVisFromProps` hardcodes `out.volSma = true` (`KLineChart.tsx:132`), so the
  chart legend **always** shows an active "Vol SMA(20)" chip (`:259,308`), and the stock page's
  IndicatorPanel shows the Vol SMA toggle as "ON" (`components/IndicatorPanel.tsx:119-141`,
  fed from `buildVisFromIndicatorPreset` → `volSma: true`, `lib/chartEma.ts:115-123`) while the
  actual line never renders. Toggling it has zero chart effect (the `volSma` key isn't even part
  of `KLineIndicatorFlags`, so `indicatorsProp` ignores it).
- Data for the line IS computed and set on every data pass (`useKLineChart.ts:592-595`) — wasted
  work for a series that can never be shown.

### KL-3 · P1 · High — `onIndicatorsChange` never fires; `toggleIndicator` is dead code; stock-page comment documents a sync that does not exist
- `KLineChart.tsx:263-282` defines `toggleIndicator` (useCallback) — **referenced nowhere in the
  JSX** (grep: only definition + its own body). The legend (`:398-405`) renders passive `<span>`s,
  not buttons. Verified the pre-split original had the same dead callback (orig `:849`), so this
  is not a split regression — but it has never been reported.
- Consequence: the documented contract "Fires whenever a user toggles an indicator via the chart
  overlay buttons" (`KLineChart.tsx:62-64`) is false — there are no overlay buttons. Callers that
  wire it expecting chart→page sync get nothing:
  - `app/stock/[ticker]/page.tsx:78-80` — comment says "Indicator visibility state — synced from
    KLineChart via onIndicatorsChange"; `onIndicatorsChange={handleVisChange}` at `:468`.
  - `components/crypto/BtcChartPanel.tsx:103` passes `onIndicatorsChange` through.
- Today the page→chart direction (via `indicators` prop) carries all real behavior, so nothing
  user-visible breaks — but ~40 lines of dead API + 2 misleading comments invite a future bug
  (e.g. someone "re-enables" overlay buttons and trips the impure-setState pattern: `next` is
  assigned inside the `setVis` updater then read synchronously after — not guaranteed to have run).
- Fix: delete `toggleIndicator` + `onIndicatorsChange` prop (and the side-effecting applyOptions
  inside the state updater), or actually render overlay toggle buttons.

### KL-4 · P2 · Med — async chart init has no failure path: a failed `import('lightweight-charts')` leaves a permanently blank chart
- `hooks/useKLineChart.ts:224-227,467`: `init()` is async, fire-and-forget, no `.catch()`. If the
  dynamic chunk 404s (classic stale-deploy scenario) the rejection is unhandled, `chartReadyGen`
  never bumps, and the container stays an empty `min-h-[200px]` div labeled "(loading)"
  (`KLineChart.tsx:418-430`) forever. `ChartErrorBoundary`/`CryptoChartBoundary` at all three call
  sites cannot catch async errors — boundaries only see render-phase throws.
- Fix: `.catch()` → set an error state the component renders (retry button), mirroring the pages'
  existing "Retry chart" empty-state pattern.

### KL-5 · P2 · Med — runtime `showRSI` flip is silently unsupported (mount effect `[]` vs data effect dep)
- Mount effect creates RSI/MACD/ATR panels only if `showRSI` is true **at mount**
  (`useKLineChart.ts:355,393,424`, deps `[]` at `:500`); the data effect lists `showRSI` in deps
  (`:700`) and the component conditionally renders the panel divs (`KLineChart.tsx:432-453`).
  If `showRSI` ever went false→true post-mount, the divs would appear with their "RSI(14)/MACD/ATR"
  labels but **zero-height empty charts** (refs never initialized). true→false leaks the three
  sub-charts (hidden but alive) until unmount.
- Today all three call sites pass a literal constant `showRSI` (stock `:466`, sector `:501`, BTC
  panel `:102`), so this is latent — but the hook's API advertises it as a normal reactive param.
  Document it as mount-only or react to changes.

### KL-6 · P2 · Med — every candle tick triggers full O(20·N) indicator recompute + `setData` on all 20 EMA series
- Data effect (`useKLineChart.ts:503-700`) re-runs on each `candles` identity change (live BTC WS
  updates). The `touchLast` fast path (`:571-586`) only applies to the candle+volume series; lines
  597-601 still call `series.setData(lineData(calcEMA(closes, p)))` for **all 20 EMA periods**
  (CHART_EMA_PERIODS) plus volSMA (`:593`), RSI (`:643-651`), MACD (`:653-670`), ATR (`:673-679`),
  recomputing each indicator over the full candle array on every tick — even for the 16 series
  whose `visible:false`. On /crypto/btc with 1500 bars this is ~30k+ point writes per WS tick.
  Pre-existing (verbatim in the original), but now isolated in a hook with **no render test or
  perf guard**.
- Fix: gate EMA `setData` behind `isEmaLineVisible` (data refresh on visibility toggle already
  works via `visSerialised` dep), and/or add an incremental `update()` path for line series.

### KL-7 · P3 · High — cleanup leaves 3 series refs dangling (`rsiObRef`, `rsiOsRef`, `macdZeroRef`)
- `useKLineChart.ts:469-498` nulls every series ref except `rsiObRef`/`rsiOsRef`/`macdZeroRef`,
  which keep pointing at disposed series after unmount. All current uses are co-guarded by refs
  that ARE nulled (`:647,667`), so no live crash — hygiene only, but one refactor away from a
  use-after-dispose throw inside an effect.

### KL-8 · P3 · Med — crosshair tooltip stores `String(param.time)` which is "[object Object]" for date-string candles
- `useKLineChart.ts:270`: for equity candles supplied as 'YYYY-MM-DD' strings, lightweight-charts
  normalizes `param.time` to a BusinessDay object → `String(...)` yields `[object Object]`.
  Currently harmless because `CrosshairData.time` is never rendered (`KLineChart.tsx:352-369`
  shows OHLCV only) — but the field is part of the hook's exported `CrosshairData` contract.

### KL-9 · P3 · Med — per-mousemove re-render does O(N) aria-label work; `range` prop accepted but ignored
- Every crosshair move calls `setCrosshairData` (state) → full component re-render → the
  `aria-label` recomputes `Math.min/max(...sortedCandlesPreview.map(...))` — two array maps + two
  spreads over every candle per mousemove (`KLineChart.tsx:421-428`). Memoize the min/max.
- `KLineChartProps.range` (`KLineChart.tsx:59`) is passed by all three callers but never
  destructured/used (`:156-167`) — dead prop, confusing at call sites.

### KL-10 · P2 · High — the split's coverage exclusion makes the highest-risk file formally untested
- `9c8b284` excludes `hooks/useKLineChart.ts` from coverage ("relocated untested chart lifecycle").
  Combined with no render test for `KLineChart.tsx`, the entire chart lifecycle (712-line hook,
  20+ series, 4 chart instances, ResizeObserver, async init handshake) has **zero automated
  verification**. A jsdom smoke test (mock `lightweight-charts`, assert series creation/cleanup
  counts and chartReadyGen handshake) would catch the KL-2/KL-5 class cheaply.

