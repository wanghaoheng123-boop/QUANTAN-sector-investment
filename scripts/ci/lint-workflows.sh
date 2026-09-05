#!/usr/bin/env bash
#
# Validate GitHub Actions workflows with actionlint — the real schema-aware
# linter for this domain.
#
# WHY THIS EXISTS. Across Q-107 this project shipped FOUR broken workflow states
# in a row, and every local check said green:
#
#   1. a nested `${{ ${{ … }} }}` expression          -> whole file rejected
#   2. a workflow-level permissions ceiling breach    -> whole file rejected
#   3. a caller->callee permissions grant breach      -> whole file rejected
#   4. a DUPLICATED `env:` key in one step            -> whole file rejected
#
# The validation in use was `yaml.safe_load()` plus regexes over the file text.
# That is a PROXY for the consumer, and its leniency differs: PyYAML accepts a
# duplicate mapping key (last one wins) while GitHub Actions rejects the file
# outright. A checker more permissive than the thing it stands in for produces
# false negatives by construction, which is how #4 reached a pull request.
#
# Measured, not assumed: actionlint pinpoints #1 at `refresh-data.yml:178:19`
# and #4 at `:85:9`. It does NOT catch #2 or #3 — it does not model permission
# ceilings — so `__tests__/architecture/scheduled-alerts.test.ts` still carries
# those, and that division of labour is deliberate rather than redundant.
#
# The binary is fetched on demand and PINNED, because an unpinned linter is a
# build that changes under you.
set -euo pipefail

ACTIONLINT_VERSION="1.7.12"
BIN_DIR="${ACTIONLINT_BIN_DIR:-${TMPDIR:-/tmp}/actionlint-${ACTIONLINT_VERSION}}"
BIN="${BIN_DIR}/actionlint"

if [ ! -x "$BIN" ]; then
  echo "actionlint ${ACTIONLINT_VERSION} not present — fetching…"
  mkdir -p "$BIN_DIR"
  ( cd "$BIN_DIR" \
    && curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash -o dl.bash \
    && bash dl.bash "${ACTIONLINT_VERSION}" >/dev/null )
fi

# FAIL LOUDLY IF THE TOOL IS MISSING. A linter that silently no-ops when it
# cannot install is worse than no linter: it reports success for work it never
# looked at, which is the exact failure mode this script was written to end.
if [ ! -x "$BIN" ]; then
  echo "FAIL: actionlint could not be installed at ${BIN}. Refusing to report success for workflows nobody checked." >&2
  exit 1
fi

# Enumerate explicitly. A bare `*.yaml` glob that matches nothing is passed
# through literally by the shell, and actionlint then fails on a file that does
# not exist — a linter erroring for the wrong reason is indistinguishable from a
# real finding, and would train the next reader to ignore it.
FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(find .github/workflows -maxdepth 1 \( -name '*.yml' -o -name '*.yaml' \) | sort)

if [ ${#FILES[@]} -eq 0 ]; then
  echo "FAIL: no workflow files found under .github/workflows — refusing to report success for an empty set." >&2
  exit 1
fi

# MAKE LOCAL WEAKNESS LOUD. actionlint runs shellcheck over every `run:` block —
# but ONLY when shellcheck is on PATH. GitHub's runners have it; a developer
# machine often does not. That asymmetry means a locally-green run can be red in
# CI for a finding you were never shown, which is how this very script passed
# locally and failed on its first CI run. Silence about a weaker check is the
# same false-negative shape the script exists to remove, so say it out loud.
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "WARNING: shellcheck is not installed, so actionlint will SKIP linting of \`run:\` blocks."
  echo "         CI has it, so this local run is WEAKER than CI. Install it (brew install shellcheck)"
  echo "         if you want the same answer here that CI will give you."
fi

echo "Linting ${#FILES[@]} workflow file(s) with actionlint $("$BIN" --version | head -1)"
"$BIN" -color "${FILES[@]}" || {
  code=$?
  echo "" >&2
  echo "actionlint found problems. A workflow that does not compile is ABSENT from the check set, not red in it —" >&2
  echo "GitHub reports it as a run named after the file path with zero jobs, which no check-run query will show you." >&2
  exit $code
}
echo "actionlint: clean"
