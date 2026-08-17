# Q-079 — Design invariant I3 enforcement audit

**Invariant:** I3 — "No synthetic data crosses the boundary."
Verbatim (CLAUDE.md): *"Mock/fixture/synthetic data is permitted only in `__tests__/`
and `tests/` and must be tagged `__SYNTHETIC__` at the type level. Any code path
that could route synthetic data into a backtest, a chart, or a signal is a P0
defect. Add a runtime assertion, not just a comment."*

**Audited:** 2026-08-17 · tree at `18afde2` (worktree `sweet-dubinsky-4e07b2`, clean)
**Method:** static read + TypeScript assignability probe + 7 adversarial mutations,
each planted, run against the named guard, and reverted.

---

## CURRENT TIER

`PARTIAL` (as recorded in CLAUDE.md, initial assessment 2026-08-15, re-stated
after Q-088 shipped).

## PROPOSED TIER

**`PARTIAL` — confirmed, not upgraded.** The label is unchanged but its *content*
is different from what the Q-088 resolution note implies, so this is a
substantive correction rather than a no-op.

The Q-088 resolution note in `workspace/IMPROVEMENT_BACKLOG.json` claims
containment is "enforced by ... an allowlist architecture test covering
app/components/lib/hooks/scripts" and that "design invariant I3 is discharged"
(Q-089 notes). Both statements are too strong. The mechanism is real and the two
specific defects it was built for are genuinely dead — but the guard contains a
*named module*, not a *property*. Six of seven mutations escaped it, including one
that restores the original Q-088 chart defect in a single line.

**Why not `ENFORCED`:** I watched only 1 of 7 mutations fail. `assertNotSynthetic`
— the half of the runtime guard I3's own sentence asks for on chart/signal/
backtest boundaries — has zero production call sites.

**Why not `VIOLATED`:** no live path carries synthetic data to a chart, signal or
backtest today. The chart route returns no marker field, the only `<KLineChart>`
consumer passing markers passes empty constants, and the one surviving synthetic
generator is brand-wrapped at its return site.

---

## BRAND-DIRECTION ANALYSIS — CORRECT

`lib/synthetic.ts:34-37`

```ts
export interface Synthetic<T> {
  readonly __SYNTHETIC__: true
  readonly value: T
}
```

This is a **wrapper (interface), not an intersection**. The inverted first attempt
documented at `lib/synthetic.ts:13` (`type Synthetic<T> = T & {…}`) made
`Synthetic<T>` a *subtype* of `T`; the current declaration shares no structural
members with `T` at all, so it is not assignable to `T` in either direction.

I did not take this on trust. Type probe (temp file, outside the repo, since
deleted), compiled with `npx tsc --noEmit --strict`:

| Probe | Code | Result |
|---|---|---|
| A synthetic → real function param | `plotChart(s)` where `s: Synthetic<Candle[]>` | **TS2345** — not assignable to `Candle[]` |
| B synthetic → backtest param | `runBacktest(p)` where `p: Synthetic<number[]>` | **TS2345** |
| C synthetic → real variable | `const asReal: Candle[] = s` | **TS2740** |
| D real → synthetic (the harmless direction) | `const asSynth: Synthetic<Candle[]> = [{close:1}]` | **TS2739** |
| E member access through wrapper | `s.length` | **TS2339** |

Probes A/B/C are the ones that matter and all three error. The direction is right.
Probe D erroring too is incidental (a wrapper is nominal both ways).

**What would have shown failure:** probes A, B or C compiling clean. That is
precisely what the first attempt did, and it is why the first attempt's author
reported probe-D-style evidence as proof of containment.

**Caveat on the guard test for this property.** The test that protects the
direction is a *regex on source text*, not a type check:
`__tests__/architecture/synthetic-containment.test.ts:176`
— `expect(synth()).not.toMatch(/type\s+Synthetic<T>\s*=\s*T\s*&/)`. It matches one
exact spelling. `type Synthetic<T> = { __SYNTHETIC__: true } & T`, or an
intersection introduced via a separate alias, would re-invert the brand while that
assertion stayed green. The compiler is the real gate here, not this line.

---

## RUNTIME-ASSERTION ANALYSIS — the predicate is real; one of the two guards is unwired

