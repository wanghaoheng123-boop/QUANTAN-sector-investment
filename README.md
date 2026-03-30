# QUANTAN — Market Intelligence

Next.js 14 app for **GICS sector ETFs**, **commodity proxies**, **live quotes** (Yahoo Finance via `yahoo-finance2`, with **optional Bloomberg spot prices** through a self-hosted bridge), **candlestick charts** (Lightweight Charts), **desk-style quote strip**, **watchlists** (browser storage; keyed by account when signed in), and **NextAuth** sign-in with **Google** and/or **GitHub**.

> **Not investment advice.** Dark pool panels and rotating “signals” in this repo are **simulated / illustrative** for UI and workflow demos. Professional desks must plug in vendor-grade feeds (Bloomberg, Refinitiv, FactSet, internal OMS) and run their own compliance review before any production use.

## Features

- **Markets** — 11 sector cards, live ETF quotes (Yahoo; **Bloomberg override** when bridge configured), simulated directional cards, intelligence briefs.
- **Trading desk** — High-density table: macro (SPY, QQQ, IWM, DIA, VIX), all sector ETFs, commodity basket; refresh 2s / 5s / 15s; watchlist-only filter.
- **Commodities** — Curated list of liquid ETPs (USO, GLD, CPER, WEAT, …) with links to charts.
- **Auth** — Optional JWT sessions; watchlist `localStorage` key switches to `ag-watchlist-<email>` when logged in (no separate user DB required).
- **PWA** — Installable via `@ducanh2912/next-pwa` (disabled in dev).
- **Quant Lab (per stock)** — `/stock/[ticker]` → **Quant Lab** tab: live Yahoo **fundamentals** (profile, margins, leverage, analyst targets), **annual balance sheet & income history**, **three-scenario DCF** (bear/base/bull) with adjustable WACC / terminal growth / FCF growth, **median-based fair value** from DCF + analyst mean + forward-EPS heuristic, **volatility-adaptive buy/sell bands** (documented formula), **Codex-aligned framework checklists**, plus **technicals** (SMA20/50/200, RSI, MACD, Bollinger %B, ATR & 2×ATR stops, max drawdown, Sharpe/Sortino, 52w range & Fib retracement, classic pivots), **relative strength vs SPY** (correlation, 20d/60d excess), **earnings snapshot** when Yahoo exposes it, a **transparent 0–100 research dashboard** (weighted pillars), **5y extended analytics** via `/api/analytics` (win rate, beta proxy on log returns, div yield), and an educational **half-Kelly** slider block.

## Quick start

```bash
cd quantan
npm install
cp .env.example .env.local
# Edit .env.local — at minimum set NEXTAUTH_SECRET and NEXTAUTH_URL; add OAuth vars to enable sign-in.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Data sources & accuracy:** see [docs/DATA_VALIDATION.md](docs/DATA_VALIDATION.md) (what is live Yahoo vs demo UI, why numbers used to “jump”, and `npm run validate:data` for a 50-symbol quote smoke test).

### OAuth setup

1. **Google** — Create OAuth 2.0 Client ID (Web). Redirect: `{NEXTAUTH_URL}/api/auth/callback/google`.
2. **GitHub** — New OAuth App. Callback: `{NEXTAUTH_URL}/api/auth/callback/github`.

If no providers are configured, `/auth/signin` explains how to set env vars; the rest of the app still runs.

### Bloomberg data (optional, enterprise)

Bloomberg does **not** offer a public REST API for browser or serverless apps. Terminal data is accessed via **blpapi** (C++/Java/Python) against a logged-in Terminal or an approved **B-PIPE / Data License** stack. This repo supports **better price quality** by calling a **small HTTP bridge you host** next to that infrastructure.

1. Set `BLOOMBERG_BRIDGE_URL` (e.g. `http://127.0.0.1:8099`) and optionally `BLOOMBERG_BRIDGE_SECRET` (must match your bridge).
2. Your bridge must implement:
   - `GET /health` — liveness (optional auth via header `X-Bridge-Secret`).
   - `POST /quotes` — JSON body `{ "tickers": ["AAPL","SPY"] }`, response `{ "quotes": [ { "symbol": "AAPL", "last": 180.5, "pctChange": 0.3, "volume": 1e7, ... } ] }`  
     Field names are flexible; see `lib/data/bloomberg/bridgeClient.ts` for accepted aliases (`LAST_PRICE`, `PX_LAST`, etc.).
3. **Merge behaviour**: `/api/prices` and Quant Lab **prefer Bloomberg** for any ticker the bridge returns; other tickers stay on Yahoo. Fundamentals (statements, profile) remain Yahoo unless you extend the bridge yourself.
4. **Compliance**: Obey your **Bloomberg Terminal Agreement** and **Data License**. Do not expose the bridge to the public internet without Bloomberg-approved controls. Redistribution rules are strict.
5. **Starter stub**: `scripts/bloomberg-bridge-example.py` — replace `fetch_bloomberg_fields` with real `blpapi` code from Bloomberg’s SDK.
6. **Health check**: `GET /api/bloomberg-bridge/health` from this app verifies reachability (no secrets in response).

### Deploy (Vercel or Alibaba ECS)

