# Program Day — 2026-06-28 (manual Opus-4.8 run)

Run context: **manual** ("Continue"). Scheduled fires still 400-fail on the gated Fable 5
model (owner UI fix pending). Cell run this day: **A6** (WS-A — the last WS-A cell).

Boot/reconcile: local == origin/main == `2452ddc`; 0 open PRs; clean tree.

---

## A6 — `middleware.ts` + `lib/api/csrf.ts` + `lib/api/sanitize.ts` + `lib/auth.ts` — DONE, VERIFIED CLEAN (no code change) ← **WS-A COMPLETE (A1–A6)**

Security-primitives cell. Reviewed line-by-line + source-verified the two known traps.

**Watch items — all clear:**
- **CSRF** (`lib/api/csrf.ts` + middleware) — double-submit cookie. `validateCsrf` requires
  header AND cookie present and equal (`header === cookie`). The non-constant-time compare is
  fine here: OWASP double-submit doesn't need constant-time (the token isn't a
  timing-guessable secret; a cross-origin attacker can read neither the cookie nor set the
  custom header). Middleware issues the cookie **only when missing** (re-issuing would
  invalidate in-flight tokens), `HttpOnly:false` (the client must read it for the pattern),
  `SameSite:Strict`, `Secure` in prod, 24h — matches the live prod `Set-Cookie` exactly.
- **TICKER_REGEX** (`/^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/`) — solid F7.3
  whitelist: no URL/SSRF metacharacters (no `/ : ? # @ &`), bounded length (~27),
  `decodeURIComponent`-then-validate with malformed-escape → null. The crypto-pair suffix is
  tightly scoped. Clean.
- **auth name regex (auth.ts:124)** — **CONFIRMED `/[\x00-\x1f\x7f]/`** via hexdump /
  Python `repr()` (char codes 0x00, 0x1f, 0x7f). This is a **control-char class** — the
  documented CURSOR STEP-3 **FALSE POSITIVE** ("regex rejects all names"); the Read tool
  renders the control bytes as `/[ -]/` but the real bytes reject null bytes / control chars,
  not real names. **Correctly reconciled — NOT re-flagged.**
- **auth.ts more** — `safeUrlField` is https-only (rejects `javascript:`/`data:`/relative →
  XSS-safe avatars); JWT field bounds (email 254 / name 200 / picture 1000, F7.9) intact;
  `getSecret()` per-instance random fallback is documented (F7.1) + owner-env territory
  (NEXTAUTH_SECRET) — deliberate, not a code bug.
- **Headers** — full OWASP `SECURITY_HEADERS` in next.config.js (HSTS 2y preload,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy,
  Permissions-Policy, CSP **Report-Only**) — confirmed live in prod headers.

### Escalated — A6-1 (MEDIUM, dormant; LANDMINE on the owner ENV-CSP flip)
The CSP-nonce mechanism (Q-040-NEW, self-labelled "partial") is **incomplete scaffolding**:
- `x-nonce` has **zero consumers** repo-wide (grep app/components/lib/hooks — nothing reads it).
- When `QUANTAN_CSP_ENFORCE=1`, the middleware sets an **enforced** `Content-Security-Policy`
  of `script-src 'self' 'nonce-{X}'` (no `unsafe-inline`) **on the response only**.

Next.js App Router always emits inline bootstrap/hydration scripts (which is exactly why the
Report-Only policy carries `'unsafe-inline'`). With **no nonce propagation** to those scripts
(no `x-nonce` reader; the nonce'd CSP isn't on the *request* headers, which is how Next
propagates a nonce per its App-Router CSP pattern), **flipping `QUANTAN_CSP_ENFORCE=1` would
block Next's own inline scripts → blank/broken app.** The break is **overdetermined**
(enforced nonce-only + provably-zero propagation) regardless of the exact Next mechanism.

- **Today: dormant** (flag off → zero live impact; live CSP is Report-Only, app fine).
- **Disposition (owner — A5-DORMANCY-shaped, but lean COMPLETE not delete):** the
  Report-Only→enforce plan shows intent to ship strict CSP, so the likely path is **finish
  the nonce path** (consume `x-nonce` in the root layout to nonce Next's scripts, and/or set
  the nonce'd CSP on the **request** headers) — with **remove the dead nonce scaffolding** as
  the fallback if abandoning strict CSP.
- **Linkage (the value):** attach to the existing **"ENV-CSP flip (7-day Report-Only →
  enforce)"** backlog item — *do NOT flip `QUANTAN_CSP_ENFORCE=1` until the nonce path is
  completed.* A6-1 says that exact planned next step breaks prod as currently coded.
