# Q-057-NEW — Next.js Upgrade Decision (2026-06-02)

**Recommendation:** Target **Next.js 15.x latest patch** with React 19.

| Option | Pros | Cons |
|--------|------|------|
| 14.x patch | Smallest diff | May not close all 23 CVEs |
| **15.x (recommended)** | Closes most advisories; supported LTS path | React 19 peer; retest middleware/CSP/CSRF |
| 16.x | Maximum CVE closure | Two semver majors; highest migration cost |

**Pre-merge gates:** Q-058 snapshots, `__tests__/api/csrf.test.ts`, dual `npm run benchmark` hash match.

**Implementation branch:** `fix/q-057-nextjs-15` (after Tier 1 PR queue lands).

---

## Outcome (2026-06-03) — `fix/remaining-tasks-2026-06-03`

**Status:** DONE

| Package | Before | After |
|---------|--------|-------|
| next | 14.2.15 | 15.5.19 |
| react / react-dom | 18.x | 19.2.7 |

**Migration work:** Async `params` on 13 API routes + 3 dynamic pages; `serverExternalPackages` replaces deprecated `experimental.serverComponentsExternalPackages`.

**Verify:** typecheck PASS · 1017 tests PASS · `npm run build` PASS · benchmark dual-run identical (no signal drift).
