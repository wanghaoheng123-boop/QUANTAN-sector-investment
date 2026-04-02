# QUANTAN - Market Intelligence v2.0

Next.js 14 app for **GICS sector ETFs**, **commodity proxies**, **live quotes** (Yahoo Finance via `yahoo-finance2`, with **optional Bloomberg spot prices** through a self-hosted bridge), **candlestick charts** (Lightweight Charts), **desk-style quote strip**, **institutional-grade backtesting**, **watchlists** (browser storage; keyed by account when signed in), and **NextAuth** sign-in with **Google** and/or **GitHub**.

> **Not investment advice.** Dark pool panels and rotating signals in this repo are **simulated / illustrative** for UI and workflow demos. The backtest engine has been professionally reviewed for statistical correctness. Professional desks must plug in vendor-grade feeds (Bloomberg, Refinitiv, FactSet, internal OMS) and run their own compliance review before any production use.

## What's New in v2.0

- **Institutional Backtest Dashboard** - 5Y walk-forward backtest across 56 instruments with corrected Sharpe/Sortino metrics, proper next-day execution modeling, and ATR-adaptive stops
- **TradingView-Style Charts** - Enhanced K-line charts with real-time OHLCV crosshair, timeframe selector, and colored indicator dots
- **Market Breadth** - Visual display of sector up/down/flat proportions on the homepage
- **Keyboard Shortcuts** - Press `?` for shortcuts overlay, `Cmd+K` for global search
- **Market Status** - Live PRE/RTH/AH/CLOSED indicator in header
- **Breadcrumb Navigation** - Full path breadcrumbs on all inner pages
- **Animated UI** - Card entrance animations, shimmer loading skeletons, confidence ring animations

## Features

- **Markets** - 11 sector cards, live ETF quotes (Yahoo; **Bloomberg override** when bridge configured), **market breadth visualization**, intelligence briefs.
- **Trading desk** - High-density table: macro (SPY, QQQ, IWM, DIA, VIX), all sector ETFs, commodity basket; refresh 2s / 5s / 15s; watchlist-only filter.
- **Commodities** - Curated list of liquid ETPs (USO, GLD, CPER, WEAT, ...) with links to charts.
- **Institutional Backtest Dashboard** - 5Y walk-forward backtest, 200EMA regime strategy, ATR-adaptive stops, Half-Kelly sizing, full trade log, sector attribution, walk-forward OOS testing.
- **Auth** - Optional JWT sessions; watchlist `localStorage` key switches to `ag-watchlist-<email>` when logged in (no separate user DB required).
- **PWA** - Installable via `@ducanh2912/next-pwa` (disabled in dev).
- **Quant Lab (per stock)** - `/stock/[ticker]` -> **Quant Lab** tab: live Yahoo **fundamentals** (profile, margins, leverage, analyst targets), **annual balance sheet & income history**, **three-scenario DCF** (bear/base/bull) with adjustable WACC / terminal growth / FCF growth, **median-based fair value** from DCF + analyst mean + forward-EPS heuristic, **volatility-adaptive buy/sell bands** (documented formula), **Codex-aligned framework checklists**, plus **technicals** (SMA20/50/200, RSI, MACD, Bollinger %B, ATR & 2xATR stops, max drawdown, Sharpe/Sortino, 52w range & Fib retracement, classic pivots), **relative strength vs SPY** (correlation, 20d/60d excess), **earnings snapshot** when Yahoo exposes it, a **transparent 0-100 research dashboard** (weighted pillars), **5y extended analytics** via `/api/analytics` (win rate, beta proxy on log returns, div yield), and an educational **half-Kelly** slider block.

## Quick start

