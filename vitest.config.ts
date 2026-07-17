import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Phase 16 (2026-05-24): default environment is Node for speed. Component
    // tests (`__tests__/components/**`) opt into jsdom via the per-file
    // pragma `// @vitest-environment jsdom`. (Vitest 4 dropped
    // `environmentMatchGlobs`; the pragma is the supported replacement.)
    environment: 'node',
    globals: true,
    // 30s global timeout (2026-07-10): Stryker's INSTRUMENTED dry run is
    // ~5-10× slower than a bare run, and the 5s default killed the weekly
    // mutation job at startup for five straight weeks (one walk-forward test
    // after another tripping it). Passing tests are unaffected; only the
    // failure budget grows.
    testTimeout: 30_000,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    // Q-027 / Phase 16: jest-dom matchers (toBeInTheDocument, toHaveAttribute,
    // etc.) registered globally for component specs.
    setupFiles: ['__tests__/setup/jest-dom.ts'],
    coverage: {
      provider: 'v8',
      // Q-022: expanded beyond lib/quant|backtest|qa|options; see exclude for Q-051-NEW gap.
      include: [
        'lib/quant/**',
        'lib/backtest/**',
        'lib/qa/**',
        'lib/options/**',
        'lib/api/**',
        'lib/data/**',
        'lib/portfolio/**',
        'lib/optimize/**',
        'lib/ml/**',
        'hooks/**',
      ],
      // Q-051-NEW staged backfill. Each entry here is a file (or dir) whose
      // dedicated unit tests haven't landed yet. As tests land in Phase 16,
      // remove the corresponding entry — that PR becomes the gate that proves
      // the file meets the global thresholds. Removing in bulk regresses the
      // global coverage and re-introduces the same gate failure Q-051-NEW
      // exists to close, so be surgical.
      //
      // Phase 16 kickoff (2026-05-24):
      //   - lib/optimize/parameterSets.ts ✓ tested (this kickoff)
      //   - lib/optimize/sectorProfiles.ts ✓ tested (this kickoff)
      //   - hooks/useErrorToast.ts ✓ tested (this kickoff)
      // Q-051 continuation (2026-07-17):
      //   - lib/ml/** ✓ un-excluded (__tests__/ml/client.test.ts had landed
      //     after the exclude — it was stale)
      //   - lib/data/bloomberg/** ✓ un-excluded (__tests__/data/bloombergBridge.test.ts)
      //   - lib/optimize/gridSearch.ts ✓ un-excluded (Q-064 purged tests +
      //     legacy-contract tests in __tests__/optimize/gridSearchPurged.test.ts)
      //   - lib/quant/buildFundamentalsPayload.ts ✓ un-excluded (2026-07-17:
      //     __tests__/quant/buildFundamentalsPayload.test.ts fixture suite)
      //
      // Remaining excludes (Phase 16 Q-051-NEW continuation):
      exclude: [
        // EventSource lifecycle — needs heavy jsdom/MockEvent harness; defer
        'hooks/useLiveQuote.ts',
        'hooks/useLiveQuotes.ts',
        // Imperative lightweight-charts canvas lifecycle — extracted from
        // components/KLineChart.tsx (which was never in `include`); has no unit
        // tests by design (canvas rendering, verified via runtime/build instead).
        // Same category as the EventSource hooks above.
        'hooks/useKLineChart.ts',
        // localStorage + next-auth coupling — needs auth/session mocks
        'hooks/useLivePrices.ts',
        'hooks/useDialogA11y.ts',
        'hooks/useWatchlist.ts',
        // SQLite — already integration-tested but skipped when better-sqlite3
        // native binding is unavailable (which it is in default CI image)
        'lib/data/warehouse.ts',
        // (2026-06-27) The lib/data/providers HTTP layer (yahoo/polygon/
        // alphavantage/fred + dispatcher + index) was deleted as dead code
        // (zero prod callers), so its coverage excludes are gone with it. Only
        // lib/data/providers/types.ts remains — pure interfaces, 0 executable
        // lines, so it needs no exclude.
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
})
