import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
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
      // TODO Q-051-NEW: remove excludes once unit tests reach 80% global thresholds.
      exclude: [
        'hooks/**',
        'lib/data/bloomberg/**',
        'lib/data/providers/**',
        'lib/ml/**',
        'lib/optimize/**',
        'lib/portfolio/**',
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
