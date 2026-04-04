#!/usr/bin/env sh
set -eu

docker compose -f docker-compose.vps.yml up -d --build
docker compose -f docker-compose.vps.yml ps
