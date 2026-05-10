# R5 — Frontend Architecture & Design System Review (Phase 13 S1)

**Reviewer:** R5 — Principal FE, design-system lead at fintech (Bloomberg/Robinhood/Plaid background)
**Sprint:** S1 (read-only)
**Date:** 2026-05-05
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | LOC | Read |
|------|-----|------|
| `components/stock/QuantLabPanel.tsx` | 1649 | structural (functions/exports) |
| `components/KLineChart.tsx` | 1011 | structural + indicator section detail |
| `app/backtest/page.tsx` | 934 | structural |
| `app/crypto/btc/page.tsx` | 814 | not read |
| `app/page.tsx` | 552 | not read |
| `app/ma-deviation/page.tsx` | 616 | not read |
| `components/crypto/BtcQuantLab.tsx` | 516 | not read |
| `components/IndicatorPanel.tsx` | — | structural |
| `components/SectorCard.tsx` | 161 | full (read in earlier session) |
| `hooks/useLivePrices.ts` | 122 | full |
| `hooks/useWatchlist.ts` | — | not read |
| `hooks/useErrorToast.ts` | — | structural |
| `tailwind.config.js` | — | not read |

**Disclosure (rule 5):** Component-level structural reads only. Full end-to-end reads of god components requires R5 second pass before S3 entry. Findings below are anchored to verified evidence (function indices from grep).

---

## Findings

### F5.1 [CRITICAL] — KLineChart re-implements indicator math inline; SSOT violation with `lib/quant/indicators.ts`

**Location:** `components/KLineChart.tsx:147-265`

**Evidence:** The component defines its own:
- `calcEMA` (line 147)
- `calcRSI` (line 160)
- `calcMACD` (line 182)
- `calcBollingerBands` (line 200)
- `calcVWAP` (line 216)
- `calcATR` (line 227)
- `calcVolumeSMA` (line 250)

Every one of these duplicates a canonical implementation in `lib/quant/indicators.ts`. This is the exact SSOT violation that the Phase 13 plan flags (rule: "one canonical EMA, RSI, formatter").

**Why critical:**
1. The chart's RSI/MACD/Bollinger may show **different numbers** than the signal panel that uses `lib/quant/indicators.ts`. A trader looking at the chart and the signal table side-by-side could see contradictions.
2. Phase 12 hotfixes (e.g., F2.1's Sortino n_d, F2.2's ADX Wilder smoothing) will propagate to the signal layer but **NOT to the chart** unless someone remembers to fix both.
3. Test coverage in `__tests__/quant/indicators.test.ts` does NOT cover these chart-side functions; they could drift undetected.

**Patch sketch:**
```ts
// components/KLineChart.tsx — replace lines 147-265 with:
import { emaFull, rsiArray, macdArray, bollingerArray, atrArray, vwapArray, smaArray }
  from '@/lib/quant/indicators'

// Adapter functions to convert to lightweight-charts format ({time, value}[]):
function emaToSeriesData(closes: number[], period: number, times: Time[]): LineData[] {
  const ema = emaFull(closes, period)
  return ema.map((v, i) => ({ time: times[i], value: v })).filter(d => Number.isFinite(d.value))
}
// ... similar for rsi/macd/bb/etc
```

**Acceptance test:** New `__tests__/components/KLineChart.indicators.test.ts` — feed identical close series to both `calcRSI` (current) and `rsiArray` (canonical); assert max diff = 0 on the same period. Currently, this test would PASS today, but the test exists to lock the contract. Then after the refactor, the same test confirms behavioral equivalence.

**Severity:** Critical — SSOT violation; potential silent indicator drift between chart and signal layer.

---

### F5.2 [HIGH] — `QuantLabPanel.tsx` is a 1362-line single function (god component)

**Location:** `components/stock/QuantLabPanel.tsx:173-1535` (one function)

**Evidence:** The default export is a single React function spanning lines 173 to 1535 — 1362 lines in a single component. Helper subcomponents `Metric` (line 1535), `Slider` (1544), `PriceRail` (1580) appear AFTER the main export.