**The marker survives compilation.** `lib/synthetic.ts:45` — `markSynthetic`
returns `{ __SYNTHETIC__: true, value }`, an actual own property, not a type-only
brand. `isSynthetic` at `lib/synthetic.ts:49-55` keys on it at line **53**:

```ts
(x as { __SYNTHETIC__?: unknown }).__SYNTHETIC__ === true
```

That is a real value inspection. It survives JSON (`__tests__/quant/syntheticGuard.test.ts:28-31`
asserts the round-trip). This is a genuine repair of finding Q088-3, where the
predecessor took a caller-supplied `true` literal and could never fire.

**`unwrapSynthetic` (`lib/synthetic.ts:68-78`) can genuinely throw, and IS wired.**
It throws at :70 when `isSynthetic(wrapped)` is false. Three production call sites:
- `components/DarkPoolPanel.tsx:57`
- `app/sector/[slug]/page.tsx:63`
- `app/stock/[ticker]/page.tsx:293`

**`assertNotSynthetic` (`lib/synthetic.ts:87-95`) can genuinely throw, and is NOT
wired.** It throws at :89 when `isSynthetic(value)` is true. Call sites in
production code:

```
$ grep -rn "assertNotSynthetic" app components lib hooks scripts middleware.ts types
lib/synthetic.ts:87:export function assertNotSynthetic(value: unknown, surface: string): void {
```

**Zero.** Only its own definition. Every exercise of it is in
`__tests__/quant/syntheticGuard.test.ts:65-81`. I3 says "Add a runtime assertion,
not just a comment" about the *chart / signal / backtest* boundary — that is the
direction `assertNotSynthetic` exists for, and it has no executing instance on any
such boundary. The function is correct and unit-tested; it is not deployed.

Existing-and-unit-tested is not the same as wired. This alone blocks `ENFORCED`,
independently of the mutation results below.

**Direction note.** The wired guard (`unwrapSynthetic`) fires when *real* data
arrives at a *synthetic-only* surface. That is the useful-but-secondary direction.
The unwired guard (`assertNotSynthetic`) fires when *synthetic* data arrives at a
*real-only* surface — the direction I3 is actually about. The deployed runtime
half is the one I3 does not ask for.

---

## GUARD COVERAGE MAP

Named artifact: `__tests__/architecture/synthetic-containment.test.ts` (17 tests,
green at baseline).

**Directories scanned** — `:40`
`SCANNED_DIRS = ['app', 'components', 'lib', 'hooks', 'scripts']`

`scripts/` **is** included. This is a real fix of the predecessor's blind spot and
it is self-checked: `:96` asserts `allFiles.some(f => rel(f).startsWith('scripts/'))`,
and `:125-132` is a scripts-only offender test. `:91` asserts >100 files scanned so
a silently-empty `walk()` cannot make everything pass vacuously. These
anti-vacuity checks are good practice and they work — mutation M-A proves the
scripts path is live.

**Not scanned:** `middleware.ts` (repo root), `types/`, `tests/`, `ml/`,
`quant_framework/`, `src/`, `public/`. Of these only `middleware.ts` is live
production TypeScript; the rest are Python, type declarations or assets.

**File extensions** — `:59` `/\.(ts|tsx|mjs|js)$/`. JSON, CSV and YAML are
invisible to every check in the file. A `lib/seed-prices.json` imported by a route
is outside the guard's reach by construction. *(Code-read, not mutation-verified —
see BLIND SPOTS.)*

**What the guard actually keys on.** Three independent rules, and this is the crux
of the tier:

| Rule | Line | Keys on |
|---|---|---|
| Fixture-module import ban | `:85` `MENTIONS_MOCKDATA = /['"][^'"]*mockData['"]\|\bmockData\b/` | the **literal string `mockData`** |
| Cast-laundering ban | `:192-198` | the literal text `as … Synthetic<` |
| Inline-fabrication heuristic | `:221-222` | a `title:`/`headline:` literal ≥15 chars **AND** a capitalised `source:`/`publisher:` literal in the same file |
| Removed-path regressions | `:138-162` | the literal names `generateDarkPoolMarkers`, `getNewsForSector`, `SECTOR_NEWS`, `darkPoolMarkers`, `news?: NewsItem[]` |

