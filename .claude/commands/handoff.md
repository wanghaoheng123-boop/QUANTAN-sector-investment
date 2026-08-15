---
description: Close the session cleanly — write state, backlog, risks, then commit and push
---

Use the **coordinator** agent. A clean handoff is worth more than 20% more code.

Trigger this at 70% context regardless of progress, or whenever the session is
ending.

## 1. STATE

Append a **new wave key** to `workspace/SESSION_STATE.json` — never overwrite an
existing wave key, they are the audit trail. Include: what was attempted, what
landed (with commit SHAs / PR numbers), what broke, and what is still open.

## 2. NARRATIVE

Append to `workspace/MEMORY_LOG.md`: enough detail that a cold session can
resume without re-deriving anything. Exact paths touched. Open threads. The
single next action.

## 3. BACKLOG

Append anything discovered-but-not-done to `workspace/IMPROVEMENT_BACKLOG.json`
as a new `Q-###`, following `workspace/BACKLOG_SCHEMA.json`.
Required: `id`, `title`, `domain`, `priority`, `status`.
Recommended: `acceptance_criteria`, `verify_commands`, `files`.

## 4. RISKS

Anything found but not being fixed becomes a row in
`reviews/findings-ledger.csv` with severity, `file:line`, and a rationale for
why it is being left.

## 5. RESEARCH TRIALS

If any backtest, sweep, or experiment ran this session — **including the ones
that failed or were abandoned** — append a row to
`.quantlab/TRIAL_REGISTRY.jsonl`. Unlogged trials are what make a Deflated
Sharpe dishonest.

## 6. COMMIT

Commit and push. Confirm the deploy. Never end with uncommitted work or a red
build. Never leave the repo mid-refactor.

## HONESTY CHECKLIST — answer these in the handoff, explicitly

- Did I verify the *effect*, or only that the code is tagged correctly?
- Was any check I am calling "green" actually advisory?
- What did I claim was fine without testing it?
- What would a cold session most likely get wrong from what I've written?

Do not use the SSOT files to record aspiration. Record what is true.
