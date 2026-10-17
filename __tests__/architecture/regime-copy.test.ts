/**
 * Q-153 (2026-10-17) — the 200-day-average regime describes; it does not
 * advise, and it does not quote returns nobody measured.
 *
 * Red-team R2-241-3 (HIGH): the regime copy rendered on three surfaces said
 * "textbook high-probability buy zone … consider scaling in", "Avoid long
 * exposure", "BUY THE DIP", "scale in with a maximum of 30–40% of your target
 * position", and an "Empirical Forward Return Reference" of median 3M/6M/12M
 * returns "based on … 1990–2024" data — an analysis this repository never ran.
 * Trade and sizing instructions are the surface Q-083 (MAS/FAA) gates; an
 * unsourced performance figure is what I5 forbids.
 *
 * Scans the USER-VISIBLE text (JSX text and string literals) of every file
 * that renders the regime, after comments are stripped.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderedPhrases, stripComments } from './sourceText'

const ROOT = join(__dirname, '..', '..')
const SURFACES = [
  'lib/quant/technicals.ts',
  'components/crypto/BtcQuantLab.tsx',
  'components/stock/quantlab/tabs/TechnicalsTab.tsx',
  'app/ma-deviation/page.tsx',
  'app/api/ma-deviation/route.ts',
]

/** Trade, sizing and timing instructions. */
const ADVICE = /\b(?:buy(?:ing)?|sell(?:ing)?|scale in|scaling in|average down|averaging (?:in|down)|accumulat\w*|avoid (?:long|chasing|averaging)|trim\w*|tranches?|staged (?:entry|buying)|go all-in|knife|screaming|opportunity zones?|target position|positioning)\b/i
/** Return and hit-rate figures, or a claim of a historical study. */
const RETURN_CLAIMS = /forward return|hit rate|median \d|\b\d+M (?:fwd|forward|return)|\b(?:19|20)\d\d\s*[–-]\s*(?:19|20)\d\d\b/i
/** The disclaimers that may name what the page is NOT. */
const DISCLAIMERS = [/not a forecast or a trade signal/gi, /forward returns for (?:them|these zones) have not been measured/gi, /has not measured forward returns for these zones/gi]
const offending = (t: string) => {
  const s = DISCLAIMERS.reduce((acc, re) => acc.replace(re, ' '), t)
  return ADVICE.test(s) || RETURN_CLAIMS.test(s)
}

describe('regime copy describes, and quotes no unmeasured returns (Q-153)', () => {
  it('catches the removed sentences and paraphrases of them (positive control)', () => {
    for (const s of [
      'this is a textbook high-probability buy zone — consider scaling in',
      'Avoid long exposure until 200MA slope inflects positive.',
      'scale in with a maximum of 30–40% of your target position',
      'Use a staged entry (e.g., 3 tranches over 2–4 weeks).',
      'Maximum historical opportunity: median 18M forward return +30–50%+',
      'Based on historical cross-section analysis of S&P 500 & sector ETF daily data (1990–2024).',
      'The same -12% deviation can be a screaming buy',
      'Strong Dip Buy',
      'BUY THE DIP',
      'Accumulate on dips below a rising average.',
      'Sell into strength when 20% above.',
    ]) expect(offending(s), s).toBe(true)
    expect(offending('A description of where price sits relative to its long-run average; not a forecast or a trade signal.')).toBe(false)
  })

  it('no surface that renders the regime gives trade instructions or return claims', () => {
    for (const f of SURFACES) {
      const phrases = renderedPhrases(stripComments(readFileSync(join(ROOT, f), 'utf8'), f))
      expect(phrases.length, `${f}: the extractor found no copy, so this check would be vacuous`).toBeGreaterThan(2)
      expect(phrases.filter(offending).map((p) => p.replace(/\s+/g, ' ').trim()), f).toEqual([])
    }
  })
})
