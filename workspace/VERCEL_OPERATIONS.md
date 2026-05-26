# Vercel Operations — QUANTAN

**Last updated:** 2026-05-26  
**Auditor:** deployment-expert (Cursor)  
**Production URL:** https://quantan.vercel.app  
**GitHub repo:** `wanghaoheng123-boop/QUANTAN-sector-investment`  
**Production branch:** `main` (auto-deploy on push per AGENTS.md)

---

## 1. Vercel health summary

| Check | Status | Notes |
|-------|--------|-------|
| Production HTTPS | **OK** | `GET https://quantan.vercel.app/` → 200, `server: Vercel` |
| Security headers | **OK** | HSTS, CSP report-only, X-Frame-Options, etc. from `next.config.js` |
| `/backtest` | **OK** | 200 HTML (pre–PR #18/#19 UI on prod until merge) |
| `/stock/AAPL` | **OK** | 200 HTML |
| `/api/prices?tickers=AAPL` | **OK** | JSON quotes returned |
| GitHub → Vercel integration | **OK** | PR checks show three linked projects (all SUCCESS on recent PRs) |
| GitHub CI on `main` PRs | **OK** | Full gate on remote `main` (typecheck, test, coverage, benchmark, smoke/verify) |
| Stacked PR #19 CI | **GAP** | No GitHub Actions runs (base is `refactor/q-054-backtest-decomp`, not `main`) |
| Vercel MCP | **Not used** | Plugin requires auth; audit used `gh` + HTTP probes only |
| npm security (Q-057) | **BLOCKER** | `next@14.2.15` — 23 advisories; see §6 |

**Linked Vercel projects** (from PR status checks, 2026-05-26):

| Project name | Role (inferred) | Example preview (PR #18) |
|--------------|-----------------|---------------------------|
| `quantan` | Primary production alias (`quantan.vercel.app`) | [deployment](https://vercel.com/wanghaoheng123-7549s-projects/quantan/RhhRJ82tEZx5nGbE1zox7WpKd9nT) |
| `quantan-sector-investment` | Repo-named project (same GitHub repo) | [deployment](https://vercel.com/wanghaoheng123-7549s-projects/quantan-sector-investment/5epZdUmsXaWvqHYJbFb7RyLyXKjc) |
| `quantan-release-work` | Secondary / release worktree project | [deployment](https://vercel.com/wanghaoheng123-7549s-projects/quantan-release-work/5YHnuePhf9cwiSusEAB7rFRS1Ek5) |

**Production tracking `main`:** Remote `main` tip at audit time was `e1cb168` — *chore(data): weekly backtest data refresh (2026-05-24)* (pushed by `.github/workflows/refresh-data.yml`). Open feature work (#17–#21) is **not** on production until merged to `main`.

**Workspace drift warning:** Local `.github/workflows/ci.yml` in the Google Drive workspace is **typecheck-only**. Remote `main` has the full Phase 15 CI (test, coverage, benchmark floor, verify:data). Sync from `main` before editing workflows locally.

---

## 2. Build & deploy configuration

### `vercel.json`

```json
{
  "regions": ["iad1"],
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm ci",
  "framework": "nextjs"
}
```

- **Region:** `iad1` (US East)
- **Install:** `npm ci` (lockfile must be committed)
- **Build:** `next build` (includes PWA via `@ducanh2912/next-pwa`)

### `next.config.js` (deploy-relevant)

- PWA / Workbox: `/api/*` cached as **NetworkOnly** (avoids stale API in SW)
- `serverComponentsExternalPackages: ['yahoo-finance2']`
- OWASP-style security headers on all routes (CSP is **report-only**)
- `images.remotePatterns`: `https://**` (broad; known tech debt)

### Deploy scripts (`package.json`)

| Script | Use on Vercel |
|--------|----------------|
| `build` | Vercel build command |
| `check:smoke` | Post-deploy verification (set `SMOKE_BASE_URL`) |
| `check:ci` | `verify:data` + smoke (CI on `main` uses `verify:data` in smoke job, not live HTTP) |
| `typecheck` / `test` / `benchmark` | GitHub CI only (not Vercel build) |

---

## 3. Preview vs production

| Aspect | Preview | Production |
|--------|---------|------------|
| Trigger | PR / non-`main` branch push | Push to `main` |
| URL | `*.vercel.app` per deployment (see PR “Vercel – quantan” check) | https://quantan.vercel.app |
| Env scope | Vercel **Preview** env vars | Vercel **Production** env vars |
| `VERCEL_URL` | Set (used e.g. in `app/briefs/page.tsx` for SSR fetches) | Set |
| Auth (NextAuth) | Needs `NEXTAUTH_URL` = preview URL if OAuth used | Needs `NEXTAUTH_URL` = `https://quantan.vercel.app` |
| FRED prewarm | Set `QUANTAN_FRED_PREWARM=1` only if you want live FRED on that preview | **Required for Q-004 prod truth** (see §4) |
| Data | Same Yahoo-backed APIs; no SQLite warehouse on Vercel serverless by default | Same |

**Deployment Protection:** If preview URLs require Vercel login, disable or add bypass for QA in Project → Settings → Deployment Protection.

---

## 4. Environment variables (names only)

Set in **Vercel Dashboard → Project (`quantan`) → Settings → Environment Variables**. Never commit values. Mark secrets as **Sensitive**.

### P0 — owner action (Q-004)

| Name | Value shape | Scope | Purpose |
|------|-------------|-------|---------|
| `QUANTAN_FRED_PREWARM` | `1` | **Production** (optional Preview) | Module-init FRED cache warm in `lib/quant/riskFreeRate.ts`; without it, prod Sharpe/Sortino use static 4.5% fallback |

**Not yet in `.env.example`** — add locally for documentation when convenient:

```bash
# QUANTAN runtime flags
#QUANTAN_FRED_PREWARM=1
```

### Auth (optional — app runs without OAuth if unset)

| Name | Scope |
|------|-------|
| `NEXTAUTH_SECRET` | Production + Preview |
| `NEXTAUTH_URL` | Production = `https://quantan.vercel.app`; Preview = preview URL |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | If GitHub OAuth enabled |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | If Google OAuth enabled |

### Data / integrations (optional)

| Name | Purpose |
|------|---------|
| `FRED_API_KEY` | FRED API (if used; CSV fallback may work without) |
| `POLYGON_API_KEY` | Polygon provider |
| `ALPHA_VANTAGE_API_KEY` | Alpha Vantage provider |
| `BLOOMBERG_BRIDGE_URL` | Bloomberg bridge |
| `BLOOMBERG_BRIDGE_SECRET` | Bridge auth |
| `BLOOMBERG_BRIDGE_TIMEOUT_MS` | Bridge timeout |
| `ML_SIDECAR_URL` | Python ML sidecar (default localhost — not on Vercel unless hosted elsewhere) |
| `TRADING_AGENTS_BASE` | TradingAgents backend |
| `TRADING_AGENTS_FALLBACK_BASE` | Fallback backend |

### Client / routing

| Name | Purpose |
|------|---------|
| `NEXT_PUBLIC_BASE_PATH` | Subpath deploy prefix for client API calls (`lib/apiBase.ts`) |

### CI / local smoke only (do not need on Vercel)

`SMOKE_BASE_URL`, `SMOKE_SKIP_SEARCH`, `SMOKE_EXTENDED`, `SMOKE_LOCAL_PORT`, `VERIFY_APP_BASE_URL`, `NODE_ENV`, `VERCEL` (auto)

### AI / dev (from `.env.example` — not required for Vercel app runtime)

`ANTHROPIC_*`, `OPENAI_API_KEY`, etc.

---

## 5. Post-merge deploy verification checklist

Run after merging to `main` and waiting for Vercel production deploy (Dashboard → `quantan` → latest **Production** = Ready).

### Automated (recommended)

```bash
# From repo root after pull main
npm ci
npm run typecheck
npm run test
npm run benchmark   # WR floor 55.85% on CI; owner floor 55% per HANDOFF

# Live production smoke (default base is quantan.vercel.app; override with SMOKE_BASE_URL if needed)
SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke

# Extended fundamentals probe
SMOKE_BASE_URL=https://quantan.vercel.app SMOKE_EXTENDED=1 npm run check:smoke
```

### Manual browser (critical paths)

| Route | What to verify |
|-------|----------------|
| `/` | Hero loads, sector navigation |
| `/backtest` | Page loads; live signals / walkforward UI (after #18+#19); no console null errors |
| `/stock/AAPL` | Chart, indicators, Options tab lazy-load |
| `/crypto/btc` | BTC page (may 502 if providers down — acceptable with warning) |
| `/api/prices?tickers=AAPL,SPY` | 200 + positive prices |
| `/api/chart/AAPL?range=1mo` | Candles array |
| `/api/search?q=AAPL` | Quotes (or skip with `SMOKE_SKIP_SEARCH=1`) |

### Q-004 activation check (after setting `QUANTAN_FRED_PREWARM=1`)

1. Redeploy production (env vars apply at **build/runtime** for Next — trigger redeploy after change).
2. Hit a route that uses `getRiskFreeRateSync` (e.g. backtest metrics / options chain).
3. Owner re-runs `npm run benchmark` locally and updates `reviews/invariants-baseline.md` if Sharpe/Sortino baseline shifts.

---

## 6. Security deploy risk (Q-057 / npm audit)

Source: `reviews/npm-audit-2026-05-25.md` on branch `fix/options-investigation` (PR **#17**).

| Item | Severity | Action |
|------|----------|--------|
| `next@14.2.15` | **Critical** (23 advisories) | Planned upgrade Q-057-NEW — **owner sign-off** on 14.x patch vs 15.x vs 16.x |
| Middleware bypass / SSRF / RSC cache poisoning | Affects prod | Tied to Next upgrade + re-verify Q-040 CSP / Q-055 CSRF |
| `next-auth@4.24.11` | Moderate | Do **not** run `npm audit fix --force` (downgrades to 3.x) |
| `@ducanh2912/next-pwa` | Moderate | Coordinate with Next upgrade |

**Until Q-057 lands:** production remains on vulnerable Next 14.2.15; merges for features/docs are OK, but treat security uplift as P1.

---

## 7. Open PRs #17–#21 — deploy & CI status (2026-05-26)

| PR | Base → Head | GitHub CI | Vercel (quantan) | Merge notes |
|----|-------------|-----------|------------------|-------------|
| [#17](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/17) | `main` ← `fix/options-investigation` | ✅ typecheck, test, coverage, benchmark, smoke | ✅ | Merge **first** (snapshots + audit doc) |
| [#18](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/18) | `main` ← `refactor/q-054-backtest-decomp` | ✅ | ✅ | Merge **second** (backtest decomp) |
| [#19](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/19) | `refactor/q-054-backtest-decomp` ← `fix/backtest-live-signals-guards` | ❌ **none** | ✅ | Merge **third** into #18, then merge #18→`main`; or retarget to `main` after #18 merges |
| [#20](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/20) | `main` ← chore session state | ✅ | ✅ | Docs only — merge anytime |
| [#21](https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/21) | `main` ← benchmark JSON refresh | ✅ | ✅ | Data-only — merge after conflict check |

**Canonical implementer worktree:** `.claude/worktrees/competent-wu-a84629` on branch `fix/backtest-live-signals-guards` (matches PR #19 head).

---

## 8. CI vs Vercel gap — stacked PRs (#19)

**Symptom:** PR #19 shows Vercel SUCCESS but **no** GitHub Actions jobs.

**Cause:** `.github/workflows/ci.yml` on `main` only runs:

```yaml
on:
  pull_request:
    branches: [main]
```

PR #19 targets `refactor/q-054-backtest-decomp`, so Actions never fire.

**Recommended workflow (no `.github` change required):**

1. Merge #17 → `main`.
2. Merge #18 → `main`.
3. Rebase `fix/backtest-live-signals-guards` onto `main` (or merge #19 into updated #18 and close/reopen).
4. Open a new PR #19′ targeting `main` → full CI runs.

**Optional future CI improvement** (owner approval before implementing):

- Add `pull_request` with `branches: ['**']` or a `pull_request_target` workflow for stack bases — higher complexity and security review needed.
- Or require “merge stack to main” policy only (documented here).

**Vercel still builds #19** — preview URL is valid for manual QA; do not treat green Vercel alone as equivalent to CI green.

---

## 9. Owner action checklist

- [ ] **Vercel → `quantan` → Production env:** set `QUANTAN_FRED_PREWARM=1` → redeploy
- [ ] Confirm `NEXTAUTH_URL` / OAuth secrets match production domain if auth is used
- [ ] Merge PRs **#17 → #18 → #19** (stack policy above)
- [ ] Post-merge: `SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke`
- [ ] Schedule **Q-057-NEW** Next.js upgrade (sign-off on target version)
- [ ] Sync local `ci.yml` from `main` if developing in Google Drive workspace
- [ ] Decide whether `quantan-sector-investment` / `quantan-release-work` projects are still needed (3× build minutes per PR)

---

## 10. Blockers for parent / user

1. **Q-004 prod:** `QUANTAN_FRED_PREWARM=1` not set — operational only, code ready on canonical worktree.
2. **Q-057 security:** `next@14.2.15` critical CVEs — production risk until upgrade.
3. **PR #19 no GitHub CI** — merge order / retarget required; Vercel-only green is misleading.
4. **Local CI file stale** — workspace copy under-synced with `main`.
5. **Smoke default URL** — `scripts/smoke-production.mjs` defaults to `https://quantan.vercel.app`; override with `SMOKE_BASE_URL` for previews or local dev.
6. **Triple Vercel projects** — confirm which project owns `quantan.vercel.app` alias to avoid env var drift across projects.

---

## 11. Quick reference commands

```bash
# PR / CI status
gh pr view 17 --json statusCheckRollup,url
gh pr checks 19

# Production probe
curl -sI https://quantan.vercel.app
curl -s "https://quantan.vercel.app/api/prices?tickers=AAPL" | head -c 300

# Post-deploy smoke
SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke
```

**Do not run without explicit request:** `vercel deploy --prod`, `vercel promote`, `vercel rollback`.

---

## 12. Single production project (wave 3 — 2026-05-26)

**Keep exactly one Vercel project for this GitHub repo:**

| Keep | Remove / archive (dashboard) |
|------|------------------------------|
| **`quantan`** → https://quantan.vercel.app | **`quantan-sector-investment`** → https://quantan-sector-investment.vercel.app |
| | **`quantan-release-work`** → https://quantan-release-work.vercel.app |

**Why:** All three projects are linked to the same repository. Each PR currently triggers **three** production builds (~3× minutes). Env vars (`QUANTAN_FRED_PREWARM`, `NEXTAUTH_*`, data API keys) must be maintained in one place only.

**CLI inventory (2026-05-26, names only):**

```
vercel project ls
# quantan                     → https://quantan.vercel.app
# quantan-sector-investment   → https://quantan-sector-investment.vercel.app
# quantan-release-work        → https://quantan-release-work.vercel.app
```

**Local link (repo root):**

```bash
cd "/path/to/QUANTAN-sector-investment"
vercel link --yes --project quantan
# Creates/updates .vercel/project.json — do not commit if your policy excludes it
```

**Owner dashboard steps (agent cannot delete projects via CLI without team API):**

1. [Vercel Dashboard](https://vercel.com) → confirm **`quantan`** has domain **`quantan.vercel.app`** (Settings → Domains).
2. Copy any env vars from **`quantan-sector-investment`** and **`quantan-release-work`** into **`quantan`** (Production + Preview scopes). Names only checklist: §4 above.
3. For each extra project → **Settings → Advanced → Delete Project** (or disconnect Git integration first if you prefer archive-by-disconnect).
4. GitHub → repo **Settings → Integrations → Vercel** → ensure only **`quantan`** remains connected (remove duplicate project links if shown).
5. Open a test PR → expect **one** “Vercel – quantan” check, not three.

**Production deploy (owner, when ready):**

```bash
vercel link --yes --project quantan
vercel deploy --prod
```

**Repo SSOT for URLs:** `lib/appUrl.ts` defaults to `https://quantan.vercel.app`; override with `NEXT_PUBLIC_APP_URL`. Smoke: `scripts/smoke-production.mjs` (same default).

**Unrelated projects on same account** (do not delete unless owner confirms): `o-ptions`, `option-trading-app` — different apps, not QUANTAN.
