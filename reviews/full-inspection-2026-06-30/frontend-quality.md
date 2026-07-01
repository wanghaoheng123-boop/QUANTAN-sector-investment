# Frontend Quality — Review Agent C (FRONTEND)

Scope: app/, components/, hooks/. Baseline main @ 2f2507a. READ-ONLY verification pass.
Supervisor ratifies; findings cite file:line, marked LIVE/DORMANT.

---

## (1) Fix-verification checklist

### KL-4 (PR #75) — async chart init .catch + role=alert fallback
- `hooks/useKLineChart.ts:582-585` — `init().catch((err) => { if (mounted) setInitError(true); console.error(...) })`. PRESENT-IN-BYTES.
- `initError` state declared `:245`, returned `:178/:844`. PRESENT.
- (Component-side role=alert fallback verified below in KLineChart.tsx pass.)

### KL-6 (PR #74) — EMA data loop gated by isEmaLineVisible
- `hooks/useKLineChart.ts:736-741` — data-update loop: `for (const p of CHART_EMA_PERIODS) { ... if (!isEmaLineVisible(indicatorsProp, p)) continue; series.setData(...) }`. PRESENT-IN-BYTES. Hidden EMA series are NOT recomputed/pushed per WS tick. Confirmed.

### Fib + Vol-SMA REAL (not no-ops)
- Fib: `useKLineChart.ts:252-318` `renderFib` callback draws real price lines via `series.createPriceLine({ price: low + (high-low)*r, ... })` at `:308`. Gated by `fibVisibleRef` (`:721 fibVisibleRef.current = indicatorsProp.fibonacci === true`), re-anchored on visible-range change `:386-388`. REAL.
- Vol-SMA: `volSmaRef` created `:410-419`, returned `:226/:852`, data pushed only when visible `:716-718` (`indicatorsProp.volSma !== false`). REAL + visibility-gated.

### KL-4 component fallback (KLineChart.tsx)
- `components/KLineChart.tsx:424-431` — `{initError && (<div role="alert" ...>Chart failed to load...</div>)}`. PRESENT-IN-BYTES. Rendered as SIBLING of the chart container (not child), correct.
- Failure aria-label: `:405-409` container `role="img"` aria-label switches to `...failed to load. Try refreshing...` when `initError`. PRESENT.

### F2-1 (PR #76) — CryptoChartBoundary wrap
- `app/crypto/btc/page.tsx:102-116` — `<CryptoChartBoundary title="BTC chart crashed"><BtcChartPanel ... /></CryptoChartBoundary>`. PRESENT-IN-BYTES. Quant tab also wrapped `:118-120`.

### F3 (PR #77) — abort guards
- `components/SectorRotationPanel.tsx:48-60` — `let cancelled = false` … `.then(d => { if (cancelled) return; ... })` … cleanup `return () => { cancelled = true }`. PRESENT-IN-BYTES.
- `components/crypto/BtcQuantLab.tsx:105-153` — `mountedRef` re-armed in effect body `:110`, post-await `if (!mountedRef.current) return` `:119/:140`, finally-gated `:132/:153`. PRESENT-IN-BYTES.

### F4 (PR #78) — keyboard-operable sort + aria-pressed timeframe
- `components/backtest/InstrumentTable.tsx:101-107` — real `<button type="button" onClick={() => toggleSort(col.key)}>`. `aria-sort` on `<th>` `:94`. `<caption className="sr-only">` `:87`. PRESENT-IN-BYTES.
- `components/KLineChart.tsx:320` — timeframe `<button ... aria-pressed={selectedTimeframe === tf} aria-label={`Timeframe ${tf}`}>`. PRESENT-IN-BYTES.
- NOTE (charter false-positive check): `InstrumentTable.SortIcon` is declared at MODULE scope (`InstrumentTable.tsx:23`) — NOT a re-created/remounted nested component. Confirms charter note; NOT a finding.

---

## (2) Known F5 / F6 / KL item verdicts

