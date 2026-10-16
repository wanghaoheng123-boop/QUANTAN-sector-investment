# Dead-code sweep: what was removed, what stays, and the guard that keeps it that way

**Date:** 2026-10-16 · **Branch:** `chore/dead-code-sweep` · **Kind:** decision note (removals and a new guard; no behaviour change)

## Method

A file-level reachability scan over **tracked** source, resolving the real import graph. It uses the hardened resolver from `__tests__/architecture/syntheticContainment.ts` rather than a second one.

Entry points are:
- everything under `app/`, the same rule as `importGraph.ts`;
- root config files;
- any file a `package.json` script or a workflow names by path.

Type-only imports count as use.

It was checked before it was trusted:
- a planted orphan is flagged;
- a planted test-only module is flagged;
- a type-only import counts as use;
- `components/stock/QuantLabPanel.tsx`, reached only through `dynamic(() => import(…))`, counts as live.

Unused *exports* were swept separately by Q-118 (#231). This pass is about whole files and dependencies.

## Removed

| What | Evidence it was dead |
|---|---|
| `components/SectorRotationPanel.tsx` | No importer since PR #41 (2026-06-02). It was still being edited as though it rendered: Q-140 added a notice to it. |
| `lib/appUrl.ts` and its test | Its only reader was its own unit test. The briefs pages stopped fetching their own API, and `__tests__/briefs/noSelfFetch.test.ts` forbids that from coming back. |
| `pathe` (devDependency) | Imported by no tracked file. It remains installed as a transitive dependency of vitest. |
| `@testing-library/user-event` (devDependency) | Imported by no tracked file. |
| `@types/better-sqlite3` | Moved from `dependencies` to `devDependencies`. It is compile-time types only. |

**Vendor-licence register.** The rows are append-only, so nothing was deleted. Five rows are now `withdrawn`, each with a reason: the env hosts `NEXT_PUBLIC_APP_URL` and `VERCEL_URL`, the dynamic host `lib/appUrl.ts`, and the two npm packages. The `quantan.vercel.app` row loses its `lib/appUrl.ts` evidence and stays active through `scripts/smoke-production.mjs`. The register guard requires that a withdrawn row is no longer detected, so the withdrawals are checked, not just asserted.

## Kept, and why

- **Script-only modules.** `lib/quant/{deflatedSharpe,pbo,trialRegistry,effectiveSampleSize}.ts`, `lib/optimize/*` and `lib/backtest/portfolioBacktest.ts` are the I5 research machinery, run by npm scripts and CI. They are reachable through those scripts, so the guard counts them as live.
- **`scripts/backfill-missing-sessions.mjs`.** No script names it, but it is a manual operator tool with a recorded use (Q110-D1, the EQIX backfill). Scripts are entry points, not governed modules.

## Owner decision: seven modules only tests reach

`lib/portfolio/{diversification,factorAttribution,greeks,stressTest,tracker,var}.ts` and `lib/quant/intermarket.ts` are tested, real code that **no page or route runs**. `/portfolio/factor-attribution` says as much in its own copy. They are listed with reasons in `TEST_ONLY_PENDING` in the guard. A new test-only module fails the suite until someone decides to wire it to a surface or delete it with its tests.

## Owner decision: public routes nothing in the product calls

These are **outward-facing** endpoints, and their traffic is not visible from the repo, because the Vercel connector is not authorised. That is why they are listed here rather than deleted:

| Route | Note |
|---|---|
| `/api/sector-rotation` | Its only consumer was `SectorRotationPanel` (deleted above). It is an unauthenticated Yahoo proxy that serves sector OW/UW-style ranks, which is relevant to Q-083. |
| `/api/ml/[ticker]` | No UI consumer (Q-140 records it in `NO_UI_CONSUMER`). |
| `/api/conditional-vol/[ticker]` | No UI consumer. Until Q-140's red-team fix (PR #232) its fallback labelled an EWMA estimate "GARCH(1,1)" and hid a failed GARCH service. (Q25-1, the √252 annualisation of BTC, was fixed on 2026-07-06; an earlier draft of this note said it was open.) |
| `/api/regime/[ticker]` | No UI consumer. Its fallback returned constant "posterior probabilities" (0.65 / 0.175 / 0.175) until PR #232. |

Each is a public surface with no product purpose today. Unused unauthenticated proxies are attack surface and I8 exposure. **The recommendation is to delete all four**; the call belongs to the owner.

## The guard

`__tests__/architecture/no-orphan-modules.test.ts`, built on `orphanModules.ts`. It fails when a module under `app/`, `components/`, `hooks/` or `lib/` is unreachable, or is reachable only from tests and is not on the recorded list. Three mutations were run and all were killed:
- dropping type-only edges;
- dropping config-file entries;
- counting tests as live.

**What it cannot see:**
- a module loaded through a non-literal specifier;
- a file a workflow invokes by a computed path;
- unused exports inside a live file (Q-118's territory).