```bash
cd quantan
npm install
cp .env.example .env.local
# Edit .env.local - at minimum set NEXTAUTH_SECRET and NEXTAUTH_URL; add OAuth vars to enable sign-in.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Data sources & accuracy:** see [docs/DATA_VALIDATION.md](docs/DATA_VALIDATION.md) (what is live Yahoo vs demo UI, why numbers used to "jump", and `npm run validate:data` for a 50-symbol quote smoke test).

### OAuth setup

1. **Google** - Create OAuth 2.0 Client ID (Web). Redirect: `{NEXTAUTH_URL}/api/auth/callback/google`.
2. **GitHub** - New OAuth App. Callback: `{NEXTAUTH_URL}/api/auth/callback/github`.

If no providers are configured, `/auth/signin` explains how to set env vars; the rest of the app still runs.

### Bloomberg data (optional, enterprise)

Bloomberg does **not** offer a public REST API for browser or serverless apps. Terminal data is accessed via **blpapi** (C++/Java/Python) against a logged-in Terminal or an approved **B-PIPE / Data License** stack. This repo supports **better price quality** by calling a **small HTTP bridge you host** next to that infrastructure.

1. Set `BLOOMBERG_BRIDGE_URL` (e.g. `http://127.0.0.1:8099`) and optionally `BLOOMBERG_BRIDGE_SECRET` (must match your bridge).
2. Your bridge must implement:
   - `GET /health` - liveness (optional auth via header `X-Bridge-Secret`).
   - `POST /quotes` - JSON body `{ "tickers": ["AAPL","SPY"] }`, response `{ "quotes": [ { "symbol": "AAPL", "last": 180.5, "pctChange": 0.3, "volume": 1e7, ... } ] }`
     Field names are flexible; see `lib/data/bloomberg/bridgeClient.ts` for accepted aliases (`LAST_PRICE`, `PX_LAST`, etc.).
3. **Merge behaviour**: `/api/prices` and Quant Lab **prefer Bloomberg** for any ticker the bridge returns; other tickers stay on Yahoo. Fundamentals (statements, profile) remain Yahoo unless you extend the bridge yourself.
4. **Compliance**: Obey your **Bloomberg Terminal Agreement** and **Data License**. Do not expose the bridge to the public internet without Bloomberg-approved controls. Redistribution rules are strict.
5. **Starter stub**: `scripts/bloomberg-bridge-example.py` - replace `fetch_bloomberg_fields` with real `blpapi` code from Bloomberg's SDK.
6. **Health check**: `GET /api/bloomberg-bridge/health` from this app verifies reachability (no secrets in response).

### Deploy (Vercel)

