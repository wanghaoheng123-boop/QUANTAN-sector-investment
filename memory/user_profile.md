---
name: User Profile — QUANTAN Platform Builder
description: User background, goals, investment philosophy, and technical preferences for building QUANTAN
type: user
---

# User Profile

## Role & Goals
Building QUANTAN — an institutional-grade quantitative investment and trading intelligence platform. The goal is software that replicates the analytical capability of Warren Buffet's research team, Druckenmiller's macro framework, and Renaissance Technologies' systematic approach. The user understands how Wall Street institutional desks operate and wants the software to model those same patterns.

## Investment Philosophy (Encoded in Requirements)

- Understands "the game" — how institutional investors accumulate positions, deceive retail, manipulate gamma pinning, and use options market structure to control price ranges
- Interested in WHERE smart money goes BEFORE price moves (13F, dark pool, options whale activity)
- Cares about business cycle awareness — not just momentum but macro regime context
- Options strategy focus: income strategies (sell put / sell call) using Put wall, Call wall, Max Pain, Gamma exposure
- Time horizons: multiple (near-term options income + long-term intrinsic value investing)

## Technical Preferences

- Existing stack: Next.js 14 + TypeScript + Tailwind + Yahoo Finance (free) + SQLite
- Prefers OPUS AI as the "brain" for decision-making and orchestration
- Wants Sonnet and Haiku for execution/processing (cost efficiency)
- Self-optimizing systems (feedback loops, continuous improvement)
- Institutional quality means: 30-year backtests, multi-cycle validation, mathematical rigor

## Success Definition

The system should be able to:
1. Tell the current business cycle phase (6–12 months before NBER confirmation)
2. Show probability-weighted fair value range from 6+ valuation models
3. Recommend exact sell-put/sell-call strikes with probability of profit
4. Detect when institutional smart money is accumulating before price moves
5. Generate Buffet-style research reports: moat score, margin of safety, investment verdict
6. Self-improve nightly via OPUS — finding and fixing the weakest signal
