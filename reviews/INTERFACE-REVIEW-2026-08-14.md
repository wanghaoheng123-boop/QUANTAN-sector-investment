# QUANTAN — Interface Review & Reform, 2026-08-14

**Branch:** `claude/error-review-interface-91806b`
**Directive (owner):** *"find out error, room for improvements, detail design and interface
reform to make it easier to use and make sure that there is no error or bug."*
**Method:** empirical first (production runtime errors → local browser measurement), then
static reading, with every prior finding diffed against `reviews/findings-ledger.csv` so
already-closed rows are not re-flagged.

---

## 0. Baseline — the codebase is green before this wave

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean (exit 0) |
| `vitest run` (full) | **1354 passed**, 17 skipped, 105 files + 1 skipped file |
| skipped file | `__tests__/data/warehouse.test.ts` — DB-gated (`describeIfDb`), not a failure |
| jsdom component suite | **6 files / 26 tests pass locally** |
| Vercel runtime errors, prod, 7 d | **1 group** (see C-1); zero 4xx/5xx request logs |
| All 16 page routes, local smoke | **200** on every one |

Two environment notes, corrected from earlier assumptions:

* **`npm run dev` is not broken on this worktree.** First boot simply takes **5+ minutes**
  on the Google Drive FUSE mount before the port binds. The `.claude/launch.json` in this
  worktree now invokes `node node_modules/next/dist/bin/next dev` directly (the documented
  `@`-in-path workaround). `.claude/` is gitignored, so this is a local dev aid and is
  **not** part of the diff.
* **The memory note "jsdom tests are CI-only on this machine" is stale** — the component
  suite runs locally and is used to verify the fixes below.

---

## 1. Findings

Severity reflects user impact, not effort.

### C-1 — CRITICAL (owner action, env only, no code change) — `NEXTAUTH_SECRET` unset in production

The only live error in production. Self-reported by the app on `/api/auth/[...nextauth]`:

> `NEXTAUTH_SECRET is not configured. Generated a random per-instance secret.
> Sessions will be invalidated on cold starts.`

**First seen 2026-07-28, still firing 2026-08-12** (last deployment
`dpl_6ChCoZ6W1YjLXhJ846Q9HncYxNNU`). Every signed-in user is silently logged out whenever a
function instance cold-starts. This was surfaced in the 2026-08-02 wave and remains open.

**Fix (owner):** set `NEXTAUTH_SECRET` in the Vercel project environment. Nothing in this
repo can fix it — it is an environment variable, not code.

---

### F-IA-1 — HIGH — three shipped pages are unreachable from the interface

A full-repo link graph over `app/` and `components/` (`href=`, `router.push`, template
literals) finds **zero inbound links** to `/portfolio`. Its two children are linked *only*
from it, so they inherit the orphaning:

| Route | Inbound links | Reachable by clicking? |
|---|---|---|
| `/portfolio` | **0** | **No** — URL entry only |
| `/portfolio/factor-attribution` | 1 (`app/portfolio/page.tsx:55`) | **No** — parent is orphaned |
| `/risk/scenarios` | 1 (`app/portfolio/page.tsx:29`) | **No** — parent is orphaned |
| `/backtest` | 1 (`app/page.tsx:300`, mid-page card) | Only by scrolling the home page |

All four return **200** and render correctly. They are finished features with no way in.

Corroborating evidence that `/backtest` is *meant* to be first-class:
`components/KeyboardShortcuts.tsx:19` binds `g b` → `/backtest`, and the shortcut overlay
lists it under **Navigation** — while the global nav does not.

The global nav (`app/layout.tsx:72–104`) exposes 7 of 16 routes: Markets, Desk,
Commodities, Crypto, Heatmap, 200MA, Briefs.

---

### F-UI-1 — HIGH — the sticky header eats a quarter of every mobile screen

Measured at 375×812 (`getBoundingClientRect` on `<header>`):

| | Before |
|---|---|
| Header height | **211 px** |
| Viewport | 812 px |
| Share of viewport | **26 %**, `position: sticky` — on every page, permanently |

The header is a single `flex-wrap` row, so at mobile width it collapses into five stacked
bands: logo → nav line 1 (Markets/Desk/Commodities/Crypto/Heatmap) → nav line 2
(200MA + NEW badge/Briefs) → search field → search helper text → Sign in + market status.
There is no menu, no drawer, no collapse. Adding the four missing destinations from F-IA-1
to this layout would make it materially worse.

