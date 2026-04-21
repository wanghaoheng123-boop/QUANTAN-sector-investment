---
name: QUANTAN Agent Handoff Protocol
description: Deterministic startup/resume workflow so any agent can continue work immediately
type: process
last_updated: 2026-04-21
---

# Agent Startup Order

Any agent entering this repository must read in this order:

1. `AGENTS.md`
2. `memory/MEMORY.md`
3. `memory/project_status.md`
4. `docs/MASTER_PLAN_PHASES_8_16.md` (for Phase 8+ work)

# Resume Rule

If user says "continue" or equivalent:

1. Read `memory/project_status.md`.
2. Identify first pending queue item.
3. Execute code changes and verification for that item.
4. Update `memory/project_status.md` and `AGENTS.md` when milestone moves.
5. Continue to next pending item unless user redirects.

# Memory Rule

- Canonical shared memory is only `memory/`.
- Do not create alternate memory trees for individual agent tooling.

# Cleanup Rule

- Remove duplicate/non-canonical planning or memory files when detected.
- Never delete source code unless it is proven unused and superseded.

