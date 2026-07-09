# Program Day — 2026-07-10 (owner: "run tests on everything" + "are you sure?" audit)

## Full verification matrix — result after honest re-audit
- tsc CLEAN · pytest 131p/1s + every .py compiles · vitest (pure-node) **1,004 passed / 17 skipped**
  locally; jsdom suite green in CI · benchmark net **56.33** (floor PASS) · OOS gap 6.49pp PASS ·
  portfolio backtest deterministic across 6 configs · verify:logic/indicators/btc + validate:data
  all pass · prod endpoints 200 + 4/4 security headers · **runtime errors 3d = 0**.

## What "are you sure?" surfaced (green checkmarks that were lies)
1. **Stryker mutation testing DEAD since 2026-06-07** — 5 weekly failures masked by
   `continue-on-error` (workflow "success", job failure). Cause: instrumented dry run pushes
   walk-forward tests past vitest's 5s default. Fixed in TWO passes (#99 per-test → sibling died
   too → #100 global `testTimeout: 30_000`). Third dispatch (run 29037961120) **passed the dry
   run and is mutation-testing 7,221 mutants as of this writing** — first real run in 5 weeks.
   Score lands in the run log/HTML report; review at the Monday sweep.
2. **The "green" axe run had found real violations then crashed**: meta-viewport (zoom-block)
   → FIXED at source (#99, layout maximumScale removed); landmark-unique ×2 → FIXED (#100,
   SignalCard region labels now instrument-prefixed); **color-contrast ×34 → NEW-C-5**
   (design-gated); /backtest crawl renderer-timeout → NEW-C-6 (known limitation, page-1 audits
   are the signal).
3. Env quirk recorded: Node fetch (undici) is flaky to vercel.app from this machine (curl fine)
   — local smoke-script failures are not prod signal; CI smoke is authoritative.

## Still outstanding
- **Scheduled program has not produced a daily report since the prompt update** (07-08 fire: no
  trace; 07-09: no fire). The no-stall prompt hardening is in, but the one-click owner action
  remains: **Run now + approve the Vercel tools on the task**.
- F1.5 dividends: fixtures still OHLCV-only (0/56 with dividend field) — activates at the next
  Saturday data refresh, as designed.
- Monday 07-13 sweep: review the completed Stryker score + fresh axe baseline.
