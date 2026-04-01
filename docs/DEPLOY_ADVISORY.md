# Deployment advisory (for developers)

This document explains **why earlier “deploy / upload” attempts failed** in GitHub Actions, and the **canonical** way this project ships to production today.

## Canonical deploy path

**GitHub (`main`) → Vercel GitHub App → build → production**

- Pushing to `main` updates GitHub immediately.
- Vercel clones that commit and runs `npm run build` on Vercel’s infrastructure.
- Vercel does **not** push build artifacts back to GitHub.

No Alibaba Cloud, ECS, or secondary sync target is used. Source of truth is **GitHub**; hosting is **Vercel**.

## Why the old GitHub Actions “Vercel CLI” workflow kept failing

| Issue | Explanation |
|--------|-------------|
| **`vercel pull` in CI** | Expects a linked project (often from a local `.vercel/` folder that is **gitignored**). On a clean runner, pull frequently failed or behaved like missing credentials. |
| **`VERCEL_TOKEN` problems** | Empty, expired, or wrong-scope token causes any CLI step to exit non-zero. |
| **Missing build-time env in Actions** | `NEXTAUTH_SECRET` / `NEXTAUTH_URL` are normally set in **Vercel → Environment Variables**. Duplicating them into GitHub Secrets was required for a CLI-only pipeline—easy to misconfigure. |
| **Redundant pipeline** | Vercel already builds on every push via the **Vercel GitHub App**. A second “manual CLI deploy” duplicated work and was harder to keep green. |

**Resolution:** The custom `vercel-deploy.yml` workflow was **removed**. Deployments rely on Vercel’s native Git integration.

## Operational checklist (Vercel dashboard)

1. **Git:** Project connected to `wanghaoheng123-boop/QUANTAN-sector-investment`, production branch `main`.
2. **Environment variables (Production):**
   - `NEXTAUTH_SECRET` — required for NextAuth (e.g. `openssl rand -base64 32`).
   - `NEXTAUTH_URL` — your production URL (e.g. `https://antigravity-sectors.vercel.app` or custom domain).
   - `TRADING_AGENTS_BASE` — optional, for LLM / TradingAgents features.
3. **Build logs:** Vercel → Project → Deployments → select deployment → Build log.

## CI on GitHub (this repo)

A minimal **[CI workflow](../.github/workflows/ci.yml)** runs `npm run typecheck` on Ubuntu so TypeScript is validated on every push without using the Vercel CLI or tokens.

## Local development note

On some Windows setups with **Unicode characters in the folder path**, `npm run typecheck` / `tsc` can fail to resolve binaries. That is an environment issue; **GitHub Actions Ubuntu** and **Vercel** builds are authoritative for CI.

## MA200 deviation feature (status)

Implementation is documented in the main README (deploy section) and lives in:

- `lib/quant/technicals.ts` — `ma200Regime`, deviation %, slope
- `app/api/ma-deviation/route.ts` — sector/ETF data
- `app/ma-deviation/page.tsx` — dashboard UI
- Stock Quant Lab and BTC Quant Lab — same regime logic where daily closes allow

Forward-return language is **educational / heuristic**, not a performance guarantee.
