# Combined red team — PRs #234, #236, #238, #239, #237 (2026-10-17)

Reviewer: red-team agent (adversary). Findings are appended as they are confirmed.
Mutations were run in each worktree and restored with `git checkout -- <file>`; every
worktree was left clean for tracked files.

---

## PR #234 — dead-code sweep (`chore/dead-code-sweep`, worktree `deadcode`, HEAD 5be666c)

### D1 · HIGH · `__tests__/architecture/orphanModules.ts:72,75` (with `importGraph.ts:95` `PUBLIC_SURFACE`)
**False sentence (commit message, PR body, note line 60):** "fails when a module under
`app/`, `components/`, `hooks/` or `lib/` is unreachable".
`PUBLIC_SURFACE` matches **every** `.ts/.tsx/.js/.jsx` under `app/`, so every such file is
an entry point (`:72`) and is removed from the governed set (`:75`). The guard cannot
flag any `app/` module, ever. Only Next's special files (`page`, `route`, `layout`, …) are
public surface; `app/briefs/BriefCard.tsx`, `app/auth/signin/SignInButtons.tsx` and
`app/briefs/sector/[sector]/LiveBriefClient.tsx` are ordinary components.
**Verified:** replaced `import BriefCard from './BriefCard'` in `app/briefs/page.tsx` with a
local stub, so `app/briefs/BriefCard.tsx` had zero importers (`git grep "BriefCard'"` empty):
`npx vitest run __tests__/architecture/no-orphan-modules.test.ts` → `Tests 6 passed (6)`.
**Fix:** entry points under `app/` = Next special-file names only (+ `middleware`,
`instrumentation`); govern every other `app/` file. Add a planted `app/x/Orphan.tsx` control.

### D2 · MEDIUM · `__tests__/architecture/no-orphan-modules.test.ts:31`
`scriptEntries = tracked.filter((p) => scriptText.includes(p))` makes any **governed**
file a workflow merely mentions an entry point. `.github/workflows/stryker-weekly.yml:49`
names `lib/quant/{indicators,btc-indicators,technicals,multiTimeframe}.ts` as Stryker
**mutation targets**, so those four modules are permanently exempt. Being mutated is not
being executed. The note's sentence "any file a `package.json` script or a workflow names
by path" is accurate about the code and wrong about what an entry point is.
**Verified:** replaced `import { multiTimeframeSignal } from '@/lib/quant/multiTimeframe'`
in `lib/backtest/signals.ts:16` with a stub (multiTimeframe becomes test-only) → 6/6 green.
Control: same mutation plus renaming the path in `stryker-weekly.yml` → fails with
`+ "lib/quant/multiTimeframe.ts"` in testOnly.
**Fix:** only non-governed paths (`scripts/**`, root files) can be script entries, or match
only paths following `node|tsx|npx tsx|bash` in a command.

### D3 · MEDIUM · `orphanModules.ts:38-41`; note lines 41-43 ("seven modules only tests reach")
A barrel re-export counts as use, so `lib/backtest/walkForward.ts` is classed live
although **no product file uses any of its exports**. Its only non-test importer is
`lib/backtest/engine.ts:244-249` (`export { computeOosRatio, walkForwardAnalysis,
walkForwardSummary } from './walkForward'`), and
`git grep -nE "computeOosRatio|walkForwardAnalysis|walkForwardSummary|WFWWindow|WalkForwardSummary" -- app components lib hooks scripts`
returns only `walkForward.ts` and `engine.ts`. CLAUDE.md I4 already states "every
*invocation* is in `__tests__/`". So the real count is eight, not seven, and the
"What it cannot see" list (note :65-68) omits barrel re-exports.
**Verified:** recomputed with re-export edges dropped and strict Next entry points
(scratch probe): testOnly adds exactly `lib/backtest/walkForward.ts` (plus
`btc-indicators.ts`, which I checked is genuinely live through `calcVWAP` in
`components/crypto/BtcQuantLab.tsx`).
**Fix:** add `walkForward.ts` to `TEST_ONLY_PENDING` with a reason, and name "a module
reached only through a re-export whose names nobody imports" in the CANNOT-see list.

