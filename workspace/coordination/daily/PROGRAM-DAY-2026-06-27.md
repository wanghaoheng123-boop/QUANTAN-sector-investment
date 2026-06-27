# Program Day — 2026-06-27 (manual Opus-4.8 run)

Run context: **manual** interactive session (owner: "Continue"). Scheduled fires
still 400-fail on the gated Fable 5 model (owner UI fix pending). Cell run this day:
**A5** (WS-A).

Boot/reconcile: local == origin/main == `aaf1bc1`; 0 open PRs; clean tree.

---

## A5 — `lib/data/providers/*` (alphavantage / polygon / fred / yahoo) (WS-A) — DONE, VERIFIED CLEAN (no code change)

Reviewed all four provider implementations + `dispatcher.ts` + `index.ts` + `types.ts`.

**Watch items — all clear:**
- **Timeouts ✓** — `polygon.ts`, `alphavantage.ts`, `fred.ts` wrap every `fetch` in
  `AbortSignal.timeout(8_000)`; `yahoo.ts` delegates to yahoo-finance2. No unbounded
  upstream call → no hung-serverless-worker risk (the R4 concern from the 2026-06-10
  round-2 sweep is closed).
- **Polygon ns/ms ✓** — `fetchQuote` divides the `/v2/last/trade` `t` (nanoseconds) by
  1e6 and guards the result with a 2000–2100 year-plausibility check, falling back to
  `now()` + a warn on an implausible year (no silent year-2970 dates). `fetchDaily` reads
  aggs `t` in milliseconds directly. Both correct.
- **B-3 finite-OHLC (AlphaVantage) ✓** — the 2026-06-04 `parseFiniteOrNull` skip-bar
  remediation is intact (a non-finite OHLC field skips the bar rather than coercing to 0).

### Headline — A5-DORMANCY (owner decision, INFO)
The **entire** `lib/data/providers` abstraction is **dead code in production**. Confirmed
repo-wide (grepped the singleton symbols, the fallback functions, and `new *Provider(` at
the constructor level): every construction is the module's own exported singleton, the
dispatcher's own (uncalled) `yahoo`/`polygon` instances, or a test. `warehouse.ts` imports
only the `DailyBar`/`QuoteSnapshot` **types**. The live routes (briefs, fundamentals,
options, analytics, chart, stream) call **yahoo-finance2 directly**, and the backtest uses
`scripts/backtestData/*.json` + the warehouse — none of them go through this layer or
`fetchDailyWithFallback` / `getEquityProvider`. So the provider/dispatcher/fallback stack
(Phase-15 Q-048/Q-051 scaffolding) is **half-built or abandoned**. → owner **retire-or-wire**
decision (same class as the dormant enhanced-signal stack). Logged `A5-DORMANCY`.

### Escalated (all LOW, dormant)
- **A5-1 — OHLC guards inconsistent + individually-incomplete across all three providers.**
  Polygon: no finite/positive guard at all. AlphaVantage: `parseFiniteOrNull` catches
  non-finite but lets a literal `0`/negative through (`Number.isFinite(0) === true`) — and
  its doc-comment *misleadingly* claims it stops 0-price injection (it only stops
  missing→0 coercion). Yahoo: guards `close <= 0` but a NaN close slips (`NaN <= 0` is
  `false`). **Decision: escalate the unification (skip any bar with a non-finite OR ≤0
  price across all three), do NOT ship a Polygon-only guard** — that would make Polygon
  *stricter* than its two siblings, trading one asymmetry for another in dead code (and
  burning a CI cycle for zero live benefit). If the layer is ever wired (A5-DORMANCY),
  fix all three to one standard with one test.
- **A5-2 — AlphaVantage raw-OHL + adjusted-close scale mismatch.** `fetchDaily` builds each
  bar from raw `1. open` / `2. high` / `3. low` but the **`5. adjusted close`**. Per the
  AlphaVantage `TIME_SERIES_DAILY_ADJUSTED` docs (fields 1–4 as-traded, field 5 adjusted),
  across a split/large dividend the OHL are on the raw scale while close is adjusted → the
  OHLC invariant `low ≤ close ≤ high` can break. **Caveat (A4 lesson applied to my own
  certainty):** the response is an untyped `Record<string,string>`, so this rests on API
  *docs*, not on a repo `.d.ts` — labelled latent/per-docs, not verified-against-types.
  Fix = scale OHL by `adjustedClose / rawClose`. Dormant.
