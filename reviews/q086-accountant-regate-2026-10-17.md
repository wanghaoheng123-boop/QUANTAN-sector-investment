# Q-086 accountant re-gate (PR #240, commit c12c3b2)

Reviewer: accountant gate. Scope: the platform's own accounting logic, not a view on any security.
Supersedes nothing: the first gate (`reviews/q086-accountant-2026-10-17.md`, commit `5b73c05`) stands as the record of what was asked.

## Verdict: APPROVE (no blocking items; should-fix list below)

All five original blockers (B1 to B5) are resolved in the code, and each fix has an executing test that I watched
fail under mutation. The revision also goes past what I asked in ways I judge correct (allowlist, refusing the two
mixed labels, nulling bands for refused names, a currency refusal).

I looked for a blocker and did not find one. Two candidates I considered, and why they are not blocking:

- **N2, the currency check fails open when `quote()` returns no currency.** B2 was blocking because the PR's own
  new gate failed open on the property it claimed (it said "unknown classification refuses" and a missing `industry`
  did not). The currency check's claim is "refuses when the two currencies differ", which is true whenever both are
  known. Before this PR a foreign reporter got a wrong-currency DCF every time; after it, only when `quote()` fails
  while the chart succeeds. That is a strict improvement and the remaining gap is an existing one, which CLAUDE.md
  routes to the backlog. Ask for it to be logged with a passing "CANNOT do" test.
- **N3a, "the balance sheet is the product (deposits, reserves, borrowings)" shown for an unrecognised Financial
  Services label and for Shell Companies.** This is the only on-screen sentence that is false about specific
  companies (a SPAC has a trust account, not deposits). It differs from B3 in two ways: in B3 the refusal itself was
  wrong (Insurance Brokers were refused and shown a false reason), and here the refusal is right and only a clause of
  the reason overreaches; and the wording is the one I recommended in B3, which was true for banks and insurers and
  which I did not test against the default branch. Fix is one conditional string.

Bookkeeping the author should do with the merge, none of it code that changes a number: scope the note sentence at
`:59` (R1); log N2, N3b, N5 and N10 as `Q-###` rows (only Q-146 and Q-147 exist, and they sit unmerged on
`chore/backlog-2026-10-17`); restore CRLF on `route.ts` (S9).

The three should-fixes I would not leave long: **N2** (second currency source from `chart.meta.currency`, refuse when
the reporting currency is known and the quote currency is not), **N3** (the default-refuse reason, and make the Summary
sentence consistent with the unrefused case), **N5** (the spread guard's float noise: three of the six slider-reachable
exact-2pp cells refuse and three run).

## What I ran (all from the worktree; no tracked file edited, no network)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0, no output |
| `npx vitest run` on the 3 Q-086 files | 3 files, 45 tests pass |
| `npx vitest run` on all 19 test files that import or render the changed modules (builder, dcf, priceBands, researchScore, QuantLabPanel snapshot, fundamentals-tripwire, vendor-licence-register, fail-closed-routes) | 19 files, 420 tests pass |
| New probes (outside the repo, scratchpad `regate/`): classification matrix, slider-grid sweep, currency cases, B1 table, scenario table | results below |
| Mutation harness on a scratch copy of the worktree (so no tracked file was touched), target string asserted present before each mutation | 21 mutations: 19 killed, 2 survived (M12, M18), restored baseline 45/45 |

## Disposition of the first gate's items

