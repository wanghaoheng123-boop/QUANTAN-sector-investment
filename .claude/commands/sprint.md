---
description: Run one budgeted improvement sprint on QUANTAN
---

Use the **coordinator** agent to run one sprint. Follow this protocol exactly.

## 1. ORIENT (target: <10% of context)

Read `workspace/SESSION_STATE.json` (newest wave key), the tail of
`workspace/MEMORY_LOG.md`, and `workspace/IMPROVEMENT_BACKLOG.json`.

Run: `git log --oneline -15 && git status`

Do NOT explore the codebase. Those files are the map. If the map is wrong,
repairing it is this sprint — say so and scope that instead.

## 2. PLAN (stop and show me before proceeding)

Select ONE work package per the coordinator's priority rules. Output, and wait
for my approval:

- Work package ID (`Q-###`) + title
- Why this one now — which priority rule selected it
- Explicit **OUT of scope** list
- Which specialist agents you will delegate to, and for what
- Acceptance criteria (testable, not vibes)
- Files you expect to touch
- Estimated context budget

## 3. EXECUTE

- Delegate discovery to `Explore`. Delegate domain work to the specialists.
- **Write the test first** for anything quantitative (`test-engineer`).
- Small commits, conventional messages. Branch: `feat|fix|chore/<id>-<slug>`.
- If you discover a P0 outside scope: log it to the backlog as P0, tell me
  immediately, but do NOT pivot without my say-so.

## 4. ADVERSARIAL REVIEW (never skip)

Before declaring done, delegate to **red-team** AND the relevant domain
validator:

| If the change touches… | also delegate to |
|---|---|
| strategy, factor, signal, backtest | `quant-validator` |
| ingestion, feeds, historical data | `data-integrity` |
| auth, secrets, env, vendor data exposure | `security-compliance` |
| fills, costs, capacity | `execution-realism` |
| sizing, covariance, risk metrics | `risk-portfolio` |
| news, sentiment, scraped or LLM-processed text | `disinformation-analyst` |
| UI, charts, a11y | `frontend-engineer` |
| CI, deploys, env plumbing | `sre-devops` |

Give them the diff and this instruction: *"Find the reason this is wrong.
Assume it is broken. What input breaks it? What did the author not consider?"*

Resolve every objection or log it in `reviews/findings-ledger.csv` with a
rationale. Silence is not resolution.

## 5. VERIFY

```bash
npm run typecheck && npm run test && npm run check:ci
npm run benchmark    # ONLY if signals/backtest changed; floor in reviews/invariants-baseline.md
```

Push the branch. Confirm the Vercel preview builds, then smoke-test the
affected surface and check runtime logs for new errors.

**Do not report an advisory check as a pass.** Stryker does not run on PRs; the
a11y workflow is schedule-only and `continue-on-error`; route config errors
appear only in the Vercel build. Read the job log, not the check mark.

## 6. HANDOFF (trigger at 70% context regardless of progress)

Run `/handoff`.

Merge to `main` only if green — remember that **merging IS the production
deploy**. Watch runtime errors for 10 minutes after. Roll back first if
anything appears.

Report to me in <200 words: what landed, what didn't, single next action.
