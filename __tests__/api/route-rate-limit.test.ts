import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock the Yahoo provider so the rate-limited routes make no real calls.
vi.mock('@/lib/providers/yahoo', () => ({
  fetchQuote: vi.fn(async () => ({})),
  fetchHistory: vi.fn(async () => ({})),
  fetchStats: vi.fn(async () => ({})),
  fetchProfile: vi.fn(async () => ({})),
  fetchFinancials: vi.fn(async () => ({})),
  fetchEarnings: vi.fn(async () => ({})),
}));

import { GET as analyticsGET } from '@/app/api/analytics/[ticker]/route';
import { GET as fundamentalsGET } from '@/app/api/fundamentals/[ticker]/route';

// Each request from a distinct IP keeps buckets isolated across cases; within a
// case we reuse one IP to drive the per-process limiter past its threshold.
function req(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/x/AAPL', {
    headers: { 'x-forwarded-for': ip },
  });
}
const PARAMS = { params: { ticker: 'AAPL' } };
const LIMIT = 30;

describe('rate limiting on Yahoo-fanout routes (D4-3)', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_KV_URL; // force in-process limiter
  });

  it('analytics: allows up to the limit then returns 429', async () => {
    const r = req('10.0.0.1');
    for (let i = 0; i < LIMIT; i++) {
      const res = await analyticsGET(r, PARAMS);
      expect(res.status).toBe(200);
    }
    const blocked = await analyticsGET(r, PARAMS);
    expect(blocked.status).toBe(429);
  });

  it('fundamentals: allows up to the limit then returns 429', async () => {
    const r = req('10.0.0.2');
    for (let i = 0; i < LIMIT; i++) {
      const res = await fundamentalsGET(r, PARAMS);
      expect(res.status).toBe(200);
    }
    const blocked = await fundamentalsGET(r, PARAMS);
    expect(blocked.status).toBe(429);
  });

  it('analytics and fundamentals use separate buckets (same IP)', async () => {
    const r = req('10.0.0.3');
    // Exhaust analytics.
    for (let i = 0; i < LIMIT; i++) await analyticsGET(r, PARAMS);
    expect((await analyticsGET(r, PARAMS)).status).toBe(429);
    // Fundamentals from the same IP is still fresh.
    expect((await fundamentalsGET(r, PARAMS)).status).toBe(200);
  });
});
