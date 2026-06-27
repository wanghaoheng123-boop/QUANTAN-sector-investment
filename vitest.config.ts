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
        'lib/data/bloomberg/**',
        // (2026-06-27) The lib/data/providers HTTP layer (yahoo/polygon/
        // alphavantage/fred + dispatcher + index) was deleted as dead code
        // (zero prod callers), so its coverage excludes are gone with it. Only
        // lib/data/providers/types.ts remains — pure interfaces, 0 executable
        // lines, so it needs no exclude.
        // ML sidecar client — needs HTTP fixture suite
        'lib/ml/**',
        // Grid search — long-running optimization; tested via end-to-end
        // benchmark instead. Phase 16 splits this into unit-testable units.
        'lib/optimize/gridSearch.ts',
        'lib/quant/buildFundamentalsPayload.ts',
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
