# test-engineer — deep inspection, 2026-09-05

Territory: `__tests__/` (all of it), `vitest.config.ts`, `stryker.conf.*`, `tests/` (python).
Ids reserved `Q110-T1`–`Q110-T29`; **19 used** (`T1`–`T19`), `T20`–`T29` unused —
do not backfill them with padding.

Frame: find tests that currently pass while lying about what they check. Every
finding below states CONFIRMED (mutated the real tree and watched the test stay
green, then restored via `cp`) or PLAUSIBLE (read carefully, mutation not run —
usually because the finding is about absence: a hook nothing imports, a CI job
that never invokes a runner). `git status` was clean before and after every
mutation; no `git checkout` was used, per the ban.

---

## Method note — what I did NOT re-litigate

`__tests__/architecture/synthetic-containment.test.ts`,
`fundamentals-tripwire.test.ts`, `cache-flag-consumed.test.ts`,
`findings-ledger-integrity.test.ts`, `module-ssot.test.ts`, `skill-wording.test.ts`,
`scheduled-alerts.test.ts` and `vendor-licence-register.test.ts` are already the
product of multiple red-team rounds recorded in their own file headers (Q-079,
Q-088, Q-096, Q-098, Q-103, Q107-O2). I read all eight in full rather than
sampling. Every one of them now opens with a reachability check before its
property assertion, and most carry an explicit "what this guard CANNOT do"
block. I did not find a fresh vacuity or tautology in the property assertions
themselves — the design pattern (walk the real tree, prove the walk is
non-empty and hits every directory that matters, then assert the property, then
list disclosed gaps as passing tests) is sound and is the thing to imitate
elsewhere in this suite, not re-audit. I ran `skill-wording.test.ts` directly
(`npx vitest run`) rather than trusting a read, because CLAUDE.md I5 currently
asserts in prose that the ban is "violated on landing" by four named labels —
the worst possible shape (a guard green over a violation its own invariant
documents). It is not: `components/backtest/KeyMetricsStrip.tsx` and
`InstrumentTable.tsx` no longer say "Alpha vs B&H" / "Strategy Alpha" (grep
confirms only the identifier `alpha`/`portfolio.alpha` remains, which the guard
correctly does not flag — copy is phrases, identifiers are single tokens). The
test passes for the right reason. **CLAUDE.md's I5 prose is stale on this one
point** (the fix landed after the doc was last edited) — flagging for whoever
owns that file, not claiming it as a test defect since it isn't one.

What follows is what I found wrong, in the two places I actually looked hardest
because they hadn't been red-teamed yet: the non-architecture unit tests
(`hooks/`, `api/`), and the two artifacts nobody has to run (`tests/*.py`, the
coverage `exclude` list).

---

## 1. Vacuity sweep

119 occurrences of `toEqual([])` across 40 files. Mechanical discriminator used
(validated against the 8 architecture files above, all of which have one): **a
collector-style guard is non-vacuous iff it carries a positive control** — a
test that constructs an input designed to trip the rule and asserts the
non-empty result. I checked all 40 files; 36 either (a) assert a `toEqual([])`
against a real, deterministic function call on an inline fixture (degenerate
input tests — fine, checked below) or (b) are one of the 8 architecture files,
which all carry positive controls. Files without an explicit reachability
marker (`toBeGreaterThan(0)` or equivalent) were individually inspected rather
than assumed vacuous:

- `__tests__/briefs/sectorBrief.test.ts`, `__tests__/backtest/dataLoader.test.ts`,
  `__tests__/portfolio/{greeks,tracker}.test.ts`,
  `__tests__/components/signinEnvNames.test.tsx`,
  `__tests__/hooks/useErrorToast.test.tsx`,
  `__tests__/api/streamMultiplex.test.ts` — all check a real function's output
  against a real or synthetically-constructed-but-deterministic input (e.g.
  `deadFetchers()`/`explodingFetchers()` in sectorBrief, a real imported route
  module in streamMultiplex). None are vacuous. No finding.

**One genuine, disclosed-but-unverified vacuity risk found and checked:**

