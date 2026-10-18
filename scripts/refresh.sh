#!/bin/sh
# Nightly GTFS refresh. Cron runs with a minimal PATH, hence the explicit node lookup.
set -eu
cd /root/projects/jalan
NODE="$(command -v node || true)"
[ -n "$NODE" ] || NODE=/root/.hermes/tools/node-26.7.0-linux-x64/bin/node
echo "[$(date -Iseconds)] refresh start" >> data/ingest.log
if "$NODE" --no-warnings ingest/ingest.mjs --force >> data/ingest.log 2>&1; then
  echo "[$(date -Iseconds)] refresh ok" >> data/ingest.log
else
  echo "[$(date -Iseconds)] refresh FAILED" >> data/ingest.log
  exit 1
fi