**Target for the fix: ≤ 96 px at 375×812.**

---

### F-A11Y-1 — HIGH — 136 WCAG 1.4.3 contrast failures on the home page, from essentially one token

Scripted audit in the live page (WCAG 2.x relative-luminance formula, resolved against the
nearest opaque ancestor background, visible leaf text nodes only, AA thresholds 4.5:1 /
3:1 for large text). Home page alone:

| Foreground | Background | Size | Ratio | Needs | Count |
|---|---|---|---|---|---|
| `slate-500` `rgb(100,116,139)` | `slate-800` | 10 px | **3.07:1** | 4.5 | 44 |
| `slate-500` | `slate-900` | 10 px | 3.31:1 | 4.5 | 22 |
| `slate-500` | page bg `#08080f` | 10 px | **4.19:1** | 4.5 | 13 |
| `slate-500` | page bg | 12 px | 4.19:1 | 4.5 | 12 |
| `slate-500` | `slate-800` | 12 px | 3.07:1 | 4.5 | 7 |
| `slate-700` `rgb(51,65,85)` | `slate-900` | 16 px | 1.6:1 | 4.5 | 22 |
| **white on `amber-600`** `rgb(217,119,6)` | — | 12–14 px | **3.19:1** | 4.5 | 3 |
| others | | | | | 13 |
| | | | | **total** | **136** |

Two things this makes precise, which the 2026-07-10 axe run (`NEW-C-5`, 34 occurrences,
deferred as an owner design decision) did not:

1. **105 of 136 failures are one token — `text-slate-500`** — used 259 times across 53
   files. It is the app's default "secondary text" colour and it fails at every size the
   app uses it at.
2. **The primary call-to-action fails.** White on `amber-600` is 3.19:1 — that is the
   "View Backtest" button, the single most prominent action on the landing page.

`NEW-C-5` was gated on an owner design decision. This directive *is* that decision, so it
is closed in this wave.

The `slate-700` row (22 failures) is the `|` and `•` glyphs in the price marquee. Those are
decorative separators; the correct fix is `aria-hidden`, not a colour bump — handled under
F-A11Y-2, not by the token swap.

---

### F-A11Y-2 — MEDIUM — no `prefers-reduced-motion` support anywhere, and the marquee cannot be paused without a mouse

`grep -rn "prefers-reduced-motion" app components tailwind.config.js` → **zero matches**.

`app/globals.css` defines four infinite animations that run unconditionally:

| Animation | Duration | Notes |
|---|---|---|
| `.animate-ticker` | 50 s, `infinite` | full-width horizontal marquee |
| `.skeleton-shimmer` | 1.5 s, `infinite` | loading states |
| `.animate-pulse-subtle` | 2 s, `infinite` | confidence numerals |
| `.animate-confidence-ring` | 1.2 s | one-shot |

Two distinct defects:

* **WCAG 2.2.2 Pause, Stop, Hide (Level A).** The marquee starts automatically, moves for
  50 s, and repeats forever. Its only pause mechanism is `:hover` /
  `onMouseEnter` (`components/PriceTicker.tsx:30–31`, `app/globals.css:94–97`) — which does
  not exist for keyboard or touch users. On mobile, the moving band is unpauseable.
* **WCAG 2.3.3 / vestibular safety.** No `@media (prefers-reduced-motion: reduce)` block,
  so users who have asked their OS to reduce motion still get all four animations.

**Additionally** (`components/PriceTicker.tsx:25`): `const doubled = [...items, ...items]`
duplicates the entire quote list to make the marquee loop seamlessly. Neither copy is
`aria-hidden`, so assistive tech reads **all 22 entries — every price twice**. Confirmed in
the page-text extraction: the full XLK…XLP sequence appears twice back to back.

---

### F-UX-1 — LOW — the shortcut overlay is undiscoverable, and two "NEW" badges have no expiry

* `KeyboardShortcuts` is reachable only by pressing `?`. There is no button, hint, or
  footer link anywhere that says so — the affordance is invisible until you already know it.
* Hardcoded `NEW` badges with no date or expiry at `app/layout.tsx:95` (200MA) and
  `app/page.tsx:292` (Backtest Dashboard). 200MA shipped in May; the badge has been "new"
  for roughly three months.

---

### Observations recorded, not fixed

