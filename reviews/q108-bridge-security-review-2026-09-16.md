# Q-108 bridge gate review — 2026-09-16

## Change and migration

A configured URL alone no longer permits Bloomberg bridge requests. Both direct client functions recheck the server-only acknowledgement; all existing price-source labels stay intact when enabled. The public health route returns a constant `{"status":"ok"}` with `Cache-Control: no-store` before the rate limiter or bridge can make a request. Detailed diagnostics require the existing shared `QUANTAN_API_KEY` header. Every holder of that key receives this permission; a normal OAuth session does not. Both outbound bridge calls reject redirects to prevent a custom secret header following a redirect to another origin.

No environment values were changed. Deploying with a URL but no acknowledgement disables new Bloomberg requests and retains the existing Yahoo path. Review the intended production configuration before merge. This gate records an operator assertion, not a licence determination or an audit of that assertion. Existing cached responses are not invalidated by this change.

## Adversarial review

The security reviewer found that the older design granted infrastructure diagnostics to any OAuth user and ran the potentially network-backed rate limiter before authentication. Both were corrected. The redirect risk was reproduced with a mocked undici transport and a synthetic secret header: a 302 across origins carried the custom header before this fix.

The independent red-team reviewer traced client callers, API-key validation, middleware, cache responses and failure branches. No blocking defect was found in the gate, health authorization or redirect changes. Two pre-existing defects were reproduced with actual modules and filed as Q-128/Q-129: malformed numeric strings becoming prices and Bloomberg prices inheriting Yahoo timestamps. This review does not establish Bloomberg data validity or freshness.

## Verification

- Tests written before implementation: 15 failures / 14 passes exhibited missing controls.
- Real-client consumer tests cover both `/api/prices` and `/api/fundamentals`: absent URL, absent/incorrect acknowledgement, and exact acknowledgement. Fundamentals payload construction is mocked; the test checks the selected input price and response source fields, not a valuation.
- Restoring the old URL-only predicate makes four consumer tests fail (four pass); restored before the full suite.
- Full suite: 2189 passed / 17 skipped, 147 passed files / one skipped. Final TypeScript check and production build pass.
- check:ci stages passed across a retry: actionlint, core logic, indicator math, BTC feed sample, fixture integrity, production smoke. The first BTC request failed due to sandbox DNS; the network-enabled retry passed. Integrity: 56 files / 71841 rows, zero hard failures and two pre-existing warnings. Production smoke: 20/20 on the existing deployment, not this branch.
- Built local runtime: public health returned 200/no-store and exact opaque body; a valid synthetic key received 200/no-store with state `unacknowledged`, with URL configured and acknowledgement absent.
- No algorithm changed, historical strategy experiment ran, or strategy benchmark result was claimed. The separate algorithm audit contains deterministic accounting probes only.

## Limits

No production deployment, production credential custody, or licence permission was verified. Unit tests assert redirect refusal options and generic fetch-failure handling; they do not contact a real redirecting bridge. The independent reviewer saw no Q-108 blocker; recorded residuals remain open. Repository checks are advisory until branch protection is configured under Q-097.
