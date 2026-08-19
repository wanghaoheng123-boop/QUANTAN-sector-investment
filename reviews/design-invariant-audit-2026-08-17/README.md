# Design invariant audit I1–I8 — 2026-08-17 (`Q-079`)

The enforcement tiers in `CLAUDE.md` were **inferred from repo state on
2026-08-15 and never audited**. Two had already failed on contact before this
sprint began (I5 asserted DSR was not computed — it is; I3 was tiered PARTIAL and
Q-088 found synthetic data on a live chart route). This audit tested the
remaining prior.

**Result: 6 tiers corrected, 2 confirmed, and no invariant is ENFORCED.**
I7 was the only one claiming enforcement, and it is the one that inverted.

**Revision note.** This index reflects the state *after* adversarial review. Two
rounds of self-correction are recorded below rather than silently folded in — see
"A second cross-check, on the audit itself". The five per-invariant evidence files
are the **frozen record of what each specialist found** and are deliberately not
rewritten; where review superseded them they carry an ERRATUM header, and
`CLAUDE.md` is authoritative on every tier.

This document is the index. The per-invariant evidence — including what was
checked, what would have shown failure, and declared blind spots — lives in the
sibling files. **The tier itself is stated only in `CLAUDE.md`**, to avoid
forking the SSOT; this directory is frozen evidence, not a second register.

| | Invariant | Was | Now | Verdict |
|---|---|---|---|---|
| I1 | Provenance or it doesn't ship | PARTIAL | **ASPIRATIONAL** | **corrected** |
| I2 | Fail closed, never fail silent | PARTIAL | **VIOLATED** | **corrected** |
| I3 | No synthetic data crosses the boundary | PARTIAL | **VIOLATED** | **corrected** |
| I4 | Point-in-time or it's a lie | ASPIRATIONAL | **ASPIRATIONAL** | confirmed |
| I5 | Every claim of skill must survive the adversary | PARTIAL | **VIOLATED** | **corrected** |
| I6 | Securities identified by permanent ID | ASPIRATIONAL | **ASPIRATIONAL** | confirmed |
| I7 | Main is always deployable | **ENFORCED** | **VIOLATED** | **corrected** |
| I8 | Vendor terms are law | UNVERIFIED | **VIOLATED** | **corrected** |

## Evidence files

| File | Invariants | Auditor |
|---|---|---|
| `I1-I2-I4-I6-evidence.md` | I1, I2, I4, I6 | `data-integrity` |
| `I3-evidence.md` | I3 | `test-engineer` |
| `I5-evidence.md` | I5 | `quant-validator` |
| `I7-evidence.md` | I7 | `sre-devops` |
| `I8-evidence.md` | I8 | `security-compliance` |

## The corrections

**I7 · ENFORCED → VIOLATED.** `main` has no branch protection
(`protected: false`, `required_status_checks.contexts: []`,
`enforcement_level: off`, `rulesets: []`) and the repo is public, so protection
is free — unconfigured, not unavailable. The required-check set being empty means
**every green check mark in this repo's history has been advisory**. Two
historical violations are on record: PR #120 merged 49 seconds after its
`coverage` job failed; `e49b1d1` reached production with a red `test` job via
merge skew. `refresh-data.yml:137` pushes bot commits to `main` weekly with no CI
at all, each auto-deploying to production. Independently re-verified by the lead
against the GitHub API before filing.

**I5 · PARTIAL → VIOLATED.** I5 is a gate with no gate — no enforcing
`file:line` exists. The only executing performance gate
(`scripts/benchmark-signals.ts:325-331` via `ci.yml:73`) exits on the **raw**
edge, the exact number I5 forbids as a headline. PBO/CSCV has no implementation,
so no strategy has ever met I5's bar, including the one shipped result. The
published DSR is **saturated at 1.0000** — the committed
`scripts/benchmark-results.json` carries `deflatedSharpeN10 = 1` **and**
`deflatedSharpeN100 = 1`, so a 10× change in the trial count already moves the
headline by nothing.

**The saturation is an artifact of sample size, and the repo names the honest one
itself.** DSR is computed on `tradeStats.nTrades = 3410`, the *overlapping*
count, while the same file's `nonOverlapStats.nTrades = 347` carries the note
*"the honest effective n behind the pooled WR"*. Because `expectedMaxSharpe`
scales as `1/√(T−1)` (`lib/quant/deflatedSharpe.ts:117`), `T` and `nTrials` are
coupled — and at the honest `T` the trial count stops being inert:

| `T` | n=10 | n=45 | n=100 | n=1053 |
|---|---|---|---|---|
| 3410 (as published) | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| **347 (honest effective n)** | 0.9709 | 0.8924 | 0.8282 | **0.5848** |

**At the honest `T` the shipped result falls below any conventional bar at every
trial count the registry supports.** `Q-081` is therefore not merely mis-scoped:
fixing `nTrials` alone changes 1 to 1, but fixing `T` alone leaves multiplicity
uncorrected. **The fix is joint.** The moments are not persisted, so the table
assumes `g3=0, g4=3` — direction and magnitude are robust, the third decimal is
not.

