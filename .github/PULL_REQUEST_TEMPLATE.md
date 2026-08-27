## What changed, and what was measured

<!-- State what was measured, over what period, with what CI. Not what you hope. -->

---

## I8 — vendor data

**Does this PR cause the application to reach a host, add a dependency, or read a
host-bearing environment variable that it did not before?**

- [ ] No.
- [ ] Yes — and `reviews/vendor-licence-register.json` has a row for it, recording
      the finding: who asked, when, what was found, and where the redistribution
      question stands.

> `__tests__/architecture/vendor-licence-register.test.ts` fails if the answer is
> "yes" and the row is missing, so this checkbox is a prompt, not the gate. It is
> here because the check can only see egress the source spells out — a host built
> by concatenation, or arriving in a variable that is not named like one, is
> invisible to it and visible to you.
>
> **A row is not permission.** Recording that we consume a vendor with no
> agreement is a finding. Whether that is acceptable is `Q-082`/`Q-083` and it
> belongs to counsel.

---

## Invariants

- [ ] This PR does not regress a design invariant (I1–I8 in `CLAUDE.md`).
      *Closing an existing gap is backlog work, not a merge blocker; opening a new
      one is.*
- [ ] If it moves a tier, the failing artifact is exhibited in the PR description.
      *A tier may only be raised by showing the thing that fails. "The guard
      exists" is the claim that has now failed three times in this repo.*

## Claims about skill (I5)

- [ ] This PR makes no user-visible claim of skill, edge, alpha or outperformance.
- [ ] Or: it does, and the deflated number is the headline, quoted with the
      `n_eff` it was computed on.

## Gates run locally

<!-- These are the gate. `main` has no branch protection and an empty
     required-status-check set (Q-097), so every check mark on this PR is
     advisory. `npm run check:ci` does NOT substitute — its smoke step probes the
     live production URL, not your branch. -->

- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run check:ci`
- [ ] `npm run benchmark` (if signals or backtest changed)
- [ ] Vercel preview build is green — the only gate that catches Next.js route config

## Adversarial review

- [ ] `red-team` has reviewed this, and every objection is resolved or logged in
      `reviews/findings-ledger.csv` with a rationale. Silence is not resolution.
