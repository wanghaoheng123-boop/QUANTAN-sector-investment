/**
 * Q-120 — what the service worker precaches at install.
 *
 * MEASURED on production 2026-09-20, not assumed:
 *
 *  • TIMING. The precache begins 51-65 ms AFTER the load event and 54-869 ms
 *    after first contentful paint. 0 of 87 requests were in flight before load.
 *    So it never delayed first paint — this is a BANDWIDTH cost, not a latency
 *    one. On Fast 3G (with the throttle applied to the service-worker session
 *    too, which is a separate CDP target) the tail ran to 55.5 s.
 *
 *  • SIZE. Cold first visit fetched 87-91 requests / 587-611 kB. Repeat visits
 *    cost 12.0 kB and 10.9 kB, because the chunks are immutable and already in
 *    the HTTP cache. 587 kB is therefore a cold-first-visit WORST CASE, and
 *    must be quoted as one.
 *
 *  • WHAT IT BOUGHT. Nothing that survives removal. There is no `fallbacks`
 *    config, no `~offline` route, and every /api/ route is NetworkOnly, so an
 *    offline user gets a shell with no fresh data either way. The offline shell
 *    itself comes from the `start-url` runtime cache and the immutable HTTP
 *    cache, NOT from this precache — verified by emptying the precache and
 *    reloading offline: the page still rendered, byte-identical at 4786 chars.
 *
 *  • INSTALLABILITY SURVIVES. Verified empirically in a NON-incognito context
 *    (an isolated browser context reports `in-incognito` and masks every other
 *    verdict): with the precache emptied, Page.getInstallabilityErrors returned
 *    NONE, the manifest reported no errors, and the service worker still
 *    registered with a fetch handler. First-visit SW traffic fell 611.5 kB ->
 *    74.1 kB on the same localhost build.
 *
 * 28 of the 87 entries were 288-byte SERVER-side API route chunks
 * (`/_next/static/chunks/app/api/.../route-*.js`) that a browser can never
 * execute: a third of the request count for 1% of the bytes.
 *
 * Runtime caching is deliberately left ON (`extendDefaultRuntimeCaching`), so
 * assets are still cached as they are actually used. The change is "stop
 * downloading the whole build up front", not "stop caching".
 */

/** Matched against each asset's path by workbox's GenerateSW `exclude`. */
const PRECACHE_EXCLUDE = [/.*/]

/** True when `assetPath` is kept OUT of the precache manifest. */
function isExcludedFromPrecache(assetPath) {
  return PRECACHE_EXCLUDE.some((rule) =>
    rule instanceof RegExp ? rule.test(assetPath) : rule === assetPath
  )
}

module.exports = { PRECACHE_EXCLUDE, isExcludedFromPrecache }
