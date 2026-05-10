# Session End Template
#
# Copy this prompt into ANY AI chat at the end of a session.
# It instructs the AI to record decisions, update tasks, and log the session.
#
# ─────────────────────────────────────────────────────────────

This session is ending. Please complete the following housekeeping:

1. **Log decisions:** Add a dated entry to `.ai/memory/decisions.md` for every architectural or tradeoff decision you made this session. Include:
   - The decision itself
   - Context (why it was needed)
   - Rationale (why this choice)
   - Consequences (what it means going forward)

2. **Update tasks:** Edit `.ai/memory/todo.md`:
   - Mark completed tasks as `- [x]`
   - Add any new tasks discovered during this session as `- [ ]`
   - Move completed tasks to the "Completed" section

3. **Update learnings:** If you discovered any gotchas, useful references, or non-obvious patterns, append them to `.ai/memory/learnings.md`.

4. **Log the session:** Append a new entry to `.ai/memory/session_log.md` with:
   - Date and time
   - AI model used
   - 1-2 sentence summary of what was accomplished
   - Key decisions made
   - Files changed (count and key paths)

5. **Final summary:** Tell me (the user):
   - What was accomplished this session
   - What the next priority task is
   - Any blockers or questions requiring my input