**Nothing in the file keys on synthetic-*ness*.** The mechanism is an *opt-in
registry of known-bad names*, not a property. It contains data that routes through
`lib/mockData.ts` or through `markSynthetic`, and is blind to a synthetic source
that simply does neither. The guard's own header at `:14-17` claims the opposite —
"That is a property rather than a pattern match, so it survives import syntax the
author never anticipated" — and mutation M-D falsifies that sentence directly.

**Allowlist** — `:46-51`. Four files may reference the fixture module, two of them
live user-facing pages (`app/stock/[ticker]/page.tsx`, `app/sector/[slug]/page.tsx`).
`:99-103` correctly checks for stale entries. All four exist.

---

## MUTATION TABLE

Command for every row (baseline first, 17/17 green, so a red is attributable):

```
npx vitest run __tests__/architecture/synthetic-containment.test.ts
```

Escapes were additionally re-run against the wider gate:

```
npx vitest run __tests__/architecture __tests__/quant/syntheticGuard.test.ts   # 48 tests
npx tsc --noEmit
```

| # | Mutation | Where planted | Command | Result |
|---|---|---|---|---|
| **M-A** | *(positive control)* Static `import { generateDarkPoolPrints } from '../lib/mockData'` + a live call | `scripts/benchmark-signals.ts:23-24` | `npx vitest run __tests__/architecture/synthetic-containment.test.ts` | **CAUGHT** — 2 failed / 15 passed. Failures at `:113` and `:131`; `offenders` array named `["scripts/benchmark-signals.ts"]`, i.e. *my* file |
| **M-B** | New synthetic module under a **different name**: `lib/demoPrices.ts` → `generateDemoCloses()` (LCG-fabricated price series), imported and consumed by a backtest | new `lib/demoPrices.ts` + `scripts/benchmark-signals.ts` | as above, then `npx vitest run __tests__/architecture __tests__/quant/syntheticGuard.test.ts` and `npx tsc --noEmit` | **ESCAPED** — 17/17 pass, 48/48 pass, tsc clean |
| **M-C** | Test fixture imported *into* production: `__tests__/fixtures-M3.ts` exporting `SYNTHETIC_CLOSES`, imported by a `lib/quant` signal module and re-exported as `benchmarkFallbackCloses()` | `lib/quant/relativeStrength.ts:1-2` | as above | **ESCAPED** — 17/17 pass |
| **M-D** | Computed/concatenated import specifier — no literal `mockData` token exists in the file: `const _seg = 'mock' + 'Data'; await import(\`@/lib/${_seg}\`)` | `app/api/chart/[ticker]/route.ts` (the live chart route) | as above | **ESCAPED** — 17/17 pass |
| **M-E** | Inline fabricated OHLC in a live route: `Math.random()` candle generator + `_fallbackChart()` returning `{ candles, source: 'yahoo' }`. No import of any kind; no `title`/`source` literal *pair*, so the fabrication heuristic does not apply | `app/api/chart/[ticker]/route.ts` (the live chart route) | as above | **ESCAPED** — 17/17 pass |
| **M-F** | Synthetic dark-pool prints wired into the chart marker prop, keyed on the print's own `time`: `darkPoolMarkers={darkPoolPrintRows.map(r => ({ time: r.time, … }))}` on `<KLineChart>` | `app/sector/[slug]/page.tsx:493` | as above, plus `npx tsc --noEmit` | **ESCAPED** the guard — 17/17 pass, tsc clean. But see below: this wiring is **inert at render** |
| **M-F2** | **The original Q-088 defect, faithfully restored in one prop.** Same, but keyed on **real candle times** so the render-time join succeeds: `time: String(candles[(i * 7) % candles.length]?.time ?? '')` — i.e. synthetic prints plotted at arbitrary candle indices, which is verbatim what the deleted `generateDarkPoolMarkers()` did | `app/sector/[slug]/page.tsx:493` | `npx vitest run __tests__/architecture __tests__/quant/syntheticGuard.test.ts` + `npx tsc --noEmit` | **ESCAPED** — 48/48 pass, **tsc clean** |

**Score: 1 caught, 6 escaped.**