**Production URL:** [https://antigravity-sectors.vercel.app](https://antigravity-sectors.vercel.app) (updates when you push to GitHub `main`).

1. Push this folder to a GitHub repository (see below).
2. In [Vercel](https://vercel.com), the project can stay linked to that repo for automatic deploys.
3. In **Vercel → Project → Settings → Environment Variables**, add the same keys as `.env.example`. Set **`NEXTAUTH_URL`** to `https://antigravity-sectors.vercel.app` (or your custom domain) and **`NEXTAUTH_SECRET`** (e.g. `openssl rand -base64 32`). Without `NEXTAUTH_SECRET`, sign-in routes may error in production.

For Alibaba ECS + auto-sync from GitHub `main`, see:

- `docs/ECS_DEPLOY.md`
- `.github/workflows/ecs-deploy.yml`

### Deployment status

Replace `YOUR_GITHUB_USER` and `YOUR_REPO` below once, then badges show live status:

- Vercel deploy workflow badge:  
  `https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml/badge.svg`
- ECS deploy workflow badge:  
  `https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/ecs-deploy.yml/badge.svg`

Example markdown:

```md
[![Vercel Deploy](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml/badge.svg)](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml)
[![Alibaba ECS Deploy](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/ecs-deploy.yml/badge.svg)](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/ecs-deploy.yml)
```

### Health checks (both URLs)

Set two base URLs:

- `VERCEL_URL=https://your-vercel-domain`
- `ECS_URL=https://your-ecs-domain`

Check app health endpoints manually:

```bash
curl -sS "$VERCEL_URL/api/bloomberg-bridge/health"
curl -sS "$ECS_URL/api/bloomberg-bridge/health"
```

Quick status-only check:

```bash
curl -I "$VERCEL_URL"
curl -I "$ECS_URL"
```

Recommended monitoring targets (UptimeRobot, Better Stack, Datadog Synthetics, etc.):

- `GET /` (homepage availability)
- `GET /api/bloomberg-bridge/health` (backend path responsiveness)
- Optional deep check: a lightweight quote endpoint once you define a stable symbol query

Alert rule baseline:

- Frequency: every 1 minute
- Trigger: 2 consecutive failures
- Notify: email + mobile push

### Failover plan

#### 1) Manual DNS failover (simplest, lowest cost)

- Keep primary DNS (for example `www`) pointing to Vercel.
- Keep secondary DNS (for example `hk`) pointing to ECS.
- If Vercel is down, update `www` DNS record to ECS target.
- Lower DNS TTL to `60-120` seconds for faster switching.
- After recovery, point DNS back to Vercel.

#### 2) Cloudflare Load Balancing (automatic failover)

- Put your domain on Cloudflare.
- Create two pools:
  - Pool A -> Vercel origin
  - Pool B -> ECS origin
- Add health monitor (HTTP/HTTPS) for `/` or `/api/bloomberg-bridge/health`.
- Configure steering:
  - Primary pool: Vercel
  - Fallback pool: ECS
- Enable session affinity if needed for auth-sensitive flows.

Operational notes:

- Keep env vars synchronized between Vercel and ECS (especially auth/payment keys).
- Keep OAuth callback URLs registered for both domains.
- Test failover monthly with a controlled drill (disable primary temporarily, verify automatic/manual switch).

## GitHub & Cursor

**Remote:** this repo is set up to push to  
`https://github.com/wanghaoheng123-boop/antigravity-sector-investment1`  
(`origin`). To publish updates from your PC (PowerShell):

```powershell
cd "path\to\antigravity-sectors"
$env:Path = "C:\Program Files\Git\cmd;C:\Program Files\nodejs;" + $env:Path
git add -A
git status
git commit -m "Describe your change"
git push origin main
```

If `git push` asks for credentials, use a [GitHub Personal Access Token](https://github.com/settings/tokens) as the password (classic token with `repo` scope), or install [GitHub CLI](https://cli.github.com/) and run `gh auth login`.

**Connect Cursor to GitHub:** in Cursor, open **Settings** (gear) → **Account** → sign in with GitHub (or **Cursor Settings → Git**). After that you can use the **Source Control** sidebar to commit/push, open PRs from the editor, and use features that need your GitHub identity.

**Windows + synced `G:` drive:** if `npm install` fails on a cloud drive, run `.\scripts\sync-to-local-build.ps1 -Install -Dev` and develop from the copy under `%LOCALAPPDATA%\Temp\antigravity-sectors-build`, then commit from the `G:` folder (or make the temp folder your Cursor workspace and push from there).

Add a **Security** policy if you accept third-party contributions.

## Commercial use & how people monetize this class of product

This codebase is a **frontend + API route** shell. Real “floor-grade” monetization usually combines:

1. **Data** — Resell or bundle **delayed/real-time** market data under vendor agreements (not scraped Yahoo in production for regulated users).
2. **SaaS tiers** — Free (delayed) vs **Pro** (alerts, export, more symbols, team seats) via Stripe/Paddle.
3. **B2B** — White-label dashboards for RIAs, prop firms, or **internal bank** “idea generation” tools (compliance-approved copy, no execution).
4. **Research** — Paid **sector notes** or **newsletter** upsell; this UI can gate briefs behind login + subscription.
5. **Execution** — Only with proper broker/dealer licensing; this repo does **not** include order routing.

**You** should consult a securities lawyer before marketing signals or subscription “advice” in your jurisdiction.

## Stack

- Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS  
- `yahoo-finance2` for quotes/charts  
- `lightweight-charts` for K-line  
- `next-auth` v4 for OAuth  

## Scripts

| Command       | Description        |
|---------------|--------------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Start production   |

---

**QUANTAN** — sector & commodity intelligence UI for traders and researchers building their own data and compliance layer on top.
