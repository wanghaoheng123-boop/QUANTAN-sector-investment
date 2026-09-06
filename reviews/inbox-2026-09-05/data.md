# Data-integrity deep inspection — `lib/data/`, `scripts/fetchBacktestData.mjs`, `scripts/lib/`, `scripts/verify-*.mjs`, `scripts/backtestData/`, `lib/api/`

Agent: data-integrity. Ids reserved `Q110-D1`–`Q110-D29` (15 used, `D16`–`D29` released).
No source edited. No `git checkout` used. `reviews/findings-ledger.csv` not touched.

## Method

- Read `scripts/verify-data-integrity.mjs` in full to know what it already checks, then wrote an
  independent Python pass over all 56 committed fixtures (`scripts/backtestData/*.json`,
  70,795 rows) checking things it does **not**: zero/negative OHLC, `close` outside `[low,high]`,
  `high<low`, duplicate **calendar** day (as opposed to duplicate epoch second), weekend bars on
  equities, rows before `WINDOW_START` (2021-08-17), row-count parity across the universe, and
  intraday-range moves (open-vs-prior-close) separately from the existing close-vs-close check.
- Ran `node scripts/verify-data-integrity.mjs` and `node scripts/lib/handoverDetect.mjs`'s
  z-score directly against every fixture's own close series to characterize the one control that
  is genuinely statistical (12-sigma outlier), rather than trusting the two WARNs it currently
  emits.
- Read `lib/data/securityId.ts`, `lib/data/warehouse.ts`, `lib/api/rateLimit.ts`,
  `lib/data/mergeQuotes.ts`, `lib/data/bloomberg/bridgeClient.ts`, `lib/api/sanitize.ts` and
  `scripts/verify-btc-ohlc-sample.mjs` end to end, and grepped the whole tree (excluding
  `node_modules`) for every call site of the functions each one exports, to see which of them are
  actually wired into a production path versus only exercised by their own test file.

---

## Ranked findings

### Q110-D1 — CONFIRMED, P0/P1 — `EQIX.json` is silently missing one trading day, and nothing detects it

`scripts/backtestData/EQIX.json` has **1253** candles; every other equity in the 55-name + BTC
universe has **1254** (BTC has 1826, correctly, since crypto trades 7 days/week). The missing day,
found by diffing EQIX's date set against AAPL's, is **2026-07-31, a Friday** — not a weekend, not
a US market holiday (every other name in the universe, including AAPL, has a bar for it).

```
scripts/backtestData/EQIX.json:1242-1243 (via the `time` epoch field)
  2026-07-30 (Thu)  close 1047.53
  2026-08-03 (Mon)  close 1031.44        <- 2026-07-31 (Fri) is simply absent
```

The gap is exactly `(1785763800 - 1785418200) / 86400 = 4.0` calendar days.
`scripts/verify-data-integrity.mjs:88-92` only hard-fails an equity gap `> 5` days — a single
missing weekday immediately before a weekend collapses into a 4-day gap and is invisible to that
threshold. `npm run verify:integrity` currently reports **0 hard failures** on this file.

Likely mechanism (not confirmed, stated as such): `scripts/fetchBacktestData.mjs:220-227`
(`isFiniteRow`) silently drops any row where Yahoo returns a non-finite OHLC value — exactly the
kind of single-symbol NaN blip this filter exists to catch, but the drop leaves **no trace**: no
count of dropped rows is compared against a calendar, and the "(dropped N non-finite rows)" log
line (`:253`) is only printed to the workflow console, never asserted against.