- **Validation (no prod touch):** set `QUANTAN_CSP_ENFORCE=1` on a **preview** deploy and
  load with the console open → CSP violations on Next's inline scripts confirm the break.

→ ledger `A6-1`.

**Minor (not ledgered):** the auth.ts:124 comment says it stops "RTL overrides," but
`/[\x00-\x1f\x7f]/` only catches ASCII control chars — Unicode bidi overrides (U+202E) aren't
in that range. Harmless (the name is bounds-checked + React-escaped); comment slightly
overstates. One line here is the right weight.

**VERIFY A–F:** A (correctness) — 4 files reviewed line-by-line + 2 source-verifications
(hexdump auth:124, next.config CSP, x-nonce consumers). B — existing tests (csrf/sanitize/
auth) cover the primitives; no code change → no new test. C/D — n/a (read-only). E (records)
— queue A6→done + WS-A COMPLETE + run-log; ledger A6-1; this report; MEMORY_LOG; SESSION_STATE.
F — read-only, no NaN/leak. **No PR — tracking-only.**

---

## P1 (WS-P) — backtest engine + data-load hot path — PROFILED → NOT HOT → NO ACTION

First WS-P cell. Profiled the backtest hot path with a measurement-first discipline.

**The O(n²) patterns are real:**
- `core.ts` `backtestInstrument` loop does **3× `.slice(0, i+1)` per bar** (`lookbackCloses`,
  `lookbackBars`, `lookbackOhlcv`) — growing-prefix copies, O(n²) total. `lookbackOhlcv` is
  even **dead in the production path** (the live, enhanced-OFF `resolveBacktestSignal` never
  reads `ohlcvBars`; only the dormant `enhancedCombinedSignal` does).
- The live `resolveBacktestSignal` recomputes `rsi(closes)` (full array, only `.at(-1)` used),
  `regimeSignal` (sma200 over `closes`), and `detectRegime(closes, bars)` over the full slice
  **every bar** — O(n²), where ATR already shows the correct precompute-once pattern.

**But the measurement settles it:** the **entire 56-instrument benchmark runs in 26s wall /
5.24s user CPU** (~90 ms/instrument). At 1255 bars the O(n²) is immaterial and nobody waits on
this path. The only O(n)→ win would require refactoring the **published-WR SSOT**
(`signals.ts`/`regimeSignal.ts`/`regimeDetection.ts`) — and the risk of a subtle parity break
changing the WR (a §4b DENY) is wildly out of proportion to an unmeasurable gain.

**Outcome: NO ACTION — not shipped, and deliberately NOT escalated.** Escalating a
low-value/high-risk optimization of the WR path would plant a landmine inviting a future
contributor to break the WR for nothing (the *opposite* of A6-1, which was a real break on a
*planned* action). The dead `lookbackOhlcv` slice is noted here, not acted on — it feeds a
5-second benchmark.

- **Baseline recorded** (for any future parity gate, should history length ever grow
  materially): **gross WR 56.54% / net 55.53%** (floor 53.29), benchmark `26s / 5.24s CPU`.
  The `scripts/benchmark-results.json` the run regenerated was reverted (CI regenerates it).
- **Lesson:** in a perf workstream, **"no change needed" is the modal-correct result**; measure
  before optimizing; "do not stop" means move through cells, not manufacture diffs for motion.

Next: **P2** — per-tick EMA recompute on the live WebSocket (KL-6), which is frontend and off
the WR path → genuinely higher-value and lower-stakes than P1.

## P2 (WS-P) — per-tick EMA recompute (KL-6) — SAFE FIX SHIPPED (PR #74, `47275f1`, prod ✓)

The advisor flagged P2 as the genuine WS-P win over P1 (frontend, lower-stakes, measurably
wasteful) — confirmed.

**The waste:** `useKLineChart`'s data effect has `candles` in its deps, so it re-runs on
**every live WebSocket tick**, and its EMA loop unconditionally did `calcEMA` + `setData` for
**all ~20 EMA periods** (`lib/chartEma.ts`). The default is 4 visible (9/20/50/200), so **~16
hidden series** got a full per-tick recompute + lightweight-charts series reprocess for lines
the user can't see. (Unlike volSma/vwap/bollingerBands, the EMA loop had no visibility gate.)

