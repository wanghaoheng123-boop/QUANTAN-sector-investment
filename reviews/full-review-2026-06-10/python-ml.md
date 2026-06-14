# Python/ML Tier Review — 2026-06-10

- Reviewer: Claude (senior Python quant/ML reviewer, sub-agent)
- Base commit: `6945e34` (main)
- Context: Python tier is OFFLINE / separate-service — NOT in the Vercel request path (confirmed 2026-06-04, reviews/inspection-2026-06-04/gap-closure.md). Live-risk severity calibrated accordingly.

## Scope

| Area | Files |
|---|---|
| P1 | `quant_framework/garch.py` (precise dead-code diagnosis; fix spec for coordinator) |
| P2 | Restricted-AST evaluator: `alpha_miner.py`, `multi_agent_factor_mining/agents.py` (escape-vector audit) |
| P3 | `server_trading_agents.py` (contextvars, _ApiKeyEnvGuard, _failures TTL, async blocking, secrets) |
| P4 | `server_options.py` (CORS, validation, error paths) |
| Rest | `quant_framework/**` (analysis, backtest, data_engine, deploy, regime_hmm, strategy, test_analytics), `multi_agent_factor_mining/**` (config, factor_library, server), `options_*.py` as touched, `requirements.txt`, Python tests |

Severity scale: P0 (critical even offline) / P1 (serious correctness or security) / P2 (moderate) / P3 (minor/hygiene). Each finding carries confidence.

---

## Findings

(appended incrementally below)

### 1. PRIORITY 1 — `quant_framework/garch.py` precise diagnosis

**File is 32 lines; read end-to-end. The 2026-06-04 finding is CONFIRMED in current source.**

#### (a) Exact TypeError site and swallowing except — [P1, confidence: HIGH — empirically verified]

- **TypeError site: `quant_framework/garch.py:21`** — `ann = float(vol) * np.sqrt(252)`.
  - Line 20 computes `vol = forecast.variance.values[-1] ** 0.5 / scale`. For `arch`'s `res.forecast(horizon=20)`, `forecast.variance` is a DataFrame of shape `(1, horizon)` (or `(nobs, horizon)` with `reindex=True`); `.values[-1]` is therefore a **1-D ndarray of length `horizon` (=20)**, not a scalar.
  - `float()` on a size-20 ndarray raises `TypeError`. Verified on the repo's numpy floor (requirements pin `numpy>=1.26`; tested 2.4.4): `TypeError: only 0-dimensional arrays can be converted to Python scalars`. (On numpy 1.26 the message is "only length-1 arrays…"; the exception type is identical.) Only `horizon=1` would dodge it; the default is 20 and the TS contract expects 20 steps.
  - So the failure fires **after** `am.fit()` succeeds — the MLE work is done, then discarded.
- **Swallowing except: `quant_framework/garch.py:23-24`** — `except Exception: pass`. It exists to catch `ImportError` (arch not installed) but also silently eats the line-21 `TypeError`, plus any arch convergence error, with no logging. Control then falls through to the EWMA block (lines 26-32).
- **Net effect:** `fit_garch11` returns `method: "ewma_proxy"` **always**, even with `arch` installed and a converged fit. The `"garch11_mle"` branch (line 22) is dead code.

#### (b) Minimal correct fix (spec — see "garch.py fix spec" section at end for the implementable version)

Vectorize instead of scalarizing: take the per-step variance row, sqrt, rescale, annualize element-wise, and emit one dict per step. This simultaneously fixes a latent second bug: the current line 21-22 (even if `float()` had worked) would have broadcast a **single** vol to all 20 steps, throwing away the GARCH term structure (mean reversion toward unconditional vol) — the entire point of MLE over EWMA, and explicitly the promise in `lib/quant/garchClient.ts:26-29` ("real GARCH(1,1) MLE … will produce a decaying forecast"). Also: narrow the exception handling — `ImportError` handled separately (expected fallback), everything else logged before falling back.

#### (c) Is `arch` in requirements? — **NO** [P2, confidence: HIGH]

`requirements.txt` (the only requirements file in the repo; no `requirements-*.txt` variants) lists numpy/pandas/scipy/fastapi/etc. but **not `arch`** (`requirements.txt:1-33`). So even after the code fix, every deployment from requirements.txt will take the EWMA path via `ImportError`. The fix must add `arch>=6.0` (or similar) to requirements.txt for the MLE branch to ever be live. Note `arch` is also not installed in the local dev environment.

