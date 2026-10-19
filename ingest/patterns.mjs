// Collapse 19k trips into the ~650 distinct stop sequences they actually run.
//
// A pattern is one ordered stop list served by one route+direction. Every trip
// that follows it is just a departure time. The router then asks "when does this
// line's next vehicle pass my best reached stop" instead of "what departs from
// this stop", which is the difference between 641 in-memory scans and 1,500 SQL
// queries per round.
//
// Runs inside ingest.mjs before the atomic rename, so the live DB always carries
// the tables. Also usable on its own: `node ingest/patterns.mjs`.
import { DatabaseSync } from "node:sqlite";
import { sec } from "./lib.mjs";

const SCHEMA = `
  DROP TABLE IF EXISTS pattern_trips;
  DROP TABLE IF EXISTS patterns;
  CREATE TABLE patterns (
    pattern_id INTEGER PRIMARY KEY,
    feed TEXT NOT NULL,
    route_id TEXT NOT NULL,
    direction_id TEXT,
    headsign TEXT,
    stops TEXT NOT NULL,        -- JSON array of stop_id, in travel order
    offsets TEXT NOT NULL       -- JSON array of [arrival, departure] seconds from the first departure
  );
  CREATE TABLE pattern_trips (
    pattern_id INTEGER NOT NULL,
    feed TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    first_dep INTEGER NOT NULL,
    PRIMARY KEY (pattern_id, trip_id)
  );
  CREATE INDEX idx_pattern_trips_dep ON pattern_trips (pattern_id, first_dep);
`;

export function buildPatterns(db, { log = () => {} } = {}) {
  const started = Date.now();
  db.exec(SCHEMA);

  const trips = new Map();
  for (const r of db.prepare(
    "SELECT feed, trip_id, route_id, direction_id, service_id, headsign FROM trips"
  ).iterate()) {
    trips.set(`${r.feed}|${r.trip_id}`, r);
  }

  const groups = new Map();
  let feed = null, trip = null, rows = [];

  const flush = () => {
    if (!trip || rows.length < 2) return;
    const meta = trips.get(`${feed}|${trip}`);
    if (!meta) return;
    const first = sec(rows[0].departure ?? rows[0].arrival);
    if (first == null) return;
    const stops = rows.map((r) => r.stop_id);
    const key = `${feed}|${meta.route_id}|${meta.direction_id ?? ""}|${stops.join(",")}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        feed,
        routeId: meta.route_id,
        directionId: meta.direction_id ?? null,
        headsign: meta.headsign ?? null,
        stops,
        offsets: rows.map((r) => [
          (sec(r.arrival ?? r.departure) ?? first) - first,
          (sec(r.departure ?? r.arrival) ?? first) - first,
        ]),
        trips: [],
      };
      groups.set(key, group);
    }
    group.trips.push({ tripId: trip, serviceId: meta.service_id, firstDep: first });
  };

  for (const r of db.prepare(
    "SELECT feed, trip_id, stop_id, stop_sequence, arrival, departure FROM stop_times ORDER BY feed, trip_id, stop_sequence"
  ).iterate()) {
    if (r.feed !== feed || r.trip_id !== trip) {
      flush();
      feed = r.feed;
      trip = r.trip_id;
      rows = [];
    }
    rows.push(r);
  }
  flush();

  const insPattern = db.prepare("INSERT INTO patterns VALUES (?,?,?,?,?,?,?)");
  const insTrip = db.prepare("INSERT INTO pattern_trips VALUES (?,?,?,?,?)");
  db.exec("BEGIN");
  let id = 0;
  let tripCount = 0;
  for (const group of groups.values()) {
    id++;
    insPattern.run(
      id, group.feed, group.routeId, group.directionId, group.headsign,
      JSON.stringify(group.stops), JSON.stringify(group.offsets),
    );
    group.trips.sort((a, b) => a.firstDep - b.firstDep);
    for (const t of group.trips) {
      insTrip.run(id, group.feed, t.tripId, t.serviceId, t.firstDep);
      tripCount++;
    }
  }
  db.prepare("INSERT OR REPLACE INTO meta VALUES (?,?)").run("patterns:built_at", new Date().toISOString());
  db.prepare("INSERT OR REPLACE INTO meta VALUES (?,?)").run("patterns:count", String(id));
  db.exec("COMMIT");

  log(`patterns: ${id} from ${tripCount} trips (${Date.now() - started} ms)`);
  return { patterns: id, trips: tripCount };
}

// CLI: build into the live DB in place. The refresh pipeline calls buildPatterns()
// inside ingest.mjs instead, before the rename.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { resolve } = await import("node:path");
  const db = new DatabaseSync(resolve("data/jalan.db"));
  buildPatterns(db, { log: console.log });
  db.close();
}
