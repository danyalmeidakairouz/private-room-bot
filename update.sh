#!/usr/bin/env bash
#
# update.sh — pull the latest code, rebuild, and restart the bot service.
# Run this on the host where the bot lives (e.g. the Google Cloud VM):
#
#   ./update.sh
#
# It updates whatever branch is currently checked out. After a major change
# you may still need to re-invite the bot (new permissions) and/or re-run
# /setup in Discord — see README.md / deploy/DEPLOY-GCP.md.

set -euo pipefail

SERVICE="private-room-bot"

# Always operate from the directory this script lives in (the repo root),
# so it works no matter where you call it from.
cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Repo:    $(pwd)"
echo "==> Branch:  ${branch}"

echo "==> Fetching and fast-forwarding…"
git fetch origin
if ! git pull --ff-only; then
  echo "!! git pull --ff-only failed (local changes or diverged history)." >&2
  echo "   Resolve manually, e.g.: git stash && git pull --ff-only && git stash pop" >&2
  exit 1
fi

echo "==> Installing dependencies…"
npm install

echo "==> Building…"
npm run build

echo "==> Restarting service '${SERVICE}'…"
if systemctl list-unit-files | grep -q "^${SERVICE}.service"; then
  sudo systemctl restart "${SERVICE}"
  echo "==> Status:"
  systemctl --no-pager --lines=0 status "${SERVICE}" || true
  echo
  echo "Done. Live logs:  journalctl -u ${SERVICE} -f"
else
  echo "!! systemd service '${SERVICE}' not found — start the bot however you run it." >&2
  echo "   (Manual run:  npm start )" >&2
fi