#### (d) Other dead paths in the same file / adjacent module

- `garch.py` itself contains no other branches — lines 1-32 are the single function; the only dead path is the MLE branch above.
- **`quant_framework/regime_hmm.py` does NOT use hmmlearn at all** — it is an honest, self-described "stub" (`regime_hmm.py:1`) implementing a momentum/vol-ratio rule (lines 11-27). No try/except, no dead code, no hmmlearn import — nothing silently failing. It is mislabeled "HMM" in name only [P3, hygiene].
- **Wiring-level dead code [P2, confidence: HIGH]:** No Python service exposes `fit_garch11` or `detect_regime` over HTTP. The TS clients (`lib/quant/garchClient.ts:69` → `GET {QUANT_FRAMEWORK_URL}/garch/{ticker}`; `lib/quant/regimeHmmClient.ts:54` → `/regime/{ticker}`) expect a sidecar, but the three Procfile services (`server_trading_agents.py`, `multi_agent_factor_mining/server.py`, `server_options.py`) expose only `/health`, `/analyze/*`, `/mine-factors`, `/library*`, `/options/*` — no `/garch`, no `/regime`. `quant_framework/deploy.py` is exchange-connectivity stubs, not an HTTP server. So `fit_garch11` is **doubly dead**: (1) MLE branch unreachable due to the TypeError, (2) the function itself is only reachable from `quant_framework/test_analytics.py`. `QUANT_FRAMEWORK_URL` is commented out in `.env.example:53`, consistent with "sidecar not yet built." The coordinator should decide whether the fix scope includes adding the route; minimum viable fix is (a)+(c) so the library function is correct when the route lands.

#### (e) Required return shape/type for the TS contract [confidence: HIGH]

- `fit_garch11` itself should keep returning `list[dict]`, length exactly `horizon` (or `[]` when `len(returns) < 30`), each dict:
  - `"step"`: Python `int`, 1-based, 1..horizon
  - `"conditionalVol"`: Python `float` (not np.float64 — must be `float()`-cast for clean JSON), **annualized** daily vol (`daily * sqrt(252)`), strictly > 0, **per-step values** (decaying toward unconditional vol in the MLE branch; flat is acceptable only for the EWMA proxy)
  - `"method"`: `"garch11_mle"` or `"ewma_proxy"`
- Existing test contract: `quant_framework/test_analytics.py:9-11` asserts `len(fc) == horizon` and all `conditionalVol > 0` — the fix must preserve both.
- **Caveat for the future route (not the function):** the TS side (`lib/quant/garchClient.ts:5-15, 71`) deserializes the sidecar body as `GarchForecastResult` = `{ ticker, model: 'GARCH(1,1)', forecast: [{ date: 'YYYY-MM-DD', conditionalVol }], source }` — i.e. the HTTP layer must wrap the list and map `step` → business-day `date` strings (the TS fallback `ewmaVolForecast` skips weekends, garchClient.ts:52-55). Returning the raw `fit_garch11` list from a `/garch/{ticker}` route would leave `data.forecast` undefined on the TS side. Keep `step` at the library layer, do the date mapping in the route.


### 2. PRIORITY 2 — Restricted-AST evaluator audit (`alpha_miner.py:264-305`, `multi_agent_factor_mining/agents.py:65-104`)

Two copies of the same evaluator (`safe_eval_formula` in alpha_miner.py, `_safe_eval_ast` in agents.py — line-for-line identical logic, including the same `_SAFE_BINOPS`/`_SAFE_UNARYOPS` tables at alpha_miner.py:256-261 and agents.py:57-62).

**Allowed node types (exhaustive — everything else hits the terminal `raise ValueError` at alpha_miner.py:303 / agents.py:102):**
- `ast.Expression` (root wrapper)
- `ast.Constant` — **only** `int`/`float`, with explicit `bool` rejection (alpha_miner.py:283). Strings, bytes, complex, `None`, `Ellipsis`, `True/False` all rejected.
- `ast.BinOp` with op in {`Add`, `Sub`, `Mult`, `Div`, `Pow`, `Mod`, `FloorDiv`}
- `ast.UnaryOp` with op in {`UAdd`, `USub`}
- `ast.Name` — only if the id is a key of the explicitly-constructed `namespace` dict; unknown names raise (NO fallback to builtins — there is no `eval`/`exec` anywhere, so `__builtins__` never enters the picture)
- `ast.Call` — func must be a bare `ast.Name` (alpha_miner.py:295), zero keywords (line 297), callee must be a callable fetched from `namespace` (lines 299-301); args recurse through `_ev`

