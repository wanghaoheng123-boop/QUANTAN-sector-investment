# Red-team: `2760ab9` — I8 egress import graph (Q107-S9)

Branch `fix/Q107-S9-egress-import-graph`. Reviewed 2026-09-09.
Baseline before every mutation: `102 passed (102)`. Tree verified clean after each
mutation (`git status --short` returns only the four pre-existing untracked dirs).

**Verdict: the headline claim does not hold.** The commit's own acceptance test is
"a new public route that serves an already-registered end-user-exposed vendor
produces `surface-added`". I constructed **five** such routes that ship green,
three of them requiring no adversarial intent whatsoever, and **five real files
already in `app/`** that are structurally outside the surface set.

---

## CRITICAL-0 (I3, NOT introduced by this commit) — the same clause swallow silently disables synthetic containment on a live API route

**Found by following this commit's resolver reuse back into
`__tests__/architecture/syntheticContainment.ts`. The defect is PRE-EXISTING; this
commit's contribution is having made it load-bearing for a second invariant.**
Log it against I3/Q-098, not against Q107-S9.

`syntheticContainment.ts:209` (`staticRe`) corrupts more than `typeOnly`.
`parseClause` at `:280` extracts named bindings from the **first braced group in the
clause** (`/\{([^}]*)\}/`). When the swallow pulls a preceding declaration into the
clause, the first braced group is that declaration's body, so `.named` returns
garbage and `markSynthetic` is not among it. `importsConstructor` (`:176-196`) —
which CLAUDE.md describes as the *only* surviving detector, the text-matching
versions having been removed as defeated — therefore returns `false`, the module is
never classified synthetic, and no downstream rule fires.

Measured (virtual file set, real `analyse`, real `lib/synthetic.ts`):

| producer source | `importsConstructor` | `parseClause.named` | violations |
|---|---|---|---|
| `import { markSynthetic } …` | `true` | `[markSynthetic]` | `synthetic-reexport`, `synthetic-import` |
| `export type Row = { close: number }` above it | **`false`** | `[{"exported":"close: number"}]` | **NONE** |
| `export interface Row { close: number }` above it | **`false`** | `[{"exported":"close: number"}]` | **NONE** |

Note the third row: the trigger is **not** the `type` keyword. Any `export`/`import`
word with a braced body before the real import works, so `export interface` — which
does not touch `typeOnly` at all — defeats it too.

Reproduction on the real tree:

```ts
// lib/redteam/producer.ts
export type Bar = { close: number }
import { markSynthetic } from '@/lib/synthetic'

export const fabricatedSeries = markSynthetic([{ close: 101 }, { close: 102 }])
```
```ts
// app/api/redteam-live/route.ts
import { fabricatedSeries } from '@/lib/redteam/producer'
export async function GET() { return Response.json(fabricatedSeries) }
```

`npx vitest run __tests__/architecture/synthetic-containment.test.ts`:

- control, `import` on line 1 → **`Tests 1 failed | 70 passed (71)`** (caught)
- mutation, `export type Bar` moved above → **`Tests 71 passed (71)`**

Fabricated OHLC reaching a live `app/api/**` route with the containment guard fully
green. CLAUDE.md I3: *"Any code path that could route synthetic data into a
backtest, a chart, or a signal is a P0 defect."* This is also a direct
counter-example to the I3 tier text's claim that the guard *"resolves the brand
constructor through the import graph (any alias, any number of re-export hops)"* —
resolution is defeated by one line of ordinary TypeScript, in the position
TypeScript permits it.

**Bearing on this commit's argument.** `importGraph.ts:33-40` argues the resolver
must be imported because *"a second copy would re-open every one of those escapes."*
The layering is right and the conclusion is backwards in one respect: importing the
resolver imported its defect, and the defect now has two dependants instead of one.
A shared resolver is a shared single point of failure, which is an argument for
hardening it, not for treating it as already hard.

**Author should have done:** parse the clause from the *statement* rather than from
whatever text precedes the `from`. Minimally, treat a clause containing a second
`import`/`export` keyword as unparsed and raise, instead of silently returning
garbage `.named` and a wrong `typeOnly`.

---

## CRITICAL-1 — One `export type` line above the import deletes the edge

`__tests__/architecture/importGraph.ts:113` (`if (parseClause(spec.clause).typeOnly) continue`)
against `__tests__/architecture/syntheticContainment.ts:209`
(`staticRe = /\b(import|export)\b([\s\S]{0,800}?)\bfrom\s*['"]([^'"]+)['"]/g`).

