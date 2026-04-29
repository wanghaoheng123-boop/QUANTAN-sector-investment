# AI Memory & Workflow Guide

This document explains the Universal AI Memory system used by this project. It is designed for **both humans and AIs** to read — it explains how to work with the memory files, how to migrate existing projects, and how to use the system with any AI model.

## Quick Start for Humans

1. **At the start of each AI session:** Copy the content of `.ai/templates/session_start.md` into your AI chat. This tells the AI to read all memory files and catch up on context.

2. **At the end of each AI session:** Copy `.ai/templates/session_end.md` into your AI chat. This makes the AI record decisions, update tasks, and log the session.

3. **To record a decision yourself:** Run `./.ai/scripts/remember.sh "Your decision text"` from the terminal.

That's it. The memory system works with **any AI** — Claude, ChatGPT, Gemini, local LLMs — no special tools required.

## File Structure

```
.ai/
  memory/
    context.md        — Project identity, goals, architecture (read at every session start)
    decisions.md      — Append-only log of architectural/technical decisions
    todo.md           — Current task list with checkboxes (mark [x] when done)
    learnings.md      — Gotchas, pitfalls, useful references (avoid repeating mistakes)
    session_log.md    — Chronological record of every AI session (read last 3 to catch up)
  templates/
    session_start.md  — Prompt to paste at session start (instructs AI to read memory)
    session_end.md    — Prompt to paste at session end (instructs AI to record decisions)
  rules/
    global.md         — Coding standards, constraints, testing requirements for all AIs
  scripts/
    remember.sh       — Bash utility to manually append a decision with timestamp
```

## How AIs Interact with Memory

### At Session Start
1. Read `.ai/memory/context.md` — understand the project
2. Read `.ai/rules/global.md` — know the constraints
3. Read `.ai/memory/todo.md` — know what to work on
4. Read `.ai/memory/decisions.md` — understand past choices
5. Read `.ai/memory/learnings.md` — avoid past mistakes
6. Read last 3 entries in `.ai/memory/session_log.md` — catch up on recent work

### During Session
- Check `todo.md` before starting new work
- If a decision is made that affects architecture or has tradeoffs, append to `decisions.md`
- If a gotcha or useful pattern is found, append to `learnings.md`

### At Session End
1. Append all architectural decisions to `decisions.md` with date, context, rationale
2. Update `todo.md`: mark completed, add new tasks
3. Append a session summary to `session_log.md` with date, model, summary, files changed

## Migrating an Existing Project

To add this memory system to an existing project:

```bash
# 1. Create the directories
mkdir -p .ai/memory .ai/templates .ai/rules .ai/scripts

# 2. Copy the template files from this project or the reference implementation
# 3. Fill in .ai/memory/context.md with your project's description
# 4. Fill in .ai/memory/todo.md with your current tasks
# 5. Customize .ai/rules/global.md for your project's standards
# 6. Run ./ai/scripts/remember.sh "Initialized AI memory system"
```

## Using with Different AI Models

| AI Model | How to Use |
|----------|------------|
| **Claude Code** | Memory is auto-read. Use `start-universal.sh` for optimal settings. |
| **Claude.ai** | Paste `session_start.md` at chat start. Paste `session_end.md` when done. |
| **ChatGPT** | Same as Claude.ai. Use web interface — memory files are just Markdown. |
| **Gemini** | Same approach. Upload memory files as context if the UI supports it. |
| **Local LLMs** | Include memory files in system prompt or conversation context. |

## No Dependencies Required

The core memory system uses **only plain Markdown files**. No databases, no APIs, no tools. Any AI can read and write to these files. The optional tooling (Phase 2) adds convenience features:

- **cavemem**: Auto-captures decisions to SQLite with embeddings for search
- **OpenViking**: Semantic memory with vector search

These are optional — the plaintext memory works standalone.

## Project-Specific Notes (QUANTAN)

- **Tests:** `npm run test` (279 tests, 21 files)
- **TypeScript:** `npm run typecheck` (strict mode, zero errors required)
- **Benchmark:** `npm run benchmark` (56.35% baseline, must stay >= 55%)
- **Deploy:** Push to main → Vercel auto-deploys to https://quantan.vercel.app
- **Data:** Yahoo Finance primary, paid providers as graceful fallback