- **KL-5 LOW** (`hooks/useKLineChart.ts`) — `showRSI` consumed in the mount effect (deps `[]`, line `:622`), so a runtime flip of `showRSI` would NOT re-create the RSI/MACD/ATR sub-charts. VERDICT: **still-real / CONFIRMED LATENT**. All 3 callers pass `showRSI` as a STATIC bare-prop literal (= `true`), never bound to state: `app/sector/[slug]/page.tsx:502`, `app/stock/[ticker]/page.tsx:463`, `components/crypto/BtcChartPanel.tsx:100`. No live trigger. DORMANT. (`showRSI` IS in the data-effect deps `:840`, so data refreshes; only sub-chart *creation* is non-reactive — matches ledger.)

- **F6.7 MEDIUM** (`components/KeyboardShortcuts.tsx`) — "verify focus trap and dialog semantics". VERDICT: **addressed/superseded**. Modal has `role="dialog"` + `aria-modal="true"` + `aria-labelledby` (`KeyboardShortcuts.tsx:133-135`), portal to body (`:129`), and the full WAI-ARIA APG contract (initial focus, real Tab/Shift+Tab focus-trap, body scroll-lock, return-focus) is implemented in the `useDialogA11y` SSOT hook (`hooks/useDialogA11y.ts:50-101`) — source-verified, not comment-trusted. Escape-to-close `:48-51` + click-outside `:132`. Recommend ledger close.

- **F5.9 LOW** (cited `app/backtest/page.tsx:665`) — `Record<string, unknown>` losing types. VERDICT: **still-real but RELOCATED** (line stale). Page decomposed to 299 LOC (Q-054); the untyped live-signal blob moved to `components/backtest/LiveSignalsPanel.tsx:21` (`useState<Record<string, unknown> | null>`), `:62` (`instruments as Array<Record<string, unknown>>`), `:254` (row map). LOW/quality, LIVE (signals tab). Update ledger file:line.

- **F5.10 LOW** (cited `app/backtest/page.tsx:39-50`) — local formatters duplicate lib/format.ts. VERDICT: **stale-superseded / addressed**. `app/backtest/page.tsx:8` now `import { formatFreshness } from '@/lib/format'`; no local fmt* helpers remain in the page (only a one-off inline `new Date().toLocaleString()` `:152`, not a duplicated formatter). Recommend ledger close.

- **F5.5 MEDIUM** (`components/**/*.tsx`) — "37 inline styles; no design tokens". VERDICT: **misclassified at MEDIUM → downgrade LOW**. Down from 37 to 27 inline `style={{...}}` across 18 files. Sampled occurrences are overwhelmingly DATA-DRIVEN values that cannot be Tailwind classes: `color: regime.color`, `color: sectorColor`, `left: pos(buy/sell/fair/price)`, runtime `height`, `backgroundColor: zoneColor + '20'`. A minority are static (e.g. `app/backtest/page.tsx:135` `background: 'linear-gradient(...)'`, `height: 280`). The dynamic ones are correct React; only the handful of static literals are token candidates. Not a MEDIUM.

- **F5.6 MEDIUM** (cross-component) — "32 ARIA attrs sparse coverage". VERDICT: **materially improved; residual quality item**. ARIA coverage broadened substantially since the wave: 38 `aria-label`, 19 `aria-labelledby`, 10 `aria-pressed`, 6 `aria-controls`, 5 `aria-expanded`, 3 `aria-selected`, 2 `aria-sort` across components/+app/. Several specific gaps remain (see NEW-C-1 tab-bar). Downgrade to LOW/ongoing; not a discrete MEDIUM.

- **F5.7 MEDIUM** (cross-component) — "dark-card pattern not extracted (DRY)". VERDICT: **unverified-residual / quality-only**. Not source-disproved this pass; pure DRY/maintainability, no correctness or a11y impact. LOW at most. (Did not exhaustively trace; flagging as low-priority quality.)

- **F6.5 MEDIUM** (cross-component) — "sparse focus management". VERDICT: **materially improved**. The modal focus contract (trap/scroll-lock/return-focus) is now a real SSOT hook (`hooks/useDialogA11y.ts`, used by KeyboardShortcuts + LlmDeployAssistant). Visible focus rings present (e.g. `focus:ring-2 focus:ring-blue-400`). Residual: non-modal focus order not exhaustively audited. Downgrade.

