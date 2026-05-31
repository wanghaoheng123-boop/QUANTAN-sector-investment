import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { isValidApiKey } from '@/lib/auth/apiKey';

// --- Mocks: never make real LLM calls; control the session at will. ---
const runTradingAgents = vi.fn(async (ticker: string) => ({
  ticker,
  agents: [],
  summary: 'mocked',
}));
vi.mock('@/lib/agents/orchestrator', () => ({
  runTradingAgents: (ticker: string) => runTradingAgents(ticker),
}));

const getServerSession = vi.fn();
vi.mock('@/lib/auth/session', () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));

import { POST } from '@/app/api/trading-agents/[ticker]/route';

const PARAMS = { params: { ticker: 'AAPL' } };
const SECRET = 'super-secret-key-value';

function postReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/trading-agents/AAPL', {
    method: 'POST',
    headers,
  });
}

const adminSession = { user: { id: 'u1', email: 'a@b.c', isAdmin: true } };
const nonAdminSession = { user: { id: 'u2', email: 'x@y.z', isAdmin: false } };

describe('isValidApiKey (fail-closed, constant-time)', () => {
  const ORIGINAL = process.env.QUANTAN_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QUANTAN_API_KEY;
    else process.env.QUANTAN_API_KEY = ORIGINAL;
  });

  it('rejects when the server secret is unset (fail-closed)', () => {
    delete process.env.QUANTAN_API_KEY;
    expect(isValidApiKey('anything')).toBe(false);
    expect(isValidApiKey('')).toBe(false);
    expect(isValidApiKey(null)).toBe(false);
  });

  it('rejects when the server secret is set but no key is presented', () => {
    process.env.QUANTAN_API_KEY = SECRET;
    expect(isValidApiKey(null)).toBe(false);
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey('')).toBe(false);
  });

  it('rejects a wrong key (including a short probe — must not throw)', () => {
    process.env.QUANTAN_API_KEY = SECRET;
    expect(isValidApiKey('x')).toBe(false); // length-mismatch must not throw
    expect(isValidApiKey('wrong')).toBe(false);
    expect(isValidApiKey(SECRET + 'x')).toBe(false);
  });

  it('accepts the exact matching key', () => {
    process.env.QUANTAN_API_KEY = SECRET;
    expect(isValidApiKey(SECRET)).toBe(true);
  });
});

describe('POST /api/trading-agents/[ticker] — auth gate (D4-1)', () => {
  const ORIGINAL = process.env.QUANTAN_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue(null); // unauthenticated by default
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QUANTAN_API_KEY;
    else process.env.QUANTAN_API_KEY = ORIGINAL;
  });

  it('rejects a bare x-api-key header when no secret is configured (the old bypass)', async () => {
    delete process.env.QUANTAN_API_KEY;
    const res = await POST(postReq({ 'x-api-key': 'literally-anything' }), PARAMS);
    expect(res.status).toBe(401);
    expect(runTradingAgents).not.toHaveBeenCalled();
  });

  it('rejects a wrong x-api-key when a secret IS configured', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    const res = await POST(postReq({ 'x-api-key': 'not-the-secret' }), PARAMS);
    expect(res.status).toBe(401);
    expect(runTradingAgents).not.toHaveBeenCalled();
  });

  it('rejects when there is no key and no session', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    const res = await POST(postReq(), PARAMS);
    expect(res.status).toBe(401);
    expect(runTradingAgents).not.toHaveBeenCalled();
  });

  it('rejects a non-admin session with no valid key', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    getServerSession.mockResolvedValue(nonAdminSession);
    const res = await POST(postReq(), PARAMS);
    expect(res.status).toBe(401);
    expect(runTradingAgents).not.toHaveBeenCalled();
  });

  it('accepts a correct x-api-key when the secret is configured', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    const res = await POST(postReq({ 'x-api-key': SECRET }), PARAMS);
    expect(res.status).toBe(200);
    expect(runTradingAgents).toHaveBeenCalledWith('AAPL');
  });

  it('accepts an admin session even without an API key', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    getServerSession.mockResolvedValue(adminSession);
    const res = await POST(postReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(runTradingAgents).toHaveBeenCalledWith('AAPL');
  });

  it('accepts an admin session even when no secret is configured (session path preserved)', async () => {
    delete process.env.QUANTAN_API_KEY;
    getServerSession.mockResolvedValue(adminSession);
    const res = await POST(postReq(), PARAMS);
    expect(res.status).toBe(200);
    expect(runTradingAgents).toHaveBeenCalledWith('AAPL');
  });

  it('rejects an invalid ticker before any auth/agent work', async () => {
    process.env.QUANTAN_API_KEY = SECRET;
    const res = await POST(
      postReq({ 'x-api-key': SECRET }),
      { params: { ticker: 'not a ticker!!' } }
    );
    expect(res.status).toBe(400);
    expect(runTradingAgents).not.toHaveBeenCalled();
  });
});
