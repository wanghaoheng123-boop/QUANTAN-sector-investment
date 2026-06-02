# Q-057-NEW — Next.js Upgrade Decision (2026-06-02)

**Recommendation:** Target **Next.js 15.x latest patch** with React 19.

| Option | Pros | Cons |
|--------|------|------|
| 14.x patch | Smallest diff | May not close all 23 CVEs |
| **15.x (recommended)** | Closes most advisories; supported LTS path | React 19 peer; retest middleware/CSP/CSRF |
| 16.x | Maximum CVE closure | Two semver majors; highest migration cost |

**Pre-merge gates:** Q-058 snapshots, `__tests__/api/csrf.test.ts`, dual `npm run benchmark` hash match.

**Implementation branch:** `fix/q-057-nextjs-15` (after Tier 1 PR queue lands).
