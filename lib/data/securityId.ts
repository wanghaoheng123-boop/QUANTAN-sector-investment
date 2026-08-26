/**
 * Security identity — the SSOT for "which instrument is this?" (invariant I6).
 *
 * I6: "Tickers are recycled and reassigned. Use FIGI/PermID/internal surrogate
 * keys with a ticker→ID mapping table that is itself bitemporal."
 *
 * WHY THIS EXISTS
 * ---------------
 * Identity was a lossy string mangle spread across the repo, and the two halves
 * were not inverses of each other:
 *
 *   lib/backtest/dataLoader.ts:37   ticker.replace(/\./g, '-')   // BRK.B → BRK-B
 *   lib/backtest/dataLoader.ts:143  name.replace(/-/g, '.')      // BRK-B → BRK.B
 *
 * The universe declares `BRK-B`, the fixture is `BRK-B.json`, and
 * `availableTickers()` reports `BRK.B` — so ONE security had two identities
 * depending on which path you arrived by. Worse, the reverse mangle is
 * unconditional: a genuine hyphenated symbol like `BTC-USD` would come back as
 * `BTC.USD`, which is not a security at all. `lib/optimize/sectorProfiles.ts`
 * carried its own `.replace('-', '.')` workaround for the same confusion, and
 * replaced only the FIRST hyphen.
 *
 * THE RULE, AND ITS ASSUMPTION
 * ----------------------------
 * A trailing single letter after a separator is a SHARE CLASS (`BRK.B`,
 * `BF.B`); anything else is part of the symbol (`BTC-USD`, `EUR-GBP`). So the
 * separator is canonicalised ONLY in the share-class case, which leaves pairs
 * untouched.
 *
 * The assumption — that `BRK.B` and `BRK-B` are the same security in different
 * vendor conventions — is true for US equities and is the reason this is safe.
 * It is not self-evidently true forever, so `assertNoIdCollisions` exists to
 * fail loudly if two distinct universe entries ever collapse onto one id.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is an INTERNAL SURROGATE KEY, not a FIGI or a PermID. It does not solve
 * the reassignment problem I6 is really about — if a ticker is handed to a new
 * issuer, this still returns the same id, because no vendor identifier is
 * available to distinguish them. `scripts/lib/handoverDetect.mjs` is the
 * compensating control: it makes a handover VISIBLE in the price series rather
 * than silently splicing two issuers into one history. A real permanent
 * identifier still has to be licensed — see `Q-080`.
 */

/** Distinct from a vendor symbol: this is what the warehouse keys on. */
export type SecurityId = string

/** `BRK-B` / `BRK.B` → share class; `BTC-USD` → not a share class. */
const SHARE_CLASS = /^([A-Z0-9]+)[.-]([A-Z])$/

/**
 * Canonical identity. Uppercased, share-class separator normalised to `.`.
 *
 * `BRK-B` and `BRK.B` both → `BRK.B`. `BTC-USD` → `BTC-USD` (untouched).
 * Returns `null` for input that cannot be an identity, so callers fail closed
 * rather than propagating an empty string as a lookup key.
 */
export function canonicalSecurityId(raw: string): SecurityId | null {
  const t = raw.trim().toUpperCase()
  if (t.length === 0) return null
  // Allow the caret-prefixed index form through untouched (^VIX, ^GSPC).
  if (/^\^[A-Z0-9]+$/.test(t)) return t
  if (!/^[A-Z0-9]+([.-][A-Z0-9]+)?$/.test(t)) return null
  const m = SHARE_CLASS.exec(t)
  return m ? `${m[1]}.${m[2]}` : t
}

/**
 * Filesystem-safe name for a security's fixture. `.` is legal in filenames, but
 * the existing corpus uses the hyphen form, so this preserves it rather than
 * forcing a rename of every fixture.
 */
export function dataFileNameFor(id: SecurityId): string {
  const m = SHARE_CLASS.exec(id)
  return m ? `${m[1]}-${m[2]}` : id
}

/**
 * Inverse of `dataFileNameFor`. Unlike the blanket `replace(/-/g, '.')` it
 * replaces, this round-trips `BTC-USD` unchanged.
 */
export function securityIdFromFileName(name: string): SecurityId | null {
  return canonicalSecurityId(name)
}

/** A universe entry: the symbol as written, plus what we believe it is. */
export interface UniverseEntry {
  symbol: string
  /** Sector, issuer, or any attribute two different securities would disagree on. */
  attribute?: string
}

/**
 * Fail loudly when one identity carries CONFLICTING attributes.
 *
 * An earlier version of this compared symbols and flagged `BRK.B` vs `BRK-B` —
 * which is decoration, because canonicalisation only ever merges symbols that
 * differ by the share-class separator, and by the assumption above those ARE the
 * same security. A check that cannot fail for a real reason is worse than none:
 * it reads as coverage.
 *
 * The real risk is that two DIFFERENT securities land on one id, and symbols
 * alone cannot show that. Conflicting attributes can: if `BRK-B` arrives as
 * Financials and `BRK.B` as Technology, one of them is not what we think it is,
 * and merging their histories would splice two issuers into one series.
 */
export function assertNoIdCollisions(entries: readonly UniverseEntry[]): void {
  const byId = new Map<SecurityId, Map<string, string[]>>()
  for (const { symbol, attribute } of entries) {
    const id = canonicalSecurityId(symbol)
    if (id == null || !attribute) continue
    const attrs = byId.get(id) ?? new Map<string, string[]>()
    const seen = attrs.get(attribute) ?? []
    seen.push(symbol)
    attrs.set(attribute, seen)
    byId.set(id, attrs)
  }
  const collisions = [...byId.entries()]
    .filter(([, attrs]) => attrs.size > 1)
    .map(([id, attrs]) =>
      `${id} carries ${[...attrs.entries()].map(([a, syms]) => `${a} (${syms.join('/')})`).join(' and ')}`,
    )
  if (collisions.length > 0) {
    throw new Error(
      `[I6] one security id carries conflicting attributes: ${collisions.join('; ')}. ` +
        'Merging their histories would splice two issuers into one series.',
    )
  }
}