### D4 · LOW · `syntheticContainment.ts:236,254` reused by `orphanModules.ts:38`
Specifiers are pulled from raw source, so a **comment** or **string** keeps a dead module
alive. **Verified** with `findOrphans` on virtual files: `lib/__dead.ts` with no reference →
`unreachable: ['lib/__dead.ts']`; the same with only
`// removed: const M = dynamic(() => import('@/lib/__dead'))` → `[]`; with only
`export const revalidate = 60\n// import { x } from '@/lib/__dead'` → `[]`; with a string
literal containing `import('@/lib/__dead')` → `[]`. No instance on the current tree
(re-ran the real-tree report with comments stripped by the TS scanner: identical).
**Fix:** strip comments before extracting (the vendor-egress guard already masks comments
per language), and list "a reference in a comment or string" in the CANNOT-see list.

### D5 · LOW · PR body "Removed: `components/SectorRotationPanel.tsx`"; note line 28
The PR does not remove it. `git log --diff-filter=D -- components/SectorRotationPanel.tsx`
→ `5535393 Q-140 … (#232)`, which is already on main and is this branch's base. The PR
diff (`git show 254edce --stat`) has no such file. The map is also left wrong:
`AGENTS.md:36` still says "Present on disk (do not treat as deleted): …
`components/SectorRotationPanel.tsx`" and `AGENTS.md:115` lists it as a feature, and
`.env.example:64` still documents `NEXT_PUBLIC_APP_URL`, which nothing reads now.
**Fix:** credit the deletion to #232 in the PR body and note; correct `AGENTS.md:36,115`;
drop the `.env.example` line.