`staticRe` matches non-overlapping, left-to-right, and anchors on the **first**
`import`/`export` word. A preceding `export type X = …` — which has no `from` of
its own — swallows the next real import statement into its clause. The captured
clause then begins ` type `, `parseClause` at `:276` reports `typeOnly: true`, and
`importGraph.ts:113` drops the edge.

Reproduction (run against the committed tree):

```ts
// app/api/rt-escape/route.ts
export type Params = { ticker: string }
import { fetchBloombergQuotesViaBridge } from '@/lib/data/bloomberg/bridgeClient'

export async function GET() {
  const q = await fetchBloombergQuotesViaBridge(['AAPL'])
  return Response.json(q)
}
```

`npx vitest run __tests__/architecture/vendor-licence-register.test.ts` →
**`Tests 102 passed (102)`**. A brand-new unauthenticated public route serving
Bloomberg to end users, zero violations. The control (same file without line 1)
→ `surface-added: BLOOMBERG_BRIDGE_URL`.

`export type Params = …` at the head of a Next.js route file is idiomatic, not
adversarial — and in *this* repo nothing would ever flag it: the ESLint rule that
ordinarily makes import-after-declaration unusual is `import/first`, and **no lint
exists here at all** (CLAUDE.md / Q-093: no `lint` script, no tracked config, not
installed, zero workflow hits). The code is valid TypeScript, valid Next.js, and
unreviewed by any tool. "Idiomatic" is a measured property of this tree, not an
assertion. This is not a declared gap: the CANNOT-do block at `:715` declares only
`app/api/x/handler.ts` and `pages/api/legacy.ts`.

**Same mechanism, two more triggers, both verified ESCAPE:**

- **A comment.** `buildImportGraph` at `importGraph.ts:111` calls
  `extractSpecifiers(file.source)` on the **raw source**. `syntheticContainment`'s
  own `importsConstructor` calls `stripComments` first; this new caller does not.
  So `// we import type helpers from the bridge` on the line above the vendor
  import, or a JSDoc block containing the words `import type … from`, sets
  `typeOnly` and deletes the edge. Verified on the real tree.
- **`import type Foo = require('x')`** above the vendor import: same swallow.

**Author should have done:** strip comments before extracting (one call, already in
the same module), and derive `typeOnly` from the specifier's own statement rather
than from a clause that can span two statements — e.g. test
`/^\s*type\s/` against `clause.slice(clause.lastIndexOf('import') ...)`, or reject
any clause containing a second `import|export` keyword as unparsed rather than
silently classifying it.

---

## CRITICAL-2 — An import list longer than 800 characters is invisible

`syntheticContainment.ts:209`, the `{0,800}?` bound. If the text between `import`
and `from` exceeds 800 characters, `staticRe` produces **no specifier at all** —
not a type-only one, none. The edge does not exist and nothing reports it.

Reproduction: `app/api/rt-long/route.ts` with a 70-member named-import list
(measured clause length 1708) importing `fetchBloombergQuotesViaBridge`.
Real tree, real suite → **`Tests 102 passed (102)`**.

Longest real clause in the repo today is well under 800, so nothing is currently
mis-recorded — but the guard's job is the *next* file, and a 70-icon `lucide-react`
import or a large barrel pull is ordinary. Unlike CRITICAL-1 this needs no `type`
keyword and no comment.

**Author should have done:** either raise/remove the bound with a stated reason, or
assert that no clause in the tree is within (say) 2× the bound — the same
"measure the boundary" discipline the walker's `EXECUTABLE` block already applies to
extensions.

---

## CRITICAL-3 — Five existing `app/` files are not in the surface set, and `error.tsx` is one of them

`__tests__/architecture/importGraph.ts:67-68`:

```
/^(middleware\.(?:ts|js)|app\/(?:.*\/)?(?:route|page|layout)\.(?:tsx?|jsx?))$/
```

Measured against the real tree, these `app/` files match nothing:

```
app/error.tsx
app/global-error.tsx
app/not-found.tsx
app/briefs/error.tsx
app/briefs/sector/[sector]/error.tsx
```

(The other three unmatched `app/` files — `SignInButtons.tsx`, `BriefCard.tsx`,
`LiveBriefClient.tsx` — are ordinary components reached transitively from a page,
so they are correctly not roots.)

Error boundaries and `not-found` are **convention-discovered entry points with no
importer**, exactly like `page.tsx`. Being absent from `PUBLIC_SURFACE` means their
entire import subtree is attributed to nothing.

Reproduction: replace `app/briefs/error.tsx` with a client component importing both
`yahoo-finance2` and `fetchBloombergQuotesViaBridge`. Real tree, real suite →
**`Tests 102 passed (102)`**. Same result for `app/not-found.tsx` and
`app/global-error.tsx`.

