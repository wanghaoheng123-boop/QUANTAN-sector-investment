# Q-119 — Router prefetch: measured on both sides, and kept

**Date:** 2026-09-14 · **Decision:** KEEP `<Link>` prefetch at its default. Do **not** set `prefetch={false}`.

This is a trade-off record, not an optimization note. The ticket asked for both
sides to be measured before anything was disabled, and both sides were.

---

## 1. The ticket's own premise was wrong by ~4x

`Q-119` opened with "roughly 157 kB of it is Next's `<Link>` prefetch", citing
page chunks of 51.6 + 25.6 + 40.8 kB. **Those are on-disk decoded sizes.**
Over the wire, the same three chunks are 14.2 / 9.6 / 12.7 kB:

| chunk | on disk | over the wire | ratio |
|---|---|---|---|
| `app/backtest/page-*.js` | 51.6 kB | 14.2 kB | 3.63x |
| `app/desk/page-*.js` | 25.6 kB | 9.6 kB | 2.67x |
| `app/page-*.js` (home) | 40.8 kB | 12.7 kB | 3.21x |

The correction moves the finding **against** the ticket that raised it, which is
the direction that needs checking hardest. It is recorded because it is correct.

## 2. Cost — measured per surface, and it is not uniform

Over-the-wire bytes for *other* routes' page chunks + their RSC payloads,
`next start`, cold browser context per sample:

| surface | foreign page chunks | RSC payloads | **prefetch total** |
|---|---|---|---|
| `/` | 23.7 kB | 8.4 kB | **32.1 kB** |
| `/desk` | 26.9 kB | 7.2 kB | **34.1 kB** |
| `/backtest` | 22.3 kB | 9.4 kB | **31.7 kB** |
| `/stock/AAPL` | 36.5 kB | 10.8 kB | **47.3 kB** |
| `/sector/technology` | 36.5 kB | 12.0 kB | **48.4 kB** |

It varies 32 → 48 kB by surface, so "assume it is uniform" would have been wrong.
On production, landing on `/stock/AAPL` with all viewport prefetch suppressed
measured **286.5 kB** against **351 kB** with it on — a **~64 kB** whole-surface
prefetch cost, the larger figure because it also includes Breadcrumbs' links,
not only the nav's four.

## 3. Benefit — measured on production, over the real network

Same deployed build for both arms. The only difference is whether viewport
prefetch was allowed to complete before the click. Landing `/stock/AAPL`, n=4,
median, click → destination content rendered:

| destination | prefetch on | prefetch suppressed | penalty |
|---|---|---|---|
| `/desk` | **18 ms** | 72.5 ms | +54.5 ms (4.0x) |
| `/backtest` | **12.5 ms** | 72.5 ms | +60 ms (5.8x) |

**Verdict: keep it.** ~64 kB buys a 4–6x faster navigation on the workflow the
product's own guide tells users to follow — scan the desk, drill into a name.
64 kB is 18% of the landing transfer; the platform ships single payloads 11x
larger (see §5). Disabling prefetch would trade the cheap thing for the good thing.

### What the benefit measurement does NOT establish
- Measured from a desktop connection to Vercel's `sin1` edge. The penalty is a
  round-trip plus ~24 kB, so it **grows with RTT** — on a high-latency mobile
  link it would be materially worse than 54–60 ms, not better. The direction is
  safe for the decision; the magnitude is a floor, not a ceiling.
- The suppressed arm disables `IntersectionObserver` wholesale, so it removes
  every viewport prefetch on the page, not only the nav's.
- Clicks are synthetic and dispatch no hover, so no hover-prefetch mitigation is
  included. A mouse user may do better; a touch user will not.

### An instrument failure worth recording
The first three attempts at the benefit number were measured on localhost with
CDP network throttling and **every one of them was wrong**:
1. `Network.clearBrowserCache` did not isolate samples — the second run onward
   transferred **0 kB over 32 requests**, all from the immutable HTTP cache.
   Fixed with a fresh `Target.createBrowserContext` per sample.
2. The hard-navigation arm counted `Page.loadEventFired` without checking the
   loader, so it latched the initial `about:blank` load and reported 161 ms for
   a fetch that cannot beat one 562 ms RTT. Fixed by keying on the post-click
   navigation's own `loaderId`.
3. Even once both were fixed, CDP throttling **did not apply** to small
   follow-up requests on an already-warm localhost connection: the landing load
   honoured the throttle at 2578 ms, but the click-time fetch of a chunk that
   had provably never been requested came back in 26 ms. Localhost cannot answer
   this question, so the answer was taken from production instead.

**Each failure made prefetch look unnecessary** — the flattering direction for
"just set `prefetch={false}`". Three instruments agreeing on a convenient answer
was the signal to distrust them, not the decision.

## 4. What DID change: two raw `<a>` tags in global chrome

`app/layout.tsx:68` (the brand logo, in the header on all 16 pages) and
`app/not-found.tsx:9` were raw `<a href="/">`, which performs a full **document**
navigation: the entire shell is re-downloaded, re-parsed and re-hydrated, and
all client state — SWR caches, the open SSE quote stream, scroll position — is
discarded. Production, landing on `/stock/AAPL`, clicking through to `/`, n=4:

| element | median | requests re-issued |
|---|---|---|
| nav `<Link href="/">` | **23 ms** | 0 |
| raw `<a href="/">` (brand) | **190.5 ms** | 16 |

A **167 ms** penalty with a *warm* cache — so it is pure re-parse and re-hydrate
at zero bytes downloaded; cold, it is worse. Both are now `<Link>`. Verified
behaviourally on the built output, not by reading the markup: `<Link>` renders an
`<a>`, so the served HTML is identical either way. Clicking the brand now
produces **0 document navigations** and commits in 39 ms locally.

`__tests__/architecture/internal-links-are-soft.test.ts` guards it. Watched it
fail on the committed tree (`app/layout.tsx -> /`) and go green on revert.

## 5. Ranking the three page-weight costs honestly

Measured over the wire, production:

| # | cost | size | ticket |
|---|---|---|---|
| 1 | `/api/backtest` on every `/backtest` load | **742.6 kB** brotli (2.4 MB decoded) | `Q-121` |
| 2 | Service-worker precache of the whole build, first visit | **547.4 kB** | `Q-120` |
| 3 | Router prefetch, per surface | **32–48 kB** | `Q-119` (this) |

**The ticket that was opened is the smallest of the three by more than an order
of magnitude.** Both larger findings were discovered by measuring this one, and
both are filed separately rather than folded in — different mechanisms, and
`Q-120` touches installability, which is a product decision.

`Q-121` carries its own calibration note: `next start` does not compress that
route, so a local measurement reports the full 2.4 MB and overstates it 3.3x.
