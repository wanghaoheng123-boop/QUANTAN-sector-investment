# Design invariant audit I1–I8 — 2026-08-17 (`Q-079`)

The enforcement tiers in `CLAUDE.md` were **inferred from repo state on
2026-08-15 and never audited**. Two had already failed on contact before this
sprint began (I5 asserted DSR was not computed — it is; I3 was tiered PARTIAL and
Q-088 found synthetic data on a live chart route). This audit tested the
remaining prior.

**Result: 3 tiers corrected, 5 confirmed, and no invariant is ENFORCED.**
I7 was the only one claiming enforcement, and it is the one that inverted.

This document is the index. The per-invariant evidence — including what was
checked, what would have shown failure, and declared blind spots — lives in the
sibling files. **The tier itself is stated only in `CLAUDE.md`**, to avoid
forking the SSOT; this directory is frozen evidence, not a second register.

| | Invariant | Was | Now | Verdict |
|---|---|---|---|---|
| I1 | Provenance or it doesn't ship | PARTIAL | **PARTIAL** | confirmed |
| I2 | Fail closed, never fail silent | PARTIAL | **PARTIAL** | confirmed |
| I3 | No synthetic data crosses the boundary | PARTIAL | **PARTIAL** | confirmed, different grounds |
| I4 | Point-in-time or it's a lie | ASPIRATIONAL | **ASPIRATIONAL** | confirmed |
| I5 | Every claim of skill must survive the adversary | PARTIAL | **VIOLATED** | **corrected** |
| I6 | Securities identified by permanent ID | ASPIRATIONAL | **ASPIRATIONAL** | confirmed |
| I7 | Main is always deployable | **ENFORCED** | **VIOLATED** | **corrected** |
| I8 | Vendor terms are law | UNVERIFIED | **VIOLATED** (process) / **UNVERIFIED** (licence) | **corrected** |

## Evidence files

| File | Invariants | Auditor |
|---|---|---|
| `I1-I2-I4-I6-evidence.md` | I1, I2, I4, I6 | `data-integrity` |
| `I3-evidence.md` | I3 | `test-engineer` |
| `I5-evidence.md` | I5 | `quant-validator` |
| `I7-evidence.md` | I7 | `sre-devops` |
| `I8-evidence.md` | I8 | `security-compliance` |

## The three corrections

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
published DSR is **1.0000 and provably insensitive to `nTrials` from 10 to
10¹²**, because it is computed over 3,410 overlapping trades rather than the
repo's own ~347 effective sample — which means `Q-081` as scoped would change the
headline from 1 to 1.

**I8 · UNVERIFIED → VIOLATED (process) / UNVERIFIED (licence).** The invariant
has two halves at different tiers. The substantive licence question is genuinely
UNVERIFIED and closable only by the owner with counsel. But I8's operative
sentence is "confirm the licence permits it **and record the finding**" — a
procedural gate that does not exist anywhere, whose trigger condition is live now
across 11 vendors, six of them end-user-exposed with no auth. Rating the whole
invariant UNVERIFIED would have understated a live process failure.

## Cross-check that changed a finding

The I4 audit reported zero embargo on "the production walk-forward path". The I5
audit was sent that claim mid-run and **refuted the liveness half**:
`walkForwardAnalysis` has 16 call sites and all 16 are in `__tests__/`. The
embargo-0 defect at `lib/backtest/walkForward.ts:157-159` is real but **latent**;
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
