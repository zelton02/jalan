#!/usr/bin/env node
/**
 * Next departures at a stop, straight from the GTFS SQLite.
 *
 *   node ingest/next.mjs --stop KG31 --dir north
 *   node ingest/next.mjs --stop "Bukit Dukung" --route KGL --limit 8 --at 07:30
 *   node ingest/next.mjs --stop KG31 --dir north --json
 *
 * The official rail feed is frequency-based: a route has one template trip per
 * service pattern plus frequencies.txt headways. Departures are expanded here.
 */
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const stopArg = arg("stop");
if (!stopArg) {
  console.error("usage: node ingest/next.mjs --stop <stop_id|name> [--dir north|south] [--route KGL] [--limit 5] [--at HH:MM] [--json]");
  process.exit(2);
}
const dirArg = (arg("dir") ?? "north").toLowerCase();
const routeArg = arg("route");
const feedArg = arg("feed");
const limit = Number(arg("limit", "5"));
const atArg = arg("at");
const asJson = flag("json");

const db = new DatabaseSync(resolve("data/jalan.db"), { readOnly: true });

const sec = (t) => {
  if (!t) return null;
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const hhmm = (s) => {
  const t = ((s % 86400) + 86400) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};
const KL = "Asia/Kuala_Lumpur";
const pad = (n) => String(n).padStart(2, "0");
const WEEKDAY = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };

// The host may run in UTC; every schedule decision must use Kuala Lumpur time.
function klNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: KL, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  return {
    ymd: `${y}${pad(m)}${pad(d)}`,
    weekday: WEEKDAY[parts.weekday],
    seconds: (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

function dayBefore(ymd) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getUTCDay()];
  return { ymd: `${y}${pad(m)}${pad(day)}`, weekday };
}

// --- resolve stop -----------------------------------------------------------
const stops = db.prepare(
  `SELECT feed, stop_id, stop_name FROM stops
   WHERE (UPPER(stop_id) = UPPER(?) OR UPPER(stop_name) LIKE UPPER(?))
   ${feedArg ? "AND feed = ?" : ""}`
).all(...(feedArg ? [stopArg, `%${stopArg}%`, feedArg] : [stopArg, `%${stopArg}%`]));

if (!stops.length) {
  console.error(`stop not found: ${stopArg}`);
  process.exit(1);
}

// With 12 feeds, the same name can exist in several states. Never guess silently.
const needle = stopArg.toUpperCase();
const rank = (s) => {
  const id = s.stop_id.toUpperCase();
  const name = s.stop_name.toUpperCase();
  if (id === needle) return 0;
  if (name === needle) return 1;
  if (name.startsWith(needle)) return 2;
  return 3;
};
stops.sort((a, b) => rank(a) - rank(b) || a.stop_name.length - b.stop_name.length);

const matchedFeeds = new Set(stops.map((s) => s.feed));
if (matchedFeeds.size > 1 && !feedArg) {
  console.error(`"${stopArg}" appears in ${matchedFeeds.size} feeds — choose one with --feed:`);
  for (const s of stops.slice(0, 10)) {
    console.error(`  --feed ${s.feed.padEnd(14)} ${s.stop_id.padEnd(9)} ${s.stop_name}`);
  }
  process.exit(1);
}

const stop = stops[0];
if (stops.length > 1) {
  console.error(`matched ${stops.length} stops, using ${stop.feed}:${stop.stop_id} ${stop.stop_name}`);
}

// --- which routes serve this stop -------------------------------------------
const routeRows = db.prepare(
  `SELECT DISTINCT t.feed, t.route_id, r.short_name, r.long_name
   FROM stop_times st
   JOIN trips t ON t.feed = st.feed AND t.trip_id = st.trip_id
   LEFT JOIN routes r ON r.feed = t.feed AND r.route_id = t.route_id
   WHERE st.feed = ? AND st.stop_id = ?
   ${routeArg ? "AND t.route_id = ?" : ""}`
).all(...(routeArg ? [stop.feed, stop.stop_id, routeArg] : [stop.feed, stop.stop_id]));

if (!routeRows.length) {
  console.error(`no routes serve ${stop.stop_id}`);
  process.exit(1);
}
const routes = routeRows.map((r) => r.route_id);

// --- direction: north = the direction whose terminal is further north -------
function terminalLat(routeId, directionId) {
  const trips = db.prepare(
    `SELECT trip_id FROM trips WHERE feed = ? AND route_id = ? AND direction_id IS ? LIMIT 20`
  ).all(stop.feed, routeId, directionId);
  let sum = 0, n = 0;
  for (const t of trips) {
    const last = db.prepare(
      `SELECT st.stop_id FROM stop_times st
       WHERE st.feed = ? AND st.trip_id = ?
       ORDER BY st.stop_sequence DESC LIMIT 1`
    ).get(stop.feed, t.trip_id);
    if (!last) continue;
    const s = db.prepare(`SELECT lat FROM stops WHERE feed = ? AND stop_id = ?`).get(stop.feed, last.stop_id);
    if (s?.lat != null) { sum += s.lat; n++; }
  }
  return n ? sum / n : null;
}

