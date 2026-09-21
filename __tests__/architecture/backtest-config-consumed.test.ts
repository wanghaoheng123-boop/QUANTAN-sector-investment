import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Q-127 — `PortfolioConfig.monthlyRebalance` was declared, defaulted to false,
 * and read by nothing. A backtest config that advertises "rebalance based on
 * sector rotation monthly" tells its reader the reported results model monthly
 * rebalancing. They never did.
 *
 * That is the same defect family as `_cached` set by three routes and consumed
 * by none (I2), and the DELAYED badge declared and rendered by nobody (I1): a
 * DECLARED FACT WITH NO CONSUMER. The declaration is the claim; without a
 * reader the claim is false.
 *
 * This guards the shape rather than the single instance — the next inert knob
 * fails here instead of being discovered by a red team two months later.
 */

const DECL = 'lib/backtest/portfolioBacktest.ts'
const ROOTS = ['lib', 'app', 'scripts']
const SKIP = new Set(['node_modules', '.next', '__tests__', 'backtestData', 'claude'])

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** Field names declared on the PortfolioConfig interface. */
export function declaredFields(src: string): string[] {
  const body = stripComments(src).match(/export interface PortfolioConfig[^{]*\{([\s\S]*?)\n\}/)
  if (!body) return []
  return [...body[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1])
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = ROOTS.flatMap((r) => walk(r))
const fields = declaredFields(readFileSync(DECL, 'utf8'))

/** A field is consumed when something outside the declaration reads it. */
function isConsumed(field: string): boolean {
  const re = new RegExp(`(?:\\.${field}\\b|\\b${field}\\s*[,}]|\\b${field}\\s*:)`)
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'))
    const hay = f === DECL
      // In the declaring file, ignore the interface body and the default object.
      ? src.replace(/export interface PortfolioConfig[^{]*\{[\s\S]*?\n\}/, '')
           .replace(/export const DEFAULT_PORTFOLIO_CONFIG[^=]*=\s*\{[\s\S]*?\n\}/, '')
      : src
    if (re.test(hay)) return true
  }
  return false
}

describe('Q-127 — every declared backtest config field has a consumer', () => {
  it('finds the declaration and the files that could consume it', () => {
    // Reachability. A scan that reads no fields would pass the next test
    // vacuously — the failure mode this repo keeps rediscovering.
    expect(fields.length).toBeGreaterThan(3)
    expect(files).toContain(DECL)
    expect(files.length).toBeGreaterThan(50)
  })

  it('no field is declared and then read by nobody', () => {
    const inert = fields.filter((f) => !isConsumed(f))
    expect(inert).toEqual([])
  })

  it('monthlyRebalance specifically is gone, not merely unread', () => {
    // Removing the reader while leaving the knob would pass the test above
    // only if the knob were also removed. Assert the knob itself.
    expect(fields).not.toContain('monthlyRebalance')
    expect(readFileSync(DECL, 'utf8')).not.toMatch(/^\s*monthlyRebalance\s*:/m)
  })

  it('POSITIVE CONTROL: the detector can actually find an inert field', () => {
    const fake = `export interface PortfolioConfig extends BacktestConfig {
  realOne: number
  neverRead: boolean
}`
    expect(declaredFields(fake)).toEqual(['realOne', 'neverRead'])
    // and it does not mistake a comment for a declaration
    expect(declaredFields(`export interface PortfolioConfig {
  // ghost: boolean
  realOne: number
}`)).toEqual(['realOne'])
  })
})