This is the fixture-as-DATA failure mode the audit checklist calls out directly ("gaps that are
not market holidays") and it is live on `main` today, not hypothetical.

**Proposed diff** (not applied): extend `scripts/verify-data-integrity.mjs`'s per-file loop to
additionally assert full-universe date-set parity — build the union of dates across all
non-crypto fixtures and FAIL any file missing a date that `>= N-1` of its peers have (a single
holiday genuinely absent for everyone is fine; a date present in every peer but one is not).
That is a much stronger test than a per-file day-count threshold and would have caught this.

---

### Q110-D2 — CONFIRMED, P1 — the only cross-vendor quorum check for crypto data never runs in CI

`scripts/verify-btc-ohlc-sample.mjs:61-82` validates Kraken's own OHLC self-consistency
unconditionally, but the comparison against this app's own `/api/crypto/btc` route — the only
place in the whole repo that checks one vendor's BTC price against another's, i.e. the
"multi-vendor quorum" the audit checklist asks for — is gated behind `process.env
.VERIFY_APP_BASE_URL`. If unset, the script prints `(Set VERIFY_APP_BASE_URL to compare with
local Next /api/crypto/btc)` and exits 0.

```
grep -rln "VERIFY_APP_BASE_URL" .github/workflows/   ->  (no matches)
```

`VERIFY_APP_BASE_URL` is not set anywhere in `.github/workflows/`, and `verify:btc`
(`package.json:18`) is chained into `verify:data` (`:21`) which is chained into `check:ci`
(`:23`). So on every CI run and every local `check:ci`, this script silently takes the skip
branch: it proves Kraken's OHLC is internally consistent and proves **nothing** about agreement
with the vendor this platform actually serves to users. `npm run verify:btc` reports "All
verify-btc-ohlc-sample checks passed" whether or not the app's BTC feed is anywhere near Kraken's.
Confirmed by running the script locally (no local Next server was started, and it passed).

Severity: this is the single spot in the repo closest to satisfying "N-of-M agreement within
tolerance," and its N-of-M half has a 0% execution rate in every automated run. A silent BTC feed
divergence (bad vendor, stale cache, wrong pair) would never be caught by this gate.

---

### Q110-D3 — CONFIRMED, P1 — `assertNoIdCollisions` (I6's own collision guard) has zero production call sites

```
grep -rn "assertNoIdCollisions" --include="*.ts" --include="*.mjs" .
  __tests__/data/securityId.test.ts   (5 call sites, all in tests)
  lib/data/securityId.ts:32, :108     (comment + definition)
```

The function is exported specifically to "fail loudly when one identity carries conflicting
attributes" (`lib/data/securityId.ts:94-107`), and its own doc-comment states the assumption it
protects ("BRK.B and BRK-B are the same security... not self-evidently true forever"). Nothing in
`scripts/fetchBacktestData.mjs` (whose `TICKERS` array at `:13-67` is exactly the
`UniverseEntry[]` shape this function expects — `{ticker, sector}` maps to `{symbol, attribute}`
one-for-one), nor in `lib/backtest/dataLoader.ts`, nor in `lib/optimize/sectorProfiles.ts`, ever
calls it. This is the same shape of defect this repo has now found three separate times
(`Q-080`, `Q-098`, `Q-103` — "when a guard is green, ask what it visited"): a correct, tested,
well-designed check that is wired to nothing, so it is decoration on every real run.

Currently harmless (56-name fixed universe, no collision exists — verified: running the check
against the actual `TICKERS` array + BTC produces zero collisions), but the whole point of the
function is to catch a *future* one, and today it cannot, because it never runs outside a test.

**Proposed diff** (not applied): call `assertNoIdCollisions(TICKERS.map(t => ({symbol: t.ticker,
attribute: t.sector})))` once at the top of `scripts/fetchBacktestData.mjs`'s `main()`, before any
fetch begins, so a future universe edit that introduces a real collision fails the refresh
workflow instead of silently splicing histories.

---

### Q110-D4 — CONFIRMED, P2 — the single-day-move check only looks at close-to-close; a same-session spike/reversion is invisible

`scripts/verify-data-integrity.mjs:93` computes `move = |close/prevClose - 1|` and WARNs above
35%. It never looks at `open`, `high`, or `low` relative to the prior close. Demonstrated with a
real (not synthetic) case already on disk:

```
scripts/backtestData/AMD.json — 2025-10-03 close 164.67 -> 2025-10-06:
  open  226.45  (+37.5% vs prior close)
  high  226.71  (+37.7%)
  low   203.01
  close 203.71  (+23.7% vs prior close)   volume 248,859,600 (vs ~40-55M the prior week)
```

The close-to-close move (23.7%) is real and, correctly, under the 35% threshold — this is the
real AMD/OpenAI-deal session and is not being flagged as an error. The point is structural: had
the open/high print been a bad tick that fully reverted by the close (a fat-finger, a crossed
NBBO snapshot, an options-related bad print), the existing check would show **nothing** — no WARN,
no entry needed in `KNOWN_EVENTS`, no signal at all — because it never examines the bars that
actually moved. Any downstream consumer of `high`/`low` (ATR, ATR-multiple stops, intrabar
stop-hit logic) would silently ingest the bad print.

**Proposed diff**: add a second WARN class comparing `max(open,high)/prevClose - 1` and
`min(open,low)/prevClose - 1` against the same 35% bar, independent of the close-to-close test.

---

### Q110-D5 — CONFIRMED (quantified), P2 — the 12-sigma handover detector's own denominator includes the outlier it's testing

`scripts/lib/handoverDetect.mjs:42-47` computes `mean`/`variance`/`sd` over the **entire** series,
including whatever extreme bar is later tested against that same `sd` at `:51`. A genuine crash
inflates its own detection threshold. Quantified directly on the two real events this file
currently flags:

```
UNH: sd computed WITH  its -22.5%(ish) crash bar = 0.020803  -> z = 12.18
     sd computed WITHOUT that bar                = 0.019539  -> z = 12.97   (ratio 1.065, i.e. +6.5% sd inflation)
     DEFAULT_SIGMAS = 12.0  ->  margin shrinks from +8.1% (clean) to +1.5% (self-inflated)
```

UNH is the one case in the current corpus that is *close* to the 12.0 cutoff at all — every other
ticker's max z-score is well clear (NFLX 15.24, META 10.77, everything else <11 — computed
independently across all 56 fixtures). So this defect is not causing a live false negative today
(measured, not assumed), but the margin on the one control this repo relies on to catch "silent
ticker handover" is materially thinner than the "12 sigma" label implies, and is inherently
self-weakening: a series that contains two large moves (or a shorter series, post-refresh) would
inflate its own `sd` further and could push a genuine event under the bar with zero warning —
exactly the silent failure I6's compensating control exists to prevent.

