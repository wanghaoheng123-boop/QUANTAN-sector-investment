# Full Inspection 2026-06-30 — Review Agent B (API / SECURITY)

Baseline: main @ 2f2507a. READ-ONLY verification pass. Scope: app/api/ (27 route.ts),
middleware.ts, lib/auth.ts, lib/api/. Coordinator ratifies; this file is raw proposed
findings + verdicts, written incrementally.

Gates (coordinator-run, not re-run here): tsc clean; npm audit 14 vulns (5 high, 0 crit) =
known build-chain/PWA advisory, owner-deferred.

27 route.ts confirmed under app/api/.

---

## Known-item verdicts (in progress)

### F7.2 (HIGH, lib/api/reliability.ts) — PRIORITY verdict: **stale-superseded → recommend DOWNGRADE/CLOSE**
- Ledger row cites `reliability.ts:50` "error responses leak internals". Current source line 50
  is `const sleep = opts.sleep ?? defaultSleep` (inside `withRetry`) — NOT an error builder; the
  ledger line ref is stale.
- The actual error builders `buildErrorBody`/`degradedResponse`/`errorResponse` (lib/api/reliability.ts:97-127)
  now (a) omit `details` entirely when falsy via spread-guard (`...(details ? { details } : {})`, line 104),
  and (b) carry a doc-block (lines 83-96) instructing callers to pass `sanitizeError(e)`, not raw `error.message`.
- VERIFIED all 3 callers of `errorResponse` pass sanitized details:
  - app/api/fundamentals/[ticker]/route.ts:165 → `sanitizeError(e)`
  - app/api/prices/route.ts:200 → `sanitizeError(error)`
  - app/api/analytics/[ticker]/route.ts:126 → `sanitizeError(e)`
  - `degradedResponse` has zero external callers (grep).
- **VERDICT: still-real? NO. The CWE-209 leak the row describes is fixed (sanitized + key-omit). LIVE path
  (all 3 callers are live routes) but the defect is REMEDIATED. Recommend ledger status open→FIXED/CLOSED;
  the lingering "open HIGH" is stale bookkeeping, not a live exposure. Supervisor's stale/superseded suspicion CONFIRMED.**

### B-1 (briefId.ts) — re-confirm: FIXED holds
- lib/api/briefId.ts:23-25 `newsBriefId` = `Buffer.from(link,'utf8').toString('base64url')` — full-link base64url
  bijection, no truncation. Matches ledger "FIXED PR #72". CONFIRMED.

### Fresh surface: app/api/backtest/live/route.ts (NEW) — full pass
- Auth: GET-only, no mutation → no CSRF needed (CSRF guards mutating verbs only). CONFORMS to siblings.
- Rate-limit: applyRateLimit(...'backtest-live',{60/60s}) at :54. PRESENT.
- Ticker-validation: strictNormalizeTicker per token + MAX_FILTER_TICKERS=100 cap (:66-72). PRESENT.
- sanitizeError: route has NO try/catch / no throw-to-wire path (pure local JSON, no upstream). Functions
  return null on bad data; no raw error reaches client. N/A but SAFE.
- Cache-Control: `s-maxage=60, stale-while-revalidate=120` on both cache-hit (:79) and fresh (:124). PRESENT.
- Filtered-vs-unfiltered cache poisoning guard (:77,:121) correct. CLEAN — parity with /api/backtest.

### Fresh surface: app/api/backtest/route.ts — pass
- GET: rate-limit 30/60s (:126), normalizeTicker+cap (:133-139), in-flight coalesce guard (:155),
  Cache-Control s-maxage=3600 (:144), catch→sanitizeError + key-omit (:166-170). CLEAN.
- POST: validateCsrf (:178) → 403 on fail, rate-limit 3/60s (:181), catch→sanitizeError (:194). CLEAN.

---

## Security primitives — source-verified

