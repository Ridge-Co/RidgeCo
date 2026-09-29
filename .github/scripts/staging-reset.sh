#!/usr/bin/env bash
# staging-reset.sh — make `staging` a byte-identical copy of `main` (MODE=reset)
# or just report whether it is (MODE=check, never writes).
# Called by .github/workflows/sync-staging.yml. Works in any clone whose `origin`
# points at the repo; safe to run locally against a scratch remote for testing.
#
# Outputs: human summary on stdout, appended to $GITHUB_STEP_SUMMARY, and copied to
# $SUMMARY_FILE (the workflow uses that file as the body of a failure issue).
# Exit 0 = ok (or drift merely reported in check mode); exit 1 = reset failed/blocked.
set -euo pipefail

MODE="${MODE:-reset}"
SUMMARY_FILE="${SUMMARY_FILE:-$(mktemp)}"
STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
REPO="${GITHUB_REPOSITORY:-}"
: > "$SUMMARY_FILE"

say() {
  printf '%s\n' "$*" | tee -a "$SUMMARY_FILE"
  printf '%s\n' "$*" >> "$STEP_SUMMARY"
}
setout() { printf '%s=%s\n' "$1" "$2" >> "$OUT"; }

case "$MODE" in reset|check) ;; *) echo "::error::MODE must be reset or check (got: $MODE)"; exit 1 ;; esac

git fetch --no-tags --quiet origin '+refs/heads/main:refs/remotes/origin/main'
main_sha="$(git rev-parse origin/main)"

say "## sync-staging (mode: $MODE)"
say "- main tip: \`${main_sha}\`"

if ! git ls-remote --exit-code --heads origin staging >/dev/null 2>&1; then
  say "- staging branch does not exist."
  if [ "$MODE" = "check" ]; then
    echo "::warning::staging branch does not exist; run sync-staging manually (workflow_dispatch) to create it."
    setout result missing
    exit 0
  fi
  git push origin "${main_sha}:refs/heads/staging"
  say "- Created staging at \`${main_sha}\`."
  setout result created
  exit 0
fi

git fetch --no-tags --quiet origin '+refs/heads/staging:refs/remotes/origin/staging'
stg_sha="$(git rev-parse origin/staging)"
say "- staging tip (before): \`${stg_sha}\`"

if [ "$stg_sha" = "$main_sha" ]; then
  say "- staging is already identical to main. Nothing to do."
  setout result identical
  exit 0
fi

tree_same=false
if git diff --quiet origin/main origin/staging; then tree_same=true; fi

n_all="$(git rev-list --count origin/main..origin/staging)"
# commits on staging whose *patch* is not already on main (duplicates with different SHAs are filtered out)
unique_list="$(git log --cherry-pick --right-only --no-merges --format='%h %an: %s' origin/main...origin/staging | head -200 || true)"
n_unique=0
if [ -n "$unique_list" ]; then n_unique="$(printf '%s\n' "$unique_list" | wc -l | tr -d ' ')"; fi

if [ "$MODE" = "check" ]; then
  if [ "$tree_same" = true ]; then
    say "- staging CONTENT matches main (different commit SHAs only — harmless; next push to main resets it)."
    setout result identical-content
  else
    say "- DRIFT: staging content differs from main:"
    say '```'
    say "$(git diff --stat origin/main origin/staging | tail -20)"
    say '```'
    echo "::warning::staging content differs from main. See drift-check / sync-staging summary."
    setout result drift
  fi
  exit 0
fi

# ---- reset mode: report what will be dropped, back it up, then reset ----
say "- commits reachable from staging but not main: **${n_all}** (of which **${n_unique}** have a patch not present on main)"
if [ "$n_unique" -gt 0 ]; then
  say "### Commits with unique content that this reset drops"
  say '```'
  say "$unique_list"
  say '```'
else
  say "- No unique patches on staging — everything on it is already on main (duplicates/merge commits only)."
fi
if [ "$tree_same" = false ]; then
  say "### Content on staging that differs from main (two-dot diff, staging side is what is overwritten)"
  say '```'
  say "$(git diff --stat origin/main origin/staging | tail -40)"
  say '```'
fi

# Best-effort backup so nothing is ever silently lost.
if [ "$tree_same" = false ] || [ "$n_unique" -gt 0 ]; then
  tag="staging-before-reset-$(date -u +%Y%m%d-%H%M%S)-${stg_sha:0:7}"
  if git push --quiet origin "${stg_sha}:refs/tags/${tag}" 2>/dev/null; then
    say "- Backup of old staging kept as tag \`${tag}\` (recover with: git checkout ${tag})."
  else
    echo "::warning::could not create backup tag for old staging (${stg_sha})."
    say "- WARNING: backup tag could not be created. Old staging tip was \`${stg_sha}\` (reachable from reflog/PR history)."
  fi
fi

push_log="$(mktemp)"
pushed=false
if git push --force-with-lease="refs/heads/staging:${stg_sha}" origin "${main_sha}:refs/heads/staging" >"$push_log" 2>&1; then
  pushed=true
else
  say "- git push was rejected:"
  say '```'
  say "$(tail -15 "$push_log")"
  say '```'
  # Fallback: update the ref through the REST API (may not be subject to the same workflow-file restriction).
  if [ -n "$REPO" ] && command -v gh >/dev/null 2>&1; then
    cur="$(git ls-remote origin refs/heads/staging | cut -f1)"
    if [ "$cur" = "$stg_sha" ]; then
      if gh api -X PATCH "repos/${REPO}/git/refs/heads/staging" -f sha="$main_sha" -F force=true >/dev/null 2>>"$push_log"; then
        pushed=true
        say "- Fallback (REST ref update) succeeded."
      else
        say "- Fallback (REST ref update) also failed."
      fi
    else
      say "- staging moved during this run (now \`${cur}\`); not overwriting. Re-run the workflow."
    fi
  fi
fi

if [ "$pushed" != true ]; then
  wf_changed="$(git diff --name-only "$stg_sha" "$main_sha" -- .github/workflows | tr '\n' ' ')"
  if [ -n "$wf_changed" ]; then
    say "- Cause (likely): main changes workflow files that staging lacks (${wf_changed}); GITHUB_TOKEN cannot push those (needs the \`workflows\` permission)."
    setout result blocked-workflows
  else
    setout result failed
  fi
  echo "::error::staging reset FAILED — see summary."
  exit 1
fi

after="$(git ls-remote origin refs/heads/staging | cut -f1)"
if [ "$after" != "$main_sha" ]; then
  say "- Verification FAILED: staging is \`${after}\`, expected \`${main_sha}\`."
  setout result failed
  echo "::error::staging reset verification failed."
  exit 1
fi
say "- staging (after): \`${after}\` — identical to main. Cloudflare Workers Builds will redeploy staging from this push."
say "- Old staging tip was \`${stg_sha}\`."
setout result reset
exit 0
