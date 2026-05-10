#!/bin/bash
# remember.sh — Append a timestamped decision to .ai/memory/decisions.md
# Usage: ./remember.sh "Decision description and rationale"
# Works on any Unix-like system with zero dependencies.

if [ $# -eq 0 ]; then
  echo "Usage: ./remember.sh \"Decision description and rationale\""
  exit 1
fi

echo "## $(date '+%Y-%m-%d %H:%M') — $*" >> .ai/memory/decisions.md
echo "Decision recorded: $*"
