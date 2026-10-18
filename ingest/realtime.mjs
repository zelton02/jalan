#!/usr/bin/env node
/**
 * GTFS-Realtime collector.
 *
 * Samples every vehicle position feed once a minute into data/realtime.db so that
 * headways and travel times can be measured later — official feeds only give "now",
 * they do not keep history.
 *
 *   node ingest/realtime.mjs              # run forever (systemd)
 *   node ingest/realtime.mjs --once       # one cycle, for testing
 *
 * Rail realtime does not exist for rapid-rail-kl (404); only buses and KTMB are collected.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const FEEDS = [
  { key: "bus-kl", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl" },
  { key: "mrt-feeder", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder" },
  { key: "ktmb", url: "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb" },
];

const DB_PATH = resolve("data/realtime.db");
mkdirSync("data", { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS vp (
    ts INTEGER NOT NULL,
    feed TEXT NOT NULL,
    vid TEXT NOT NULL,
    trip TEXT,
    route TEXT,
    dir TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    speed REAL,
    bearing REAL,
    PRIMARY KEY (feed, vid, ts)
  );
  CREATE INDEX IF NOT EXISTS vp_ts ON vp(ts);
  CREATE INDEX IF NOT EXISTS vp_route ON vp(route, ts);
  CREATE TABLE IF NOT EXISTS poll (
    ts INTEGER NOT NULL,
    feed TEXT NOT NULL,
    status INTEGER,
    bytes INTEGER,
    n INTEGER,
    error TEXT,
    PRIMARY KEY (ts, feed)
  );
`);

const insertVp = db.prepare(
  `INSERT OR IGNORE INTO vp (ts, feed, vid, trip, route, dir, lat, lon, speed, bearing)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertPoll = db.prepare(
  `INSERT OR REPLACE INTO poll (ts, feed, status, bytes, n, error) VALUES (?, ?, ?, ?, ?, ?)`
);

const nowSec = () => Math.floor(Date.now() / 1000);

async function sample(feed, ts) {
  try {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      insertPoll.run(ts, feed.key, res.status, buf.length, 0, buf.toString("utf8").slice(0, 120));
      return 0;
    }
    const msg = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buf);
    let n = 0;
    db.exec("BEGIN");
    for (const entity of msg.entity) {
      const v = entity.vehicle;
      if (!v?.position) continue;
      insertVp.run(
        ts,
        feed.key,
        v.vehicle?.id ?? entity.id ?? "?",
        v.trip?.tripId ?? null,
        v.trip?.routeId ?? null,
        v.trip?.directionId ?? null,
        v.position.latitude,
        v.position.longitude,
        v.position.speed ?? null,
        v.position.bearing ?? null
      );
      n++;
    }
    db.exec("COMMIT");
    insertPoll.run(ts, feed.key, res.status, buf.length, n, null);
    return n;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    insertPoll.run(ts, feed.key, 0, 0, 0, String(error).slice(0, 120));
    return 0;
  }
}

async function cycle() {
  const ts = nowSec();
  const counts = await Promise.all(FEEDS.map((f) => sample(f, ts)));
  const summary = FEEDS.map((f, i) => `${f.key}=${counts[i]}`).join(" ");
  console.log(`${new Date(ts * 1000).toISOString()} ${summary}`);

  // Retention: 60 days of samples is enough to learn headways.
  if (ts % 86400 < 60) {
    db.prepare("DELETE FROM vp WHERE ts < ?").run(ts - 60 * 86400);
    db.prepare("DELETE FROM poll WHERE ts < ?").run(ts - 60 * 86400);
  }
}

const once = process.argv.includes("--once");
if (once) {
  await cycle();
  db.close();
} else {
  console.log(`jalan realtime collector → ${DB_PATH}`);
  await cycle();
  // Align to the next minute boundary, then every 60s.
  const wait = 60_000 - (Date.now() % 60_000);
  setTimeout(function loop() {
    cycle().finally(() => setTimeout(loop, 60_000 - (Date.now() % 60_000)));
  }, wait);
}
