# GitHub PR Inspection Checklist

Use this checklist in every PR before merge.

## Identity and Scope

- [ ] PR links to target set IDs and metric IDs touched
- [ ] Scope is bounded and mapped to phase queue
- [ ] Risk notes included

## Required Automated Checks

- [ ] Typecheck pass
- [ ] Test suite pass
- [ ] Data verification pass
- [ ] Long-data verification pass
- [ ] Backtest matrix generated
- [ ] Scorecard evaluation pass
- [ ] Loop mission pass

## Manual Review Requirements

- [ ] Builder self-review complete
- [ ] Internal verifier review complete
- [ ] External expert reviewer approval attached

## Data/Algorithm Integrity

- [ ] No unverified data fields in user-facing outputs
- [ ] Algorithm formulas match documented methodology
- [ ] Confidence and risk labels present where needed

## Evidence Bundle

- [ ] Artifact paths attached
- [ ] Run IDs and config hashes attached
- [ ] Commit SHA and environment details attached

## Merge Rule

- [ ] All mandatory items pass
- [ ] No unresolved P0/P1 issues
- [ ] Merge approved by internal + external reviewers
