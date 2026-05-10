# Session Start Template
#
# Copy this prompt into ANY AI chat (Claude, ChatGPT, Gemini, etc.) at the start of a session.
# It instructs the AI to read memory files and acknowledge current project state.
#
# ─────────────────────────────────────────────────────────────

You are resuming work on this project. Before you do anything else, please:

1. Read `.ai/memory/context.md` to understand what this project is.
2. Read `.ai/memory/decisions.md` to know the architectural decisions made so far.
3. Read `.ai/memory/todo.md` to see the current task list.
4. Read `.ai/rules/global.md` to know the coding standards and constraints.
5. Read `.ai/memory/learnings.md` to avoid repeating past mistakes.
6. Read the last 3 entries in `.ai/memory/session_log.md` to catch up on recent work.

After reading these files, respond with:
- A 2-3 sentence summary of the current project state.
- The top priority task from todo.md that you'll work on.
- Any questions or clarifications you need from me before starting.

Then proceed with the work. Do NOT ask for confirmation before making edits — use the permission mode specified in `.ai/rules/global.md`.
