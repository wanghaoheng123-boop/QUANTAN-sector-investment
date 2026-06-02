# WS4 Frontend/Refactor Blueprint — 2026-06-01

**Agent:** WS4 (Frontend/Refactor, READ-ONLY)
**Mode:** Blueprint only — zero source edits, no branch.
**Executes AFTER:** PR #32 (`fix/a11y-sweep`) merges. All three target files are locked on #32.
**Template mirrored:** `app/backtest/page.tsx` (268 LOC shell) + `components/backtest/*`
  and `components/stock/quantlab/hooks/` + `components/stock/quantlab/tabs/` pattern.
**Baseline:** `main @ 8d56955`

---

## Measured LOC (actual, not inspection estimates)

| File | Actual LOC |
|------|-----------|
| `app/crypto/btc/page.tsx` | **813** (matches inspection) |
| `components/stock/quantlab/tabs/LlmTab.tsx` | **467** (matches inspection) |
| `components/stock/quantlab/hooks/useQuantLabLlm.ts` | **234** (not mentioned in inspection) |
| `app/stock/[ticker]/page.tsx` | **654** |
| `app/backtest/page.tsx` (template) | **268** |
| `components/crypto/BtcQuantLab.tsx` (existing sibling) | **516** |
| `components/crypto/CryptoChartBoundary.tsx` | **38** |
| `components/backtest/KeyMetricsStrip.tsx` | **95** |
| `components/backtest/OverviewTab.tsx` | **71** |
| `components/backtest/AnalysisTab.tsx` | **159** |
| `components/backtest/LiveSignalsPanel.tsx` | **355** |
| `components/backtest/InstrumentTable.tsx` | **148** |

---

## D3-2 — `app/crypto/btc/page.tsx` (813 LOC) — God-component decomposition

### Context and constraint

`app/crypto/btc/page.tsx` is the platform's second-largest page file (inspection §1b). It has three
distinct, independently-complex concerns:

1. **Two live WebSocket connections** — Kraken OHLC kline (with gen-counter stale-message guard,
   reconnect timer, candle cache) and Coinbase ticker (with REST quote fallback). Combined: lines
   319–568, ~250 LOC.
2. **A 3-level fetch chain** — primary API → Kraken REST fallback → CoinGecko client-side fallback,
   with AbortController, retry loop, request-ID guard, and normalize step. Lines 185–317, ~133 LOC.
3. **The page shell** — header price banner, tab/timeframe/indicator controls, chart grid with
   `CryptoChartBoundary`, and the `IndicatorPanel` sidebar. Lines 630–813, ~184 LOC.

Contrasted with the backtest template: backtest kept a ~40-LOC inline `fetchData` callback because
there are no WebSocket connections. BTC's data layer is too heavy for inline placement — it must move
to hooks. This is the critical difference from the backtest decomposition model.

### Exact new file list

```
app/crypto/btc/
  page.tsx                             ← SHELL ONLY (~130 LOC after refactor)

components/crypto/
  BtcQuantLab.tsx                      ← UNCHANGED (already exists, 516 LOC)
  CryptoChartBoundary.tsx              ← UNCHANGED (already exists, 38 LOC)
  hooks/
    useBtcCandles.ts                   ← NEW, ~160 LOC
    useBtcKlineWs.ts                   ← NEW, ~130 LOC
    useBtcPriceWs.ts                   ← NEW, ~130 LOC
  BtcHeader.tsx                        ← NEW, ~65 LOC
  BtcTabBar.tsx                        ← NEW, ~55 LOC
  BtcChartPanel.tsx                    ← NEW, ~115 LOC
```

Target page shell after: **~130 LOC** (mirrors backtest's 268 LOC orchestration shell; BTC is
lighter because data logic moves entirely to hooks).

### Hook responsibilities

**`components/crypto/hooks/useBtcCandles.ts`** (~160 LOC)
Owns: `fetchCoinGeckoCandlesClient` (currently module-scope helper, lines 76–103), the entire
`fetchCandles` useCallback (lines 185–317), `candleCacheRef`, `candlesRequestIdRef`,
`candlesAbortRef`, `restFallbackNote` state, `fetchError` state, `loading` state.
Inputs: none (ticker is always BTC, interval driven internally via `activeRange`).
Returns: `{ candles, loading, fetchError, restFallbackNote, fetchCandles }`.
Note: `coingeckoDaysParam` (lines 56–74) moves into this file as a private helper.

