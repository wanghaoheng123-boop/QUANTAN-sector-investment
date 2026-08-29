# Red team — I8 vendor-egress guard, round 4 (Q-107)

**Target.** `__tests__/architecture/vendorEgress.ts`, `__tests__/architecture/vendor-licence-register.test.ts`,
`reviews/vendor-licence-register.json` (90 rows), as merged in `5e3407e` / `af1e52c`.
**Baseline.** `npx vitest run __tests__/architecture/vendor-licence-register.test.ts` → **72 passed (72)**, 456 ms.
**Method.** Unit-level probes against the pure detector, then every headline finding re-run as a
**real-tree mutation with a paired control**, so a green result is never confused with an unreachable one.
All mutations reverted from `/private/tmp/rt-*.bak`; md5 of every touched file matches its pre-mutation value.

**Ids reserved: `Q107-R1` … `Q107-R19`. Nothing was written to `reviews/findings-ledger.csv`.**

---

## Verdict in one line

Round 3 fixed the *instances* red-team exhibited and not the *properties*. The masker no longer deletes
2387 characters, but it is still **string-unaware in both language families**, and the new
protocol-relative branch it was supposed to feed is **structurally unreachable in every JS-family file**.
The `dynamic_sites` field counts lines, not sites. The pinned-vendor list defeats last round's exact
mutation and falls to a one-row variation of it. **Six escapes were confirmed on the committed tree,
each against a control that goes red.**

Ranked by severity. `CONFIRMED` = observed on the real tree or by executing the shipped function.
`PLAUSIBLE` = reasoned from the code, not executed.

---

## Q107-R1 — HIGH — the protocol-relative `//host` branch cannot fire in any JS/TS file · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:110` vs `:291`.**

The matcher guards the bare `//` form on a preceding character class:

