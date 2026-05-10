# Universal AI Rules
#
# Purpose: Natural-language rules that EVERY AI must follow when working on this project.
# Format: key: value pairs and plain sentences. Readable by any AI model.
#
# To add a rule: append a new line with a `rule_id` and description.
# To modify: edit the existing line. Rules use semantic versioning on changes.
#
# ─────────────────────────────────────────────────────────────

## Code Quality
coding_style: consistent_with_project_defaults
tests_required: true for all new features and bug fixes
type_safety: TypeScript strict mode — no `as any` without explicit justification
no_dead_code: remove unused imports, variables, and functions before committing
minimal_comments: only document WHY, not WHAT — well-named identifiers are self-documenting

## Security
no_secrets_in_code: use environment variables, never hardcode API keys or tokens
input_validation: validate all user input at system boundaries (API routes, form fields)
rate_limiting: apply to all expensive endpoints — see lib/api/rateLimit.ts
auth_checks: protect trading-agents and backtest POST endpoints

## Testing & Verification
benchmark_guard: run `npm run benchmark` after touching signal/backtest code — must stay >= 55%
typecheck_before_commit: `npm run typecheck` must pass with zero errors
test_suite: `npm run test` — 279 tests must pass (21 files)
verify_data: `npm run verify:data` for financial calculation correctness

## Architecture
no_speculative_abstractions: only build what current requirements need
reuse_existing: search for existing functions/utilities before creating new ones
trust_framework: don't add error handling for impossible states — TypeScript + framework guarantees
yahoo_finance_only_core: paid data APIs go in lib/data/providers/ with graceful fallback

## AI Interaction
read_memory_first: always read .ai/memory/decisions.md, context.md, and todo.md at session start
log_decisions: append to decisions.md when making architectural or tradeoff choices
update_todo: mark completed tasks, add new ones
no_confirmations_for_edits: use permission-mode auto, don't ask before writing files
thinking_budget: use maximum available tokens for reasoning on non-trivial decisions
