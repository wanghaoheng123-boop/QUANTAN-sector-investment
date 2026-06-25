# Program Day — 2026-06-25 (manual Opus-4.8 run)

Run context: **manual** interactive session (owner: "continue with the project and
discover more gaps in the algorithms; check progress and proceed"). Scheduled fires
still 400-fail on the gated Fable 5 model (owner UI fix pending — see
`autonomous_program_fable_stall` memory). Cell run this day: **A4** (WS-A).

Boot/reconcile: local == origin/main == `dc2c870`; 0 open PRs to reconcile; clean tree.

---

## A4 — `app/api/[trading-agents|ml|briefs|news|fundamentals|options]/*` (WS-A) — DONE, merged (PR #72, `6ea4293`, prod ✓)

**Reviewed all 8 route handlers** (trading-agents GET + POST, ml/[ticker], briefs,
briefs/[sector], news/[sector], news/ticker/[ticker], fundamentals/[ticker],
options/[ticker]). Every route is well-hardened:
- `applyRateLimit` on all (6–30 req/min by cost), `sanitizeError` everywhere (CWE-209
  closed — no raw upstream/traceback leak), `normalizeTicker` SSRF guard on every
  ticker path param, `isSafeHttpUrl` link-XSS guard on all news links, `Promise.allSettled`
  fan-out (briefs/[sector] + news), `withTimeout` per-call caps (briefs), CSRF + valid
  X-API-Key gate on the trading-agents POST.
- **B-2 (seeded watch, "unbounded TA params") = already fixed:** `clampRound` bounds
  `max_debate_rounds`/`max_risk_discuss_rounds` to 1–5 and the *upstreamBody* uses the
  clamped `mdr`/`mrd` (not the raw body), so a hostile body can't bypass the clamp
  (route.ts:285-315).

### B-1 — news-brief id collision (CONFIRMED REAL → FIXED, SAFE)
`/api/briefs` derived `id: Buffer.from(link).toString('base64').slice(0, 16)`. base64
encodes the input in independent 3-byte groups, so the first 16 base64 chars encode
**exactly the first 12 bytes** of the link (12 B = 96 bits = 16 chars, clean boundary).
Every Yahoo Finance news link shares a 12-byte prefix — `"https://fina"` for
`finance.yahoo.com/…`, `"https://www."` for the rest — so the truncated id **collapsed
to one value per domain**. The client renders briefs with `key={brief.id}`
(`app/briefs/page.tsx:75`) → duplicate React keys → dropped / mis-keyed cards + console
error. Live on `/briefs`.

**Fix:** extracted `newsBriefId(link)` → `lib/api/briefId.ts`, encoding the **full**
link with `base64url`. base64url is a bijection over the input bytes, so distinct links
(already deduped by `link` in the route) always get distinct ids; same link → same id.
The id is only a React key (never persisted / shown) → length irrelevant; **no
response-schema change** (id stays a string).

**VERIFY A–F:**
- **A (correctness):** line-by-line review of all 8 routes; B-1 root-caused + fixed.
- **B (tests):** `+__tests__/api/briefId.test.ts` (5 cases) — proves the OLD truncation
  collides on shared-prefix Yahoo links, the new helper gives distinct ids, stability,
  base64url round-trip, URL-safe alphabet. **5/5 pass.** `tsc --noEmit` clean.
- **C/D (secrets):** none in diff.
- **E (records):** queue A4→done + run-log; ledger B-1 (fixed) + A4-1 (new); this report;
  MEMORY_LOG row; SESSION_STATE.
- **F (no NaN/leak):** id is a pure string transform; benchmark-neutral (no
  signal/backtest path touched — full CI benchmark stayed green on the merge commit).

**Ship:** branch `auto/wsa-a4-briefs-id-2026-06-25` → PR #72 → **merged to main
`6ea4293`** (SAFE, all 6 CI gates green: typecheck·test·coverage·benchmark·smoke·Vercel).
**Prod deploy READY** (`dpl_ErZfA7nD…`, quantan.vercel.app). **Prod smoke PASS:**
`/api/sector-rotation` 200 (11 sectors), `/api/analytics/AAPL` 200 (winRate 53.2%, β 0.90),
`/api/briefs` 200 (correct schema; briefs array transiently empty — Yahoo returned no
news that minute; the empty path never enters the id loop, so it cannot be caused by this
change). Security headers (X-Frame-Options DENY, nosniff, HSTS, Referrer/Permissions-Policy,
CSP-report-only) + CSRF cookie confirmed live.

### Escalated — A4-1 (LOW, display-only)
`briefs/[sector]/route.ts:180-181` reads two ETF-quote fields under the **wrong Yahoo
names**, so they are always `null`: `volume = safeNum(q?.regularVolume)` (the
yahoo-finance2 `Quote` type has `regularMarketVolume`, quote.d.ts:234 — not
`regularVolume`); `avgVolume = safeNum(q?.averageDailyVolume)` (type has
`averageDailyVolume3Month`:275 / `averageDailyVolume10Day`:277 — not `averageDailyVolume`).
Hidden from tsc by the `(q as Record<string, unknown>)` casts. Display-only (no
signal/published-metric path); `avgVolume` is partly masked by the `?? avgVolume10d`
fallback (which correctly reads `keyStats.averageDailyVolume10Day`). **Verified against
the installed yahoo-finance2 types** before logging (not asserted blind). Fix =
`regularMarketVolume` + `averageDailyVolume3Month`. → ledger `A4-1`.

---

## Program status

- **WS-Q COMPLETE** (Q01–Q27), **WS-PY COMPLETE** (PY1–PY4), **WS-A** A1–A4 done (next **A5**).
- The remaining *true algorithm* gaps are all escalated + **owner-gated** because they
  change published numbers / are methodology decisions: F-2 (mixed-window alpha,
  engine.ts), F-4 (gross→net WR), F-8 (MTM one bar early), F-9 (entry-slippage
  double-count), F-11 (union-calendar holdDays), Q25-1 (BTC `sqrt(252)` conditional vol),
  plus the dormant-enhanced-path items (Q09-1, Q14-1). None are auto-mergeable under §4b.
- Still owner-only: re-point the scheduled-task model to Opus 4.8 (root cause of the
  06-16+ scheduled-fire stall); the Monday weekly deep sweep remains due.
