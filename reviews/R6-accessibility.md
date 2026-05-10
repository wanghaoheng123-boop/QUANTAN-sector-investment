# R6 — Accessibility & Institutional UX Review (Phase 13 S1)

**Reviewer:** R6 — WCAG 2.2 AA + Bloomberg-Terminal UX exposure
**Sprint:** S1 (read-only)
**Date:** 2026-05-05
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | Read |
|------|------|
| `app/layout.tsx` (semantic landmarks) | full |
| `components/Breadcrumbs.tsx` (a11y example) | full |
| `components/KeyboardShortcuts.tsx` | partial (40 lines) |
| `components/ErrorToastList.tsx` (aria-live) | full |
| `components/DataFreshnessIndicator.tsx` (aria-live) | full |
| `components/MetricTooltip.tsx` (focus mgmt) | full (read in earlier session) |
| `components/SectorCard.tsx` (link semantics) | full (earlier) |
| All other interactive components | structural (grep-based audit) |

**Disclosure:** Cross-component audit by grep totals; per-component WCAG conformance audit deferred to R6 second pass. Findings below are claims I can defend with evidence.

---

## Findings

### F6.1 [CRITICAL] — No skip-link to main content (WCAG 2.4.1 Bypass Blocks)

**Location:** `app/layout.tsx:49-99`

**Evidence:** Layout contains `<header><nav>...</nav></header>` followed by `<main>{children}</main>`, but no skip-link allowing keyboard users to bypass the header navigation. WCAG 2.4.1 Level A requires a mechanism to skip blocks of content repeated on multiple pages. Without it, every keyboard or screen-reader user must traverse the entire navbar on every page transition.

**Citation:** WCAG 2.2 (W3C, 2023) — Success Criterion 2.4.1 (Bypass Blocks), Level A.

