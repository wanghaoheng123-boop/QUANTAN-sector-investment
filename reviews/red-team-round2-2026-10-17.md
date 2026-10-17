# Red team round 2 — PRs #241, #242, #243 (new) and fixes #234, #236, #238, #239 (2026-10-17)

Reviewer: red-team agent (adversary). Findings are appended as each is confirmed.
Every mutation was run inside the PR's own worktree and restored with `git checkout -- <file>`.
No commits, pushes, PR actions or ledger edits were made.

---

## PR #243 — Q-142 locale (`fix/q142-locale-hydration`, worktree `q142b`, HEAD 3da03a2)

### R2-243-1 · MEDIUM · `__tests__/architecture/locale-fixed.test.ts:26-27` — the guard misses the commonest "with options" spelling, and H1 comes back on the same component with the guard green
**Claim attacked (PR body, commit):** "`locale-fixed.test.ts` forbids the bare form across `app/`, `components/`, `hooks/` and `lib/`."
`BARE_LOCALE` matches `toLocale*()` only with an **empty** argument list, and `Intl.*` only after `new` and only with `()` or a literal `undefined`. Each form below formats in the process locale and passes the guard:

| form | guard | output under en_US / de_DE / fr_FR (`node`, `LANG=…`) |
|---|---|---|
| `n.toLocaleString(undefined, { maximumFractionDigits: 0 })` | MISSED | `-600,000` / `-600.000` / `-600 000` |
| `n.toLocaleString([], {…})` | MISSED | same three outputs |
| `Intl.NumberFormat().format(n)` (no `new`, which is legal) | MISSED | same three outputs |
| `n.toLocaleString(void 0)` | MISSED | same three outputs |
| `d.toLocaleDateString('default', { month: 'long' })` | MISSED | `January` / `Januar` / `janvier` |
| `const loc = undefined; new Intl.NumberFormat(loc)` | MISSED | (default locale) |
| `n?.toLocaleString?.()`, `Number.prototype.toLocaleString.call(n)` | MISSED | (default locale) |
| `new Intl.Collator()`, `new Intl.ListFormat()`, `s.toLocaleUpperCase()` | MISSED | (outside the regex's name list) |

The probe applied the guard's own `BARE_LOCALE` and `stripComments` to each string.
**Reproducer on the real tree:** in `components/risk/TailRiskBanner.tsx:45` I replaced `portfolioVegaUsd.toLocaleString(UI_LOCALE)` with `portfolioVegaUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })`, which is exactly H1 again. Then `npx vitest run __tests__/architecture/locale-fixed.test.ts` → `Tests 3 passed (3)`. The file was restored.
Control: putting `toLocaleString()` back inside the template literal in `lib/portfolio/tailRiskAlerts.ts:34` does fail (`+ "lib/portfolio/tailRiskAlerts.ts: .toLocaleString()"`), so template literals are visited. The miss is in the regex, not in the walk.
The positive control (`:43`) checks `new Intl.DateTimeFormat(undefined, {})` and **not** `toLocaleString(undefined, {})`, so it tests the regex's alternation rather than the space of inputs. This is the guard-reachability lesson in its "unvisited region of the input space" shape. **Live instances:**
- **`toLocale*`/`Intl.*`:** none. Every such call in `app components hooks lib` passes a literal `'en-US'`/`'en-CA'` or `UI_LOCALE`.
- **`localeCompare` with no locale:** four calls, none governed by the guard (`app/commodities/page.tsx:76`, `app/ma-deviation/page.tsx:213`, `components/backtest/LiveSignalsPanel.tsx:162`, `lib/mockData.ts:91`).
  - Three sort data that arrives after hydration.
  - The fourth does not. `app/commodities/page.tsx:73-77` sorts the constant `COMMODITY_INSTRUMENTS` inside a render-time `useMemo`, so the sort runs at SSR.
  - I tested about 56 collations. Only `haw` (Hawaiian, which sorts vowels first) reorders the 12 tickers: en-US gives `BNO,CORN,…,WEAT` and haw gives `UNG,USO,BNO,…`. So a `haw` browser would hydrate a different row order. This is real but exotic.

**Severity:** MEDIUM, matching round 1's S3. Both are a guard that visits the right files but cannot see the form, and neither has a live instance of the formatting defect. It is not LOW, because the guard is the only committed artifact for H1's property: the three-locale render was a manual probe and is not in the suite.
**Fix:** turn it into an allowlist. Flag every `toLocale*` / `Intl.<Ctor>` call (with or without `new`) whose first argument is not a string literal or the identifier `UI_LOCALE`, and add `localeCompare`/`Collator` if sorting is in scope. Add the forms above as positive controls. Better still, commit the H1 probe: render each SSR'd client component in child processes under ≥2 `LANG` values and require byte-identical markup.

### R2-243-2 · MEDIUM · `__tests__/architecture/locale-fixed.test.ts:13-14` + `lib/format.ts:244-257` — the guard's prescribed fix is viewer-ZONE dependent, so the Q-142 #418 class can return on any SSR'd path with every guard green
**Claim attacked (guard header):** "Pass `UI_LOCALE` … or use formatLocalTime / formatLocalDateTime / formatEtDateTime". The header says the rule is structural "rather than only on SSR'd paths". But the two new helpers format in the **viewer's** zone. So does `new Date(x).toLocaleString(UI_LOCALE)`, which the guard accepts. The only zone check is `briefTimeHydration.test.tsx`, and it renders BriefCard and LiveBriefClient only.
**Reproducer:** in the SSR'd `components/risk/TailRiskBanner.tsx` I imported `formatLocalDateTime` and appended `As of {formatLocalDateTime("2026-10-01T15:15:00Z")}.`.
- `locale-fixed.test.ts` → `Tests 3 passed (3)`.
- `renderToStaticMarkup(<TailRiskBanner/>)` under three zones:
  - `TZ=UTC` → `"As of 10/1/2026, 3:15:00 PM UTC."`
  - `TZ=Asia/Singapore` → `"As of 10/1/2026, 11:15:00 PM GMT+8."`
  - `TZ=America/New_York` → `"As of 10/1/2026, 11:15:00 AM EDT."`

That is a server/browser text mismatch, which is React #418. The file was restored.
No live instance exists: every current `formatLocal*` call reads client fetch state that is null at SSR (re-checked against the earlier report's enumeration, and the seven server pages are unchanged). The guard is named "fixed locale" and is accurate about locale. The defect is that its header recommends these helpers with no SSR caveat. The helpers' own docstring ("For client-side 'fetched at' stamps") is the only fence, and nothing executes it.
**Fix:** state the zone caveat in the guard header, then choose one of these:
- **A mount-gated hook.** `useLocalTime(v)` holds `useState<string>('—')` and sets the formatted time in `useEffect`. The server and the first client render then both print `—`, and the time appears after mount.
- **`suppressHydrationWarning`** on that single text node. This is only acceptable where the stamp is the node's entire content: React will not patch it, so the server's zone text stays until the next re-render.
- **The test extension.** Render every SSR'd client component (the `TailRiskBanner` set) under ≥2 zones and require identical markup.

*Corrected before handoff:* an earlier draft proposed a `typeof window === 'undefined'` branch inside the helper. That would itself cause #418, because the client's hydration render runs with `window` defined and returns the time while the server printed `—`, and a pure helper cannot defer anything to an effect.

### R2-243-3 · LOW · `lib/format.ts:237-241` — the helpers' fail-closed path (`'—'` for null, empty or invalid input) has no test
**Reproducer:** I mutated `toDate` to `if (false) return null` and `return d`, so null and invalid input become a Date. Then I ran every suite that imports `lib/format` (`one-freshness-vocabulary`, `briefTimeHydration`, `format.test.ts`, `__tests__/format/*`) → `Test Files 6 passed (6), Tests 62 passed (62)`. Under that mutation `formatLocalTime(null)` would render `7:30:00 AM GMT+7:30` (the epoch in Singapore's 1970 offset), which is I2's "missing shown as data". Every call site currently guards for truthiness first, so this is latent. The file was restored.
**Fix:** unit-test `formatLocalTime`/`formatLocalDateTime` with `null`, `undefined`, `''`, `'garbage'`, `NaN`, and a valid stamp.

### R2-243-4 · LOW · commit title "stamps name EDT/EST"; `lib/api/marketHours.ts:193-202`
`formatNySessionStamp`, the stamp `DataFreshnessIndicator.tsx:121` renders, still appends a literal `" ET"`. Measured: `2026-11-01T05:30Z` and `06:30Z` both give `Sun 01:30` + ` ET`. The PR body scopes H2 to `formatEtDateTime`, and that scope is accurate. The commit title over-generalises. The impact is small, because equities are closed at that hour.
Other residuals of the guard:
- It enumerates `git ls-files`, so a new untracked file is invisible until `git add`.
- It reuses the regex `stripComments`. I measured zero blind regions on the current tree (I compared hit counts against `ts.transpileModule({removeComments:true})` output for all 237 files), so that is latent only.

#### #243: checked and found TRUE
- **H1 fixed:** `renderToStaticMarkup(<TailRiskBanner/>)` under `LANG` en_US, de_DE and fr_FR gives `vega -600,000 USD | vega -600,000 USD` all three times. Before the fix the earlier report measured `-600.000` and `-600 000`.
- **"All 13 bare sites":** the diff touches exactly 13 call sites. A grep of every `toLocale*`/`Intl.` call in `app components hooks lib` finds no zero-argument or `undefined`-locale form left.
- **H2:** `formatEtDateTime('2026-11-01T05:30Z')` gives `… EDT` and `06:30Z` gives `… EST`. The output is zone-invariant (the existing three-zone test passes, 12/12 with the guard). The formatter still assembles from parts, so no ICU separator leaks in.
- **Restoring the bare call fails the guard:** TRUE for the zero-argument spelling, both in JSX and in a template literal (see R2-243-1 for the spellings it misses).
- **`nextFundingTime`** is an ISO string or null from `app/api/crypto/btc/metrics/route.ts:115`. A bad value now renders `—` where it used to render `Invalid Date`.

- **"commodities is kept CRLF":** TRUE. `git show HEAD:app/commodities/page.tsx` has 182 CRLF lines out of 182.

#### #243: not re-verified
- The suite total (2587 passed / 17 skipped). I ran only the guard, `briefTimeHydration`, and the six suites that import `lib/format`.
- `tsc` (not run here). CI (not inspected). No Vercel build or preview.
- The behaviour of browser ICU for `timeZoneName:'short'` in `formatLocal*`. I measured only Node 25 (ICU 78).

---

## PR #242 — Q-090 news source labels (`fix/q090-news-source-labels`, worktree `q090`, HEAD 9891277)

**Method.** I read `sourceLabel.ts`, `NewsSourceBadge.tsx` and both consumers. Then I pulled real items read-only from production: `GET /api/news/<sector>` for all 11 sectors and `GET /api/news/ticker/<T>` for 12 tickers (AAPL TSLA NVDA JPM XOM PFE KO PLTR SOFI MSTR RIVN GME), about 06:22Z today. I labelled every item with the PR's `sourceLabel`: **284 items, 36 distinct publishers.**

**Can a label be upgraded?**
- **`kind`: no.** It is only ever `press-release`, `commentary` or the badge-less `reported`, so no publisher string can earn more than the default.
- **`via`: yes, for a hostile link.** `viaOf` parses the link without checking the scheme (R2-242-3).
- **Unbadged items: yes, implicitly, and measured.** A press release the list does not know is shown exactly like reported news (R2-242-1).

### R2-242-1 · MEDIUM · `lib/news/sourceLabel.ts:29,32` — the badge lists are hand-written, and on today's production data a press-release service and two opinion outlets carry no badge
**Claim attacked (PR body):** "Issuer press-release services get a **Press release** badge and opinion outlets get a **Commentary** badge."
Real items, as labelled by the PR:
- **Badged correctly:** `Business Wire` ×2, `PR Newswire` ×2, `ACCESS Newswire` ×1 → `press-release`. Nine commentary outlets (180 items) → `commentary`.
- **`CNW Group` ×2 → `reported` (no badge).** CNW is Cision's Canada Newswire, an issuer-paid distribution service. The two items are "FSRA issues notice of proposal against Renkai Lin and ZK Financial Inc." (a regulator's release) and "Rocket Thrusters on a Road Car Arrive as EV Makers Split Into Winners and Laggards" (sponsored copy). So **2 of the 7 press releases sampled (29%) render as ordinary reported news.**
- **`TIKR` ×12 and `Schaeffer's Investment Research` ×1 → `reported`.** Titles include "SoFi Stock Is Down 46% Over the Past Year. Buy Now or Wait for Q3?" and "SOFI Rally Could Be a Dead Cat Bounce, Per Signal". These are opinion pieces, shown unbadged next to badged Motley Fool items.
- **Also unbadged:** `Cision`, `PRWeb`, `EQS Group`, `TheNewswire`, `Newswire.ca`, `Proactive`. Variants that dodge the regex are unbadged too: `Globe Newswire` (NBSP, where ` ?` matches only U+0020) and `PR​Newswire`.

Downgrade-only holds for each label. The **set** does not: 65% of today's items carry a badge (185 of 284: 180 commentary, 5 press release), so a missing badge reads as "not a press release, not opinion". That is a negative claim the code never checked.
**Fix:**
- Add CNW/Cision/PRWeb/EQS/TheNewswire/Newswire.ca to `PRESS_RELEASE`, and TIKR/Schaeffer's to `COMMENTARY`. Normalise `\s` and strip zero-width characters before matching.
- Make the unclassified state visible ("Unclassified source"), so that no badge is never read as a classification.
- Add a test that runs the labeller over a committed snapshot of real publishers and fails on any publisher not yet classified.

### R2-242-5 · LOW · `lib/news/sourceLabel.ts:32,51` — "Commentary" is decided per publisher, so factual news items carry an opinion label
I answered the brief's "false statement about a publisher" question in both directions. Of the 146 distinct commentary-badged titles in today's sample, several are plainly factual reports:
- GuruFocus: "Ryan Cohen Buys Another $22.8 Million of GameStop Stock", "KFC Switches From Pepsi to Coca-Cola as Coke Gains U.S. Market Share", "State Street Industrial Select SPDR (XLI) Sells Caterpillar and GE on Oct. 14".
- Zacks: "Rio Tinto Reports 2% Y/Y Increase in Q3 Iron Ore Shipments", "TFC Q3 Earnings Miss Estimates as Securities Losses, Higher Costs Hurt".
- Stocktwits: "Strategy Pushes Back Against MSCI Index Exclusion Proposal, Calls Rules 'Discriminatory'".

This is the documented safe direction: it lowers trust and never raises it. But the badge asserts something about the item's content that the code never examined, and "Commentary" on an earnings miss is a false label.
**Fix:** reword the badge to say what was checked ("From an opinion/analysis outlet") rather than classifying the item, and state the publisher-level basis in the tooltip.
The other direction is clean. All 5 press-release-badged items (4 distinct titles: an earnings-date notice, a dividend declaration, an awards finalist and an event-participation release) are genuine issuer releases. **No false press-release label was found.**

### R2-242-2 · LOW · `app/briefs/sector/[sector]/LiveBriefClient.tsx:238` — one of the two claimed consumers is unpinned
**Mutation:** I reverted `<NewsSourceBadge publisher={item.publisher} link={item.link} />` to the old `<span …>{item.publisher}</span>`. Then I ran every test that names `LiveBriefClient`, `NewsSourceBadge` or `sourceLabel` (`briefTimeHydration`, `newsSourceLabel`, `urlValidation`) → `Tests 40 passed (40)`. The file was restored. "One shared badge … used by NewsFeed and the sector brief" is tested only for NewsFeed.
**Fix:** in `briefTimeHydration`, assert that the brief markup contains `via example.com`. The fixture's news item already reaches the badge (see the TRUE list).

### R2-242-3 · LOW · `lib/news/sourceLabel.ts:39-46` — `viaOf` ignores the scheme, so a link the page refuses to render can still be credited to Yahoo
`sourceLabel('Reuters', 'javascript://finance.yahoo.com/%0aalert(1)').via` → `"Yahoo Finance"`, while `safeHref` of the same link → `#`. The same happens with `ftp://finance.yahoo.com/x`. With `javascript:alert(1)` or `data:…`, `via` is `""`, so the badge renders a bare `via ` with no source: missing data shown as blank rather than as "unknown source". The input comes from Yahoo's API, so this is not realistically exploitable. But the field is documented as "who actually served the item" and it asserts that without checking.
**Fix:** use `isSafeHttpUrl(link)` before parsing, and return `'unknown source'` otherwise, including when the hostname is empty.

### R2-242-4 · LOW · pre-existing, on the surface the PR names as next — `app/api/briefs/route.ts:125` substitutes `'Yahoo Finance'` for a missing publisher
`publisher: String(item.publisher ?? 'Yahoo Finance')` feeds the landing page's list (`app/page.tsx:582`). The PR body says that list "follows once #239 merges". A missing publisher therefore already renders as a named one, indistinguishable from the three genuinely Yahoo-authored items in today's sample. Once the badge is adopted it would read "Yahoo Finance via Yahoo Finance". The other two producers use `'Unknown'` (`app/api/news/[sector]/route.ts:84`, `lib/briefs/sectorBrief.ts:301`). Nothing on this branch records the follow-up, and I found no backlog row for it.
**Fix:** make it `?? null` and let `sourceLabel` show "Unknown publisher". Record the landing-page follow-up as a Q-row.

#### #242: checked and found TRUE
- **"All links are finance.yahoo.com":** TRUE and broader than claimed. 284 of 284 production items today resolve to `via Yahoo Finance`, against the PR's 77 of 77.
- **The spoof direction:** `'Reuters via PR Newswire'` → `press-release`.
- **SSR is covered:** `briefTimeHydration`'s fixture carries a news item (`publisher:'Wire'`, `link:'https://example.com/a'`). Planting `Intl.DateTimeFormat('en-US').resolvedOptions().timeZone` in the badge → `1 failed | 7 passed (8)`. The badge itself has no viewer-dependent output.
- **Cross-PR merges:** `git merge-tree --write-tree` of #242 with #243, and of #241 with #242, merges cleanly. In the #242+#243 merged tree, `NewsFeed.tsx` carries both the badge and `formatLocalTime`. The #242 diff adds no `toLocale`/`Intl` call.

#### #242: not re-verified
- The "3 mutations, all killed" claim (I ran different mutations).
- "architecture tests 440/440" and `tsc` (not run).
- CI.

---

## PR #241 — Q-141 BTC lab interval (`fix/q141-btc-lab-interval`, worktree `q141`, HEAD 5898967)

### R2-241-1 · MEDIUM · `components/crypto/BtcQuantLab.tsx:438` (renders `lib/quant/technicals.ts:217-277`) + `__tests__/components/crypto/BtcQuantLabInterval.test.tsx:31-32,43` — on 1-hour bars the regime card still says "200-day SMA", and the PR's test is green beside it
**Claim attacked (PR body):** "On anything but daily candles it reads '200-bar MA regime (1-hour bars)'". Only the heading and the `200DMA` stamps follow the interval. The paragraph under them is `regime.dipSignalExplained`, and every branch of `ma200Regime` hard-codes "200-day SMA". So one card states both units.
I rendered BtcQuantLab with `interval='1h'` (jsdom, Analysis tab):
- **Uptrend:** "…8% above the **200-day SMA**." and "No dip signal — standard hold/**accumulate**-on-correction posture." These appear beside the new caution, which says "this is a 200-bar average, not the 200-day moving average".
- **Dip with a falling MA:** "…3% below **200-day SMA** but the 200MA slope is NEGATIVE…".

The PR's own test fixture produces the uptrend text. Its negative checks are `/200DMA/`, `/200-Day MA Regime/` and the case-sensitive `/…|Accumulate|…/`, so they pass on a page that contains "200-day SMA" and "accumulate". I tightened them in place: added an `i` flag and `expect(document.body.textContent).not.toMatch(/200-day SMA/)` → `2 failed | 2 passed (4)`. The test file was restored. This is a test ratifying the defect it names.
The trade-action wording in the same card and its signals row is a separate finding, R2-241-3.
**Fix:**
- Pass the bar unit into `ma200Regime`, or into a presentation wrapper, so that every explanation names the bars.
- Off daily, either suppress `dipSignalExplained` and the dip label, or prefix them with the caution.
- Make the test's banned-word regex case-insensitive, and include "200-day".

### R2-241-3 · HIGH (pre-existing text, not a merge blocker) · `lib/quant/technicals.ts:217-277` rendered at `components/crypto/BtcQuantLab.tsx:438`; `BtcQuantLab.tsx:267` — the regime card this PR rewrote still issues trade instructions, on any bar size
This is the same shape as round 1's S1, which was rated HIGH. The PR rewrote the card's heading, added a caution under it, and its test bans the rainbow trade words ("Accumulate", "Sell Peak", "Deep Value"). Directly beneath the rewritten heading, `regime.dipSignalExplained` still renders instructions:
- "this is a textbook high-probability buy zone … consider scaling in" (`technicals.ts:224`);
- "standard hold/accumulate-on-correction posture" (`:220`, rendered on 1-hour bars in my probe and in the PR's own test fixture);
- "Avoid averaging down until 200MA slope turns positive" (`:253`);
- "Avoid long exposure until 200MA slope inflects positive" (`:264`);
- "Only the most aggressive contrarian positioning is warranted" (`:277`).

The signals table shows `BUY THE DIP` (`BtcQuantLab.tsx:267`). Since this PR, all of it is computed from a classifier calibrated on daily data and applied to whatever interval is loaded, down to 1-minute bars. The "indicative only" caution sits under the card and does not reach the signals row.
Under CLAUDE.md's regression-vs-gap rule this is **pre-existing**: `git show origin/main:lib/quant/technicals.ts` has the same strings, so it does not block the merge. It is HIGH for the reason S1 was:
- it is trade-action and timing wording on the surface `Q-083` (MAS/FAA) gates;
- the PR edited the adjacent text, and its own banned-word test passes beside it.

I found no ledger row for this text. `Q138-R2` mentions `BUY THE DIP` only as the neighbour of the liquidation card.
**Fix:**
- Rewrite `dipSignalExplained` and the `:267` signal labels as descriptions, e.g. "price is N% below a falling 200-bar average", with no buy, add, avoid or positioning verbs.
- Off daily candles, suppress the dip classification entirely.
- Extend the test's banned-word scan case-insensitively to `buy|scaling in|accumulate|avoid long|positioning`.

### R2-241-2 · LOW · `components/crypto/BtcQuantLab.tsx:400,367`; `lib/barInterval.ts:19`
- **NaN in the sub-line.** A NaN last close renders the card as `—`, but its sub-line reads `Of the last 20 daily closes' low–high range ($NaN–$NaN)`. That is I2's "missing shown as data" (rendered, jsdom). Guard the sub-line on `rangePosition != null`.
- **Stale explainer.** The explainer at `:367` still lists "the moving-average regime and the band stage". The only "Stage" card was the deleted Rainbow Stage.
- **Interval casing.** `isDailyInterval` is an exact `'1d'` match. `interval='1D'` renders "200-bar MA regime (1D bars)" plus a caution that daily candles are not daily. The page passes `TIMEFRAMES` values (`'1d'`), so this is unreachable today, but the module is documented as general-purpose.

#### #241: checked and found TRUE
- **Deletions are complete.** `git grep -i "getRainbowBand|RAINBOW_BANDS|rainbow"` across the tree (excluding `reviews/`) hits only `tinyrainbow` in `package-lock.json`. `AGENTS.md`, `docs`, `scripts` and `__tests__` are clean.
- **Types and tests.** `npx tsc --noEmit -p .` → exit 0, no errors (1234 files; incremental). `BtcQuantLabInterval` plus `cryptoIndicators` → 32 passed.
- **`rangePosition` hostile inputs:**
  - fewer than 30 candles is gated ("Quant signals need at least 30 candles");
  - `high20 == low20` → `—`;
  - the window `closes.slice(-20)` includes the latest close, so the value stays within 0–100%.
- **Unknown interval falls back to the raw string** ("200-bar MA regime (3d bars)") and is not mislabelled as daily. Weekly and monthly get the caution, and monthly with fewer than 200 bars reports the count.
- **The page passes `interval={activeRange}`.** The values are the BtcTabBar `TIMEFRAMES` keys, which match the `LABELS` keys including the `1m`/`1M` case split.
- **Cross-PR.** The `+` lines use `'en-US'`. Merged with #243, `BtcQuantLab.tsx` merges cleanly, keeps both `formatLocalTime` sites and has 0 bare `toLocale*` forms.

#### #241: not re-verified
- The "3 mutations, all killed" claim. "architecture tests 436/436". CI.

## Part B — round-2 checks of today's fixes

### #234 dead-code (worktree `deadcode`, fix commit 0932183)

**Round-1 findings: D1–D5 confirmed fixed.**
- **D1 fixed.** Original reproducer: I replaced `import BriefCard from './BriefCard'` in `app/briefs/page.tsx` with a local stub. The guard went from `6 passed` before the fix to `× no product module is unreachable`, `+ "app/briefs/BriefCard.tsx"`, `1 failed | 8 passed (9)`.
  - New attack: `NEXT_ENTRY` matches whole basenames, not substrings.
  - Using `findOrphans` on virtual files, each of these planted orphans is flagged unreachable and is not an entry: `app/x/SubPage.tsx`, `app/x/page.helpers.tsx`, `app/x/routeHelpers.ts`, `app/page/Orphan.tsx`, `app/x/Layout.tsx`, `app/x/page.stories.tsx`, `components/page.tsx`, `lib/route.ts`.
  - `app/x/page.mjs` is also flagged. That is a false positive, but in the fail-closed direction.
- **D2 fixed.** Original reproducer: I stubbed the `multiTimeframe` import in `lib/backtest/signals.ts:16` → `× … reachable only from tests`, `+ "lib/quant/multiTimeframe.ts"`.
- **D3 fixed.** The barrel is gone from `lib/backtest/engine.ts`. `git grep walkForward -- lib app scripts components hooks` hits only a comment in `engine.ts:3`. The module is in `TEST_ONLY_PENDING` with its reason, and "re-export whose names nobody imports" is in the CANNOT-see list.
- **D4 fixed for comments.** It is **named, not fixed, for strings**. Planted `const s = "import('@/lib/__dead2')"` → `unreachable: []`, so the dead module is kept alive. That matches the new CANNOT-see bullet "a reference inside a STRING literal", so the claim is accurate.
- **D5 fixed.** `AGENTS.md` now credits #232 (`:114`). `.env.example:64` is deferred to the owner, which is consistent with the no-`.env`-edits rule.
- The guard plus the two moved tests: `Test Files 3 passed, Tests 38 passed`.

#### R2-234-1 · LOW · `CLAUDE.md:360` — the constitution now cites a re-export this PR deleted
I4 says "`lib/backtest/engine.ts:239-240` re-exports it and nothing in `app/` or `scripts/` calls it". On this branch, `engine.ts:236-242` is the tail of the aggregate return (`alpha, bnhAvg, excludedTickers`), and no re-export of `walkForward` exists anywhere. The commit message cites "CLAUDE.md I4 already said so" as support while making I4's citation false. The dated audit docs (`reviews/design-invariant-audit-2026-08-17/*`) are historical and can stay.
**Fix:** reword I4 to say that `walkForward.ts` has no non-test importer (`no-orphan-modules.test.ts` `TEST_ONLY_PENDING`), and drop the `engine.ts` line citation.

### #238 ledger integrity (worktree `q095`, fix commit a9673ab)

**Method.** The brief forbids editing `reviews/findings-ledger.csv`, even temporarily, so I did not mutate it in place. Instead:
- **Guard:** I replicated every assertion of `findings-ledger-integrity.test.ts` in a probe that calls the same `ledgerProblems` on the real ledger text plus an in-memory append.
- **Script:** I ran `scripts/ledger-append.mjs` against a copy in `scratchpad/ledgertmp/reviews/`. It resolves the ledger from `process.cwd()`.
- **Suites:** the guard and `__tests__/scripts/ledger.test.ts` pass, 22/22.

**Round-1 findings: L1–L5 confirmed fixed.**
- **L1 fixed.** Original reproducer, a ledger ending in `ZZ-1,…,s,"open (see note` + newline + a `ZZ-2` CRITICAL row:
  - Guard probe → `findings ledger is not valid CSV: a quoted field opened on line 382 is never closed`.
  - Script, appending `ZZ-2` → `refused — nothing written … repair it before appending`, `exit=1`, md5 unchanged.
- **L2 fixed.** An 11-column `BAD-1` row already in the file, then append `LK-1` → `refused — nothing written: existing ledger: row BAD-1: 11 columns, expected 12`, `exit=1`, md5 unchanged.
- **L3 fixed.**
  - I took the lock the script's way, wrote pid/host/time, and `kill -9`ed the holder. The next append printed `held by pid 86869 on 192.168.5.122 since … (process NOT running)` and exited 1. Nothing was written.
  - `git check-ignore -v` → `.gitignore:88:*.csv.lock`.
- **L4 fixed.** Appending `" WS-1 "` → written as `WS-1,…` (od shows no padding). A second `"WS-1"` → `refused — id WS-1 already exists`.
- **L5 fixed.**
  - An object, a string or a number as input → `rows must be a JSON array of objects`.
  - `severity:null` / `one_line:{a:1}` → both refused by type.
  - Lowercase `critical` → refused.

#### R2-238-1 · LOW · `scripts/lib/ledger.mjs:31-75` + guard — an open quote that a later stray `x",` closes still swallows a well-formed CRITICAL row
The strict parser kills the one-defect shape. A two-defect bracket still passes: one row opens a quote that it never closes, and a later row has a lone quote immediately before a comma. Probe on real ledger text plus:
```
ZZ-1,r,HIGH,d,f,l,"open (see
ZZ-2,r,CRITICAL,d,f,l,o,c,a,e,s,open
ZZ-3,r,LOW,d,f,l,tail",c,a,e,s,open
```
→ every guard assertion passes. `ZZ-1 is-row=true`, while `ZZ-2` and `ZZ-3` are not rows. ZZ-2 is itself perfectly well-formed, and it is the finding that vanished.
The append script refuses *between* the two defects, because the file does not parse while the quote is open. So only hand edits can produce the bracket. The text the parser's docstring promises to catch, a quote that "turns every row after it into the tail of one field", is still reachable.
Cheap kill: **0** fields in the real ledger contain a newline (measured), so "no field contains a newline" can be a guard rule at no cost.
**Fix:** reject `\n` inside any field in `ledgerProblems`, both for the guard and before an append.

#### R2-238-2 · LOW · `scripts/lib/ledger.mjs:111-116,140` — ids have no character rule, so two visually identical ids coexist
`trim()` does not strip U+200B. Appending `"WS-1​"` after `WS-1` → `appended 1 row(s): WS-1​`, `exit=0`, and `grep -c '^WS-1'` → 2. The guard's uniqueness check also trims, so it passes. The same applies to any invisible or confusable character.
**Fix:** require `id` to match `^[A-Za-z0-9][A-Za-z0-9._-]*$` in both the script and the guard.

### #236 Q-113 alert dedupe (worktree `q113`, fix commit 16246e1)

Suite: `npx vitest run __tests__/ci __tests__/architecture/scheduled-alerts.test.ts` → baseline `113 passed`.

**Round-1 findings confirmed fixed:** A1, A3, A4 and A5, and the decision half of A2.
- **A1 fixed.** Original reproducer, `dedupeKey: undefined` in each runner:
  - notifier → `3 failed` (`A1: does not comment on a run already on the thread`, `A1: comments once…`, `A2: a re-run…`);
  - probe → `2 failed` (`A1: does not re-report…`, `six weekly failures and 41 daily looks make six comments`).

  These counts match the commit message exactly.
- **A2 decision half fixed.** With the notifier's `alertKeyFor(runUrl, undefined)` → `× A2: a re-run that fails again is reported, once per attempt`.
- **A3 fixed.** Making `readThread` rethrow → `× A3: … makes it SPEAK` and `× A3: … speak for that workflow and carry on`.
- **A4 fixed.**
  - Newest-first: forcing `page = i + 1` → `× finds a key on the newest comment of a thread longer than the page budget`.
  - Live check of the arithmetic: `issues/177` has `comments: 45`. `?per_page=10&page=1` is the oldest (2026-09-06) and `page=5` the newest 5 (latest 2026-10-16), so page-from-count reads newest-first as claimed.
  - Delimiting: `runs/111` does not match `runs/1111`; it does match inside `[run](…/111).`; a bare first-attempt key does not match an `#attempt-2` token; `…/runs/` yields no key.
- **A5 fixed.** The replay test is killed by a probe-key mutation (M1b above), so it now depends on key parity.

#### R2-236-1 · MEDIUM · `.github/workflows/scheduled-failure-alert.yml:56-58`, `scripts/ci/notify-scheduled-failure.mjs` (main-guard `env`), `scripts/ci/workflow-heartbeat.mjs:82,206` — A2's attempt key is wired through three unpinned links, and production can lose it with every test green
**Claim attacked:** "The key now includes the attempt (alertKeyFor; ALERT_RUN_ATTEMPT from the workflow, run_attempt from the API)". The tests inject `env` and runs directly, so none of the links that carry the attempt in production is executed. Each mutation below was run singly and restored:

| mutation | result |
|---|---|
| M7: delete `ALERT_RUN_ATTEMPT: ${{ github.run_attempt }}` from the workflow | `113 passed` |
| M8: delete `ALERT_RUN_ATTEMPT: process.env.ALERT_RUN_ATTEMPT` from the runner's `env` object | `113 passed` |
| M3: probe uses `alertKeyFor(r.runUrl, undefined)` | `113 passed` |
| M4: probe maps `attempt: undefined` instead of `r.run_attempt` | `113 passed` |

- **M7 or M8 restores A2 exactly in production.** A re-run that fails a different way is suppressed as `already reported`. This is A1's lesson ("wired only in untested shells") one layer further out.
- **M3 or M4** break the probe's backstop. Suppose attempt 2 fails and the notifier did not fire (the case the probe exists for). Attempt 1's bare URL is on the thread, so the probe also stays silent.
- The commit's "Five mutations were run, and all were killed" is true of the five it chose.

**Fix:** add a source-scan test asserting that:
- the reusable workflow sets `ALERT_RUN_ATTEMPT` from `github.run_attempt`;
- the runner's `env` object reads it;
- the probe's run mapping carries `run_attempt`.

Then add a runner-level test that feeds the probe an `attempt: 2` run whose thread holds only the attempt-1 URL, and expects a comment.

### #239 Q-135 session moves (worktree `q135`, fix commit 7eb5403)

**Round-1 findings: S1, S2, S5 and S6 confirmed fixed. S3 is fixed for the literal sentences only (R2-239-2). S4 is not tracked anywhere (R2-239-1).**
- **S1 fixed.** Original reproducer, `grep -nE "\bBUY\b|\bSELL\b|long setup" 'app/sector/[slug]/page.tsx'`, now hits only `:406`, a comment. Putting the old "Strong BUY … quality long setup … size position so a 1.5×ATR stop costs ≤1% of account" sentence back into the guide → `LandingSessionMoves.test.tsx` `1 failed | 2 passed (3)`.
- **S2 fixed.** Production `GET /api/darkpool/{XLK,XLE,XLU}` (read-only, today): `avgDailyVolume` is non-null, and every off-exchange, short and float field is `None`. The new copy says exactly that: "Volume and short-interest fields … where it publishes them. For sector ETFs it mostly does not, and the tab shows —". The summary tiles now carry "Illustrative: simulated prints, not market data." The guide no longer says "institutional flow".
- **S5 fixed.** One formatter decides both the label and the number:
  - `0.005 → +0.01% UP`, `-0.005 → -0.01% DOWN`, `±0.0049 → 0.00% FLAT`;
  - `0.0149 / 0.015 → +0.01% UP`, `-1e-12 → 0.00% FLAT`;
  - no `-0.00%` appears.

  NaN and Infinity cannot reach it, because `sessionMoveFor` rejects non-finite `changePct`.
- **S6 fixed.** The `lib/sectors.ts:96` comment notes that SignalCard was deleted.

#### R2-239-1 · MEDIUM · `lib/sessionMoves.ts:16-20`, commit 7eb5403 — S4 is "deferred to Q-145", and Q-145 does not exist
**Claim attacked:** "S4 … is NOT fixed here. Its cause is at the producers … so it is Q-145."
- `git log --all -S'Q-145'` → only `7eb5403` itself.
- `git grep -l Q-145 <ref> -- workspace` over every local and remote branch → nothing.
- I grepped `workspace/IMPROVEMENT_BACKLOG.json` in the main checkout and in the q135, q093, q141, q090 and q142b worktrees → 0 hits each. The highest id on main is `Q-142`.

So the deferral points at an id with no backlog row. Round 1 also left S4 unlogged in `reviews/findings-ledger.csv`. The I2 defect (a missing change shown as a measured `FLAT +0.00%`, with an SSE tick able to overwrite a real REST change) is therefore neither resolved nor logged. CLAUDE.md's definition of done forbids that, and a code comment citing a phantom id makes it look tracked.
**Fix:** add the `Q-145` row (schema `workspace/BACKLOG_SCHEMA.json`), citing round-1 S4's reproducer, and log S4 in the ledger. The comment may then cite it.

#### R2-239-2 · MEDIUM · `__tests__/components/LandingSessionMoves.test.tsx` (`SIGNAL_WORDS`, `ADVICE`) — the broadened copy guard is a phrase list, and a light rewording of S1 passes it
"Restoring any of the three removed sentences fails it" is TRUE, and is all that is true.
- `SIGNAL_WORDS` is upper case only.
- `ADVICE` lists the removed phrases almost verbatim: "stop loss" with a space, "size position", but not "position sizing".

**Real-tree reproducer:** in `app/sector/[slug]/page.tsx` I replaced "Nothing here is a recommendation to buy or sell." with:
> "Strong Buy + price above EMA200 + RSI 50–70 is the setup to take. Position sizing: risk 1% of your account per trade, with a stop-loss 1.5×ATR below entry."

→ `Tests 3 passed (3)`. The file was restored. This is S1's content with the case changed and one hyphen added.

**Probe** (the guard's own regexes and `sourceText.stripComments` on the mutated file). Every sentence below was **missed**:
- "Buy when RSI drops below 30; sell above 70."
- "Go long above the 200-day EMA; exit below it."
- "Place your stop 1.5×ATR below entry and take profit at 2R."
- "Accumulate on dips to the lower Bollinger band."
- "A strong buy signal fires when MACD crosses up."
- "Overweight this sector when breadth turns positive."
- "Entry: next open. Target: +5%. Stop-loss: −2%."

The guard also visits only four files. This is the guard-reachability lesson in its input-space shape: the positive control is the removed sentence, so the guard is tuned to the one input it already knew.
**Fix:**
- Match case-insensitively on `\b(?:buy|sell|hold|long|short|accumulate|overweight|underweight)\b` in rendered text, with an explicit allowlist for disclaimers ("not … buy or sell", "not investment advice").
- Add `stop[- ]?loss`, `position siz`, `take profit`, `target`, `entry`, `risk \d+%`.
- Render the page and scan its DOM text, as `skill-wording.test.ts` does, rather than scanning source.
- Make the positive controls paraphrases, not the deleted sentences.

### Part B: not re-verified
- **#234:** the commit's own mutation list. I ran the D1 and D2 originals and new collision plants instead.
- **#236:**
  - The heartbeat dry run against the real repository.
  - The `html_url` form of a re-run (attempt > 1). I sampled pages 1, 3, 5, 8 and 12 of `actions/runs` (949 runs in total) and found no run with `run_attempt > 1`. So whether the API's URL for a re-run carries `/attempts/N` is unmeasured. If it does, `alertKeyFor` keys `…/attempts/2#attempt-2`, and the probe and the notifier would diverge, toward duplicates.
- **#238:** the in-place guard run on the real ledger, which the brief forbade. I used a faithful replica on the real text instead.
- **#239:** the `next build`; the suite total.
- **All four:** `tsc` (run only on #241), suite totals, and CI.

---

## Resolution status
**Nothing in this report is logged to `reviews/findings-ledger.csv`.** The brief forbade ledger edits. Every finding above is unresolved and unlogged, and the parent agent owns appending them.

Two round-1 items are still effectively unlogged after the fixes:
- **S4:** deferred to a `Q-145` that does not exist (R2-239-1).
- **`.env.example:64` (D5 residual):** left for the owner, which is correct under the rules. It still needs a row.

## Severity summary
| PR | BLOCKING | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| #243 locale (new) | — | — | R2-243-1, R2-243-2 | R2-243-3, R2-243-4 |
| #242 news labels (new) | — | — | R2-242-1 | R2-242-2, R2-242-3, R2-242-4 (pre-existing), R2-242-5 |
| #241 BTC interval (new) | — | R2-241-3 (pre-existing text, not a merge blocker) | R2-241-1 | R2-241-2 |
| #234 fix (D1–D5) | — | — | — | R2-234-1 |
| #236 fix (A1–A5) | — | — | R2-236-1 | — |
| #238 fix (L1–L5) | — | — | — | R2-238-1, R2-238-2 |
| #239 fix (S1–S6) | — | — | R2-239-1, R2-239-2 | — |

All round-1 HIGH findings (D1, L1, S1, S2) are confirmed fixed, each by its original reproducer.

## Worktree state at close
I ran `git status --short` in every worktree I touched (q142b, deadcode, q095, q113, q135, q090, q141, q093).
- **No tracked file is modified by this review.**
- **q113 is the exception, and the changes are not mine.** At close it shows uncommitted edits to `__tests__/ci/alertRunners.test.ts`, `scripts/ci/notify-scheduled-failure.mjs` and `scripts/ci/workflow-heartbeat.mjs`. They come from another session and cite "Red-team R2-236-1", which is text this report wrote after my last q113 mutation was restored. My q113 status was clean right after mutation M8. I left these edits untouched: restoring them would destroy someone else's uncommitted work. On a re-check they had been committed by that session as `2cc24cf` ("Q-113 red-team round 2: pin every hop the run attempt takes to the key", 14:28 +0800), and q113 is now clean. **I have not reviewed `2cc24cf`.**
- **Untracked files:** `q135/reviews/combined-red-team-2026-10-17.md` (round 1's report, pre-existing) and this file. Every probe file I created inside a worktree was deleted, and probe outputs live in the session scratchpad.
