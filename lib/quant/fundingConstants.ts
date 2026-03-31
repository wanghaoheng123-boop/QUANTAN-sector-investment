/**
 * Binance USD-M perpetual `lastFundingRate` is a small decimal per funding interval
 * (e.g. 0.0001 ≈ 0.01% on the UI). Using 0.01 as a threshold implies 1% per interval,
 * which never occurs — alerts were effectively disabled.
 */
export const PERP_FUNDING_HIGH_ABS = 0.0005 /** ~0.05% / interval — very crowded */
export const PERP_FUNDING_MODERATE_ABS = 0.0001 /** ~0.01% / interval — meaningful */
