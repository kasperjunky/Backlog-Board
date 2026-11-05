#!/bin/sh
# Leak scan for this repo: fails if any tracked file (or the commits about to
# be pushed) contains something that looks like a secret, a private backlog
# file, or a personal home path. Run by hand or as the git pre-push hook:
#   sh scripts/leak-scan.sh
#   sh scripts/install-hooks.sh   # once, to run it before every push
set -u

cd "$(git rev-parse --show-toplevel)" || exit 2

# Patterns that should never appear in this repo.
PATTERNS='(sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|password|passwd|token)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9/+_-]{12,}|[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+|/home/[a-z][a-z0-9_-]+/|"(inbox|knownNames)"[[:space:]]*:[[:space:]]*\[[[:space:]]*[{"])'

# Test fixtures use the obviously fake user "test"; allow that one.
ALLOW='[A-Za-z]:[\\/]Users[\\/]test([^A-Za-z0-9._-]|$)|/home/test([^A-Za-z0-9._-]|$)'

# Tracked files plus new, not-ignored ones (so a manual run before committing
# also covers files not added yet).
hits=$(git ls-files -z --cached --others --exclude-standard | xargs -0 grep -nIE "$PATTERNS" -- 2>/dev/null | grep -vE "$ALLOW" | grep -v '^scripts/leak-scan.sh:')

if [ -n "$hits" ]; then
  echo "leak-scan: possible secret or private data — push blocked:" >&2
  echo "$hits" >&2
  echo "If this is a false positive, fix the pattern in scripts/leak-scan.sh." >&2
  exit 1
fi
echo "leak-scan: clean ($(git ls-files --cached --others --exclude-standard | wc -l | tr -d ' ') files)"
