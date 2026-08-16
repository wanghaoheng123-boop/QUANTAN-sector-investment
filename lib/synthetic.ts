/**
 * Synthetic-data containment (design invariant I3).
 *
 * Lives OUTSIDE `lib/mockData.ts` deliberately: the architecture guard forbids
 * production code from importing the fixture module, so the brand had to move
 * or every consumer of the guard would trip the guard (finding Q088-8).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A WRAPPER AND NOT AN INTERSECTION
 * ---------------------------------------------------------------------------
 * The first attempt at this brand was:
 *
 *     type Synthetic<T> = T & { readonly __SYNTHETIC__: never }
 *
 * That is INVERTED and provides zero containment. An intersection makes
 * `Synthetic<T>` a *subtype* of `T`, and subtypes flow into supertype positions
 * freely — so synthetic data assigned straight into a real-data parameter
 * compiled clean, which is precisely the failure I3 exists to prevent. It
 * blocked only the harmless direction (real data into a synthetic-typed prop),
 * which is what made it look like it worked.
 *
 * A wrapper is nominal in the direction that matters: `Synthetic<T>` is NOT
 * assignable to `T`, so reaching the underlying value requires an explicit,
 * greppable `unwrapSynthetic()` call at a named surface.
 *
 * The wrapper also gives the runtime half something real to inspect. A
 * type-only brand is erased at build time, so a runtime assertion over it can
 * only ever check a caller-supplied boolean — a no-op dressed as a guard
 * (finding Q088-3). `__SYNTHETIC__: true` is an actual property that survives
 * into the running system and across JSON.
 */

/** Opaque carrier for synthetic values. Not assignable to `T` by design. */
export interface Synthetic<T> {
  readonly __SYNTHETIC__: true
  readonly value: T
}

/**
 * The single sanctioned way to create synthetic data. Anything that produces
 * fixture/demo/generated values for production rendering must route through
 * this, so `unwrapSynthetic` has something to verify.
 */
export function markSynthetic<T>(value: T): Synthetic<T> {
  return { __SYNTHETIC__: true, value }
}

/** Runtime predicate — works on values crossing a JSON or JS boundary. */
export function isSynthetic(x: unknown): x is Synthetic<unknown> {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { __SYNTHETIC__?: unknown }).__SYNTHETIC__ === true
  )
}

/**
 * Unwrap synthetic data at a surface that has explicitly accepted it.
 *
 * Unlike the previous `assertSyntheticAccepted(true, …)` — which took a
 * hardcoded literal and could never fire — this inspects the VALUE. If a
 * rewire ever routes real data here, the marker is absent and this throws.
 *
 * @param surface Human-readable name of the boundary, for the error message.
 * @throws if the value does not actually carry the synthetic marker
 *         (I2: fail closed, never fail silent).
 */
export function unwrapSynthetic<T>(wrapped: Synthetic<T>, surface: string): T {
  if (!isSynthetic(wrapped)) {
    throw new Error(
      `[I3] "${surface}" expected synthetic data carrying the __SYNTHETIC__ marker ` +
        `but received a value without it. Either real data was rewired into a ` +
        `synthetic-only surface, or the marker was stripped in transit. ` +
        `See design invariant I3 in CLAUDE.md and Q-088.`,
    )
  }
  return wrapped.value
}

/**
 * Guard for the reverse direction: assert a value is NOT synthetic before it
 * reaches a chart, signal, or backtest. Use at boundaries that must only ever
 * see real market data.
 *
 * @throws if the value carries the synthetic marker.
 */
export function assertNotSynthetic(value: unknown, surface: string): void {
  if (isSynthetic(value)) {
    throw new Error(
      `[I3] Synthetic data reached "${surface}", which must only receive real ` +
        `market data. Synthetic data must not reach a backtest, a chart, or a ` +
        `signal. See design invariant I3 in CLAUDE.md and Q-088.`,
    )
  }
}
