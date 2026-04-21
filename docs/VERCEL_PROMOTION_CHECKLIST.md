# Vercel Promotion Checklist

Use this checklist before production promotion.

## Project Target Confirmation

- [ ] Vercel project name is `quantan-sector-investment`
- [ ] `projectId` matches `prj_Rk9lpO090omeU1IiFvHmTG2HMnbk`
- [ ] `orgId` matches `team_TXgmnu4Bwg2rqPJupexBjrU9`

## Pre-Deploy Gates

- [ ] GitHub required checks are all green
- [ ] PR inspection checklist fully passed
- [ ] External expert sign-off attached
- [ ] Institutional scorecard mandatory gates all pass

## Preview Validation

- [ ] Deploy preview completed successfully
- [ ] Smoke checks pass against preview URL
- [ ] Critical API routes healthy
- [ ] Data freshness and disclosure labels verified

## Production Promotion Decision

- [ ] Promote only if all pre-deploy and preview checks are green
- [ ] Record promotion run ID, commit SHA, and scorecard snapshot
- [ ] Publish rollback trigger conditions

## Post-Deploy Guardrail

- [ ] Monitor for critical errors and metric regressions
- [ ] Auto-hold future promotion if any P0/P1 defect appears