All six reverted (`git checkout --` for tracked files, `rm` for the two untracked
ones). `git status --porcelain` verified empty after each revert, not only at the
end. Baseline re-run after the final revert: 31/31 green across both guard suites.

### Why M-F/M-F2 is the decisive result — and the distinction between them

**A mutation that compiles is not a mutation that renders.** This repo's standing
lesson is "tagged code ≠ fixed effect"; the mirror of it applies to my own
mutations, so I checked, and my first attempt was wrong.

**M-F escapes the guard but is inert at render.** `hooks/useKLineChart.ts:822`
filters markers with `sortedCandles.some((c) => c.time === m.time)`.
`DarkPoolPrint.time` (`lib/sectors.ts:196`) is a string built at
`lib/mockData.ts:83` as `time.toTimeString().slice(0, 8)` — a time-of-day like
`"14:58:00"`. `Candle.time` (`components/KLineChart.tsx:26`) is `string | number`,
and equity candles arrive as `YYYY-MM-DD`. `"2024-05-15" === "14:58:00"` is false,
so every marker M-F planted is silently dropped before drawing. M-F proves a
**guard gap**; on its own it does not prove a rendered defect, and claiming
otherwise would be the same evidence-reading error the first Q-088 attempt made.

**M-F2 closes that gap.** Keying the marker on `String(candles[i].time)` makes the
join at `:822` succeed by construction — for equity candles `time` is already a
`YYYY-MM-DD` string, so `String()` is identity and the comparison is true for
every selected candle; `:824` then casts it to lightweight-charts' `Time`, for
which `YYYY-MM-DD` is the valid BusinessDay form. M-F2 is green on all 48 tests
and on `tsc`. It is *the exact defect Q-088 was opened for* — synthetic block
prints drawn on real price candles at arbitrary indices — reintroduced in a single
JSX prop.

**The supply is live, not hypothetical.** `darkPoolPrintRows` is not permanently
empty: `setDarkPoolPrints(generateDarkPoolPrints(sector.etf))` runs in an effect at
`app/sector/[slug]/page.tsx:188`, and `app/stock/[ticker]/page.tsx:220` does the
same. Populated synthetic prints sit in scope on both pages on every render.

*(Not verified: actual pixels. I did not boot the dev server. The join is proven at
the code level, not observed on screen — see BLIND SPOTS 3.)*

The brand does not stop either variant, and the reason is structural rather than a
slip. Both pages unwrap at the top of the component:

- `app/sector/[slug]/page.tsx:63` — `const darkPoolPrintRows = unwrapSynthetic(darkPoolPrints, 'SectorPage.darkPoolAggregateTiles')`
- `app/stock/[ticker]/page.tsx:293` — same, `'StockPage.darkPoolAggregateTiles'`

After that line the value is a plain `DarkPoolPrint[]` in the component's lexical
scope. The brand is gone. Every subsequent use — including the chart 430 lines
below — is unconstrained, and the surface name passed to `unwrapSynthetic`
("...AggregateTiles") is a string for an error message, not a scope restriction.
The wrapper narrows *who may open the box*; it does nothing about what happens
after the box is open, and the box is opened at the top of the same file that
renders the chart.

The sink is fully wired to receive it: `components/KLineChart.tsx:55-56` accepts
both marker props, `hooks/useKLineChart.ts:821-832` builds and draws both marker
layers, and `:910` lists them in the effect deps. `assertNotSynthetic` exists for
exactly this boundary and is not called there.

---

## RESIDUE — Q-089 and Q-096

**Q-096 ("KLineChart marker props still wired ungated") — OPEN, and understated.**

The ticket says "Nothing is broken today ... this is the belt-and-braces layer",
priority P3. The first half is true; the reasoning for the priority is not.

Verified current state:
- `components/KLineChart.tsx:34-46` — `DarkPoolMarker` / `NewsMarker` interfaces intact
- `components/KLineChart.tsx:55-56` — `darkPoolMarkers?: DarkPoolMarker[]` and `newsMarkers?: NewsMarker[]` still accepted; defaulted to `[]` at `:190-191`, forwarded at `:260-261`
- `hooks/useKLineChart.ts:161-162, 198-199, 821-832, 910` — both marker layers still constructed and drawn
- `components/crypto/BtcChartPanel.tsx:94-95` — the only site passing them, and it passes `EMPTY_DARK_POOL_MARKERS` / `EMPTY_NEWS_MARKERS`
- `app/sector/[slug]/page.tsx:493` and `app/stock/[ticker]/page.tsx:473` render `<KLineChart>` and pass **no** marker props