* **13 concurrent `EventSource` connections on the dashboard.** `app/page.tsx:106–110`
  subscribes to 11 sector ETFs + SPY + QQQ; `hooks/useLiveQuotes.ts` caps at
  `MAX_LIVE_STREAMS = 20`. Locally the LIVE badge reads **"6/13 streams"** — exactly the
  HTTP/1.1 six-connections-per-origin browser limit; the other seven starve and, worse,
  every other request to the origin queues behind them. **Production is HTTP/2**
  (verified: `curl -sI https://quantan.vercel.app/` → `HTTP/2 200`), where they multiplex,
  so this is **not** a production bug. It is worth knowing that (a) local development is
  degraded by it, (b) any network that downgrades to HTTP/1.1 silently half-works, and
  (c) each dashboard viewer holds 13 concurrent Vercel Function invocations open for up to
  270 s. The hook's own docstring already proposes the fix — a multiplexed `/api/stream`
  variant. Deferred: it is a wire-format change, not an interface change.
* **Exposing "6/13 streams" in the LIVE badge** leaks an implementation detail into a
  user-facing freshness indicator. Left alone here because the fix is a copy decision.
* **Sector-card jargon** — `Prior:` / `Last:` / `prior→last` / `Move scale`. Reworking this
  copy changes how displayed numbers are labelled, which is owner-gated by precedent
  (`F-4`, `Q25-1`). Proposal only.

---

## 2. What was fixed in this wave

See §3 for the verification numbers.

| ID | Fix | Files |
|---|---|---|
| F-IA-1 | Navigation restructured; all 16 routes reachable | `app/layout.tsx`, `components/SiteNav.tsx` (new), `components/Breadcrumbs.tsx` |
| F-UI-1 | Single-row header + mobile drawer | same |
| F-A11Y-1 | `text-slate-500` → `text-slate-400`; CTA contrast | 53 files, `app/page.tsx` |
| F-A11Y-2 | `prefers-reduced-motion` block; keyboard-operable marquee pause; `aria-hidden` on the duplicated half | `app/globals.css`, `components/PriceTicker.tsx` |
| F-UX-1 | Visible shortcut affordance; new routes registered in the overlay | `components/KeyboardShortcuts.tsx`, `components/SiteNav.tsx` |

**Deliberately not changed** — displayed numbers, metric labels, and the
survivorship / simulated-data disclosures. Precedent in `workspace/SESSION_STATE.json` is
that re-baselining or relabelling published figures requires owner sign-off.

---

## 3. Design of the navigation reform

The old header was a single `flex-wrap` row that treated 7 links, a search box,
an auth control and a market-status pill as peers. It had two failure modes at
once: it could not grow (adding the missing destinations would have made the
mobile header taller still) and it did not say where you were (no `aria-current`
anywhere, and no visual active state).

**`components/SiteNav.tsx` is now the single source of truth for destinations.**
Three groups, eleven entries, each with a one-line hint:

| Group | Destinations |
|---|---|
| *(primary, always inline on desktop)* | Markets, Desk, **Backtest**, Briefs |
| Research | Heatmap, 200MA Deviation, Commodities, Crypto |
| Portfolio | **Portfolio**, **Factor Attribution**, **Risk Scenarios** |

Bold = previously unreachable or near-unreachable.

Rendering rules:

* **≥ lg** — the four primary links inline, then `Research` and `Portfolio` as
  **disclosure** menus. Disclosure, not `role="menu"`: the links stay in the
  natural tab order, so there is no roving-tabindex state machine to get wrong.
  Each trigger carries `aria-expanded` + `aria-controls`; Escape closes it and
  returns focus to the trigger; outside pointer-down and route changes close it.
* **< lg** — one hamburger opening a modal drawer listing all eleven, grouped
  under headings, with the hints visible. It reuses `useDialogA11y` (the
  existing focus-trap / scroll-lock / return-focus SSOT), so it inherits the
  same dialog contract as the shortcuts overlay.
* **Everywhere** — the active destination gets `aria-current="page"` plus a
  visual state. The old nav communicated location nowhere.

Supporting changes so the reform is coherent rather than cosmetic:

* **Search hint moved out of the layout flow.** It was a permanent in-flow `<p>`
  adding ~26 px to the header on every page at every breakpoint. It now appears
  only while the field is focused with nothing better to show, absolutely
  positioned so it can never change the header's height.