| ID | Status | Evidence |
|---|---|---|
| B1 migration note false for refused names | **RESOLVED** | Note `:7-11` rewritten; test comment `buildFundamentalsPayload.test.ts:230-235`; builder comment `:243-246`. Re-ran my B1 probe (price 100, target 125, forwardEps 5, forwardPE 20): a bank now gets `dcfBase null`, bands `null`, signal `null`, score 49.6 at both FCF levels (5.1 and 8.5), band pillar `50 / "Bands unavailable."`. Universe claim (five Financials BRK-B, JPM, V, MA, BAC; five equity REITs) matches the tickers in `lib/optimize/sectorProfiles.ts:107` and `scripts/backtestData/`; I could not re-measure Yahoo's labels offline. Residual: the test pins `bands`, `signal` and the band pillar but not `researchScore.total` (see N8). |
| B2 refusal fails open on missing `industry` | **RESOLVED**, with two narrow residuals (N1) | Field-by-field read `buildFundamentalsPayload.ts:250-255` via `firstString` `:85-93`; early return `:127-129`. Probed: no profile, `{}` plus populated `assetProfile`, Financial Services with no industry, non-string industry, `industryKey` only: all refused. Mutations M04 (assetProfile ignored), M10 (early return off), M03 (allowlist off): all killed. |
| B3 list wrong in both directions | **RESOLVED** (design judged below) | Allowlist `:105`, `:136-141`; denylist `:108` now has REIT - Mortgage and Financial Conglomerates and excludes Insurance Brokers via `(?! brokers)`; mixed labels `:111`; reason `:113-114` no longer says "debt is operating capital". Probed 25 labels (matrix below). M02, M16, M17, M21 killed. Credit Services test re-titled (`test.ts:381`). |
| B4 vendor definition stated as fact | **RESOLVED** | `ValuationTab.tsx:143-146` hedged ("treated here as", "exact definition is not verified by this platform"); builder comment `:235-249`; `types.ts` comments; render test asserts the hedge and the absence of "levered free cash flow" / "already net of debt service". Two follow-ups on wording: N4, N6. |
| B5 refusal never reaches the band | **RESOLVED** | `bands` null when `dcfNotApplicable !== null` (`:314-324`); `signal` follows (`:388-390`); band pillar takes its no-band branch (`researchScore.ts:168`); Summary says why (`SummaryTab.tsx:176-181`); methodology names the anchors used (`priceBands.ts:31`, `:74`). M01, M13, M14 killed. Consequences judged in section 2.3. |
| S1 bull floor, magic numbers, ordering | **RESOLVED** | `scenarioRates` `:171-176`; constants named `:155-158`, `:169`. Re-ran my scenario table: bear <= base <= bull at every input 4.5% to 9% (below); across the full slider grid (250 cells) zero ordering violations at default growth inputs. Note renders only in one test-less path (N7). |
| S2 minimum spread, cited ceiling on terminal growth, TV share shown | **PARTIAL** | Spread guard `:274-277` and TV share per row (`ValuationTab.tsx:82`, `:90`, `:98`, `:106`) done. Not done: the terminal-growth ceiling (route clamps 5%, `runDcf` 6% at `dcf.ts:57`, no cited bound; Damodaran ch. 12 uses g <= risk-free). Guard misfires at the exact boundary (N5). |
| S3 SSOT still says FCFF | **RESOLVED** (code), one stale line in agent config (N9) | `dcf.ts:1-17` model-neutral, `:29-33` `netDebt` "FCFF CALLERS ONLY", `:40` `enterpriseValue` documented; `accountant.md:66` updated. The bullet two lines below it still says callers supply `netDebt`. |
| S4 every null carries a reason | **RESOLVED** | `dcfUnavailable` `:279` = refusal, shares, FCF, spread; `pickFcf0` returns null rather than a negative `:74-77`; rendered `ValuationTab.tsx:66-70`. |
| S5 "net debt already 0 for every ticker" | **PARTIAL** | Wording scoped to "the four tickers measured" (note `:9`, builder `:243-246`). The measurement I asked for (balance-sheet field presence across the 56 names plus non-US/small caps) was not done; the 12-name probe covers classification and currency only. The note's `:59` sentence does not say which base it compares to (R1). |
| S6 flat 9% labelled a cost of equity | **RESOLVED** (option b taken) | Slider label `ValuationTab.tsx:51`; footnote `:145-146`. Beta still unused; logged as Q-147 on `chore/backlog-2026-10-17` (unmerged). The zero-net-borrowing assumption is in the footnote, not beside the slider. |
| S7 `financialCurrency` never read | **PARTIAL** | Check `buildFundamentalsPayload.ts:256-269`; route passes the `quote()` currency `route.ts:134-150`; dead `ordinarySharesNumber` removed `:229-231`. Probed: TWD/USD refused, GBP/GBp refused, EUR/EUR runs. Fails open when `quote()` returns no currency, and when `financialCurrency` is absent (N2). Share-count/ADR-ratio reconciliation neither done nor logged. |
| S8 refusal rendering untested | **RESOLVED** | `__tests__/components/quantlab/dcfRefusalRender.test.tsx` reads `dcf-not-applicable`, `bands-refused`, the TV-share column and the hedge; `__tests__/api/fundamentalsDcfRefusal.test.ts` drives the real route (M08 killed). Gaps: N7. |
| S9 CRLF flip | **PARTIAL** | `buildFundamentalsPayload.ts` is back to CRLF (598 CR lines, net diff vs `e701382` is real). But `app/api/fundamentals/[ticker]/route.ts` flipped from CRLF (173 CR lines) to LF in `c12c3b2`: 352 lines of diff for 8 real lines, (the `05c6262` message says CRLF was restored; that is true for `buildFundamentalsPayload.ts`, and the `route.ts` flip came in `c12c3b2`). |
| S10 `discountRate` alongside `wacc` | **RESOLVED** | `:513-514`. |
| S11 `fcf0Source` | **RESOLVED** | `:53`, `:510`; asserted in two tests. The UI does not read it (N4). |

