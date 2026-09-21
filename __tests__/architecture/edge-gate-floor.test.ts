import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Q-131 — `reviews/invariants-baseline.md` and `CLAUDE.md` both asserted a
 * +1.81pp hard CI floor for two weeks after `89463b9` (#184, 2026-09-06)
 * lowered `FLOOR_EDGE_PP` to 0.0. Nothing noticed, because nothing connected
 * the record to the constant.
 *
 * This is the connection. The baseline file carries a machine-readable marker
 * and this test fails when it stops matching the code. Change both or neither.
 *
 * It deliberately does NOT assert what the floor SHOULD be — that is an owner
 * decision (see the §1b supersession). It asserts only that the project's
 * written record of the floor equals the floor the gate actually applies.
 */

const GATE_SRC = 'scripts/benchmark-signals.ts'
const BASELINE = 'reviews/invariants-baseline.md'

/** The constant the gate compares against, read from the gate itself. */
export function readFloorFromCode(src: string): number | null {
  const m = src.match(/const\s+FLOOR_EDGE_PP\s*=\s*(-?\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** The floor the project's baseline record claims is in force. */
export function readFloorFromRecord(md: string): number | null {
  const m = md.match(/<!--\s*GATE:FLOOR_EDGE_PP=(-?\d+(?:\.\d+)?)\s*-->/)
  return m ? Number(m[1]) : null
}

describe('Q-131 — the recorded edge floor matches the one CI applies', () => {
  it('finds the constant in the gate script (reachability, not a silent null)', () => {
    // If the declaration is renamed or reformatted this must FAIL, never pass
    // by matching nothing — the defect family this repo keeps rediscovering.
    const floor = readFloorFromCode(readFileSync(GATE_SRC, 'utf8'))
    expect(floor, `FLOOR_EDGE_PP not found in ${GATE_SRC}`).not.toBeNull()
    expect(Number.isFinite(floor as number)).toBe(true)
  })

  it('finds the machine-readable marker in the baseline record', () => {
    const floor = readFloorFromRecord(readFileSync(BASELINE, 'utf8'))
    expect(floor, `GATE:FLOOR_EDGE_PP marker missing from ${BASELINE}`).not.toBeNull()
  })

  it('the record and the code agree', () => {
    const inCode = readFloorFromCode(readFileSync(GATE_SRC, 'utf8'))
    const inRecord = readFloorFromRecord(readFileSync(BASELINE, 'utf8'))
    expect(inRecord).toBe(inCode)
  })

  it('the gate actually compares against that constant', () => {
    // A matching pair of numbers means nothing if the comparison was deleted.
    const src = readFileSync(GATE_SRC, 'utf8')
    expect(src).toMatch(/edgeOverBaseRatePp\s*<\s*FLOOR_EDGE_PP/)
    expect(src).toMatch(/process\.exit\(1\)/)
  })

  it('POSITIVE CONTROL: both readers can fail and can disagree', () => {
    expect(readFloorFromCode('const FLOOR_EDGE_PP = 1.81')).toBe(1.81)
    expect(readFloorFromCode('const SOMETHING_ELSE = 3')).toBeNull()
    expect(readFloorFromRecord('<!-- GATE:FLOOR_EDGE_PP=1.81 -->')).toBe(1.81)
    expect(readFloorFromRecord('no marker here')).toBeNull()
    expect(readFloorFromCode('const FLOOR_EDGE_PP = 0.0')).not.toBe(
      readFloorFromRecord('<!-- GATE:FLOOR_EDGE_PP=1.81 -->'),
    )
  })

  it('CLAUDE.md no longer states a bare floor it does not check', () => {
    // The stale sentence is kept as an explicit, dated correction; what must
    // not come back is an unqualified present-tense claim of a 1.81pp gate.
    const md = readFileSync('CLAUDE.md', 'utf8')
    expect(md).not.toMatch(/process\.exit\(1\)`?\)? on \*\*raw\*\* edge < 1\.81pp/)
    expect(md).toContain('edge-gate-floor.test.ts')
  })
})
