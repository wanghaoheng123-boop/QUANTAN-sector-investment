# Q-107 — security-compliance remediation design

Agent: security-compliance. Territory: `app/api/bloomberg-bridge/`, `app/api/fundamentals/`,
`app/api/prices/`, `app/api/trading-agents/`, `lib/data/bloomberg/`, `middleware.ts`,
`components/ComplianceBanner.tsx`, `components/stock/quantlab/`,
`reviews/vendor-licence-register.json`.

Reserved ids: `Q107-S1` … `Q107-S19`. **No source file was edited. No write to
`reviews/findings-ledger.csv`.** Every diff below is a proposal for the lead.

Every claim is tagged **CONFIRMED** (I read the cited lines in this tree at
`873e654`) or **PLAUSIBLE** (inference I did not verify).

---

## 0. THE ORDERING CORRECTION — read this before implementing anything

The prior review recommended *"drop the vendor-identifying fields from PUBLIC
payloads"*. **Implemented on its own, that is concealment, not remediation, and I
recommend against it.** Three reasons, each citable:

1. **The licence exposure is the DATA, not the LABEL.** Stripping
   `dataSource:'bloomberg'` from `app/api/prices/route.ts` leaves every Bloomberg
   price in the response. Nothing about the redistribution changes; only the
   evidence of it disappears.
2. **It regresses I1.** CLAUDE.md: *"A PR must not regress an invariant."*
   `quotes[].dataSource` and `priceSources.{yahoo,bloomberg}` are the only
   provenance either payload carries. Deleting them moves I1 backwards on the
   two routes where it is currently least bad.
3. **On fundamentals it is provenance FALSIFICATION.** **CONFIRMED**
   `app/api/fundamentals/[ticker]/route.ts:131-132` sets `displayPrice` to the
   Bloomberg spot when the bridge answers, and `:134-144` feeds it into
   `buildFundamentalsPayload`, so DCF scenarios, bands, anchors, `signal` and
   `researchScore` are all Bloomberg-derived **with no label anywhere**. Delete
   `priceSources` and you ship a payload that *reads* as Yahoo-only while
   carrying terminal-derived numbers. That is strictly worse than the labelled
   status quo.

**Correct order: gate first, label second.** With the acknowledgement gate closed
(S2 below) there is no Bloomberg data in either payload, so the disclosure
question does not arise. In the enabled state the label must **stay** — the
operator has by then affirmed a licence, and I1 wants the provenance.

Do not substitute a euphemism ("institutional feed", "premium spot"). That
repeats the concealment error one level down and fools no reviewer.

**One genuinely useful consequence, and it makes three of the four fixes fall
out of one change:** with the gate closed, `dataSources.bloombergStatus` is
permanently `'not_configured'` and `priceSources.bloomberg` is permanently
`null`. Both stop being configuration oracles **by themselves**, with no field
removed.

---

## 1. `Q100-16` — `app/api/bloomberg-bridge/health/route.ts` · MEDIUM

### The smoke-test conflict dissolves — it was never real

**CONFIRMED.** `scripts/smoke-production.mjs:94-95` is exactly:

```js
const health = await getJson('/api/bloomberg-bridge/health')
passed &= ok(health.ok && health.status === 200, `GET bloomberg-bridge/health → ${health.status}`)
```

It asserts **only the HTTP status**. It never inspects the body. So an
unauthenticated **200 with a constant body** requires **no change to the smoke
script at all**. A 401/403 gate would break it; the design below does not use one.
`grep -rl bloomberg-bridge` over `__tests__ scripts app components lib` returns
only the smoke script, the route, and `scripts/bloomberg-bridge-example.py` —
there is no unit test to update either. **CONFIRMED.**

### Two defects the ledger row does not name

**`Q107-S1` (MEDIUM) — response SHAPE is itself the oracle, so trimming fields is
not a fix.** **CONFIRMED** at `:13-27`: the unconfigured branch returns
`{configured:false, message:"Set BLOOMBERG_BRIDGE_URL to enable…"}`; the
configured branch returns `{configured:true, reachable, latencyMs, error}`.
Remove `latencyMs` and `reachable` and a prober still separates the two states by
the presence of `message`, by key count, and by response length. **Acceptance
criterion for any diff here: the unauthenticated response must be byte-identical
in both configuration states.**

**`Q107-S2` (MEDIUM) — unauthenticated outbound-request amplifier.** **CONFIRMED**
`:21` calls `bridgeHealthCheck()`, which at
`lib/data/bloomberg/bridgeClient.ts:178` performs a live `fetch` to the
operator's bridge, carrying `X-Bridge-Secret` (`:177`). Rate limit is 30/min
**per IP** (`:8-9`), so anonymous callers can drive traffic at the operator's
Bloomberg-adjacent host from arbitrarily many source addresses. The fix must
**skip the outbound fetch** on the unauthenticated path, not merely trim the
response.

### Verdict: auth-gate the diagnostics, keep an opaque 200. Do not remove the route.

Removing it costs the operator the only way to diagnose the bridge and forces
the smoke script to change. Auth-gating gives both.

**Do not use `NODE_ENV` as the discriminator.** The sibling
`app/api/trading-agents/health/route.ts:53,65` does exactly that
(`...(isProd ? {} : { base: resolved.base })`). Cite it as **precedent that the
problem was already recognised**, not as the pattern to copy — `NODE_ENV` is not
authentication, and a preview deployment is not production.

### Exact diff — full file replacement

```ts
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { getAuthOptions } from '@/lib/auth'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { isValidApiKey } from '@/lib/auth/apiKey'
import { bloombergBridgeState, bridgeHealthCheck } from '@/lib/data/bloomberg/bridgeClient'

// getServerSession needs the Node runtime, not Edge.
export const runtime = 'nodejs'

/**
 * Operator diagnostic for the optional self-hosted Bloomberg bridge.
 *
 * Q-107 / Q100-16. The previous version returned {configured, reachable,
 * latencyMs} to any unauthenticated prober, disclosing whether a Bloomberg
 * bridge sits behind this deployment.
 *
 * Two things that a naive "trim the payload" fix does NOT close, and which are
 * the reason this route is auth-gated instead:
 *
 *   1. The response SHAPE was the oracle. The configured and unconfigured
 *      branches returned different KEY SETS, so a prober separated the two
 *      states without reading a single value. The unauthenticated response is
 *      now a CONSTANT — byte-identical in both states.
 *   2. The route was an unauthenticated outbound-request amplifier:
 *      bridgeHealthCheck() fetches the operator's bridge (bridgeClient.ts:178)
 *      on every anonymous call, 30/min/IP. The unauthenticated path now does
 *      NO outbound work.
 *
 * NODE_ENV is deliberately NOT the discriminator. The sibling
 * app/api/trading-agents/health/route.ts:53,65 gates `base` on NODE_ENV; that
 * is cited here as precedent that the disclosure was already understood, not
 * as the pattern to copy. NODE_ENV is not authentication and a preview
 * deployment is not production.
 */
const OPAQUE = { status: 'ok' } as const

export async function GET(request: Request) {
  const rateLimitResponse = await applyRateLimit(request, 'bloomberg-bridge-health', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const apiKeyValid = isValidApiKey(request.headers.get('x-api-key'))
  const session = apiKeyValid ? null : await getServerSession(getAuthOptions())

  if (!apiKeyValid && !session?.user) {
    // Constant body, 200, no outbound fetch. Identical whether or not
    // BLOOMBERG_BRIDGE_URL is set — that is the property under test.
    return NextResponse.json(OPAQUE, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const state = bloombergBridgeState()
  if (state !== 'enabled') {
    return NextResponse.json(
      {
        status: 'ok',
        state, // 'off' | 'unacknowledged'
        message:
          state === 'off'
            ? 'Set BLOOMBERG_BRIDGE_URL to enable. See README “Bloomberg bridge” and scripts/bloomberg-bridge-example.py.'
            : 'BLOOMBERG_BRIDGE_URL is set but BLOOMBERG_REDISTRIBUTION_ACK is not. The bridge is OFF. See lib/data/bloomberg/bridgeClient.ts.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const h = await bridgeHealthCheck()
  return NextResponse.json(
    { status: 'ok', state, reachable: h.ok, latencyMs: h.latencyMs, error: h.error },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
```