**I8 · UNVERIFIED → VIOLATED.** The invariant has two separable halves at
different tiers and the heading takes the worse one. The substantive licence question is genuinely
UNVERIFIED and closable only by the owner with counsel. But I8's operative
sentence is "confirm the licence permits it **and record the finding**" — a
procedural gate that does not exist anywhere, whose trigger condition is live now
across 11 vendors, six of them end-user-exposed with no auth. Rating the whole
invariant UNVERIFIED would have understated a live process failure.

**I3 · PARTIAL → VIOLATED.** Audited by running seven adversarial mutations
rather than reading the guard. Six escaped. The guard matches the literal string
`mockData` (`__tests__/architecture/synthetic-containment.test.ts:85`), so it is
an opt-in blocklist of known-bad **names**, not the property check its own header
at `:14-17` claims to be. `assertNotSynthetic` has **zero production call
sites**, so I3's "add a runtime assertion" clause has no executing instance.

*Provenance of the "6 of 7" figure:* single-sourced to this audit's mutation run
and **not reproducible from the repo** — the mutations were applied and reverted,
leaving no executable artifact. `Q-098` converts them into tests. The test file's
own `:19-20` ("All five mutations are now caught") refers to Q-088's *different*
five, so the two claims do not conflict. **The tier does not rest on that
figure** — it rests on `assertNotSynthetic` having zero production call sites,
independently re-verified by red-team.

**I1 · PARTIAL → ASPIRATIONAL.** `lib/data/mergeQuotes.ts` declares
`QuoteProvenance` at `:18-28` and constructs it per field at `:105` and `:167`,
and **nothing reads it** — zero consumers across `components/ app/ hooks/`, the
only hits being comments. PARTIAL requires a mechanism on *some* paths.

**I2 · PARTIAL → VIOLATED** *(found by red-team, after the first two commits).*
The staleness half is genuinely PARTIAL (2 of 16 pages). The cache-substitution
half is not: `_cached` has zero consumers, so a cached value *is* served in place
of a live one with no visible flag — the exact thing I2 forbids, and clause 1,
not clause 2. The "heading takes the worse half" rule invented one commit earlier
had not been applied here.

## A second cross-check, on the audit itself

The first draft of this audit rated I1 and I3 PARTIAL — their existing tier — and
gave I8 a compound heading. Reviewed against the **tier definitions this same
commit introduced**, all three were wrong:

- **VIOLATED**'s second clause caught I3: it demands "a runtime assertion, not
  just a comment", and `assertNotSynthetic` has zero production call sites — the
  same clause used to move I5 and I8. I3 at PARTIAL was the same evidence wearing
  a friendlier label. *(That clause read "names a gate that does not exist" at the
  time. Red-team then showed the phrasing was **unfalsifiable** — it catches every
  non-ENFORCED invariant and perversely rated I3 worse than I6 — so `CLAUDE.md`
  now turns it on **reliance**: a control the project relies on with no executing
  instance. I3 still qualifies; I4 and I6 correctly do not.)*
- **PARTIAL** is defined as "a mechanism exists on **some** paths." I1's
  provenance has **zero** consumers. Zero is not some. I2 genuinely is PARTIAL
  (2 of 16 pages); I1 is ASPIRATIONAL.
- The definition table admits no compound value, so I8's heading now takes the
  worse half with the split stated in the body.

Recorded because it is the audit's own version of the failure it was hunting:
"confirmed" requires no edit and produces no visible work, which is exactly where
an auditor gets lazy. The tier table was written in the same commit it failed to
govern.

## Cross-check that changed a finding

The I4 audit reported zero embargo on "the production walk-forward path". The I5
audit was sent that claim mid-run and **refuted the liveness half**:
every *invocation* of `walkForwardAnalysis` is in `__tests__/` (15 across three
suites); `lib/backtest/engine.ts:239-240` re-exports it and nothing in `app/` or
`scripts/` calls it, and `WalkForwardPanel` computes its own quarterly split. The
embargo-0 defect at `lib/backtest/walkForward.ts:158-160` is real but **latent**;
the live OOS research path is `lib/optimize/gridSearch.ts:347`, which applies
embargo 5 and is tested. The I4 write-up's `lib/backtest/gridSearch.ts` citation
points at a file that does not exist — do not propagate it.

Recorded because the failure mode it avoided is the one this project keeps
hitting: a plausible finding, cited, that nobody checked in the other direction.

## Method

Every tier rests on `file:line` evidence, **for the compliant findings as much
as the violations**. Each evidence file states what was checked (paths, globs,
grep patterns actually run), what would have shown failure, and its blind spots.
An invariant that could not be determined from the repo was to be marked
UNVERIFIED rather than guessed — that outcome applies to half of I8.

I3 was audited by **running seven adversarial mutations** rather than reading the
guard, on the Q-088 lesson that a green guard may be inert. Six escaped. That
result is not obtainable by inspection: the guard's own header claims it tests a
property, and only mutation M-D (`'mock' + 'Data'`) falsifies that sentence.

## Findings filed, not fixed

Per sprint scope, nothing found here was repaired. See
`workspace/IMPROVEMENT_BACKLOG.json` (`Q-097` … `Q-102`) and the `Q079-*` rows in
`reviews/findings-ledger.csv`.

`Q-097` (branch protection) is an **owner action** — it is a repository settings
change, not a code change, and no agent should make it.