**Why high:** 1362 lines means:
- Change-cost is high: any modification carries unknown side effects
- Re-render cost is high: a single useState update re-runs the entire 1362-line render
- Code review is impossible: no one can hold this much context
- Memoization is impossible to apply correctly: too many implicit dependencies

**Citation:**
- *Clean Code* (Martin, 2008) — function size guidelines (≤ 20 lines ideal, ≤ 100 acceptable, 1000+ is dysfunction).
- React docs (https://react.dev/learn/extracting-state-logic-into-a-reducer) — extract logic when components exceed 200 lines.

**Patch sketch (S3 work):** Decompose into:
- `QuantLabPanel.tsx` (≤ 200 LOC): top-level layout + tab state
- `QuantLabHeader.tsx`: ticker/price/freshness/watchlist controls
- `QuantLabIndicators.tsx`: technical/fundamental indicator tabs
- `QuantLabBacktest.tsx`: per-ticker backtest panel
- `QuantLabOptions.tsx`: options data tab (already has dedicated components from Phase 3)
- `QuantLabAgents.tsx`: trading-agents panel

Each ≤ 400 LOC per the plan's exit-gate rule for S3.

**Acceptance test:** Snapshot tests for representative props confirm decomposition produces identical DOM. File size: `wc -l components/stock/QuantLabPanel.tsx` ≤ 200 after refactor.

**Severity:** High — primary blocker for S3 architecture sprint.

---

### F5.3 [HIGH] — `app/backtest/page.tsx` is a 934-line page with 4 sub-components colocated

**Location:** `app/backtest/page.tsx:73 (BacktestPage), 415 (AnalysisTab), 556 (WalkForwardPanel), 664 (LiveSignalsPanel)`

**Evidence:** Single file containing `BacktestPage`, `AnalysisTab`, `WalkForwardPanel`, `LiveSignalsPanel`, plus `MetricCard` and 3 formatters. Each panel has its own state and effects. This is a "page-as-application" anti-pattern.

**Why high:**
- Each panel re-renders when ANY page state changes
- Code-splitting impossible (Next.js dynamic imports work at module boundaries)
- Tab-switching costs include re-mounting subtrees that should persist

**Patch sketch (S3 work):**
```
app/backtest/
├── page.tsx                    (≤ 200 LOC; layout + tab state)
├── _components/
│   ├── OverviewTab.tsx
│   ├── InstrumentsTab.tsx
│   ├── TradesTab.tsx
│   ├── SignalsTab.tsx
│   └── AnalysisTab.tsx
└── _hooks/
    ├── useBacktestData.ts
    └── useLiveSignals.ts
```
Each tab dynamically imported with `next/dynamic` for code-splitting.

**Acceptance test:** Lighthouse performance score on `/backtest` improves; bundle size for the route drops by ≥ 30%.

**Severity:** High — render-perf and bundle-size impact.

---

### F5.4 [HIGH] — Three `.catch(() => {})` silent failures still present (Phase 12 baseline = 4)

**Location:**
- `components/NewsFeed.tsx:63`
- `app/sector/[slug]/page.tsx:76`
- `app/sector/[slug]/page.tsx:128`
- `components/stock/QuantLabPanel.tsx:450`

**Evidence:** Phase 12 H5 introduced `useErrorToast` to replace silent catches. The replacement was incomplete; 4 instances remain.

**Citation:** Phase 12 plan H5 + Phase 13 plan rule 8 ("I2 auto-rejects any PR adding `.catch(() => {})`").

**Patch sketch:**
```ts
// Replace:
fetch(...).then(...).catch(() => {})

// With:
import { showToast } from '@/hooks/useErrorToast'
fetch(...).then(...).catch((e: Error) => showToast(`News feed failed: ${e.message}`, 'error'))
```

**Acceptance test:** `grep -rn "\.catch(\s*(\s*)\s*=>\s*{\s*}\s*)" components app hooks --include="*.tsx" --include="*.ts" | wc -l` returns 0.

**Severity:** High — direct invariant violation; silent failure mode.

---

### F5.5 [MEDIUM] — 37 inline-style usages without design tokens

**Location:** `components/**/*.tsx` (`grep "style={{" components | wc -l` = 37)

**Evidence:** 37 places use inline `style={{}}` to set colors, gradients, glows. Examples from earlier reads:
- `components/SectorCard.tsx:42-44` — gradient + boxShadow with hardcoded `rgba(14,14,22,0.97)` and `${sector.color}12` (low-opacity hex math)
- Hover-glow patterns repeated across multiple cards

**Why medium:** Without design tokens:
- Color/opacity changes require touching 37 files
- Dark/light mode would require rewriting all of them
- Lighthouse and a11y scans cannot validate computed contrasts

**Patch sketch (S3 work):**
1. Extract `lib/designTokens.ts` with sector colors, glow intensities, gradient stops
2. Custom Tailwind utilities for repeating patterns: `bg-card-gradient`, `shadow-card-glow-{color}`, `border-card`
3. Replace inline styles with utility classes; reserve `style={{}}` for truly dynamic values (e.g., `width: ${pct}%`)

**Acceptance test:** Inline-style count drops to ≤ 10 (truly dynamic). Lighthouse contrast audit passes on all cards.

**Severity:** Medium — design-system hygiene, not user-blocking.

---

### F5.6 [MEDIUM] — Aria-attribute coverage is 32 across all interactive components — sparse

**Location:** `components/**/*.tsx` + `app/**/*.tsx`

**Evidence:** `grep -rn "aria-label\|aria-describedby\|aria-live\|role=" components app | wc -l` = 32. With ~40 interactive components, this is < 1 aria attribute per interactive component on average. Bloomberg-Terminal-style institutional UX requires comprehensive ARIA.

**Citation:** WCAG 2.2 (W3C, 2023): 4.1.2 (Name, Role, Value) — every interactive element must have accessible name and role.

**Patch sketch:** R6 owns the detailed audit; R5 enforces structure (every `<button>` gets `aria-label` or visible text; every `<table>` gets caption + scope).

**Severity:** Medium — handoff to R6 for full a11y audit.

---

### F5.7 [MEDIUM] — Repeated container className pattern not extracted

**Location:** Across components

**Evidence:** Pattern `rounded-xl border border-slate-800 bg-slate-950/50` appears once in this exact form (per grep) but variations are everywhere:
- `rounded-2xl border border-slate-800/40 bg-slate-950/60`
- `rounded-lg border border-slate-700 bg-slate-900/70`
- `rounded-xl border border-slate-800 bg-slate-900/50`

This is the same visual concept ("dark card") with arbitrary opacity/border-tone variation. Should be a single `<Card>` component or `card-{variant}` Tailwind class.

**Patch sketch:**
```tsx
// components/ui/Card.tsx
export function Card({ tone = 'default', ...props }: CardProps) {
  const cls = {
    default: 'rounded-xl border border-slate-800 bg-slate-950/50',
    raised:  'rounded-2xl border border-slate-700 bg-slate-900/60 shadow-lg',
    inset:   'rounded-lg border border-slate-800/60 bg-slate-950/30',
  }[tone]
  return <div className={cls} {...props} />
}
```

**Severity:** Medium — DRY violation; visual inconsistency on the dashboard.

---

### F5.8 [MEDIUM] — `useLivePrices` deduping interval (2.5s) shorter than refresh interval (5s) — leaks fetches

**Location:** `hooks/useLivePrices.ts:67-68`

**Evidence:**
```ts
refreshInterval: 5_000,
dedupingInterval: 2_500,
```
With dedupingInterval < refreshInterval, two simultaneous mounts of the same hook with the same key dedupe correctly. But if a third mount happens 3 seconds later (just past the deduping window), it triggers an extra fetch — even though the 5s refresh would have served data 2 seconds later.

**Patch sketch:** `dedupingInterval: 5_000` (match or exceed refresh interval). For SWR, dedupingInterval should typically be ≥ refreshInterval to avoid request amplification.

**Severity:** Medium — performance.

---

### F5.9 [LOW] — TypeScript types for `any` in `app/backtest/page.tsx`

**Location:** `app/backtest/page.tsx:665` — `useState<Record<string, unknown> | null>` and similar untyped patterns.

**Evidence:** `LiveSignalsPanel` uses `Record<string, unknown>` for the API response — loses all type safety. The `/api/backtest/live` route's response shape is known; this should be typed.

**Patch sketch:** Define a `LiveSignalRow` interface in `lib/types/backtest.ts` and use it.

**Severity:** Low — typing hygiene.

---

### F5.10 [LOW] — Inline-defined helper functions in pages (DRY violation)

**Location:** `app/backtest/page.tsx:39-50` (fmtPct, fmtMoney, fmtRatio, MetricCard)

**Evidence:** Each page redefines its own formatters. `lib/format.ts` has `formatCompactNumber`, `formatCurrency`, `formatSignedNumber` — not used here.

**Patch sketch:** Replace local formatters with imports from `lib/format.ts` (per the Phase 13 plan's "REUSE" list).

**Severity:** Low — DRY violation; no functional bug.

---

## Cross-domain handoffs

- **R2:** F5.1 (KLineChart indicator duplication) directly intersects R2's SSOT findings.
- **R6 (a11y):** F5.6 — R6 will audit ARIA in detail.
- **R8 (testing):** F5.1 needs a behavioral-equivalence test before/after refactor.
- **C1:** F5.2, F5.3 are S3-blockers; need scope discussion.

---

## Self-dissent

I did not read `app/crypto/btc/page.tsx` (814 LOC), `app/ma-deviation/page.tsx` (616), `app/page.tsx` (552), or `BtcQuantLab.tsx` (516) end-to-end. They likely have similar god-component patterns; the F5.2 / F5.3 conclusions almost certainly apply but I cannot cite specific lines. R5 second pass required.

I claimed F5.1 is critical based on duplicate code. It is *possible* the chart's `calcEMA` etc. produce identical numbers to `lib/quant/indicators.ts:emaFull` — in which case it's "merely" a maintenance burden, not a correctness bug. F5.1's acceptance test (compare values) is essential to decide actual severity.

---

## Findings summary table

| ID | Severity | File:line | One-line |
|----|----------|-----------|----------|
| F5.1 | CRITICAL | KLineChart.tsx:147-265 | indicator math re-implemented inline; SSOT violation |
| F5.2 | HIGH | QuantLabPanel.tsx:173-1535 | 1362-line single function |
| F5.3 | HIGH | app/backtest/page.tsx:73, 415, 556, 664 | page-as-application; 4 panels colocated |
| F5.4 | HIGH | NewsFeed:63, sector:76,128, QuantLabPanel:450 | 4 silent .catch(() => {}) remain |
| F5.5 | MEDIUM | components/**/*.tsx | 37 inline styles; no design tokens |
| F5.6 | MEDIUM | (cross-component) | 32 ARIA attributes; coverage sparse |
| F5.7 | MEDIUM | (cross-component) | dark-card pattern variations not extracted |
| F5.8 | MEDIUM | useLivePrices.ts:67-68 | dedupingInterval < refreshInterval |
| F5.9 | LOW | backtest/page.tsx:665 | Record<string, unknown> losing type safety |
| F5.10 | LOW | backtest/page.tsx:39-50 | local formatters duplicate lib/format.ts |

Total: 10 (1 Critical, 3 High, 4 Medium, 2 Low).

**Open items for R5 second pass before S3:** crypto/btc, ma-deviation, app/page, BtcQuantLab, hooks/useWatchlist, tailwind.config.

---

**Reviewer signature:** R5
**Cross-checked by:** R2 (indicator duplication overlap) — pending
**Inspector spot-check:** I2 — pending
