/**
 * Shared KLineChart types — extracted to a neutral leaf module so that both
 * `KLineChart.tsx` and its `useKLineChart` hook can import them WITHOUT creating
 * a `KLineChart ↔ useKLineChart` circular dependency (the project keeps a
 * zero-cycle invariant; the hook needs `KLineIndicatorFlags` and the component
 * imports the hook). `KLineChart.tsx` re-exports `KLineIndicatorFlags` so the
 * public import path `@/components/KLineChart` is unchanged for callers.
 */

export type KLineIndicatorFlags = {
  ema4?: boolean;  ema5?: boolean;  ema6?: boolean;  ema7?: boolean;  ema8?: boolean;
  ema9?: boolean;  ema10?: boolean; ema12?: boolean;
  ema15?: boolean; ema20?: boolean; ema21?: boolean; ema26?: boolean;
  ema30?: boolean; ema40?: boolean;
  ema50?: boolean; ema60?: boolean;
  ema100?: boolean;
  ema150?: boolean;
  ema200?: boolean;
  ema250?: boolean;
  vwap?: boolean
  bollingerBands?: boolean
  fibonacci?: boolean
}