## Judgement on the new design choices

### 2.1 Refusing Credit Services and Asset Management: the right fail-closed call

Yes. The test of a refusal gate is whether the platform has any field that separates the admitted from the refused
members of a label. For these two labels it has none (no interest income, no consolidated-fund flag, no insurance
subsidiary flag), so the only alternatives are to value every member or none. Valuing a lender as FCFE with zero net
borrowing produces a number that looks supported and is not; refusing a payment network produces a dash with a reason.
The error costs are asymmetric in the direction the PRIME DIRECTIVE names, and the cost (V and MA lose their DCF) is
disclosed in the note at `:28`.

It does not over-refuse in a misleading way, with one caveat. The message `buildFundamentalsPayload.ts:134` is about the
label ("Yahoo files lenders ... under this label alongside fee businesses"), not about the company, so a reader of the
V page does not learn that V is a lender. The caveat is that the sentence asserts Yahoo's taxonomy as fact and the repo
holds no evidence for it: the only support is my own recollection in the first gate (which I marked UNVERIFIED) and a
probe that recorded no vendor values. That is the B4 defect (an unverified vendor claim stated on screen) in a new
place. I do not make it blocking because of the **direction**: if the claim were false the cost is an unnecessary
refusal, not a flattered valuation; B4 was blocking because the unverified claim carried the number. Soften to "this
label can include ..." or record the probe (tickers and labels only) so the sentence has a source. Also: "leveraged
investment vehicles" belongs to Asset Management, not Credit Services; the shared sentence names both under each label.

### 2.2 The allowlist: correct for the two admitted labels, with named residuals

- Insurance Brokers and Financial Data & Stock Exchanges are the right two to admit on the economics (fee businesses,
  debt is ordinary corporate debt). Probed through the builder: both run with sector Financial Services, and Insurance
  Brokers also runs with sector absent and with case/whitespace variants.
- Default-refuse works: an unknown Financial Services label (`Specialty Lending`) is refused; the same label under
  Technology is not (tested `:436-437`).
- Order of checks is sound: denylist and mixed labels fire before the sector branch, so they refuse whatever the sector says.
- Dash and spacing variants (en dash, em dash, NBSP, double spaces, upper case) all normalise.
- Residuals I would name in the note (none blocks): (a) admitted does not mean clean: brokers hold fiduciary funds and
  grow by acquisition that FCF excludes; exchanges and clearing houses hold margin and custodial balances. I could not
  check from this repo whether any admitted-label company's vendor FCF is distorted by them. (b) The allowlist is
  keyed to the exact string `financial services`; a vendor sector rename would silently disable the default-refuse
  branch (the denylist would still catch known labels). `sector.startsWith('financial')` is a one-token hardening.
  (c) "Debt is raw material" businesses outside Financial Services (aircraft and equipment lessors, captive-finance
  manufacturers) are admitted, with the FCFE zero-net-borrowing assumption stated on screen. (d) Partial classification
  (N1).

### 2.3 Nulling bands for refused names: right for the refused names, creates one consistency problem

