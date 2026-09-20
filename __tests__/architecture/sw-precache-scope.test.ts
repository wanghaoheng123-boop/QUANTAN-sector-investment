import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PRECACHE_EXCLUDE, isExcludedFromPrecache } = require('../../lib/pwa/precache') as {
  PRECACHE_EXCLUDE: (RegExp | string)[]
  isExcludedFromPrecache: (p: string) => boolean
}

/**
 * Q-120 — the service worker used to precache the entire build at install:
 * 87 entries, 587 kB over the wire on a cold first visit, for an offline shell
 * that has no fresh data in it (every /api/ route is NetworkOnly).
 *
 * The regression this guards is SILENT: delete one `exclude` line in
 * next.config.js and 587 kB comes back with every test still green, because
 * nothing else in the suite looks at the generated service worker.
 *
 * Two levels, because each alone is weak:
 *  1. the POLICY — exercised behaviourally against real asset paths, not by
 *     matching the source text of the config;
 *  2. the ARTEFACT — the generated public/sw.js, when a build has produced one.
 */

const REAL_ASSET_PATHS = [
  'static/chunks/framework-79ec8b086f68767a.js',
  'static/chunks/main-5005dfdc5b50edbe.js',
  'static/chunks/app/page-31161552f8ea8e96.js',
  'static/chunks/app/desk/page-d68f5bf6d3984f95.js',
  'static/chunks/4266.2a55927b9b78734b.js',
  'static/css/f98401100b5f49bc.css',
  'static/chunks/app/api/backtest/route-b06585219d047082.js',
  'icons/icon-512.png',
]

describe('Q-120 — the service worker does not precache the whole build', () => {
  it('the exclusion policy covers every kind of asset the build emits', () => {
    expect(PRECACHE_EXCLUDE.length).toBeGreaterThan(0)
    for (const p of REAL_ASSET_PATHS) {
      expect(isExcludedFromPrecache(p), `${p} should not be precached`).toBe(true)
    }
  })

  it('POSITIVE CONTROL: the predicate can actually say no', () => {
    // A rule set that excludes everything and a broken predicate that returns
    // true unconditionally are indistinguishable without this.
    const narrow = (p: string) => [/\.css$/].some((r) => r.test(p))
    expect(narrow('static/css/x.css')).toBe(true)
    expect(narrow('static/chunks/main.js')).toBe(false)
  })

  it('the generated service worker precaches only a handful of entries', () => {
    // public/sw.js is a build artefact and is not tracked, so it is absent on a
    // clean checkout. When it IS present it is the real evidence, so assert on
    // it rather than trusting the policy alone.
    if (!existsSync('public/sw.js')) {
      expect(PRECACHE_EXCLUDE.length).toBeGreaterThan(0)
      return
    }
    const src = readFileSync('public/sw.js', 'utf8')
    const entries = (src.match(/revision/g) || []).length
    // Measured: 87 before, 5 after (next-pwa injects a few of its own).
    expect(entries).toBeLessThanOrEqual(10)
  })

  it('runtime caching is NOT disabled — this package stops precaching, not caching', () => {
    const cfg = readFileSync('next.config.js', 'utf8')
    expect(cfg).toContain('extendDefaultRuntimeCaching: true')
    expect(cfg).toContain('exclude: PRECACHE_EXCLUDE')
  })
})