### sanitize.ts (TICKER_REGEX / normalizeTicker / sanitizeError)
- TICKER_REGEX `/^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/` (sanitize.ts:35) — rejects URL/path/
  control chars; only `^`, A-Z, 0-9, `.`, `=`, single `-suffix`. F7.3 (CWE-918 ticker-whitelist) INTACT.
- normalizeTicker (:47-63) catches malformed decodeURIComponent → null (no 500 leak). INTACT.
- sanitizeError (:82-86): returns `undefined` in production. CWE-209 INTACT. (Note: this means in prod the
  `details` key is ALWAYS omitted from error envelopes → reinforces F7.2-is-moot.)

### csrf.ts (double-submit) — F7.4 INTACT
- validateCsrf (:22-27) compares `x-quantan-csrf` header to `quantan_csrf` cookie; both-missing → false.
- Issued by middleware.ts:75-95 (SameSite=Strict, Secure in prod, set-if-missing). Pair complete.
- Minor (NOT a finding): `header === cookie` is non-constant-time, but token is 128-bit CSPRNG and there is
  no timing oracle on a same-origin double-submit compare — standard/acceptable per OWASP CSRF cheatsheet.

### rateLimit.ts — F4.3 atomic SET-NX INTACT; F-A1-3 LIVE confirmed
- Atomic window: `SET <key> 1 EX <window> NX` (rateLimit.ts:92-95); INCR only on existing key (:104). INTACT.
- F-A1-3 (LOW): self-heal `EXPIRE…NX` gated on `count===1` (:108-118), `.catch(()=>{})` swallows failure (:117).
  STILL PRESENT exactly as ledger row describes. VERDICT: still-real-LIVE (all API routes via applyRateLimit).
  Narrow conjunction (key expired in SET-NX→INCR gap AND heal fetch fails) → unchanged. No regression, no escalation.

### OWASP headers (next.config.js) — F7.6 INTACT
- HSTS 2y+preload, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy
  strict-origin-when-cross-origin, Permissions-Policy (camera/mic/geo/cohort off), CSP-Report-Only
  (next.config.js:20-56). All present on `/:path*`. INTACT.
- BONUS: images.remotePatterns explicit allowlist (no `hostname:'**'`) — SSRF-amplification guard (Q-029) intact (:81-89).

### A6-1 (CSP-nonce) — VERDICT: still-real-DORMANT (flag off). LANDMINE confirmed; do NOT flip.
- middleware.ts:55 enforced CSP only when `QUANTAN_CSP_ENFORCE==='1'` (default OFF). Live policy = Report-Only.
- Enforced policy `script-src 'self' 'nonce-${nonce}'` has NO 'unsafe-inline' (:60); nonce set on request
  header x-nonce (:50) but [x-nonce consumer check below]. Flipping flag → blocks Next inline bootstrap. UNCHANGED.

- x-nonce consumers repo-wide: **ZERO** (grep app/components/lib/hooks — NONE). Propagation gap confirmed →
  flipping QUANTAN_CSP_ENFORCE=1 would block Next inline scripts. Stay dormant.

### lib/auth.ts — F7.1 / F7.9 INTACT; auth.ts:124 false-positive RE-CONFIRMED
- auth.ts:124 real bytes (Python repr) = `/[\x00-\x1f\x7f]/` (control chars), NOT `/[ -]/` (Read-tool artifact).
  safeStringField rejects control chars only — does NOT reject all names. Documented FP holds; no bug.
- F7.1: missing NEXTAUTH_SECRET → console.error structured critical event (:55-67). INTACT.
- F7.9: JWT callback validates name/email/image via safeStringField (len-cap + ctrl-char) + safeUrlField
  (http(s)-only, absolute) (:83-135). INTACT.

---

## sanitizeError coverage — ALL 27 routes (CWE-209 sweep)

Every route that returns an error envelope either routes raw error through `sanitizeError`
(undefined in prod), returns a static generic code, or only logs to console. **No raw error /
stack / path reaches the wire on any route.** Per-route:

| Route | Error-to-wire handling | Verdict |
|---|---|---|
| analytics/[ticker] | errorResponse + sanitizeError (:126) | SANITIZED |
| auth/[...nextauth] | NextAuth-managed; no custom error body | N/A |
| backtest/live | no throw-to-wire (local JSON) | SAFE |
| backtest | sanitizeError + key-omit GET:166 POST:194 | SANITIZED |
| bloomberg-bridge/health | (see note) | SAFE |
| briefs/[sector] | err→console.warn only; static 404 msg | SAFE |
| briefs | sanitizeError (:227) | SANITIZED |
| chart/[ticker] | sanitizeError details (:258) | SANITIZED |
| conditional-vol/[ticker] | sanitizeError details (:49) | SANITIZED |
| crypto/btc/liquidations | sanitizeError (:60,:150) — prior LONE bypass, FIXED | SANITIZED |
| crypto/btc/metrics | sanitizeError (:124) | SANITIZED |
| crypto/btc/quote | sanitizeError (:56) | SANITIZED |
| crypto/btc | err→console.warn only; static btc_data_unavailable | SAFE |
| darkpool/[ticker] | sanitizeError (:280) | SANITIZED |
| fundamentals/[ticker] | errorResponse + sanitizeError (:165) | SANITIZED |
| ma-deviation | sanitizeError (:125) | SANITIZED |
| ml/[ticker] | sanitizeError details (:58) | SANITIZED |
| news/[sector] | sanitizeError (:143); per-fetch err→console.warn | SANITIZED |
| news/ticker/[ticker] | sanitizeError (:78) | SANITIZED |
| options/[ticker] | sanitizeError (:93) | SANITIZED |
| prices | errorResponse + sanitizeError (:200) | SANITIZED |
| regime/[ticker] | sanitizeError details (:50) | SANITIZED |
| search | err→console.error only; static search_unavailable | SAFE |
| sector-rotation | sanitizeError details (:103) | SANITIZED |
| stream/[ticker] | err→console.warn, returns null; SSE carries data only | SAFE |
| trading-agents/[ticker] | sanitizeError (:143,:150,:391,:398); upstream details gated isDev→undef in prod (:351-353) | SANITIZED |
| trading-agents/health | sanitizeError (:80) | SANITIZED |

**CWE-209 coverage: CONFIRMED-INTACT across all 27 routes.** The prior LONE bypass
(crypto/btc/liquidations) is fixed and now uses sanitizeError (:60,:150). No regression.

---

## SECURITY POSTURE CHECKLIST

| Primitive | Status | Evidence |
|---|---|---|
| CSRF (double-submit cookie) | **CONFIRMED-INTACT** | validateCsrf header==cookie (csrf.ts:22-27) + middleware issues quantan_csrf SameSite=Strict/Secure-in-prod set-if-missing (middleware.ts:75-95). Mutating routes enforce: backtest POST (:178), trading-agents POST (:180). |
| OWASP security headers | **CONFIRMED-INTACT** | SECURITY_HEADERS: HSTS 2y+preload, X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP-Report-Only (next.config.js:20-56). + image remotePatterns allowlist (no `**`, SSRF guard). |
| ticker-whitelist / SSRF | **CONFIRMED-INTACT** | TICKER_REGEX `/^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/` (sanitize.ts:35) rejects URL/path/ctrl chars; normalizeTicker null-on-invalid incl. malformed URI (:47-63). Image-proxy SSRF allowlist (next.config.js:81-89). |
| sanitizeError coverage (all routes) | **CONFIRMED-INTACT** | All 27 routes sanitize / static-code / log-only — see coverage table. sanitizeError→undefined in prod (sanitize.ts:82-86). Prior lone bypass fixed. |
| rate-limit atomicity | **CONFIRMED-INTACT** | SET <key> 1 EX <window> NX atomic window (rateLimit.ts:92-95), INCR only on existing (:104), memory fallback on KV error. F-A1-3 self-heal narrow edge LIVE but unchanged (not a regression). |