* **Breadcrumbs** gained branches for the three newly-reachable routes. Without
  them those pages would render only the bare "Home" crumb, which `Breadcrumbs`
  suppresses entirely — a nav link to a page with no trail back.
* **Keyboard parity** — `g p` → Portfolio and `g r` → Risk Scenarios join the
  existing `g d` / `g b`, and both are listed in the overlay.
* **The shortcuts overlay is discoverable** — a `?` button in the header opens
  it, and the mobile drawer's footer says the key exists.

---

## 4. Verification

### Gates

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | clean | **clean** |
| `vitest run` | 1354 passed / 105 files | **1376 passed / 106 files** (+22 new) |
| Skipped | 17 (DB-gated) | 17 (DB-gated, unchanged) |
| `next build` (production) | — | **succeeds** — all 16 pages + 27 API routes compiled |

Two DOM-shape snapshots in `__tests__/components/stock/QuantLabPanel.test.tsx`
failed on the token swap — `text-slate-500` → `text-slate-400`, exactly the
intended change and nothing else. They were regenerated (`-u`); the diff is 4
lines and contains only that substitution. The snapshot did its job.

### F-UI-1 — header height, measured at 375×812

| | Before | After | Target |
|---|---|---|---|
| Header height | **211 px** | **57 px** | ≤ 96 px |
| Share of viewport | 26 % | **7 %** | — |

One row at every breakpoint. At 1280×800 the row has 101 px of slack; at
1024×800 (where the desktop nav first appears) it still has 19 px and
`document.scrollWidth - clientWidth === 0`, i.e. no horizontal overflow.

### F-A11Y-1 — contrast, re-measured with the same script

| Route | Before | After |
|---|---|---|
| `/` | **136** | **0** |
| `/backtest` | not measured before | **0** |
| `/desk` | not measured before | **0** |
| `/portfolio` | not measured before | **0** |
| `/stock/AAPL` | not measured before | **0** |

**A caveat on how that zero was reached.** The first pass measured `/` on the
dev server before the live quote feed had populated, and reported 0. Re-running
it against the **production build with data on screen** surfaced 5 more that
the empty page could not have contained:

| Element | Ratio | Fix |
|---|---|---|
| `ALL` / `BUY` / `SELL` / `HOLD` filter chip, selected (white on `amber-600`) | 3.19:1 | `slate-950` on `amber-500` → 9.39:1 |
| "Run LLM Analysis" button, same defect | 3.19:1 | same |
| `--color-down` `#ff4757` at 10–12 px on `slate-800` (15 hardcoded literals) | 4.38:1 | `#ff6b7a` → 5.32:1 |
| `industrials` sector colour `#6366f1` | 4.47:1 | `#7c7ff5` → 5.90:1 |

The lesson is worth recording: **audit a data-driven page after its data
loads.** An empty state has fewer elements and flatters the score. The numbers
above are post-fix, from the production build, with live quotes rendered.

Both colour changes are tokens — the `#ff4757` → `#ff6b7a` swap keeps "down"
unmistakable next to `--color-up` `#00d084`, and the legend swatch on
`/sector/[slug]` uses the same literal so it stays consistent. No displayed
value changes.

Honest accounting of where the 136 went:

* **~113** were fixed by recolouring: `text-slate-500` → `text-slate-400`
  (259 occurrences, 53 files; 3.07:1 → 5.71:1 on `slate-800`, 4.19:1 → 7.79:1
  on the page background), plus three `slate-700` blocks that were real content
  rather than decoration (the indicator OFF-state label at 1.72:1 and two 10 px
  crypto disclaimer blocks at 1.93:1 — a disclosure nobody can read is not a
  disclosure).
* **~23** were separator glyphs (`|`, `•`, `/`) that are now `aria-hidden`.
  WCAG 1.4.3 exempts purely decorative text, and hiding a separator from
  assistive tech is the correct fix rather than recolouring it — but this is a
  scope change, not a contrast improvement, and is counted as such here.
* The disabled "Skip for now" link keeps its low-contrast disabled styling;
  disabled controls are exempt from 1.4.3.

The global swap was verified safe before it ran: the only light background in
the app is the Google sign-in button (`bg-white text-slate-900`), which contains
no `text-slate-500`. Everything else renders on dark, where slate-500 →
slate-400 is strictly monotonic.

Primary CTA: white on `amber-600` **3.19:1** → `slate-950` on `amber-500`
**9.39:1**. The skip-link had the same defect and got the same fix.

