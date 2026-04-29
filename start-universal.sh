#!/bin/bash
# start-universal.sh — Launch Claude Code with the Universal AI Memory Package
# Sets environment variables for DeepSeek V4 Pro with max thinking budget.
#
# Usage: ./start-universal.sh
#
# Prerequisites:
#   1. Replace ANTHROPIC_AUTH_TOKEN with your actual DeepSeek API key
#   2. Install Claude Code CLI: npm install -g @anthropic-ai/claude-code

export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
export ANTHROPIC_AUTH_TOKEN="sk-3f7667ea23e84e38b2c3fc65222293ee"
export ANTHROPIC_MODEL="deepseek-v4-pro"
export ANTHROPIC_THINKING_TYPE="enabled"
export ANTHROPIC_THINKING_BUDGET_TOKENS="128000"
export CLAUDE_CODE_EFFORT_LEVEL="max"

# Launch Claude Code in the current project with auto permission mode
claude --permission-mode auto --project .
