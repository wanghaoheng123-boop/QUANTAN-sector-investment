# D1-6 — ESLint / exhaustive-deps audit (2026-06-02)

## Status

ESLint is **not** installed as a project devDependency. TypeScript strict checking via `npm run typecheck` is the primary lint gate.

## `react-hooks/exhaustive-deps` suppressions (4 sites)

| File | Line | Rationale |
|------|------|-----------|
| `hooks/useLiveQuotes.ts` | 229 | Stable SSE subscription; intentional empty deps |
| `components/backtest/WalkForwardPanel.tsx` | 39 | One-shot mount fetch |
| `app/page.tsx` | 175 | Sector load on mount only |
| `components/KLineChart.tsx` | 637 | Chart library effect boundary — deps would thrash rebuild |

## Recommendation

1. Add `eslint` + `eslint-config-next` when Next.js upgrade (Q-057) lands.
2. Do **not** remove suppressions without reproducing chart/SSE behavior in tests.
3. No new suppressions without reviewer ack (invariants §4 floor).

**Verdict:** Audited — acceptable for Phase 15; install ESLint in Phase 16 S2.
