#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

BRANCH="${DEPLOY_BRANCH:-main}"

echo "==> Fetch latest code from origin/${BRANCH}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

echo "==> Rebuild and restart BE + FE"
docker compose -f docker-compose.vps.yml up -d --build be fe

echo "==> Current service status"
docker compose -f docker-compose.vps.yml ps