So: **no live synthetic path to a chart today.** Confirmed. But the ticket's stated
mitigation — "the architecture allowlist already blocks the import path that fed
them" — is wrong, and M-F is the proof. The reintroduction does not need an import
path. Both pages already hold the unwrapped synthetic array in scope. Q-096 is not
belt-and-braces over a blocked path; on the two pages that matter it is the **only**
layer, and it is absent.

The props are typed as plain arrays, so the brand does do real work here in one
respect: a `Synthetic<DarkPoolPrint[]>` cannot be passed to `darkPoolMarkers`
without an explicit unwrap. The gap is that the unwrap has already happened
upstream for an unrelated reason.

**Q-089 ("keep or delete the synthetic prints surface") — OPEN, owner-blocked, correctly filed.**

`lib/mockData.ts:65-98` — `generateDarkPoolPrints` survives, returns
`Synthetic<DarkPoolPrint[]>` via `markSynthetic(rows)` at `:97`. Consumed by
`app/sector/[slug]/page.tsx:12` and `app/stock/[ticker]/page.tsx:21`. This is a
table/gauge/tiles display surface, outside I3's literal "backtest, chart, signal"
clause. The ticket's own note that the aggregate tiles carry no ILLUSTRATIVE
disclosure is accurate and is an I1/I2 matter, not I3.

Relevant to this audit only in that Q-089 is the *supply*, and M-F shows the
distance from that supply to a chart is one line. Resolving Q-089 as DELETE would
close M-F as a side effect; resolving it as KEEP leaves M-F live.

---

## EVIDENCE — item 6: are the deleted functions actually gone?

Not a simple yes.

**`lib/mockData.ts` still exists as production code.** It is not under `__tests__/`
or `tests/`, and it is imported by two live user-facing pages
(`app/sector/[slug]/page.tsx:12`, `app/stock/[ticker]/page.tsx:21`). I3's first
sentence — "permitted only in `__tests__/` and `tests/`" — is therefore still not
satisfied at the letter. The file is 98 lines and contains exactly one export.

**The two named functions are genuinely deleted from history, not renamed.**
`git log --oneline -S'getNewsForSector'` returns `18afde2`, `0027886`, `047ae57`,
`de9a3d5` — the string enters and leaves the tree; `0027886` is the removal.
`git show 0027886 --stat` confirms `lib/mockData.ts` and
`app/api/chart/[ticker]/route.ts` were both rewritten in that commit, and the
message documents the removal of `generateDarkPoolMarkers()` "plus both chart-route
call sites, the cache entry type, the response field and dead marker state in two
pages". Guard assertions `:139`, `:143-144`, `:157` and `:161` lock all of it.
Repo-wide grep for `generateDarkPoolMarkers`, `getNewsForSector` and `SECTOR_NEWS`
outside comment prose returns nothing.

Those specific deletions are real and defended. It is the *class* of defect that
is not.

---

## WHAT I CHECKED

1. `lib/synthetic.ts` read in full; brand direction verified by compiling five
   assignability probes with `tsc --strict`, not by reading the comment.
2. `assertNotSynthetic` / `unwrapSynthetic` / `isSynthetic` traced to the runtime
   property they key on (`:53`) and to the constructor that sets it (`:45`).
3. Production call sites of all four exports, grepped across
   `app components lib hooks scripts middleware.ts types` with no extension filter
   (an earlier `--include="*.ts*"` grep would have missed `.mjs` under `scripts/`).
4. `__tests__/architecture/synthetic-containment.test.ts` read in full: scanned
   dirs, extension filter, every regex, the allowlist, and the anti-vacuity checks.
5. Seven mutations planted and run; for the one that was caught, the `offenders`
   array was read to confirm it named my file rather than failing for another
   reason.