**Escape-vector audit (each verified empirically against current source, not just on paper):**

| Vector | Verdict | Where blocked |
|---|---|---|
| `().__class__.__bases__[0].__subclasses__()` | BLOCKED | `()` → `ast.Tuple` unhandled (terminal raise, :303); even reached via a Name, `.__class__` → `ast.Attribute` unhandled; `[0]` → `ast.Subscript` unhandled; trailing call would also fail `isinstance(node.func, ast.Name)` (:295) |
| Attribute access on any allowed name (`x.__class__`) | BLOCKED | `ast.Attribute` unhandled → ValueError (:303) |
| Comprehensions (incl. scoping tricks via `ListComp`/`SetComp`/`DictComp`/`GeneratorExp`) | BLOCKED | all four node types unhandled (:303); comprehension cells never created |
| f-strings / `JoinedStr` / `FormattedValue` (`f"{x.__class__}"`) | BLOCKED | `ast.JoinedStr` unhandled (:303); string constants independently rejected (:285) |
| `lambda` | BLOCKED | `ast.Lambda` unhandled (:303) |
| Starred unpacking `f(*[...])` | BLOCKED | `ast.Starred` appears inside `node.args`, recursion hits terminal raise (:303); the list literal would also be rejected |
| Walrus `(y := ...)` | BLOCKED | `ast.NamedExpr` unhandled (:303) — verified it parses in `mode="eval"` but is rejected |
| Decorators / any statement smuggling | BLOCKED | `ast.parse(expr, mode="eval")` (:277) raises `SyntaxError` for statements; both call sites catch via `except Exception` and return NaN (alpha_miner.py:331, agents.py:158) |
| `getattr` via allowed builtins | BLOCKED | namespace is allowlist-constructed (alpha_miner.py:318-327; agents.py:141-153): OHLCV ndarrays + ts_* operators + arithmetic lambdas + (agents.py only) `safe_div`/`abs`(=np.abs)/`sqrt`/`log`. No `getattr`, no `__import__`, no `np` module object (explicitly noted at agents.py:148-149 — exposing `np` would be useless anyway since Attribute is rejected, but they kept it out regardless) |
| kwargs / `f(**{...})` | BLOCKED | `node.keywords` non-empty → ValueError (:297-298) |
| `Subscript`, `IfExp`, `BoolOp`, `Compare`, `Dict`/`List`/`Set`/`Tuple` literals | BLOCKED | all unhandled → terminal raise (:303) |

**Verdict: the evaluator is genuinely escape-proof for sandbox-escape/RCE purposes** [confidence: HIGH — 23 vectors probed empirically against the live code]. Escapes are structurally impossible because evaluation is a hand-rolled tree-interpreter over an allowlist, not `eval` with a filtered namespace. No object in the reachable namespace exposes attribute traversal, and attribute/subscript nodes don't evaluate at all.

**Residual (non-escape) weaknesses:**