**Proposed diff**: compute `sd` via one round of trimming (drop the single largest `|logRet -
mean|` observation, or use a median-absolute-deviation estimator) before testing every point
against it, so an outlier cannot suppress its own detection.

---

### Q110-D6 / Q110-D7 — CONFIRMED, P2 — the SQLite warehouse write path has zero production callers, and the read-priority architecture it implies is dead code

```
grep -rln "upsertCandles|upsertQuote" --include="*.ts" --include="*.mjs" --include="*.js" .
  __tests__/data/warehouse.test.ts
  lib/data/warehouse.ts   (definition only)
```

`upsertCandles`/`upsertQuote` (`lib/data/warehouse.ts:194-222`) are the **only** writers into the
`candles`/`quotes` tables, and nothing outside the warehouse module's own test calls either one.
`lib/backtest/dataLoader.ts`'s docstring (`:2-3`) claims "Priority: SQLite warehouse → local JSON
file," but the `candles` table is permanently empty in every environment this repo actually runs
in (`getDb()` also returns `null` on Vercel per `warehouse.ts:19-24`'s own comment), so
`isWarehouseAvailable()` is false or the table is empty either way, and every read call in
`dataLoader.ts` falls through to the JSON fixture path 100% of the time. The "warehouse-first"
architecture described in the code is not what runs.

Separately, and more important if this is ever wired up: `upsertCandles` does
`INSERT OR REPLACE INTO candles ... PRIMARY KEY (ticker, date)` (`:54`, `:198-199`) with **zero**
restatement detection — no diff against the prior row, no fingerprint, no log of what changed. This
sits in stark contrast to the JSON-fixture path's `scripts/lib/dataVintage.mjs` (`assessRefresh` /
`REFUSED` / quarantine), which exists specifically because an unconditional overwrite once
absorbed a vendor restatement silently (`Q-102`). If a writer is ever added to the warehouse path
without importing the same `assessRefresh` machinery, a genuine vendor correction (or a bad
overwrite from a bug) would silently destroy the previous value with no trace — the exact failure
mode I2/I4 exist to prevent. Currently dormant only because nothing writes here yet; flagging so
it is not rediscovered live.

