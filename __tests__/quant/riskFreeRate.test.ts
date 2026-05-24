import { describe, it, expect, beforeEach } from 'vitest'
import {
  getRiskFreeRateSync,
  getRiskFreeRate,
  prewarmRiskFreeRates,
  _resetRiskFreeRateCache,
  _peekRiskFreeRateCache,
} from '@/lib/quant/riskFreeRate'
import { BACKTEST_RFR_ANNUAL, OPTIONS_RFR_ANNUAL } from '@/lib/quant/constants'

describe('riskFreeRate — Q-004 + Q-052-NEW', () => {
  beforeEach(() => {
    _resetRiskFreeRateCache()
  })

  describe('getRiskFreeRateSync (cache-cold path)', () => {
    it('returns OPTIONS_RFR_ANNUAL for short tenors (≤90d → DGS3MO)', () => {
      expect(getRiskFreeRateSync(0)).toBe(OPTIONS_RFR_ANNUAL)
      expect(getRiskFreeRateSync(30)).toBe(OPTIONS_RFR_ANNUAL)
      expect(getRiskFreeRateSync(90)).toBe(OPTIONS_RFR_ANNUAL)
    })

    it('returns BACKTEST_RFR_ANNUAL for medium tenors (91–365d → DGS1)', () => {
      expect(getRiskFreeRateSync(91)).toBe(BACKTEST_RFR_ANNUAL)
      expect(getRiskFreeRateSync(180)).toBe(BACKTEST_RFR_ANNUAL)
      expect(getRiskFreeRateSync(365)).toBe(BACKTEST_RFR_ANNUAL)
    })

    it('returns BACKTEST_RFR_ANNUAL for long tenors (366–730d → DGS2)', () => {
      expect(getRiskFreeRateSync(366)).toBe(BACKTEST_RFR_ANNUAL)
      expect(getRiskFreeRateSync(730)).toBe(BACKTEST_RFR_ANNUAL)
    })

    it('returns BACKTEST_RFR_ANNUAL for very long tenors (>730d → DGS10)', () => {
      expect(getRiskFreeRateSync(731)).toBe(BACKTEST_RFR_ANNUAL)
      expect(getRiskFreeRateSync(3650)).toBe(BACKTEST_RFR_ANNUAL)
    })

    it('clamps non-finite tenor to default (365d)', () => {
      expect(getRiskFreeRateSync(NaN)).toBe(BACKTEST_RFR_ANNUAL)
      expect(getRiskFreeRateSync(-50)).toBe(OPTIONS_RFR_ANNUAL) // negative → max(0,t) → 0 → DGS3MO route
    })

    it('default tenor is 365d (DGS1)', () => {
      expect(getRiskFreeRateSync()).toBe(BACKTEST_RFR_ANNUAL)
    })
  })

  describe('cache hydration via stubbed async path', () => {
    it('subsequent sync call returns cached FRED value after async fills the cache', async () => {
      // We cannot rely on the real FRED endpoint in tests, but we CAN verify
      // the cache mechanism by stubbing fetch. Q-052-NEW: a stubbed-network
      // resolution flows through to the sync accessor.
      const realFetch = globalThis.fetch
      globalThis.fetch = async (url: string | URL | Request) => {
        // Return a minimal FRED-shaped CSV. DGS3MO ~5.21% for example.
        const csv = 'DATE,DGS3MO\n2026-05-20,5.21\n2026-05-21,5.22\n'
        return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } })
      }
      try {
        await getRiskFreeRate(30) // hits DGS3MO
        const hot = getRiskFreeRateSync(30)
        // 5.22% from CSV → decimal 0.0522
        expect(hot).toBeCloseTo(0.0522, 4)
        // Cache is now populated for DGS3MO only — other series still cold.
        expect(getRiskFreeRateSync(365)).toBe(BACKTEST_RFR_ANNUAL)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('cache survives across tenors that route to the same series', async () => {
      // 60d and 90d both route to DGS3MO — one fetch should serve both.
      const realFetch = globalThis.fetch
      let callCount = 0
      globalThis.fetch = async () => {
        callCount++
        return new Response('DATE,DGS3MO\n2026-05-21,4.85\n', { status: 200 })
      }
      try {
        await getRiskFreeRate(60)
        await getRiskFreeRate(90)
        // Single fetch served both calls (cache hit on the second).
        expect(callCount).toBe(1)
        expect(getRiskFreeRateSync(60)).toBeCloseTo(0.0485, 4)
        expect(getRiskFreeRateSync(90)).toBeCloseTo(0.0485, 4)
      } finally {
        globalThis.fetch = realFetch
      }
    })

    it('FRED error → returns static fallback and does not throw', async () => {
      const realFetch = globalThis.fetch
      globalThis.fetch = async () => new Response('', { status: 500 })
      try {
        const v = await getRiskFreeRate(30)
        // Failure path caches the fallback so subsequent sync calls don't re-fetch.
        expect(v).toBe(OPTIONS_RFR_ANNUAL)
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })

  describe('prewarmRiskFreeRates', () => {
    it('settles all 4 series in parallel and never throws', async () => {
      const realFetch = globalThis.fetch
      const seriesSeen: string[] = []
      globalThis.fetch = async (url: string | URL | Request) => {
        const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
        const match = u.match(/id=([A-Z0-9]+)/)
        if (match) seriesSeen.push(match[1])
        return new Response(`DATE,X\n2026-05-21,4.50\n`, { status: 200 })
      }
      try {
        await expect(prewarmRiskFreeRates()).resolves.toBeUndefined()
        // All 4 series fetched.
        expect(new Set(seriesSeen)).toEqual(new Set(['DGS3MO', 'DGS1', 'DGS2', 'DGS10']))
        // Cache populated for all 4.
        const peek = _peekRiskFreeRateCache()
        expect(peek.size).toBe(4)
      } finally {
        globalThis.fetch = realFetch
      }
    })
  })
})