**Smoke script: no change required.** Optional hardening the lead may add — an
assertion that the anonymous body is the constant, which turns the property into
something a green run actually proves:

```js
  const health = await getJson('/api/bloomberg-bridge/health')
  passed &= ok(health.ok && health.status === 200, `GET bloomberg-bridge/health → ${health.status}`)
  // Q-107 / Q100-16: the ANONYMOUS body must be a constant. If this ever grows a
  // `state` or `reachable` key, the deployment is disclosing its Bloomberg
  // topology to unauthenticated probers again.
  passed &= ok(
    health.json && Object.keys(health.json).length === 1 && health.json.status === 'ok',
    'bloomberg-bridge/health anonymous body is opaque',
  )
```

**This diff introduces a route-config export (`export const runtime = 'nodejs'`),
and neither gate in §7 can validate it.** CLAUDE.md states it twice: Next.js
route config is **static-analysis-only** — `tsc` and `vitest` cannot catch it,
and the **Vercel preview build is the only gate that will**. Running
`npm run typecheck && npm run test` would not have covered this line, which is a
sharper statement than "I did not run them". In-repo precedent that the shape is
right: **CONFIRMED** `app/api/trading-agents/[ticker]/route.ts:54` already
carries the identical `export const runtime = 'nodejs'` alongside a
`getServerSession` call.

**Caveat, stated because it is load-bearing: BOTH authentication paths into this
diagnostic may be non-functional in production at the same time.**

- `isValidApiKey` is fail-closed, and `QUANTAN_API_KEY` may be unset
  (**PLAUSIBLE** — not observable from the repo, same class of unknown as
  `Q100-15`).
- The session path depends on `NEXTAUTH_SECRET`, which is a **known open item**
  (standing orders: *"Confirm its current state before declaring auth sound"*;
  recorded still-open at the 2026-08-14 interface review). I did not investigate
  it — it is owner-observable, not repo-observable.

If both are unresolved, every caller gets the opaque 200: **no disclosure, no
outbound amplification, and no diagnostic for the operator either.** That is the
correct failure direction, but it means the operator silently loses the tool.
**Tell the owner before merge, not after. Owner-gated (`Q107-S18`).**

---

## 2. `Q100-14` / `Q100-1` — Bloomberg on two public routes

### `Q107-S3` — the acknowledgement gate belongs in ONE place: `bridgeClient.ts`

**Not in the routes.** `isBloombergBridgeConfigured()` already has three callers
(**CONFIRMED**: `app/api/prices/route.ts:118`,
`app/api/fundamentals/[ticker]/route.ts:126`,
`app/api/bloomberg-bridge/health/route.ts:13`). A per-route check is the exact
reachability defect this repo has hit four times — a rule that is correct and
unreachable because the scan never visits the fourth caller somebody adds next
month. Gating inside the helper makes every future caller guarded **by
construction**.

**`BLOOMBERG_REDISTRIBUTION_ACK` must not carry a `NEXT_PUBLIC_` prefix** —
anything with that prefix is shipped to the browser.

#### Diff A — `lib/data/bloomberg/bridgeClient.ts`, replacing `:64-66`

```ts
/**
 * Q-107 (Q100-1, Q100-14): affirmative-acknowledgement gate.
 *
 * This bridge is a Bloomberg REDISTRIBUTION path: two PUBLIC routes serve its
 * output to end users and both set shared-cache headers, so enabling it pushes
 * terminal-derived data into a CDN intermediary. scripts/bloomberg-bridge-example.py:19
 * carries Bloomberg's own warning in its docstring. I8: "Before any feature
 * exposes vendor data to end users, confirm the licence permits it."
 *
 * A URL alone is not a confirmation. The operator must ALSO set
 * BLOOMBERG_REDISTRIBUTION_ACK to the exact sentinel below, which is a
 * deliberate act and not a value anyone sets by accident or copies from a
 * tutorial. Fail-closed: unset, empty or unrecognised means OFF, so the licence
 * question cannot be answered by inaction.
 *
 * NOT prefixed NEXT_PUBLIC_ — that prefix ships the value to the browser.
 *
 * This does NOT assert that setting the variable makes redistribution lawful.
 * It records that a human asserted it. The substantive question is Q-082 /
 * Q-083 and belongs to the owner and counsel.
 */
export const BLOOMBERG_REDISTRIBUTION_ACK_VALUE =
  'i-confirm-our-bloomberg-agreement-permits-this-redistribution'

export type BloombergBridgeState = 'off' | 'unacknowledged' | 'enabled'

/** Pure function of the environment. Exported so the health route can explain WHY it is off. */
export function bloombergBridgeState(): BloombergBridgeState {
  if (!process.env.BLOOMBERG_BRIDGE_URL?.trim()) return 'off'
  if (process.env.BLOOMBERG_REDISTRIBUTION_ACK?.trim() !== BLOOMBERG_REDISTRIBUTION_ACK_VALUE) {
    return 'unacknowledged'
  }
  return 'enabled'
}

export function isBloombergBridgeConfigured(): boolean {
  return bloombergBridgeState() === 'enabled'
}
```

#### Diff B — belt and braces inside the fetcher, `bridgeClient.ts:75-76`

`fetchBloombergQuotesViaBridge` currently re-reads `BLOOMBERG_BRIDGE_URL`
directly, so a caller that skips the predicate reaches the bridge anyway.

```diff
   const base = process.env.BLOOMBERG_BRIDGE_URL?.trim()
-  if (!base || tickers.length === 0) return null
+  // Q-107: re-check the gate here, not only at the call sites. This function
+  // reads the env var itself, so a caller that forgets isBloombergBridgeConfigured()
+  // would otherwise reach Bloomberg with no acknowledgement on file.
+  if (!base || tickers.length === 0) return null
+  if (bloombergBridgeState() !== 'enabled') return null
```

Same two lines at `bridgeHealthCheck` (`:170-171`) — **optional**; the health
route already branches on `bloombergBridgeState()` and the health probe carries
no market data, only a reachability signal.

