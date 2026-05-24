/**
 * Vitest setup — register @testing-library/jest-dom matchers globally so
 * component tests can use `toBeInTheDocument`, `toHaveAttribute`,
 * `toHaveTextContent`, etc.
 *
 * Phase 16 (2026-05-24) — Q-027 component-test infrastructure.
 */
import '@testing-library/jest-dom/vitest'