**`components/crypto/hooks/useBtcKlineWs.ts`** (~130 LOC)
Owns: `connectKlineWs` useCallback (lines 319–433), `klineWsRef`, `klineGenRef`,
`klineReconnectTimerRef`, `wsConnected` state.
Inputs: `{ activeRangeRef, onCandleUpdate }` where `onCandleUpdate` is a stable callback from the
page that calls `setCandles` (the only cross-hook dependency).
Returns: `{ wsConnected, connectKlineWs, disconnectKlineWs }`.
Note: `KRAKEN_WS_V2` and `KRAKEN_OHLC_INTERVAL_MIN` constants (lines 34–46) move into this file
as module-scope constants.

**`components/crypto/hooks/useBtcPriceWs.ts`** (~130 LOC)
Owns: `connectPriceWs` useCallback (lines 435–495), the REST quote fallback `useEffect` (lines
502–568), `priceWsRef`, `priceReconnectTimerRef`, `priceFromBinanceWsRef`, `lastWsMessageRef`,
`btcPrice` state.
Inputs: none.
Returns: `{ btcPrice, connectPriceWs }`.
Note: `COINBASE_WS` constant (line 33) moves into this file.

### New presentational components

**`components/crypto/BtcHeader.tsx`** (~65 LOC)
Accepts: `{ btcPrice, wsConnected }`.
Renders: the header `<div>` with the BTC icon, breadcrumb, title, source descriptor, LIVE/RECONNECTING
pill (lines 630–689 of current page.tsx). Internally computes `isUp = (btcPrice?.changePct24h ?? 0) >= 0`.
No state — purely presentational. `React.memo` appropriate.

**`components/crypto/BtcTabBar.tsx`** (~55 LOC)
Accepts: `{ activeTab, onTabChange, activeRange, onRangeChange }`.
Renders: the tab switcher ("Chart" / "Quant Lab") and the conditional timeframe range buttons (lines
692–712). The `TIMEFRAMES` constant (lines 48–51) moves into this file or into a shared constants
module.
No state. `React.memo` appropriate.

**`components/crypto/BtcChartPanel.tsx`** (~115 LOC)
Accepts: `{ candles, loading, fetchError, restFallbackNote, wsConnected, activeRange,
            indicatorConfig, onIndicatorsChange, activeIndicator, onIndicatorPresetChange,
            vis, onVisToggle, emaSelection, onEmaToggle }`.
Renders: the `xl:grid-cols-4` layout — chart area with `CryptoChartBoundary`/`KLineChart` (lines
715–799), preset buttons row, and `IndicatorPanel` sidebar.
`KLineChart` is already dynamically imported at module scope in the current page; that dynamic import
moves to BtcChartPanel.
`INDICATOR_PRESETS` constant (lines 52–54) moves into this file.
`React.memo` appropriate.

### Page shell after refactor (~130 LOC)