const directions = db.prepare(
  `SELECT DISTINCT direction_id FROM trips WHERE feed = ? AND route_id IN (${routes.map(() => "?").join(",")})`
).all(stop.feed, ...routes).map((r) => r.direction_id);

const scored = directions.map((d) => ({ d, lat: terminalLat(routes[0], d) })).filter((x) => x.lat != null);
scored.sort((a, b) => b.lat - a.lat);
const northDir = scored[0]?.d ?? "0";
const wantedDir = dirArg === "south" ? (scored[1]?.d ?? "1") : northDir;

// --- active services --------------------------------------------------------
const kl = klNow();

function activeServices(feed, ymd, weekdayCol) {
  const rows = db.prepare(
    `SELECT service_id, ${weekdayCol} AS day FROM calendar
     WHERE feed = ? AND start_date <= ? AND end_date >= ?`
  ).all(feed, ymd, ymd).filter((r) => r.day === 1).map((r) => r.service_id);
  const exceptions = db.prepare(`SELECT service_id, exception_type FROM calendar_dates WHERE feed = ? AND date = ?`).all(feed, ymd);
  const set = new Set(rows);
  for (const e of exceptions) {
    if (e.exception_type === 1) set.add(e.service_id);
    if (e.exception_type === 2) set.delete(e.service_id);
  }
  return set;
}

// --- expand departures ------------------------------------------------------
function departuresFor(ymd, weekdayCol, dayOffset) {
  const services = activeServices(stop.feed, ymd, weekdayCol);
  if (!services.size) return [];
  const out = [];
  const placeholders = services.size;
  const serviceList = [...services];

  for (const routeId of routes) {
    const trips = db.prepare(
      `SELECT trip_id, service_id, headsign, direction_id FROM trips
       WHERE feed = ? AND route_id = ? AND direction_id IS ?
         AND service_id IN (${serviceList.map(() => "?").join(",")})`
    ).all(stop.feed, routeId, wantedDir, ...serviceList);

    for (const trip of trips) {
      const times = db.prepare(
        `SELECT stop_id, departure, stop_sequence FROM stop_times
         WHERE feed = ? AND trip_id = ? ORDER BY stop_sequence`
      ).all(stop.feed, trip.trip_id);
      if (!times.length) continue;
      const first = sec(times[0].departure);
      const mine = times.find((t) => t.stop_id === stop.stop_id);
      if (first == null || !mine || mine.departure == null) continue;
      const offset = sec(mine.departure) - first;

      const freqs = db.prepare(`SELECT start_time, end_time, headway_secs FROM frequencies WHERE feed = ? AND trip_id = ?`).all(stop.feed, trip.trip_id);
      if (freqs.length) {
        for (const f of freqs) {
          const start = sec(f.start_time), end = sec(f.end_time), step = f.headway_secs;
          if (start == null || end == null || !step) continue;
          for (let t = start; t <= end; t += step) {
            out.push({ abs: dayOffset * 86400 + t + offset, trip_id: trip.trip_id, route: routeId, headsign: trip.headsign });
          }
        }
      } else {
        out.push({ abs: dayOffset * 86400 + sec(mine.departure), trip_id: trip.trip_id, route: routeId, headsign: trip.headsign });
      }
    }
  }
  return out;
}

const now = atArg ? (() => { const [h, m] = atArg.split(":").map(Number); return h * 3600 + m * 60; })() : kl.seconds;
const yesterday = dayBefore(kl.ymd);

let deps = departuresFor(kl.ymd, kl.weekday, 0);
if (now < 4 * 3600) deps = deps.concat(departuresFor(yesterday.ymd, yesterday.weekday, -1));
deps = deps.filter((d) => d.abs >= now).sort((a, b) => a.abs - b.abs);

const seen = new Set();
const unique = [];
for (const d of deps) {
  const key = `${d.route}|${d.abs}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(d);
  if (unique.length >= limit) break;
}

const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));

const payload = {
  stop: { feed: stop.feed, id: stop.stop_id, name: stop.stop_name },
  direction: dirArg,
  direction_id: wantedDir,
  generated_at: new Date().toISOString(),
  data_ingested_at: meta[`${stop.feed}:ingested_at`] ?? null,
  departures: unique.map((d) => ({
    time: hhmm(d.abs),
    in_minutes: Math.round((d.abs - now) / 60),
    route: d.route,
    headsign: d.headsign,
  })),
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`${stop.stop_name} (${stop.stop_id}) → ${dirArg}`);
  const ingested = payload.data_ingested_at
    ? new Intl.DateTimeFormat("en-GB", { timeZone: KL, dateStyle: "short", timeStyle: "short" }).format(new Date(payload.data_ingested_at))
    : "unknown";
  console.log(`data: ${ingested} (MYT)\n`);
  if (!unique.length) {
    console.log("no departures found — check the service window or --at");
  } else {
    for (const d of payload.departures) {
      const mins = d.in_minutes <= 0 ? "now" : `in ${d.in_minutes} min`;
      console.log(`  ${d.time}  ${d.route.padEnd(4)}  ${d.headsign ?? ""}  (${mins})`);
    }
  }
}
db.close();
