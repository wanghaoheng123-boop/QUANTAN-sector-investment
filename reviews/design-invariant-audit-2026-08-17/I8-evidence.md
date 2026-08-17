# Q-079 — Design invariant I8 ("Vendor terms are law") — tier audit

- **Date:** 2026-08-17
- **Tree:** worktree `sweet-dubinsky-4e07b2`, branch `claude/q079-invariants-audit-2e38e2`, synced to `main` @ `18afde2`
- **Scope:** I8 only. Repo-only evidence. No file was edited except this one.
- **Not in scope:** a legal opinion. This document records what the repository does and does not
  show. Where a legal view is required it says so and names who must obtain it.

---

## CURRENT TIER

`CLAUDE.md` I8 · **UNVERIFIED**, with the note: *"the `yahoo-finance2` redistribution position has
never been written down. See Q-082."*

## PROPOSED TIER

I8 contains two separable requirements. They do not sit at the same tier.

| Half | Requirement | Proposed tier |
|---|---|---|
| **(a) Substantive licence question** — does the platform have the right to redistribute what it redistributes? | "Market data licences almost universally prohibit redistribution" | **UNVERIFIED** |
| **(b) Process requirement** — the operative sentence | "Before any feature exposes vendor data to end users, confirm the licence permits it **and record the finding**" | **VIOLATED** |
| **Overall** | | **VIOLATED** |

**(a) UNVERIFIED — justification.** There is no licence, account, API key or agreement visible in the
repo for any of the eleven market-data vendors the platform calls — with the single exception of a
Tushare token name on a source the product cannot reach (evidence E3). Whether unlicensed
consumption plus redistribution to end users is acceptable is a legal question about documents that
are not in the repo. It is not resolvable by any agent and must not be closed by reading a vendor's
ToS and forming a view — `workspace/IMPROVEMENT_BACKLOG.json` Q-082 (`notes_2026_08_16_REFRAMED`)
says exactly this. **Who must obtain it:** the owner, from external counsel, routed jointly with
Q-083 (MAS/FAA), because both turn on what the product shows end users.

**(b) VIOLATED — justification.** Three independent legs. Leg 3 alone is sufficient and is
chronology-independent:

1. **No mechanism exists.** Five CI workflows, 35 npm scripts, zero PR/issue templates, zero
   checklists, zero tests reference a licence check (E7). Absence of mechanism alone would be
   ASPIRATIONAL.