- **F-PY-01 [P3, offline DoS, confidence HIGH]:** `ast.Pow` is allowed and maps to `_op.pow`. A formula like `9**9**9**9` evaluates arbitrary-precision integer exponentiation → CPU/memory hang before any numpy involvement. In `alpha_miner.py` inputs are repo-hardcoded (`FORMULA_CANDIDATES`) so unreachable; in `agents.py` the inputs include **LLM-generated lines** (`_parse_llm_response`, agents.py:367) — a runaway/prompt-injected LLM response can stall the `/mine-factors` worker. Same class: huge `window` args to `ts_*` (e.g. `ts_mean(close, 10**9)` → giant `np.ones` allocation). Mitigation: cap integer constants and reject `Pow` between two plain ints > small bound, or evaluate under a timeout. Offline tier + LLM-output-only trigger ⇒ P3.
- **F-PY-02 [P3, confidence HIGH]:** deep nesting (`-`*60k + `1`) → `RecursionError` inside `_ev`. Both call sites catch it (`RecursionError ⊂ Exception`) and return NaN, so it degrades gracefully — noted for completeness; CPython's parser itself may `MemoryError` on pathological inputs first.
- **F-PY-03 [P2, correctness, confidence HIGH — empirically verified]:** `alpha_miner.py` registers `div` but NOT `safe_div` in `FUNCTION_SET` (alpha_miner.py:244-253), while two `FORMULA_CANDIDATES` call `safe_div(...)` (lines 348, 356). `namespace.get("safe_div")` → `None` → ValueError → caught at :331-333 (logger.debug only) → all-NaN → silently skipped at :395. **The `intraday_sentiment` and `range_vol_weighted` candidates are permanently dead** — verified by direct execution: 2 of 13 candidates return `dead=True`, the other 11 evaluate. One-line fix: add `"safe_div": safe_div` to `FUNCTION_SET` (the module already defines `safe_div` at :37). The agents.py copy does NOT have this bug (it registers `safe_div`, agents.py:147).

### 3. `multi_agent_factor_mining/**` — pipeline and server findings

- **F-PY-04 [P1 (core feature is a no-op), confidence HIGH — empirically verified]: PortfolioComposerAgent can never select a factor.** `EvaluatorAgent.evaluate` builds its output dicts with keys `{name, formula, category, rank_ic, sharpe, source}` — it **drops `factor_values`** (agents.py:422-429). `PortfolioComposerAgent.compose` then does `fv = np.array(factor.get("factor_values", []))` and `continue`s when `len(fv) < 30` (agents.py:473-475) — which is **always**, for every factor. Verified end-to-end: 21 candidates → 14 pass evaluation → **0 selected, library永remains empty, `library.add` (agents.py:493) is dead code**. Consequently `/mine-factors` always returns `new_factors: []` and `total_in_library` never grows. The existing test `test_portfolio_composer` (tests/test_multi_agent_factor_mining.py:149-165) only asserts `isinstance(selected_factors, list)` with the comment "(or 0 if none passed)" — it cannot catch this. Fix: carry `factor_values` through the evaluated dict (and strip it before persisting/serializing), and tighten the test to assert `len(selected) > 0` on trending fixture data. Note also `status` is unconditionally set to `"completed"` at agents.py:590 even when every stage produced nothing.
- **F-PY-05 [P1 (service cannot start as deployed), confidence HIGH — empirically verified]: the Procfile `alpha` service crashes at boot.** `Procfile:2` runs `python multi_agent_factor_mining/server.py ...`, but server.py uses package-relative imports (`from .agents import ...`, server.py:18) → `ImportError: attempted relative import with no known parent package` (reproduced). Even launched correctly as `python -m multi_agent_factor_mining.server`, the `__main__` block references `os.environ` at server.py:215 with **no `import os` in the module** → `NameError`. Two-line fix: `import os` at top, and change Procfile to `python -m multi_agent_factor_mining.server` (argparse already handles `--host/--port`).
- **F-PY-06 [P2, confidence HIGH]: blocking work inside `async def mine_factors`** (server.py:109-167). `pipeline.run` is fully synchronous (numpy loops + `requests.post` with `timeout=30` per LLM call, agents.py:309-325) executed directly in the event loop. For the request's duration (potentially minutes: tickers × iterations × LLM calls) the loop is frozen — `/health` and `/library` stop responding. Offline tier ⇒ P2 not P1. Fix: `def mine_factors` (sync, FastAPI threadpool) or `await asyncio.to_thread(...)`.
- **F-PY-07 [P2, confidence MEDIUM-HIGH]: `ApiKeyGuard` mutates process-global `os.environ` per request without a lock** (config.py:68-90). Two concurrent `/mine-factors` requests with different `api_key`s race: B's `__enter__` can snapshot A's key as `_prev` and restore it after A's cleanup, leaving A's key resident in the process env (cross-request key bleed). Today this is masked by F-PY-06 (the blocked event loop accidentally serializes requests in a single worker), but fixing F-PY-06 un-masks it, and multi-worker uvicorn does not (separate processes are safe; threads are not). This module's docstring claims it reuses "the thread-local API key injection pattern from server_trading_agents.py", but it did NOT copy the per-provider lock that server_trading_agents.py has (see §4) — the `_thread_ctx` ContextVar (config.py:14, mutable `default={}` shared instance — hygiene issue itself) is set but **never read anywhere** in the package. Fix: copy the lock pattern, or drop the dead ContextVar and serialize guard entry.
- **F-PY-08 [P3]:** `ApiKeyGuard.__exit__` deletes the env var when `_prev is None` even if this request didn't set anything and the var also wasn't there — harmless; but with `api_key=None` and a pre-existing server-level key, `__enter__` stores it and `__exit__` restores it — correct. Only flagging the asymmetry for the race analysis above.
- **F-PY-09 [P3]:** `factor_library.py` has `import numpy as np` at the **bottom** of the module (factor_library.py:270), relied on by `top_by_ic` (:266). Works (module executes fully before calls) but is a landmine for refactors; move to top.
- **F-PY-10 [P3]:** server.py module scope instantiates `FactorLibrary(config.library_path)` AND `FactorMiningPipeline(config)` (server.py:39-40) — the pipeline constructs its **own second** `FactorLibrary` over the same JSON path (agents.py:532). Two in-memory copies of the same file; `/library` reads the server's copy while the pipeline writes through its own → staleness (currently unobservable because of F-PY-04, but will surface the moment F-PY-04 is fixed; `total_in_library` in the mine-factors response reads the stale copy). Share one instance.
- **F-PY-11 [P3]:** `_parse_llm_response` numbering-strip heuristic (`". " in line[:4] or ") " in line[:4]`, agents.py:364) silently mangles formulas beginning with short tokens — low impact since failures degrade to NaN-skip.
- CORS on this server mirrors server_options.py: `allow_origins=["*"]` with `allow_credentials=False` (server.py:30-36) — consistent with the accepted posture.
- agents.py `ts_delay` (agents.py:133-136) lacks the `lag < 1` clamp that alpha_miner.py:88-94 has — `ts_delay(close, 0)` or negative lag from an LLM formula raises/produces garbage, but it is caught and NaN-skipped. [P3]