---

### Q110-D8 — CONFIRMED, P3 — `warehouse.ts`'s connection-failure path is completely silent, inconsistent with its own query-failure paths

`getDb()` (`lib/data/warehouse.ts:32-42`) swallows any error constructing `new Database(...)` or
running `createSchema()` with a bare `catch { return null }` — **no** `console.warn`/`error`
anywhere in that path. Compare `getCandles`/`getCachedQuote`/`warehouseTickers`
(`:124-134`, `:158-166`, `:178-185`), which all log a structured
`{event: 'warehouse.X_error', ...}` warning on a query-level failure against an already-open DB. A
total warehouse outage (corrupt DB file, disk full, permissions) at connect time produces **zero**
log lines anywhere in the process, while a query hiccup on a working DB does get logged. Given
`Q110-D6/D7` above, this is currently low-blast-radius (nothing depends on the warehouse working),
but it is the wrong way around: the failure mode that should be loudest (the store is completely
unavailable) is the one that's silent.

---

### Q110-D9 / Q110-D10 — CONFIRMED, P1/P2 — the rate limiter's key is attacker-controlled, and the in-memory limit it falls back to is not a real global limit

`lib/api/rateLimit.ts:127-138`:
```ts
if (isVercel) {
  ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}
```
`X-Forwarded-For` is an append-only header: each hop appends the peer IP it observed to the end of
the list; nothing strips or overwrites a value the direct client supplies before Vercel's edge
sees the request. Taking `.split(',')[0]` therefore reads **whatever the client put there**, not
a value Vercel's edge itself vouches for. Confirmed no mitigation exists between the client and
this code: `grep -n "x-forwarded-for" middleware.ts` returns nothing — `middleware.ts` only
applies CSP/CSRF, it does not touch or re-derive this header.

Two concrete, distinct attacks follow directly from this:
1. **Self-bypass**: an attacker sends a fresh random `X-Forwarded-For` prefix on every request.
   `getRateLimitKey` computes a new bucket key each time, so the same attacker gets a brand-new,
   full token bucket on every request — unlimited effective throughput against any route protected
   only by `applyRateLimit`.
2. **Victim DoS**: an attacker sets `X-Forwarded-For: <victim's real IP>` and hammers a route.
   The victim's bucket key gets drained, and the victim — who connects with that real IP
   legitimately — starts receiving 429s the rate limiter itself never intended for them.

This is compounded by `checkRateLimitMemory`'s bucket store (`lib/api/rateLimit.ts:9`,
`const buckets = new Map(...)`), which is **per-serverless-instance**: under Vercel's model this
is not one global counter, it is one counter per warm lambda instance, reset on every cold start.
`isKvConfigured()` (`:75-77`) requires `KV_REST_API_URL`/`KV_REST_API_TOKEN`; there is no evidence
either is provisioned in this deployment — `.env.example:44-47` ships both **commented out** as
placeholders, and no workflow or ops doc references a live value (checked
`workspace/VERCEL_OPERATIONS.md`, which documents the env var's *purpose* at `:191` but records no
provisioning status). `applyRateLimit` is called from 27 route files
(`grep -rln "applyRateLimit(" app/`); every one of them is, as far as this repo shows, on the
memory-only path in production, meaning the declared `maxRequests` per route is not the actual
ceiling — the actual ceiling is `maxRequests × (however many instances Vercel is running that
moment)`, and it resets whenever an instance recycles.