**No REGRESSIONS detected in any security primitive.**

---

## KNOWN-ITEM VERDICT SUMMARY

| id | sev | verdict | file:line |
|---|---|---|---|
| F7.2 | HIGH | **stale-superseded** — CWE-209 fixed (sanitized+key-omit); recommend open→CLOSED | reliability.ts:97-127; callers fundamentals:165/prices:200/analytics:126 |
| F7.8 | MED | still-real-open (Yahoo ToS compliance banner; cross-ref F4.5) — non-code licensing item, unchanged | (every yahoo route) |
| F7.5 | MED | NOT YET READ — see note below | bridgeClient.ts |
| A6-1 | MED | **still-real-DORMANT** (flag off; zero x-nonce consumers) — do NOT flip | middleware.ts:55-70 + next.config.js:43 |
| F-A1-3 | LOW | **still-real-LIVE** (unchanged) | rateLimit.ts:108-118 |
| A4-1 | LOW | NOT YET READ — see note below | briefs/[sector]:180-181 |
| A3-L3 | LOW | NOT YET READ — see note below | chart/[ticker]:64 |
| WSA-FG | LOW | NOT YET READ — see note below | regime/conditional-vol/stream/chart |

---

## Remaining LOW/MED known-item verdicts (source-verified)

### F7.5 (MED, lib/data/bloomberg/bridgeClient.ts) — VERDICT: timing-safe IS implemented; DORMANT app-side
- `bridgeSecretMatches` (bridgeClient.ts:17-27) uses `crypto.timingSafeEqual` with a length guard
  (returns false on length mismatch — avoids the throw). Correct timing-safe compare.
- NUANCE: the QUANTAN Next app only SENDS the secret as `X-Bridge-Secret` header (:86, :177); it never
  COMPARES inbound. `bridgeSecretMatches` is exported for the (separate-process) bridge SERVER to consume
  on its inbound auth. So the compare is correct but DORMANT within this repo's request path (no app-side caller).
- VERDICT: still-real but the security control IS in place and correct; the "need verify" is discharged.
  Recommend ledger note: timing-safe helper present & correct; consumed by external bridge server (dormant here).

### A4-1 (LOW, briefs/[sector]:180-181) — VERDICT: still-real-LIVE (display-only, always-null)
- :180 `safeNum(q?.regularVolume)` — wrong Yahoo key (should be regularMarketVolume) → volume always null.
- :181 `safeNum(...averageDailyVolume)` — wrong key (should be averageDailyVolume3Month) → always null.
- STILL PRESENT verbatim. Display-only sector-brief field; no signal/published-metric path. Unchanged.

### A3-L3 (LOW, chart/[ticker]:64) — VERDICT: still-real-LIVE (perf-header only)
- Cached-hit branch (:64) sets only `Cache-Control`; the fresh branches (:121-122, :247-248) set BOTH
  `Cache-Control` AND `CDN-Cache-Control`. So cached responses lose the CDN directive. STILL PRESENT.
  No correctness/security impact. Unchanged.

### WSA-FG (LOW, boundary finite-guards) — VERDICT: still-real-LIVE (defense-in-depth)
- conditional-vol/[ticker]:41 returns `result` (garchClient forecast JSON) verbatim — no finiteOrNull mirror.
- regime/[ticker] same pattern (fetchHmmRegime sidecar JSON passed through). STILL PRESENT.
- LOW: first-party sidecars, sanitized data has 0 non-finite, no user-controlled trigger. Unchanged.

---

## NEW findings (Agent B)

**NEW-B-1 (INFO/positive, app/api/trading-agents/[ticker]/route.ts + lib/auth/apiKey.ts) — NOT a defect.**
The one route with custom auth is well-secured: `isValidApiKey` (apiKey.ts:25-43) is fail-closed (rejects
when QUANTAN_API_KEY unset) and constant-time (SHA-256 fixed-width digests → timingSafeEqual, :36-38).
Route gates session-OR-valid-API-key (:192-196), CSRF-bypass only for valid API key (:178), POST validates
provider/api_key body. No finding — recorded as a positive confirmation of the auth surface.