### F-A11Y-2 — motion

`@media (prefers-reduced-motion: reduce)` confirmed live in the served
stylesheet via `document.styleSheets`, matching five selector groups:
one-shot entrances, `.animate-ticker`/`.animate-pulse-subtle`,
`.skeleton-shimmer`, Tailwind's infinite utilities, and a blanket
transition-duration cap.

The marquee now has a real focusable pause button with `aria-pressed`, and the
duplicated half carries `aria-hidden` so it is announced once, not twice.

### The signed-in header — the case every screenshot missed

Every measurement above is the **signed-out** state, where `SafeAuth` renders an
81 px "Sign in" link. The old header absorbed a wider authenticated block by
wrapping; the new single row cannot, and `h-14` would hide the overflow by
clipping it. So the authenticated block was simulated at its widest (avatar +
truncated account name + Sign out) and measured at every breakpoint:

| Viewport | Signed-in auth block | Search absorbs | Header | Horizontal overflow |
|---|---|---|---|---|
| 640 | 117 px | 144 px | 57 px | **0** |
| 768 | 117 px | 192 px | 57 px | **0** |
| 1024 | 109 px | 224 → 209 px | 57 px | **0** |
| 1280 (+ breadcrumbs + account name) | 203 px | 288 → 151 px | 57 px | **0** |

Two changes make that work: the search wrapper is `min-w-0 shrink` rather than
`shrink-0`, so it yields space before anything overflows, and the account name
is gated to `xl` (it is redundant next to the avatar until there is room).

### F-IA-1 — reachability

* Mobile drawer, asserted live in the browser: opens, `aria-expanded="true"`,
  `body.style.overflow === "hidden"` (scroll lock), initial focus on
  *Close navigation*, and **all 11 destinations present** including
  `/portfolio`, `/portfolio/factor-attribution` and `/risk/scenarios`.
* Desktop `Portfolio` disclosure: opens with the 3 links, Escape closes it,
  `aria-expanded` returns to `"false"` and focus returns to the trigger.
* Breadcrumb on `/portfolio` now renders `Home / Portfolio`. Before the fix it
  produced only the bare "Home" crumb, which the component suppresses.

**The regression guard is filesystem-driven, not a hand-maintained list.**
`__tests__/components/SiteNav.test.tsx` walks `app/**/page.tsx` and asserts
every static top-level route has a nav entry, with an explicit exemption set
(`/` is the logo, `/auth/signin` is reached from the Sign in control, `/crypto`
is a server redirect). A page that ships without a way in now fails CI instead
of quietly becoming an orphan.

### Not verifiable from here

* **The 2026-08-02 static-analysis trap does not apply here**, and it was checked
  rather than assumed: the `viewport` and `metadata` exports in `app/layout.tsx`
  are byte-identical and no `app/api/**/route.ts` was touched. A full local
  `next build` was run anyway and succeeds. The Vercel preview build is still the
  final word for any future change to those exports.
* **Stryker is unaffected — verified, not assumed.** `stryker.conf.mjs` mutates
  exactly `lib/quant/**`, `lib/backtest/**` and `lib/options/**`. Nothing under
  `app/` or `components/` is in scope, and the only `lib/` file this wave
  touches is `lib/sectors.ts` (one colour literal), which is outside all three
  globs. The thin backtest (+1.02) and options (+1.25) margins are untouched.
* **C-1 cannot be fixed from the repo.** It is a Vercel environment variable.

---

## 5. What the owner needs to decide

1. **Set `NEXTAUTH_SECRET` in the Vercel project environment** (C-1). Open since
   2026-07-28; every cold start logs users out. Nothing else in this report is
   as consequential.
2. **Merge and deploy.** This wave is committed to the branch only — the
   directive did not include the merge instruction previous waves carried, so
   nothing has been pushed, opened as a PR, or promoted.
3. **Copy and labelling, deferred by policy** — the sector-card jargon
   (`Prior:` / `Last:` / `Move scale`), the `6/13 streams` implementation detail
   in the LIVE badge, and the two `NEW` badges that have been "new" since May.
   These change how published figures are labelled, which precedent puts behind
   owner sign-off.
4. **Optional, larger:** a multiplexed `/api/stream` endpoint would replace 13
   concurrent EventSource connections per dashboard viewer with one. Not a
   production bug on HTTP/2, but it is 13 concurrent function invocations per
   viewer and it makes local development materially slower.