2. **A live counter-example post-dates the requirement.** Commit `0027886` (PR #147, 2026-08-16)
   replaced fabricated stock-page news with **live Yahoo Finance headlines rendered to end users**,
   and is a verified descendant of both `047ae57` (the commit that wrote I8 into `CLAUDE.md`) and
   `f7d369e` (the commit that reframed Q-082 to "no vendor licence exists"). No licence finding was
   recorded with it (E8). A feature exposing vendor data shipped after the requirement existed and
   after the gap was explicitly named, with no confirmation and no recorded finding.
3. **The trigger condition is true right now and the required artifact is absent.** I8 is not only
   a ship-time rule: it conditions *exposure* on a recorded finding. Today 19 unauthenticated public
   routes serve vendor-derived data to end users (E2) sourced from eleven distinct vendors (vendor
   inventory), and the number of recorded licence confirmations for any of them is **zero** (E1, E7).
   The invariant's condition is unsatisfied in the live state, independent of when anything shipped.

Because leg 3 does not depend on commit chronology, sub-tier (b) does not fall back to ASPIRATIONAL
even if a reviewer rejects leg 2.

**Overall VIOLATED, not PARTIAL.** PARTIAL requires naming a mechanism at file:line that covers
*some* paths. There is no such mechanism. The two nearest candidates both fail the test:
`components/ComplianceBanner.tsx` is a disclaimer that disclaims *advice*, not a licence gate, and
it explicitly asserts the opposite posture ("Market data is delayed or aggregated per **your** data
provider (e.g. Yahoo Finance via this demo)", `components/ComplianceBanner.tsx:35`);
`reviews/findings-ledger.csv:42` is a *record* of the risk, not a gate — and it has been `open`
since the R4/R7 review wave with a named acceptance test whose artifact does not exist (E6).

---

## VENDOR INVENTORY

**Eleven distinct vendors are enumerated** across two surfaces: eight in the TypeScript/Next path
(table A) and three more reached only through Python sidecars (table B). Of the eleven, **six are
unconditionally exposed to end users today** (Yahoo, CoinGecko, Kraken, Coinbase, Bybit, OKX); FRED
is derived-only and env-gated off; Bloomberg is conditional on `BLOOMBERG_BRIDGE_URL`; and the three
Python-side vendors are conditional on a sidecar URL being configured.

### Table A — TypeScript / Next.js surface

"End-user exposed" = the vendor's data is returned from a public API route and/or rendered in the
UI. Every API route below is **unauthenticated**: `middleware.ts:119` matches all paths but performs
only CSP + CSRF-cookie work (`middleware.ts:51-116`) — no auth check; the only route in `app/api`
with an auth guard is `app/api/trading-agents/[ticker]/route.ts` (`lib/auth/apiKey.ts:26`).

| # | Vendor | Representative call site (file:line) | End-user exposed | Auth / account present |
|---|---|---|---|---|
| 1 | **Yahoo Finance** (via `yahoo-finance2 ^3.13.2`, `package.json` dependencies) | `app/api/prices/route.ts:131`, `app/api/chart/[ticker]/route.ts:185`, `app/api/news/ticker/[ticker]/route.ts:53`, `app/api/news/[sector]/route.ts:57`, `app/api/briefs/route.ts:92`, `app/api/search/route.ts:134`, `app/api/fundamentals/[ticker]/route.ts:68`, `app/api/analytics/[ticker]/route.ts:45`, `app/api/darkpool/[ticker]/route.ts:201`, `app/api/sector-rotation/route.ts:30`, `app/api/ma-deviation/route.ts:57`, `app/api/stream/route.ts:112`, `app/api/stream/[ticker]/route.ts:60`; plus import-only sites `lib/options/chain.ts:6` and `lib/briefs/sectorBrief.ts:37` (imports, not calls — the calls are inside those modules) | **YES** — 15 public routes + UI (`components/NewsFeed.tsx:153`, `app/briefs/sector/[sector]/LiveBriefClient.tsx:289,331`, `app/stock/[ticker]/page.tsx:675`, `components/DarkPoolPanel.tsx:216`) | **NO** — no `YAHOO_*` var in the `process.env` reference set (E3); `yahoo-finance2` is an unofficial community client of undocumented endpoints |
| 2 | **CoinGecko** | server `app/api/crypto/btc/route.ts:82`, `app/api/crypto/btc/quote/route.ts:20`; **browser-direct** `components/crypto/hooks/useBtcCandles.ts:34,168`, `components/crypto/hooks/useBtcPriceWs.ts:113` | **YES** — `/api/crypto/btc*` + `app/crypto/btc/page.tsx:125`, `components/crypto/BtcHeader.tsx:36` | **NO** — no key env var; unauthenticated public API |
| 3 | **Kraken** | REST `app/api/crypto/btc/route.ts:4` (fetch at `:29`); WebSocket, browser-direct `components/crypto/hooks/useBtcKlineWs.ts:7` | **YES** — same surfaces; `app/crypto/btc/page.tsx:125-126` | **NO** |
| 4 | **Coinbase Exchange** | REST `app/api/crypto/btc/route.ts:5`; WebSocket, browser-direct `components/crypto/hooks/useBtcPriceWs.ts:6` | **YES** | **NO** |
| 5 | **Bybit** | `app/api/crypto/btc/metrics/route.ts:6,81,85` | **YES** — `components/crypto/BtcQuantLab.tsx:341`, `app/crypto/btc/page.tsx:126` | **NO** |
| 6 | **OKX** | `app/api/crypto/btc/metrics/route.ts:7,89`; `app/api/crypto/btc/liquidations/route.ts:7,40` | **YES** — liquidations + long/short panels, source string at `metrics/route.ts:136` | **NO** |
| 7 | **FRED (St. Louis Fed)** | `lib/quant/riskFreeRate.ts:68` — `fredgraph.csv` graph-download URL, **not** the keyed FRED API | **DERIVED ONLY** — feeds `r` into option greeks (`lib/options/chain.ts:145`) and backtests (`lib/backtest/engine.ts:7`); no raw FRED series is rendered. **Off by default**: `QUANTAN_FRED_PREWARM` gate (`lib/quant/riskFreeRate.ts:18-22,99`), absent from `.env.example` | **NO** — no `FRED_API_KEY`; the keyless CSV path is used |
| 8 | **Bloomberg (owner-hosted Terminal bridge)** | `lib/data/bloomberg/bridgeClient.ts:65,75,170`; consumed by `app/api/prices/route.ts:4` and `app/api/fundamentals/[ticker]/route.ts:4`; health `app/api/bloomberg-bridge/health/route.ts:3` | **CONDITIONAL — YES when configured.** Live only if `BLOOMBERG_BRIDGE_URL` is set; when set, `/api/prices` **prefers Bloomberg** (`README.md:57`) and that route is public and unauthenticated | Bridge shared secret `BLOOMBERG_BRIDGE_SECRET` (auth to the owner's *own* bridge, not a vendor entitlement). Not in `.env.example` |

### Table B — Python surface (sidecars; `requirements.txt` + root `*.py` + `ml/` + `quant_framework/`)

The three sidecar env vars are *not* vendors themselves, but what they reach is. `Procfile` declares
three deployable Python processes (`server_trading_agents.py`, `multi_agent_factor_mining.server`,
`server_options.py`).

| # | Vendor | Call site (file:line) | Reaches end users? | Auth / account present |
|---|---|---|---|---|
| 9 | **Yahoo, again — via `yfinance`** (`requirements.txt:20`) | `ml/server.py:14` (import) serving `GET /predict/{ticker}` at `ml/server.py:52`; `quant_framework/data_engine.py:37-59`; `options_us.py:9`; `server_trading_agents.py:23,190` (`data_vendor: "yfinance"`) | **CONDITIONALLY, DERIVED ONLY.** `lib/ml/client.ts:36` calls the ML sidecar (`ML_SIDECAR_URL`, default `http://localhost:8001`) and backs the **public unauthenticated** `app/api/ml/[ticker]/route.ts`. What crosses is a model prediction, not raw quotes. `app/api/trading-agents/[ticker]/route.ts` is the one auth-gated route (`lib/auth/apiKey.ts:26`, fail-closed) | **NO** — `yfinance` is a second unofficial Yahoo client with no key |
| 10 | **AKShare** (A-shares / SSE 50 ETF options) (`requirements.txt:21`) | `quant_framework/data_engine.py:63-92`; `options_asia.py:4,7,458`; served by `server_options.py:89` (`/options/asia/{symbol}`) | **NOT WIRED** — a repo-wide grep of `lib app components package.json Procfile` for `server_options`/`options/us/`/`options/asia/` finds **no TypeScript caller**; the service is deployable via `Procfile:3` but the Next app never calls it | **NO** |
| 11 | **Tushare** | `quant_framework/data_engine.py:96-130` | **NOT WIRED** (same as 10; fallback inside `data_engine`) | **YES-ish — `TU_SHARE_TOKEN`** (`quant_framework/data_engine.py:103`). This is the **only vendor credential name that exists anywhere in the repo**, and it is on a data source that is not reachable from the product |

Out of market-data scope but noted: DeepSeek LLM API (`multi_agent_factor_mining/config.py:24,96`),
and `alpha_vantage` appearing only as an unimplemented option string in `server_trading_agents.py:23`.
Also noted: `lib/quant/garchClient.ts:85` and `lib/quant/regimeHmmClient.ts:54` call
`${QUANT_FRAMEWORK_URL}/garch/{ticker}` and `/regime/...` passing only a ticker — so the sidecar
would fetch vendor data itself — but **no in-repo Python file implements those endpoints**
(`grep -rn "garch/\|/regime" --include=*.py` returns nothing), so that path is unproven and both
routes fall back to in-process EWMA / vol-ratio.

**Checked and deliberately excluded from both tables** (they are citations or non-market-data, not
vendor calls):
- `lib/options/gex.ts:18-19` — Squeezemetrics / SpotGamma named as a *sign-convention cross-reference*
  in a docstring (`lib/options/gex.ts:10-24`); no fetch. Consistent with ledger row F3.4
  (`reviews/findings-ledger.csv:33`).
- `lib/api/marketHours.ts:15` — NYSE hours page cited in a docstring; the implementation uses
  `Intl.DateTimeFormat` (`lib/api/marketHours.ts:11-20`). No fetch.
- `fonts.googleapis.com` / `fonts.gstatic.com` (`app/layout.tsx:41-44`, `middleware.ts:62-63`) — web fonts.
- `console.anthropic.com`, `platform.openai.com`, `aistudio.google.com`, `railway.app`
  (`components/stock/quantlab/tabs/LlmTab.tsx:133-336`) — bring-your-own-key documentation links.
- `ML_SIDECAR_URL`, `QUANT_FRAMEWORK_URL`, `TRADING_AGENTS_BASE` — self-hosted sidecars, not
  third-party market-data vendors.
- `query2.finance.yahoo.com` appears only in `__tests__/quant/earningsParse.test.ts:15` (fixture),
  not in a source fetch.

---

## EVIDENCE

**E1 — The constitution's factual premise for I8 is wrong.** `CLAUDE.md` I8 states the
`yahoo-finance2` redistribution position "has never been written down". Three artifacts written it
down months earlier:
- `reviews/findings-ledger.csv:42` — `F4.5,R4,HIGH,data-engineering,(every yahoo route),yahoo-finance2 commercial redistribution,Yahoo Finance ToS §2,AT-F4.5-compliance-banner,E3,S4,open`
- `reviews/findings-ledger.csv:75` — `F7.8 … (cross-ref F4.5), yahoo commercial use, Yahoo ToS … open`
- `reviews/R7-security-compliance.md:213` and `reviews/PHASE-14-REMEDIATION-ROADMAP.md:333`

**Precision matters here:** what those record is an *agent-authored risk assertion* derived from
reading a ToS. I8 requires a *confirmation that the licence permits* the use. Those are different
artifacts, so I8's requirement is still unmet — but its stated premise is inaccurate, and materially
so: a HIGH-severity row on exactly this question has been sitting `open` since the R4/R7 wave. Per
the standing note that the F1.x–F8.x block is a stale early wave, F4.5 is used here as evidence
about *process latency*, not re-filed as a fresh finding.

**E2 — Vendor data is redistributed through unauthenticated public routes.** `middleware.ts:119`
(`matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']`) applies to everything, but the
handler body only sets CSP and a CSRF cookie (`middleware.ts:51-116`) — there is no session or
route-protection logic. A repo-wide grep for auth guards inside `app/api` returns exactly one file,
`app/api/trading-agents/[ticker]/route.ts`. All 15 Yahoo routes and all four crypto routes are
therefore open to any caller. `reviews/R7-security-compliance.md:262` made the same observation
about `/api/prices` in June; it still holds against current `middleware.ts`.

**E3 — No vendor account or key exists for any market-data vendor.** The complete set of
`process.env.*` names referenced across `lib/`, `app/`, `components/`, `scripts/`, `middleware.ts`
contains no `YAHOO_*`, `COINGECKO_*`, `KRAKEN_*`, `COINBASE_*`, `BYBIT_*`, `OKX_*` or `FRED_*`
variable. `.env.example` declares only `NEXTAUTH_SECRET`, `NEXTAUTH_URL` and four `ANTHROPIC_*`
names. (Variable **names** only were inspected; no `.env` file was opened and no value was read.)
This corroborates Q-082's reframed finding and extends it from Yahoo to all eight vendors on the
TypeScript surface. The Python sweep (table B) found exactly one vendor credential *name* in the
whole repo — `TU_SHARE_TOKEN` (`quant_framework/data_engine.py:103`) — on Tushare, which no
TypeScript code reaches. No value was read; only the name's presence was checked.

**E4 — The remediation that the repo believes shipped did not ship.**
`reviews/PHASE-14-REMEDIATION-ROADMAP.md:336` prescribed: banner text *"non-commercial research use
only"* + a link to Yahoo ToS, and a `YAHOO_RESEARCH_ONLY=true` flag that disables `/api/prices`,
`/api/chart`, `/api/options` when unset. Actual state:
- `grep -rn "YAHOO_RESEARCH_ONLY"` across the tree returns **one hit — the roadmap line itself**.
  No such env var is read by any code.
- `grep -rniE "non-?commercial|research use only|personal use"` across `components/ app/ lib/ docs/
  README.md AGENTS.md` returns **zero hits**.
- `grep -rniE "legal\.yahoo|policies\.yahoo|terms"` across `components/ app/` `.tsx` returns **zero
  hits** — there is no ToS link in the UI.
- The banner's actual data-source sentence is `components/ComplianceBanner.tsx:35`: *"Market data is
  delayed or aggregated per your data provider (e.g. Yahoo Finance via this demo)."* It attributes
  the provider relationship to the *user*, and calls the deployment a demo.
- Meanwhile `reviews/PHASE-15-PLAN.md:44` records `| Yahoo TOS compliance banner | present |`.

So acceptance test `AT-F4.5-compliance-banner` (`reviews/findings-ledger.csv:42`) names an artifact
whose specified content does not exist, and a plan file asserts it is present. This is the
"tagged code ≠ fixed effect" failure mode applied to a compliance control.

**E5 — There are no legal pages.** `find app -maxdepth 2 -type d | grep -iE "legal|terms|disclaim|about|privacy"`
returns nothing. The only site-wide legal surface is `components/ComplianceBanner.tsx`, mounted at
`app/layout.tsx:100`.

**E6 — Attribution exists; licence confirmation does not.** User-visible source naming is
widespread and honest: `components/NewsFeed.tsx:153` ("Live · Yahoo Finance"),
`app/briefs/sector/[sector]/LiveBriefClient.tsx:331` ("Data sourced from Yahoo Finance"),
`app/stock/[ticker]/page.tsx:675` ("All data from Yahoo Finance"),
`components/DarkPoolPanel.tsx:216`, `components/crypto/BtcHeader.tsx:36`,
`app/crypto/btc/page.tsx:125-126`, `app/heatmap/page.tsx:81`. `docs/DATA_VALIDATION.md:68` goes
furthest: *"Yahoo Finance data is subject to Yahoo's terms; this app is informational only — not
investment advice."* That is an acknowledgement of the existence of terms, not a confirmation that
they permit this use — I8 asks for the latter. `README.md:222` similarly anticipates the gap:
*"Resell or bundle delayed/real-time market data under vendor agreements (**not scraped Yahoo in
production for regulated users**)."* Note the repo's own word: *scraped*.

**E7 — No procedural gate of any kind exists.** `.github/` contains exactly five files, all
workflows: `ci.yml`, `stryker-weekly.yml`, `a11y-axe.yml`, `nightly-backtest.yml`,
`refresh-data.yml`. There is **no** `PULL_REQUEST_TEMPLATE`, no `ISSUE_TEMPLATE/` directory, and no
checklist. `package.json` declares 35 scripts (`verify:logic`, `verify:indicators`, `verify:btc`,
`verify:integrity`, `verify:auth`, `validate:data`, `check:ci`, …) — **none** concerns vendor terms.
A tree-wide grep for `licen[cs]e|redistribut|terms of (use|service)|vendor terms` across
`__tests__/ tests/ lib/ app/ components/ vercel.json next.config.js vitest.config.ts
stryker.conf.mjs .github/ scripts/` returns exactly **four** hits, and none is a gate:

- `lib/data/bloomberg/bridgeClient.ts:5` — *"Redistribution: comply with your Bloomberg Terminal
  Agreement / Data License."* (a docstring line)
- `scripts/bloomberg-bridge-example.py:18` — *"Legal: You must comply with the Bloomberg Terminal
  Agreement and any Data License."* (an example script)
- `components/ComplianceBanner.tsx:32` and `app/ma-deviation/page.tsx:568` — both use "licensed" in
  the *advisory* sense ("a licensed entity", "a licensed financial advisor"), not data licensing.

So the only two vendor-licence statements in the entire tree are prose comments about Bloomberg, and
neither executes. This matters because the repo demonstrably *does* build invariant gates when it
wants to: `__tests__/architecture/findings-ledger-integrity.test.ts` and
`__tests__/architecture/synthetic-containment.test.ts` (both added in `0027886`) are executing
architecture-level tests for other invariants. None was built for I8.

**E8 — The requirement was in force and was not applied.** Ancestry verified with
`git merge-base --is-ancestor`: `047ae57` (2026-08-16, wrote I1–I8 into `CLAUDE.md`) **is an
ancestor of** `0027886`; `f7d369e` (2026-08-16, reframed Q-082 to "market data is consumed with NO
licence or account at all") **is also an ancestor of** `0027886`. `0027886` (PR #147, 2026-08-16)
then changed `app/stock/[ticker]/page.tsx` from `<NewsFeed news={news} …>` fed by
`getNewsForSector()` (mock) to `<NewsFeed ticker={ticker} …>` fed by
`/api/news/ticker/[ticker]` — i.e. it turned a synthetic surface into a **live Yahoo Finance
content surface for end users** (headline, publisher, outbound link). `git show 0027886 | grep -niE
"licen[cs]e|redistrib|terms of use|I8|Q-082"` returns only the pre-existing F4.5 ledger line
appearing on both sides of a whole-file re-sort of `findings-ledger.csv` — **no new licence finding
was recorded, and the accompanying `MEMORY_LOG.md` / `SESSION_STATE.json` entries in that commit do
not raise the question**.

The counter-argument, stated for fairness: `app/api/news/ticker/[ticker]/route.ts` and
`components/NewsFeed.tsx` both pre-date the requirement (added `de9a3d5`, June 2026), so one could
argue #147 wired an existing vendor surface rather than creating a new one. That argument does not
survive the diff — the stock page previously rendered *fabricated* news and now renders *vendor*
news, so vendor exposure strictly increased on that page. Even if a reviewer rejects leg 2 entirely,
leg 3 (live trigger condition, zero recorded findings) still holds and sub-tier (b) stays VIOLATED.
It does not reach PARTIAL under any reading, because no mechanism exists to name.

**E9 — Browser-direct vendor calls shift the relationship onto the end user.**
`components/crypto/hooks/useBtcCandles.ts:168-174` falls back to fetching CoinGecko **from the
user's browser**, and tells them so: *"Server API is unavailable in this region/network. Loaded OHLC
directly from CoinGecko in the browser."* `useBtcPriceWs.ts:113` does the same for the simple-price
endpoint, and `useBtcKlineWs.ts:7` / `useBtcPriceWs.ts:6` open Kraken and Coinbase WebSockets from
the browser. `middleware.ts:65` (`connect-src 'self' https: wss:`) permits all of this, so the path
is live rather than CSP-blocked. Under this path the request originates from the end user's IP
against vendor terms the user has never seen.

---

## WHAT I CHECKED

Commands actually run (paths relative to the worktree root):

1. `git log --oneline -8`, `git status --short`, `git show -s --format='%h %ad %s' --date=short 0027886 047ae57 f7d369e 18afde2`, `git show --stat 0027886`, `git merge-base --is-ancestor 047ae57 0027886`, `git merge-base --is-ancestor f7d369e 0027886`, `git log --diff-filter=A -- 'app/api/news/ticker/*' 'components/NewsFeed.tsx'`.
2. `package.json` dependency + devDependency enumeration (11 runtime deps; `yahoo-finance2 ^3.13.2` is the only market-data client).
3. Repo-wide external-host sweep: `grep -rnoE "https?://[a-zA-Z0-9._-]+" --include=*.ts --include=*.tsx --include=*.js --include=*.mjs --include=*.json --exclude-dir=node_modules --exclude-dir=.next` and a `wss://` sweep, then manual triage of every distinct host into "called" vs "cited in a docstring".
4. Vendor call sites: `grep -rnE "from 'yahoo-finance2|yahooFinance\.(quote|chart|search|historical|quoteSummary|options|screener|trendingSymbols)"` over `app/api lib scripts`.
5. Auth/exposure: full read of `middleware.ts`; `grep -rln "getServerSession|getToken|requireAuth|auth()" app/api`; `find app/api -name route.ts` (28 routes).
6. Credentials, **names only**: `grep -rhoE "process\.env\.[A-Z0-9_]+"` over `lib app scripts components middleware.ts`, sorted unique; `grep -oE "^[A-Z0-9_]+" .env.example`. No `.env` file was opened and no value was printed.
7. Recorded-finding search: `grep -rniE "licen[cs]e|terms of (use|service)|redistribut|attribution|ToS\b"` over `reviews docs workspace AGENTS.md README.md`; `grep -niE "yahoo|tos|licen|redistrib|vendor|compliance" reviews/findings-ledger.csv`; `grep -rniE "coingecko|kraken|coinbase|bybit|okx" reviews workspace docs` filtered for licence/terms wording.
8. Remediation verification: `grep -rn "YAHOO_RESEARCH_ONLY"`; `grep -rniE "non-?commercial|research use only|personal use"`; `grep -rniE "legal\.yahoo|policies\.yahoo|terms" --include=*.tsx components app`; full read of `components/ComplianceBanner.tsx`.
9. Process-gate search: `find .github -type f`; `ls .github/PULL_REQUEST_TEMPLATE* .github/ISSUE_TEMPLATE`; `grep -rniE "licen[cs]e|redistrib|vendor terms|tos" .github scripts`.
10. UI attribution sweep: `grep -rniE "yahoo|coingecko|kraken|coinbase|bybit|okx|fred|data (source|provided)|powered by" --include=*.tsx components app`, imports filtered out.
11. Legal-page search: `find app -maxdepth 2 -type d | grep -iE "legal|terms|disclaim|about|privacy"`.
12. `workspace/IMPROVEMENT_BACKLOG.json` → Q-082 entry read in full, including `notes_2026_08_16_REFRAMED`.
13. **Python surface** (added after the first pass, which had swept only `*.ts/tsx/js/mjs/json` and would have missed it): full read of `requirements.txt` and `Procfile`; `grep -rniE "yfinance|akshare|tushare|polygon|alphavantage|alpha_vantage|finnhub|iexcloud|quandl|tiingo|https?://…" --include=*.py`; `grep -rln "FastAPI|uvicorn" --include=*.py`; `grep -n "yfinance|akshare|@app\." ml/server.py server_options.py`; `grep -rn "garch/|/regime" --include=*.py`; wiring check `grep -rn "server_options|options/us/|options/asia/"` over `lib app components package.json Procfile`.
14. **Sidecar wiring:** `grep -rn "ML_SIDECAR_URL|QUANT_FRAMEWORK_URL|TRADING_AGENTS_BASE" --include=*.ts` over `lib app`; read of `lib/quant/garchClient.ts:78-100` to establish the request contract (ticker only → the sidecar sources its own data).
15. **Process-gate second pass:** `package.json` `scripts` block printed in full (35 entries); tree-wide `grep -rniE "licen[cs]e|redistribut|terms of (use|service)|vendor terms"` over `__tests__ tests lib app components vercel.json next.config.js vitest.config.ts stryker.conf.mjs`.

## WHAT WOULD HAVE SHOWN FAILURE (i.e. would have moved a rating)

- **Would have moved (b) to ENFORCED:** a CI job, test or runtime assertion that fails when a route
  serving vendor data has no corresponding licence record. Searched for in `.github/workflows/*`
  (all five read), the 35 `package.json` scripts, `scripts/`, and `__tests__/` — including
  `__tests__/architecture/`, where `findings-ledger-integrity.test.ts` and
  `synthetic-containment.test.ts` enforce *other* invariants (proof this repo builds
  architecture-level gates when it wants to, and that none was built for I8). None found.
- **Would have moved (b) to PARTIAL:** a PR template question, a documented pre-ship checklist, or
  even a per-route comment requiring the licence question. `.github` has no templates at all; the
  only licence prose in the tree is two non-executing Bloomberg comments (E7).
- **Would have moved (a) toward resolvable:** any of a vendor API-key env var name, a
  `LICENSE-DATA.md` / `docs/vendor-*.md`, a contract reference, an order form, or a written
  confirmation from a vendor. The env-name sweep (E3) and the docs/reviews sweep (E7) would each
  have surfaced these. Neither did.
- **Would have made the vendor table smaller:** if `gex.ts`/`marketHours.ts` hits had been `fetch`
  calls they would have been rows; reading their surrounding docstrings showed they are citations,
  and they were excluded.
- **Would have weakened E9:** a CSP `connect-src` restricted to `'self'` would have made the
  browser-direct CoinGecko/Kraken/Coinbase paths dead code. `middleware.ts:65` permits `https:` and
  `wss:` wholesale, so they are live.
- **Would have weakened E8:** a licence note in the #147 commit body, ledger, `MEMORY_LOG.md` or
  `SESSION_STATE.json` diff. The full-commit grep found none.

## BLIND SPOTS

1. **Repo-only.** A vendor entitlement could exist as a signed PDF, an email, or a Vercel
   environment variable not mirrored in `.env.example`. A key set in Vercel that no code reads would
   be inert for the *code* path, but a contract that exists off-repo would change (a) entirely.
   Owner must answer this from outside the repo.
2. **Vendor terms deliberately not fetched.** Q-082's reframe forbids closing this by reading a ToS
   and forming a view. No vendor's current terms were retrieved or interpreted here, so this
   document makes no claim about what any licence says.
3. **Runtime not observed.** Whether `BLOOMBERG_BRIDGE_URL` and `QUANTAN_FRED_PREWARM` are set in
   production is unknown from the repo; both paths are rated conditional for that reason. Likewise
   the browser-direct CoinGecko fallback (E9) is proven reachable by code + CSP but was not observed
   firing.
4. **No traffic/volume evidence.** Rate-limit or "commercial scale" arguments cannot be assessed
   from source.
5. **`yahoo-finance2`'s own package licence** (an OSS licence on the client library) was not
   examined; it is a separate question from the data terms and does not bear on redistribution of
   the *data*.
6. **Bloomberg bridge historical use.** Whether the bridge has ever been pointed at a live Terminal
   is not determinable from the repo.
7. **Python services: deployment status unknown.** `Procfile` declares three deployable Python
   processes, and `ml/server.py` + `server_options.py` consume `yfinance`/AKShare. Whether any is
   actually running, and whether `ML_SIDECAR_URL` / `QUANT_FRAMEWORK_URL` are set in production,
   cannot be seen from the repo — hence "conditional" in table B rather than a firm yes/no. The
   `/garch` and `/regime` endpoints that `lib/quant/*Client.ts` call have **no in-repo
   implementation** at all, so what such a sidecar would fetch is unknown.
8. **Table B was a second pass.** The first host sweep covered only `*.ts/tsx/js/mjs/json` and would
   have missed the entire Python surface; it was found and added only after an explicit `*.py` +
   `requirements.txt` sweep (WHAT I CHECKED #13). Any further surface in a language not swept
   (none observed — the repo has no Go/Rust/Java) would be missed the same way.

---

## FINDINGS NOT FIXED

Ledger-ready. Not written to `reviews/findings-ledger.csv` — this audit edits no other file.

| id | severity | file:line | one-line risk-register description |
|---|---|---|---|
| **Q079-I8-1** | **CRITICAL** | `app/api/prices/route.ts:131` + 12 sibling Yahoo call sites; `app/api/crypto/btc/route.ts:4,5,82`; `metrics/route.ts:6,7`; `liquidations/route.ts:7` | Six market-data vendors (Yahoo, CoinGecko, Kraken, Coinbase, Bybit, OKX) are consumed with no account, key or agreement visible in the repo (`.env.example` + `process.env` name sweep) and their data is served to end users through **unauthenticated** public API routes (`middleware.ts:119` performs no auth) and rendered in the UI; **no licence finding is recorded for any vendor anywhere in the repo**. I8 names this the business-ending class of risk. **Owner-gated:** the acceptability question requires external counsel; route with Q-082 + Q-083. |
| **Q079-I8-2** | **HIGH** | `.github/` (5 workflows, no templates); `git show 0027886` | I8's operative process gate does not exist anywhere (no PR template, CI check, checklist or test) **and** was demonstrably not applied on the most recent vendor-exposing ship: PR #147 (`0027886`) turned the stock-page news surface from synthetic to live Yahoo content one commit after I8 and the Q-082 reframe landed, recording no licence finding. Remediation: add a pre-ship licence question to a PR template plus an architecture test asserting every route that returns vendor data maps to a recorded finding. |
| **Q079-I8-3** | **HIGH** | `lib/data/bloomberg/bridgeClient.ts:65,75` → `app/api/prices/route.ts:4`; `README.md:57` | When `BLOOMBERG_BRIDGE_URL` is configured, Bloomberg Terminal-derived prices are merged into and **preferred by** the public unauthenticated `/api/prices` response with no licence gate; the repo's own `scripts/bloomberg-bridge-example.py:18` states the Terminal Agreement/Data Licence obligation, but nothing enforces it. Dormant until the env var is set — becomes CRITICAL the moment it is. **Owner-gated.** |
| **Q079-I8-4** | **MEDIUM** | `CLAUDE.md` I8 note; `workspace/IMPROVEMENT_BACKLOG.json` Q-082 `notes_2026_08_15` | Constitution map error: both assert the Yahoo redistribution position "has never been written down", but `reviews/findings-ledger.csv:42` (F4.5, HIGH, **open**), `:75` (F7.8), `reviews/R7-security-compliance.md:213` and `reviews/PHASE-14-REMEDIATION-ROADMAP.md:333` record it. What was recorded is an agent's risk assertion, not a licence confirmation, so I8 is still unmet — but the constitution understates how long this has been known and open. Fix the note; do not adopt the old ToS reading as a conclusion. |
| **Q079-I8-5** | **MEDIUM** | `reviews/findings-ledger.csv:42` vs `components/ComplianceBanner.tsx:35`; `reviews/PHASE-15-PLAN.md:44` | Compliance control that exists only on paper: acceptance test `AT-F4.5-compliance-banner` requires "non-commercial research use only" text, a Yahoo ToS link and a `YAHOO_RESEARCH_ONLY` kill flag; **none of the three exists anywhere in the tree**, while `PHASE-15-PLAN.md:44` records the banner as "present". Either implement the specified artifact or rewrite the acceptance test to what was actually shipped. |
| **Q079-I8-6** | **MEDIUM** | `requirements.txt:20-21`; `ml/server.py:14,52` → `lib/ml/client.ts:36` → `app/api/ml/[ticker]/route.ts`; `quant_framework/data_engine.py:37,63,96`; `options_asia.py:4`; `Procfile:1-3` | A whole second vendor surface exists in Python and is absent from every prior I8 discussion: `yfinance` (a second unofficial Yahoo client), **AKShare** and **Tushare**. The ML sidecar serves `yfinance`-derived predictions into the public unauthenticated `/api/ml/[ticker]`; `server_options.py` (AKShare, `Procfile:3`) is deployable but has no TypeScript caller. `TU_SHARE_TOKEN` (`quant_framework/data_engine.py:103`) is the only vendor credential name in the repo — on the one source the product cannot reach. Any I8 remediation scoped to `yahoo-finance2` alone will miss this. |
| **Q079-I8-7** | **LOW** | `components/crypto/hooks/useBtcCandles.ts:168-174`; `useBtcPriceWs.ts:6,113`; `useBtcKlineWs.ts:7`; permitted by `middleware.ts:65` | Browser-direct vendor fetches (CoinGecko REST, Kraken/Coinbase WebSocket) move the vendor-terms relationship onto the end user's IP and connection without disclosure; the UI copy even states "Loaded OHLC directly from CoinGecko in the browser". Decide deliberately: proxy server-side, or disclose. |

### Owner-gated decisions (explicit, not deferred)

1. **Obtain a legal view** on unlicensed consumption **and** redistribution to end users for the
   intended launch posture (retail tier especially). Owner + external counsel. Route with Q-082 and
   Q-083 — both turn on what the product shows users. No agent can close this.
2. **Decide the Bloomberg bridge posture** before the bridge is ever pointed at a live Terminal,
   given `/api/prices` is public (Q079-I8-3).
3. **Decide whether the process gate is worth building** (Q079-I8-2). Q079-I8-1 cannot be closed by
   engineering; Q079-I8-2 can, and is what stops the next feature shipping the same way.