### 4. PRIORITY 3 — `server_trading_agents.py` (407 lines, added in PR #41 2026-06-02, untouched since)

**Headline: the "Phase 11 hardening" described in the review brief (per-provider locks + `_failures` TTL cache) is NOT present at main 6945e34.** `grep -rn "_failures|provider_lock"` across the repo returns nothing; `git log --all -- server_trading_agents.py` shows the file landed once (PR #41) and was never hardened afterward. Either that work never merged to main or it lived on a branch that was lost. The following findings therefore describe the *current* state, which has real regressions vs. the believed-intact posture.

- **F-PY-12 [P1, key-leak, confidence HIGH]: `_ApiKeyEnvGuard.__exit__` leaks the user's API key into the process environment permanently when the server had no key of its own for that provider.** server_trading_agents.py:217-222:
  ```python
  def __exit__(self, *_: Any) -> None:
      if self.env_var and self._orig_value is not None:
          if self._orig_value is None:          # ← unreachable dead branch
              os.environ.pop(self.env_var, None)
          else:
              os.environ[self.env_var] = self._orig_value
  ```
  The outer gate `self._orig_value is not None` makes the pop-branch unreachable: when `os.environ` had NO pre-existing key (`_orig_value is None`, the common case for a user-supplied-key deployment), `__exit__` does **nothing** and the user's key **stays in `os.environ` after the request ends**. Every subsequent keyless request to the same provider then silently authenticates with the previous user's key (cross-user key reuse + billing), and the key lingers in process env (visible to child processes, crash dumps). This directly contradicts the privacy contract in the module docstring (:27-31) and the endpoint docstring (:324-326). Offline tier softens exposure, but this service's entire purpose is handling user keys ⇒ P1. Fix: track an `_injected` flag in `__enter__`; in `__exit__`, if injected and `_orig_value is None` → `os.environ.pop`, else restore.
- **F-PY-13 [P1 (downgraded from P0 only because tier is offline), concurrency/key-bleed, confidence HIGH]: no per-provider locks around env mutation.** `_run_analysis` executes on the default executor (`loop.run_in_executor(None, ...)`, :355-363) — genuinely concurrent threads. Two simultaneous `/analyze` requests for the same provider race on the same env var: request B's LLM call can read request A's key (cross-user), and B's `__enter__` can snapshot A's key as `_orig_value` and "restore" it after A cleaned up — permanently planting A's key (compounds F-PY-12). The brief says Phase 11 added per-provider locks; they are absent. Fix: module-level `dict[provider → threading.Lock]`, acquire around the whole `_ApiKeyEnvGuard` block — or better, stop using `os.environ` and pass the key via TradingAgents config if the library supports it.
- **F-PY-14 [P2, confidence HIGH]: contextvars propagation is both broken and dead code.** `_thread_ctx = ContextVar("thread_ctx", default={})` (:60) uses a single shared mutable default dict; `set_request_api_key` (:63-66) mutates that shared dict via `_thread_ctx.get()` without ever calling `.set()` — so the "context-local" key is actually a **process-global** visible to every request (it is cleared in the endpoint's `finally`, :366, but overlapping requests stomp each other). The comment ":351 Set api_key in the async context so run_in_executor thread inherits it" is doubly wrong: `run_in_executor` does NOT propagate contextvars (only `asyncio.to_thread` copies context). Mitigating factor: `get_request_api_key` (:69-71) has **zero callers** — the real key flow is the `req.api_key` argument into `_run_analysis` (:257), which is correct. Net effect today: misleading dead machinery that transiently stores a secret in a global. Fix: delete `_thread_ctx`/`set_request_api_key`/`get_request_api_key` outright.
- **F-PY-15 [P2, confidence HIGH]: the advertised 120s timeout cannot unblock the request.** :262-265 wraps `ta.propagate` in a single-worker `ThreadPoolExecutor` inside a `with` block. When `future.result(timeout=120)` raises `TimeoutError`, the `with`-exit calls `shutdown(wait=True)`, which **joins the still-running worker thread** — blocking until `ta.propagate` finishes anyway (possibly forever). The comment ":261 Wrap LLM call with 120s timeout to prevent indefinite hangs" is not delivered. Fix: instantiate the executor without `with`; on timeout call `executor.shutdown(wait=False, cancel_futures=True)` and return the error result (accepts an orphaned thread), and/or pass timeouts into the underlying LLM clients.
- **F-PY-16 [P2/P3, confidence HIGH]: `_results` cache grows without bound** (:131, :284-286). Every `job_id` plus `{ticker}_latest` is retained forever (~13KB per result with 7 truncated 1800-char reports) — slow memory leak on a long-lived service; no TTL, no size cap (and no `_failures` TTL cache exists to compare against — see headline). Lock usage around the dict is otherwise correct (:284, :373). Fix: cap to N most recent jobs or add TTL eviction.
- **F-PY-17 [P3, confidence MEDIUM]: error strings can carry secret material.** `error=f"{type(e).__name__}: {e}"` (:280) is returned to the caller and cached; `traceback.print_exc()` (:275) goes to stdout/logs. Some SDK/HTTP exceptions embed full request URLs — for providers that pass keys as query params (Google-style) the key can surface in the message. No key is *deliberately* logged anywhere (verified — no logging of `req.api_key` or env values). Recommend a scrub pass (regex for `sk-…`, `key=…`) over error strings before caching/returning.
- **F-PY-18 [P3]:** `max_debate_rounds`/`max_risk_discuss_rounds` accepted unbounded (:245-246) on an unauthenticated, CORS-`*` service; with server-level default keys configured (`TA_LLM_PROVIDER`/env keys), a caller can burn arbitrary server LLM quota. Clamp (e.g. 1-5) like the provider allowlist (:341-343) already does for strings.
- **F-PY-19 [P3, hygiene]:** `datetime.utcnow()` deprecated (:161, :176, :258, :266, :274); `_` used as a load-bearing variable for `final_state` (:265→:269); `ticker` accepted as any non-empty string (:328-330, length-unbounded, forwarded to yfinance/TradingAgents); `risk_debate_summary` and `final_trade_decision` both read `final_state["final_trade_decision"]` (:183-184) — looks like a copy-paste slip, the risk summary likely should read a different state key.
- Positives worth keeping: pydantic `model_config = {"extra": "forbid"}` (:102) rejects unknown body fields; provider allowlist (:341-343); `api_key`-requires-provider rule (:346-347); `trade_date` format validation (:335-338); CORS `allow_credentials=False` with wildcard origins (:301-308) matches the accepted posture; result objects never contain the key (:105-124).