What works: the three outputs that were built on the DCF (`bands`, `signal`, the band pillar) now agree with each other
and with the Valuation tab. Verified the research score no longer depends on the refused DCF at all (49.6 at FCF 5.1
and 8.5). No other consumer of `bands` or `signal` exists outside `SummaryTab.tsx:155-181` (grepped `components app lib hooks`).

What it creates:
1. **Two classes of "no DCF" are now treated differently.** A name whose DCF is unavailable for another reason
   (negative FCF, no shares, the spread guard) still gets bands from the same two remaining anchors, including the
   forward-earnings heuristic (`:314-324`, tested at `buildFundamentalsPayload.test.ts:465`). The Summary tab sentence for refused names says
   those anchors "are not a valuation on their own" (`SummaryTab.tsx:180`); the same page draws a band from them for a
   loss-making company. The platform now asserts both things. This is pre-existing for the second class, so I do not
   block, but the sentence should be reworded to the cause ("no band is drawn because the DCF was refused") or the
   policy extended to `dcfBase === null` with its own migration note (N3b).
2. **The score keeps a neutral 15% pillar.** `valuationBandScore(null)` returns 50 with weight 0.15 (`researchScore.ts:168`,
   `:202`), so a refused name's total is compressed toward 50 rather than renormalised. That is the existing convention
   for every missing pillar and it is labelled "Bands unavailable.", but the label does not say why. Cosmetic.
3. **The score still penalises leverage on exactly the names the PR calls leverage-uninterpretable.** Probed: a bank with
   debt/equity 900 gets "high debt/equity" in the Quality pillar (25% weight, -15). The PR's own reasoning ("the balance
   sheet is the product") applies to that pillar. Not introduced here, but this PR is what makes it inconsistent.
   New backlog item (N10); the score is user-facing so route through Q-083.
4. The analyst-target and forward-heuristic tiles still render on the Valuation tab for refused names (`ValuationTab.tsx:118-130`). They are
   vendor figures, labelled as such. Fine.

### 2.4 The constants: honest, acceptable, not a citation

HOUSE STYLE says "named constants with a comment citing the source". For platform-chosen sensitivity parameters there is
no source to cite, and the honest equivalent is to say so. Judged one by one:

| Constant | Comment | Verdict |
|---|---|---|
| `BEAR_RATE_DELTA` 1.5pp, `BULL_RATE_DELTA` 1pp (`:155-156`) | "SOURCE: inherited unchanged from the pre-Q-086 implementation ... no paper is claimed" | Acceptable. It states provenance and refuses to invent authority. Rename the token `SOURCE:` to `PROVENANCE:` so a reader scanning for citations does not read it as one. |
| `BEAR_TERMINAL_GROWTH_CAP` 2% (`:158`) | "SOURCE: inherited unchanged" | Same. Add the sentence the first two carry: this is a sensitivity setting, not an estimate. |
| `MIN_RATE_SPREAD` 2pp (`:169`) | Cites Damodaran (2012) ch. 12 for the Gordon formula; says the 2pp "is this platform's choice of cap, not a sourced estimate" | Acceptable and correctly worded. The arithmetic is right: the multiple of next-year cash flow is 1/(r-g), so 2pp gives 50x. The chapter number matches my recollection of the 3rd edition (12 terminal value, 14 FCFE, 15 firm valuation, 21 financial service firms); I could not open the book here. The commit message and task summary phrase it as "(Damodaran 2012, ch. 12)" attached to the cap, which over-ascribes: the book supports the formula, not the 2pp. The code comment is the accurate one. |

What is not acceptable under the DCF DISCIPLINE rule ("any DCF output shown needs its assumption set visible"): the
bear terminal growth is `min(tg, 2%)`, so with the terminal-growth slider at 4% the bear row silently uses 2%
(probed: tg 4% gives bear terminal growth 0.02, bear/base/bull 61/111/165 with TV share 67/79/84%). The Rate column
shows three discount rates and no terminal growth. Show it or state the cap in the footnote (N6). The guard also admits
a 2pp spread whose terminal share is 92% on the slider grid (max measured 91.9%); that is displayed now, which is what
the rule asks, but nothing flags it.

## Sentence audit (every user-visible string this PR writes or changes)

