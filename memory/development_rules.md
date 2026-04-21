---
name: QUANTAN Development Rules
description: Shared coding and execution rules for all AI agents and humans
type: feedback
last_updated: 2026-04-21
---

# Development Rules

## Build discipline

- No speculative abstractions.
- Validate boundaries only (inputs/APIs), avoid impossible-state boilerplate.
- Preserve benchmark floor after strategy/backtest/quant changes.
- Keep TypeScript strict and clean.

## Data/provider policy

- Free-tier-first architecture in core runtime.
- Optional paid providers must degrade gracefully to free defaults.

## Execution quality

- Every substantial feature must include verification commands.
- Prefer small, composable modules with explicit names.
- Preserve reproducibility and auditability of quantitative outputs.

## Communication + continuity

- Keep status current in `memory/project_status.md` and `AGENTS.md`.
- Use `memory/agent_handoff_protocol.md` for startup and resume.
- "Continue" means resume from pending queue without re-planning.