**The fix:** gate the EMA loop with `isEmaLineVisible(indicatorsProp, p)` — the **same
predicate** used at series creation (`:421`) and by the component's visibility sync
(`KLineChart.tsx:237`), exactly mirroring the existing volSma/vwap/bb gating.
**Behavior-preserving:** a visible EMA always gets data (the effect re-runs on tick via
`candles` *and* on toggle via `indicatorsProp`/`visSerialised`); a hidden EMA is skipped, and
nothing reads its data (the crosshair tooltip is candle-only); toggling a series ON re-runs the
effect so it gets its data then.

- **Verify:** `tsc --noEmit` clean; `KLineChart.test.tsx` **9/9** (+1 new KL-6 test: a hidden
  EMA skips `setData`, a visible one pushes data; the existing KL-3 visibility tests still pass
  → behavior preserved). The jsdom test ran locally (warm cache, 1.5s) *and* in CI. Off the WR
  path → benchmark-neutral; `useKLineChart.ts` is coverage-excluded.
- **Ship:** PR #74 → main `47275f1`, all 6 CI gates green, **prod smoke PASS** (analytics/AAPL
  200, deploy healthy). SAFE behavior-preserving perf optimization with an output-parity test
  (§4a/§6.5) → auto-merged. ledger `KL-6` → FIXED.

Next: **P3** (chart render — series churn / visibility gating in `useKLineChart`).

## P3 + P4 (WS-P) — PROFILED → defer → WS-P pass COMPLETE (no code change)

**P3 (chart render):** confirmed **no per-tick series churn** — all `add*Series` live in the
init effect (its deps exclude `candles`; the `.remove()` calls are in its unmount cleanup), so
series are created once and persist; the per-tick data effect only `setData`s. Visibility
gating is now **complete** (volSma/vwap/bb/rsi/macd/atr were already gated; EMA fixed in P2).
The one remaining lever is incremental `series.update(lastPoint)` vs full `setData(lineData)`
per tick for *visible* indicators — parity-safe in principle for causal indicators, but a
larger refactor across every indicator render path with a subtler parity surface (update-bar
vs new-bar) and only a marginal gain now that P2 removed the ~16 hidden series. **Deferred**
(non-WR-path → not a landmine; documented for a future focused PR, not force-escalated).

**P4 (bundle):** the dominant code-split is **already in place** — `lightweight-charts` (the
heaviest dep) is loaded via `await import('lightweight-charts')` (`useKLineChart.ts:318`); its
only static import is `import type {…}` (`:14-26`, erased at build), so the runtime chart code
is not in the initial bundle. Chart-heavy routes use `next/dynamic`; PWA/workbox is configured
(`@ducanh2912/next-pwa` + runtimeCaching). A deeper bundle-size pass needs `@next/bundle-analyzer`
(not installed) + a production `next build` — build tooling, heavy/FUSE-risky — with no obvious
quick safe win. **Deferred.**

**WS-P pass complete:** P1 no-action (not hot) · **P2 KL-6 shipped** · P3 defer · P4 defer.
The one shippable, measurable, behavior-preserving win in the whole workstream was P2 — which
is the correct shape for a perf pass (measure first; "no change needed" is the modal result).
Next workstream: **WS-F** (frontend/UX & a11y).

## Program status — WS-A COMPLETE

- **WS-Q COMPLETE** (Q01–Q27), **WS-PY COMPLETE** (PY1–PY4), **WS-A COMPLETE** (A1–A6).
- **Next workstream: WS-P (performance)** — P1 = backtest engine + data-load hot path
  (per-bar allocation, repeated SMA/EMA recompute); then P2 (per-tick signal compute /
  KL-6), P3 (chart render), P4 (bundle size). After WS-P: **WS-F** (frontend/a11y).
- The 3 API workstreams shipped 2 prod fixes (A4/B-1 briefs id collision PR #72; A5
  provider-layer deletion PR #73) and verified the rest clean; live security posture
  (CSRF, OWASP headers, SSRF ticker whitelist, CWE-209 sanitize, auth field bounds)
  confirmed sound.
- **Owner-gated:** **A6-1 CSP-flip landmine** (do NOT flip `QUANTAN_CSP_ENFORCE=1` until the
  nonce path is finished/validated); plus the standing backlog (F-4/F-9/F-2/F-11/F-3,
  Q05-1/Q09-1/Q25-1, A4-1; scheduled-task model → Opus 4.8; Monday weekly deep sweep).