**No new defects found.** All proposed candidates reconciled to existing ledger ids or confirmed-clean.

---

## FINAL VERDICT TABLE (all assigned known items)

| id | sev | VERDICT | LIVE/DORMANT | file:line |
|---|---|---|---|---|
| F7.2 | HIGH | **stale-superseded** (CWE-209 remediated; recommend CLOSE) | LIVE path, defect gone | reliability.ts:97-127 |
| F7.8 | MED | still-real-open (Yahoo ToS banner; non-code) | LIVE | every yahoo route |
| F7.5 | MED | timing-safe correct & present (verify discharged) | DORMANT app-side | bridgeClient.ts:17-27 |
| A6-1 | MED | **still-real-DORMANT** — do NOT flip QUANTAN_CSP_ENFORCE | DORMANT (flag off) | middleware.ts:55-70 |
| F-A1-3 | LOW | **still-real** (unchanged) | LIVE | rateLimit.ts:108-118 |
| A4-1 | LOW | **still-real** (display-only always-null) | LIVE | briefs/[sector]:180-181 |
| A3-L3 | LOW | **still-real** (CDN header on cached branch) | LIVE | chart/[ticker]:64 |
| WSA-FG | LOW | **still-real** (boundary finite-guard) | LIVE | conditional-vol:41 / regime |

POSTURE: CSRF / OWASP-headers / ticker-whitelist-SSRF / sanitizeError(27/27) / rate-limit-atomicity
= all CONFIRMED-INTACT. No regressions. Only fresh-surface (backtest, backtest/live, briefs, briefId,
rateLimit) reviewed in full = CLEAN. F7.2 priority verdict = stale/superseded (supervisor suspicion confirmed).

---

## Advisor follow-ups (closing gaps)

### Fresh surface: app/api/briefs/route.ts (BASE file — full pass)
- GET-only, no mutation → no CSRF needed. CONFORMS.
- Rate-limit: applyRateLimit('briefs',{6/60s}) at :130 — tight, mitigates 33-call yahoo fan-out. PRESENT.
- Param validation: sectors come from a fixed internal SECTOR_QUERY_MAP (:24-36), NOT user input → no SSRF/injection.
- CWE-209: the inner catch at :112 (fetchNewsForTicker) only `console.warn`s and returns partial `results` —
  NO error reaches the wire (advisor-flagged path CONFIRMED SAFE). Outer catch :224 → sanitizeError (:227). SANITIZED.
- BONUS security: `isSafeHttpUrl(link)` (:87) rejects non-http(s) news links before they reach the client.
- B-1 fix live here: `newsBriefId(link)` (:98). Cache-Control degraded-aware (:218-220). CLEAN.

### CSRF completeness — claim now PROVEN (not sampled)
- Full enumeration of mutating handlers across all 27 routes:
  `grep -rnE "export (async function|const) (POST|PUT|PATCH|DELETE)" app/api` →
  EXACTLY TWO: app/api/backtest/route.ts:177 (POST) and app/api/trading-agents/[ticker]/route.ts:156 (POST).
- Both gated: backtest POST → validateCsrf (:178); trading-agents POST → isValidApiKey OR validateCsrf (:178).
- No third mutating route exists. CSRF coverage = 2/2 mutating handlers. CONFIRMED-INTACT (exhaustive).

### WSA-FG scope honesty
- Verdict "still-real-LIVE" was spot-checked on 2 of 4 sub-parts (regime + conditional-vol verbatim
  passthrough); the garch log(0) and chart-volume-filter sub-parts were NOT independently re-checked this pass.
  Verdict scope = those 2 sub-parts; remaining 2 carried from prior ledger as-is.