#### What this does to the two public routes — no route edit needed

- `app/api/prices/route.ts:118` → `bridgeConfigured` is `false` → `bbMap` is
  `null` → `mergeYahooAndBloomberg` returns all-Yahoo rows
  (**CONFIRMED** `lib/data/mergeQuotes.ts:93`) → `bloombergTickers` is `[]`,
  `bloombergStatus` is `'not_configured'`.
- `app/api/fundamentals/[ticker]/route.ts:126` → `bloombergSpot` stays `null` →
  `displayPrice` falls back to the Yahoo `livePrice` (`:131-132`) →
  `priceSources.bloomberg` is `null` → the SummaryTab block does not render.

#### Test breakage — CONFIRMED, and one of them goes green for the wrong reason

Not "none". I checked, and the answer changes what the lead has to write.

**Unaffected — CONFIRMED:**
- `__tests__/api/prices.test.ts:81-84` asserts `{yahoo:true,
  bloombergStatus:'not_configured'}` and stubs no bridge env at all; `'off'`
  maps to `'not_configured'` exactly as before.
- `__tests__/data/mergeQuotes.test.ts` — no `BLOOMBERG_BRIDGE_URL` stub; it
  tests the pure merge and never calls the fetcher.
- `__tests__/data/bloombergBridge.test.ts:170-193` (`bridgeHealthCheck`) —
  unaffected **because Diff B's re-check is deliberately NOT applied to
  `bridgeHealthCheck`.** That is the reason it is optional there.

**Breaks — CONFIRMED, `__tests__/data/bloombergBridge.test.ts`:**

| Line | Assertion | Why it fails |
|---|---|---|
| `:91-92` | `stubEnv('BLOOMBERG_BRIDGE_URL','https://bridge.example')` then `expect(isBloombergBridgeConfigured()).toBe(true)` | The gate returns `false` — a URL alone is no longer "configured". **This assertion is the gate's own specification inverted, so it is the right test to rewrite, not to patch around.** |
| `:96-149` ("normalizes flexible row keys and formats market cap") | stubs the URL at `:97`, then asserts on `map!.size`, `map!.has(...)` | Diff B makes the fetcher return `null`; every `map!` dereference throws |