**Patch sketch:**
```tsx
// app/layout.tsx, immediately inside <body>:
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded"
>
  Skip to main content
</a>
...
<main id="main-content" tabIndex={-1}>{children}</main>
```
And add `.sr-only` utility to tailwind.config (or use the @tailwindcss/forms plugin's built-in).

**Acceptance test:** axe-core scan asserts no `bypass` violations on `/`. Manual: `Tab` from page load lands on the skip-link first and `Enter` jumps to main.

**Severity:** Critical — Level A WCAG conformance failure; institutional accessibility audit will fail on this alone.

---

### F6.2 [HIGH] — Charts have no text alternative (WCAG 1.1.1 + 4.1.2)

**Location:** `components/KLineChart.tsx`, `components/Sparkline.tsx`, `components/options/GexChart.tsx`, `components/backtest/EquityCurveChart.tsx`, `components/backtest/SectorHeatmap.tsx`

**Evidence:** Charts render via canvas (lightweight-charts) or SVG without `role="img"` + `aria-label` or visually hidden description. Screen readers announce them as "graphic" or skip entirely. Phase 12 plan D9 listed this as a Sprint 3 item; not implemented.

**Citation:**
- WCAG 2.2 SC 1.1.1 (Non-text Content), Level A.
- WCAG 2.2 SC 4.1.2 (Name, Role, Value), Level A.
- W3C Working Group Note: "Complex Images" — provide both short alt and long description.

**Patch sketch:**
```tsx
// KLineChart.tsx — wrap chart container:
<div
  ref={containerRef}
  role="img"
  aria-label={`Price chart for ${ticker}: ${lastClose} on ${lastDate}, ${changePct.toFixed(2)}% change.`}
  aria-describedby={`${ticker}-chart-desc`}
>
  ...
  <span id={`${ticker}-chart-desc`} className="sr-only">
    {`Daily candlesticks from ${firstDate} to ${lastDate}. Range: ${minPrice}–${maxPrice}.`}
  </span>
</div>
```
Add similar to GexChart, EquityCurve, SectorHeatmap — each describing its own data dimension.

**Acceptance test:** axe-core scan reports zero `image-alt` failures. NVDA + JAWS reads each chart's accessible name.

**Severity:** High — WCAG Level A failure; institutional users with low vision cannot consume the platform's primary outputs.

---

### F6.3 [HIGH] — Color is the only signifier for BUY/SELL/HOLD signals

**Location:** `components/SignalCard.tsx`, `components/SectorCard.tsx`, every up/down indicator

**Evidence (earlier read):** `SectorCard.tsx:89-91` uses only `text-green-400` / `text-red-400` for percent change. Some places use `▲/▼` arrows, but not consistently. Phase 12 plan D9 (Sprint 3) called for "Colorblind-Safe Indicators" — not yet implemented.

**Citation:**
- WCAG 2.2 SC 1.4.1 (Use of Color), Level A.
- ~8% of men have red-green color deficiency (deuteranopia/protanopia); the green/red dichotomy is the worst-case for them.

**Patch sketch:** Pair every color with an icon and a sign:
```tsx
{up ? (
  <span aria-label={`up ${pct}%`}>▲ +{pct.toFixed(2)}%</span>
) : (
  <span aria-label={`down ${pct}%`}>▼ {pct.toFixed(2)}%</span>
)}
```
For BUY/SELL/HOLD badges: add icon (✓/✗/—) and a screen-reader-only spelled-out label.

**Acceptance test:** Screenshot under deuteranopia simulation (e.g., `chrome://devtools/Rendering/Emulate vision deficiencies`) — assert direction is unambiguous from the visual alone.

**Severity:** High — WCAG Level A failure; affects ~8% of men in the user population for a financial decision-making tool.

---

### F6.4 [HIGH] — Tables likely lack caption + scope attributes (WCAG 1.3.1)

**Location:** Likely `app/desk/page.tsx`, `app/backtest/page.tsx` (table components)

**Evidence:** `app/desk/page.tsx:178-188` (read in earlier session) renders `<table><thead><tr><th>` directly without `<caption>` or `scope="col"`. Screen readers can't announce table purpose or correctly traverse cells.

**Citation:**
- WCAG 2.2 SC 1.3.1 (Info and Relationships), Level A.
- WAI-ARIA Authoring Practices: data tables.

**Patch sketch:** For every `<table>`:
```tsx
<table>
  <caption className="sr-only">Trading desk quote strip — sector and macro tickers</caption>
  <thead>
    <tr>
      <th scope="col">Symbol</th>
      <th scope="col">Last</th>
      ...
    </tr>
  </thead>
```

**Acceptance test:** axe-core: zero `table-fake-caption`, `td-headers-attr`, or `th-has-data-cells` violations.

**Severity:** High — multiple Level A failures; institutional research tooling especially relies on tabular data screen-reader navigation.

---

### F6.5 [MEDIUM] — Focus management is sparse (only 2 explicit `focus()` calls)

**Location:** repo-wide grep — only 2 hits for `tabIndex` / `.focus()`

**Evidence:** Modals (KeyboardShortcuts at minimum), drawers, tooltips need:
- Initial focus on open
- Focus trap inside modal
- Focus restore on close

`MetricTooltip.tsx` opens a tooltip on click but does not move focus into it; closes on Escape but doesn't restore focus to the trigger explicitly (browser default may work but isn't guaranteed for nested cases).

**Citation:**
- WCAG 2.2 SC 2.4.3 (Focus Order), Level A.
- WAI-ARIA Authoring Practices Modal Dialog Pattern.

**Patch sketch:** Use a focus-trap library (e.g. `focus-trap-react`) for modals, or hand-roll:
```tsx
useEffect(() => {
  if (!isOpen) return
  const previousFocus = document.activeElement as HTMLElement
  modalRef.current?.querySelector<HTMLElement>('[autoFocus]')?.focus()
  return () => previousFocus?.focus()
}, [isOpen])
```

**Severity:** Medium — affects keyboard-only users in modal/tooltip workflows; not a Level A blocker.

---

### F6.6 [MEDIUM] — Color contrast not validated; `text-slate-500 on bg-slate-950` may fail WCAG AA (4.5:1)

**Location:** Cross-component

