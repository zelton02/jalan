#!/usr/bin/env bash
# Build the Klang Valley walking graph used by ingest/walk.mjs.
#
# One-off, ~4 minutes on 2 cores. Re-run when you want fresher OSM data; the graph is
# served by the `osrm-foot` container on 127.0.0.1:5000 and survives reboots.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p data/osm
PBF=data/osm/malaysia-latest.osm.pbf
if [ ! -f "$PBF" ]; then
  curl -L --fail -o "$PBF" \
    https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
fi

# Klang Valley: Klang -> Sepang, Rawang -> Putrajaya. Walking only matters at the trip ends.
rm -f data/osm/kv.osm.pbf
osmium extract -b 100.85,2.75,102.05,3.65 -o data/osm/kv.osm.pbf "$PBF"

docker run --rm --shm-size=2g -v "$PWD/data/osm:/data" osrm/osrm-backend \
  osrm-extract -p /opt/foot.lua /data/kv.osm.pbf
docker run --rm -v "$PWD/data/osm:/data" osrm/osrm-backend \
  osrm-partition /data/kv.osrm
docker run --rm -v "$PWD/data/osm:/data" osrm/osrm-backend \
  osrm-customize /data/kv.osrm

docker rm -f osrm-foot >/dev/null 2>&1 || true
docker run -d --name osrm-foot --restart unless-stopped \
  -p 127.0.0.1:5000:5000 -v "$PWD/data/osm:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld --max-table-size 200 /data/kv.osrm

echo "osrm-foot up on http://127.0.0.1:5000"
