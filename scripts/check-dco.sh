#!/usr/bin/env bash
# DCO check: every commit in BASE..HEAD must have a Signed-off-by trailer matching its author.
# Usage: scripts/check-dco.sh <base-sha> <head-sha>
set -euo pipefail
base="$1"; head="$2"
fail=0
for sha in $(git rev-list --no-merges "$base..$head"); do
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  if ! git log -1 --format='%(trailers:key=Signed-off-by,valueonly)' "$sha" | grep -qxF "$author"; then
    echo "::error::commit $sha ($(git log -1 --format=%s "$sha")) lacks 'Signed-off-by: $author'"
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "Fix with: git rebase --signoff $base && git push --force-with-lease  (see CONTRIBUTING.md, https://developercertificate.org/)"
  exit 1
fi
echo "DCO check passed"