6. Every escape re-run against `npx tsc --noEmit`, so "escaped" means escaped the
   whole static gate, not just one test file. **Sequencing disclosure:** M-B and
   M-F were tsc-checked at plant time; M-C, M-D, M-E were initially verified
   against the vitest guard only, and I replanted each and ran `tsc --noEmit`
   separately to confirm before publishing this. All were clean. `tsconfig.json`
   has `include: ['**/*.ts', '**/*.tsx', …]` and excludes only `node_modules`, so
   `__tests__/` is inside the tsc program — which is why M-C does not error.
7. **M-F's render path**, after the guard result: the marker-time/candle-time join
   at `hooks/useKLineChart.ts:822`, the `DarkPoolPrint.time` format at
   `lib/mockData.ts:83`, the `Candle.time` type at `components/KLineChart.tsx:26`,
   and whether `darkPoolPrintRows` is ever non-empty (`setDarkPoolPrints` call
   sites at `app/sector/[slug]/page.tsx:188`, `app/stock/[ticker]/page.tsx:220`).
   This is what turned M-F into M-F2.
8. Q-096 and Q-089 file:line state verified against the current tree.
9. `git log -S` and `git show --stat` for the deletion claims, since grep cannot
   distinguish deleted from renamed.

## WHAT WOULD HAVE SHOWN FAILURE

- **Brand direction:** probes A/B/C compiling clean → brand still inverted.
  They errored. Direction is right.
- **Runtime assertion:** `isSynthetic` keying on a type-only construct, or
  `assertNotSynthetic` taking a caller-supplied boolean → a no-op. It keys on a
  real own property. It can fire. It is simply never called.
- **Guard coverage:** `scripts/` absent from `SCANNED_DIRS`, or M-A passing green →
  the scripts claim would be theatre. M-A went red and named the file. The claim
  is true, for `mockData` references.
- **Overall tier:** all seven mutations caught → `ENFORCED` would have been the
  correct upgrade, and I was prepared to make it. Five escaped.
- **`VIOLATED`:** a live call site passing non-empty markers to `<KLineChart>`, or
  a synthetic import in a non-allowlisted route/script on the unmutated tree.
  Neither exists.

## BLIND SPOTS

1. **The JSON/CSV fixture gap is inferred, not mutation-proven.** `walk()` at `:59`
   filters to `.ts|.tsx|.mjs|.js`; I did not plant a `.json` fixture and run it. The
   conclusion follows from the code but is one confidence level below the six
   mutation results.
2. **`tests/` (lowercase) is not scanned and I did not audit its contents.** I3
   names it as a permitted location, so files there are legitimate, but nothing
   stops production code importing from it either — the same hole M-C found in
   `__tests__/`.
3. **No mutation was exercised at runtime.** Every result in the table is a
   *static-gate* result (vitest guard + `tsc`). I did not boot the dev server, hit
   a route, or look at a chart. Three specific consequences:
   - **M-D:** I cannot say whether a Next.js/webpack build would reject the
     computed dynamic specifier at bundle time. Per the standing note that Next
     route config is static-analysis-only and the Vercel build is the sole gate for
     it, this is a real gap in M-D's escape claim specifically. M-E involves no
     import and is unaffected.
   - **M-F2:** the marker/candle join is proven by reading the comparison at
     `hooks/useKLineChart.ts:822` against the two `time` formats, not by seeing
     markers on screen. I am confident it draws; I did not watch it draw.
   - This distinction is load-bearing and it is why M-F was split into M-F and
     M-F2 rather than reported as one success — a mutation that compiles is not a
     mutation that renders, and my first version of M-F was the latter kind.
4. **Python is entirely out of scope.** `ml/`, `quant_framework/`,
   `multi_agent_factor_mining/`, `alpha_miner.py`, `options_*.py` and the
   `server_*.py` services are unscanned by any I3 mechanism and unexamined here.
   `alpha_miner.py` and `quant_framework/` are research surfaces where I3's
   "backtest" clause plainly applies.
5. **I did not run the full suite** (per task constraint), so a guard living
   outside `__tests__/architecture` and `__tests__/quant/syntheticGuard.test.ts`
   could in principle catch M-B..M-F. I grepped for other `__SYNTHETIC__`
   consumers and found none, which makes this unlikely but not excluded.