Zero-instance-today variants that also escape (verified via the same harness with
the real file set and real register): `default.tsx` (parallel routes),
`template.tsx`, `sitemap.ts`, `opengraph-image.tsx`, `instrumentation.ts`.
These are the "there are none right now" reasoning the author explicitly rejected
for `.json` in Q-098 and for `.sh`/`Dockerfile` in the walker's own comment — the
regex applies the rejected reasoning.

**Author should have done:** enumerate the Next.js reserved filenames
(`route|page|layout|template|default|error|global-error|not-found|loading|sitemap|
robots|manifest|icon|apple-icon|opengraph-image|twitter-image`) plus
`instrumentation.ts`, and assert the count of matched surfaces against a measured
number so a new reserved name is a red test rather than a silent hole.

---

## HIGH-1 — The REQUIRED parameter does not prevent the inert-guard defect; rule 8 can be zeroed with the suite green

`__tests__/architecture/vendorEgress.ts:604-628`. The commit argues a required
`surfaces` parameter "makes `tsc` the thing that notices a forgotten call site".
True — and irrelevant. `tsc` guards the *call site*; nothing guards the *data*.

Rule 8 fires only on `reached.filter(s => !recorded.has(s))`. Removals are
deliberately never violations and **nothing anywhere validates that a path listed
in `exposed_via` exists or is reachable**. So widening every `exposed_via` to the
full set of public surfaces makes rule 8 permanently unfirable.

Reproduction: union each of the 12 `exposed_via` arrays with all 46 public surfaces
plus two invented future paths, then add
`app/api/anything/route.ts` importing both `bridgeClient` and `yahoo-finance2`.
Real tree, real suite → **`Tests 102 passed (102)`**, zero `surface-added`.

The only test that could have caught it, `:323` (`has exposed_via on every exposed
row the graph can see, and on no other`), asserts `surfaces.get(k).length > 0` —
i.e. that *something* is reached, never that what is recorded is what is reached.
Its name says "and on no other"; it does not check that.

**Author should have done:** flag a recorded surface that neither reaches the vendor
nor matches an existing file as `surface-stale` (a warning-level rule at minimum),
and assert `exposed_via ⊆ {paths matching PUBLIC_SURFACE that exist}`. Over-recording
is only "the safe direction" for *reporting*; for a rule that keys on set
difference it is the kill switch.

---

## HIGH-2 — `exposed_via` understates the CRITICAL row, and the counter-example was sitting in the same row

`reviews/vendor-licence-register.json`, row `env-host|BLOOMBERG_BRIDGE_URL`:

```
evidence   : [... , "components/stock/quantlab/tabs/SummaryTab.tsx:32", ...]
exposed_via: ["app/api/bloomberg-bridge/health/route.ts",
              "app/api/fundamentals/[ticker]/route.ts",
              "app/api/prices/route.ts"]
```

`SummaryTab.tsx:32` renders a literal **"Bloomberg spot $X"** badge to the user. It
is imported by `components/stock/QuantLabPanel.tsx:11`, which is imported by
`app/stock/[ticker]/page.tsx:13` and rendered at `:447`. That page is where a human
being actually sees Bloomberg data — and it is **absent from `exposed_via`**,
because the value arrives as a prop from a fetch rather than through an import edge.

