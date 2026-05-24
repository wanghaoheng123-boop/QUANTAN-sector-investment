import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchMlPrediction, isMlSidecarAvailable } from '@/lib/ml/client'

describe('lib/ml/client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchMlPrediction returns parsed JSON on 200', async () => {
    const payload = {
      ticker: 'AAPL',
      probability: 0.62,
      signal: 'BUY' as const,
      confidence: 0.24,
      modelVersion: 'v1',
      trainedAt: '2026-05-01',
      nTrainSamples: 500,
      featureImportance: { rsi: 0.3 },
    }
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => payload,
    })

    const result = await fetchMlPrediction('AAPL')
    expect(result).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/predict/AAPL'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('fetchMlPrediction returns null on non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    await expect(fetchMlPrediction('MSFT')).resolves.toBeNull()
  })

  it('fetchMlPrediction returns null on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(fetchMlPrediction('MSFT')).resolves.toBeNull()
  })

  it('fetchMlPrediction returns null when fetch aborts', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(fetchMlPrediction('NVDA')).resolves.toBeNull()
  })

  it('isMlSidecarAvailable returns true when health responds ok', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    await expect(isMlSidecarAvailable()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('isMlSidecarAvailable returns false when health fails', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    await expect(isMlSidecarAvailable()).resolves.toBe(false)
  })
})