**Production URL:** [https://antigravity-sectors.vercel.app](https://antigravity-sectors.vercel.app) (updates automatically when you push to GitHub `main`).

**Source control and hosting:** Only **GitHub** (this repo) and **Vercel** (linked via the Vercel GitHub App). There is **no** Alibaba Cloud / ECS / secondary server sync. Deployments are triggered by pushes to `main`; Vercel clones the commit and builds on Vercel's runners.

**For other developers:** See [docs/DEPLOY_ADVISORY.md](docs/DEPLOY_ADVISORY.md) for why older GitHub Actions "Vercel CLI" workflows failed and the operational checklist. CI runs **`npm run typecheck`** on Ubuntu via [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (no Vercel token required).

1. Push this folder to a GitHub repository (see below).
2. In [Vercel](https://vercel.com), keep the project **Git-linked** to that repo so every push to `main` triggers a production build.
3. In **Vercel -> Project -> Settings -> Environment Variables**, add the same keys as `.env.example`. Set **`NEXTAUTH_URL`** to `https://antigravity-sectors.vercel.app` (or your custom domain) and **`NEXTAUTH_SECRET`** (e.g. `openssl rand -base64 32`). Without `NEXTAUTH_SECRET`, sign-in routes may error in production.

### LLM Multi-Agent Analysis (TradingAgents)

The **LLM Multi-Agent Analysis** tab needs the `server_trading_agents.py` Python backend running **on infrastructure you control** (recommended: [Railway](https://railway.app)). Your LLM API key is **not** stored in QUANTAN's database; when you run an analysis it is sent in a single request from your browser through this app's API to your backend, then to the LLM provider. **Use `https://` for `TRADING_AGENTS_BASE` on Vercel** so traffic to your backend is encrypted.

#### Recommended: Railway (simplest)

**Step 1: Deploy the Python backend**

1. Create a free account at [railway.app](https://railway.app) (500 hrs/month free, $5 sign-up credit).
2. Click **New Project -> Deploy from GitHub** -> select your repo (same one that contains `server_trading_agents.py`).
3. Railway injects **`PORT`**; the repo includes a **`Procfile`** that runs:
   ```
   python server_trading_agents.py --host 0.0.0.0 --port $PORT
   ```
   If you deploy without the Procfile, set the start command to the same line (Railway sets `$PORT` automatically).
4. Railway will auto-detect Python and install dependencies from `requirements.txt` if present. Create a `requirements.txt` in the repo root:
   ```
   fastapi>=0.115.0
   uvicorn>=0.32.0
   pydantic>=2.0.0
   tradingagents>=0.2.0
   ```
5. Once deployed, Railway gives you a URL like `https://your-app.up.railway.app`. Copy it.

**Step 2: Connect it to Vercel**

6. In **Vercel -> Project -> Settings -> Environment Variables**, add:
   - Name: `TRADING_AGENTS_BASE`
   - Value: `https://your-app.up.railway.app` (must be **`https://`**, no trailing slash)
   - Environments: **Production** (and Preview if you want)
   - Optional (for zero-setup users): set `TRADING_AGENTS_FALLBACK_BASE` to a shared managed backend URL. It is used only when `TRADING_AGENTS_BASE` is not set.

7. Redeploy the Next.js app - the LLM tab will now connect automatically.

**Step 3: Verify**

8. Go to any stock page -> Quant Lab -> LLM Agents -> paste your API key -> click Run. The backend will be reachable and the analysis will run using your key.
9. In the LLM tab, use **Check connection** to verify backend availability before running analysis.

**Alternative hosts:** Render, Fly.io, or any VPS work the same way - expose FastAPI on a public **`https://`** URL and point `TRADING_AGENTS_BASE` at the origin.

**Local development:** run `python server_trading_agents.py` alongside `npm run dev`. It listens on `http://127.0.0.1:3001` by default. No environment variable needed locally.

### Deployment status

Replace `YOUR_GITHUB_USER` and `YOUR_REPO` below once, then badges show live status:

- Vercel deploy workflow badge:
  `https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml/badge.svg`

Example markdown:

```md
[![Vercel Deploy](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml/badge.svg)](https://github.com/YOUR_GITHUB_USER/YOUR_REPO/actions/workflows/vercel-deploy.yml)
```

### Health check

Set your Vercel base URL:

- `VERCEL_URL=https://your-vercel-domain`

Check app health endpoints manually:

```bash
curl -sS "$VERCEL_URL/api/bloomberg-bridge/health"
```

Quick status-only check:

```bash
curl -I "$VERCEL_URL"
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
- Lower DNS TTL to `60-120` seconds for faster switching.
- If Vercel is down, update the DNS record to point to your backup infrastructure.
- After recovery, point DNS back to Vercel.

#### 2) Cloudflare Load Balancing (automatic failover)

- Put your domain on Cloudflare.
- Create a pool pointing to your Vercel deployment.
- Add health monitor (HTTP/HTTPS) for `/` or `/api/bloomberg-bridge/health`.
- Configure steering to your fallback infrastructure as needed.
- Enable session affinity if needed for auth-sensitive flows.

Operational notes:

- Keep OAuth callback URLs registered for your primary domain.
- Test failover monthly with a controlled drill (disable primary temporarily, verify automatic/manual switch).

## GitHub & Cursor

**Remote:** this repo is set up to push to
`https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment`
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

**Connect Cursor to GitHub:** in Cursor, open **Settings** (gear) -> **Account** -> sign in with GitHub (or **Cursor Settings -> Git**). After that you can use the **Source Control** sidebar to commit/push, open PRs from the editor, and use features that need your GitHub identity.

**Windows + synced `G:` drive:** if `npm install` fails on a cloud drive, run `.\scripts\sync-to-local-build.ps1 -Install -Dev` and develop from the copy under `%LOCALAPPDATA%\Temp\antigravity-sectors-build`, then commit from the `G:` folder (or make the temp folder your Cursor workspace and push from there).

Add a **Security** policy if you accept third-party contributions.

## Commercial use & how people monetize this class of product

This codebase is a **frontend + API route** shell. Real "floor-grade" monetization usually combines:

1. **Data** - Resell or bundle **delayed/real-time** market data under vendor agreements (not scraped Yahoo in production for regulated users).
2. **SaaS tiers** - Free (delayed) vs **Pro** (alerts, export, more symbols, team seats) via Stripe/Paddle.
3. **B2B** - White-label dashboards for RIAs, prop firms, or **internal bank** "idea generation" tools (compliance-approved copy, no execution).
4. **Research** - Paid **sector notes** or **newsletter** upsell; this UI can gate briefs behind login + subscription.
5. **Execution** - Only with proper broker/dealer licensing; this repo does **not** include order routing.

**You** should consult a securities lawyer before marketing signals or subscription "advice" in your jurisdiction.

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

**QUANTAN** - sector & commodity intelligence UI for traders and researchers building their own data and compliance layer on top.
