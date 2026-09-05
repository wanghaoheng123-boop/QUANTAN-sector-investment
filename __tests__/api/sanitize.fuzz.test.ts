/**
 * Q-015 — Property-based fuzz tests for normalizeTicker (F7.3).
 *
 * Q110-T2 (2026-09-05) — the oracle was a COPY OF THE SUBJECT.
 *
 * This file used to declare its own `TICKER_REGEX` with the comment
 * "keep in sync with source", and assert that the sanitizer's output matched
 * it. That is the statement "the implementation agrees with a duplicate of
 * itself" — and the refactor the comment INSTRUCTS you to perform is precisely
 * the one that disarms it. Measured on the committed tree:
 *
 *   widen ONLY the source regex to accept `_`   -> the property FAILS (good)
 *   widen BOTH, as "keep in sync" directs       -> 146 tests pass (the defect)
 *
 * A sanitizer that silently began accepting `_` — a character with meaning in
 * several of the paths this value is forwarded into — would ship green.
 *
 * The reviewer who raised this called it "near-zero power", and that half was
 * WRONG and is corrected here: measured over the same 10k cases, 18.5% (1,854)
 * produce a non-null result, so the assertion really is evaluated. The trouble
 * is WHAT reaches it. `fc.string()` yields benign ASCII words — "vy", "q",
 * "PbTMp", "eStrneGett" — so every case that exercises the branch is a
 * trivially valid ticker, and no near-miss is ever generated.
 *
 * So: the oracle is now a SPECIFICATION of what is safe to forward, justified
 * below and stated independently of how the sanitizer is written, and a second
 * generator draws from a hostile alphabet to produce near-misses.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { normalizeTicker } from '@/lib/api/sanitize'

/**
 * The characters a normalised ticker may contain — a SPECIFICATION, not a
 * mirror of the implementation. Each is here because it cannot change the
 * meaning of the contexts this value is forwarded into:
 *
 *   `A-Z0-9`  the symbol itself
 *   `.`       share class (`BRK.B`) — cannot traverse: `/` is what does that
 *   `-`       share class / pair separator (`BRK-B`, `BTC-USD`)
 *   `=`       futures suffix (`ES=F`)
 *   `^`       US index prefix (`^VIX`), leading only
 *
 * Absent by design and each for a reason: `/` and `\` (path traversal),
 * `?`, `&`, `#` (query and fragment injection), whitespace and control
 * characters (header and log injection), `%` (double-decoding), quotes,
 * backticks and `;` (shell and SQL contexts), and everything non-ASCII
 * (homoglyphs). Widening `lib/api/sanitize.ts` to accept any of them must fail
 * this file, which is the whole point: adding a character here is a deliberate
 * act with a written justification, not a regex edit that keeps two copies in
 * step.
 */
const SAFE_CHARS = /^[A-Z0-9.\-=]+$/
const MAX_LEN = 26 // ^ + 15 + '-' + 10, the widest shape the spec admits

/** Adversarial alphabet: valid-ish symbols mixed with everything forbidden. */
const hostile = fc.array(
  fc.constantFrom(
    ...'ABZ09'.split(''),
    ...'.-=^'.split(''),
    ...'/\\?&#%;\'"`|<>*'.split(''),
    ' ', '\t', '\n', '\u0000', '\u00e9', '\u0430', '\uff21',
  ),
  { minLength: 0, maxLength: 30 },
).map((cs) => cs.join(''))

describe('normalizeTicker fuzz (Q-015)', () => {
  it('accepted output contains ONLY specified-safe characters (10k cases)', () => {
    let reached = 0
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (s) => {
        const result = normalizeTicker(s)
        if (result === null) return true
        reached++
        const body = result.startsWith('^') ? result.slice(1) : result
        return SAFE_CHARS.test(body) && result.length <= MAX_LEN
      }),
      { numRuns: 10_000 },
    )
    // POWER, asserted. A property whose branch is never reached is a tautology
    // dressed as a test, and this file spent its life one refactor away from
    // being one. 18.5% reached it when measured; the floor is set well below
    // that so generator drift is loud rather than silent.
    expect(reached).toBeGreaterThan(500)
  })

  it('holds under an ADVERSARIAL alphabet, where fc.string() only makes words', () => {
    let reached = 0
    let sawMetachar = 0
    fc.assert(
      fc.property(hostile, (s) => {
        if (/[/\\?&#%;'"`|<>*\s\u0000]/.test(s)) sawMetachar++
        const result = normalizeTicker(s)
        if (result === null) return true
        reached++
        const body = result.startsWith('^') ? result.slice(1) : result
        return SAFE_CHARS.test(body) && result.length <= MAX_LEN
      }),
      { numRuns: 10_000 },
    )
    // Both controls matter: the generator must actually produce hostile input,
    // AND some of it must survive to the assertion. Either at zero and the case
    // proves nothing.
    expect(sawMetachar).toBeGreaterThan(1000)
    expect(reached).toBeGreaterThan(50)
  })

  it('is idempotent — normalising an accepted value changes nothing', () => {
    // A sanitizer whose output it would reject, or alter, cannot be relied on by
    // a caller that normalises twice on different code paths. Stated about the
    // FUNCTION, so no copy of its internals is involved.
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 40 }), hostile), (s) => {
        const once = normalizeTicker(s)
        if (once === null) return true
        return normalizeTicker(once) === once
      }),
      { numRuns: 5_000 },
    )
  })

  it('known-bad inputs return null', () => {
    const bad = [
      '../etc/passwd',
      'AAPL; DROP TABLE',
      '%G1',
      '',
      '   ',
      '<script>alert(1)</script>',
      'AAPL/path',
      'AAPL?foo=bar',
      'AAPL+MSFT',
      '🔥🚀',
      '%',
      '%ZZ',
      'A'.repeat(50),
      ' \t\n',
      'BRK-B; DROP TABLE users',
      '../../secret',
      '%00',
      'AAPL\x00',
    ]
    for (const input of bad) {
      expect(normalizeTicker(input), `expected null for ${JSON.stringify(input)}`).toBeNull()
    }
  })
})
