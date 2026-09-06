/**
 * The backtest universe — the single declaration of which securities this
 * platform tracks and what sector each belongs to.
 *
 * Q110-D2 (2026-09-06) — extracted from `fetchBacktestData.mjs` because the I6
 * collision guard could not reach it. `__tests__/data/securityId.test.ts` ran
 * `assertNoIdCollisions` over entries scraped by REGEX out of that file's
 * source text. A regex over source is not a reader of data: change how the
 * array is written — a trailing comment between the fields, a different quote
 * style, a computed sector — and the match count silently drops to zero, the
 * guard runs over an empty list, and it passes. The `> 40` reachability control
 * was the only thing standing between that and a vacuous green.
 *
 * A module both the producer and the guard IMPORT cannot go quietly empty.
 * Kept as `.mjs` with no dependencies so the fetch script (which top-level
 * `await import`s `yahoo-finance2`) is not dragged into the test process.
 */

/** @type {ReadonlyArray<{ ticker: string, sector: string }>} */
export const TICKERS = [
  { ticker: 'NVDA',  sector: 'Technology'      },
  { ticker: 'MSFT',  sector: 'Technology'      },
  { ticker: 'AAPL',  sector: 'Technology'      },
  { ticker: 'AVGO',  sector: 'Technology'      },
  { ticker: 'AMD',   sector: 'Technology'      },
  { ticker: 'XOM',   sector: 'Energy'          },
  { ticker: 'CVX',   sector: 'Energy'          },
  { ticker: 'COP',   sector: 'Energy'          },
  { ticker: 'EOG',   sector: 'Energy'          },
  { ticker: 'SLB',   sector: 'Energy'          },
  { ticker: 'BRK-B', sector: 'Financials'      },
  { ticker: 'JPM',   sector: 'Financials'      },
  { ticker: 'V',     sector: 'Financials'      },
  { ticker: 'MA',    sector: 'Financials'      },
  { ticker: 'BAC',   sector: 'Financials'      },
  { ticker: 'LLY',   sector: 'Healthcare'      },
  { ticker: 'UNH',   sector: 'Healthcare'      },
  { ticker: 'JNJ',   sector: 'Healthcare'      },
  { ticker: 'ABBV',  sector: 'Healthcare'      },
  { ticker: 'MRK',   sector: 'Healthcare'      },
  { ticker: 'AMZN',  sector: 'Consumer Disc.'  },
  { ticker: 'TSLA',  sector: 'Consumer Disc.'  },
  { ticker: 'HD',    sector: 'Consumer Disc.'  },
  { ticker: 'MCD',   sector: 'Consumer Disc.'  },
  { ticker: 'NKE',   sector: 'Consumer Disc.'  },
  { ticker: 'GE',    sector: 'Industrials'     },
  { ticker: 'RTX',   sector: 'Industrials'     },
  { ticker: 'CAT',   sector: 'Industrials'     },
  { ticker: 'UNP',   sector: 'Industrials'     },
  { ticker: 'HON',   sector: 'Industrials'     },
  { ticker: 'META',  sector: 'Communication'  },
  { ticker: 'GOOGL', sector: 'Communication'  },
  { ticker: 'NFLX',  sector: 'Communication'  },
  { ticker: 'DIS',   sector: 'Communication'  },
  { ticker: 'T',     sector: 'Communication'  },
  { ticker: 'LIN',   sector: 'Materials'       },
  { ticker: 'APD',   sector: 'Materials'       },
  { ticker: 'FCX',   sector: 'Materials'       },
  { ticker: 'NEM',   sector: 'Materials'       },
  { ticker: 'DOW',   sector: 'Materials'       },
  { ticker: 'NEE',   sector: 'Utilities'       },
  { ticker: 'SO',    sector: 'Utilities'       },
  { ticker: 'DUK',   sector: 'Utilities'       },
  { ticker: 'AEP',   sector: 'Utilities'       },
  { ticker: 'PCG',   sector: 'Utilities'       },
  { ticker: 'PLD',   sector: 'Real Estate'     },
  { ticker: 'AMT',   sector: 'Real Estate'     },
  { ticker: 'EQIX',  sector: 'Real Estate'     },
  { ticker: 'WELL',  sector: 'Real Estate'     },
  { ticker: 'SPG',   sector: 'Real Estate'     },
  { ticker: 'PG',    sector: 'Consumer Staples'},
  { ticker: 'COST',  sector: 'Consumer Staples'},
  { ticker: 'WMT',   sector: 'Consumer Staples'},
  { ticker: 'PEP',   sector: 'Consumer Staples'},
  { ticker: 'KO',    sector: 'Consumer Staples'},
];
