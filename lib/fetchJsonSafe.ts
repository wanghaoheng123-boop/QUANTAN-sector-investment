import { apiUrl } from '@/lib/apiBase'

/**
 * Fetch a JSON API route without ever throwing — derivatives APIs are often
 * geo-blocked, and the BTC Quant Lab degrades per panel rather than failing.
 * Extracted from components/crypto/BtcQuantLab.tsx (Q-138) so the
 * liquidations panel can own its own fetch.
 */
export async function fetchJsonSafe(path: string): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  try {
    const r = await fetch(apiUrl(path), { cache: 'no-store', headers: { Accept: 'application/json' } })
    const text = await r.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      return { ok: false, message: `${path} → invalid JSON (HTTP ${r.status})` }
    }
    if (!r.ok) {
      const err = (data as { userMessage?: string; error?: string; details?: string })?.userMessage
        ?? (data as { error?: string })?.error
        ?? (data as { details?: string })?.details
      return { ok: false, message: typeof err === 'string' ? err : `HTTP ${r.status}` }
    }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
