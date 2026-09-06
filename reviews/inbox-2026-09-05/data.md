# Data-integrity deep inspection — `lib/data/`, `scripts/fetchBacktestData.mjs`, `scripts/lib/`, `scripts/verify-*.mjs`, `scripts/backtestData/`, `lib/api/`

Agent: data-integrity. Ids reserved `Q110-D1`–`Q110-D29` (13 used, `D15`–`D29` released).
No source edited. No `git checkout` used. `reviews/findings-ledger.csv` not touched.

## Method

- Read `scripts/verify-data-integrity.mjs` in full to know what it already checks, then wrote an
  independent Python pass over all 56 committed fixtures (`scripts/backtestData/*.json`,
  70,795 rows) checking things it does **not**: zero/negative OHLC, `close` outside `[low,high]`,
  `high<low`, duplicate **calendar** day (as opposed to duplicate epoch second), weekend bars on
  equities, rows before `WINDOW_START` (2021-08-17), first-bar-date parity across the universe,
  row-count parity across the universe, stored vintage metadata (`rows`/`windowStart`/`fingerprint`
  /`vintage`) vs the actual array, and intraday-range moves (open-vs-prior-close) separately from
  the existing close-vs-close check.
- **Actually ran** `node scripts/verify-data-integrity.mjs` (0 hard failures, 2 warnings: NFLX,
  UNH — matches "already known") and `node scripts/verify-btc-ohlc-sample.mjs` (live network call
  to Kraken; output quoted verbatim below) rather than inferring their behavior from source.
- Reimplemented `canonicalSecurityId`'s exact rule in a throwaway Node script and ran it against
  the real `TICKERS` array parsed out of `scripts/fetchBacktestData.mjs` (+ BTC), rather than
  asserting "no collision" from reading the code alone.
- Read `lib/data/securityId.ts`, `lib/data/warehouse.ts`, `lib/api/rateLimit.ts`,
  `lib/data/mergeQuotes.ts`, `lib/data/bloomberg/bridgeClient.ts`, `lib/api/sanitize.ts` and
  `scripts/verify-btc-ohlc-sample.mjs` end to end, and grepped the whole tree (excluding
  `node_modules`) for every call site of the functions each one exports, to see which of them are
  actually wired into a production path versus only exercised by their own test file.
- Checked `git log` for `scripts/backtestData/` and `.github/workflows/refresh-data.yml` to
  establish when the committed fixtures were actually last regenerated, rather than assuming
  "committed" means "current."

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
threshold. **Ran** `npm run verify:integrity` directly: it reports **0 hard failures** on this
file, confirming the gap is live and undetected today, not a theoretical hole in the threshold.

Likely mechanism (stated as such, not confirmed): `scripts/fetchBacktestData.mjs:220-227`
(`isFiniteRow`) silently drops any row where Yahoo returns a non-finite OHLC value — exactly the
kind of single-symbol NaN blip this filter exists to catch, but the drop leaves no trace: no count
of dropped rows is compared against a calendar.

