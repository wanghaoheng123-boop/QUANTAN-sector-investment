# Full Inspection 2026-06-30 — Supervisor Charter

**Owner directive (2026-06-30):** "Conduct a full run-through check and inspection of the
whole code and algorithms… make sure that there is a group / a supervisor to inspect the
agents when doing the tasks to ensure ethics and truth, accuracy."

**Mode:** READ-ONLY inspection. No production code is modified in this pass. Findings that
warrant a fix are escalated; anything that changes a *published number* or touches prod is
owner-gated (established prep-then-authorize rule). Baseline: `main @ 2f2507a`.

---

## The supervisor (coordinator) — accountability layer

The coordinator (this session, Opus 4.8) is the **supervisor**. Review agents PROPOSE
findings; the supervisor RATIFIES them. No finding reaches the master report or the
findings-ledger until the supervisor has discharged the duties below. This is the
"ethics / truth / accuracy" guarantee the owner asked for, made enforceable.

### Supervisor duties (per the documented lessons in workspace memory)

1. **Source-verify every elevated finding (P0/P1) against the actual bytes** before
   publishing. Agents reproduce Read-tool rendering artifacts and grep false positives —
   e.g. the documented `lib/auth.ts:124` "regex rejects all names" false positive (real
   bytes are `/[\x00-\x1f\x7f]/`, control chars). Confirm with `hexdump`/Python `repr()`
   when a claim hinges on exact characters.
2. **Distrust grep-count / comment-match heuristics.** Prior waves produced "timer leak"
   and "nested component" false positives that were pure comment-match artifacts
   (`InstrumentTable SortIcon` is module-level → no remount). A count is a lead, not a finding.
3. **Confirm LIVE vs DORMANT for every finding.** A bug in code with zero production callers
   (the deleted provider layer, the dormant enhanced-signal stack, offline Python research
   modules) is not the same severity as a bug on a live `/api` path. Trace the caller chain.
4. **Ethics / truth in the numbers.** This is a trading-signal product. The supervisor
   specifically guards against: look-ahead bias, survivorship bias, gross-vs-net win-rate
   misrepresentation, inflated/undisclosed performance claims, and annualization errors that
   misstate a *displayed* number. A finding here must be reproduced, not asserted.
5. **No fabricated confidence.** Every published finding cites file:line and states whether it
   was source-verified, the caller path, and live/dormant. "Likely" stays "likely."
6. **Reconcile against prior waves — do not re-litigate settled items.** Cross-check every
   candidate against `reviews/findings-ledger.csv` (FIXED / MOOT / VERIFIED-CLEAN /
   open-owner-gated). Re-flagging a settled false positive is itself an accuracy failure.

### Agent operating rules (passed to every dispatched agent)

- **Durable incremental writes are mandatory:** append to your
  `reviews/full-inspection-2026-06-30/<area>.md` every 2–5 file reads. Sub-agents share the
  parent session/usage limit and may be killed mid-run; un-written findings are lost
  (documented 2026-06-01 incident). Write early, write often.
- **Read-only:** no Edit/Write to source. Findings only.
- **Cite file:line for every claim.** Mark each finding LIVE or DORMANT with the caller path.
- **Reconcile, don't repeat:** check `reviews/findings-ledger.csv` before reporting; note the
  ledger id if it's already tracked.
- **Severity discipline:** P0 = live correctness/security/data-integrity break reachable in
  prod; P1 = live but bounded / methodology that misstates a published number; P2/P3 =
  quality / dormant / defense-in-depth.

---

## Fleet (parallel, read-only, disjoint domains)

| Agent | Domain | Scope |
|-------|--------|-------|
| A — Quant/Algorithms | `lib/backtest/`, `lib/quant/`, `lib/optimize/`, `quant_framework/` | Signal/backtest/indicator correctness; look-ahead/survivorship/gross-net/annualization honesty |
| B — API/Security | `app/api/`, `middleware.ts`, `lib/auth.ts`, `lib/api/` | Auth, CSRF, rate-limit, SSRF/ticker-whitelist, error sanitization (CWE-209), headers, boundary finite-guards |
| C — Frontend | `app/`, `components/`, `hooks/` | Render correctness, error boundaries, effect/abort races, a11y, chart honesty (no-op controls) |
| D — Python/Data | `*.py`, `multi_agent_factor_mining/`, `ml/`, `lib/data/`, warehouse | Sidecar safety, restricted-eval sandbox, key-leak guard, data ingest finite/positive guards |

Coordinator runs the cross-cutting **gates** centrally (tsc / vitest / benchmark WR + OOS /
npm-audit) — the §7 weekly-deep-sweep cross-cut — and does the source-verification pass.

## Deliverables

- `MASTER-INSPECTION-2026-06-30.md` — ratified rollup (supervisor-verified findings only).
- `<area>.md` per agent (raw proposed findings + supervisor verdicts inline).
- Gate results (tsc / vitest / benchmark WR & OOS / npm-audit) recorded.
- `findings-ledger.csv` reconciliation (new rows for genuinely-new verified findings only).
