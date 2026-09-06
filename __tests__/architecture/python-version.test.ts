/**
 * The Python interpreter CI uses must satisfy what the manifest actually needs.
 *
 * Q110-T7b (2026-09-06) — the pytest job pinned 3.11 and died on
 * `pip install -r requirements.txt` with "from versions: none" for
 * `tradingagents`, which reads as a missing package and is not one: every
 * version of it publishes `Requires-Python: >=3.12`. The manifest was fine; the
 * interpreter was wrong, and NOTHING IN THE REPO DECLARED WHICH ONE TO USE —
 * no pyproject.toml, no setup.py, no .python-version. The constraint lived
 * transitively inside a dependency and was discoverable only by failing.
 *
 * `.python-version` now declares it and this pins the two together, because a
 * declaration nothing checks drifts from the workflow the moment either moves.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../..')
/** Floor imposed by `tradingagents` wheels; raise only with evidence. */
const MIN_MAJOR = 3
const MIN_MINOR = 12

const parse = (v: string): [number, number] => {
  const m = /^(\d+)\.(\d+)/.exec(v.trim())
  if (!m) throw new Error(`unparseable python version: ${v}`)
  return [Number(m[1]), Number(m[2])]
}
const atLeastMin = ([maj, min]: [number, number]) =>
  maj > MIN_MAJOR || (maj === MIN_MAJOR && min >= MIN_MINOR)

describe('python version — declared, and matched by CI', () => {
  it('.python-version exists and declares at least 3.12', () => {
    const p = join(ROOT, '.python-version')
    expect(existsSync(p)).toBe(true)
    const v = parse(readFileSync(p, 'utf8'))
    expect(atLeastMin(v)).toBe(true)
  })

  it('the CI pytest job pins the SAME version', () => {
    const declared = readFileSync(join(ROOT, '.python-version'), 'utf8').trim()
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const pins = [...ci.matchAll(/python-version:\s*'([^']+)'/g)].map((m) => m[1])
    // Reachability: if the workflow stopped pinning at all this would pass vacuously.
    expect(pins.length).toBeGreaterThan(0)
    for (const p of pins) expect(p).toBe(declared)
  })

  it('every CI python pin independently satisfies the floor', () => {
    // Belt and braces: the equality above would happily agree on 3.11 twice.
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const pins = [...ci.matchAll(/python-version:\s*'([^']+)'/g)].map((m) => m[1])
    expect(pins.length).toBeGreaterThan(0)
    for (const p of pins) expect(atLeastMin(parse(p))).toBe(true)
  })

  it('requirements.txt states the requirement in prose for a human', () => {
    // The machine checks above are the enforcement; this is so someone reading
    // the manifest learns the constraint without first hitting the failure.
    const req = readFileSync(join(ROOT, 'requirements.txt'), 'utf8')
    expect(req).toMatch(/REQUIRES PYTHON >= 3\.12/)
  })
})
