/**
 * Direct unit tests for the sector-brief builder (UX-26).
 *
 * Before 2026-08-15 this logic was only reachable through an HTTP route, and
 * the two pages that rendered it reached it by fetching their own deployment.
 * Nothing tested it in-process, so the outage — an internal hop failing while
 * the same route answered 200 externally — had no test that could have caught
 * it. The builder now lives in lib/ with an injectable upstream seam, and these
 * tests exercise it with fake fetchers: no network, deterministic, and they
 * pin the two behaviours the pages depend on.
 *
 *   1. An UNKNOWN SECTOR and a DEAD UPSTREAM are different results. Unknown
 *      slug → null (the route 404s, the page shows "Sector not found").
 *      Yahoo down → a real brief with dataQuality:'unavailable'. If those ever
 *      collapse into one another, the honest "degraded" pill on /briefs starts
 *      lying again in one direction or the other.
 *   2. `getSectorBriefSafe` RESOLVES on a throwing upstream — it never rejects.
 *      That is the exact shape the old page got wrong: `return res.json()`
 *      inside a `try` returns before the catch can apply, so the rejection
 *      escaped and crashed the server render (digest 2384324333).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildSectorBrief,
  getSectorBriefSafe,
  getAllSectorBriefs,
  aggregateDataQuality,
  briefsHealth,
  type BriefFetchers,
  type SectorBrief,
} from '@/lib/briefs/sectorBrief'
import { SECTORS } from '@/lib/sectors'

// ─── Fakes ────────────────────────────────────────────────────────────────────

const QUOTE = {
  regularMarketPrice: 250.5,
  regularMarketChange: 2.5,
  regularMarketChangePercent: 1.01,
  regularMarketTime: new Date('2026-08-14T20:00:00Z'),
  regularMarketVolume: 5_000_000,
  averageDailyVolume3Month: 4_000_000,
  marketCap: 75_000_000_000,
  fiftyTwoWeekHigh: 260,
  fiftyTwoWeekLow: 180,
}

const SUMMARY = {
  defaultKeyStatistics: {
    trailingPE: 31.2,
    forwardPE: 27.4,
    beta: 1.15,
    dividendYield: 0.0062,
    averageDailyVolume10Day: 3_800_000,
  },
  financialData: { targetPrice: 280 },
  recommendationTrend: { trend: [{ strongBuy: 8, buy: 6, hold: 3, sell: 1, strongSell: 0 }] },
}

const NEWS = {
  news: [
    {
      title: 'Chipmakers rally',
      publisher: 'Reuters',
      publishedAt: '2026-08-14T18:00:00Z',
      summary: 'Semis led the tape.',
      link: 'https://example.test/a',
      relatedTickers: ['NVDA', 'AMD'],
    },
    {
      // Dropped by isSafeHttpUrl — the client renders link in an <a href>.
      title: 'Hostile upstream item',
      publisher: 'Nobody',
      link: 'javascript:alert(1)',
    },
  ],
}

/** Every call resolves with healthy data. */
function healthyFetchers(): BriefFetchers {
  return {
    quote: vi.fn(async () => QUOTE),
    quoteSummary: vi.fn(async () => SUMMARY),
    search: vi.fn(async () => NEWS),
  }
}

/** Every call rejects — the "Yahoo is down" case. */
function deadFetchers(): BriefFetchers {
  const boom = async () => { throw new Error('yahoo 403') }
  return { quote: boom, quoteSummary: boom, search: boom }
}

