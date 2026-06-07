# next-auth / uuid (P1-M) — remediation decision (2026-06-04)

## Finding (from npm audit)
`npm audit` reports `next-auth ≤4.24.14 → uuid <11.1.1` (GHSA-w5hq-g745-h8pq, moderate).

## Exploitability analysis → NOT exploitable in practice
- Dependency tree: **only** `next-auth@4.24.13` depends on uuid, pinned `uuid@8.3.2`.
- next-auth's usage: `node_modules/next-auth/jwt/index.js` → `require("uuid")` → `uuid.v4()`
  (random UUID for the JWT `jti`).
- The advisory is specifically a **missing buffer-bounds check in uuid v3/v5/v6 when a
  `buf` argument is provided.** next-auth uses **v4 with no `buf`** → the vulnerable code
  path is never reached. Real-world risk here ≈ nil.

## Why this was NOT auto-fixed in this remediation wave
Both available fixes change auth behavior in ways this environment **cannot verify**
(vitest does not exercise the live OAuth/JWT runtime), so shipping either blind would
violate the "verify after every change" rule:
1. **`overrides: {"uuid": "^11.1.1"}`** — uuid 8→11 is a 3-major jump. `uuid.v4()` still
   exists, but forcing it requires `npm install` + a real **sign-in smoke test** to confirm
   JWT generation still works. Adding the override to package.json WITHOUT installing would
   also desync the lockfile and break CI. → owner runs install + auth smoke test.
2. **Auth.js v5 migration** — the clean long-term fix (v5 drops the uuid dep), but it rewrites
   the auth config, the `[...nextauth]` route, `getServerSession()` callers, and env vars
   (`NEXTAUTH_*` → `AUTH_*`). Must be done as a focused effort with OAuth login testing.

## Recommendation for owner (low urgency, given non-exploitability)
- Short term: `npm i -D` an `overrides` bump of uuid to `^11.1.1`, then **manually test
  sign-in** (the only real verification). If sign-in works, commit the lockfile.
- Long term: schedule the Auth.js v5 migration (also resolves the broader `next-auth ≤4.24.14`
  advisory line and modernizes the auth stack).
- The `next-pwa → workbox` audit entries are **build-time** (not shipped to the client
  runtime) — lower priority; bump when convenient.
