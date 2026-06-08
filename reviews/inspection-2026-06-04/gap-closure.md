# Coverage Gap-Closure — 2026-06-04 (coordinator, inline, read-only)

Closes the gaps the master report §0 honestly flagged as not-yet-covered. No code touched.

## A. The 8 previously-PENDING API routes → ALL CLEAN ✅
Audited `conditional-vol/[ticker]`, `darkpool/[ticker]`, `ml/[ticker]`, `news/[sector]`,
`news/ticker/[ticker]`, `prices`, `regime/[ticker]`, `search`. **Every one** uses the
established hardening stack:
- `sanitizeError` on all error envelopes (no raw upstream text reaches the client).
- `applyRateLimit` (the correct KV-aware helper — not the dead sync `checkRateLimit`).
- strict `normalizeTicker` on every ticker route (F7.3 whitelist).
- explicit `Cache-Control` headers with TTLs matched to data freshness.
- `prices` additionally caps `MAX_TICKERS_PER_REQUEST` (fan-out DoS guard) + dual
  `Cache-Control`/`CDN-Cache-Control`. `search` returns a static `'search_unavailable'`
  (no error echo). `ml` + `news/ticker` carry doc-comments citing their F7.3/Q-023 remediation.

**Conclusion:** This is strong confirming evidence that **api-backend P0-B (liquidations raw
error leak) is genuinely the LONE route bypassing `sanitizeError`** — all 30 routes are now
accounted for and only that one leaks. No new P0/P1 in these 8.

**Systemic minor (P1, known class):** `conditional-vol`, `darkpool`, `ml`, `regime` run
`applyRateLimit` BEFORE `normalizeTicker` — so invalid-ticker probes burn a rate token before
being rejected. Same low-severity pattern the API agent flagged for `/api/stream` (P1-2); it's
systemic across ticker routes, not unique. Tokens are cheap and the regex blocks injection →
stays P1/P2. Optional hardening: validate ticker first, return 400 without consuming a token.

## B. Test-infra confirmations (resolves test-coverage.md "flagged for confirmation")
- **Stryker mutation scope** = `lib/quant/**`, `lib/backtest/**`, `lib/options/**`. The
  high-value math IS mutation-tested (break@70). **Gap:** `lib/portfolio/**` is NOT in the
  mutate glob → `factorAttribution.ts`, `tracker.ts`, `greeks.ts`, `riskParity.ts` get line
  coverage but no mutation testing. Worth adding `lib/portfolio/**`.
- **Coverage thresholds** are **GLOBAL** (lines/funcs/stmts 80, branches 70) over a curated
  `include` list, not per-file. So the theoretical "a 0%-covered critical file hides behind
  well-covered trivial ones" risk is real but bounded by the curated include set. Low.

## C. Python trees → coherent offline/separate-service tier, NOT in the Vercel request path
Inventory: root `*.py` ~2200 LOC (`alpha_miner` 579, `options_asia` 472, `options_us` 318,
`server_trading_agents` 407 [reviewed], `server_options` 232, `options_cross_market` 192);
`quant_framework/` 1408; `multi_agent_factor_mining/` 1154 (HAS tests +`ApiKeyGuard`); `ml/` 500.
- **The TS app never spawns Python via subprocess** (`grep child_process/spawn/exec .py` empty).
  Live Python = the **HTTP sidecars only** (`server_trading_agents.py`, reviewed leak-safe). The
  options data path reaches the **Bloomberg bridge** (`BLOOMBERG_BRIDGE_URL` /
  `lib/data/bloomberg/bridgeClient.ts`), NOT `server_options.py`.
- **Security posture is reassuring:** the heavy research Python is unreachable from a web request.
- `server_options.py` (FastAPI :3003): CORS `allow_origins=["*"]` but `allow_credentials=False`
  → acceptable for a public read-only data service. No `eval`/`subprocess`/`os.system`.
- **No hardcoded secrets** anywhere in Python (root + all trees). Closes the earlier TS-only scan.

## D. ⚠️ NEW FINDING — escapable sandboxed `eval()` on formula strings (P1, offline)
- `alpha_miner.py:275` — `eval(formula_template, {"__builtins__": {}}, namespace)`
- `multi_agent_factor_mining/agents.py:103` — `eval(formula, {"__builtins__": {}}, namespace)`

The `{"__builtins__": {}}` guard strips builtins but is a **well-known-escapable** CPython
sandbox: an attacker-controlled `formula` can traverse
`().__class__.__bases__[0].__subclasses__()` to reach `os`/`subprocess` → RCE.
- **Live risk: LOW** — both are offline research scripts; no web-request input reaches them.
- **But the source is semi-trusted:** `multi_agent_factor_mining` uses an **LLM to GENERATE the
  factor formulas** that get `eval`'d. A prompt-injected / adversarial factor expression from
  the model is a plausible (if not internet-facing) RCE path on the researcher's machine.
- **Recommend:** replace with an AST-restricted evaluator — `ast.parse` + a node-allowlist
  walker, or `numexpr`/`asteval`. Do NOT rely on `{"__builtins__": {}}`.

## E. `src/` → non-issue
`src/` contains a single `src/example.py` stub. Not the legacy TS dir the structure agent
hypothesized; nothing to clean.

## Net effect on the master report
- No change to the **2 live-prod P0s**. P0-B's "lone outlier" framing now fully evidenced (30/30).
- One **new P1** (D: escapable eval in offline research Python) — added to the master backlog.
- Two confirmations (stryker scope, coverage-global) and a clean bill on the Python security
  surface (no secrets, no web-reachable eval, no subprocess bridge).
