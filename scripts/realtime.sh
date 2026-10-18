#!/bin/sh
set -eu
cd /root/projects/jalan
NODE="$(command -v node || true)"
[ -n "$NODE" ] || NODE=/root/.hermes/tools/node-26.7.0-linux-x64/bin/node
exec "$NODE" --no-warnings ingest/realtime.mjs