| Where | Sentence | Finding |
|---|---|---|
| `ValuationTab.tsx:51` | "Discount rate (cost of equity; one default for every company)" | OK. |
| `ValuationTab.tsx:67-69` | "No DCF: <reason>" | OK; reasons below. |
| `ValuationTab.tsx:72-74` | scenario note | OK; no test reads it (N7). |
| `ValuationTab.tsx:88`, `:104` | "Bear (higher discount rate, lower growth)", "Bull (lower or equal discount rate, higher growth)" | OK; "lower growth" omits that the bear terminal growth is capped (N6). |
| `ValuationTab.tsx:143-146` | "FCFE model: the cash flow is Yahoo's `freeCashflow` field, treated here as cash available to equity holders with no net borrowing. The vendor's exact definition is not verified ... The 9% default is one placeholder ... Shares are Yahoo's `sharesOutstanding`." | Hedge is right. Three nits (N4): states the cash flow IS the `freeCashflow` field even when `fcf0Source` says the statement fallback fired (the fallback is live code, "dead in production" rests on a vendor-shape memory note I did not verify); "9%" hardcoded in prose while the default lives in four places; "shares" does not say basic and undiluted, which the accountant rule on dilution wants stated. |
| `SummaryTab.tsx:179-180` | "No band: <reason> The remaining anchors (analyst target, forward-earnings heuristic) are not a valuation on their own." | Inconsistent with the unrefused case (2.3 point 1). Reword. |
| `:128` | "The company's sector and industry are unavailable, so whether an FCF DCF applies cannot be checked." | OK. |
| `:131`, `:139` | "An FCF DCF does not apply to X: the balance sheet is the product (deposits, reserves, borrowings), so cash flow cannot be separated from financing." | True for banks, insurers, capital markets, mortgage lenders. **Overclaims** on the default-refuse branch (an unrecognised label, or industry missing under Financial Services), where the platform knows only that the label is not on its list, and on `Shell Companies` (a SPAC has a trust account, not deposits). Say "is not on this platform's list of Financial Services industries where cash flow can be separated from financing" for those branches (N3). |
| `:134` | "Yahoo files lenders or leveraged investment vehicles under this label alongside fee businesses, and no field separates them." | Unverified vendor taxonomy claim (2.1). |
| `:268` | currency refusal | OK. States the model does not convert currencies or ADR ratios, which is true. |
| `:272`, `:273` | no positive FCF; no shares | OK. |
| `:276` | "within 2 points of terminal growth, where the terminal value swamps everything and diverges; widen the gap" | Fires at exactly 2.0 points for 3 slider cells (N5). "Diverges" is true only at zero. |
| `:186` | scenario-order note | OK. |
| `priceBands.ts:74` | "median of N anchor(s) (labels used)" | OK. |

## New findings