Severity split: the spoofability (D9) is the more serious half — it is a genuine, exploitable
availability bug regardless of KV status, since KV-backed distributed limiting (`checkRateLimitKv`,
`:79-125`) keys off the exact same `getRateLimitKey` output and is equally spoofable. The
per-instance/no-KV-evidence half (D10) is closer to an operational fact than a code defect, but it
means the platform's actual current enforcement is materially weaker than "N requests per window"
implies, for every one of the 27 protected routes.

**Proposed diff** (not applied, needs an owner call on trust boundary): if Vercel's own connecting
IP is available via a platform-verified mechanism (Vercel sets `x-vercel-*` / has an SDK-level
geo/ip primitive on some plans), prefer that over any client-suppliable header; failing that, take
the **last**, not first, comma-separated value of `x-forwarded-for` (the hop closest to the actual
edge), and never trust it as an authorization decision, only as a best-effort throttle key.

---

### Q110-D11 — PLAUSIBLE, P4 (forward risk only, not live) — `securityId.ts`'s "trailing single letter = share class" rule is false for a real ticker convention

`lib/data/securityId.ts:50` (`SHARE_CLASS = /^([A-Z0-9]+)[.-]([A-Z])$/`) treats any
prefix-separator-single-letter symbol as a share class of the same issuer. Real exchange
convention uses the identical shape for economically distinct securities that are **not** a share
class of the common stock: SPAC/exchange **Units** (`-U` / `.U`) and **Rights** (`-R` / `.R`)
suffixes. `dataFileNameFor`/`canonicalSecurityId` would silently apply the "just a class variant"
canonicalization to such a symbol.

