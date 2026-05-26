# QUANTAN — Agent boot (single entry)

Read this file first, then [`AGENT.md`](../AGENT.md) hook rules.

## Canonical tree

| Item | Value |
|------|--------|
| **Path** | `.claude/worktrees/competent-wu-a84629` |
| **Branch** | `main` (or feature branch from `origin/main`) |
| **Do not use** | Google Drive repo root when it shows mass `D` deletions — see [`ROOT_WORKTREE_WARNING.md`](ROOT_WORKTREE_WARNING.md) |

```bash
cd ".claude/worktrees/competent-wu-a84629"
git fetch origin main && git checkout main && git pull origin main
```

## Boot sequence

1. [`SESSION_STATE.json`](SESSION_STATE.json)
2. [`MEMORY_LOG.md`](MEMORY_LOG.md)
3. [`HANDOFF.md`](HANDOFF.md)
4. [`DEVELOPMENT_PLAN_2026-05-26.md`](DEVELOPMENT_PLAN_2026-05-26.md)
5. [`CONTINUOUS_IMPROVEMENT_LOOP.md`](CONTINUOUS_IMPROVEMENT_LOOP.md)

## Verify gate (before marking done)

```bash
npm run typecheck
npm run test
# After signal/backtest changes:
npm run benchmark   # WR >= 55%
```

## Expert roster (Cursor subagents)

| Role | Subagent | Scope |
|------|----------|--------|
| TPM | Parent coordinator | Backlog, HANDOFF, PR sequencing |
| Implementer | `generalPurpose` | Features, decomp, scripts |
| Verifier | `verifier` | VERIFY A–F post-PR |
| CI | `ci-investigator` | Failing GitHub checks |
| Deploy | `deployment-expert` | Vercel, env names, smoke |
| Perf | `performance-optimizer` | Bundle / Core Web Vitals |

## Production (Vercel)

- URL: https://quantan.vercel.app
- Env project: **`quantan`** (not sibling projects only)
- P0 owner: `QUANTAN_FRED_PREWARM=1` on Production — see [`VERCEL_OPERATIONS.md`](VERCEL_OPERATIONS.md)

## Inspection artifacts

- [`reviews/INSPECTION-RULES.md`](../reviews/INSPECTION-RULES.md)
- [`reviews/INSPECTION-WAVE-1-2026-05-26.md`](../reviews/INSPECTION-WAVE-1-2026-05-26.md)
- [`reviews/OSS-BENCHMARK-2026-05-26.md`](../reviews/OSS-BENCHMARK-2026-05-26.md)