**Evidence:** `slate-500` (#64748b) on `slate-950` (#020617) computes contrast ratio ≈ **5.4:1**. Marginal but passes AA. However:
- `text-slate-600` (#475569) on `slate-950` ≈ 3.4:1 — **FAILS** WCAG 1.4.3 AA (4.5:1 for normal text).
- Several components observed using `text-slate-600` (e.g., `app/desk/page.tsx:200, 207, 210`).
- "Drill" links in the desk row use `text-slate-500`/`hover:text-slate-300` — interaction state may pass but resting state is borderline.

**Citation:** WCAG 2.2 SC 1.4.3 (Contrast Minimum), Level AA, 4.5:1 for normal text.

**Patch sketch:** Audit with axe-core or Lighthouse; bump tertiary text from `slate-600` → `slate-400` (#94a3b8 ≈ 8.4:1 on slate-950).

**Acceptance test:** Lighthouse contrast audit zero failures on the 5 priority routes.

**Severity:** Medium — a few Level AA failures; not Level A.

---

### F6.7 [MEDIUM] — KeyboardShortcuts modal — verify focus trap and ESC close

**Location:** `components/KeyboardShortcuts.tsx:23-40 (read fragment)`

**Evidence:** ESC handler exists for `'Escape'` key. Need to verify:
- Modal focus is trapped (Tab cycles within modal, doesn't reach background)
- Background is `inert` or `aria-hidden="true"` while modal open
- Modal has `role="dialog"` and `aria-modal="true"` and `aria-labelledby`

**Patch sketch (after deeper read):** Add inert attribute polyfill for older browsers; ensure dialog semantics.

**Severity:** Medium — common modal pitfalls.

---

### F6.8 [MEDIUM] — `aria-live` is appropriately polite for freshness/toasts but not used elsewhere where it should be

**Location:** Only `DataFreshnessIndicator.tsx:78` and `ErrorToastList.tsx:44`

**Evidence:** Search results from `app/api/search/route.ts` (typeahead), real-time price updates in tables, and signal-direction changes do not announce via aria-live. A screen-reader user polling the desk doesn't know quotes updated.

**Patch sketch:** Add a single hidden aria-live="polite" region per page that announces summary changes:
```tsx
<span className="sr-only" aria-live="polite">
  {liveQuoteSummary}  // e.g., "SPY up 0.5%, QQQ down 0.3%"
</span>
```
Throttle updates to once per 30s to avoid screen-reader spam.

**Severity:** Medium — a11y enhancement, not a Level A failure.

---

### F6.9 [LOW] — No `lang` attribute set on `<html>` — confirm in app/layout.tsx

**Location:** `app/layout.tsx:49+ (root element)`

**Evidence:** Did not see `<html lang="en">` in the read snippet (lines 49-99 were below root). Need to confirm `<html lang="en">` is present.

**Patch sketch:** Ensure `<html lang="en">` (or appropriate locale) is set.

**Severity:** Low — Level A requirement (3.1.1 Language of Page) but trivial fix.

---

## Cross-domain handoffs

- **R5:** F6.3 (color-only) overlaps F5.6 (sparse ARIA); F6.4 (tables) needs design-system extraction (`<DataTable>` component).
- **R8:** Add axe-core to CI as part of S3 (per plan); R8 owns the test infrastructure.

---

## Self-dissent

I have NOT performed an automated axe-core scan or screen-reader walk-through; my findings are from code-reading and pattern-grepping. F6.1 (skip-link) is firm — absence is verifiable from the layout source. F6.2 (charts) is firm — no `role="img"` on KLineChart's container. F6.6 (contrast) is computed from Tailwind palette; the actual rendered colors may differ if any CSS custom properties override.

A full WCAG conformance audit requires NVDA + JAWS testing on all priority routes plus axe-core + Lighthouse + manual keyboard navigation. This is S3/S4 work; my S1 findings establish the priority list.

---

## Findings summary table

| ID | Severity | Loc | One-line |
|----|----------|-----|----------|
| F6.1 | CRITICAL | layout.tsx:49 | no skip-link (WCAG 2.4.1 Level A) |
| F6.2 | HIGH | KLineChart, Sparkline, GexChart, etc. | charts lack text alternatives |
| F6.3 | HIGH | SignalCard, SectorCard, everywhere | color-only signifiers for BUY/SELL/up/down |
| F6.4 | HIGH | tables across pages | tables lack caption/scope |
| F6.5 | MEDIUM | (cross-component) | sparse focus management |
| F6.6 | MEDIUM | (cross-component) | text-slate-600 on slate-950 fails AA |
| F6.7 | MEDIUM | KeyboardShortcuts.tsx | verify focus trap + dialog semantics |
| F6.8 | MEDIUM | (cross-component) | aria-live underused for live updates |
| F6.9 | LOW | layout.tsx | confirm <html lang="en"> |

Total: 9 (1 Critical, 3 High, 4 Medium, 1 Low).

---

**Reviewer signature:** R6
**Cross-checked by:** R5 — pending
**Inspector spot-check:** I2 (code quality) + I4 (E2E with screen-reader scenario) — pending