```tsx
// app/crypto/btc/page.tsx  — orchestration shell only
'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import BtcQuantLab from '@/components/crypto/BtcQuantLab'
import BtcHeader from '@/components/crypto/BtcHeader'
import BtcTabBar from '@/components/crypto/BtcTabBar'
import BtcChartPanel from '@/components/crypto/BtcChartPanel'
import { useBtcCandles } from '@/components/crypto/hooks/useBtcCandles'
import { useBtcKlineWs } from '@/components/crypto/hooks/useBtcKlineWs'
import { useBtcPriceWs } from '@/components/crypto/hooks/useBtcPriceWs'
import { buildIndicatorConfig } from '@/lib/chartEma'  // see D3-9 below
import { CHART_EMA_PERIODS, type ChartEmaKey } from '@/lib/chartEma'

// Module-scope singletons stay here — they are page-level concerns
const EMPTY_DARK_POOL_MARKERS: never[] = []
const EMPTY_NEWS_MARKERS: never[] = []

export default function BtcPage() {
  const [activeTab, setActiveTab] = useState<'chart' | 'quant'>('chart')
  const [activeRange, setActiveRange] = useState<string>('1d')
  const [activeIndicator, setActiveIndicator] = useState<string>('ema')
  const [emaSelection, setEmaSelection] = useState<Record<ChartEmaKey, boolean>>(...)
  const [vis, setVis] = useState<Record<VisKey, boolean>>(...)

  const activeRangeRef = useRef(activeRange)
  useEffect(() => { activeRangeRef.current = activeRange }, [activeRange])

  const { candles, loading, fetchError, restFallbackNote, fetchCandles } =
    useBtcCandles()

  const { wsConnected, connectKlineWs, disconnectKlineWs } =
    useBtcKlineWs({ activeRangeRef, onCandleUpdate: ... })

  const { btcPrice } = useBtcPriceWs()

  // Tab/range effect (was lines 585–614)
  useEffect(() => { ... }, [activeTab, activeRange, fetchCandles, connectKlineWs])

  // REST poll (was lines 607–614)
  useEffect(() => { ... }, [activeTab, fetchCandles])

  // Unmount cleanup
  useEffect(() => () => { ... }, [])

  const indicatorConfig = useMemo(() =>
    buildIndicatorConfig(activeIndicator, emaSelection, vis), [activeIndicator, emaSelection, vis])

  return (
    <div className="min-h-screen">
      <BtcHeader btcPrice={btcPrice} wsConnected={wsConnected} />
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <BtcTabBar activeTab={activeTab} onTabChange={setActiveTab}
          activeRange={activeRange} onRangeChange={setActiveRange} />
        {activeTab === 'chart' ? (
          <BtcChartPanel
            candles={candles} loading={loading} fetchError={fetchError}
            restFallbackNote={restFallbackNote} wsConnected={wsConnected}
            activeRange={activeRange} indicatorConfig={indicatorConfig}
            onIndicatorsChange={setVis} activeIndicator={activeIndicator}
            onIndicatorPresetChange={setActiveIndicator}
            vis={vis} onVisToggle={...} emaSelection={emaSelection} onEmaToggle={...}
          />
        ) : (
          <BtcQuantLab candles={candles} />
        )}
        {/* footer copy */}
      </div>
    </div>
  )
}
```

---

## D3-8 — `LlmTab` 20-prop drilling and no memo

### Reality vs inspection finding: PARTIALLY ALREADY DONE

**The inspection finding is stale on the "create useQuantLabLlm hook" half.**
`components/stock/quantlab/hooks/useQuantLabLlm.ts` (234 LOC) already exists and is already wired:
- `QuantLabPanel.tsx` (148 LOC) calls `useQuantLabLlm(ticker, sub)` at line 21.
- The hook returns all 26 fields/callbacks.
- The panel passes them via spread: `<LlmTab {...llm} />` at line 144.
- `LlmTabProps` (lines 9–36 of `LlmTab.tsx`) declares the full 26-field interface.

**Close Q-058-NEW for the "hook co-location" part.** The structural split is complete. The genuine
residual is two items:

### Residual 1 — 26-prop spread + no `React.memo`

The `<LlmTab {...llm} />` spread passes all 26 props. `QuantLabPanel` has a sibling
`useQuantLabFundamentals` hook; any `fundamentals` state change re-renders the panel, which
re-renders `LlmTab` unconditionally even though the LLM result is unchanged.

**Proposal:**

**Option A (minimal, preferred):** Add `React.memo` to `LlmTab`:
```tsx
// components/stock/quantlab/tabs/LlmTab.tsx — add at export
export const LlmTab = React.memo(function LlmTab(props: LlmTabProps) { ... })
```
All 26 props remain; `memo` gives referential-equality bailout. The `set*` functions returned by
`useQuantLabLlm` are wrapped in `useCallback` already (confirmed in `useQuantLabLlm.ts`) so
`memo` will be effective.

**Option B (interface cleanup):** Collapse the spread to a single `llm` prop:
```tsx
// LlmTab.tsx
export function LlmTab({ llm }: { llm: ReturnType<typeof useQuantLabLlm> }) { ... }

// QuantLabPanel.tsx
{sub === 'llm' && <LlmTab llm={llm} />}
```
This removes the `LlmTabProps` type and simplifies the interface to 1 prop. Risk: couples `LlmTab`'s
type directly to the hook's return signature. Minor win vs Option A.

**Recommendation: Option A** (memo) is the atomic change with zero API surface impact. Option B can
follow separately as a cleanup.