```
(?<=['"`(=,\s])\/\/(?=[a-z0-9][a-z0-9.-]*\.[a-z]{2,})        // :291
```

`stripComments` runs **first**, on the whole source, and masks a line comment on:

```
maskWith(..., /(^|[^:])\/\/[^\n]*/g)                          // :110
```

Every character in the matcher's guard set `['"`(=,\s]` is also a member of `[^:]`. The guard set is a
**strict subset of the mask trigger**, so in `.ts/.tsx/.js/.jsx/.mjs/.cjs` the mask always wins and the
protocol-relative branch has **zero reachable inputs**. This is not "usually" — no input exists that
reaches it.

Unit evidence (`detectEgress` on a one-file set):

| input | path | result |
|---|---|---|
| `const CDN = "//cdn.vendor.example/lib.js"` | `components/X.tsx` | `[]` — masked to `const CDN = ` + 30 spaces |
| `<img src="//img.vendor.example/a.png" />` | `components/X.tsx` | `[]` |
| `fetch("//api.vendor.example/v1")` | `lib/x.ts` | `[]` |
| `CDN = "//cdn.vendor.example/lib.js"` | `x.py` | `http-host\|cdn.vendor.example` ✅ |
| `  cdn: "//cdn.vendor.example/lib.js"` | `x.yml` | `http-host\|cdn.vendor.example` ✅ |

The branch works **only** in the hash-comment languages, where the JS masker does not run.

**Real-tree mutation.**
```
M0 control: components/RtProbeControl.tsx = fetch("https://api.hidden.example/v1")
            -> 2 failed | 70 passed        (walk sees new components)
M1:         components/RtProbe.tsx = <img src="//img.vendor.example/a.png" />
            -> 72 passed (72)              MISSED
```

**Why it shipped.** The only two tests that exercise a bare `//` use `x.py` and `x.yml` paths
(`vendor-licence-register.test.ts`, "does NOT invent a vendor from Python integer division or a YAML
glob"). No test ever asks a `.ts` path whether a protocol-relative host is caught. The capability was
added, tagged in the commit message, and is inert where browsers actually use it — the repo's own named
#1 sin, *tagged code ≠ fixed effect*.

**Severity framing, stated honestly.** A tree-wide diff of masked-vs-raw detection (script retained in
the scratchpad) found **no live protocol-relative fetch today** — the nine hosts masking currently hides
are all genuine comments (`docs.kraken.com` in a JSDoc, `nextjs.org` in `next-env.d.ts`, etc.). So this
is a *claimed capability that cannot fire*, not a live leak. It is HIGH because `<img src="//cdn…">` and
`new Image().src = '//…'` are ordinary front-end idioms and the guard's own docstring sells this branch
as the fix for the Kraken/Coinbase blindness.

**The test that documents this branch states a false reason, which is how it stayed hidden.**
`it('CANNOT see a host assembled by concatenation from fragments')` explains the gap as: *"The `//` must
now follow a string or expression boundary, and `:` is not one."* But `'https:' + '//api.hidden.example'`
**does** put the `//` immediately after a `'` — a string boundary, squarely inside the guard set — and it
is still missed, because `stripComments` blanks it first. The documented mechanism is not the operative
one. A reader checking that comment against the matcher would conclude the branch works.

**What the author should have done.** Mask comments with a scanner that tracks string state, or — much
cheaper — run the URL matcher on the **raw** line and use the masked line only to decide whether the hit
is inside a comment. Then add the missing test: a bare `//host` in a `.tsx` path.

---

## Q107-R2 — HIGH — hash-language masking is string-unaware, and the docstring asserts the opposite · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:104-108`.** The comment is quoted in full because it is the
finding:

```
// Hash-comment languages. `#` inside a string is masked too; that costs a
// detection we never had, and over-masking here cannot hide a host that the
// hash-language files actually fetch from — those are assignments, not comments.
```

**"cannot hide a host that the hash-language files actually fetch from" is false.** `maskWith(src, /#[^\n]*/g)`
blanks from the first `#` on the line to the newline, with no notion of quoting, so any `#` inside a
string kills every URL to its right on the same line.

**Real-tree mutation, with the control that isolates the cause:**
```
M2  scripts/rt-probe.sh = curl -H "X-Id: #1" https://api.hidden.example/v1
    -> 72 passed (72)              MISSED
M2b scripts/rt-probe.sh = curl https://api.hidden.example/v1
    -> 2 failed | 70 passed        caught
```
The only difference is a `#` inside a quoted header value. Same result unit-tested for
`.py` (`COLOR = "#0f0"; requests.get("https://api.hidden.example/v1")` → `[]`) and for a workflow
`run:` step (`curl -d "text=Build #1" https://hooks.hidden.example/x` → `[]`).

This needs no adversary. `curl -H "X-Request-Id: #..."`, a Slack/webhook payload containing `#channel`,
a colour literal in a plotting script, a `sed 's/#.*//'`, an anchor in a quoted path — any of them
silently blinds the rest of the line in `.sh`, `.py`, `.yml`, `.toml`, `Dockerfile` and `Procfile`.

**A passing test ratifies it.** `it('DOES strip hash comments in Python and YAML — this test used to
assert the opposite')` asserts only `'# see https://…'` (a real comment). It confirms the safe half a
second time and never asks the question that matters. That is the same failure mode the test's own
comment says it was written to remove.

---

## Q107-R3 — HIGH — JS `//` masking is string-unaware in the same way · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:110`.** `(^|[^:])\/\/[^\n]*` treats a `//` inside a string
literal as a comment.

```
M3  lib/rtProbe.ts = const parts = String(x).split('//'); export const U = 'https://api.hidden.example/v1'
    -> 72 passed (72)              MISSED
```
Also unit-confirmed: `` const a = `${p}//cdn.x.example`; const u = "https://api.hidden.example/v1" `` → `[]`
(the `}` before `//` is `[^:]`, so the whole line is blanked). A URL-normalising helper — `split('//')`,
`indexOf('//')`, `replace('//','/')` — sitting on the same line as a fetch is enough. Escaped regex
literals (`/a\/\/b/`) are safe; unescaped string forms are not.

---

## Q107-R4 — HIGH — the pinned-vendor list is kind-blind; one decoy row re-opens the exact escape it was built to close · CONFIRMED

**`__tests__/architecture/vendor-licence-register.test.ts`, `NAMED_MARKET_DATA_VENDORS` block:**

```ts
const row = entries.find((e) => e.id === id)      // <- no kind
```

The comment above that list says the previous version let red-team flip `end_user_exposed` to false on
`BLOOMBERG_BRIDGE_URL` — the CRITICAL row — and stay green, and that pinning the ids fixed it. It fixed
that literal mutation only. `find` matches on `id` alone, `duplicate-row` only fires on the same
`(kind, id)` pair, and the classification assertion builds a `Set` of ids that a decoy also satisfies.

**Real-tree mutation on the CRITICAL row itself:**
```
M8a control: env-host|BLOOMBERG_BRIDGE_URL -> end_user_exposed:false, redistribution_position deleted
             -> 1 failed | 71 passed
                FAIL "accounts for every named market-data vendor"      the fix works
M8b same, PLUS one extra row inserted first:
             {kind:'http-host', id:'BLOOMBERG_BRIDGE_URL', lifecycle:'withdrawn',
              classification:'market-data-vendor', withdrawn_on:'2026-08-29',
              withdrawn_reason:'literal removed', end_user_exposed:false}
             -> 72 passed (72)                                          DEFEATED
```
A withdrawn row is not required to be detected, so `stale-active` and `withdrawn-but-live` stay silent;
`find` returns the decoy; `end_user_exposed:false` on the real row silences rule 7. The CRITICAL live
Bloomberg path is now recorded as not user-exposed, with no redistribution position, and the suite is green.
Reproduced independently on `http-host|ws.kraken.com` with a `pip-package` decoy.

**Fix:** look the row up by `(kind, id)`, and make `duplicate-row` fire on `id` collisions across kinds
(or forbid an id appearing under two kinds without an explicit cross-reference).

---

## Q107-R5 — HIGH — `dynamic_sites` counts LINES, not sites; a new dynamic host on an existing line is free · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:481` with the dedupe at `:268`.** `push` keys on
`kind|id|where` and `where` is `path:line`, so N unresolvable host expressions on one line collapse to
**one** point. The check is then `actual > e.dynamic_sites`.

```
M4a control: lib/appUrl.ts (recorded dynamic_sites: 1) + a new line
             export function alt(h){ return fetch(`https://${h}.polygon.io/v2`) }
             -> 1 failed | 71 passed    (dynamic-sites-increased)
M4b same expression APPENDED TO LINE 6, which already carries `https://${vercel…}`
             -> 72 passed (72)          MISSED
```

This defeats the field's stated purpose verbatim. The docstring at `:385-394` says counting sites
"survives a reformat while still refusing a new one" — it refuses a new one **only if the author puts it
on its own line**. Two further consequences of the same asymmetry:

- `actual > recorded` permits *fewer*: remove one dynamic site and add another in the same commit → equal → green.
- A formatter that joins two dynamic lines lowers the true count while the recorded number stays,
  permanently widening the laundering headroom with no diff to the register.

**Fix:** count matches, not lines — include a match ordinal in `where`, or count occurrences per file
before deduping — and assert equality (`actual !== recorded`), not `>`.

---

## Q107-R6 — HIGH — evasion plus `withdrawn` converts an incomplete register into a false one · CONFIRMED

Composite, and worse than any single escape. `stale-active` means an evasion against an *existing*
vendor normally turns the suite red. But `withdrawn-but-live` can only fire when the point is still
**detected** — which, after a successful evasion, it is not.

```ts
// executed against the shipped checkRegister:
row  = { kind:'http-host', id:'api.coingecko.com', lifecycle:'withdrawn',
         withdrawn_on:'2026-08-29', withdrawn_reason:'moved to first-party proxy', … }
code = detectEgress([{ path:'hooks/useX.ts',
         source: 'fetch("//api.coingecko.com/api/v3/coins")' }])
detected  -> []
violations -> []          // fully green
```
The code still fetches CoinGecko from the browser; the audit trail now positively asserts the surface
was removed, with a date and a reason. **A register that is wrong is worse than one that is incomplete**,
because the next reviewer stops looking. The `APPEND_ONLY` / lifecycle design is right; the missing
control is that withdrawal is unverifiable by construction.

**Verdict, stated rather than left open.** `withdrawn` is not evidence of withdrawal — it is a claim
whose only check is the absence of a detection, and every finding above is a way to produce that absence.
While that holds, **the register cannot be relied on as an audit trail for anything marked withdrawn**,
and this specific finding should gate any future restatement that I8's process half is PARTIAL: PARTIAL
requires a mechanism on some paths, and on the withdrawal path the mechanism is a tautology. It does not
touch the 90 `active` rows, which are checked against live detection and remain sound. There are zero
withdrawn rows today, so the exposure is prospective, not present — which is exactly when the control is
cheap to add. **Fix:** require withdrawal to cite the commit or PR that removed the surface, and add a
guard that a row may only move to `withdrawn` in a diff that also deletes source.

---

## Q107-R7 — MEDIUM — `public/` is walked and visits **zero files**; the claimed fix has no reachable instance · CONFIRMED

**`vendor-licence-register.test.ts`, the `GENERATED` comment.** It says, in direct response to a red-team
objection: *"`public/` USED to be in the set above, and red-team was right that it should not be … It is
visited now."*

Replaying the shipped `walk`/`IGNORED`/`GENERATED`/`EXECUTABLE`:
```
TOTAL FILES VISITED: 298
FILES VISITED UNDER public/: []
```
Tracked `public/` contents are `launcher.html`, `manifest.json`, `quantan-logo.svg`, two `.png`. None
matches `EXECUTABLE`. `sw.js` and `workbox-978ab1c7.js` exist on disk, are correctly untracked
(the `GENERATED` justification checks out), and are excluded. **Net effect of admitting `public/`: nothing.**

`public/launcher.html` is served verbatim to end users; a `<script src="https://vendor/x.js">` or a
`@import url(https://…)` in `app/globals.css` is invisible. Neither has a host today — latent, not live.

This is the **fifth** instance of the defect class this very file lectures about four separate times:
*when a guard is green, ask what it VISITED before you ask what it decided.* The directory was admitted;
the extension list was not widened to match; nobody asserted the visit was non-empty.

**The transferable finding is not `.html`.** The walk has **no non-emptiness assertion for any
territory it deliberately admitted**. `public/` is merely the one that can be proved empty today; the
same silence covers `.github` (admitted by name), `Dockerfile`/`Procfile`/`.toml`/`.sh` (admitted with
the explicit note "no instances today"), and every future widening. The reachability block asserts that
six *named files* are visited — it never asserts that an admitted *directory or extension class* is
non-empty, which is the exact distinction between "the rule was reachable" and "the rule had zero
instances". Fixing this as "add two extensions" reproduces the defect at the next widening.

**Fix:** one assertion per admitted territory —
`expect(files.filter(f => f.path.startsWith('public/')).length).toBeGreaterThan(0)`, and the same for
each extension the `EXECUTABLE` list claims to cover — then make each true, or delete the claim.

---

## Q107-R8 — MEDIUM — `overrides` registers the key, not the `npm:` target · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:326-332.`** The docstring says `overrides` was enumerated
precisely because it "can point an innocuous name at a vendor client via the `npm:other@1` form". The
loop pushes `Object.keys(manifest[block])` — the **name being overridden**, never the target.

```
M6 package.json: "overrides": { "yahoo-finance2": "npm:alpha-vantage-client@1" }
   -> 72 passed (72)     MISSED
```
`yahoo-finance2` is already registered, so the key satisfies the gate while the package actually installed
is a different vendor. The register now describes a vendor the build does not use and omits the one it does.

```
M7 package.json: "overrides": { "react": { "alpha-vantage-client": "npm:alpha-vantage-client@1" } }
   -> 72 passed (72)     MISSED — Object.keys sees only "react"
```
npm's nested-override form is the documented way to scope an override, so this is not exotic.

**Fix:** for `overrides`, parse the value — recurse into objects, and when a string starts with `npm:`,
register the **target** package as well as the key.

---

## Q107-R9 — MEDIUM — the broadest republication forms are exempt from `published-data`; and a commented-out `git add` fabricates a row · CONFIRMED

**`__tests__/architecture/vendorEgress.ts:246-254.`**

```ts
if (m && m[1] !== '.' && m[1] !== '-A') out.push(...)
```

| workflow body | detected |
|---|---|
| `git add data/vendorDump/` + `git push` | `published-data\|data/vendorDump/` ✅ |
| `git add -A` + `git push` | `[]` |
| `git add .` + `git push` | `[]` |
| `git commit -am "data"` + `git push` | `[]` |
| `git add data/dump/` + `gh api --method PUT …` | `[]` |
| `# git add data/phantom/` + `git push` | `published-data\|data/phantom/` ← **phantom, from a comment** |

The two forms that publish *the most* — `git add -A`, `git add .` — are the two written into the code as
exemptions, so a bot workflow that stages everything reaches the strongest conclusion the guard can draw
and produces nothing. `git commit -am` and non-`git push` publication (`gh api`,
`peter-evans/create-pull-request`, `actions/upload-artifact`, a release asset) are also outside the match.

The phantom is the mirror image: `publishedPaths` is called with `file.source` (`:317`), the **raw**
source, while everything else on the same file goes through `stripComments`. A commented-out `git add`
in a pushing workflow invents a redistribution row.

The register's `WHAT_THE_GUARD_DOES_NOT_CHECK` says the gap is "not a human committing data by hand".
That understates it: the workflow case it claims to cover is only covered for explicitly-named paths.

*Nuance, stated so it is not overclaimed:* changing the existing `refresh-data.yml` line to `git add -A`
would strand the `scripts/backtestData/` row and trip `stale-active`. The escape is for a **new** path,
or a new workflow, not for erasing the existing row.

---

## Q107-R10 — MEDIUM — `GENERATED` is a name allowlist applied tree-wide · CONFIRMED (unit)

**`vendor-licence-register.test.ts`, `GENERATED = /^(sw\.js|workbox-[a-f0-9]+\.js)(\.map)?$/`,** tested
against `entry` (the basename) at every level of the walk. `lib/data/sw.js`, `scripts/sw.js`,
`app/api/workbox-deadbeef.js` are all skipped anywhere in the tree. The comment claims the exclusion is
"by what it IS, not by name" — it is by name, and it is exactly the allowlist-of-names defect Q-098
established twice and this file cites as precedent.

**Fix:** anchor it to the directory that generates it (`public/sw.js`) or, better, to the property the
comment claims — untracked-by-git.

---

## Q107-R11 — MEDIUM — `stripComments` language dispatch matches the full path, not the basename · CONFIRMED (unit)

**`__tests__/architecture/vendorEgress.ts:107`:**
`/^(Dockerfile|Procfile|requirements)/.test(path)` — `path` is the repo-relative path.

| path | comment rules applied | `# https://api.hidden.example/v1` |
|---|---|---|
| `Dockerfile` | hash ✅ | `[]` |
| `docker/Dockerfile` | **JS** ❌ | `http-host\|api.hidden.example` (phantom) |
| `requirements.txt` | hash ✅ | `[]` |
| `ml/requirements.txt` | **JS** ❌ | `http-host\|api.hidden.example` (phantom) |

`ml/requirements.txt` is a real tracked file. It has no `#`-commented URL today, so no phantom row exists
— latent. Direction is noise rather than blindness, which is the safer of the two, but the fix is one
`.split('/').pop()`.

---

## Q107-R12 — MEDIUM — scheme allowlist misses every non-HTTP egress protocol · CONFIRMED (unit)

**`:291`** matches `https?` and `wss?` only. All of these return `[]`:

```
postgresql://user:pw@db.vendor.example:5432/x
rediss://default:tok@eu1-x.upstash.io:6379
mongodb+srv://a:b@cluster0.mongodb.net/db
amqps:// …   grpcs:// …   ftp:// …   s3:// …   clickhouse:// …
```

No live instance in tracked source today (only `__tests__/security/urlValidation.test.ts:57`, and
`__tests__` is not walked). But `.env.example:46` shows the shape the project is heading for —
`KV_REST_API_URL=https://YOUR-DB.upstash.io` is HTTPS today; a direct `rediss://` connection string
would be invisible. Recorded as latent because the register already carries an Upstash row via the env
var, so the gap is one refactor away from mattering.

---

## Q107-R13 — MEDIUM — a YAML `env:` block supplies a host and `envHostNames` cannot see it · CONFIRMED (unit)

**`:186`.** The shell arm is `^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*=` — it requires `=`. YAML uses
`NAME: value`:

```yaml
      VENDOR_BASE_URL: ${{ secrets.V }}     ->  []
```

`.github/workflows/` and any `env:` block in a compose/serverless YAML can retarget the app at a vendor
with no `=`, no `process.env` and no literal. Widening the walk to `.sh` was the right instinct; the
matcher was widened for shell syntax and not for YAML. **No unregistered live instance found** — a grep
of `.github/` for host-bearing `NAME:` keys returned nothing, and all 14 `env-host` register ids resolve
to real `file:line` citations (spot-checked `KV_REST_API_URL` → `lib/api/rateLimit.ts:83`,
`lib/shadowLog.ts:85`: both correct).

---

## Named gaps — LOW, listed rather than argued

| id | gap | evidence | status |
|---|---|---|---|
| **Q107-R14** | `.env.example` is tracked, **not walked**, and carries live vendor host defaults: `:6 ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"`, `:46 KV_REST_API_URL=https://YOUR-DB.upstash.io`, `:29-30` Railway hosts. Covered today only because the same names appear in source. | `EXECUTABLE.test('.env.example') === false` | CONFIRMED, latent |
| **Q107-R15** | Only the **root** `package.json` is read (`join(ROOT,'package.json')`), and `.json` is not walked. `DEP_BLOCKS` misses yarn `resolutions` (`-> []`), `pnpm.overrides` (`-> []`) and any workspace manifest. One tracked manifest and no yarn/pnpm lock today, so latent — but this is the "one manifest is not every manifest" defect that round 2 fixed for `requirements.txt` and not for `package.json`. | probe `[3a]`,`[3b]`; `git ls-files '*package.json'` → 1 | CONFIRMED, latent |
| **Q107-R16** | `bundledDependencies` is an **array**; `Object.keys` yields indices, so it registers a package named `0`. | probe `[3c]` → `npm-package\|0` | CONFIRMED, latent |
| **Q107-R17** | Extension gaps beyond `public/`: `.html`, `.css` (`@import url(https://…)` is a browser fetch), `.ps1`+`.cmd` (`scripts/sync-to-local-build.*`), `.mts`/`.cts`, `.ipynb`, `.npmrc` (`registry=`), `vercel.json` (`rewrites`/`headers` can proxy a vendor). Also `requirements/base.txt` — a very common layout — matches neither `EXECUTABLE` nor the pip path test. | `walkprobe` output | CONFIRMED, latent |
| **Q107-R18** | `NAMED_MARKET_DATA_VENDORS` is still a **static list of 13** against a 90-row register. The comment says the count-based version "protects only history" and that pinning fixed it; pinning a longer static list has the same property — every row added after 2026-08-27 is unpinned and freely softenable. | read | CONFIRMED (design) |
| **Q107-R19** | *(folded into Q107-R1 — same root cause; id retired rather than reused, so the count is not padded)* | — | — |

---

## Claims that were tested and **hold** — recorded, because an all-clear needs evidence too

- `hostnameOf` authority-before-userinfo: `?family=Inter:wght@300;400` does not register `300`; `fonts.example.com` is registered. ✅
- Port stripping: `https://data.vendor.example:8443/v1` → `data.vendor.example`, not a dynamic host. ✅
- `file:line` honesty after masking: a 4-line block comment followed by a URL reports `lib/x.ts:5`. ✅
- YAML glob no longer forms a block comment; a host at line 4 after two globs is caught. ✅
- `wss://` detection. ✅
- Loopback exclusion with and without ports; `.localhost` suffix. ✅
- pip: `#` comments and `-r` includes are not packages; `ml/requirements.txt` **is** visited and parsed. ✅
- `GENERATED`'s stated justification: `public/sw.js` and `public/workbox-978ab1c7.js` are genuinely untracked. ✅
- Register citation integrity, spot-checked: `KV_REST_API_URL` evidence `lib/api/rateLimit.ts:83` and
  `lib/shadowLog.ts:85` both land on the exact line. The round-3 `file:line` repair holds. ✅
- `WHAT_THE_GUARD_DOES_NOT_CHECK` items (2) transitive deps, (4) unnamed env var: both true as stated. ✅
- No live host is currently hidden by the masker: a tree-wide masked-vs-raw diff surfaced 9 hosts, all
  of them in genuine comments (`docs.kraken.com`, `nextjs.org`, `spotgamma.com`, `www.nyse.com`, …). ✅

---

## What would have shown failure

Each finding above is a command, not an opinion:

```bash
# R1  plant a protocol-relative URL in a .tsx and a plain https URL in another .tsx.
#     If only the second goes red, the branch is dead.
# R2  the same curl with and without a `#` inside a quoted argument in a .sh.
# R4  soften a pinned row alone (red) vs soften it with a decoy row of another kind (green).
# R5  the same new dynamic expression on its own line (red) vs appended to an existing one (green).
# R7  expect(files.filter(f => f.path.startsWith('public/')).length).toBeGreaterThan(0)
```

The suite has **no** paired-control test of this shape. Every positive control it does have plants an
input the detector was written for; none plants two inputs differing in one character and asserts that
both are caught. That is why round 3's fixes each closed an instance rather than a property.

---

## Housekeeping

- Mutations touched `lib/appUrl.ts`, `package.json`, `reviews/vendor-licence-register.json` (backed up to
  `/private/tmp/rt-appUrl.ts.bak`, `/private/tmp/rt-package.json.bak`, `/private/tmp/rt-register.json.bak`
  and restored by `cp`; **`git checkout` was not used**) plus four scratch files that were deleted.
- Post-run md5 of all three matches the pre-run value: `e13a49df…`, `e075e228…`, `bd279614…`.
- `git diff --stat lib/appUrl.ts package.json reviews/vendor-licence-register.json` is **empty** — the
  three files this review mutated are pristine, and the suite is back to its 72/72 baseline.
- `git status --porcelain` at hand-off also shows ` M scripts/fetchBacktestData.mjs` and
  ` M scripts/lib/dataVintage.mjs`. **Those are not mine** — they are another agent's in-flight Q-102
  data-vintage work (the diff adds a consolidated-tape volume-finalization constant), and per the
  standing rule they were left untouched. Nothing in this review ever wrote under `scripts/` except a
  scratch `scripts/rt-probe.sh`, created and deleted twice. The remaining `??` entries are this wave's
  five review outputs.
- Nothing was written to `reviews/findings-ledger.csv`.