### #234: checked and found TRUE
- `lib/appUrl.ts` had no non-test reader (`git grep appUrl` hits only comments, reviews
  and the guard's header).
- `pathe` and `@testing-library/user-event` are imported by no tracked file (including
  `vitest.config.ts`, `stryker.conf.mjs` and `__tests__/setup`). The lockfile keeps `pathe`
  as `dev:true` transitive, drops `user-event`, and marks `@types/better-sqlite3` `dev:true`.
- Vendor withdrawals are checked, not just asserted: appending
  `export const __u = process.env.VERCEL_URL` to `lib/format.ts` fails
  `vendor-licence-register.test.ts` with `withdrawn-but-live: env-host VERCEL_URL`.
- Mutation "drop type-only edges" is killed: it fails the type-only control and the real
  tree (`components/klineTypes.ts` becomes unreachable).
- `next.config.js:2` requires `./lib/pwa/precache`, which `ROOT_CONFIG` reaches.
- Note :53-54: Q25-1 is `FIXED 2026-07-06 (PR #85)` in the ledger. Before #232,
  `lib/quant/regimeHmmClient.ts:33-34` set `probs[state] = 0.65` and split the rest
  `(1-0.65)/2`.
- The four routes have no UI fetch site. `/api/bloomberg-bridge/health` has none either,
  but README documents it as an ops health check, so leaving it off the list is correct.

---

## PR #236 — Q-113 alert dedupe (`fix/q113-alert-throttle`, worktree `q113`, HEAD 0797406)

### A1 · MEDIUM · `scripts/ci/workflow-heartbeat.mjs:177-178`, `scripts/ci/notify-scheduled-failure.mjs:93` — the effect is wired only in untested shells
All three claimed mutations target the pure functions (`decideAlert`, `assessWorkflow`).
Nothing tests that either runner actually **passes** a key or a thread.
**Verified:** set `dedupeKey: undefined` in both runners →
`npx vitest run __tests__/ci __tests__/architecture/scheduled-alerts.test.ts` →
`Tests 102 passed (102)`. With that change production would comment once a day again, and
the suite cannot see it. This is "tagged code ≠ fixed effect" in its plainest form: the
tests prove `decideAlert` *can* dedupe, not that anything asks it to.
**Fix:** move key and thread construction into pure helpers (`alertKeyFor(result)`,
`readThread(gh, issue)`) and test those, or add a source-scan test that both runners pass
`dedupeKey` and `thread` to `decideAlert`.

### A2 · MEDIUM · `.github/workflows/scheduled-failure-alert.yml:55` + `alertDecision.mjs:114` — a re-run that fails a second way is suppressed
The key is `…/actions/runs/${{ github.run_id }}`, and a re-run keeps its `run_id`. If a
human re-runs failed scheduled run N and it fails for a **different** reason (different
`ALERT_DETAIL`, for example another ticker quarantined), the notifier finds N's URL already
on the thread and returns `{action:'none', reason:'already reported'}`. The new cause never
reaches the issue. The probe keys on the API's `html_url`, which also has no attempt
number, so it is silent too. The thread keeps showing the first cause as the live one.
**Verified** by reading the code: `decideAlert` returns `none` whenever
`thread.some(t => t.includes(dedupeKey))`, whatever `detail` says, and the test
"does not re-report a failure already on the thread" pins exactly that.
**Fix:** key the notifier on `run_id` + `run_attempt`, or on (run URL, conclusion, detail
hash), so a different failure on the same run is new.

### A3 · LOW-MEDIUM · `scripts/ci/workflow-heartbeat.mjs:154-163,178` — one failed thread read aborts every later workflow, including recovery closes
`threadOf` calls `gh()`, which throws on any non-2xx (`:50`), and nothing catches the
error inside the `for (const r of results)` loop. Before this PR the loop made API calls
only to act. Now it makes a GET per failing workflow with an open issue. One transient
403 or 5xx on, say, `refresh-data.yml`'s comments stops the loop, so
`stryker-weekly.yml` and `workflow-heartbeat.yml` (later in `readdirSync` order) are
neither alerted nor **closed on recovery** that day. The job goes red, and its own alert
job reports that, so this is degraded rather than silent.
In `notify-scheduled-failure.mjs:86` the guard `if (!Array.isArray(batch)) break` reads
as error handling but cannot fire on an HTTP error, because `gh()` throws first (`:37`).
A thread-read error there drops that run's alert. The notifier job goes red, and the probe
reports the failure on its next daily look. So the thread read **degrades to a delayed
alert** where it should fail closed (speak now).
**Fix:** wrap the thread read. On error, log it and proceed with `thread = []`, which
means speaking (a possible duplicate), the fail-closed direction for an alerter. Delete
the dead `Array.isArray` guard or make it real.

### A4 · LOW · `alertDecision.mjs:114` — substring match, and pagination reads the oldest comments
- The match is `t.includes(dedupeKey)`, not a delimited token. With monotonically increasing
  run ids a newer run URL cannot be a prefix of an older one, so I could **not** build a
  realistic collision. But the probe's key falls back to bare strings
  (`${state}:${file}:${due}`), and an empty `GITHUB_RUN_ID`-style URL (`…/actions/runs/`)
  would match every comment. Matching the exact `<!-- alert-key: … -->` token, or a URL
  followed by a non-digit, removes the class.
- Both readers page `issues/{n}/comments` from page 1 for at most 10 pages. GitHub returns
  comments **oldest first**, so past 1,000 comments the newest keys are never read and
  daily duplicates resume. That fails in the safe direction and is far off (#177 has 45).
- `unparseable` and `unregistered` have no `due` and so no key, and they still comment
  every day. The title "one alert comment per failed run, not one per daily look" does not
  hold for those states. That is defensible, but it should be stated.

### A5 · LOW · `__tests__/ci/alertDecision.test.ts` "replayed against #177"
The committed "replay" is a hand-built loop of six distinct strings through `decideAlert`.
Any six distinct strings give six, so it is a tautology. It does not exercise the property
that makes #177 come out at 6 rather than 12: that the notifier's `ALERT_RUN_URL` and the
probe's `html_url` are the **same string**.
**I re-did the replay on the real thread:**
`gh api repos/…/issues/177/comments` gives 45 comments, 6 from the notifier (runs
34066964667 … 38189996112) and 39 `[heartbeat]` comments. Every heartbeat failing-run URL
appears verbatim in a notifier comment, and replaying the real sequence through the new
rule gives **6 comments**. So the number is TRUE. Only the test's description overstates
what it checks.
**Fix:** build the replay fixture from the real comment bodies, or assert that the
notifier and the probe produce byte-identical keys for one run.

### #236: checked and found TRUE
- "#177 collected 44 comments in 41 days": 44 at commit time (2026-09-06 → 2026-10-16).
  There are 45 now, because one heartbeat comment arrived after the commit.
- "Both mechanisms key on the failing run's URL … cannot double-report": the notifier
  always comments first, because the run is `completed` only after its alert job, and the
  probe's key matches it verbatim (measured above).
- "Recovery still closes immediately": the `success` branch runs before the dedupe check,
  and no thread is read on success in either runner.
- Mutation "runUrl not exposed" is killed: removing `runUrl: latest.url ?? null` →
  `× an unhealthy result carries runUrl`.
- `npx vitest run __tests__/ci` → 59 passed, matching the PR.
- The missed-fire key is stable. The probe judges only fires whose grace has fully
  elapsed, so a `missing` verdict for due D is final and the key does not churn.

---

## PR #238 — Q-095 ledger integrity (`chore/q095-ledger-integrity`, worktree `q095`, HEAD 81c3b00)

### L1 · HIGH · `scripts/lib/ledger.mjs:14-32`, `scripts/ledger-append.mjs:50-55`, `__tests__/architecture/findings-ledger-integrity.test.ts:27-46,66-86` — a swallowed CRITICAL row passes both the guard and the append script, and the script reports success
The parser never reports a quote left **open at EOF**. Whatever follows an unterminated
quote in the last field becomes part of that field. The row still has 12 columns, so the
column-count, glued-row and newline checks all pass. That is the "swallowed an entire
CRITICAL finding" class the guard's header says it exists for, in a second shape.
**Verified (guard):** appended
`ZZ-1,…,s,"open (see note` + `\n` + `ZZ-2,r,CRITICAL,…,open` to the real ledger →
`npx vitest run __tests__/architecture/findings-ledger-integrity.test.ts` →
`Tests 7 passed (7)`. ZZ-2 is not a row to any reader.
**Verified (append script, temp copy in scratchpad):** with a ledger ending in
`ZZ-1,…,"open (see note\n`, `node scripts/ledger-append.mjs rows.json` (row `ZZ-2`,
severity CRITICAL) printed `appended 1 row(s): ZZ-2` and exited 0. A re-parse finds no row
with id ZZ-2 (`last row id ZZ-1 cols 12`). Running the same command again also succeeded,
so the duplicate-id check is blind to swallowed ids. The post-append check counts columns.
It does not confirm that the rows it wrote are there.
**Fix:** make `parseCsv` throw (or return an error) when it ends `inQuotes`. In
`ledger-append`, refuse before writing unless the existing file parses cleanly (every row
12 columns, no open quote). After the append, assert each new id is present as its own row.
Add the open-quote case to the integrity test.

### L2 · MEDIUM · `scripts/ledger-append.mjs:11,49-55` — "Writes nothing on any error" is false
The existing file's well-formedness is not checked before writing. **Verified:** appended
an 11-column `BAD-1` row to a temp copy, then ran the script with a valid `LK-1` row. The
result was `post-append check: 1 malformed row(s)`, `exit=1`, and `tail -1` shows `LK-1`
**was written**. A caller that trusts the exit code retries and gets "id already exists".
**Fix:** run the same validation on the existing text before `appendFileSync`, and stop
there if it fails.

### L3 · MEDIUM · `scripts/ledger-append.mjs:28-41,57-60` — a crash leaves a permanent, anonymous, committable lock
The lock is an empty file with no PID or timestamp, and no signal handler releases it.
**Verified:** acquired it the script's way and `SIGKILL`ed the holder. The next append
waited `10s`, printed "another append is running, or a stale lock needs removing" and
exited 1. Nothing in the file distinguishes stale from live, and the message invites
deleting it, which breaks mutual exclusion if an append is in fact running.
`git check-ignore reviews/findings-ledger.csv.lock` → not ignored, so `git add reviews/`
can commit a lock and block every clone.
**Fix:** write `pid` and time into the lock, treat it as stale when the pid is dead or the
lock is older than N seconds, release it on SIGINT/SIGTERM, and gitignore `*.csv.lock`.

### L4 · LOW-MEDIUM · `scripts/lib/ledger.mjs:49,58-61` — a whitespace id defeats the duplicate check
Existing ids are compared **untrimmed** (`r[0]`), new ids **trimmed**, and the id is written
**raw**. **Verified:** appending `" WS-1 "` and then `"WS-1"` gave two
`appended 1 row(s)` messages, and the ledger now has ` WS-1 ,…` and `WS-1,…`. The
integrity test trims, so CI catches the duplicate afterwards, but the script's own claim
"a new unique id" does not hold.
**Fix:** trim when writing, and trim existing ids before comparing.

### L5 · LOW · `scripts/lib/ledger.mjs:51-52` — non-array input crashes instead of refusing; values are not validated
- With a JSON object, string or number, `(rows ?? []).entries is not a function` → a
  TypeError stack and exit 1. The intended `no rows given` message is never printed.
  Nothing is written and the lock is released (verified for all three), so this fails
  closed, just not cleanly.
- "Validates every row (all 12 columns …)" checks that the keys are **present**, not their
  values. `severity: null` is written as an empty severity, and `one_line: {"a":1}` as
  `[object Object]`. **Verified:** `NUL-1,x,,x,x,x,[object Object],…` was appended with
  exit 0. In a risk register, an empty severity should be refused.
**Fix:** `if (!Array.isArray(rows)) return { header, problems: ['rows must be an array'] }`.
Require non-empty strings, and require severity to be one of
CRITICAL/HIGH/MEDIUM/LOW/INFO.

### #238: checked and found TRUE
- Exactly 7 rows were malformed at the base (`F4.5 11, F5.4 11, F5.9 13, F6.2 15, F6.3 14,
  F6.4 16, WSA-FG 11` columns), and the diff is exactly 7 lines changed, 7 added.
- All seven are **semantically** right. The three shifted rows (F4.5, F5.4, WSA-FG) get
  `line = various` in column 6, with `one_line`, `citation`, the AT id, engineer, sprint and
  status back in their own columns. F6.2/F6.3 put the component list in `file`; F6.4 puts the
  table list in `one_line`; F5.9 puts `Record<…>` in `one_line`. (Nit: F5.9's text gained a
  space, `Record<string,unknown>` → `Record<string, unknown>`.)
- No other row is column-shifted. I scanned all 378 rows: severities are only
  CRITICAL/HIGH/MEDIUM/LOW/INFO, there are no duplicate or whitespace ids, and the `line`
  and `one_line` columns look as expected. The only Python-csv "bad" rows are two blank
  lines (148, 165), which the guard skips.
- **The guard still catches the canonical glued row.** I stripped the ledger's trailing
  newline and appended a 12-column `ZZ-9,…,CRITICAL,…` row directly, then ran
  `findings-ledger-integrity.test.ts` → `× every row has exactly the header's column count`
  (`Q140-R7 (23 cols, expected 12)`) and `× no row is a glued concatenation of two rows`.
  The file was restored. L1 is a **second** shape that the guard misses, not a regression of
  this one.
- `openSync(LOCK,'wx')` **is** exclusive on this Google Drive filesystem: in 3 trials of 12
  concurrent processes, exactly one won each time (`3 WIN, 33 EEXIST`).
- A CRLF ledger is handled: the append adds LF rows after the CRLF, and Python csv reads 0
  bad rows. Mixed line endings result, but nothing is corrupted.
- A file with no trailing newline is handled: `appendText` prepends `\n`, and the unit test
  covers it.

---

## PR #239 — Q-135 session moves (`fix/q135-session-moves`, worktree `q135`, HEAD 3e48f84)

### S1 · HIGH · `app/sector/[slug]/page.tsx:414-427` — the sector page still says BUY/SELL and gives position sizing; the legend calls a session move a "BUY signal"
**Pre-existing text. This PR did not write it**: `git show HEAD~1:'app/sector/[slug]/page.tsx'`
has the same lines at `:416-426`. Before this PR the sector page's only card already rendered
session rows as "UP/DOWN SESSION" (`HEAD~1:components/SignalCard.tsx:25-28,119`), so the guide
was orphaned before #239. The commit claims only that the three items it lists ("All now
describe what renders"), and that claim holds for those three. Under CLAUDE.md's
regression-vs-gap rule this is therefore **not a merge blocker**. It is in this review because
the task asks for any BUY/SELL/HOLD wording left on the sector page, and this PR rewrote the
adjacent entry of the **same** `DashboardGuide` block while leaving:

> **How to act** — "Strong BUY + price above EMA200 + RSI 50–70 = **quality long setup**.
> Strong SELL + RSI > 80 + dark pool selling = **top warning**. Always size position so a
> 1.5×ATR stop costs ≤1% of account." (`:418-419`)

and a legend that presents a session move as a trade signal:
`{ label: 'Bullish bar / signal', meaning: 'price up vs prior close, or BUY signal' }` and the
SELL twin (`:425-426`). That is precisely the conflation Q-135 exists to remove. "Always size
position so … ≤1% of account" is position-sizing instruction on the surface `Q-083` (MAS/FAA)
gates. The landing hero this PR rewrote says "Research tooling, not investment advice". The
PR's own new copy guard visits this file and passes on this text (S3).
**Verified:** `grep -nE "\bBUY\b|\bSELL\b|long setup" 'app/sector/[slug]/page.tsx'` →
`:418, :425, :426`. `npx vitest run __tests__/components/LandingSessionMoves.test.tsx __tests__/lib/sessionMoves.test.ts` → `6 passed`.
**Fix:** in this PR, or as a new backlog item: delete or rewrite "How to act" (no BUY/SELL,
no sizing) and make the legend read "price up/down vs prior close" only.

### S2 · HIGH · `app/page.tsx:298,458,604` — new copy promises an "off-exchange volume share" that was null for all 11 sector ETFs when measured
This PR wrote three sentences (all three are `+` lines in `git show HEAD -- app/page.tsx`;
they replaced "dark pool data" and "Dark Pool Intelligence" copy):
- hero (`:298`): "… Yahoo Finance quotes, K-line charts, **off-exchange volume**, and sector briefs"
- grid (`:458`): "Click any sector for its K-line chart, **off-exchange volume** and news"
- feature card (`:604`): "**Off-exchange volume share from Yahoo Finance.** The block-print
  table is illustrative and labelled as such."

The route that supplies it says the opposite in its own comment
(`app/api/darkpool/[ticker]/route.ts:73-76`): "Yahoo Finance does not publish per-ticker
off-exchange share counts via public API … We still try the field in case it surfaces". Even
when the field surfaces, `offExchangePct` is `offExchangeShares / sharesOutstanding`
(`:80-87`). That is a share-count ratio, not a **volume** share.
**Verified on production:**
`curl https://quantan.vercel.app/api/darkpool/<ETF>` for all 11 sector ETFs (XLK XLF XLE XLV
XLI XLY XLP XLU XLB XLRE XLC) at about 2026-10-16 18:10Z → `offExchangePct: null` and
`offExchangeShares: null` for **11 of 11**. SPY also returned null. For XLK, XLF and SPY the
only non-null metric was `avgDailyVolume`. That is one point in time, but the route's own
comment says Yahoo does not publish the field. `DarkPoolPanel.tsx:132-133` therefore renders
"—" / "Finra BATS" for off-exchange %. The second sentence is only
half true: the block-print *table* is labelled, but the right-column **"Dark Pool Summary"**
(`app/sector/[slug]/page.tsx:586-605`, "Total Block Vol", "Bullish Prints N/M") is computed
from the same synthetic `generateDarkPoolPrints` and carries **no** illustrative label. That
part is known under `Q-089`, but this PR's sentence asserts the opposite. The sector guide's
"Dark Pool tab — institutional flow … Bullish prints near ask = accumulation" (`:394-401`)
describes those synthetic prints as real institutional flow.
**Fix:** say what renders: "average daily volume and short-interest fields where Yahoo has
them; off-exchange % is unavailable for ETFs". Drop "volume share". Label the summary tiles
illustrative, or retire them under Q-089.

### S3 · MEDIUM · `__tests__/components/LandingSessionMoves.test.tsx:43-48` — the copy guard visits the right files and cannot see the wording
The pattern is
`/stop loss|risk\/reward|Avg Confidence|Composite signal|Sectors Bullish|Sectors Bearish|'BUY', 'SELL'/i`.
It matches the old filter array literal `'BUY', 'SELL'` but not a bare `BUY`/`SELL`, so
"Strong BUY … quality long setup" and "BUY signal" in `app/sector/[slug]/page.tsx` (a
visited file) pass. A guard named "no surface promises levels, confidence or risk/reward …"
that is green beside "size position so a 1.5×ATR stop costs ≤1% of account" is ratifying the
defect. Second-order: the comment stripper `/\/\/[^\n]*/` also deletes everything after any
`https://` inside a string or JSX attribute on the same line, so a URL hides the rest of its
line from the scan.
**Fix:** match `\b(?:BUY|SELL|HOLD)\b`, `long setup`, `size (?:your )?position`, and
`confidence` in rendered text (or scan rendered DOM, as `skill-wording.test.ts` does), with
an allowlist for "not buy/sell advice" phrasing. Strip comments with a tokenizer.

### S4 · MEDIUM · `lib/sessionMoves.ts:14,54` + `hooks/useLiveQuote.ts:82` + `lib/yahooQuoteFields.ts:44` — a quote with no change data becomes a measured "FLAT 0.00%"
The header says "A move here exists only when Yahoo supplied a usable quote", and the
commit fixes "missing displayed as data" for a missing **quote**. It does not fix it for a
missing **change**. `normalizedChangePercent` returns `0` when Yahoo supplies neither a
change % nor a change (`:44`), and `parseLiveQuote` substitutes `0` for a missing or
non-finite SSE `changePct` (`:82`). `sessionMoveFor` accepts finite 0, so the sector is
counted in "Flat (±0.01%)" and shown as `● FLAT +0.00%`, not as "No quote". On the landing
page an SSE tick without change data also **overwrites** a real REST `changePct` (merge at
`app/page.tsx:147-151`), so a real UP sector can flip to FLAT as live ticks arrive.
**Verified (tsx probe):**
`parseLiveQuote({ticker:'XLK',price:250,timestamp:…,changePct:null,change:null})` →
`changePct 0` → `sessionMoveFor` → `{direction:'FLAT', changePct:0, …}`.
`normalizedChangePercent(undefined, undefined, 250)` → `0` → FLAT.
**Fix:** carry `changePct: number | null` from both producers (null when Yahoo gave neither
field). Have `sessionMoveFor` return null for null; do not let a live tick with a null
change overwrite a known one. Add the case to `sessionMoves.test.ts`.

### S5 · LOW · `lib/sessionMoves.ts:42-47` and the card display — "+0.01%" can be labelled FLAT or UP
`FLAT_BAND_PCT = 0.01` is inclusive and display rounds to 2 dp, so `changePct = 0.01` shows
`+0.01%` labelled FLAT and `0.0149` shows `+0.01%` labelled UP. The comment "the smallest
change the two-decimal display can show" makes the band a display artifact. Classify on the
rounded value, or display 3 dp near the band.

### S6 · LOW · stale map references
`lib/sectors.ts:94-96` still points at `components/SignalCard.tsx`, which is deleted. The
same AGENTS.md map issue is noted under D5.

### #239: checked and found TRUE
- The removed confidence was `Math.min(98, Math.round(42 + Math.min(40, absM * 14)))`
  (`HEAD~1:lib/sessionSignalsFromQuotes.ts:34`), and entry = stopLoss = target = price
  (`:40-42`). Missing quotes became `price ?? 0`, `changePct ?? 0` (`:30-31`). The old tiles
  were "Sectors Bullish / Bearish / Neutral / Avg Confidence" and the filters
  `['ALL','BUY','SELL','HOLD']`.
- "RSI, MACD and ATR panels": `KLineChart.tsx:467-487` renders all three when `showRSI`,
  and the sector page passes `showRSI` (`:531`). EMA overlays and `volSma` are on. TRUE.
- The landing page has no BUY/SELL/HOLD wording left. The only hits are comments, "not
  buy/sell advice" and "not a trade signal".
- "No quote" stays right as ticks arrive, **for missing quotes**. `noQuote = SECTORS.length - moves.length`,
  `moves` maps only SECTORS (SPY/QQQ ticks are ignored), and a sector that gains a live tick
  with a usable price leaves "No quote". The exception is S4.
- No remaining importer of `SignalCard`, `sessionSignalsFromQuotes` or the `PriceSignal`
  types (`git grep` hits only comments).
- `npx vitest run` on both new test files → 6 passed.

---

## PR #237 — Q-142 hydration-safe times (merged; worktree `q142`, 620bed6)

### H1 · MEDIUM · `components/risk/TailRiskBanner.tsx:44` and `lib/portfolio/tailRiskAlerts.ts:33` — the same React #418 class on `/portfolio`, through numbers instead of times
`app/portfolio/page.tsx` is a server component that renders the client component
`<TailRiskBanner />` (`:33`), so the banner is SSR'd and then hydrated. It prints
`DEMO_INPUTS.portfolioVegaUsd.toLocaleString()` and the alert message
`` `Portfolio vega ${input.portfolioVegaUsd.toLocaleString()} USD …` `` with **no locale
argument**, so the text depends on the process locale: the server's (Vercel, en-US) and
then the viewer's.
**Verified:** `renderToStaticMarkup(<TailRiskBanner/>)` under three locales (tsx, scratch
probe) gives:
`en_US → "vega -600,000 USD"`, `de_DE → "vega -600.000 USD"`, `fr_FR → "vega -600 000 USD"`.
A German or French browser hydrating the en-US server markup gets a text mismatch, the
same failure Q-142 fixed for zones. Q-142's test varies TZ only, so it could not see this.
**Fix:** `toLocaleString('en-US')` at both sites (or `formatCompactNumber`). Extend the
hydration test to vary locale as well as zone, over every SSR'd client component that takes
server data or constants.

### H2 · LOW · `lib/format.ts:197-218` — "ET" is ambiguous for the repeated fall-back hour
DST is otherwise right: spring-forward `2026-03-08T06:59Z → "1:59 AM ET"`,
`07:00Z → "3:00 AM ET"`; EDT vs EST offsets as the tests assert. But on the fall-back
morning two different instants print identically:
`2026-11-01T05:30Z → "Sun, Nov 1, 1:30 AM ET"` and `2026-11-01T06:30Z → "Sun, Nov 1, 1:30 AM ET"`
(verified under TZ=UTC, Asia/Singapore and America/Los_Angeles; output is zone-invariant,
as intended). This is rare for market data, but it is a timestamp that does not identify its
instant.
**Fix:** add `timeZoneName: 'short'` and print `EDT`/`EST`. Both are hydration-stable
because the zone is fixed.

### H3 · LOW · `__tests__/briefs/briefTimeHydration.test.tsx:8,23` — comments say "two zones", the list has three
The header ("under two zones") and the `ZONES` comment ("Two zones …") disagree with
`ZONES = ['UTC','Asia/Singapore','Pacific/Honolulu']`. Cosmetic; the commit message says three.

### #237: checked and found TRUE
- No other `/briefs` site formats a time without a fixed zone. `git grep` on
  `toLocale(String|TimeString|DateString)|formatFreshness|Intl.DateTimeFormat` over
  `app components hooks lib` finds the remaining sites only in client components whose
  data arrives after hydration (backtest, ma-deviation, commodities, heatmap and the
  landing `lastUpdate` are null or loading at SSR), in `ssr:false` dynamics
  (`DarkPoolPanel`, `NewsFeed`, `KLineChart`, `QuantLabPanel`), or in effects
  (`MarketStatus` computes inside `useEffect`). `initialBrief` is the only server-supplied
  initial prop to a client component in the tree.
- Server-component pages, enumerated directly (every `app/**/page.tsx` or `layout.tsx`
  without `'use client'`): `auth/signin`, `briefs`, `briefs/sector/[sector]`, `crypto`
  (a redirect only), `layout`, `portfolio`, `portfolio/factor-attribution`. Their client
  children are `SignInButtons` (no dates), `BriefCard` and `LiveBriefClient` (fixed by this
  PR), the layout's nav, status and auth components (no date or locale formatting at render;
  `MarketStatus` computes in `useEffect`), and `TailRiskBanner` (**H1**).
- `DataFreshnessIndicator` initialises `useState(() => Date.now())`, the hydration-risk
  pattern. Every mount (desk, sector ×2, stock ×2, ma-deviation, backtest, LiveSignalsPanel,
  BtcQuantLab, LiquidationsPanel) sits in a `'use client'` page or an `ssr:false` dynamic
  whose timestamp or `cached` flag comes from client-side fetch state. That state is null at
  SSR, and `classifyFreshness` returns `unknown` for a null time without reading `now`
  (`lib/data/freshness.ts:100`). So `now` does not reach the SSR markup today. This is
  safe by placement only, and would break the day a server page passes it a timestamp.
- **Production**, `/briefs/sector/energy` (fetched 2026-10-16 18:05Z, `force-dynamic`,
  `x-vercel-cache: MISS`): every stamp reads `… ET` (e.g. `Fri, Oct 16, 2:04 PM ET`).
  There is no AM/PM stamp without ET and no "UTC". Headlines are dated (`Oct 16, 9:02 AM ET`, …).
- `newsPublishTime` accepts the `Date` that yahoo-finance2 returns for
  `providerPublishTime`, epoch seconds or milliseconds, and ISO strings. A bad value
  becomes null.
- `formatEtDateTime` returns `—` for null, `''` and unparseable input. Midnight renders
  `12:00 AM`, and the output contains no U+202F.

---

## Not re-verified by this review (do not read the TRUE lists as covering these)
- **Mutation counts:**
  - #234: I re-ran 1 of the 3 claimed mutations (dropping type-only edges; killed). "Drop
    config entries" and "count tests as live" were checked by reading only.
  - #236: I re-ran 1 of 3 ("runUrl not exposed"; killed).
  - #237, #238 and #239: I re-ran none of the claimed mutations.
- **Suite totals:** not re-run. That covers #234's 2476 passed, #237's 130/130 and #239's
  2562 passed. I ran only the targeted files named above.
- **Builds:** #239's "`next build` green" was not checked; the brief forbids running it. No
  Vercel build or preview was inspected for any PR.
- **Typecheck:** `tsc` was not run on any branch.

## Resolution status
**None of these findings has been logged to `reviews/findings-ledger.csv`.** The brief
forbade ledger edits. Every finding above is therefore **unresolved and unlogged**, and the
parent agent owns appending them, one row each, before any of these PRs counts as "done"
under CLAUDE.md. Use the new `ledger:append` only after L1/L2 are fixed, or append by hand
and re-run the integrity test.

## Severity summary
| PR | BLOCKING | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| #234 dead-code | — | D1 | D2, D3 | D4, D5 |
| #236 Q-113 | — | — | A1, A2, A3 (low-med) | A4, A5 |
| #238 Q-095 | — | L1 | L2, L3, L4 (low-med) | L5 |
| #239 Q-135 | — | S1 (pre-existing text), S2 (new text) | S3, S4 | S5, S6 |
| #237 Q-142 | — | — | H1 | H2, H3 |