| ID | Severity | Blocking | Finding and fix |
|---|---|---|---|
| R1 | LOW | no | Note `:59` "Goldens are unchanged at the defaults (the bull rate is 8% either way)" sits under Tests and is scoped by its own parenthetical to the S1 scenario-rate change. I checked: the DCF golden numbers (146.538889, 96, 205.6943245) are identical at `d1769f8` and at HEAD, and at the originally gated `5b73c05`, so the sentence is true for the revision it describes. Against `main` the goldens did move by +$15/sh (bear 81 to 96, base 131.54 to 146.54, bull 190.69 to 205.69), and that is disclosed at note `:9` and at `buildFundamentalsPayload.test.ts:230-235`. Fix: say "the S1 change leaves the default goldens unchanged; the +$15 came from removing the bridge, see the test comment". I first rated this blocking; the check above is why it is not. |
| N1 | LOW | no | Partial classification still fails open. Probed: sector `Real Estate` with industry absent runs a DCF (a mortgage REIT with a missing industry would pass); sector absent with an unrecognised industry label runs. Both are narrower than the B2 cases and the fix I proposed (refuse Financial Services without industry) was implemented as asked. Fix: refuse when either field is missing and the other is `Real Estate` or unrecognised, or record as a residual with a passing test. |
| N2 | MEDIUM | no | Currency check fails open on an unknown quote currency. `quote()` is wrapped in `.catch(() => null)` (`route.ts:87-91`); when it fails but the chart succeeds, `quoteCurrency` is null and a TWD reporter runs a DCF against a price from the chart (probed: `TWD`, quote currency `null` or `''` gives DCF). Same when `financialCurrency` is absent. This is the B2 rule ("unknown must refuse") in a new place. Fix: second source `chart.meta.currency` (already fetched), then refuse with a reason if reporting currency is known and quote currency is not; add a "CANNOT do" test for absent `financialCurrency`. Also log share-count/ADR-ratio reconciliation (a USD reporter whose ADR ratio is not 1:1 passes this check). |
| N3 | LOW-MEDIUM | no | (a) default-refuse and `Shell Companies` reason overclaims (sentence audit). (b) Refused names lose bands; other DCF-unavailable names keep them (2.3). Decide and record. |
| N4 | LOW | no | UI says the cash flow is the `freeCashflow` field regardless of `fcf0Source`; render the source or say "or, if absent, the last annual statement". State basic vs diluted shares. |
| N5 | LOW | no | Spread guard float noise. `q.wacc - q.terminalGrowth < MIN_RATE_SPREAD` is evaluated on doubles: `0.06-0.04`, `0.055-0.035`, `0.045-0.025` give 0.019999999999999997 and are refused; `0.05-0.03`, `0.065-0.045` give 0.020000000000000004 and run. Three of the six slider-reachable exact-2pp cells refuse and three run (250-cell sweep, 3 disagreements). Mutation M18 (`<` to `<=`) survives, so the boundary is unpinned. The author already uses a `1e-12` tolerance in a test (`buildFundamentalsPayload.test.ts`, the bull-spread assertion). Fix: compare with `MIN_RATE_SPREAD - 1e-9` and pin both sides. |
| N6 | LOW | no | Show the bear terminal growth (or the 2% cap) next to the Rate column. |
| N7 | LOW | no | Test gaps from the mutation run: M12 survives (the scenario note is rendered by nothing the tests read); no test for partial classification (N1) or unknown quote currency (N2); `researchScore.total` of a refused name is not pinned. |
| N8 | LOW | no | B1 asked for `researchScore.total` pinned for a refused name; the pillar is pinned, the total is derived from it. One line. |
| N9 | LOW | no | `.claude/agents/accountant.md` bullet under DCF DISCIPLINE still says "Callers do supply [netDebt] when the balance-sheet module is present. Open question you own ... see Q-086." False after this PR, two lines below the corrected one. Parent agent to edit (I do not edit agent config). |
| N10 | MEDIUM (backlog) | no | Quality pillar leverage penalty applies to refused Financial Services names (2.3 point 3). Route through Q-083; belongs with Q-147. |
| N11 | LOW | no | S9 follow-up: restore CRLF on `app/api/fundamentals/[ticker]/route.ts` (173 CR lines before, 0 after; 352 diff lines for 8 real), or isolate the EOL change in its own commit. |
| N12 | LOW | no | `$` is hardcoded in `ValuationTab.tsx` and `SummaryTab.tsx`. Now that the currency check lets an EUR reporter quoted in EUR through, a euro value renders with a dollar sign. Pre-existing. |
| N13 | LOW | no | Note `:50-55` says deferrals are "each logged" with L-numbers; the rows exist as Q-146 and Q-147 on `chore/backlog-2026-10-17` (commit `3a9bf6a`, not an ancestor of this branch). Cite the ids and merge order. Not logged anywhere: ADR ratio reconciliation (N2), the terminal-growth ceiling (S2), N10. |

## Classification matrix (probed through the real `buildFundamentalsPayload`; shares, positive FCF, USD/USD present)

