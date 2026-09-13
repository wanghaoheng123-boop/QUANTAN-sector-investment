/**
 * Q-115 — UI copy must not promise an interaction the markup does not implement.
 *
 * `app/desk/page.tsx` told the user "Click any row to drill into the detail
 * page." **No `<tr>` in this repository is interactive** — not one has an
 * onClick, a role, or a cursor affordance. The only way into a detail page from
 * that table was a 29x15 CSS px link in the last column, which is also the
 * hardest thing on the page to hit. A user following the instruction literally
 * tapped a row, nothing happened, and the page gave no hint why.
 *
 * This is the same family as the invariant work elsewhere in this suite — a
 * DOCUMENTED behaviour the code does not have — and it is worth a guard for the
 * same reason: prose drifts from markup silently, and nothing else in CI reads
 * prose at all.
 *
 * ON THE VISITED SET, because that is where six of this repo's guards died. The
 * universe below is EVERY page and component file. The decision is "does this
 * file make the claim"; it is NOT "files that have interactive rows", which
 * would define the input set by the property under test and make the one
 * violation invisible — the Q110-P2 defect exactly.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = join(__dirname, '../..')
const IGNORED = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.git'])

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/')

/**
 * Comments stripped, and this file is the proof that it is load-bearing.
 *
 * The first version matched RAW source. The commit that FIXED the desk copy
 * also added a JSX comment explaining what the old copy had said — quoting the
 * offending sentence — and the guard flagged the fix as the violation. A guard
 * that matches prose ABOUT the behaviour instead of the behaviour is the defect
 * its sibling `cache-flag-consumed.test.ts` was written about, reproduced here
 * within an hour of reading that warning.
 *
 * JSX comments are `{​/* … *​/}`, so the block rule removes them too.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = ['app', 'components']
  .flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: rel(f), source: stripComments(readFileSync(f, 'utf8')) }))

/**
 * A `<tr>` the user can actually activate. Deliberately GENEROUS about what
 * counts — an onClick, a link/button role, or a pointer affordance all satisfy
 * it — because the guard's job is to catch prose with nothing behind it, not to
 * dictate how a row is made interactive.
 */
const hasInteractiveRow = (src: string) =>
  /<tr[^>]*(onClick|role=["'](?:link|button|row)["']|cursor-pointer)/.test(src)

/** Claims, and what each one obliges the same file to contain. */
const PROMISES: { claim: RegExp; what: string; satisfied: (src: string) => boolean }[] = [
  {
    claim: /click (?:any|a|the) row/i,
    what: 'an interactive <tr>',
    satisfied: hasInteractiveRow,
  },
  {
    claim: /click (?:any|a|the) column header to sort/i,
    what: 'a sort handler on a header',
    // No `s` flag: `[^>]*` already spans newlines (a character class includes
    // them) and there is no `.` to make dotAll matter. tsc rejects the flag
    // below this tsconfig's target — vitest's transpiler did not, so the suite
    // was green while `npm run typecheck` failed. Both gates, every time.
    satisfied: (src) => /<th[^>]*onClick/.test(src) || /setSortKey|onSort|toggleSort/.test(src),
  },
]

describe('UI copy promises an interaction the markup implements', () => {
  it('the stripper removes a comment but keeps rendered copy', () => {
    // Reachability for the stripper itself. If it ate everything, every claim
    // would vanish and the whole file would pass vacuously.
    expect(stripComments('{/* users were told to click any row */}')).not.toMatch(/click any row/)
    expect(stripComments('<p>Click any row to drill in.</p>')).toMatch(/Click any row/)
  })

  it('the scan reaches the page and component trees at all', () => {
    // Reachability first. A zero-file walk passes every assertion below while
    // proving nothing — this repo has lost that way six times.
    expect(files.length).toBeGreaterThan(20)
    expect(files.map((f) => f.path)).toContain('app/desk/page.tsx')
  })

  it.each(PROMISES)('the $what matcher is not vacuous', ({ satisfied }) => {
    // Negative + positive control for the matcher itself: a rule that can never
    // match is indistinguishable from a rule that always passes.
    expect(satisfied('<tr className="border-b">')).toBe(false)
    expect(
      satisfied('<tr onClick={go}>') || satisfied('<th onClick={s}>') ,
    ).toBe(true)
  })

  it.each(PROMISES)('every "$what" claim is backed by markup', ({ claim, satisfied, what }) => {
    const broken = files
      .filter((f) => claim.test(f.source))
      .filter((f) => !satisfied(f.source))
      .map((f) => `${f.path} claims row/sort interaction but has no ${what}`)
    expect(broken).toEqual([])
  })

  it('still holds that NO <tr> in the repo is interactive', () => {
    // Not a requirement — a measurement, pinned. The desk was fixed by
    // correcting the COPY rather than by faking an interactive row, because a
    // clickable <tr> is either keyboard-hostile or DOM gymnastics. If someone
    // later makes a row interactive on purpose, this fails and they should
    // delete it with the commit that does so.
    const interactive = files.filter((f) => hasInteractiveRow(f.source)).map((f) => f.path)
    expect(interactive).toEqual([])
  })
})

describe('what this guard CANNOT do', () => {
  it('only knows the claims listed in PROMISES', () => {
    // It reads two sentence shapes. "Tap a card", "drag to reorder", "hover for
    // detail" and every other promise in this UI are invisible to it. It is a
    // tripwire on a known drift, not a proof that the copy is honest.
    expect(PROMISES.length).toBeLessThan(5)
  })

  it('cannot see copy that lives outside the file rendering it', () => {
    // A claim passed in as a prop from another module, or loaded from content,
    // is matched against the WRONG file's markup. The desk guide happens to be
    // authored inline at its call site, which is the only reason this works
    // there.
    const inlineAuthored = files.filter((f) => /<DashboardGuide/.test(f.source))
    expect(inlineAuthored.length).toBeGreaterThan(0)
  })
})