6. **The fabrication heuristic was not probed on news-shaped content**, since the
   previous author's M4 covered it. My M-E deliberately used price data, which that
   heuristic was never designed to detect — so M-E is a gap in *scope*, not
   evidence the heuristic is broken at what it does target.
7. **Mutation count is 7, not exhaustive.** "Escaped" is proof of a hole;
   "caught" is proof only for the mutation run.

---

## FINDINGS NOT FIXED

Per task constraint, filed not fixed. Suggested rows for
`reviews/findings-ledger.csv` (not written by me — this audit's only persistent
edit is this file).

| id | sev | one-line risk-register description |
|---|---|---|
| Q079-I3-1 | **CRITICAL** | The I3 architecture guard keys on the literal module name `mockData` (`__tests__/architecture/synthetic-containment.test.ts:85`), so a synthetic source under any other name — or fabricated inline with no import at all — reaches a backtest, a chart or a signal with all 17 guard tests and `tsc` green (mutations M-B, M-E). |
| Q079-I3-2 | **HIGH** | Both live pages call `unwrapSynthetic` at component top (`app/sector/[slug]/page.tsx:63`, `app/stock/[ticker]/page.tsx:293`), stripping the brand into lexical scope, so the populated synthetic array (set at `:188` / `:220`) is freely assignable to `<KLineChart darkPoolMarkers>` in the same file — the original Q-088 chart defect is a one-prop, type-clean, guard-green reintroduction inside an allowlisted file, with the marker/candle join satisfied (mutation M-F2). |
| Q079-I3-3 | **HIGH** | `assertNotSynthetic` (`lib/synthetic.ts:87-95`) has zero production call sites; I3's "add a runtime assertion" clause has no executing instance on any chart, signal or backtest boundary — the only deployed runtime guard is `unwrapSynthetic`, which fires in the opposite (secondary) direction. |
| Q079-I3-4 | **MEDIUM** | Production `lib/` may import `__SYNTHETIC__`-tagged fixtures from `__tests__/` with no rule against it — the literal inverse of I3's own first sentence — and a `lib/quant` signal module re-exporting a test fixture passes every gate (mutation M-C). |
| Q079-I3-5 | **MEDIUM** | The guard's documented self-description at `__tests__/architecture/synthetic-containment.test.ts:14-17` ("a property rather than a pattern match, so it survives import syntax the author never anticipated") is false; a concatenated specifier `'mock' + 'Data'` defeats it (mutation M-D). A comment that overstates a guard is how the first attempt shipped green. |
| Q079-I3-6 | **MEDIUM** | Q-096 is filed P3 on the stated grounds that "the architecture allowlist already blocks the import path" and it is "belt-and-braces"; M-F2 shows no import path is needed, so on the two pages holding unwrapped synthetic prints the absent marker-prop guard is the only layer, not the second one. Priority warrants review. |
| Q079-I3-7 | **LOW** | `walk()` at `__tests__/architecture/synthetic-containment.test.ts:59` matches only `.ts/.tsx/.mjs/.js`, so JSON/CSV/YAML fixture files are invisible to every I3 check (code-read, not mutation-verified). |
| Q079-I3-8 | **LOW** | The brand-direction regression test at `:176` is a regex matching one exact spelling of the inverted form; a re-inversion written differently would keep it green. The compiler is the real gate — consider a `tsc`-based leak probe as the durable artifact. |
| Q079-I3-9 | **INFO** | `lib/mockData.ts` remains production code imported by two live pages, so I3's "permitted only in `__tests__/` and `tests/`" clause is unsatisfied at the letter; resolution is owner-blocked under Q-089. |

### Note for the CLAUDE.md tier line

The tier letter does not change, but the sentence under it should. It currently
reads *"Today: honest data labeling and chart integrity landed (#142/#143)"* for I1
and carries the Q-088 result for I3. A truthful I3 note is closer to:

> *Today:* the two Q-088 defects are genuinely dead and the `Synthetic<T>` wrapper
> in `lib/synthetic.ts:34` is correctly directional (verified by `tsc`). But the
> architecture guard contains a named module, not a property — a synthetic source
> under a different name, or fabricated inline, escapes every gate (Q-079, 6 of 7
> mutations escaped). `assertNotSynthetic` has no production call site.
