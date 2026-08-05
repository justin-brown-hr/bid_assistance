#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> git pull"
git pull

echo "==> npm install"
npm install

echo "==> npm run build (required — dist/ is not in git)"
npm run build

echo "==> pm2 restart"
pm2 restart freelancer-helper --update-env

echo "==> done — verify Analytics link in HTML:"
curl -sS "http://127.0.0.1:${DASHBOARD_PORT:-3030}/" | grep -o 'headerAnalyticsLink' || {
  echo "WARNING: Analytics nav still missing — build may have failed"
  exit 1
}