### Q110-T1 — `fundamentals-tripwire.test.ts:88-103`, the witness assertion is vacuous if the consumer set is ever empty
`file:` `__tests__/architecture/fundamentals-tripwire.test.ts:100-102`
```ts
const consumers = files.filter(...).map((f) => f.path)
expect(consumers.every((p) => !isResearch(p))).toBe(true)
```
`Array.prototype.every` on an empty array is `true`. The file's own comment
(`:89-91`) already discloses this ("if it empties entirely... this test should
be revisited rather than silently passing"), which is exactly the right amount
of honesty — but the assertion itself does nothing to enforce it. I checked
whether `consumers` is empty **today**: it is not (`app/stock/[ticker]/page.tsx`,
`components/stock/QuantLabPanel.tsx`, `components/stock/quantlab/tabs/LlmTab.tsx`
and others resolve to a fundamentals module through the same `resolveSpecifier`
machinery `synthetic-containment` already exercises). So this is **PLAUSIBLE,
not CONFIRMED** — a real gap, but not live today. Severity LOW given the
disclosure, but cheap to close: `expect(consumers.length).toBeGreaterThan(0)`
before the `.every(...)` line would turn a disclosed risk into an enforced one,
matching the pattern the same file already uses one block up (`:53-55`).

---

## 2. Constant-assertion sweep

The named antipattern (`expect(EXECUTABLE.test('deploy.sh')).toBe(true)`) is
explicitly discussed and avoided in the architecture suite — `vendor-licence-
register.test.ts`'s own "CANNOT do" block states plainly that these are
measurements of the walk's boundary, not claims about production, and pairs
every such assertion with a `detectEgress`-driven positive control elsewhere in
the same file. That is the correct use of the idiom (asserting a boundary, not
substituting for a behavioural check) and is not a finding.

I found two real instances of the antipattern outside the architecture suite,
one of them severity-worthy:

### Q110-T2 — `sanitize.fuzz.test.ts`, the "10k random cases" property has near-zero power at the boundary that matters
`file:` `__tests__/api/sanitize.fuzz.test.ts:9,14-21`
```ts
// Q-015: mirror lib/api/sanitize.ts TICKER_REGEX — keep in sync with source.
const TICKER_REGEX = /^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/
...
fc.assert(fc.property(fc.string({ minLength: 0, maxLength: 50 }), (s) => { ... }), { numRuns: 10_000 })
```
`TICKER_REGEX` is a hand-copy, not an import — `lib/api/sanitize.ts` does not
export it (confirmed by grep; only `normalizeTicker`, `num`, `sanitizeError`
are exported). **First pass at this finding overclaimed**: I initially framed
the copy itself as the confirmed defect. A follow-up mutation shows that's
wrong, and states the real, narrower defect precisely.

**CONFIRMED by mutation, then isolated by a second mutation.** Backed up
`lib/api/sanitize.ts`, widened the production regex's length cap `{0,14}` →
`{0,30}` (simulating the "allow slightly longer crypto pair tickers" edit this
file's own R4-M-2 comment says happened once already), left the test
untouched, ran `npx vitest run __tests__/api/sanitize.fuzz.test.ts`: **2
passed, 0 failed** against the mutant. Restored via `cp`; clean before/after.

Instrumenting the actual `fc.string({minLength:0,maxLength:50})` arbitrary
(temp script, deleted) against the widened regex: **1,859/10,000 draws
non-null, 0 of those 1,859 in the 15–30-char band** that would trip the
old-vs-new mismatch — the unconstrained unicode-string generator essentially
never constructs a long pure-alnum token by chance.

**The isolating step**, run precisely because the first pass's causal claim
("the hand-copy is why this escapes") needed to be checked, not assumed:
against the same widened mutant, with the **same unchanged hand-copied
`OLD_REGEX` as the oracle**, but a generator constrained to
`fc.array(fc.constantFrom(...'A'..'Z','0'..'9'), {minLength:16,maxLength:31}).map(a=>a.join(''))`
— **failed after 1 test**, shrunk to `AAAAAAAAAAAAAAAA` (16 chars),
`mismatches: 17/17` non-null draws. Same stale-pin oracle, different
generator, mutant caught immediately. **This isolates the defect to the
generator, not the oracle**: a hand-copied regex that is byte-identical to
production today is a legitimate stale-pin design — it catches a divergence
the instant a draw reaches the boundary. The oracle here has never actually
been exercised at the boundary because the generator never gets there.

**Severity: MEDIUM, not HIGH** (corrected downward from the first pass). The
fuzz property, as written, provides near-zero assurance against a
character-class-or-length regression on `normalizeTicker` — but the sibling
`it('known-bad inputs...')` block (hardcoded adversarial strings —
`../etc/passwd`, `<script>`, SQL-injection-shaped strings) does cover the
actual attack strings this whitelist exists to block, and nothing here is a
live escaped bug today. **Fix, in priority order:** (1) constrain the
arbitrary to the ticker alphabet so the 10k-run budget is spent at the
decision boundary instead of in rejected unicode space — this is the
confirmed fix for the confirmed defect; (2) separately, and lower-priority,
export `TICKER_REGEX` and import it instead of hand-copying, on ordinary
oracle-independence grounds (a future edit that updates both copies in
lockstep would still defeat even a well-targeted generator) — this is
PLAUSIBLE risk-reduction, not something the mutation evidence establishes on
its own.

### Q110-T3 — `useLiveQuotes.test.ts:42-61`, three tests assert JS built-ins, not the hook
`file:` `__tests__/hooks/useLiveQuotes.test.ts:42-61`
```ts
it('11 sector ETFs + SPY + QQQ fit under the cap (no dashboard drop)', () => {
  const sectors = [...]; const all = [...sectors, ...indices]
  expect(all.length).toBeLessThanOrEqual(MAX_LIVE_STREAMS)   // constant vs constant
})
it('dedup removes duplicates before applying cap', () => {
  // Mirror the hook's internal cleaning logic so the contract is pinned...
  const cleaned = Array.from(new Set(raw.filter((t) => t && t.length > 0)))
  expect(cleaned).toEqual(['SPY', 'QQQ', 'IWM'])              // tests Set(), not the hook
})
it('empty-string + falsy tickers are filtered out', () => {
  const cleaned = raw.filter((t) => t && t.length > 0)
  expect(cleaned).toEqual(['SPY', 'QQQ'])                     // tests Array#filter, not the hook
})
```
None of these three import or call anything from `hooks/useLiveQuotes.ts` — the
middle two literally reimplement the cleaning logic inline in the test body
(the comment admits it: "Mirror the hook's internal cleaning logic") and then
assert the reimplementation against itself. If the hook's actual dedup/cap
logic breaks — say, an off-by-one on `MAX_LIVE_STREAMS`, or dedup applied after
the cap instead of before, inverting the documented contract — these three
tests are structurally incapable of noticing, because they never touch the
hook. **CONFIRMED by reading** (no mutation needed — there is no import to
break; the absence is the finding). The `MAX_LIVE_STREAMS` range check
(`:33-39`, `toBeGreaterThanOrEqual(11)`/`toBeLessThanOrEqual(50)`) is a real
assertion on the real export and is fine. The 13-line block that follows it is
not. Contrast with the rest of the same file (`:133-310`): the `FakeEventSource`
harness genuinely renders the hook via `renderHook` and drives its state
machine — that part is excellent and is exactly what these three should look
like. **Severity: MEDIUM** (the property they gesture at — dedup-before-cap —
is real and worth pinning; it is just pinned against the wrong subject).
**Fix:** either delete these three (the harness-based tests below already
exercise dedup indirectly by construction — `mount(['SPY','SPY','QQQ'])` and
asserting `active`/`connections` would catch it for real) or rewrite them to
call an exported pure helper from the hook module instead of a local copy.

---

## 3. Mutation reasoning — the ten highest-value guards

For each, the single-line production change that would make it fail, or the
statement that none exists (decoration) or that it was already exhibited by an
earlier red-team round (cited rather than re-run).

| Guard | Kills on | Verified |
|---|---|---|
| `synthetic-containment.test.ts` | any of 7+ named mutation shapes (M-A…M-H, RT-1…RT-9); e.g. adding `Math.random()` to `app/api/chart/[ticker]/route.ts`'s candle construction | Q-079/Q-088 red-team rounds, re-verified as executable test cases (not re-run by me — already CI-executing) |
| `fundamentals-tripwire.test.ts` | one new `import { ... } from '@/app/api/fundamentals/...'` in any `lib/backtest\|quant\|optimize` file | positive control at `:63-71` proves it; I did not need to re-mutate |
| `cache-flag-consumed.test.ts` | deleting `data._cached` read in any of the 3 consumer surfaces, OR reordering `if (cached)` after the live-branch check in `DataFreshnessIndicator.tsx` | file's own history states it was mutation-verified (comment `:40-46`); the branch-order test (`:140-149`) is a real ordering check, not presence-only |
| `findings-ledger-integrity.test.ts` | deleting the trailing newline from `reviews/findings-ledger.csv`, or dropping row `Q088-1` | direct assertions on the real file; trivially killable, did not need to mutate a 5000-row CSV to confirm |
| `module-ssot.test.ts` | reintroducing a literal `color: '#f59e0b'` in `app/api/briefs/route.ts` | regex assertion against the real file content; real and current |
| `skill-wording.test.ts` | adding `<span>Outperforming SPY</span>` anywhere under `app/`, `components/`, `lib/`, `hooks/`, or `public/*.html` | ran the suite directly; the extractor's own test block (`:124-172`) proves the visitor sees JSX text >80 chars, interpolated text, and semicolon-bearing prose — the three specific ways it was previously blind |
| `scheduled-alerts.test.ts` | deleting `scheduled-failure-alert.yml`, or adding a new scheduled workflow without wiring it, or setting `continue-on-error: true` on a wired job | file states these are M11–M16, previously-surviving mutations now caught; property-based (`canFail`/`wired`), not name-listed |
| `vendor-licence-register.test.ts` | adding any new host literal / npm or pip package / host-bearing env var with no register row | 20+ inline positive controls (`detectEgress` called directly on synthetic `SourceFile[]`), each independently checkable without touching the real tree |
| `vendorEgress.ts` (implementation) | n/a — not itself a test; covered via the file above | — |
| **`__tests__/components/smoke.test.ts`** | **none, meaningfully.** See below. | CONFIRMED by reading |

### Q110-T4 — `smoke.test.ts` is decoration wearing the name "component infrastructure smoke"
`file:` `__tests__/components/smoke.test.ts:1-29`
Named "component infrastructure smoke (Q-027)" but imports zero components —
it calls three `lib/portfolio/*` functions directly with inline fixtures
(`evaluateTailRisk`, `aggregatePortfolioGreeks`, `regressFactorLoadings`) and
asserts weak properties (`alerts.length > 0`, `g.delta === 100`,
`loadings.MKT` is defined — not a value, just definedness). Every one of these
three functions already has its own dedicated, much stronger test file
(`portfolio/tailRiskAlerts.test.ts`, `portfolio/greeks.test.ts`,
`portfolio/factorAttribution.test.ts` all exist and are non-trivial). This file
adds no coverage `lib/portfolio`'s own suites don't already provide, and its
name actively misdescribes what it does — a future reader grepping for
"component" or "smoke" coverage of the actual component tree (`KLineChart`,
`DarkPoolPanel`, `WalkForwardPanel`, etc.) will find this and wrongly believe
component-level infrastructure is smoke-tested here. It is legacy from Q-027
and nothing rewired it since. **Severity: LOW** (harmless, not lying about a
result — just about its own scope). Candidate for **deletion** (see final
section) rather than repair: repairing it would mean turning it into an actual
component render smoke test, which is a bigger change than this file's
one-line-per-function shape suggests, and the coverage it would add already
exists elsewhere in spirit if not in the "mount a component" sense.

---

## 4. Coverage that lies

`vitest.config.ts:60-83`. **The task prompt's premise is stale**: `lib/ml`,
`lib/optimize`, `lib/portfolio`, `data/providers` are **not** in the current
exclude list — the in-file comments (`:47-58`) record that Q-051 already
un-excluded them and `data/providers` was deleted as dead code entirely. The
current exclude list is narrower: six hook files plus `lib/data/warehouse.ts`.
Reporting the current reality rather than the premise:

### Q110-T5 — three of the six excluded hooks have zero dedicated tests, and their comments don't say so
`file:` `vitest.config.ts:64-72`
```ts
'hooks/useLiveQuote.ts', 'hooks/useLiveQuotes.ts',   // "needs heavy jsdom/MockEvent harness; defer"
'hooks/useKLineChart.ts',                            // "has no unit tests by design... verified via runtime/build"
'hooks/useLivePrices.ts', 'hooks/useDialogA11y.ts', 'hooks/useWatchlist.ts',  // "needs auth/session mocks"
```
Checked each claim against the real tree:
- `useKLineChart.ts` (878 lines): the comment is accurate and current —
  `__tests__/components/KLineChart.test.tsx` (482 lines) mounts the real hook
  (only `lightweight-charts` is mocked) and does exercise it at runtime. No
  finding.
- `useLiveQuotes.ts` (337 lines): the comment ("needs heavy jsdom/MockEvent
  harness; defer") is **stale in the generous direction** — the harness was
  built (`FakeEventSource`, `__tests__/hooks/useLiveQuotes.test.ts:64-118`) and
  15 real state-machine tests exist. This file being excluded from the coverage
  gate now just means well-tested code isn't credited — benign, not a hidden
  risk, but worth a one-line comment update so the next reader doesn't defer
  work that's already done.
- `useLivePrices.ts` (125 lines), `useDialogA11y.ts` (102 lines),
  `useWatchlist.ts` (83 lines): **zero test files reference any of the three**,
  confirmed by grep across `__tests__/` (the only hit is a comment mentioning
  `useLivePrices` by name in `changePctParity.test.ts`, not a test of it). These
  are not thin — they back real, currently-shipped surfaces:
  `useLivePrices` → `app/desk/page.tsx` (the live dashboard's price tiles);
  `useDialogA11y` → `KeyboardShortcuts.tsx`, `SiteNav.tsx`,
  `stock/LlmDeployAssistant.tsx` (focus-trap/escape-key handling — an
  accessibility-load-bearing hook with no behavioural test at all); `useWatchlist`
  → `app/desk/page.tsx`, `WatchlistButton.tsx` (persisted user state). **~310
  lines of user-facing logic, one of which is an a11y primitive relied on by
  three surfaces, sit outside both the test suite and the coverage gate
  simultaneously** — the exclude entry means a regression here would not even
  register as a coverage *drop*, let alone fail a test. Severity: **HIGH** for
  `useDialogA11y` specifically (a11y correctness with zero automated check,
  in a codebase whose own a11y CI job is schedule-only and advisory per
  CLAUDE.md — this is the same blind spot one layer down), MEDIUM for the
  other two.

### Q110-T6 — `lib/data/warehouse.ts`'s exclude comment is factually wrong today
`file:` `vitest.config.ts:74-76`
```ts
// SQLite — already integration-tested but skipped when better-sqlite3 native
// binding is unavailable (which it is in default CI image)
```
Checked against `.github/workflows/ci.yml` (plain `ubuntu-latest` + `npm ci`,
no `--ignore-scripts`, no alternate image) and against two recent real CI runs
(`gh run view 33949823447 --log`, both the `test` and `coverage` jobs): **all 17
tests in `__tests__/data/warehouse.test.ts` run and pass** (`describeIfDb` is
not skipped), and the suite total (`1904 passed (1904)`) shows **zero** skips
anywhere. `better-sqlite3`'s native binding is available in this repo's actual
CI image; the comment's premise is false for the path that matters. Direction
matters here, per the house rule: excluding a file that is in fact fully tested
removes it from the coverage **denominator**, which understates the true
coverage percentage — the benign direction, not a hidden risk. **Severity:
LOW** — a docs-vs-reality mismatch, not a defect, but exactly the kind of
stale claim that compounds (the comment invites someone to leave the exclude
in place indefinitely, "because CI can't run it anyway," when CI has been
running it the whole time).

---

## 5. The Python tests (`tests/`) — never run by CI

`file:` all of `tests/*.py` (1,293 lines, 7 files, 127 tests + 1 skip locally).

**Confirmed: no CI job invokes pytest or references Python at all.**
`grep -rln "pytest\|python" .github/workflows/*.yml` returns nothing across all
six workflows (`ci.yml`, `a11y-axe.yml`, `nightly-backtest.yml`,
`refresh-data.yml`, `scheduled-failure-alert.yml`, `stryker-weekly.yml`). I ran
the suite locally (`python3 -m pytest tests/ -q`): 127 passed, 1 skipped, in
5.75s, no Python setup step exists anywhere for CI to have run this even if a
job wanted to. `tests/__pycache__/*.cpython-311-pytest-9.0.3.pyc` shows the
suite has been executed locally (probably by agents, possibly a human) but
never in the pipeline that gates `main`.

### Q110-T7 — `tests/test_api_key_guard.py` is the most severe instance: a security regression test that is pure documentation
`file:` `tests/test_api_key_guard.py:1-9`
This is a regression test for `ApiKeyEnvGuard` — a per-request guard whose job
is to inject a user's API key into `os.environ` for the request's duration and
guarantee it does **not** leak into the process environment afterward if there
was no pre-existing key. That is exactly the shape of bug that is invisible in
review and catastrophic in production (one user's key becomes readable by the
next request). It has a real, well-isolated test (`_isolate_env` fixture
snapshots/restores the env var around every test). None of it can fail a build,
merge, or deploy — it can only fail if a developer remembers to run pytest by
hand. **Severity: HIGH**, same shape as I8/I3's "the guard was correct and
unreachable" pattern, but one level up: here the *whole test runner* is
unreached, not just a directory inside a reached one. Matches the existing
catalogue in `guard_reachability_lesson` (fixture dir / top-level dir /
extension / whole language) — this is the "whole language" instance for
`tests/`, distinct from the one already logged for `.py` source files under
I8's `vendor-licence-register.test.ts` (that one is about *scanning* Python
source for egress; this is about *executing* Python's own test suite at all).
**Fix is mechanical and cheap**: a `python-tests` job in `ci.yml` — `actions/
setup-python`, `pip install -r requirements.txt -r ml/requirements.txt`,
`pytest tests/` — costs a few CI-minutes and turns 127 currently-decorative
assertions into real ones. Not proposing the diff (out of territory — CI
workflow files are not `__tests__/`/`vitest.config.ts`/`stryker.conf.*`), but
recording the fix shape since it's a two-line ask.

**Caveat that changes what the fix actually buys, stated so the lead doesn't
read "add a CI job" as closing the gap:** per CLAUDE.md I7 (confirmed current,
not re-litigating it — `Q-079`), `main` has no branch protection and the
required-status-check set is empty. A `python-tests` job added to `ci.yml`
would run and could go red, but it would be **advisory, like every other check
in this repository** — a red run would not block a merge until `Q-097` lands
(owner action on repo settings). The finding stands (127 assertions, including
a secrets-leak guard, currently have no pipeline instance at all — not even an
advisory one), and adding the job is still strictly better than not adding it,
but it does not by itself make this suite *enforcing*.

Other six Python files (`test_alpha_miner.py`, `test_example.py`,
`test_multi_agent_factor_mining.py`, `test_options_analyzers.py`,
`test_quant_framework.py`, `test_trading_agents_runtime.py`) are the same
finding at lower individual severity — genuine tests, well-written, all
equally unreachable by CI. Not repeating per-file; the fix is one job for all
seven.

---

## 6. Determinism

Grepped `__tests__/` for `Date.now()`, `Math.random()`, `new Date()`,
`toLocaleString`/`Intl.DateTimeFormat`, and filesystem/network dependence.

- `options/chain.test.ts`, `options/flow.test.ts`, `options/gex.test.ts`,
  `options/sentiment.test.ts`: all use `Date.now() + fixedOffsetMs` to build
  relative option-expiry fixtures (e.g. `Date.now() + oneYearMs * 0.25`). This
  is **not** a determinism defect — the tests assert relative behavior
  (expired vs. not-expired relative to "now"), never a specific date, so the
  same input relationship holds regardless of when the suite runs. No finding.
- `api/rateLimit.test.ts`: uses `` `key-${Date.now()}-${Math.random()}` ``
  purely to generate unique rate-limit keys so parallel test runs can't
  collide — not an assertion input. No finding.
- No test asserts against `toLocaleString`/`Intl.DateTimeFormat` output (all
  occurrences of those APIs are in `lib/`/`components/` source, not in
  `__tests__/`), so no timezone-dependent snapshot risk found.
- `__tests__/quant/syntheticGuard.test.ts:83-94` **actively guards against** a
  fake-determinism trap: it asserts the seeded generator differs across
  tickers, specifically to rule out a degenerate seed that would make the
  same-ticker-same-output check pass vacuously. This is the correct pattern
  and the inverse of a finding — flagging as an example worth generalizing,
  not a defect.
- Component snapshot tests (`__tests__/components/backtest/__snapshots__/
  BacktestPage.test.tsx.snap`, `__tests__/components/stock/__snapshots__/
  QuantLabPanel.test.tsx.snap`) were not read in full given time budget; no
  `Date.now()`/`Math.random()` reference found in the two `.test.tsx` files
  that generate them, and both stub their data layer with fixed fixtures per a
  spot check of imports. Recording as **checked but not exhaustively** — if
  another specialist independently flags a snapshot flake, this is where to
  look first.

No CONFIRMED determinism defects found in `__tests__/`. The house rule ("seed
Math.random in the fixture") appears to be actually followed here, unlike the
prior incidents referenced in `feedback_mutation_testing_quantan.md` — I did
not find a live recurrence.

---

## Ranked: the five most worth fixing

1. **`Q110-T2`** — `sanitize.fuzz.test.ts`'s fuzz generator has near-zero power
   at the ticker-regex decision boundary (confirmed by mutation, then isolated
   from the hand-copied-oracle question by a second mutation). Security-
   relevant, cheap fix (constrain the arbitrary to the ticker alphabet).
2. **`Q110-T7`** — the Python suite, especially `test_api_key_guard.py`, has no
   pipeline instance at all (not even advisory). One CI job covers seven files
   / 127 tests; note the fix only reaches "advisory," not "enforcing," until
   `Q-097` (branch protection) lands.
3. **`Q110-T5`** — `useDialogA11y.ts`/`useLivePrices.ts`/`useWatchlist.ts`:
   zero tests, excluded from the coverage gate, backing real dashboard/a11y
   surfaces. `useDialogA11y` is the sharpest edge given the platform's own a11y
   CI is already advisory-only.
4. **`Q110-T3`** — `useLiveQuotes.test.ts`'s dedup/cap tests asserting
   `Array.from(new Set(...))` instead of the hook. Worth fixing over deleting
   because the property (dedup-before-cap) is real and load-bearing (DQ-1's
   whole point was a latched-state bug of exactly this flavor); it just needs
   to call the actual code.
5. **`Q110-T1`** — `fundamentals-tripwire.test.ts`'s vacuous-if-empty witness.
   Lowest urgency of the five (not live, already disclosed in a comment) but a
   one-line fix (`expect(consumers.length).toBeGreaterThan(0)`) removes the gap
   entirely rather than leaving it as a comment promise.

## What I would DELETE, and why deletion beats repair

- **`__tests__/components/smoke.test.ts`** (`Q110-T4`). Its three assertions
  are strictly weaker restatements of coverage that already exists in
  `portfolio/tailRiskAlerts.test.ts`, `portfolio/greeks.test.ts`, and
  `portfolio/factorAttribution.test.ts`. Repairing it to match its own name
  ("component infrastructure smoke") means writing a real component-mount
  smoke test — a different, larger task, not a fix to this file. Keeping it
  as-is costs nothing to run but costs a future reader's time twice: once when
  they trust the name and think component-level smoke coverage exists, and
  once when they have to figure out why a file named "smoke" duplicates
  three other suites at lower fidelity. Delete it; if component-mount smoke
  coverage is wanted, it should be a new file scoped to that claim, sitting
  next to `KLineChart.test.tsx`/`BacktestPage.test.tsx` where the real
  component-mounting tests already live.
- I do **not** recommend deleting the two `expect(true).toBe(true)` tautologies
  (`synthetic-containment.test.ts:904`, `vendor-licence-register.test.ts:601`).
  They read as decoration in isolation, but in context they are the last line
  of an explicit, deliberate "what this guard cannot do" ledger, and both files
  state outright why the limitation (CI cannot decide whether prose is true;
  CI cannot stop a merge given no branch protection) has no executable
  counterpart. Deleting them would silently drop a recorded limitation from an
  otherwise-exhaustive list, which is a worse outcome than two assertions that
  can never fail. If anything, the fix is stylistic — `it.todo(...)` or a bare
  comment would carry the same information without occupying a line in the
  "1904 passed" count — but that is a nitpick, not a finding.

---

## Housekeeping

No source or test file was left modified. `lib/api/sanitize.ts` was mutated and
restored via `cp` twice (once to establish `Q110-T2`, once more to isolate the
generator from the oracle per the advisor's correction), backup at
`/private/tmp/claude-501/.../scratchpad/sanitize.ts.bak`; `git status`/`git
diff --stat lib/api/sanitize.ts` confirmed clean before writing this report and
after each restore. `git checkout` was not used at any point.
An untracked `scripts/_q110tmp/` directory is present in the working tree and
was not created by this pass — left alone, presumably another specialist's
in-progress artifact.
