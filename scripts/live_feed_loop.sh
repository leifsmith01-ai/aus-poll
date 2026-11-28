#!/usr/bin/env bash
# Election-night proxy loop, run by .github/workflows/live-feed.yml.
#
# Each pass fetches results, writes publish/live/vec-latest.json and force-pushes
# it as the single-commit `live-feed` branch (served by raw.githubusercontent.com).
#
# Environment:
#   MODE           website | rehearsal-2022 | rehearsal-feed | feed-url
#   RESULTS_URL    VEC results index (website mode)
#   FEED_URL       data-feed ZIP/XML (feed-url mode)
#   INTERVAL       seconds between passes (min 60)
#   DURATION_MIN   minutes to keep polling; 0 = a single pass
#   TOKEN, GITHUB_REPOSITORY   for the push (not needed with DRY_RUN=1)
#   DRY_RUN=1      do everything except pushing (local testing)
set -u

MODE=${MODE:-website}
RESULTS_URL=${RESULTS_URL:-https://www.vec.vic.gov.au/results/2026-results/district-election-page}
INTERVAL=${INTERVAL:-300}
DURATION_MIN=${DURATION_MIN:-0}
DRY_RUN=${DRY_RUN:-0}
[ "$INTERVAL" -lt 60 ] && INTERVAL=60

out=publish/live/vec-latest.json
mkdir -p work publish/live

# The live-feed branch holds only the results file, but the Vercel project is
# connected to this repo and would try (and fail) to build every snapshot,
# emailing a failure each time. Vercel reads `git.deploymentEnabled` from the
# commit being built, and the project's Root Directory is `webapp`, so each
# snapshot carries a vercel.json in both places switching deployments off.
write_vercel_optout() {
  mkdir -p publish/webapp
  for f in publish/vercel.json publish/webapp/vercel.json; do
    printf '{\n  "git": { "deploymentEnabled": false }\n}\n' > "$f"
  done
}

publish() {
  write_vercel_optout
  if [ "$DRY_RUN" = 1 ]; then echo "(dry run) would publish $1"; return 0; fi
  # `set -e` inside the subshell so a failed push is not reported as published.
  (
    set -e
    cd publish
    rm -rf .git
    git init -q -b live-feed
    git -c user.name="github-actions[bot]" \
        -c user.email="github-actions[bot]@users.noreply.github.com" add -A
    git -c user.name="github-actions[bot]" \
        -c user.email="github-actions[bot]@users.noreply.github.com" \
        commit -qm "live snapshot $(date -u +%FT%TZ)"
    git push -qf "https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git" live-feed
  ) && echo "$(date -u +%T) published $1" \
    || echo "::warning::push of $1 failed — retrying on the next pass"
}

# Real-results modes start from what the branch already holds, so a fresh runner
# (the next scheduled run, or a re-dispatch) carries the night forward instead of
# blanking it. Rehearsal/test snapshots are never carried into a real run; if
# there is nothing real yet, publish a "waiting" marker so the page says counting
# has not started rather than showing an old rehearsal.
if [ "$MODE" = website ] || [ "$MODE" = feed-url ]; then
  rm -f work/last-good.json
  if [ "$DRY_RUN" != 1 ] && git fetch -q --depth 1 origin live-feed 2>/dev/null \
      && git show FETCH_HEAD:live/vec-latest.json > work/branch.json 2>/dev/null; then
    if python3 - work/branch.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
real = not d.get("waiting") and not d.get("meta", {}).get("test") and d.get("seats")
sys.exit(0 if real else 1)
PY
    then
      cp work/branch.json work/last-good.json
      cp work/branch.json "$out"
      echo "carrying forward the snapshot already on live-feed"
    fi
  fi
  if [ ! -f work/last-good.json ]; then
    python3 - "$out" <<'PY'
import json, sys
from datetime import datetime, timezone
json.dump({"contractVersion": 1, "waiting": True,
           "meta": {"jurisdiction": "vic", "electionId": "vic_2026",
                    "asAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "attribution": "© Victorian Electoral Commission, CC BY 4.0"},
           "seats": []}, open(sys.argv[1], "w"))
PY
    publish "waiting marker"
  fi
fi

# Rehearsal-2022 steps through the night at these fractions, then holds.
reveal=(0.05 0.1 0.2 0.3 0.45 0.6 0.75 0.9 1.0)
deadline=$(( $(date +%s) + DURATION_MIN * 60 ))
step=0
failures=0
while :; do
  case "$MODE" in
    website)
      cmd=(python3 scripts/fetch_live_vec_web.py --index "$RESULTS_URL"
           --cache work/urls.json --previous work/last-good.json --out "$out") ;;
    rehearsal-2022)
      if [ ! -f work/html22/urls.json ]; then
        python3 scripts/fetch_live_vec_web.py \
          --index https://www.vec.vic.gov.au/results/state-election-results/2022-state-election-results \
          --save-html work/html22 --rehearsal --out /dev/null || true
      fi
      i=$(( step < ${#reveal[@]} ? step : ${#reveal[@]} - 1 ))
      cmd=(python3 scripts/fetch_live_vec_web.py --from-html work/html22 --rehearsal
           --reveal "${reveal[$i]}" --out "$out") ;;
    rehearsal-feed)
      cmd=(python3 scripts/fetch_live_vec.py --replay "$step"
           --replay-dir tests/fixtures/vec_sample --allow-partial --out "$out") ;;
    feed-url)
      cmd=(python3 scripts/fetch_live_vec.py --url "${FEED_URL:-}" --out "$out") ;;
    *) echo "::error::unknown mode $MODE"; exit 1 ;;
  esac

  if "${cmd[@]}"; then
    failures=0
    cp "$out" work/last-good.json
    publish "step $step"
  else
    # Keep the previous good snapshot on the branch (e.g. before the VEC posts the
    # results index at 6pm, or a page failed validation).
    failures=$((failures + 1))
    cp work/last-good.json "$out" 2>/dev/null || true
    echo "::warning::fetch/normalize failed (streak $failures) — keeping last good snapshot"
  fi

  step=$((step + 1))
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep "$INTERVAL"
  [ "$(date +%s)" -ge "$deadline" ] && break
done
echo "finished after $step pass(es)"