Checked against live impact: no id COLLISION actually results (a Unit's id `XYZ.U` stays distinct
from the common's plain id `XYZ`), and no ticker in the current 56-name universe uses this
convention (`grep` of `TICKERS` in `scripts/fetchBacktestData.mjs` shows only `BRK-B` uses a
hyphen suffix, and `B` genuinely is Berkshire's real share class). So this is a **forward-looking**
documentation/assumption gap, not an active defect: flag it before the universe ever expands to
include a SPAC-related name, don't treat it as urgent today.

---

### Q110-D12 — PLAUSIBLE, unfalsifiable from the committed artifact by design, P3 — a dividend event that doesn't match a bar is dropped with no trace

`scripts/fetchBacktestData.mjs:229-247`: dividend events are matched to their bar purely by
`new Date(x).toISOString().slice(0,10)` equality between the vendor's dividend-event date and a
surviving candle's date. If a dividend's ex-date lands on a day whose bar got filtered out by
`isFiniteRow` (`:220-227`, see `Q110-D1`), or the vendor's event date is off by a day relative to
the bar date for any reason, `divByDay.get(day)` silently returns `undefined` for that candle and
the dividend amount is dropped — no error, no count of "N events, M attached, K dropped" (the
`"(+N dividend bars)"` log line at `:253` reports `divByDay.size`, i.e. **all vendor-reported
events**, not how many actually landed on a surviving bar). This means the committed fixture
itself cannot be forensically audited for this failure mode after the fact — the dropped event
leaves nothing behind to diff against. Stated as a null result with the reason: I cannot confirm
or rule out that this has happened on any of the 258 dividend-bearing bars currently on disk,
because the artifact needed to check (the raw, pre-match vendor event list) is not persisted.

**Proposed diff**: log (or persist) unmatched dividend events explicitly — `divByDay.size` vs
`attachedCount` — so a mismatch becomes visible instead of silently absorbed into "fewer dividend
bars than expected" that nobody would notice.

---

### Q110-D13 — CONFIRMED (code), LATENT (Bloomberg bridge not configured in this deployment), P3 — `change`/`changePct`/`price` never fall back to Yahoo and are exempt from the sentinel-field warning

`lib/data/mergeQuotes.ts:105-116` and `:118-133`: `volume`/`high52w`/`low52w`/`pe`/`marketCap` all
use `bb.field || y.field` with provenance recorded per-field (and, in the Bloomberg-only branch at
`:153-166`, an explicit `sentinelFields` warning is logged when any of those five is a sentinel
zero/`'N/A'`). `price`, `change`, and `changePct` (`:106-108`, `:120-122`) have **no** fallback and
are **not** covered by the sentinel-field warning at all. `price` is protected upstream —
`lib/data/bloomberg/bridgeClient.ts:113` (`if (price <= 0) continue`) drops any row with a
non-positive price before it ever reaches the map, so `bb.price` is guaranteed `>0` whenever an
entry exists — but `change`/`changePct` have no equivalent guard, and `bridgeClient.ts:44-51`'s
`num()` coerces any missing/malformed field to a literal `0`. A Bloomberg row with a genuinely
missing `change`/`changePct` field would silently render as "0% today, sourced Bloomberg" — visually
identical to a truly flat stock, with zero warning, unlike the five fields that already have this
protection.

Checked for live exposure: `BLOOMBERG_BRIDGE_URL` ships commented out in `.env.example:67`, and
`workspace/VERCEL_OPERATIONS.md:191` only documents the variable's purpose, recording no
provisioning. No evidence this bridge is active in this deployment today — flagged as a latent
gap in an existing merge path, not a live corruption.

---

### Q110-D14 — CONFIRMED (comment contradicts behavior), dead code today, P4 — `lib/api/sanitize.ts:66-71`'s `num()` docstring claims a property it cannot have

```ts
/**
 * Number-or-zero coercion. Returns 0 for non-finite inputs.
 * Use this instead of `value || 0` so that a legitimate 0 isn't conflated
 * with `undefined` / `null` / `NaN`.
 */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
```
This function maps a genuine `0` and a missing/`NaN`/`undefined` input to the **identical** output
(`0`) — there is no way for any caller to tell them apart afterward, which is exactly what the
comment says this avoids. (Its actual, different, real benefit over `value || 0` is guaranteeing a
numeric return type against non-numeric truthy inputs like strings — a real but different
property than the one claimed.) Checked for live exposure: `grep` for `import.*{[^}]*\bnum\b.*
sanitize` across the tree returns exactly one hit, `__tests__/api/sanitize.test.ts` — **zero**
production callers. Flagged as a documentation/comment defect and a landmine for whoever wires it
up next expecting the claimed property, not as a live bug (`Q107`'s own lesson: tagged code ≠
fixed effect — this is the same shape, applied to a comment's *claim* rather than a behavior tag).

---

## Null results (checked, clean — stated so absence of a finding is evidence, not an oversight)

All of the following were run independently across **all 56 fixtures / 70,795 rows** in
`scripts/backtestData/`, separately from `scripts/verify-data-integrity.mjs`:

- **Zero or negative OHLC values**: 0 occurrences.
- **`close` outside `[low, high]`**: 0 occurrences (also implicitly covered by the existing
  verifier's `ohlcOk` conjunction).
- **`high < low`**: 0 occurrences.
- **Duplicate calendar day** (as opposed to duplicate epoch second, which the existing verifier
  already checks): 0 occurrences.
- **Weekend bars on non-crypto tickers**: 0 occurrences.
- **Rows dated before `WINDOW_START` (2021-08-17)**: 0 occurrences. (No verifier currently asserts
  this either way — noted as a gap, not exercised.)
- **Row-count parity across the 55-equity + BTC universe**: 54/55 equities at exactly 1254 rows;
  the sole exception is `EQIX` at 1253 (`Q110-D1`, above); `BTC` at 1826 (correct for 7-day trading).
- **Split-adjustment sanity check on NVDA's 2024-06-10 10:1 split** (in addition to the already-
  verified Phase 10 case): close series is smooth across the split date (120.89 → 121.79 → 120.91
  → 125.20, no jump) — confirms the already-known "chart() returns split-adjusted close" property
  holds for this fixture too; not a new finding, recorded as a check performed.
- **Dividend rows are never appended as separate array entries**: confirmed by reading
  `scripts/fetchBacktestData.mjs:229-247` — the `dividend` amount is attached as an optional field
  on the same OHLCV bar object for its ex-date, never pushed as its own row into `candles`. No
  fixture has a row shaped like a dividend-only entry (spot-checked all 47 dividend-bearing files'
  row counts against their non-dividend peers — no extra rows, only extra fields on existing
  rows). So the specific "a dividend row could be mistaken for a price bar" risk named in the brief
  does **not** materialize structurally — see `Q110-D12` for the narrower, real residual risk (a
  *dropped*, not misclassified, dividend).
- **`checkRateLimit` (deprecated, memory-only, bypasses KV)**: zero production callers
  (`grep` confirms only its own definition) — the deprecation is not being silently ignored
  anywhere; only `applyRateLimit` is used, and its own issue is `Q110-D9`/`D10` above, not this one.

---

## Ranked list

1. **Q110-D1** — CONFIRMED, P0/P1 — `EQIX.json` silently missing 2026-07-31; existing gap check's
   >5-day threshold misses it.
2. **Q110-D2** — CONFIRMED, P1 — the only cross-vendor (Kraken-vs-app) BTC check never executes in
   CI (`VERIFY_APP_BASE_URL` unset everywhere).
3. **Q110-D3** — CONFIRMED, P1 — `assertNoIdCollisions` (I6's collision guard) has zero production
   call sites.
4. **Q110-D9** — CONFIRMED, P1 — rate-limit key derivation trusts an attacker-suppliable
   `X-Forwarded-For` value; enables both self-bypass and targeted victim DoS.
5. **Q110-D10** — CONFIRMED, P2 — no evidence KV is provisioned; the in-memory fallback's limit is
   per-instance, not global, on all 27 protected routes.
6. **Q110-D4** — CONFIRMED, P2 — outlier check is close-to-close only; demonstrated blind to a real
   intraday open/high spike (AMD 2025-10-06).
7. **Q110-D6/D7** — CONFIRMED, P2 — SQLite warehouse write path is dead code; if ever wired up, it
   has no restatement detection unlike the JSON-fixture path.
8. **Q110-D5** — CONFIRMED (quantified), P2 — handover detector's z-score denominator includes the
   tested outlier; margin on UNH shrinks from +8.1% to +1.5% due to self-inflation.
9. **Q110-D13** — CONFIRMED (code), latent, P3 — `change`/`changePct` bypass Bloomberg's
   sentinel-zero fallback and warning; dormant because the bridge isn't configured here.
10. **Q110-D8** — CONFIRMED, P3 — warehouse connection failures are completely unlogged, unlike its
    own query failures.
11. **Q110-D12** — PLAUSIBLE, unfalsifiable by design, P3 — a dividend event that misses its bar is
    dropped with no trace kept.
12. **Q110-D11** — PLAUSIBLE, forward risk only, P4 — share-class rule is false for real Units/
    Rights ticker suffixes; no live collision in the current universe.
13. **Q110-D14** — CONFIRMED (comment vs. behavior), dead code, P4 — `sanitize.ts`'s `num()`
    docstring claims a property the function does not have.