- **A5-3 — FRED `parseFloat` → NaN nit.** Non-'.' values are parsed with no finite guard,
  so a malformed value would yield NaN in `observations.value` (typed `number | null`).
  FRED uses '.' for missing (handled) → near-zero likelihood, and the live rf consumer
  (`riskFreeRate.ts`, Q24) walks backward for the latest non-missing with a `val > 0`
  guard. Benign. Fix = `Number.isFinite(parsed) ? parsed : null`.

**VERIFY A–F:** A (correctness) — all 4 providers + dispatcher reviewed line-by-line, no
live bug. B (tests) — existing `__tests__/data/providers.test.ts` + `dispatcher.test.ts`
cover the gates/null-paths/parse paths; no code change so no new test. C/D — n/a (no diff).
E (records) — queue A5→done + run-log; ledger A5-DORMANCY/A5-1/A5-2/A5-3; this report;
MEMORY_LOG; SESSION_STATE. F — no NaN/leak introduced (read-only). **No PR — tracking-only.**

---

## A5 follow-up — owner directed "identify and fix the issues" → DELETE the layer

After the verify-clean pass above, the owner instructed "identify and fix the issues."
Because I had myself flagged **A5-DORMANCY** as the headline open question (retire / wire /
harden), and "fix" maps to *opposite* actions on the same files, I confirmed the aim with a
single `AskUserQuestion` rather than assuming "harden-in-place." **Owner chose: delete the
layer.**

**Done (PR #73 → main `b1dcb9d`):**
- Removed `lib/data/providers/{yahoo,polygon,alphavantage,fred,dispatcher,index}.ts` +
  `__tests__/data/{providers,dispatcher}.test.ts`. Kept `types.ts`, trimmed to the two
  interfaces `warehouse.ts` imports (`DailyBar`, `QuoteSnapshot`); dropped the orphaned
  `DataProvider`/`MacroDataProvider`/`MacroSeries`. Cleaned the now-stale vitest coverage
  excludes. **−716 LOC net.**
- **A5-1 / A5-2 / A5-3 are now MOOT** — the dead code carrying them is gone (this is why
  confirming the fork first mattered: hardening or writing adjusted-basis math into the
  layer would have been wasted work on a tombstone).
- **Verification:** grep-verified zero non-test callers (every provider symbol + barrel +
  subpath across app/lib/scripts/components/hooks/__tests__); **`tsc --noEmit` clean** (the
  importer gate, per the `tickerNormalize` lesson); all 6 CI gates green incl. **coverage**
  (the deleted excluded files were coverage-neutral; fred/dispatcher were counted but
  below-average → removal nudged the global up). **Prod smoke PASS:** `/` 200 (QUANTAN
  dashboard), `/api/sector-rotation` 200 (11 sectors), `/api/analytics/AAPL` 200
  (winRate 53.2%, β 0.88). Benchmark-neutral (layer never in the signal path).

**Lesson:** when "fix the issues" lands on files you've already flagged as an open
retire-or-wire decision, *aim* the directive with one question before writing code — the
dormancy call gates whether any in-place fix is worth doing at all. Owner directive overrode
the earlier escalate-don't-ship default cleanly (that default was explicitly conditional on
*absent* an owner directive).

## Program status

- **WS-Q COMPLETE** (Q01–Q27), **WS-PY COMPLETE** (PY1–PY4), **WS-A** A1–A5 done — **next A6**
  (`middleware.ts` + `lib/api/csrf.ts` + `sanitize.ts` + `auth.ts`), the last WS-A cell.
  After WS-A: WS-P (perf) + WS-F (frontend/a11y).
- A5 reinforces the program pattern: **live bug → ship (A4/B-1); dormant gap → escalate
  (A5)**. Most remaining surface is verify-clean + escalate; the binding constraint is
  owner decisions (retire-or-wire, published-number re-baselines), not throughput.
- Still owner-only: re-point the scheduled-task model to **Opus 4.8** (root cause of the
  06-16+ scheduled-fire stall); Monday weekly deep sweep still due.