- **F6.8 MEDIUM** (cross-component) — "aria-live underused for live updates". VERDICT: **partially-real / still-open**. 5 `aria-live` + 22 status/alert landmarks now exist, but they sit on DataFreshnessIndicator, ChartErrorBoundary, ErrorToastList, app/page.tsx — NOT on the primary live-PRICE numeric surfaces. The KLineChart live price legend (`components/KLineChart.tsx:366-371`) and crosshair OHLCV readout (`:336-358`) have NO aria-live, so streaming price changes are not announced. The original intent (announce live numeric updates) is only partly met. Keep open at LOW (announcing every tick can be noisy — debounced/polite region recommended, not raw aria-live=assertive).

---

## (3) NEW findings (fresh surface, changed since 2026-06-10)

- **NEW-C-1 LOW a11y** — `app/backtest/page.tsx:260-269` — LIVE. The backtest tab bar (overview/instruments/trades/signals/analysis) is plain `<button>`s; the active tab is conveyed VISUALLY ONLY (`bg-slate-700 text-white`) with no `role="tab"`/`aria-selected` (and the wrapper has no `role="tablist"`). Same a11y class F4 just fixed for the KLineChart timeframe buttons. Notable inconsistency: the sibling `components/crypto/BtcTabBar.tsx:26-40` already does this correctly (`role="tablist"`/`role="tab"`/`aria-selected`) — the pattern exists in-repo but wasn't applied here. Overlaps open F5.6 (ARIA coverage); reporting as the concrete instance, not double-counting.

- **NEW-C-2 LOW a11y** — `components/crypto/BtcChartPanel.tsx:118-131` — LIVE. The indicator-preset toggle group (EMA/VWAP/BB/Fib/All) conveys the active preset visually only (`bg-slate-600 text-white`); buttons lack `aria-pressed`. Same class as NEW-C-1. (The adjacent timeframe buttons in BtcTabBar DO have `aria-pressed`, confirming the gap is a local omission.)

- **NEW-C-3 INFO (not a defect)** — `components/crypto/BtcChartPanel.tsx:91` + `app/crypto/btc/page.tsx:102` — LIVE. Double `<CryptoChartBoundary>` nesting: the page wraps `<BtcChartPanel>` in a boundary (F2-1 fix), and BtcChartPanel ALSO wraps `<KLineChart>` in its own boundary. Harmless (inner catches first; outer is dead-but-safe), but redundant. No action required; noting so a future reader doesn't "fix" one and lose coverage. NOT a finding.

- **NEW-C-4 LOW effect-race** — `app/stock/[ticker]/page.tsx:138-152` (boot fetch) called from effect `:188-190` — LIVE-but-narrow. `fetchQuote()` is the boot-only REST quote fetch; unlike the page's chart fetch (`:157` AbortController) and dark-pool/options fetches (`:220/:244` cancelled-flag), it has NO abort/mounted guard. Its `.then` calls `setQuote`/`setQuoteError` unconditionally (`:147-151`), so unmounting during the ~1-2s REST window (fast navigate-away before SSE connects) updates state on a torn-down component. Impact is defense-in-depth / consistency only: this repo is React 19 (`package.json` `react: ^19.2.7`; pages import the `use` hook) where setState-after-unmount is a SILENT no-op — the old dev console warning was removed in React 18, so nothing is observable here. Same race class as F3 (PR #77), which shipped guards for exactly this pattern elsewhere — proving the team treats it as worth guarding. Inconsistency: every OTHER fetch on this page is already guarded. (The sibling `app/sector/[slug]/page.tsx` price fetch `:146-160` IS guarded with `controller.signal.aborted`, so this is a stock-page-only omission.)

---

## Summary

Recent fixes (6): ALL PRESENT-IN-BYTES, source-verified (none comment-trusted). No regressions.
Known items: KL-5 still-latent/DORMANT (callers static); F6.7 + F5.10 addressed (recommend close); F5.9 still-real but relocated (update file:line); F5.5/F5.6/F5.7/F6.5 materially improved → downgrade to LOW/quality; F6.8 partially-real (live-price surfaces still don't announce) → keep LOW.
NEW: NEW-C-1/2 LOW (a11y toggle/tab state), NEW-C-4 LOW (one unguarded boot-fetch — defense-in-depth only; React 19 makes the stale setState a silent no-op, no observable warning), NEW-C-3 INFO (redundant-but-safe double boundary). No P0/P1. No new chart-honesty no-ops found — Fib/Vol-SMA/EMA all draw real series.

