#!/usr/bin/env bash
# guard-check.sh — branch-policy checks for a pull request.
# Env: BASE_REF, HEAD_REF, PR_BODY. Run from a clone whose HEAD is the PR head commit
# and which has origin/main fetched with enough history (fetch-depth: 0).
# Exit 1 if any rule is violated.
set -euo pipefail

BASE_REF="${BASE_REF:?BASE_REF required}"
HEAD_REF="${HEAD_REF:?HEAD_REF required}"
PR_BODY="${PR_BODY:-}"
BEHIND_LIMIT="${BEHIND_LIMIT:-20}"
BAD_MSG_RE='\bTEMP\b|Nudge staging|stg-sync|Resync'

fail=0
err() { echo "::error::$*"; fail=1; }

STAGING_MSG='PRs must target main. To verify on staging, add `staging-test-only: true` to the PR body (this PR must never be the way a change reaches main; open a separate PR to main from the same branch).'

# Rule: nothing may ever originate from staging or main.
case "$HEAD_REF" in
  staging|main) err "Head branch '${HEAD_REF}' is not allowed as a PR source. ${STAGING_MSG}" ;;
esac

# Rule: PRs into staging are test-only.
if [ "$BASE_REF" = "staging" ]; then
  case "$HEAD_REF" in
    feat/*|fix/*|hotfix/*) ;;
    *) err "Head branch '${HEAD_REF}' may not target staging (allowed: feat/*, fix/*, hotfix/*). ${STAGING_MSG}" ;;
  esac
  if ! printf '%s\n' "$PR_BODY" | tr -d '\r' | grep -Eiq '^[[:space:]]*staging-test-only:[[:space:]]*true[[:space:]]*$'; then
    err "PR into staging is missing the line 'staging-test-only: true' in its body. ${STAGING_MSG}"
  fi
fi

# Rules for PRs into main.
if [ "$BASE_REF" = "main" ]; then
  git rev-parse --verify --quiet origin/main >/dev/null || { err "origin/main not fetched"; exit 1; }
  bad="$(git log --format='%h %s' origin/main..HEAD | grep -Ei "$BAD_MSG_RE" || true)"
  if [ -n "$bad" ]; then
    err "PR into main contains temp/sync commits that must not reach main (matched /${BAD_MSG_RE}/i). Cut a fresh branch off main and re-apply only the real change. Offending commits:"
    printf '%s\n' "$bad"
  fi
  behind="$(git rev-list --count HEAD..origin/main)"
  if [ "$behind" -gt "$BEHIND_LIMIT" ]; then
    echo "::warning::This branch is ${behind} commits behind main (limit ${BEHIND_LIMIT}). Consider cutting a fresh branch off the current main tip and re-applying the change."
  fi
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "Branch policy checks passed (base=${BASE_REF}, head=${HEAD_REF})."
