// Q-093 — the lint CLAUDE.md's definition of done has always named and nothing
// ran. Next.js's own recommended sets (core-web-vitals + typescript), so the
// rules are the framework's, not invented here.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'coverage/**', 'reports/**', '.stryker-tmp/**',
      '.claude/**', '.agents/**', '.codex/**', 'public/**', 'scripts/backtestData/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Next.js loads next.config.js as CommonJS, and lib/pwa/precache.js is
    // shared with it, so require() is the only option in those two files.
    files: ['next.config.js', 'lib/pwa/precache.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // A leading underscore marks a binding as deliberately unused (a positional
    // parameter, or a rest-sibling used to omit a key).
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
]

export default config
