#!/usr/bin/env node
/**
 * Download the official GTFS feeds, unzip them, and rebuild data/jalan.db.
 *
 *   node ingest/ingest.mjs            # refresh feeds older than 20h
 *   node ingest/ingest.mjs --force    # always re-download
 *   node ingest/ingest.mjs --only rail
 *
 * Static data only. Realtime (vehicle positions) is a separate poller — see DATA.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FEEDS } from "./feeds.mjs";
import { parseCsvObjects } from "./csv.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const CACHE = resolve(".cache/gtfs");
const DB_PATH = resolve("data/jalan.db");
const TMP_PATH = `${DB_PATH}.tmp`;
const MAX_AGE_MS = 20 * 60 * 60 * 1000;

mkdirSync(CACHE, { recursive: true });
mkdirSync(dirname(DB_PATH), { recursive: true });

const log = (...a) => console.log(...a);

async function download(feed) {
  const zip = join(CACHE, `${feed.key}.zip`);
  const fresh = existsSync(zip) && Date.now() - statSync(zip).mtimeMs < MAX_AGE_MS;
  if (fresh && !force) {
    log(`  ${feed.key}: cached (${(statSync(zip).size / 1024).toFixed(0)} KB)`);
    return zip;
  }
  const res = await fetch(feed.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${feed.key}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zip, buf);
  log(`  ${feed.key}: downloaded ${(buf.length / 1024).toFixed(0)} KB`);
  return zip;
}

function unzip(zip, key) {
  const dir = join(CACHE, key);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  return dir;
}

function read(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function toInt(v) { return v ? Number(v) : 0; }

function main(feeds) {
  // Build beside the live file, then swap atomically. Readers never see a half-built DB.
  rmSync(TMP_PATH, { force: true });
  const db = new DatabaseSync(TMP_PATH);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE stops (feed TEXT, stop_id TEXT, stop_name TEXT, lat REAL, lon REAL, category TEXT, PRIMARY KEY (feed, stop_id));
    CREATE TABLE routes (feed TEXT, route_id TEXT, short_name TEXT, long_name TEXT, route_type TEXT, color TEXT, text_color TEXT, category TEXT, PRIMARY KEY (feed, route_id));
    CREATE TABLE trips (feed TEXT, trip_id TEXT, route_id TEXT, service_id TEXT, headsign TEXT, direction_id TEXT, PRIMARY KEY (feed, trip_id));
    CREATE TABLE stop_times (feed TEXT, trip_id TEXT, stop_sequence INTEGER, stop_id TEXT, arrival TEXT, departure TEXT, PRIMARY KEY (feed, trip_id, stop_sequence));
    CREATE TABLE calendar (feed TEXT, service_id TEXT, mon INT, tue INT, wed INT, thu INT, fri INT, sat INT, sun INT, start_date TEXT, end_date TEXT, PRIMARY KEY (feed, service_id));
    CREATE TABLE calendar_dates (feed TEXT, service_id TEXT, date TEXT, exception_type INT);
    CREATE TABLE frequencies (feed TEXT, trip_id TEXT, start_time TEXT, end_time TEXT, headway_secs INT);
    CREATE INDEX idx_stop_times_stop ON stop_times (feed, stop_id);
    CREATE INDEX idx_stop_times_trip ON stop_times (feed, trip_id);
    CREATE INDEX idx_trips_route ON trips (feed, route_id);
  `);

  const insStop = db.prepare("INSERT OR REPLACE INTO stops VALUES (?,?,?,?,?,?)");
  const insRoute = db.prepare("INSERT OR REPLACE INTO routes VALUES (?,?,?,?,?,?,?,?)");
  const insTrip = db.prepare("INSERT OR REPLACE INTO trips VALUES (?,?,?,?,?,?)");
  const insST = db.prepare("INSERT OR REPLACE INTO stop_times VALUES (?,?,?,?,?,?)");
  const insCal = db.prepare("INSERT OR REPLACE INTO calendar VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insCalDate = db.prepare("INSERT INTO calendar_dates VALUES (?,?,?,?)");
  const insFreq = db.prepare("INSERT INTO frequencies VALUES (?,?,?,?,?)");
  const insMeta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?,?)");

  db.exec("BEGIN");
  for (const feed of feeds) {
    const dir = join(CACHE, feed.key);
    const counts = {};

    const stops = read(dir, "stops.txt");
    if (stops) {
      const rows = parseCsvObjects(stops);
      for (const r of rows) insStop.run(feed.key, r.stop_id, r.stop_name, r.stop_lat ? Number(r.stop_lat) : null, r.stop_lon ? Number(r.stop_lon) : null, r.category ?? null);
      counts.stops = rows.length;
    }

    const routes = read(dir, "routes.txt");
    if (routes) {
      const rows = parseCsvObjects(routes);
      for (const r of rows) insRoute.run(feed.key, r.route_id, r.route_short_name ?? null, r.route_long_name ?? null, r.route_type ?? null, r.route_color ?? null, r.route_text_color ?? null, r.category ?? null);
      counts.routes = rows.length;
    }

    const trips = read(dir, "trips.txt");
    if (trips) {
      const rows = parseCsvObjects(trips);
      for (const r of rows) insTrip.run(feed.key, r.trip_id, r.route_id, r.service_id, r.trip_headsign ?? null, r.direction_id ?? null);
      counts.trips = rows.length;
    }

    const st = read(dir, "stop_times.txt");
    if (st) {
      const rows = parseCsvObjects(st);
      for (const r of rows) insST.run(feed.key, r.trip_id, toInt(r.stop_sequence), r.stop_id, r.arrival_time ?? null, r.departure_time ?? null);
      counts.stop_times = rows.length;
    }

    const cal = read(dir, "calendar.txt");
    if (cal) {
      const rows = parseCsvObjects(cal);
      for (const r of rows) insCal.run(feed.key, r.service_id, toInt(r.monday), toInt(r.tuesday), toInt(r.wednesday), toInt(r.thursday), toInt(r.friday), toInt(r.saturday), toInt(r.sunday), r.start_date, r.end_date);
      counts.services = rows.length;
    }

    const calDates = read(dir, "calendar_dates.txt");
    if (calDates) {
      const rows = parseCsvObjects(calDates);
      for (const r of rows) insCalDate.run(feed.key, r.service_id, r.date, toInt(r.exception_type));
      counts.calendar_dates = rows.length;
    }

    const freq = read(dir, "frequencies.txt");
    if (freq) {
      const rows = parseCsvObjects(freq);
      for (const r of rows) insFreq.run(feed.key, r.trip_id, r.start_time, r.end_time, toInt(r.headway_secs));
      counts.frequencies = rows.length;
    }

    insMeta.run(`${feed.key}:ingested_at`, new Date().toISOString());
    insMeta.run(`${feed.key}:source`, feed.url);
    insMeta.run(`${feed.key}:counts`, JSON.stringify(counts));
    log(`  ${feed.key}: ${JSON.stringify(counts)}`);
  }
  db.exec("COMMIT");

  const total = db.prepare("SELECT COUNT(*) AS n FROM stop_times").get().n;
  insMeta.run("total_stop_times", String(total));
  db.close();

  renameSync(TMP_PATH, DB_PATH);
  // Stale sidecars belong to the previous inode; leaving them would confuse the next reader.
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  log(`\nbuilt ${DB_PATH} — ${total} stop_times`);
}

const selected = only ? FEEDS.filter((f) => f.key === only) : FEEDS;
if (!selected.length) throw new Error(`unknown feed: ${only}`);
log("sistem feeds:");
for (const feed of selected) {
  const zip = await download(feed);
  unzip(zip, feed.key);
}
main(selected);
