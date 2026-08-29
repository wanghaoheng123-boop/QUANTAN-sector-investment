# Q-107 rectification wave — 2026-08-29

Five agents inspected in parallel on **disjoint file territories**, each writing to
its own file in this directory. **None of them may write to
`reviews/findings-ledger.csv`.**

That constraint is the whole point. On 2026-08-27 two reviewers appended findings
to the ledger concurrently under the same `Q100-3…12` ids; the lead's
de-duplication kept the first occurrence per id and **silently destroyed ten
compliance findings**, because it assumed a duplicate id meant duplicate content.
It was the second concurrent-append corruption of that file. Reserving id ranges
would have helped; removing the shared write entirely is better, so that is what
this wave does. The lead merges these reports into the ledger sequentially.

| Agent | Territory | Ids | Report |
|---|---|---|---|
| security-compliance | bloomberg / fundamentals / prices / trading-agents routes, ComplianceBanner, middleware | `Q107-S*` | `security-compliance.md` |
| data-integrity | scripts/, workflows, lib/backtest, lib/data | `Q107-D*` | `data-integrity.md` |
| sre-devops | workflows, package.json, VERCEL_OPERATIONS | `Q107-O*` | `sre-devops.md` |
| frontend-engineer | components/, hooks/, app pages | `Q107-F*` | `frontend.md` |
| red-team | re-attacks the merged I8 guard | `Q107-R*` | `red-team.md` |

Reports are INPUT, not the record. Findings that survive the lead's verification
are written to `reviews/findings-ledger.csv` (unfixed dangers) or
`workspace/IMPROVEMENT_BACKLOG.json` (queued work) — the canonical homes per the
SSOT table in `CLAUDE.md`. This directory is the raw material and may be pruned.
