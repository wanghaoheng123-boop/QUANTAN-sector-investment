import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A raw <a href="/..."> inside the app performs a full DOCUMENT navigation:
 * the whole shell is re-downloaded, re-parsed and re-hydrated, and every piece
 * of client state — SWR caches, the open SSE quote stream, scroll position —
 * is discarded. Next's <Link> does a soft navigation and keeps all of it.
 *
 * Measured on production 2026-09-14 (Q-119), clicking through to `/`, n=4 per
 * cell, median — from a heavy landing (/stock/AAPL) and a lighter one (/desk):
 *
 *   nav <Link href="/">           23-27.5 ms,  0 requests re-issued
 *   raw <a href="/"> (the brand)  96-190 ms,  16 requests re-issued
 *
 * The landing surface barely moved it (~16 ms between the two); the same
 * landing measured in two sessions moved ~78 ms. So the penalty is a property
 * of the navigation, not the page weight, and the honest figure is a range:
 * roughly 70-165 ms. Of the 16 re-issued requests, 14 are disk-cache hits and
 * 2 reach the network (the `/` document and a font stylesheet) — the document
 * round trip is the part that cannot be cached away.
 *
 * TWO RULES THIS FILE FOLLOWS, because this repo has been burned by both:
 *  1. Comments are stripped before matching. `ui-copy-promises.test.ts` v1
 *     flagged the JSX comment that EXPLAINED its own fix. The comment above
 *     the brand link in app/layout.tsx quotes `<a href=`, and would trip a
 *     naive matcher.
 *  2. Reachability is asserted, not assumed. Q-098/Q-100/Q-103 each shipped a
 *     correct rule over a file set that never contained the thing it governed.
 *     `visits the files it claims to govern` below is that assertion — when a
 *     guard is green, ask what it VISITED before you ask what it decided.
 */

const ROOTS = ['app', 'components']
// Stale worktrees under claude/ are not project source and are not tracked.
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__tests__', 'tests', 'coverage', 'claude'])

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') || p.endsWith('.jsx')) out.push(p)
  }
  return out
}

/** A raw <a> whose href is an in-app route: starts with a single `/`. */
export function rawInternalAnchors(source: string): string[] {
  const found: string[] = []
  for (const m of stripComments(source).matchAll(/<a\s[^>]*href=(["'])([^"']*)\1/g)) {
    const href = m[2]
    if (href.startsWith('/') && !href.startsWith('//')) found.push(href)
  }
  return found
}

const files = ROOTS.flatMap((r) => walk(r))

describe('internal navigation uses <Link>, never a raw <a>', () => {
  it('visits the files it claims to govern', () => {
    // Reachability: the rule is worthless if the scan never reaches the global
    // header. These two carried the defect this guard was written for.
    expect(files).toContain(join('app', 'layout.tsx'))
    expect(files).toContain(join('app', 'not-found.tsx'))
    expect(files.length).toBeGreaterThan(50)
  })

  it('no component links to an in-app route with a raw <a>', () => {
    const offenders = files
      .map((f) => ({ f, hrefs: rawInternalAnchors(readFileSync(f, 'utf8')) }))
      .filter((x) => x.hrefs.length > 0)
      .map((x) => `${x.f} -> ${x.hrefs.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('POSITIVE CONTROL: the matcher actually fails on a raw internal anchor', () => {
    expect(rawInternalAnchors('<a href="/desk" className="x">Desk</a>')).toEqual(['/desk'])
    expect(rawInternalAnchors("<a\n  href='/stock/AAPL'\n>x</a>")).toEqual(['/stock/AAPL'])
  })

  it('does not flag fragment, external or protocol-relative hrefs', () => {
    expect(rawInternalAnchors('<a href="#main">Skip to main content</a>')).toEqual([])
    expect(rawInternalAnchors('<a href="https://example.com" target="_blank">x</a>')).toEqual([])
    expect(rawInternalAnchors('<a href="//cdn.example.com/x">x</a>')).toEqual([])
    expect(rawInternalAnchors('<a href="mailto:a@b.c">x</a>')).toEqual([])
  })

  it('does not flag a raw anchor that appears only inside a comment', () => {
    // This is the exact shape that made ui-copy-promises.test.ts v1 fail on the
    // comment explaining its own fix.
    expect(rawInternalAnchors('{/* was: <a href="/"> — see Q-119 */}\n<Link href="/">x</Link>')).toEqual([])
    expect(rawInternalAnchors('// <a href="/desk">\n<Link href="/desk">x</Link>')).toEqual([])
  })

  it('WHAT THIS GUARD CANNOT DO — asserted, so a green run is never read as a proof', () => {
    // An href built at runtime is invisible to a source scan.
    expect(rawInternalAnchors('<a href={`/stock/${t}`}>x</a>')).toEqual([])
    // So is one spread in from an object.
    expect(rawInternalAnchors('<a {...linkProps}>x</a>')).toEqual([])
    // A router.push() in an onClick is a soft nav and is correctly not matched,
    // but neither would a location.assign(), which IS a hard navigation.
    expect(rawInternalAnchors('<button onClick={() => location.assign("/desk")}>x</button>')).toEqual([])
  })
})