### Residual 2 — hook call placement (state-persistence constraint)

The hook currently lives at `QuantLabPanel` level (not inside `LlmTab`). This is correct and must
not change: `{sub === 'llm' && <LlmTab .../>}` unmounts `LlmTab` on every tab switch, but
`llmResult`/`llmHasRun` survive in the panel-level hook state. Moving the hook call into `LlmTab`
would reset the analysis result each time the user switches away from the LLM sub-tab — a UX
regression.

### Props classification (for reference)

| Category | Props | Count |
|----------|-------|-------|
| Hook-internal (state) | `llmResult`, `llmError`, `llmErrorCode`, `llmLoading`, `llmProvider`, `llmDeepModel`, `llmQuickModel`, `llmDebateRounds`, `llmRiskRounds`, `llmTradeDate`, `llmHasRun`, `llmApiKey`, `llmShowKey`, `llmHealthLoading`, `llmBackendHealth` | 15 |
| Hook-internal (stable callbacks) | `setLlmDeepModel`, `setLlmQuickModel`, `setLlmDebateRounds`, `setLlmRiskRounds`, `setLlmTradeDate`, `setLlmShowKey`, `checkLlmBackendHealth`, `runLlmAnalysis`, `fetchLlmLatest`, `handleApiKeyChange`, `handleProviderChange` | 11 |
| External inputs to hook | `ticker` (string), `sub` (QuantLabSubTab) | 2 |

All 26 are already hook-internal. The hook receives only 2 external inputs. **The prop-drilling
concern is a documentation gap, not a code gap.** The remaining actionable item is `React.memo`.

---

## D3-9 — `buildVisFromIndicatorPreset` duplication — extraction blueprint

### Reality vs inspection finding: the duplication is real but the sites differ

The inspection correctly identifies that the preset-to-vis logic is duplicated. However:

- **Stock page site** (`app/stock/[ticker]/page.tsx` lines 82–96): a named function
  `buildVisFromIndicatorPreset(preset)`. Uses `tradingDefaultEmaFlags()` from `lib/chartEma.ts`
  for the `'ema'` branch. Forces `volSma: true` on all branches except `'all'`.

- **BTC page site** (`app/crypto/btc/page.tsx` lines 166–183): NOT a function named
  `buildVisFromIndicatorPreset`. It is the `indicatorConfig` useMemo body using local helpers
  `allEmaRecord(true/false)` and referencing the mutable `emaSelection` state (not
  `tradingDefaultEmaFlags()`). The inspection's line reference "btc:91–96" is incorrect —
  those lines are inside `fetchCoinGeckoCandlesClient`.

- **Key semantic difference:** the `'ema'` branch differs between the two:
  - Stock: `emaTrading = tradingDefaultEmaFlags()` → ema9, ema20, ema50, ema200 on (TradingView defaults)
  - BTC: `emaSelection` → the user's current EMA toggle state (reactive, not a static default)

