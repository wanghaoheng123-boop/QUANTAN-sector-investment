# Q-157 follow-up — the BTC price badge uses vendor time

The PR's receipt clock could label a replayed Coinbase ticker `LIVE`: a
four-hour-old vendor message received now rendered as updated zero seconds ago.
Transport activity does not establish price freshness (design invariant I2).

Coinbase snapshots now carry the ticker's validated UTC vendor timestamp.
`BtcPriceFeed` retains receipt time separately. The badge classifies Coinbase
prices from vendor age; a missing, malformed, future-at-receipt or replayed
timestamp cannot produce `LIVE`. Repeated stale or undated socket messages also
cannot keep the REST fallback suppressed. Fallback suppression delegates to
the badge's freshness decision through `hasFreshVendorPrice`; it defines no
second classification or threshold.

The existing 30-second Coinbase freshness and five-minute REST receipt limits
are unchanged. REST remains labelled `DELAYED`, and its title explicitly says
that vendor price time is unknown. This work does not establish REST vendor
freshness, cross-vendor agreement or a measured feed SLO.

## Validation

- Full regression on the PR branch plus this change: 2,847 passed, one
  architecture failure. The structural freshness detector matched the hook's
  delegated `live` comparison and its separate fallback timer in the same file.
  Moving that delegation into the existing classifier module fixed the failure
  without an allowlist or weakening the detector.
- Recheck after the delegation refactor: 82 tests passed across the failed
  architecture file, BTC snapshot, websocket hook and options-chain suites.
  Together with the full run, all 2,848 tests across 195 files are accounted for.
- Typecheck and full lint passed; focused lint and typecheck were repeated after
  the delegation refactor. `git diff --check` is clean.
- Production `npm run build` passed on the final source under Next.js 15.5.19.
- Validation used a local archive/overlay under `/private/tmp` with Node 24,
  because the Google Drive filesystem intermittently times out reading modules.

Prior read-only red-team review found the replay defect closed. A separate
red-team pass over the final delegation refactor found no blocker. No
production verification or merge is claimed here.

## Deferred existing issue

A slow in-flight REST response can still overwrite a newer websocket tick.
That pre-existing ordering race is not resolved by timestamp labelling; retain
it as a follow-up rather than treating a healthy freshness badge as proof that
the selected price is the newest available one.