/** Throws SYNCHRONOUSLY, so the builder itself rejects rather than degrading. */
function explodingFetchers(): BriefFetchers {
  const boom = () => { throw new Error('upstream client blew up') }
  return { quote: boom, quoteSummary: boom, search: boom }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // fetchWithFallback / getSectorBriefSafe log on the degraded paths by design.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { warn.mockRestore() })

// ─── buildSectorBrief ─────────────────────────────────────────────────────────

describe('buildSectorBrief — happy path', () => {
  it('builds a live brief from healthy upstream data', async () => {
    const brief = await buildSectorBrief('technology', healthyFetchers()) as SectorBrief
    expect(brief).not.toBeNull()
    expect(brief.sector).toBe('technology')
    expect(brief.sectorName).toBe('Technology')
    expect(brief.price).toBe(250.5)
    expect(brief.changePct).toBeCloseTo(1.01, 5)
    expect(brief.high52w).toBe(260)
    expect(brief.peRatio).toBe(31.2)
    expect(brief.dataQuality).toBe('live')
    expect(brief.dataQualityNote).toBeNull()
    expect(brief.source).toBe('Yahoo Finance')
  })

  it('resolves the analyst consensus from the recommendation trend', async () => {
    const brief = await buildSectorBrief('technology', healthyFetchers()) as SectorBrief
    // 14 of 18 bullish → ≥60% → BUY.
    expect(brief.analystRating).toBe('BUY')
    expect(brief.analystCount).toBe(18)
    expect(brief.targetPrice).toBe(280)
  })

  it('loads the sector ETF quote and every top holding', async () => {
    const fetchers = healthyFetchers()
    const brief = await buildSectorBrief('technology', fetchers) as SectorBrief
    const tech = SECTORS.find(s => s.slug === 'technology')!
    // 1 ETF quote + 5 holdings quotes.
    expect(fetchers.quote).toHaveBeenCalledTimes(6)
    expect(fetchers.quote).toHaveBeenCalledWith(tech.etf)
    expect(brief.holdings).toHaveLength(5)
    expect(brief.holdings.map(h => h.ticker)).toEqual(tech.topHoldings.slice(0, 5))
  })

  it('drops news items whose link is not a safe http(s) URL', async () => {
    const brief = await buildSectorBrief('technology', healthyFetchers()) as SectorBrief
    expect(brief.news).toHaveLength(1)
    expect(brief.news[0].link).toBe('https://example.test/a')
    expect(brief.news.some(n => n.link.startsWith('javascript:'))).toBe(false)
  })
})

describe('buildSectorBrief — unknown sector vs dead upstream', () => {
  it('returns null for an unknown slug (the route 404s on this)', async () => {
    expect(await buildSectorBrief('not-a-sector', healthyFetchers())).toBeNull()
    expect(await buildSectorBrief('', healthyFetchers())).toBeNull()
  })

  it('trims the slug before matching', async () => {
    const brief = await buildSectorBrief('  technology  ', healthyFetchers())
    expect(brief?.sector).toBe('technology')
  })

  it('returns a brief — NOT null — when every upstream call fails', async () => {
    const brief = await buildSectorBrief('technology', deadFetchers())
    expect(brief).not.toBeNull()
    expect(brief!.dataQuality).toBe('unavailable')
    expect(brief!.dataQualityNote).toMatch(/Insufficient data from Yahoo Finance/)
    expect(brief!.price).toBe(0)
    expect(brief!.holdings).toEqual([])
    expect(brief!.news).toEqual([])
  })

  it('reports partial quality when only some fields are missing', async () => {
    const fetchers = healthyFetchers()
    // Quote + summary fine, no news → exactly one missing field.
    fetchers.search = async () => ({ news: [] })
    const brief = await buildSectorBrief('technology', fetchers) as SectorBrief
    expect(brief.dataQuality).toBe('partial')
    expect(brief.dataQualityNote).toMatch(/1 field\(s\) missing/)
  })
})

// ─── getSectorBriefSafe ───────────────────────────────────────────────────────

describe('getSectorBriefSafe — the crash class from UX-26b', () => {
  it('RESOLVES to null when the builder throws (it must never reject)', async () => {
    // The old page wrote `return res.json()` inside a try/catch. An async
    // function returns before the catch can apply to the returned promise, so
    // that rejection escaped and crashed the server render. `return await`
    // inside the try is what makes this pass.
    await expect(getSectorBriefSafe('technology', explodingFetchers())).resolves.toBeNull()
  })

  it('still returns null for an unknown slug', async () => {
    await expect(getSectorBriefSafe('nope', healthyFetchers())).resolves.toBeNull()
  })

  it('passes a healthy brief straight through', async () => {
    const brief = await getSectorBriefSafe('energy', healthyFetchers())
    expect(brief?.sector).toBe('energy')
  })
})

// ─── getAllSectorBriefs ───────────────────────────────────────────────────────

describe('getAllSectorBriefs', () => {
  it('builds one brief per sector, sorted by holdings average change', async () => {
    const { briefs, failedSlugs } = await getAllSectorBriefs(healthyFetchers())
    expect(briefs).toHaveLength(SECTORS.length)
    expect(failedSlugs).toEqual([])
    const changes = briefs.map(b => b.holdingsAvgChange)
    expect([...changes].sort((a, b) => b - a)).toEqual(changes)
  })

  it('never rejects — a throwing builder lands in failedSlugs instead', async () => {
    const { briefs, failedSlugs } = await getAllSectorBriefs(explodingFetchers())
    expect(briefs).toEqual([])
    expect(failedSlugs).toEqual(SECTORS.map(s => s.slug))
  })

  it('a dead provider yields full briefs marked unavailable, not failures', async () => {
    const { briefs, failedSlugs } = await getAllSectorBriefs(deadFetchers())
    expect(failedSlugs).toEqual([])
    expect(briefs).toHaveLength(SECTORS.length)
    expect(briefs.every(b => b.dataQuality === 'unavailable')).toBe(true)
  })
})

// ─── aggregateDataQuality ─────────────────────────────────────────────────────

describe('aggregateDataQuality — what the header pill renders', () => {
  const at = (q: SectorBrief['dataQuality']) => ({ dataQuality: q }) as SectorBrief

  it('is live only when every brief is live', () => {
    expect(aggregateDataQuality([at('live'), at('live')])).toBe('live')
  })

  it('degrades to partial on any partial brief', () => {
    expect(aggregateDataQuality([at('live'), at('partial')])).toBe('partial')
  })

  it('degrades to unavailable on any unavailable brief', () => {
    expect(aggregateDataQuality([at('live'), at('partial'), at('unavailable')])).toBe('unavailable')
  })

  it('treats an empty list as unavailable — never as live', () => {
    expect(aggregateDataQuality([])).toBe('unavailable')
  })
})

describe('briefsHealth — the pill reads BOTH failure axes', () => {
  const at = (q: SectorBrief['dataQuality']) => ({ dataQuality: q }) as SectorBrief

  it('is live only when everything built and every brief is live', () => {
    expect(briefsHealth([at('live'), at('live')], [])).toBe('live')
  })

  it('is NEVER live while any brief failed to build', () => {
    // The trap: aggregateDataQuality only sees briefs that SUCCEEDED, so five
    // live briefs plus six builder throws would render the green "Live data
    // from Yahoo Finance" pill directly above "6 briefs could not be built".
    expect(briefsHealth([at('live'), at('live')], ['energy'])).toBe('internal')
    expect(briefsHealth([at('live')], ['energy', 'utilities'])).not.toBe('live')
  })

  it('reports an internal failure rather than blaming the provider', () => {
    // Total builder failure: zero briefs. Without the failedSlugs axis this
    // would report 'unavailable', i.e. "Yahoo is down" for our own bug.
    expect(briefsHealth([], ['energy', 'technology'])).toBe('internal')
  })

  it('an internal failure outranks a degraded provider', () => {
    expect(briefsHealth([at('unavailable')], ['energy'])).toBe('internal')
    expect(briefsHealth([at('partial')], ['energy'])).toBe('internal')
  })

  it('falls through to provider quality when everything built', () => {
    expect(briefsHealth([at('live'), at('partial')], [])).toBe('partial')
    expect(briefsHealth([at('unavailable')], [])).toBe('unavailable')
  })
})