The BTC version is stateful (ema preset respects user's individual EMA toggles), while the stock
version resets to the static TradingView defaults on each preset click. They are not semantically
identical.

### Proposed shared extraction

**Location:** `lib/chartEma.ts` (not in any open PR; the natural home for EMA-grid helpers)

**Exact signature:**

```ts
// lib/chartEma.ts

export type VisRecord = Record<ChartEmaKey | 'vwap' | 'bollingerBands' | 'fibonacci' | 'volSma', boolean>

/**
 * Build a vis record from an indicator preset name.
 *
 * @param preset     - 'ema' | 'vwap' | 'bb' | 'fib' | 'all'
 * @param emaBase    - Record<ChartEmaKey, boolean> to use for the 'ema' branch.
 *                     Pass `tradingDefaultEmaFlags()` for the static stock default;
 *                     pass the user's current `emaSelection` state for the BTC reactive variant.
 * @param volSma     - Whether volSma should be included. Default: true.
 *                     BTC passes false (its 'all' branch omits volSma).
 */
export function buildIndicatorConfig(
  preset: string,
  emaBase: Record<ChartEmaKey, boolean>,
  volSma = true,
): VisRecord {
  const on = allEmaOn()   // already exported from lib/chartEma.ts
  const off = allEmaOff() // already exported from lib/chartEma.ts
  if (preset === 'all')   return { ...on,  vwap: true,  bollingerBands: true,  fibonacci: true,  volSma }
  if (preset === 'ema')   return { ...emaBase, vwap: false, bollingerBands: false, fibonacci: false, volSma }
  if (preset === 'vwap')  return { ...off, vwap: true,  bollingerBands: false, fibonacci: false, volSma }
  if (preset === 'bb')    return { ...off, vwap: false, bollingerBands: true,  fibonacci: false, volSma }
  /* fib */               return { ...off, vwap: false, bollingerBands: false, fibonacci: true,  volSma }
}
```

`allEmaOn()` and `allEmaOff()` are already exported from `lib/chartEma.ts` (lines 79–90 of that
file). No new dependencies introduced.

**Call-site adaptations:**

Stock page (`app/stock/[ticker]/page.tsx`):
```ts
// Replace inline buildVisFromIndicatorPreset with:
import { buildIndicatorConfig, tradingDefaultEmaFlags } from '@/lib/chartEma'

// In useState initializer and indicatorConfig useMemo:
const [vis, setVis] = useState<VisRecord>(() => buildIndicatorConfig('ema', tradingDefaultEmaFlags()))
const indicatorConfig = useMemo(
  () => buildIndicatorConfig(activeIndicator, tradingDefaultEmaFlags()),
  [activeIndicator]
)
// vis individual toggles overlay: { ...indicatorConfig, ...vis }  (as today)
```

BTC page (`app/crypto/btc/page.tsx`):
```ts
import { buildIndicatorConfig } from '@/lib/chartEma'

const indicatorConfig = useMemo(
  () => ({ ...buildIndicatorConfig(activeIndicator, emaSelection), ...vis }),
  [activeIndicator, emaSelection, vis]
)
```
The `volSma` parameter defaults to `true` for both call sites, which matches existing behavior in
both pages.

**Note on the `'all'` branch discrepancy:** stock page's `'all'` branch includes
`volSma: true` (from the function) while BTC's current `'all'` branch at line 171 does NOT include
`volSma` in the base (it only sets `vwap/bollingerBands/fibonacci`). The `...vis` overlay in BTC
provides `volSma` from the initial state (`volSma: true` at line 137). The shared function with
`volSma = true` default preserves this correctly via the overlay.

---

## Sequencing — step-by-step execution order

All steps execute AFTER `fix/a11y-sweep` (PR #32) merges and the branch rebases.

```
Step 1: Add buildIndicatorConfig to lib/chartEma.ts  (D3-9)
  Files touched: lib/chartEma.ts (NOT in any open PR)
  Test: tsc --noEmit must pass; lib/chartEma.ts has no dedicated test file
        (chartEma logic is tested indirectly via KLineChart/stock page tests).

Step 2: Wire stock page to buildIndicatorConfig  (D3-9, call-site 1)
  Files touched: app/stock/[ticker]/page.tsx
  Remove: inline buildVisFromIndicatorPreset function (lines 82–96)
  Replace: two call sites (useState initializer line 79, useMemo line 101, preset-button
           onClick line 395)
  Test: tsc --noEmit; QuantLabPanel.test.tsx snapshot must still pass (stock page renders
        QuantLabPanel as a child — snapshot guards the DOM shape).

Step 3: Wire btc page to buildIndicatorConfig  (D3-9, call-site 2 / integrated with D3-2 below)

Step 4: Extract useBtcCandles hook  (D3-2)
  New file: components/crypto/hooks/useBtcCandles.ts
  Move: coingeckoDaysParam, fetchCoinGeckoCandlesClient (lines 56–103),
        fetchCandles useCallback (185–317), associated state + refs.
  Test: tsc --noEmit. No existing test for btc page (confirmed: no btc page test file in __tests__/).
        Manually verify: btc page still loads candles in preview.

Step 5: Extract useBtcKlineWs hook  (D3-2)
  New file: components/crypto/hooks/useBtcKlineWs.ts
  Move: connectKlineWs useCallback (lines 319–433), KRAKEN_WS_V2, KRAKEN_OHLC_INTERVAL_MIN constants.
  Test: tsc --noEmit.

Step 6: Extract useBtcPriceWs hook  (D3-2)
  New file: components/crypto/hooks/useBtcPriceWs.ts
  Move: connectPriceWs useCallback (lines 435–495), REST quote fallback useEffect (502–568),
        COINBASE_WS constant, btcPrice state, associated refs.
  Test: tsc --noEmit.

Step 7: Extract BtcHeader presentational component  (D3-2)
  New file: components/crypto/BtcHeader.tsx
  Move: header div (lines 630–689), isUp derivation.
  Test: tsc --noEmit.

Step 8: Extract BtcTabBar presentational component  (D3-2)
  New file: components/crypto/BtcTabBar.tsx
  Move: tab/range control block (lines 692–712), TIMEFRAMES constant (lines 48–51).
  Test: tsc --noEmit.

Step 9: Extract BtcChartPanel presentational component  (D3-2)
  New file: components/crypto/BtcChartPanel.tsx
  Move: chart grid (lines 715–799), INDICATOR_PRESETS constant (lines 52–54),
        KLineChart dynamic import (lines 15–22).
  Wire: buildIndicatorConfig call (D3-9, step 3).
  Test: tsc --noEmit.

Step 10: Reduce page.tsx to orchestration shell  (D3-2)
  Target: ~130 LOC (all data logic in hooks, UI in children).
  Test: tsc --noEmit + node node_modules/vitest/dist/cli.js run (must show 979 pass / 17 skip).

Step 11: Add React.memo to LlmTab  (D3-8)
  File: components/stock/quantlab/tabs/LlmTab.tsx
  Change: wrap the function export with React.memo.
  Test: tsc --noEmit + vitest; QuantLabPanel.test.tsx snapshots must still pass (snapshot pins
        the loading/error DOM shape, which memo does not alter).
```

---

## Verification protocol

All verification from the worktree root after creating the symlink per guardrail #4:

```bash
ln -s "/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment/node_modules" node_modules
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/dist/cli.js run
```

**Expected results (unchanged from baseline):**
- tsc: 0 errors
- vitest: 979 passed / 17 skipped

**Snapshot tests that guard this work:**
- `__tests__/components/stock/QuantLabPanel.test.tsx` — 3 tests, pins loading/error/ticker-chip DOM.
  The snapshot MUST NOT change. `React.memo` does not alter DOM output, so this passes without
  snapshot update.
- `__tests__/components/backtest/BacktestPage.test.tsx` — 2+ tests, unrelated but must stay green.

**No btc page snapshot test exists.** There is no `__tests__/components/crypto/` or
`__tests__/app/crypto/` directory. After the refactor, a new
`__tests__/components/crypto/BtcPage.test.tsx` should be added (post-refactor task, outside this
blueprint's scope) to provide the same loading/error DOM-pinning coverage as the QuantLabPanel and
BacktestPage tests.

---

## Tracker reconciliation

| Finding | Status |
|---------|--------|
| D3-2 | NEW — blueprint provided above |
| D3-8 (hook co-location) | PARTIALLY ALREADY DONE — `useQuantLabLlm` exists and is wired (234 LOC). Residual: `React.memo` on `LlmTab`. Document that Q-008 "QuantLabPanel decomposed" closure should be extended to note the LLM hook is co-located. |
| D3-9 | NEW — blueprint provided above; inspection line reference "btc:91–96" is INCORRECT (those lines are in `fetchCoinGeckoCandlesClient`); corrected locations documented here. The two sites are semantically non-identical (static defaults vs reactive emaSelection state) — requires parameterized signature, not copy-paste extraction. |
| Q-008 | The QuantLabPanel decomposition was confirmed done (148 LOC shell, 6 sub-tabs in `components/stock/quantlab/tabs/`, 2 hooks in `components/stock/quantlab/hooks/`). Close Q-008. |
| Q-019 | BacktestPage decomposition confirmed done (268 LOC shell + components/backtest/*). Close Q-019 per inspection note. |

---

## Collision summary

- `lib/chartEma.ts` — NOT in any open PR. Safe to edit for D3-9 step 1.
- `app/stock/[ticker]/page.tsx` — locked on PR #32. Edit only after #32 merges.
- `app/crypto/btc/page.tsx` — locked on PR #32. Edit only after #32 merges.
- `components/stock/quantlab/tabs/LlmTab.tsx` — locked on PR #32. Edit only after #32 merges.
- New files under `components/crypto/hooks/` — no collision with any open PR.

