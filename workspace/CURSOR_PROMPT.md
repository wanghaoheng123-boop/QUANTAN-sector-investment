# Cursor Prompt — Continue QUANTAN Phase 15

> Paste everything below this line into Cursor's chat (Cmd+L / Cmd+I composer) as your opening message. The prompt is self-contained — Cursor will not see the prior Claude Code conversation.

---

You are Cursor working on **QUANTAN-sector-investment**, a Next.js 14 + TypeScript institutional trading platform. A Claude Code session just ended near its token limit. It authored the canonical Phase 15 plan and closed 14 of 50 backlog tasks. **You are picking up exactly where it left off.**

You have full ability to use:
- File reads/writes across the repo
- Multi-file edits via the Composer
- Codebase semantic search (`@codebase`)
- Terminal commands (running tests, typecheck, benchmark, lint)
- Reading and editing markdown/JSON/YAML/TS/TSX files
- Inline edits when the cursor is positioned at a relevant location

**Use all of these proactively.** Do not stop to ask permission for routine reads, greps, or running test commands. Stop only when (a) you need an irreversible decision from the user, (b) you cannot verify an acceptance criterion, or (c) you would otherwise break a hard rule below.

---

## STEP 1 — Onboard yourself (do this first, top to bottom)

Read these files in order. Don't skim; the sprint design depends on them:

1. **`workspace/HANDOFF.md`** — exit doc from the previous session (what landed, what's next, the lesson learned about regex character classes)
2. **`reviews/PHASE-15-PLAN.md`** — the canonical Phase 15 plan (593 lines: team tracks, 4 sprints, gates, risk register, reconciled workspace backlog at §11)
3. **`workspace/IMPROVEMENT_BACKLOG.json`** — 50 tasks (Q-001..Q-050). Filter for `status: "pending"` AND `phase15_sprint: "S1"` for your next task pool.
4. **`reviews/invariants-baseline.md`** — the floors you MUST NOT regress (re-baselined 2026-05-23)
5. **`workspace/FUTURE_IMPROVEMENT_PLAN.md`** — narrative snapshot of current code state
6. **`workspace/CLAUDE_CODE_INSTRUCTIONS.md`** — agent quick-start (shorter version of the same rules)
7. **`AGENT.md` + `AGENTS.md`** — repo boot rules

After reading, run:
```bash
cd .claude/worktrees/competent-wu-a84629   # this is the active worktree, NOT main
git branch --show-current                  # should print: fix/options-investigation
git status --short                         # 5 source files + 2 docs uncommitted from prior session
npm run typecheck                          # MUST be clean
npm run test                               # MUST be 798 passed / 48 files
npm run benchmark                          # MUST be aggregate WR ≥ 56.35%
```

If any of those four sanity checks fail, **STOP** and tell the user — don't keep working on a broken baseline.

---

## STEP 2 — Understand what's already done

The prior Claude Code session closed these 14 tasks in `workspace/IMPROVEMENT_BACKLOG.json`:

| Task | Pri | Why closed |
|---|---|---|
| Q-001 | P0 | CI workflow extended (typecheck + test + benchmark with WR floor 55.85% + smoke) |
| Q-002 | P1 | Portfolio backtest JSON already present (Phase 8 work) |
| Q-003 | P0 | F1.3 intraday stops already use `evaluateStopHit` primitive |
| Q-006 | P1 | `__tests__/options/chain.test.ts` already exists (wave 40-41) |
| Q-010 | P1 | Worktree merged via PR #16 (commit `7321b54`) |
| Q-011 | P1 | All 5 `lib/portfolio/*` files present (drift never landed on main) |
| Q-012 | P2 | Zero silent `.catch(() => {})` remaining (wave 35) |
| Q-013 | P2 | `SectorRotationPanel.tsx` already present |
| Q-014 | P1 | `reviews/invariants-baseline.md` re-baselined to 798 tests / 48 files |
| Q-023 | P1 | `lib/api/reliability.ts` spread-guards `details`; `app/api/prices/route.ts` uses `sanitizeError()` SSOT |
| Q-024 | P1 | `components/ComplianceBanner.tsx` already imported in `app/layout.tsx` |
| Q-026 | P0 | git drift resolved (all "deleted" files present on this worktree) |
| Q-029 | P2 | `next.config.js` `hostname:'**'` → 7-host allowlist |
| Q-033 | P2 | `SafeAuth.tsx` replaces removed `AuthNav.tsx` |
| Q-039-NEW | P0 | **FALSE POSITIVE — withdrawn.** See lesson below. |
| P15-NEW-7 | — | SSE close timers unified (single warn→close sequence) |

These 5 source files are **uncommitted** in the working tree (verified to typecheck + pass 798 tests + benchmark at 57.05% WR):

```
M .github/workflows/ci.yml
M app/api/prices/route.ts
M app/api/stream/[ticker]/route.ts
M lib/api/reliability.ts
M next.config.js
M reviews/invariants-baseline.md
?? reviews/PHASE-15-PLAN.md
```

**Do NOT commit them yourself.** When you have 2-3 more S1 tasks closed and a coherent PR boundary, ASK the user how they want to split commits.

---

## STEP 3 — Critical lesson from prior session (DO NOT REPEAT)

The previous agent flagged `lib/auth.ts:124` as a P0 critical security bug because the file appeared to contain `/[ -]/` (a regex that would reject "John Smith" while allowing `<script>`). **This was a false positive caused by the Read tool's rendering.**

The actual file bytes (verified with `od -c`) are `[\x00-\x1f\x7f]` — NUL through US plus DEL, the canonical OWASP control-char class. Live evaluation confirmed:
- `safeStringField('John Smith')` → `'John Smith'` ✓ accepted
- `safeStringField('user\x00name')` → `undefined` ✓ rejected

The Read tool rendered the non-printable bytes (0x00, 0x1f, 0x7f) as visual width that LOOKED like space-hyphen. The regex is correct.

**For any future security-sensitive predicate you investigate:**
1. Run `od -c <file> | grep <surrounding-context>` to see the actual bytes.
2. Write a tiny live-eval test that imports the function and exercises it with concrete inputs.
3. Don't re-type a regex from the displayed text into a REPL — you're testing a phantom regex you typed, not the file's actual bytes.

This lesson is logged in `reviews/PHASE-15-PLAN.md` §1, `workspace/HANDOFF.md` §"Lesson learned", and `workspace/IMPROVEMENT_BACKLOG.json` Q-039-NEW notes. Reference it if a future agent re-files the same false positive.

---

## STEP 4 — Your task loop

For each backlog task you pick up:

```
1. Pick task:
   - Open workspace/IMPROVEMENT_BACKLOG.json
   - Filter status: "pending" AND phase15_sprint: "S1" (or S2 once S1 is empty)
   - Pick highest priority (P0 → P1 → P2 → P3); break ties by listed order
   - Respect depends_on[]; skip if dependencies aren't done

2. Read context:
   - Read every path in task.files[] BEFORE editing
   - Read the corresponding row in reviews/findings-ledger.csv if there's a finding ID (Fx.y)
   - Read the corresponding section of reviews/PHASE-15-PLAN.md for the sprint's design intent

3. Implement:
   - Smallest diff that satisfies every acceptance_criterion
   - Cite the primary source in code comments (paper / book / RFC + page number) for any algorithmic change
   - Reference the task ID in the comment (e.g., `// Phase 15 Q-XXX: ...`)

4. Verify:
   - Run every command in task.verify_commands[]
   - Run `npm run typecheck` (always)
   - Run `npm run test` if you touched lib/ or app/api/
   - Run `npm run benchmark` if you touched lib/backtest/ or lib/quant/
   - DO NOT proceed if any of these regress

5. Log:
   - In workspace/IMPROVEMENT_BACKLOG.json, set the task object to:
       "status": "done",
       "completed_at": "2026-MM-DD",
       "phase15_sprint": null,
       "notes_2026_MM_DD": "Concrete evidence — file:line of change, test count delta, commands run"
   - Append a row to workspace/HANDOFF.md under the "Done in this session" table

6. Update plan if scope shifts:
   - If you discover a new finding mid-task, add a P15-NEW-XX row to IMPROVEMENT_BACKLOG.json
   - If a task spec is wrong (e.g., file moved), correct task.files[] and add a notes_ entry

7. Next task — back to step 1.
```

---

## STEP 5 — S1 priority queue (pick from here first)

Phase 15 Sprint S1 still has these tasks pending. Work them top to bottom:

### Q-015 — Ticker validation fuzz test (P1, 0.5 day) **[do first — self-contained]**

**Files:** `lib/api/sanitize.ts`, `__tests__/api/sanitize.fuzz.test.ts` (new file)

**Why:** `normalizeTicker` exists and is applied across 19 of 25 routes, but has no fuzz test. F7.3 acceptance test ID is `AT-F7.3-ticker-whitelist-fuzz`.

**Implementation:**
1. `npm install --save-dev fast-check` (verify it's not already there first)
2. Create `__tests__/api/sanitize.fuzz.test.ts`:
   - Property: for any random string `s` (length 0–50, any character class), `normalizeTicker(s)` either returns `null` OR returns a string matching `/^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/`.
   - Run 10,000 cases via `fc.assert(fc.property(fc.string(), s => { ... }))`.
   - Property: known-bad inputs (`'../etc/passwd'`, `'AAPL; DROP TABLE'`, `'%G1'`, etc.) all return null.
3. Verify: `npm run test -- __tests__/api/sanitize.fuzz.test.ts`

**Acceptance:** 10k+ random inputs do not crash and never return a non-whitelist-conforming string. Known-bad inputs all return null.

---

### Q-022 — Coverage gate in CI + broaden include[] (P1, 0.5 day)

**Files:** `vitest.config.ts`, `.github/workflows/ci.yml`

**Why:** Coverage thresholds are set in vitest.config but not enforced. The include[] excludes `lib/api`, `lib/data`, `lib/portfolio`, `lib/optimize`, `lib/ml`, `hooks` — untested code merges unchallenged.

**Implementation:**
1. Edit `vitest.config.ts` — expand `coverage.include[]`:
   ```ts
   include: [
     'lib/quant/**', 'lib/backtest/**', 'lib/qa/**', 'lib/options/**',
     'lib/api/**', 'lib/data/**', 'lib/portfolio/**', 'lib/optimize/**',
     'lib/ml/**', 'hooks/**',
   ],
   ```
2. Edit `.github/workflows/ci.yml` — add a `coverage` job that runs `npm run test:coverage` and fails if thresholds drop. The thresholds in vitest.config are already 80/70/80/80; let them gate.
3. Locally run `npm run test:coverage` to make sure the broader include[] doesn't immediately fail thresholds. If it does, document the gap in IMPROVEMENT_BACKLOG.json under a new Q-051-NEW task ("backfill coverage for newly-included dirs") and TEMPORARILY exclude the failing dirs in vitest.config with a `// TODO Q-051-NEW` comment — do NOT lower the threshold percentages.

**Acceptance:** `npm run test:coverage` exits 0 OR has a documented backfill task. CI coverage job runs.

---

### Q-040-NEW — CSP enforcing (P0, 2 days) **[complex — defer if not confident]**

**Files:** `next.config.js`, possibly new middleware at `middleware.ts`

**Why:** Currently `Content-Security-Policy-Report-Only` with `'unsafe-inline'` and `'unsafe-eval'` in `script-src`. Phase 14 §S2.9 design called for nonce-based enforcing CSP after 1 week of Report-Only with zero violations.

**Implementation gate:** Before starting, ask the user:
1. Is there a CSP report-collector set up? Has it shown zero violations for ≥ 7 days?
2. Are inline `<style>`/`<script>` blocks in `app/layout.tsx` or any page essential, or can they all be hoisted to module scripts/stylesheets?
3. Does the user prefer nonce-based or hash-based CSP?

If the user is uncertain, DEFER this task and pick Q-015 / Q-022 first. CSP changes that ship without monitoring can break production silently.

If proceeding:
1. Create `middleware.ts` at the project root that generates a per-request nonce via `crypto.randomBytes(16).toString('base64')` and injects it into a request header (`x-nonce`).
2. Edit `next.config.js` `SECURITY_HEADERS`:
   - Drop the `-Report-Only` suffix on the key
   - Replace `'unsafe-inline' 'unsafe-eval'` with `'nonce-${nonce}' 'strict-dynamic'`
   - Wire the nonce through `next/headers`
3. Audit every component for inline styles. Move them to CSS modules or add the nonce attribute.

**Acceptance:** Production build deploys with enforcing CSP; `curl -I` shows the new header; no console violations for 24h.

---

## STEP 6 — S2 preview (when S1 is empty)

After S1 closes, pick from these pending S2 tasks (in order):

| Task | Pri | Effort | Notes |
|---|---|---|---|
| Q-009 | P0 | 1d | Feature-flag enhanced benchmark path; current enhanced WR 52.63% (−3.72pp vs baseline) — must NOT ship as default |
| Q-005 | P0 | 1.5d | Vercel KV rate-limit (replace per-process Map in `lib/api/rateLimit.ts`) |
| Q-004 | P1 | 1.5d | FRED `getRiskFreeRate(tenorDays)` replacing hardcoded 0.045 + 0.0525. **Triggers WR baseline re-freeze** — coordinate with C2 (the user) |
| Q-021 | P1 | 1d | B&H dividend-aware in `lib/backtest/engine.ts` (Yahoo `historical()` dividends array). Also triggers re-freeze |
| Q-016 | P1 | 0.5d | `atrAdaptiveStop` excludes forming bar (`lib/backtest/exitRules.ts:80-82`) |
| Q-017 | P2 | 1d | `__tests__/data/warehouse.test.ts` — SQLite schema + insert + query |
| Q-018 | P2 | 1d | `__tests__/backtest/dataLoader.test.ts` |
| Q-050-NEW | P1 | 1d | Crypto WS primary + REST fallback in `app/crypto/btc/page.tsx` |
| Q-041-NEW | P0 | 4d | GARCH(1,1) Python sidecar (`quant_framework/garch.py` + new API route) — needs Python env |

When Q-004 and Q-021 both land, run benchmark and message the user to confirm the new WR floor before continuing.

---

## STEP 7 — Hard rules (do not violate)

| Rule | Why |
|---|---|
| **No commits or pushes** unless the user explicitly says so | Owner controls main |
| **Never push to main** | Production deploys from main |
| **Do not read or edit `.env*` files** | Secrets policy |
| **Do not regress `npm run benchmark` aggregate WR below 56.55%** (50 bps tol below 56.35% floor) | Auto-block once Q-001's CI gate is on origin |
| **Do not regress `npm run test` below 798 passed / 48 files** | Invariants floor |
| **Do not regress `npm run typecheck` from clean** | Standing requirement |
| **Do not re-introduce `hostname: '**'`** in `next.config.js` `remotePatterns` | Q-029 closed an SSRF amplification vector |
| **Do not add new `any` casts without a `// reason:` comment** + plan a follow-up to remove | 5-site cap documented in invariants |
| **Do not add `.catch(() => {})`** anywhere in `lib/`, `app/`, `components/` | Floor of 0 |
| **Do not add new `setInterval` in pages with SSE** unless explicitly required | Phase 15 P15-NEW-3/8 trying to remove the surviving ones |
| **Do not re-type regex predicates from Read output to "verify" them** | See STEP 3 lesson — use `od -c` + live eval |
| **Do not invent finding IDs** — use existing F1.x–F8.x ledger entries or P15-NEW-XX | Traceability rule |
| **Do not amend `reviews/PHASE-14-*.md`** | Historical audit trail, read-only |
| **Do not bypass `lib/api/sanitize.ts:normalizeTicker`** in new routes | F7.3 standing rule |
| **Do not bypass `sanitizeError()` from `lib/api/sanitize.ts`** in route error responses | F7.2 / Q-023 just landed |
| **Do not use `JSON.stringify(...)` for cache busting** in `useEffect` deps | F5.1-class drift; use stable-shape memos instead |
| **Do not introduce new circular imports** | madge floor of 0 |
| **No emojis in code files** unless the user explicitly requests | Repo convention |
| **No documentation files in lib/** unless the user asks | Repo convention |

---

## STEP 8 — Verify-after-every-task command sequence

After every task, in this order:

```bash
# 1. Type cleanly
npm run typecheck          # MUST be clean

# 2. Tests must not regress
npm run test               # MUST be ≥ 798 / 48 files

# 3. Benchmark must not regress (only if you touched lib/backtest or lib/quant)
npm run benchmark          # WR must stay ≥ 56.55% (pre-FRED floor)

# 4. Specific test for the task (if applicable)
npm run test -- <relevant-test-file>

# 5. Smoke verify (only after Q-001's CI gate goes live for the first time)
npm run check:smoke:local
```

If you're touching JSON config (vitest.config.ts, next.config.js, ci.yml):
```bash
# YAML / JSON sanity
node --check next.config.js                            # for JS configs
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"  # for YAML
python3 -c "import json; json.load(open('workspace/IMPROVEMENT_BACKLOG.json'))"  # for JSON
```

If you're working on Python (quant_framework/) for GARCH/HMM:
```bash
cd quant_framework && python -m pytest
```

---

## STEP 9 — Output format inside Cursor chat

For each task you work on, structure your output like this:

```
## Task: Q-XXX (Pri) — <one-line title>

### Plan
- File 1: <what changes>
- File 2: <what changes>
- New file: <what it contains>

### Implementation
[code diffs]

### Verification
$ npm run typecheck
[output]

$ npm run test -- <relevant>
[output: X passed / Y failed]

$ npm run benchmark (if applicable)
[Aggregate Win Rate: XX.XX%]

### Result
✅ Closed Q-XXX. Updated IMPROVEMENT_BACKLOG.json with status=done.
Next: Q-YYY.
```

Don't dump full file contents in chat — show diffs only. Don't paste 100-line test outputs — show the pass/fail summary.

---

## STEP 10 — Handoff loop (do this before your context fills)

Cursor's chat context is finite. Before you hit your limit:

1. Update `workspace/HANDOFF.md`:
   - Add a "Done in this session" row for every task you closed (with the same table structure as the existing entries)
   - Update the "Final state snapshot" section (git status, test count, WR, backlog counts)
   - Update the "Next steps" section with what should come next

2. Make sure `workspace/IMPROVEMENT_BACKLOG.json` reflects every task's true status

3. Tell the user: "I've closed [N] tasks. Working tree is at [WR]% WR / [T] tests. The next task is Q-YYY. Should I commit, or hand off?"

4. If the user says "hand off", write your final HANDOFF.md and wait. Don't keep working past explicit handoff.

---

## STEP 11 — When you're blocked

Stop and ask the user when you hit any of these:

- A task spec is internally inconsistent (e.g., acceptance criterion impossible to verify)
- A change would require touching files outside the task's declared `files[]` list
- An external account/service is needed (Polygon API key, Vercel KV, FRED API key, OpenAI key)
- A benchmark WR change is between 55.85% and 56.35% (soft-fail band — needs C2 sign-off)
- A test count drops vs the floor (someone else may have deleted a test legitimately, but the rule needs to be acknowledged)
- A library upgrade is needed (Next 14 → 15, React 18 → 19, etc.)
- A breaking API change is needed (route signatures, contract types in `lib/data/providers/types.ts`)
- The user has open questions from the Phase 15 plan §9 (Polygon plan tier, Vercel KV vs Upstash, GARCH cadence, HMM training frequency)

Open questions from the plan (resolve before S2 starts):
1. Polygon plan? $199/mo Stocks-Currencies-Indices-Equities — confirm tier
2. Vercel KV via Vercel Pro upgrade, or Upstash direct?
3. GARCH compute on-demand (Lambda) or daily cron writing to KV?
4. HMM retrain weekly on trailing 5y, or monthly?
5. Component test infra: add `@testing-library/react` (~5MB devDep)?
6. axe-core: vitest-jsdom or Playwright? (Recommend Playwright)

---

## STEP 12 — Specific helpers in this codebase

These exist and you should use them (not re-implement):

| Need | Use |
|---|---|
| Format a number | `lib/format.ts` — `safeFixed`, `formatCurrency`, `formatPercent`, `formatCompactNumber`, `formatSignedNumber`, `toIsoDate` |
| Parse a quote timestamp | `lib/format.ts` — `parseQuoteTime` |
| Render YYYY-MM-DD from possibly-string-date | `lib/format.ts` — `toIsoDate` (handles JSON-deserialized Date strings) |
| Indicator math | `lib/quant/indicators.ts` (canonical SSOT) — `ema`, `rsi`, `macd`, `bollinger`, `atr`, `adx`, `obv`, `vwap`, `stochRsi`, `sharpeRatio`, `sortinoRatio` |
| Sanitize ticker | `lib/api/sanitize.ts` — `normalizeTicker(raw): string | null` |
| Sanitize error | `lib/api/sanitize.ts` — `sanitizeError(err): string | undefined` |
| Coerce number-or-zero | `lib/api/sanitize.ts` — `num(v): number` |
| Rate limit a route | `lib/api/rateLimit.ts` — `applyRateLimit(req, name, config)` returns `Response | null` |
| Retry with backoff | `lib/api/reliability.ts` — `withRetry(fn, opts)` (exponential + full jitter) |
| Timeout a promise | `lib/api/reliability.ts` — `withTimeout(p, ms)` |
| API error response | `lib/api/reliability.ts` — `errorResponse(code, message, details?, status?)` (use sanitizeError for details) |
| API degraded response | `lib/api/reliability.ts` — `degradedResponse(code, message, details?, status=200)` |
| Tooltip with glossary | `components/MetricTooltip.tsx` + `lib/metricGlossary.ts` (add new metrics to glossary first) |
| Error UX | `hooks/useErrorToast.ts` + `components/ErrorToastList.tsx` |
| Live single-ticker quote | `hooks/useLiveQuote.ts` (SSE EventSource lifecycle) |
| Live multi-ticker quotes | `hooks/useLiveQuotes.ts` (SSE fan-out, max 20 streams) |
| Dialog a11y | `hooks/useDialogA11y.ts` (focus trap + return focus + body lock) |
| Chart error boundary | `components/ChartErrorBoundary.tsx` |
| Sector colors | `lib/sectorColors.ts` (sole SSOT — do not inline) |

If you're tempted to write a helper that does any of the above, search first with `@codebase` — it almost certainly exists.

---

## STEP 13 — Repository structure cheat-sheet

```
.claude/worktrees/competent-wu-a84629/   ← you ARE here (cwd)
├── .github/workflows/ci.yml             ← Q-001 just expanded
├── app/                                 ← Next.js App Router
│   ├── api/*/route.ts                   ← 25 routes
│   ├── stock/[ticker]/page.tsx          ← uses useLiveQuote
│   ├── sector/[slug]/page.tsx
│   ├── crypto/btc/page.tsx              ← 806 LOC, Q-050-NEW WS-primary
│   ├── backtest/page.tsx                ← 887 LOC, Q-019 decompose
│   └── layout.tsx                       ← ComplianceBanner imported
├── components/
│   ├── stock/QuantLabPanel.tsx          ← 1684 LOC, Q-008 decompose (S3)
│   ├── KLineChart.tsx                   ← 1014 LOC, S3 plugin registry
│   ├── options/{Flow,Gex,MaxPain,OptionsChain}*.tsx
│   ├── ChartErrorBoundary.tsx
│   ├── ComplianceBanner.tsx
│   └── SafeAuth.tsx                     ← replaces removed AuthNav
├── hooks/                               ← 6 hooks; see helpers list above
├── lib/
│   ├── auth.ts                          ← regex correct (verified od -c)
│   ├── backtest/
│   │   ├── engine.ts                    ← 807 LOC, P15-NEW-10 extract walkForward
│   │   ├── signals.ts                   ← 681 LOC, enhancedCombinedSignal (Q-009 flag)
│   │   ├── portfolioBacktest.ts         ← 604 LOC, imports from scripts/ (Q-031)
│   │   ├── exitRules.ts                 ← Q-016 forming-bar
│   │   └── dataLoader.ts                ← Q-018 add tests
│   ├── quant/
│   │   ├── indicators.ts                ← SSOT (667 LOC)
│   │   ├── technicals.ts                ← Q-032 legacy rsi/sharpe — migrate
│   │   └── constants.ts                 ← Q-004 FRED RFR (hardcoded 0.045, 0.0525)
│   ├── options/{chain,greeks,gex,sentiment,flow}.ts
│   ├── api/{sanitize,rateLimit,reliability,marketHours}.ts
│   ├── data/
│   │   ├── warehouse.ts                 ← Q-017 add tests
│   │   ├── mergeQuotes.ts
│   │   ├── bloomberg/bridgeClient.ts    ← Q-037 timing-safe
│   │   └── providers/{yahoo,polygon,fred,alphavantage,index,types}.ts
│   ├── portfolio/{tracker,var,riskParity,diversification,stressTest}.ts
│   ├── optimize/{gridSearch,parameterSets,sectorProfiles}.ts
│   ├── ml/client.ts                     ← Q-030 add tests
│   ├── format.ts                        ← safeFixed, toIsoDate, formatPercent…
│   └── metricGlossary.ts
├── __tests__/                           ← 48 files / 798 tests
│   ├── api/{rateLimit,sanitize,marketHours,reliability}.test.ts
│   ├── backtest/{engine,signals,exitRules,portfolioBacktest}.test.ts
│   ├── options/{chain,greeks,gex,sentiment,flow}.test.ts
│   ├── quant/                           ← indicators, kelly, dcf, var, …
│   └── format/, security/, qa/, portfolio/, hooks/
├── scripts/
│   ├── benchmark-signals.mjs            ← canonical benchmark (WR floor)
│   ├── benchmark-enhanced.ts            ← Q-009: 52.63% (−3.72pp)
│   ├── portfolio-backtest.ts            ← results JSON present
│   ├── optimize-grid.ts                 ← Q-034 doc Loop 1 results
│   └── verify-*.mjs                     ← npm run verify:data
├── reviews/
│   ├── PHASE-15-PLAN.md                 ← canonical plan (untracked, new)
│   ├── PHASE-14-CRITIQUE-LOG.md         ← read-only history
│   ├── PHASE-14-REMEDIATION-ROADMAP.md  ← read-only history
│   ├── findings-ledger.csv              ← 90 rows F1.x–F8.x
│   └── invariants-baseline.md           ← floors (Q-014 just rebaselined)
├── workspace/
│   ├── HANDOFF.md                       ← prior session exit doc
│   ├── IMPROVEMENT_BACKLOG.json         ← 50 tasks (14 done)
│   ├── FUTURE_IMPROVEMENT_PLAN.md       ← 05-23 sync'd snapshot
│   ├── CLAUDE_CODE_INSTRUCTIONS.md      ← shorter agent quick-start
│   └── CURSOR_PROMPT.md                 ← this file
├── quant_framework/                     ← Python sidecar (for Q-041, Q-042)
├── AGENT.md, AGENTS.md                  ← repo boot rules
├── package.json
├── vitest.config.ts                     ← Q-022 expand include[]
└── next.config.js                       ← Q-029 closed, Q-040-NEW open
```

---

## STEP 14 — Final acceptance for handing back to the user

Before you tell the user "I'm done for this session," confirm:

1. Every task you marked `status: done` has:
   - Real evidence in the `notes_2026_MM_DD` field
   - Files modified that match the `files[]` field
   - All `verify_commands` actually run and passed
2. `npm run typecheck` clean
3. `npm run test` ≥ 798 passed
4. `npm run benchmark` aggregate WR ≥ 56.55% (or post-FRED rebaselined floor if Q-004 + Q-021 landed in your session)
5. `workspace/HANDOFF.md` updated with what you did + what's next
6. No `.env*` files modified
7. No commits, no pushes
8. No new `setInterval` in pages that already use SSE
9. No new `any` casts without `// reason:` comment
10. No silent `.catch(() => {})`

Tell the user:
- What tasks closed (with IDs)
- New benchmark WR + test count + LOC stats if relevant
- What's the next pending S1/S2 task you'd pick up
- Any blocker that needs their decision

---

## You may now begin.

Start with STEP 1. After reading the canonical docs, propose your task plan for the session in chat (don't start editing yet — wait for the user to confirm or adjust the order). Then execute.

Your first message in chat should be:

> I've read the handoff and canonical plan. Working tree state: [your git status output]. Tests: [output]. Benchmark WR: [output]. Proposed task plan for this session: Q-015 (fuzz test), Q-022 (coverage gate). After those, S2: Q-005 (Vercel KV — gated on your account decision), Q-004 (FRED RFR — triggers WR re-freeze), Q-021 (B&H dividends). Should I proceed with Q-015 first, or do you want a different order?