The *mechanism* gap is declared at test `:689` ("CANNOT see a vendor rendered on a
new surface from an ALREADY-fetched field") — but it is declared with a **virtual
toy example**, while the real instance was in the evidence array of the very row the
commit was editing. The result is that the register now carries two disagreeing
surface lists for the highest-risk vendor, the hand-typed one is the more complete,
and the computed one is the one the gate keys on.

The test name at `:314` — `records every public surface that exposes a vendor to an
end user` — asserts a completeness the mechanism cannot deliver and does not have.
Test names are read as claims in this repo.

**Sharper still — the register is internally inconsistent as landed, not merely
incomplete.** `app/stock/[ticker]/page.tsx` appears in `exposed_via` for
`env-host|TRADING_AGENTS_BASE` and `env-host|TRADING_AGENTS_FALLBACK_BASE`, and is
absent from `exposed_via` for `env-host|BLOOMBERG_BRIDGE_URL`. **Same page, same
commit, opposite treatment**, decided solely by whether the vendor is reached
through an imported hook (`components/stock/quantlab/hooks/useQuantLabLlm.ts`) or
through a prop (`SummaryTab.tsx:32`). A reader of the register cannot tell that the
absence means "the tool cannot see it" rather than "it is not exposed there" — and
the declared CANNOT at `:689` does not say which rows it applies to.

**Author should have done:** reconcile `exposed_via` against `evidence` (or annotate
the row with the known prop-mediated surface), and rename the test to what it
checks. A declared CANNOT covers the mechanism; it does not license the artifact to
be wrong about a surface the author already knew about.

---

## HIGH-3 — `evidence` still has zero readers, and the commit added a second field beside it instead of a reader

`__tests__/architecture/vendorEgress.ts:447` declares `evidence?: string[]`. Grep of
`checkRegister` (`:498-630`): **no rule reads `e.evidence`.** All 93 rows carry one.

The commit message's own diagnosis is "`app/api/trading-agents/health/route.ts`
appeared in NO row's evidence across all 93" — i.e. the defect is *an unchecked
field drifting from reality*. The fix adds `exposed_via` next to it and leaves
`evidence` unchecked. This is structurally the `_cached`/`QuoteProvenance` shape the
repo has closed twice (I1, I2 cache clause): a field written by hand, read by
nobody. CLAUDE.md's "one file per job, no duplicates" applies one level down —
there are now two surface lists per row and nothing makes them agree (measured: they
disagree on 9 of 12 rows).

**Author should have done:** either make `evidence` derived, or add a rule that
`evidence` paths must exist and must not name a public surface absent from
`exposed_via`.

---

## MEDIUM-1 — `expect(withField.length).toBeGreaterThanOrEqual(12)` is the anti-pattern this same file condemns 250 lines above it

`__tests__/architecture/vendor-licence-register.test.ts:328`.

At `:365-372` the author strikes an earlier `exposed.length >= 6` assertion with:
*"goes RED as a reward for withdrawing a vendor surface — the good outcome — and
whose fix would be editing the floor down."* Line 328 reintroduces exactly that
shape with a bare `12`.

Demonstrated: flipping `end_user_exposed` to `false` on both trading-agents rows
(a two-key edit; neither id is in `NAMED_MARKET_DATA_VENDORS`) fails with
`AssertionError: expected 10 to be greater than or equal to 12`. The suite is
therefore held together on that path by a magic count whose repair instruction is
"change 12 to 10" — and doing so silently re-opens the misclassification hole
declared at `:699`. Legitimate withdrawal of a vendor surface reddens it identically.

**Author should have done:** assert the *property* — every active end-user-exposed
row that the graph reaches has `exposed_via` — which `checkRegister` rule 8 already
computes, rather than a count.

---

## MEDIUM-2 — "The three adversarial rounds of hardening carry over" is false for the one field this code depends on

`importGraph.ts:33-40` and the commit body. `resolveSpecifier` and
`extractSpecifiers` were indeed hardened. But `parseClause().typeOnly` was **never
consumed by `syntheticContainment` at all**:

```
$ grep -rn "typeOnly" __tests__/ lib/ scripts/
importGraph.ts:113                    <- new
importGraph.ts:163                    <- new
syntheticContainment.ts:274,276,289   <- definition and return only
```

`importsConstructor` reads `.named` and `.namespaceAs`; the re-export provider loop
reads `.named`. `buildImportGraph` is `typeOnly`'s **first consumer**. The one
decision the new guard's correctness hinges on is precisely the one the three
adversarial rounds never exercised — and CRITICAL-1 is the consequence.

CRITICAL-0 then shows the stronger version: the corruption is not confined to the
unexercised field. It reaches `.named`, which *was* exercised, and defeats the I3
guard too. So the accurate statement is not "the hardening did not carry over" but
"the resolver was not as hard as three rounds made it look, and this commit gave the
soft spot a second dependant."

Related, and also a false carry-over: the hardened caller strips comments; this one
does not (`importGraph.ts:111`, `:161`).

Related and benign: `resolveSpecifier`'s `EXTS` includes `.json`, `.mts`, `.cts`,
but the test walker's `EXECUTABLE` regex admits none of the three, so those targets
can never be in `byPath`. `.json` is harmless (a JSON leaf cannot issue a request).
`.mts`/`.cts` are zero-instance today but *can* `fetch` — LOW, pre-existing, and not
covered by the CANNOT-do extension assertions at `:767`, which enumerate only
`.md/.json/.txt/.snap`.

---

## MEDIUM-3 — "The SEVENTH instance of the same defect" is not accurate

`importGraph.ts:21-29` and the commit body. The previous instances were an
**existing rule sitting at zero reachable instances** — a fixture directory, a
top-level directory, a file extension, a language never visited. Here **no existing
rule was inert**: rules 1-7 all key on egress and all fire correctly on their own
terms; the register's 93 rows are the detector's output, not a hand list.

What actually happened is that a *capability that never existed* is being added, and
a hand-maintained free-text field (`evidence`) drifted because nothing read it.
Calling that the seventh instance of a visitation defect converts a new feature into
a bug-class closure, which reads as more complete than it is.

Two of the six priors in the list are also not visitation defects on their own
terms: "a producer set defined in terms of the property under test" is circularity,
and Q-080's "a guard that cannot fail" (in the standing lessons, absent from this
list) is an unfirable assertion. The count is a narrative.

