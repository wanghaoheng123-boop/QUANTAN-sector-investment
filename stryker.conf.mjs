/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: [
    'lib/quant/**/*.ts',
    'lib/backtest/**/*.ts',
    'lib/options/**/*.ts',
  ],
  thresholds: { high: 80, low: 70, break: 70 },
  reporters: ['html', 'clear-text', 'progress'],
}