| Input (sector / industry) | Outcome | Bands |
|---|---|---|
| no profile at all; `summaryProfile: {}` plus `assetProfile` Banks - Regional; Financial Services with no industry; `industryKey` only | refused | null |
| Banks - Regional (also with en dash, NBSP, or sector absent), `Banks`, `Insurance`, Insurance - Life (en dash), Shell Companies | refused | null |
| Real Estate / REIT - Mortgage (also with sector absent) | refused | null |
| Financial Services / Credit Services; Financial Services / Asset Management | refused (mixed-label reason) | null |
| Financial Services / Insurance Brokers (also sector absent; also ` INSURANCE  BROKERS ` with lower-case sector) | DCF runs | drawn |
| Financial Services / Financial Data & Stock Exchanges | DCF runs | drawn |
| Real Estate / REIT - Industrial | DCF runs | drawn |
| Technology / no industry | DCF runs | drawn |
| **Real Estate / no industry** | **DCF runs** (N1) | drawn |
| **no sector / Specialty Lending** | **DCF runs** (N1) | drawn |
| Industrials / Rental & Leasing Services; Consumer Cyclical / Auto Manufacturers; Utilities / Regulated Electric | DCF runs (residual 2.2c) | drawn |

Currency, same harness: TWD reporter with USD quote refused; GBP reporter with GBp quote refused; lower-case `usd` vs `USD`
refused; EUR/EUR runs; **TWD reporter with quote currency `null` or `''` runs (N2)**; `financialCurrency` absent runs.

## Scenario table re-run (my first-gate Q2 probe, current code)

FCF 100, 10 shares, terminal growth 2.5%, growth 2/5/9%. Compare the first-gate rows for 4 to 6%, where bull sat below or equal to base.

| Input rate | Bear / base / bull rate | Value per share | Terminal share | Ordered |
|---|---|---|---|---|
| 4.5% | 6.00 / 4.50 / 4.50 | 255 / 576 / 690 | 83 / 91 / 92% | yes |
| 5.0% | 6.50 / 5.00 / 4.50 | 227 / 460 / 690 | 81 / 89 / 92% | yes |
| 6.0% | 7.50 / 6.00 / 5.00 | 185 / 328 / 550 | 77 / 85 / 90% | yes |
| 7.0% | 8.50 / 7.00 / 6.00 | 157 / 255 / 391 | 73 / 81 / 86% | yes |
| 9.0% | 10.50 / 9.00 / 8.00 | 120 / 176 / 247 | 67 / 75 / 79% | yes |

The bull value no longer pins at 391. At 4.5% the bull rate equals base, the scenario note says so, and the value is
still ordered because the growth input differs. Spread 0.0501 vs 0.05 by URL is refused.

## Mutations (scratch copy; the harness asserts the target string exists once before applying)

Killed (19): bands not nulled on refusal; Insurance Brokers swept into the insurance regex; Financial Services
allowlist branch off; `assetProfile` ignored; spread guard off; old absolute 6% bull floor; currency mismatch off;
route drops the quote currency; mixed-label regex off; unavailable-classification early return off; terminal-share
column blank; Summary refused branch removed; methodology fixed list; non-positive fallback FCF returned; REIT -
Mortgage not refused; Financial Conglomerates not refused; MIN_RATE_SPREAD 0.01; bear terminal growth cap off;
exchanges removed from the allowlist.
Survived (2): M12 scenario note never rendered; M18 spread guard `<` to `<=`.
The author's "equivalent mutant" (Credit Services on the allowlist) is equivalent by reading: `MIXED_INDUSTRY` returns at
`:133-135` before the allowlist branch at `:136`.

## Unverified, and what I did not do

- Yahoo's industry labels for specific tickers (which companies sit under Credit Services, Asset Management, Financial
  Data & Stock Exchanges). The repo holds no label list. The universe-membership claim in the note is consistent with the
  repo's ticker lists; the labels themselves are the author's probe, which I could not repeat offline.
- That the balance-sheet and cash-flow statement modules are empty for the four tickers measured (note `:9`); rests on
  the author's probe and a memory note.
- That `financialData.freeCashflow` is an after-interest figure. Still unverified, and the UI now says so.
- The chapter numbers cited from Damodaran (2012); recalled, not opened.
- No network calls were made. No vendor values appear in this report.

## Escalations

- **Q-083 (MAS/FAA):** the Summary tab band/signal surface changes for refused names (reduced, not widened). N10 (the score's leverage penalty on refused names) belongs there.
- **credit-analyst:** none; nothing here rates solvency. If a debt bridge is ever restored it needs a screen first.
- **quant-validator:** none; no accounting metric is used as a return-predictive factor (`fundamentals-tripwire.test.ts` passes).
- **Parent agent:** N9, an edit to `.claude/agents/accountant.md`.