The commit's own honesty standard — "*that correction moves the headline in the
FLATTERING direction, which is exactly when to be most careful*" — applies to it.

---

## MEDIUM-4 — Nothing asserts that a `perFile` key is a file the walk visited

`importGraph.ts:157`: `add(p.where.split(':')[0], …)`. Measured on the real tree:
**0 of the FILE_BORNE points have a `where` path outside the scanned file set** — so
there is no live break here, and item 9 of the brief produces no finding today.

But the key is inserted unconditionally. If `detectEgress` ever emits a `where` the
walk did not produce, the egress point silently gets zero surfaces and rule 8 can
never fire for it — the exact seventh-defect shape, inside the fix for it. There is
no assertion guarding the invariant, and the `edgeCount > 300` check at `:231`
(actual 425, ~30% headroom) does not cover it.

**Author should have done:** one line —
`expect([...perFile.keys()].filter(k => !byPath.has(k))).toEqual([])`.

---

## MEDIUM-5 — Rule 8's `end_user_exposed` scope is defensible today but rests on a flag documented to have been wrong

`vendorEgress.ts:604`. The declared CANNOT at `:699` covers the mechanism, so this is
not reported as a new escape. The sharpening worth recording: `TRADING_AGENTS_BASE`'s
own `finding` text says *"CORRECTED after review; the first version said
end_user_exposed:false … and all three were wrong."* That row is **not** in
`NAMED_MARKET_DATA_VENDORS`, so the pin does not protect it.

I checked every `end_user_exposed: false` row that a public surface reaches
(`KV_REST_API_URL` 27, `QUANT_FRAMEWORK_URL` 2, `ML_SIDECAR_URL` 1, three
outbound-link hosts, `NEXTAUTH_URL`): all are infrastructure, operator sidecars,
outbound links or first-party. **No live misclassification.** The graph nevertheless
already computes the evidence that would close the gap — "a `PUBLIC_SURFACE` reaches
this row" is a stronger signal than a hand-set boolean — and the commit discards it.

---

## Categories where I found nothing

Stated explicitly rather than padded.

- **Claim 4, "transitive, not one-hop":** sound. `reachable` (`:190-208`) marks
  `seen` before push, terminates on the real cyclic graph, and drops no path. I
  diffed the guard's 425 edges against a comment-stripped, statement-anchored
  reference implementation: **0 missing**, 2 extra (both comment artefacts, safe
  direction). Yahoo resolves to 17 surfaces as claimed.
- **Claim 10, `packageOf` (`:122-127`):** no wrong attribution found. Scoped and deep
  imports, trailing slashes, `require()`, npm aliases (`"x": "npm:vendor@1"`) and
  `@/`-prefixed specifiers all attribute correctly. `tsconfig.json` declares only
  `@/*` and no `baseUrl`, so there is no second alias form to miss. `node:`-prefixed
  builtins attribute to a package name no register row carries — harmless.
- **Route groups, `route.js`, 3-hop re-export chains, namespace imports, dynamic
  `import()` with a literal, barrel `index.ts`, intercepting routes `(.)x/page.tsx`:**
  all **CAUGHT** (`surface-added`). Verified individually against the real file set
  and real register. The resolver hardening genuinely does carry over for these.
- **`.json`-mediated reach:** not a live escape. The walker excludes `.json`, so a
  JSON file is never an egress point, and JSON cannot import.
- **`src/`:** contains Python only. No `src/app` or `src/middleware.ts`. Moot.
- **Server actions (`'use server'`):** zero occurrences in `app/ components/ lib/
  hooks/`. Not a current surface class.
- **`where` path extraction:** 0 mismatches measured (see MEDIUM-4 for the missing
  assertion).

---

## What the all-clear rests on

`npm run test` is advisory — `main` has no branch protection and the required-check
set is empty (I7). The suite itself records this at `:855`. So even the rules that
do fire cannot block a merge; CRITICAL-1 through CRITICAL-3 mean the rule would not
have fired in the first place.