**Goes green while no longer testing what it names — CONFIRMED, and this is the
one to watch:** `:154-163` ("fail-closed: non-OK HTTP, thrown fetch, and zero
usable rows → null") stubs the URL at `:155` and asserts `toBeNull()` three
times. With the gate it **still passes** — because the fetcher now returns
`null` at the gate and never reaches the HTTP path the test exists to exercise.
It would be green and inert: the exact "a guard is green, ask what it visited
before you ask what it decided" failure this repo has hit five times. **The
lead must stub the ack in that block too, or the fail-closed coverage is
silently deleted by a passing suite.**

**Required test edits** — add to the `fetchBloombergQuotesViaBridge` describe
block wherever `BLOOMBERG_BRIDGE_URL` is stubbed non-empty (`:91`, `:97`,
`:155`):

```ts
vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', BLOOMBERG_REDISTRIBUTION_ACK_VALUE)
```

and add the gate's own positive control, which is what makes the change provable
rather than asserted:

```ts
  it('Q-107: a URL without the redistribution acknowledgement is OFF, not configured', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example')
    vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', '')
    expect(bloombergBridgeState()).toBe('unacknowledged')
    expect(isBloombergBridgeConfigured()).toBe(false)
    // The point of the gate: no request is made at all. Not "a request that
    // returns nothing" — no request.
    const calls: FetchCall[] = []
    stubFetch({ ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', last: 1 }] }) } as Partial<Response>, calls)
    expect(await fetchBloombergQuotesViaBridge(['AAPL'])).toBeNull()
    expect(calls).toHaveLength(0)

    // A near-miss value must not open the gate either.
    vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', 'true')
    expect(isBloombergBridgeConfigured()).toBe(false)
  })
```

`expect(calls).toHaveLength(0)` is the load-bearing line: without it the test
cannot tell "gated" from "fetched and returned null", which is precisely the
distinction `:154-163` loses.

I did not run the suite — `npm run test` is the lead's gate — but the stub sites
and the assertions above are read from the file, not inferred.

#### The cost, stated plainly — this is the owner-gated part

Per `Q100-15`, **whether `BLOOMBERG_BRIDGE_URL` is set in the Vercel project is
not observable from this repository.** If it *is* set, landing this gate
**silently turns off a live Bloomberg feed in production**: prices quietly revert
to Yahoo and the SummaryTab "Bloomberg spot" row disappears. That is the correct
direction under I8 — unlicensed redistribution stopping is the feature — but it
is a live behaviour change and the owner must be told before merge, not after.
**Owner action: confirm the current value of `BLOOMBERG_BRIDGE_URL` in Vercel.**

#### `.env.example` — proposed line, but confirm who may edit it

`.env.example:67` already documents `BLOOMBERG_BRIDGE_URL`. The gate needs a
sibling entry. I did not write it: the standing orders forbid editing `.env`
files, and while `.env.example` is a tracked template holding no values, that is
the owner's call to make explicit, not mine to assume.

```
# Bloomberg bridge redistribution acknowledgement (Q-107 / I8).
# BLOOMBERG_BRIDGE_URL alone no longer enables the bridge. Set this to the exact
# sentinel below to assert that YOUR Bloomberg Terminal Agreement / Data Licence
# permits serving this data to your end users through public, CDN-cached routes.
# Leave unset if you are not certain. Unset = bridge OFF.
# BLOOMBERG_REDISTRIBUTION_ACK=i-confirm-our-bloomberg-agreement-permits-this-redistribution
```

### `Q107-S4` — does dropping the fields break `SummaryTab.tsx:32-35`? Answer: no, and here is the whole consumer set

**CONFIRMED by exhaustive grep over `*.ts`/`*.tsx`/`*.mjs`, excluding
`node_modules`:**

| Field | Producer | Consumers |
|---|---|---|
| `priceSources` | `app/api/fundamentals/[ticker]/route.ts:149` | `components/stock/quantlab/types.ts:107-111` (optional type) and `components/stock/quantlab/tabs/SummaryTab.tsx:32,35,37` — **that is all** |
| `dataSources.bloombergTickers` | `app/api/prices/route.ts:173` | **zero reads.** Declared at `hooks/useLivePrices.ts:51`; nothing reads it |
| `dataSources.bloombergStatus` | `app/api/prices/route.ts:176` | **zero reads.** Not even declared in `useLivePrices.ts:48-52` |
| `quotes[].dataSource` | `lib/data/mergeQuotes.ts:131,136,191` | **zero UI reads.** Declared `useLivePrices.ts:41`; the only `app/` hit is a comment at `app/page.tsx:119` |

Because `priceSources` is optional (`types.ts:107`) and guarded by `?.`
(`SummaryTab.tsx:32`), removing it **neither crashes nor fails typecheck** — the
amber "Bloomberg spot" block silently stops rendering. So the mechanical answer
to "does it break?" is *no*.

**But that is the wrong question, and I want the lead to see why.** Per §0 the
recommendation is *not* to drop it. With the S3 gate closed the block already
stops rendering, because `priceSources.bloomberg` is `null`. **Nothing replaces
it, because nothing needs to** — there is no Bloomberg price to attribute.

Related, worth a line in its own right: **`hooks/useLivePrices.ts:48-52` declares
a consumer interface for `dataSources` that no component reads.** A type that
asserts a consumer which does not exist is the same failure mode as I1's inert
`QuoteProvenance` — it makes a reader believe provenance is plumbed when it is
not. Low severity; flagging rather than proposing a diff, since `hooks/` is the
frontend agent's territory.

### `Q107-S5` (HIGH) — the unlabelled propagation is the real I1 defect and the gate does not fix it

**CONFIRMED** `app/api/fundamentals/[ticker]/route.ts:131-144`. When the bridge
*is* enabled, `displayPrice` is the Bloomberg spot and it is passed as the 8th
argument to `buildFundamentalsPayload`. Everything downstream — DCF scenarios,
`bands.fairValueMid`/`buyZoneHigh`/`sellZoneLow`, `anchors`, `range52w.position`,
`signal`, `researchScore` — is then Bloomberg-derived, and **not one of those
fields carries a source**. `priceSources.bloomberg` labels the spot and nothing
else. I1: *"Every number rendered in the UI … should carry (vendor, …)"*.

Minimum honest fix, entirely inside the route (**cheap, I1-positive, no
cross-territory edit**):

```diff
       {
         ...payload,
         priceSources: {
           display: displayPrice,
           yahoo: livePrice,
           bloomberg: bloombergSpot,
+          // Q-107 (Q107-S5): displayPrice feeds buildFundamentalsPayload, so the
+          // DCF scenarios, bands, anchors, signal and researchScore in this payload
+          // are ALL derived from whichever source won here — and none of those
+          // fields carries a source of its own. Naming the winner is the minimum
+          // I1 obligation; it is not the full 5-tuple and does not claim to be.
+          displaySource:
+            bloombergSpot != null && bloombergSpot > 0
+              ? ('bloomberg' as const)
+              : typeof qAny?.regularMarketPrice === 'number' && qAny.regularMarketPrice > 0
+                ? ('yahoo-quote' as const)
+                : closes.length
+                  ? ('yahoo-chart-close' as const)
+                  : ('none' as const),
         },
       },
```

Add to `components/stock/quantlab/types.ts:107-111`:

```diff
   priceSources?: {
     display: number | null
     yahoo: number | null
     bloomberg: number | null
+    /** Which feed produced `display` — and therefore every derived figure. */
+    displaySource?: 'bloomberg' | 'yahoo-quote' | 'yahoo-chart-close' | 'none'
   }
```

**Cross-territory ask, for the lead to route:** threading `displaySource` into
`payload.dataLineage.sources` (produced at
`lib/quant/buildFundamentalsPayload.ts:421`) would put it in front of the user
via the existing lineage panel at `SummaryTab.tsx:18-30`. `lib/quant/` is not my
territory; I did not read past the one line I cite.

**Third-order note I am flagging rather than fixing:** `displayPrice` reaching
`researchScore` and `signal` means an *unlicensed vendor's* number can drive a
BUY/SELL-shaped output. That is the intersection of I8 and Q-083 and is not an
engineering decision.

---

## 3. `Q100-22` — `components/ComplianceBanner.tsx` · MEDIUM

### The rule that makes this copy writable

**State only mechanical facts about what the software does. Never state what
regime does or does not apply.** I am not a lawyer, the owner is not a lawyer,
and this routes through `Q-083`.

### `Q107-S6` — delete the regime clause. Do NOT substitute MAS.

**CONFIRMED** `:31-32`: *"does not … provide personalized recommendations
regulated under MiFID II, SEC RIA, or equivalent regimes"*. Two problems, and the
second is the one that matters:

- It names the two regimes that plausibly **do not** govern a Singapore-based
  operator and omits **MAS**, which per CLAUDE.md's regulatory-posture section
  does.
- **The repair is not to add MAS.** Writing *"not regulated under MAS"* is the
  identical error with the governing regulator — an unverified self-classification,
  and a worse one, because it would be asserted against the regime that actually
  bites. **Delete the clause; assert nothing in its place.**

### `Q107-S7` — `:35` is false for the browser-direct crypto feeds

**CONFIRMED** `:35` claims *"Market data is delayed or aggregated per your data
provider"*. **CONFIRMED** `components/crypto/hooks/useBtcCandles.ts:34` builds
`https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?...` and fetches it **from
the browser**; the register additionally carries `ws.kraken.com` and
`ws-feed.exchange.coinbase.com` as browser-direct `'use client'` streaming feeds.
Those are live, not delayed, and not aggregated by us.

### Exact replacement copy for `:30-40`

```tsx
            <p>
              QUANTAN is a research and visualisation tool. It does not route or execute orders,
              does not hold client money or assets, and has no connection to any brokerage account.
              It does not collect your objectives, financial situation or needs, and does not take
              them into account. Outputs are produced by published heuristics and by third-party
              language models.
            </p>
            <p>
              This notice makes no statement about the regulatory status of this service in any
              jurisdiction. Nothing here should be relied on as a personal recommendation. Where
              your use of this tool may be regulated, take your own advice.
            </p>
            <p>
              Data sources vary by panel. Some panels call vendor APIs directly from your browser
              and are live rather than delayed. Freshness is not uniform across panels and is not
              currently labelled per value. Verify every figure against your own vendor feed before
              using any level for execution or risk limits.
            </p>
            <p>
              Past performance and backtests do not indicate future results. No claim of skill or
              outperformance is made for any strategy or signal shown. You are responsible for
              suitability, best execution and record-keeping.
            </p>
```

**Sentence-by-sentence justification, because copy is where unverified claims
hide:**

| Sentence | Basis |
|---|---|
| "does not route or execute orders … no brokerage account" | **PLAUSIBLE — inherited from the existing `:31` copy. I did not verify repo-wide that no order-routing path exists.** The lead should grep before shipping; CLAUDE.md FORBIDDEN bars auto-execution without a kill switch, which is consistent but is not proof. |
| "does not collect your objectives, financial situation or needs" | **CONFIRMED** for my territory — the only user inputs I read are ticker, DCF assumptions (`app/api/fundamentals/[ticker]/route.ts:54-60`) and LLM model settings. Deliberately phrased as a fact about **inputs**, not as the "general advice" carve-out; the previous draft said "not tailored to any person's circumstances", which reads as a legal position and I removed it. |
| "makes no statement about the regulatory status" | Asserts nothing. This is the whole point of the rewrite. **Owner alternative:** *"Licensing and regulatory status are under review"* — truthful (`Q-083` is a live P0-legal item) but it implies a commitment, so it is the owner's to make, not mine. |
| "Some panels … are live rather than delayed" | **CONFIRMED** `useBtcCandles.ts:34` + the two `wss://` register rows. |
| "not currently labelled per value" | **CONFIRMED** — I1 is ASPIRATIONAL with zero `.provenance` consumers. |
| "No claim of skill or outperformance is made" | Matches the I5 permitted-wording constraint verbatim in direction. |

### `Q107-S8` (LOW) — `open=false`, and what it is not

**CONFIRMED** `:7` `useState(false)`. The **summary line at `:22-24` is always
visible** and does carry "Not investment advice", so this is the lowest-severity
of the three items and I am not inflating it. Recommendation: `useState(true)`.
Marked **design/owner-gated** — it changes the footer's visual weight on every
page and the palette/layout is owner territory (see the standing contrast row).

### What this copy fix does NOT do — say so when you land it

**CONFIRMED** `components/stock/quantlab/tabs/LlmTab.tsx:399-412` renders a
centred, colour-coded, 4xl-font **"Final decision — BUY / SELL"** banner for a
named security, with no inline disclaimer, and the payload behind it is
reachable through the **unauthenticated** `GET` at
`app/api/trading-agents/[ticker]/route.ts:56-87`. A footer disclaimer against a
BUY banner is precisely the substance of `Q-083`. **New banner copy must not be
presented as closing it**, and the commit message should say so.

**The accurate statement of where the product sits, which is my deliverable and
not a legal conclusion:** the platform renders a directional BUY/SELL grade for a
specific named security, with a confidence label, on a page the user reached by
searching that security, and serves it to unauthenticated callers. It does not
collect the user's objectives or financial circumstances. Whether that
constitutes a personal recommendation under the FAA/SFA is the question for
counsel; I record only what the product says to users.

---

## 4. `Q100-17` — the user's LLM key forwarded to an operator-chosen origin · MEDIUM

### Is the forward inherent? Partly — and the part that is not is the actual defect.

**Inherent, given the architecture.** **CONFIRMED**: the key is read from
`sessionStorage` at `components/stock/quantlab/hooks/useQuantLabLlm.ts:198`,
POSTed at `:99,105-109`, and forwarded at
`app/api/trading-agents/[ticker]/route.ts:317-319`. The entity that calls the LLM
is the Python sidecar; a sidecar that must call OpenAI on the user's behalf must
hold the user's OpenAI key. **No amount of proxy hygiene removes that.** The
Next route is a hop, not the destination.

**Not inherent, and this is what should be fixed: the destination is chosen
silently and the user cannot observe it.** **CONFIRMED**
`lib/trading-agents-config.ts:72-84` — `resolveTradingAgentsBase()` falls through
`TRADING_AGENTS_BASE` → `TRADING_AGENTS_FALLBACK_BASE` (`source:
'managed_fallback'`) → `http://127.0.0.1:3001` in development. The key follows
wherever that lands. **CONFIRMED** `app/api/trading-agents/health/route.ts:53,65`
suppresses `base` in production, and **CONFIRMED** `LlmTab.tsx:119-121` renders
the destination **only when `base` is present** — i.e. never in production. So a
user types a live OpenAI credential into a form that will not tell them which
third party receives it.

### Remediation ladder — 1 and 2 are implementable now

**1. Refuse to forward a user key to a non-project origin.** Insert after
`const TA_BASE = resolved.base` at `app/api/trading-agents/[ticker]/route.ts:249`:

```ts
  // Q-107 (Q100-17): a user-supplied LLM credential may only be forwarded to the
  // origin the OPERATOR OF THIS DEPLOYMENT configured as the project backend.
  // resolveTradingAgentsBase() silently falls through to
  // TRADING_AGENTS_FALLBACK_BASE ('managed_fallback') and, in dev, to localhost,
  // and health/route.ts:53,65 suppresses `base` in production — so the user
  // cannot learn which third party received their key. Forwarding a credential to
  // an origin the user never selected and cannot observe is the defect. The
  // forward itself is inherent to running the analysis server-side.
  //
  // Fail-closed and explicit: refuse rather than silently strip the key, because
  // silently stripping it would produce an opaque upstream auth error.
  if (apiKey && resolved.source !== 'project') {
    return NextResponse.json(
      {
        error: 'byo_key_destination_not_permitted',
        message:
          'This deployment is currently using a fallback analysis backend, so your API key will not be sent. ' +
          'Ask the site owner to configure TRADING_AGENTS_BASE, or select the "ollama" provider, which needs no key.',
      },
      { status: 409 },
    )
  }
```

Note this is placed **after** the CSRF, rate-limit and auth checks (`:176-197`)
so it cannot be used as an unauthenticated probe of which backend is configured.

**2. Show the destination class before the key is submitted — the data already
exists and is already discarded.** **CONFIRMED** `health/route.ts:52,64` returns
`source: 'project' | 'managed_fallback' | 'local_dev'` **unconditionally** (it is
not behind the `isProd` guard), and **CONFIRMED**
`useQuantLabLlm.ts:41,56,64` stores it as `llmBackendHealth.source`. **CONFIRMED**
`LlmTab.tsx:119-121` renders it only inside `llmBackendHealth.base && …`, so in
production it is fetched, stored, and thrown away. Render it near the key input:

```tsx
{llmBackendHealth.checked && llmBackendHealth.source && (
  <p className="mt-1 text-[11px] text-amber-300/90">
    Your key is sent to this site&apos;s{' '}
    {llmBackendHealth.source === 'project'
      ? 'operator-configured analysis backend'
      : llmBackendHealth.source === 'managed_fallback'
        ? 'shared managed backend — not chosen by you'
        : 'local development backend'}
    , which forwards it to {llmProvider}. It is not stored by this site.
  </p>
)}
```

`components/stock/quantlab/tabs/LlmTab.tsx` is jointly my territory and the
frontend agent's — **flagging a possible conflict for the lead.**

**"It is not stored by this site" is CONFIRMED only for the Next route**
(`:307-319` builds a fresh body; `:252` strips `api_key` from the passthrough
object). **Whether the Python sidecar logs or persists the key is PLAUSIBLE, not
confirmed — I did not read `server_trading_agents.py`.** Do not ship that clause
until someone reads it; if it is unverified, cut the sentence rather than soften
it.

**3. The keyless path already exists.** `ollama` is in `SUPPORTED_PROVIDERS`
(`lib/trading-agents-config.ts:11`) and needs no key.

**4. True elimination is a redesign, not a patch.** The browser would call the
user's LLM provider directly and the sidecar would receive only text. That
removes the credential from our infrastructure entirely, and costs: CORS,
provider-side browser-origin restrictions, and the loss of server-side
orchestration. **Name it in the backlog; do not attempt it in this wave.**

---

## 5. Exposed and NOT in the register — the highest-value section

I read `__tests__/architecture/vendorEgress.ts` to answer one question:
**does `detectEgress` resolve imports, or does it match evidence per file?**

**CONFIRMED: it is per-file and textual.** `detectEgress` (`:263-336`) iterates
`files`, and every rule reads only `file.source` — a scheme regex at `:281`,
`envHostNames(...)` at `:319`, `pipPackages` at `:322`, `publishedPaths` at
`:327` — plus the manifest keys at `:326-335`. **There is no import graph.** The
file's own header at `:29` even says the third kind exists "for hosts assembled
at runtime, which a literal scan structurally cannot resolve."

### `Q107-S9` (HIGH) — a route that reaches a vendor through an imported helper leaves NO matchable evidence in its own file

Measured, not argued. `grep -n "process\.env\|https\?://\|wss\?://"`:

| File | Detector-visible evidence | Actual behaviour |
|---|---|---|
| `app/api/prices/route.ts` | **none** | serves Yahoo + Bloomberg to the public |
| `app/api/fundamentals/[ticker]/route.ts` | **none** | serves Yahoo + Bloomberg to the public |
| `app/api/bloomberg-bridge/health/route.ts` | **none** | probes the operator's Bloomberg bridge |
| `app/api/trading-agents/health/route.ts` | `NODE_ENV` only (`:16`) — does not match `HOST_BEARING_NAME` at `vendorEgress.ts:176` | **fetches an operator-chosen third-party origin at `:41`** |

**All four produce ZERO egress points.** Their appearance in the register is
**entirely hand-written** — I diffed the register's `evidence` arrays and the
Bloomberg row lists `app/api/prices/route.ts:118`, `:161`,
`app/api/fundamentals/[ticker]/route.ts:125` and
`app/api/bloomberg-bridge/health/route.ts:22`, none of which the detector could
have produced. **The guard did not find them; a human did.** That is exactly the
"green because unreachable" pattern, in its fifth shape.

**Why the guard is nonetheless still green and not lying:** the *vendor id* is
registered from the helper module (`lib/data/bloomberg/bridgeClient.ts:65,75`
supply `env-host BLOOMBERG_BRIDGE_URL`; `lib/trading-agents-config.ts:69,73`
supply the two TA vars). The unit of registration is `(kind, id)`, not the
surface. So this is a **precise sharpening of the gap CLAUDE.md I8 already names
as "exposure without new egress"** — I am not claiming a missed vendor. What it
means operationally:

> **Adding a new route that imports `bridgeClient` and serves Bloomberg data on
> a new public surface produces zero new detections and ships green.** Same for
> any Yahoo route, any TradingAgents route.

**Evidence such a route leaves in source, which is what a detector would need to
match:** an `import` specifier resolving to a module that itself has an egress
point. Concretely — a one-hop import-edge pass over the same virtual file set,
reusing the resolution machinery
`__tests__/architecture/syntheticContainment.ts` already has for I3: if module M
has an egress point and module N imports M, N inherits M's `(kind, id)` as
evidence. The register row then records *surfaces*, and adding a surface without
recording it goes red. **This is a design proposal for the red-team/lead, not
something I should implement from inside this territory.**

### `Q107-S10` (MEDIUM) — `app/api/trading-agents/health/route.ts` is in NO register row's evidence array

**CONFIRMED** by scanning every `evidence` entry across all 90 rows: the string
`trading-agents/health` appears nowhere. It makes a live outbound fetch to an
operator-chosen origin (`:41`) and returns reachability plus `source` to
**unauthenticated** callers. The `TRADING_AGENTS_BASE` /
`TRADING_AGENTS_FALLBACK_BASE` rows cite only `lib/trading-agents-config.ts:69`
and `:73`; the `dynamic-host` row cites only `[ticker]/route.ts:36`. Remedy:
append `app/api/trading-agents/health/route.ts:41` to the evidence arrays of
those three rows. **Register edits go through the lead** — the file is
`APPEND_ONLY` by its own declaration and guarded by
`__tests__/architecture/vendor-licence-register.test.ts`, whose
`NAMED_MARKET_DATA_VENDORS` block pins these rows.

### `Q107-S11` (MEDIUM) — three configuration oracles, not one; `Q100-16` names one of them

`Q100-16` flags only the bloomberg-bridge health route. Two public routes
disclose the identical fact:

- **CONFIRMED** `app/api/prices/route.ts:135-137,176` — `dataSources.bloombergStatus`
  is emitted unconditionally as `'not_configured' | 'ok' | 'degraded'`. An
  anonymous `GET /api/prices?tickers=AAPL` tells you whether a Bloomberg bridge
  is behind this deployment, and whether it is currently healthy.
- **CONFIRMED** `app/api/fundamentals/[ticker]/route.ts:149-153` —
  `priceSources.bloomberg` is `null` vs a number, the same oracle.

**Fixing only the health route leaves both open.** Per §0 the remedy is **not**
to strip the fields: the S3 gate collapses both to constants in the default
state. Residual, stated so it is not mistaken for closed: **an operator who
enables the bridge re-opens the oracle on both public routes.** At that point
they have affirmed a licence and the disclosure is a decision they have made; if
they want it closed too, the fix is authentication on those routes
(`Q107-S12`), not label-stripping.

### `Q107-S12` (MEDIUM) — `middleware.ts` matches every path and authenticates none of it

**CONFIRMED** `middleware.ts:119` `matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']`
— every route, including every `/api/*`. **CONFIRMED** the body (`:51-116`) does
CSP-nonce issuance and CSRF-cookie issuance and **nothing else**: no session
check, no route-protection table. The middleware is positioned to be the single
enforcement point for I8's exposure half and currently is not one. Recording it
here as territory fact; a route-protection design is a wave of its own and
interacts with `Q-097`/`SafeAuth`.

### `Q107-S13` (MEDIUM) — the CSP permits browser-direct egress to any host, which is what makes the browser-direct vendor calls possible

**CONFIRMED** `middleware.ts:65` `"connect-src 'self' https: wss:"`. That is
maximally permissive and is precisely what allows
`useBtcCandles.ts:34` (CoinGecko) and the two `wss://` feeds to run from the
browser. **Constructive proposal:** `connect-src` is the one place in this repo
where browser-direct vendor egress could be enforced **at runtime** rather than
detected in source — an explicit host allowlist derived from the register's
`end_user_exposed` browser-direct rows would make the register load-bearing
instead of descriptive, and a new browser-direct vendor would fail in the
browser rather than ship green. **Caveat that must be honoured:** the CSP is
currently **Report-Only** unless `QUANTAN_CSP_ENFORCE=1` (`:83-88`), so this
would be advisory until that flips, and flipping it is owner-gated after a clean
report-only window. Do not claim enforcement you do not have.

---

## 6. Ranked list

### Implement now (no owner input needed, no behaviour change users can see)

| # | Id | What | Files |
|---|---|---|---|
| 1 | `Q107-S1`, `Q107-S2` | Auth-gate the bloomberg-bridge health diagnostics; constant opaque 200 for anonymous callers; **no outbound fetch** on the anonymous path. Smoke script needs **no change** (it asserts status only); the optional extra assertion is a bonus. | `app/api/bloomberg-bridge/health/route.ts` |
| 2 | `Q107-S5` | Add `priceSources.displaySource` so the source that drives DCF/bands/anchors/signal/researchScore is named. Pure I1 gain, no field removed. | `app/api/fundamentals/[ticker]/route.ts`, `components/stock/quantlab/types.ts` |
| 3 | `Q107-S6`, `Q107-S7` | Banner: **delete** the MiFID/SEC-RIA clause and put **nothing** in its place; correct the false "delayed or aggregated" claim at `:35`. **Both are unconditional — they only remove or weaken assertions.** | `components/ComplianceBanner.tsx` |
| 4 | `Q107-S10` | Append `app/api/trading-agents/health/route.ts:41` to the evidence arrays of the two TA `env-host` rows and the `dynamic-host` row. | `reviews/vendor-licence-register.json` (lead only) |
| 5 | `Q107-S17` (ledger hygiene) | `Q100-16`'s remediation note says "gate behind auth or remove" and omits both the shape-oracle and the amplifier. Update the note when the fix lands so the next reader does not re-derive it. | ledger (lead only) |

**Split out of item 3 deliberately, because it is blocked on a verification I did
not do:** re-asserting *"does not route or execute orders, does not hold client
money or assets"* is **inherited copy, not a verified claim**. Grep for order
routing / broker integration repo-wide first. If it does not come back clean —
or nobody wants to own the grep — **ship item 3 with that sentence cut**. A
shorter true notice beats a longer one carrying an unverified assertion, which
is the exact defect `Q100-22` is about.

### Implement now, but tell the owner first (live behaviour change)

| # | Id | What | Why it is owner-notified |
|---|---|---|---|
| 6 | `Q107-S3` | The `BLOOMBERG_REDISTRIBUTION_ACK` gate inside `bridgeClient.ts` — the single choke point, fail-closed, plus the belt-and-braces re-check in the fetcher. **Ships with the test edits above: two assertions in `__tests__/data/bloombergBridge.test.ts` break, and a third goes green while silently ceasing to test fail-closed behaviour.** | Per `Q100-15` we cannot see whether `BLOOMBERG_BRIDGE_URL` is set in Vercel. If it is, **this silently turns off a live Bloomberg feed in production.** Correct under I8; still a change the owner must consent to before merge. Also needs a `.env.example` line, and whether an agent may edit that file is the owner's call. |
| 7 | `Q107-S14` | Ladder step 1: refuse to forward a user LLM key when `resolved.source !== 'project'` (409). | Any deployment relying on `TRADING_AGENTS_FALLBACK_BASE` for BYO-key runs stops working by design. |
| 8 | `Q107-S15` | Ladder step 2: render the destination class next to the key input, from the `source` the health route already returns and the UI already discards. | Cut the "not stored by this site" clause unless someone reads `server_trading_agents.py` first. Possible territory overlap with the frontend agent on `LlmTab.tsx`. |

### Owner decisions

- **`Q107-S16`** — is `BLOOMBERG_BRIDGE_URL` set in the Vercel project **right
  now**? Thirty seconds to answer; not answerable from the repo; blocks the
  severity of `Q100-1` and `Q100-14`.
- **`Q107-S18`** — **both** auth paths into the new health diagnostic are
  owner-observable unknowns, and if both are unresolved the operator loses the
  diagnostic entirely (fail-closed, which is correct, but silent):
  (a) is `QUANTAN_API_KEY` set? `isValidApiKey` is fail-closed without it.
  (b) `NEXTAUTH_SECRET` is a **known open item** — confirm its state before
  anyone calls the session path working.
- **`Q107-S8`** — banner `open=false` → `true`? Design/visual-weight decision.
  **Lowest severity of the three banner items; do not let it crowd the false-copy
  fixes.**
- Whether the neutral *"makes no statement about regulatory status"* or the
  committing *"licensing and regulatory status are under review"* goes in the
  banner.
- **`Q107-S13`** — do we pursue a `connect-src` vendor allowlist, and is the
  owner ready for a clean report-only window before `QUANTAN_CSP_ENFORCE=1`?

### Counsel (`Q-082` / `Q-083`) — no agent may close these

- **`Q-082`** — the Bloomberg Terminal Agreement / Data Licence question behind
  `Q100-1`. The S3 gate makes an operator assert the answer; **it does not
  answer it**, and the sentinel value must never be read as a licence opinion.
- **`Q-082`** — Yahoo, CoinGecko, Kraken, Coinbase, Bybit, OKX: six vendors,
  end-user-exposed, no auth, `NONE_NO_AGREEMENT` in the register.
- **`Q-083`** — the BUY/SELL "Final decision" banner at `LlmTab.tsx:399-412`,
  served through an **unauthenticated** GET. **The new banner copy does not
  close this and must not be presented as closing it.**
- **`Q-083`** — `displayPrice` from an unlicensed vendor driving `researchScore`
  and `signal` (see `Q107-S5`).
- **Not counsel but adjacent:** `Q100-12`'s committed DeepSeek credential
  (`start-universal.sh:12`) is **revoke-and-rotate**, not delete. Outside my
  territory; noting it because it is still open and removal from HEAD does not
  remediate a value that lives in git objects permanently.

---

## 7. What I did not check — so a green read of this report is not a proof

- I did not run `npm run test` or `npm run typecheck`. Diffs are proposals; the
  lead's gate is the gate.
- I did not verify repo-wide that no order-routing path exists. The "does not
  route or execute orders" clause is **inherited copy, not a verified claim.**
- I did not read `server_trading_agents.py`, so nothing here asserts what the
  sidecar does with a forwarded key.
- I did not read `lib/quant/buildFundamentalsPayload.ts` beyond the single
  `dataLineage` line I cite.
- I read the affected test files but did not execute them. The breakage table
  under `Q107-S3` is derived from the stub sites and assertions as written; the
  lead's `npm run test` is the gate.
- The one-hop import-edge proposal in `Q107-S9` is a design sketch. I did not
  build it and cannot claim it would be reachable — which is the failure mode it
  exists to fix, so it deserves a red-team pass rather than my confidence.

---

## 8. Transcription table — the ledger columns, pre-filled

`reviews/findings-ledger.csv` is
`id,reviewer,severity,domain,file,line,one_line,citation,acceptance_test_id,assigned_engineer,target_sprint,status`.
Every row below has the fields that column set requires, so the lead transcribes
rather than re-derives. `reviewer` is `security-compliance` throughout;
`status` is `OPEN 2026-08-29 (Q-107)` unless noted. **I am not writing to that
file.**

| id | sev | domain | file | line | one_line | acceptance_test_id | assigned | routes to |
|---|---|---|---|---|---|---|---|---|
| `Q107-S1` | MEDIUM | Security/Compliance | `app/api/bloomberg-bridge/health/route.ts` | 13 | The response SHAPE is the configuration oracle, so trimming fields does not close `Q100-16`: the configured and unconfigured branches return different KEY SETS and are separable without reading a value | `AT-Q107-health-opaque` | | Q-107 |
| `Q107-S2` | MEDIUM | Security | `app/api/bloomberg-bridge/health/route.ts` | 21 | Unauthenticated outbound-request amplifier: every anonymous call drives a live fetch at the operator's Bloomberg-adjacent host, 30/min per IP, carrying `X-Bridge-Secret` | `AT-Q107-health-no-outbound` | | Q-107 |
| `Q107-S3` | HIGH | Security/Compliance | `lib/data/bloomberg/bridgeClient.ts` | 64 | A Bloomberg redistribution path runs on the presence of a URL alone; no affirmative operator acknowledgement is required before vendor data reaches end users through two public CDN-cached routes | `AT-Q107-bloomberg-ack-gate` | owner (see S16) | Q-082 |
| `Q107-S4` | LOW | Data-integrity | `hooks/useLivePrices.ts` | 48 | A consumer interface is declared for `dataSources`/`bloombergTickers` that **no component reads** — a type asserting provenance plumbing that does not exist, the same shape as I1's inert `QuoteProvenance` | `AT-Q107-declared-unread` | frontend | Q-101 |
| `Q107-S5` | HIGH | Data-integrity | `app/api/fundamentals/[ticker]/route.ts` | 131 | `displayPrice` becomes Bloomberg-derived and feeds `buildFundamentalsPayload`, so DCF scenarios, bands, anchors, `signal` and `researchScore` are all vendor-derived with **no source on any of them** | `AT-Q107-display-source` | | Q-101, Q-083 |
| `Q107-S6` | MEDIUM | Security/Compliance | `components/ComplianceBanner.tsx` | 31 | Unverified regulatory self-classification naming MiFID II and SEC RIA; the repair is to **delete the clause**, not to substitute MAS — asserting non-applicability of the governing regulator is the same error and a worse one | `AT-Q107-banner-no-regime-claim` | | Q-083 |
| `Q107-S7` | MEDIUM | Security/Compliance | `components/ComplianceBanner.tsx` | 35 | "Market data is delayed or aggregated" is false: `components/crypto/hooks/useBtcCandles.ts:34` and two `wss://` feeds are browser-direct and live | `AT-Q107-banner-no-regime-claim` | | Q-083 |
| `Q107-S8` | LOW | frontend | `components/ComplianceBanner.tsx` | 7 | Detail panel is `useState(false)`; the always-visible summary at `:22-24` does carry "Not investment advice", so this is the least severe of the three banner items | | owner | Q-083 |
| `Q107-S9` | HIGH | Security/Compliance | `__tests__/architecture/vendorEgress.ts` | 263 | `detectEgress` is per-file and textual with **no import graph**, so a route reaching a vendor through an imported helper leaves zero matchable evidence: four routes in this territory produce **zero** detections and appear in the register only because a human hand-wrote them | `AT-Q107-import-edge-evidence` | red-team | Q-106 |
| `Q107-S10` | MEDIUM | Security/Compliance | `app/api/trading-agents/health/route.ts` | 41 | Makes a live outbound fetch to an operator-chosen third-party origin and appears in **no** register row's evidence array (scanned all 90 rows) | `AT-Q107-import-edge-evidence` | | Q-106 |
| `Q107-S11` | MEDIUM | Security/Compliance | `app/api/prices/route.ts` | 176 | Three configuration oracles exist, not one: `dataSources.bloombergStatus` and `app/api/fundamentals/[ticker]/route.ts:151` disclose the same Bloomberg-topology fact `Q100-16` flags for the health route | `AT-Q107-bloomberg-ack-gate` | | Q-107 |
| `Q107-S12` | MEDIUM | Security | `middleware.ts` | 119 | The matcher covers every route including all of `/api/*`, but the body (`:51-116`) does CSP and CSRF only — no session check, no route-protection table; positioned to enforce I8 exposure and does not | | | Q-097 |
| `Q107-S13` | MEDIUM | Security/Compliance | `middleware.ts` | 65 | `connect-src 'self' https: wss:` permits browser-direct egress to any host, which is what makes the unregistered browser-direct vendor calls possible; a register-derived allowlist here is the only **runtime** enforcement point available for I8's browser half — advisory until `QUANTAN_CSP_ENFORCE=1` | `AT-Q107-connect-src-allowlist` | owner | Q-106 |
| `Q107-S14` | MEDIUM | Security | `app/api/trading-agents/[ticker]/route.ts` | 317 | A user's LLM credential is forwarded wherever `resolveTradingAgentsBase()` lands, including `managed_fallback` and dev-localhost; the forward is inherent to the sidecar design, **the silent origin substitution is not** | `AT-Q107-byo-key-project-only` | | Q-082, Q-083 |
| `Q107-S15` | MEDIUM | frontend | `components/stock/quantlab/tabs/LlmTab.tsx` | 119 | The destination `source` is fetched (`health/route.ts:52,64`, unconditional) and stored (`useQuantLabLlm.ts:41`) but rendered only when `base` is present — i.e. never in production, so the user cannot learn which third party receives their key | `AT-Q107-byo-key-destination-shown` | frontend | Q-083 |
| `Q107-S16` | — | owner-gated | `.env` (Vercel) | 0 | **OWNER:** is `BLOOMBERG_BRIDGE_URL` set in the Vercel project right now? Not repo-observable; determines whether the S3 gate turns off a live production feed | | owner | Q-082 |
| `Q107-S17` | LOW | Process | `reviews/findings-ledger.csv` | 240 | `Q100-16`'s remediation note ("gate behind auth or remove") omits the shape-oracle and the amplifier, so the next reader re-derives both | | lead | Q-107 |
| `Q107-S18` | — | owner-gated | `.env` (Vercel) | 0 | **OWNER:** `QUANTAN_API_KEY` and `NEXTAUTH_SECRET` — if both are unresolved, **both** auth paths into the new health diagnostic fail closed and the operator loses the tool silently | | owner | Q-097 |
| `Q107-S19` | — | *(unused)* | | | Reserved and not consumed. Recorded so a later reader does not read the gap as a lost row — the failure mode of `Q100-24`. | | | |

**Proposed acceptance tests, named so they can be built rather than gestured at:**

| `AT-` id | Fails when |
|---|---|
| `AT-Q107-health-opaque` | the anonymous `GET /api/bloomberg-bridge/health` body differs between the configured and unconfigured states, by value **or by key set** |
| `AT-Q107-health-no-outbound` | an anonymous call produces any outbound fetch (`expect(calls).toHaveLength(0)`) |
| `AT-Q107-bloomberg-ack-gate` | `BLOOMBERG_BRIDGE_URL` alone enables the bridge; or a near-miss ack value opens it; or the gated fetcher issues a request rather than returning before one |
| `AT-Q107-display-source` | a fundamentals payload carries a `displayPrice` with no `displaySource` naming the feed that produced it |
| `AT-Q107-banner-no-regime-claim` | the banner names any regulator or regime, or asserts that data is delayed |
| `AT-Q107-import-edge-evidence` | a module importing a module that has an egress point produces no evidence of its own |
| `AT-Q107-byo-key-project-only` | a user `api_key` is forwarded when `resolved.source !== 'project'` |
| `AT-Q107-byo-key-destination-shown` | the key input renders without naming the destination class |
| `AT-Q107-connect-src-allowlist` | `connect-src` permits a host with no `end_user_exposed` register row |
| `AT-Q107-declared-unread` | a response-type field is declared with zero readers |

**Every `AT-` above is a PROPOSAL. None has been built and none has been watched
fail.** Per CLAUDE.md, a tier moves only when the artifact is exhibited failing —
naming these does not raise I8, and the ledger rows should carry the `AT-` id as
a target, not as a claim.