**Context that bears on root cause, checked via `git log`, not asserted:** `EQIX.json`'s
`fetchedAt` is `2026-08-16T22:18:10.482Z`, and **every one of the 56 fixtures** shares that same
batch (all 56 `fetchedAt` timestamps fall within a single 7-second window on 2026-08-16) — this is
the last weekly refresh commit that actually landed (`git log --oneline -- scripts/backtestData/`
→ `2d71ceb chore(data): weekly backtest data refresh (2026-08-16)`, with no commit to that path
since). `git log` on this same branch already documents why: `4396ba0` ("Q107-O2: scheduled
workflows now say when they break") states outright that `refresh-data.yml` "broke on 2026-08-23
and ran dead for a fortnight," and this exact session's own commit sequence
(`3f70a6b`/`504fa43`/`9ab2bab`, all dated today) has been actively repairing the workflow-parsing
bug that caused it. So: **the frozen-since-08-16 state is already known and already being fixed on
this branch — not a new finding.** The residual, still-open action item genuinely in this
territory: fixing the workflow does not, by itself, refresh the data. `scripts/backtestData/` is
still ~3 weeks stale as of this report, none of the 56 files yet carry the `rows`/`windowStart`
/`fingerprint`/`vintage` fields `Q-102` (`05aa3be`, merged 2026-08-21 — *after* the last successful
refresh) added to `saveResult()`'s output, and the EQIX gap has not yet had a chance to either
self-heal (if Yahoo's own history backfills that date) or be forced into a visible `REFUSED`/
quarantine (`Q-102`'s `assessRefresh`) the next time the fetch actually runs. Recommend: once the
workflow is confirmed parseable, manually `workflow_dispatch` it and re-check `EQIX.json`
specifically — if the 2026-07-31 bar still doesn't appear, that upgrades this from "one silently
dropped row" to "Yahoo itself has no data for this symbol on this date," which is a materially
different, worse finding.

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
.VERIFY_APP_BASE_URL`. **Ran it** (`node scripts/verify-btc-ohlc-sample.mjs`, live Kraken call):

```
✓ Kraken HTTP 200
✓ Kraken error array empty
... (all 10 kraken[i] OHLCV/bounds checks pass)
  (Set VERIFY_APP_BASE_URL to compare with local Next /api/crypto/btc)
All verify-btc-ohlc-sample checks passed.
exit code: 0
```
— confirming exactly the predicted behavior: it validates Kraken's internal OHLC consistency and
skips the app-comparison branch entirely, exiting 0 either way.

```
grep -rln "VERIFY_APP_BASE_URL" .github/workflows/   ->  (no matches)
grep -n "verify:data" .github/workflows/ci.yml        ->  ci.yml:116: run: npm run verify:data
```
`VERIFY_APP_BASE_URL` is not set anywhere in `.github/workflows/`, and `verify:btc`
(`package.json:18`) is chained into `verify:data` (`:21`), which **is** wired into CI
(`ci.yml:116`). So on every CI run this script silently takes the skip branch: it proves Kraken's
OHLC is internally consistent and proves **nothing** about agreement with the vendor this platform
actually serves to users. `npm run verify:btc` reports "All verify-btc-ohlc-sample checks passed"
whether or not the app's BTC feed is anywhere near Kraken's.

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
attributes" (`lib/data/securityId.ts:94-107`). Nothing in `scripts/fetchBacktestData.mjs` (whose
`TICKERS` array at `:13-67` is exactly the `UniverseEntry[]` shape this function expects —
`{ticker, sector}` maps to `{symbol, attribute}` one-for-one), nor in `lib/backtest/dataLoader.ts`,
nor in `lib/optimize/sectorProfiles.ts`, ever calls it. This is the same shape of defect this repo
has now found three separate times (`Q-080`, `Q-098`, `Q-103` — "when a guard is green, ask what
it visited"): a correct, tested, well-designed check that is wired to nothing, so it is decoration
on every real run.

**Ran** a reimplementation of `canonicalSecurityId`'s exact rule against the real `TICKERS` array
parsed out of `scripts/fetchBacktestData.mjs` plus the `BTC` entry `fetchBTC` saves under (56
entries total): 0 collisions, 0 ids shared by more than one raw symbol. So the guard's absence is
currently harmless on today's fixed universe — confirmed, not assumed — but the whole point of the
function is to catch a *future* collision, and today it cannot, because it never runs outside a
test.

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
real AMD/OpenAI-deal session and is not being flagged as an error (confirmed it does not appear in
the `verify:integrity` output above). The point is structural: had the open/high print been a bad
tick that fully reverted by the close (a fat-finger, a crossed NBBO snapshot, an options-related
bad print), the existing check would show **nothing** — no WARN, no entry needed in
`KNOWN_EVENTS`, no signal at all — because it never examines the bars that actually moved. Any
downstream consumer of `high`/`low` (ATR, ATR-multiple stops, intrabar stop-hit logic) would
silently ingest the bad print.

**Proposed diff**: add a second WARN class comparing `max(open,high)/prevClose - 1` and
`min(open,low)/prevClose - 1` against the same 35% bar, independent of the close-to-close test.

---

### Q110-D5 — CONFIRMED (quantified), P2 — the 12-sigma handover detector's own denominator includes the outlier it's testing

`scripts/lib/handoverDetect.mjs:42-47` computes `mean`/`variance`/`sd` over the **entire** series,
including whatever extreme bar is later tested against that same `sd` at `:51`. A genuine crash
inflates its own detection threshold. Quantified directly (computed, not estimated) on the two real
events this file currently flags:

```
UNH: sd computed WITH  its real crash bar = 0.020803  -> z = 12.18
     sd computed WITHOUT that bar         = 0.019539  -> z = 12.97   (ratio 1.065, +6.5% sd inflation)
     DEFAULT_SIGMAS = 12.0  ->  margin shrinks from +8.1% (clean) to +1.5% (self-inflated)
```

UNH is the one case in the current corpus that is *close* to the 12.0 cutoff at all — every other
ticker's max z-score is well clear (NFLX 15.24, META 10.77, everything else <11 — computed
independently across all 56 fixtures). So this defect is not causing a live false negative today
(measured, not assumed), but the margin on the one control this repo relies on to catch "silent
ticker handover" is materially thinner than the "12 sigma" label implies, and is inherently
self-weakening: a series that contains two large moves (or a shorter series, post-refresh) would
inflate its own `sd` further and could push a genuine event under the bar with zero warning.

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
overwrite from a bug) would silently destroy the previous value with no trace. Currently dormant
only because nothing writes here yet; flagging so it is not rediscovered live.

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

### Q110-D9 — PLAUSIBLE (pending one platform fact I do not have), P1/P2 if confirmed — the rate limiter's key may be attacker-controlled

`lib/api/rateLimit.ts:127-138`:
```ts
if (isVercel) {
  ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}
```
Taking the **first** comma-separated value of `X-Forwarded-For` is a well-known anti-pattern
*when* the header is append-only and the edge in front of the app does not overwrite a
client-supplied prefix — under generic reverse-proxy semantics, each hop appends its observed peer
IP to the end of the list, so position `[0]` is whatever the direct client wrote, not a value the
edge vouches for. **I could not establish, from anything in this repository, whether Vercel's own
edge overwrites or sanitizes `X-Forwarded-For` for serverless-function invocations** before this
code sees it — that platform behavior is the fact that decides whether this is exploitable or
inert, and it is off-repo (Vercel's own routing implementation / the owner's account docs). Checked
for an in-repo mitigation and found none: `grep -n "x-forwarded-for" middleware.ts` returns
nothing — `middleware.ts` only applies CSP/CSRF, it does not touch or re-derive this header before
`getRateLimitKey` reads it. So: no code in this repo protects against a spoofed value; whether the
platform does is UNVERIFIED here.

If it is spoofable, two concrete attacks follow: (1) an attacker sends a fresh random prefix on
every request, getting a brand-new token bucket each time — unlimited effective throughput; (2) an
attacker sets the header to a **victim's** real IP, draining that key's bucket so the victim (who
connects with that real IP) gets 429'd. The KV-backed path (`checkRateLimitKv`, `:79-125`) keys off
the **exact same** `getRateLimitKey` output, so if the memory path is spoofable, the distributed
path is equally spoofable — that sub-claim does not depend on the open platform question.

**What would resolve this**: confirm with Vercel's own routing docs / the project owner whether
`x-forwarded-for` reaching a Next.js Route Handler on Vercel is edge-verified (overwritten) or
passthrough (client-suppliable, then appended-to). If passthrough, this is CONFIRMED and should be
escalated; if edge-verified, this finding closes as N/A. Do not guess in either direction.

---

### Q110-D10 — UNVERIFIED (decisive evidence is off-repo), context for `Q110-D9` — no in-repo evidence the KV-backed distributed rate limiter is provisioned

`.env.example:44-47` ships `KV_REST_API_URL`/`KV_REST_API_TOKEN` **commented out** as placeholders,
and `workspace/VERCEL_OPERATIONS.md:191` documents the variable's *purpose* but records no
provisioning status. `isKvConfigured()` (`lib/api/rateLimit.ts:75-77`) requires both to be set, and
`applyRateLimit` is called from 27 route files (`grep -rln "applyRateLimit(" app/`). Whether the
live Vercel project actually has these two secrets set is a fact about the Vercel dashboard / the
owner's account, not something visible in this repository — a commented-out example file proves
nothing about production configuration either way, and I am not asserting it does. **If** they are
unset in production, every one of the 27 routes is on the memory-only path, whose bucket store
(`lib/api/rateLimit.ts:9`) is a plain module-level `Map` — per-serverless-instance under Vercel's
model, not global, and reset on every cold start, meaning the *actual* enforced ceiling would be
`maxRequests × (however many instances are warm)` rather than the configured `maxRequests`. Flagging
as the specific, checkable question the owner (or whoever has Vercel project access) should answer,
not as a confirmed defect.

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
convention (only `BRK-B` uses a hyphen suffix, and `B` genuinely is Berkshire's real share class —
confirmed by the `Q110-D3` re-implementation run above). So this is a **forward-looking**
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
leaves nothing behind to diff against.

**Ran the actual count** (correcting an earlier draft of this report that guessed): **50 of 56**
fixtures carry at least one `dividend` field, **969** dividend-bearing bars total across the
corpus. Stated as a null result on the specific failure mode with the reason it can't be fully
ruled out: I cannot confirm or rule out that a dividend has ever been silently dropped on any of
those 969 bars, because the artifact needed to check (the raw, pre-match vendor event list) is not
persisted by the fetch script.

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
up next expecting the claimed property, not as a live bug.

---

## Null results (checked, clean — stated so absence of a finding is evidence, not an oversight)

All of the following were run independently across **all 56 fixtures / 70,795 rows** in
`scripts/backtestData/`, separately from `scripts/verify-data-integrity.mjs`:

- **Zero or negative OHLC values**: 0 occurrences.
- **`close` outside `[low, high]`**: 0 occurrences.
- **`high < low`**: 0 occurrences.
- **Duplicate calendar day** (as opposed to duplicate epoch second, which the existing verifier
  already checks): 0 occurrences.
- **Weekend bars on non-crypto tickers**: 0 occurrences.
- **Rows dated before `WINDOW_START` (2021-08-17)**: 0 occurrences. (No verifier currently asserts
  this either way — noted as a gap, not exercised.)
- **First-bar-date parity**: all 56 fixtures' earliest row is exactly `2021-08-17` — matches
  `scripts/lib/dataVintage.mjs:31-33`'s stated claim precisely, checked rather than trusted.
- **Row-count parity across the 55-equity + BTC universe**: 54/55 equities at exactly 1254 rows;
  the sole exception is `EQIX` at 1253 (`Q110-D1`, above); `BTC` at 1826 (correct for 7-day trading).
- **Stored vintage metadata (`rows`/`windowStart`/`fingerprint`/`vintage`) vs actual array**: none
  of the 56 committed files carry any of these four fields at all (0/56 for each) — not a
  mismatch, an absence. Explained, not just observed: `Q-102` (`05aa3be`, merged 2026-08-21), which
  added these fields to `saveResult()`'s output, landed *after* the last successful data-refresh
  commit (`2d71ceb`, 2026-08-16) — no refresh has completed since, for reasons already documented
  on this branch (`Q110-D1`, above). None of the 4 fields being read anywhere today
  (`grep -rn ".fingerprint\b|seriesFingerprint" .` outside `scripts/fetchBacktestData.mjs`'s writer
  returns nothing) means this is currently a write-only mechanism regardless.
- **Split-adjustment sanity check on NVDA's 2024-06-10 10:1 split** (in addition to the already-
  verified Phase 10 case): close series is smooth across the split date (120.89 → 121.79 → 120.91
  → 125.20, no jump) — confirms the already-known "chart() returns split-adjusted close" property
  holds for this fixture too; not a new finding, recorded as a check performed.
- **Dividend rows are never appended as separate array entries**: confirmed by reading
  `scripts/fetchBacktestData.mjs:229-247` — the `dividend` amount is attached as an optional field
  on the same OHLCV bar object for its ex-date, never pushed as its own row into `candles`. No
  fixture has a row shaped like a dividend-only entry (every dividend-bearing file's row count
  equals its non-dividend-bearing peers' — 1254, or 1253 for EQIX — never inflated). So the
  specific "a dividend row could be mistaken for a price bar" risk named in the brief does **not**
  materialize structurally — see `Q110-D12` for the narrower, real residual risk (a *dropped*, not
  misclassified, dividend), quantified at 50/56 files and 969 bars, not guessed.
- **`checkRateLimit` (deprecated, memory-only, bypasses KV)**: zero production callers
  (`grep` confirms only its own definition) — the deprecation is not being silently ignored
  anywhere; only `applyRateLimit` is used, and its own issue is `Q110-D9`/`D10` above, not this one.

---

## Ranked list

1. **Q110-D1** — CONFIRMED, P0/P1 — `EQIX.json` silently missing 2026-07-31; existing gap check's
   >5-day threshold misses it. (Root-cause context — the fixture set has been frozen since
   2026-08-16 due to a workflow bug already documented and actively being fixed on this branch —
   is not itself a new finding; the residual action item, re-verify EQIX after the next real
   refresh, is.)
2. **Q110-D2** — CONFIRMED, P1 — the only cross-vendor (Kraken-vs-app) BTC check never executes in
   CI (`VERIFY_APP_BASE_URL` unset everywhere; confirmed by running it).
3. **Q110-D3** — CONFIRMED, P1 — `assertNoIdCollisions` (I6's collision guard) has zero production
   call sites (currently harmless — confirmed by running the rule against the real universe).
4. **Q110-D9** — PLAUSIBLE (pending one off-repo platform fact), P1/P2 if confirmed — rate-limit
   key derivation may trust an attacker-suppliable `X-Forwarded-For` value; would enable both
   self-bypass and targeted victim DoS if Vercel does not overwrite the header at the edge.
5. **Q110-D4** — CONFIRMED, P2 — outlier check is close-to-close only; demonstrated blind to a real
   intraday open/high spike (AMD 2025-10-06).
6. **Q110-D6/D7** — CONFIRMED, P2 — SQLite warehouse write path is dead code; if ever wired up, it
   has no restatement detection unlike the JSON-fixture path.
7. **Q110-D5** — CONFIRMED (quantified), P2 — handover detector's z-score denominator includes the
   tested outlier; margin on UNH shrinks from +8.1% to +1.5% due to self-inflation.
8. **Q110-D10** — UNVERIFIED, context for D9/P2 if the underlying fact resolves badly — no in-repo
   evidence KV is provisioned; if it isn't, the in-memory fallback's limit is per-instance, not
   global, on all 27 protected routes.
9. **Q110-D13** — CONFIRMED (code), latent, P3 — `change`/`changePct` bypass Bloomberg's
   sentinel-zero fallback and warning; dormant because the bridge isn't configured here.
10. **Q110-D8** — CONFIRMED, P3 — warehouse connection failures are completely unlogged, unlike its
    own query failures.
11. **Q110-D12** — PLAUSIBLE, unfalsifiable by design, P3 — a dividend event that misses its bar is
    dropped with no trace kept (50/56 files, 969 bars at risk, none provably affected).
12. **Q110-D11** — PLAUSIBLE, forward risk only, P4 — share-class rule is false for real Units/
    Rights ticker suffixes; no live collision in the current universe.
13. **Q110-D14** — CONFIRMED (comment vs. behavior), dead code, P4 — `sanitize.ts`'s `num()`
    docstring claims a property the function does not have.
