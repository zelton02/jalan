#!/usr/bin/env node
/**
 * Live bus / KTMB status inferred from GTFS-RT vehicle positions.
 *
 * The official feed only publishes positions, not delays, and bus trips are frequency-based
 * templates (one trip_id repeats every N minutes for hours). So the delay of a vehicle is:
 *
 *   inferred start = now - time already spent on the pattern
 *   nearest run in the frequency window = the run it is actually operating
 *   delay = (now + time to next stop) - (run start + scheduled offset)
 *
 * When the headway is short the run cannot be identified unambiguously; those vehicles are
 * dropped rather than guessed, and the route says how many vehicles the number is based on.
 *
 *   node ingest/live.mjs --route U2020
 *   node ingest/live.mjs            # every route with a live vehicle
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const RT_PATH = resolve("data/realtime.db");
const ST_PATH = resolve("data/jalan.db");
const FEEDS = ["bus-kl", "mrt-feeder", "ktmb"];

const MAX_AGE_SEC = 180;
const MAX_DELAY_MIN = 45;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b, c, d) {
  const dLat = rad(c - a);
  const dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const secOf = (t) => {
  const [h, m, s] = String(t).split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
/** Bus feeds name services "weekday"/"weekend"; derive it from the sample timestamp, not today. */
const serviceFor = (ts) => {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
  }).format(new Date(ts * 1000));
  return day === "Sat" || day === "Sun" ? "weekend" : "weekday";
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Static lookups are stable until the GTFS db is swapped by the nightly refresh. */
let staticCache = { mtime: 0, db: null, stops: null, trip: null, pattern: null, freq: null };

function staticDb() {
  const mtime = statSync(ST_PATH).mtimeMs;
  if (staticCache.db && staticCache.mtime === mtime) return staticCache;
  try { staticCache.db?.close(); } catch {}
  const db = new DatabaseSync(ST_PATH, { readOnly: true });
  const stops = new Map();
  for (const r of db.prepare("SELECT stop_id, stop_name, lat, lon FROM stops").all()) {
    stops.set(r.stop_id, r);
  }
  const labels = new Map();
  for (const r of db.prepare("SELECT feed, route_id, short_name, long_name FROM routes").all()) {
    labels.set(`${r.feed}|${r.route_id}`, r.short_name || r.long_name || r.route_id);
  }
  staticCache = {
    mtime,
    db,
    stops,
    labels,
    trip: db.prepare("SELECT pattern_id, first_dep FROM pattern_trips WHERE trip_id = ?"),
    pattern: db.prepare("SELECT feed, route_id, stops, offsets FROM patterns WHERE pattern_id = ?"),
    windows: db.prepare(`
      SELECT DISTINCT f.start_time, f.end_time, f.headway_secs, t.service_id
      FROM pattern_trips pt
      JOIN trips t ON t.trip_id = pt.trip_id AND t.feed = pt.feed
      JOIN frequencies f ON f.trip_id = pt.trip_id AND f.feed = pt.feed
      WHERE pt.pattern_id = ?
    `),
  };
  return staticCache;
}

const patternCache = new Map();
function tripInfo(tripId, s) {
  if (patternCache.has(tripId)) return patternCache.get(tripId);
  const pt = s.trip.get(tripId);
  if (!pt) {
    patternCache.set(tripId, null);
    return null;
  }
  const pat = s.pattern.get(pt.pattern_id);
  if (!pat) {
    patternCache.set(tripId, null);
    return null;
  }
  const info = {
    patternId: pt.pattern_id,
    feed: pat.feed,
    routeId: pat.route_id,
    label: s.labels.get(`${pat.feed}|${pat.route_id}`) ?? pat.route_id,
    stops: JSON.parse(pat.stops),
    offsets: JSON.parse(pat.offsets),
    firstDep: pt.first_dep,
  };
  patternCache.set(tripId, info);
  return info;
}

/**
 * Every run this pattern operates, from all its frequency windows. The RT trip_id is often a
 * stale template (a bus at 14:15 can still broadcast its 09:25 trip), so runs are matched
 * against the whole pattern, filtered to today's weekday/weekend service.
 */
const windowCache = new Map();
function runsFor(info, s, service) {
  const key = `${info.patternId}|${service}`;
  if (windowCache.has(key)) return windowCache.get(key);
  const windows = s.windows.all(info.patternId)
    .filter((w) => !service || !w.service_id || w.service_id === service);
  const runs = [];
  for (const w of windows) {
    const start = secOf(w.start_time), end = secOf(w.end_time), hw = w.headway_secs;
    if (hw <= 0) continue;
    for (let t = start; t <= end; t += hw) runs.push({ t, headway: hw });
  }
  runs.sort((a, b) => a.t - b.t);
  windowCache.set(key, runs);
  return runs;
}

/** Pick the run this vehicle most likely belongs to; null when the headway makes it ambiguous. */
function runStart(info, atStop, offset, s, service) {
  const runs = runsFor(info, s, service);
  if (!runs.length) return info.firstDep;
  const inferred = atStop - offset;
  let best = null;
  let secondGap = Infinity;
  for (const run of runs) {
    const gap = Math.abs(inferred - run.t);
    if (!best || gap < best.gap) {
      secondGap = best ? best.gap : Infinity;
      best = { ...run, gap };
    } else if (gap < secondGap) {
      secondGap = gap;
    }
  }
  if (!best) return null;
  if (best.gap > best.headway * 0.4) return null; // cannot tell which run this is
  return best.t;
}

let cache = { at: 0, data: null };

export function liveStatus({ now = Math.floor(Date.now() / 1000), maxAgeSec = MAX_AGE_SEC } = {}) {
  if (cache.data && now - cache.at < 20) return cache.data;
  const empty = { updated_at: null, feeds: {}, routes: {} };
  if (!existsSync(RT_PATH)) return empty;

  let rt;
  try {
    rt = new DatabaseSync(RT_PATH, { readOnly: true });
    const latest = rt.prepare("SELECT MAX(ts) m FROM vp").get()?.m;
    if (!latest || now - latest > maxAgeSec) return empty;

    const s = staticDb();
    const service = serviceFor(latest);
    const rows = rt.prepare("SELECT feed, ts, vid, trip, route, lat, lon, speed FROM vp WHERE ts = ?").all(latest);
    const routes = {};
    let considered = 0;

    for (const v of rows) {
      if (!v.trip) continue;
      const info = tripInfo(v.trip, s);
      if (!info) continue;

      // Nearest stop on the pattern (routes rarely double back within a stop's radius).
      let near = null;
      for (let i = 0; i < info.stops.length; i++) {
        const stop = s.stops.get(info.stops[i]);
        if (!stop) continue;
        const d = haversine(v.lat, v.lon, stop.lat, stop.lon);
        if (!near || d < near.d) near = { d, i, stop };
      }
      if (!near || near.d > 350) continue;

      // local seconds of the service day; before 04:00 the previous day is still running
      let local = (((v.ts + 8 * 3600) % 86400) + 86400) % 86400;
      if (local < 4 * 3600) local += 86400;

      const speedKmh = Math.min(50, Math.max(10, Number(v.speed) || 0));
      const toStopSec = near.d / (speedKmh / 3.6);
      const atStop = local + toStopSec;
      const offset = info.offsets[near.i][0];
      const start = runStart(info, atStop, offset, s, service);
      if (start == null) continue;

      const delayMin = (atStop - (start + offset)) / 60;
      if (Math.abs(delayMin) > MAX_DELAY_MIN) continue;

      considered++;
      const bucket = (routes[info.routeId] ??= {
        route: info.routeId,
        label: info.label,
        feed: v.feed,
        delays: [],
        vehicles: [],
      });
      bucket.delays.push(delayMin);
      bucket.vehicles.push({
        id: v.vid,
        trip: v.trip,
        near_stop: near.stop.stop_name,
        delay_min: Math.round(delayMin),
      });
    }

    for (const [id, b] of Object.entries(routes)) {
      routes[id] = {
        route: id,
        label: b.label,
        feed: b.feed,
        vehicles: b.vehicles.length,
        median_delay_min: Math.round(median(b.delays)),
        spread_min: Math.round(Math.min(...b.delays)) + "…" + Math.round(Math.max(...b.delays)),
        list: b.vehicles.slice(0, 8),
      };
    }

    const feeds = {};
    for (const feed of FEEDS) {
      const n = rows.filter((r) => r.feed === feed).length;
      feeds[feed] = n;
    }

    const data = {
      updated_at: new Date(latest * 1000).toISOString(),
      feeds,
      considered,
      sampled: rows.length,
      routes,
    };
    cache = { at: now, data };
    return data;
  } catch (error) {
    console.error("[live]", String(error));
    return empty;
  } finally {
    try { rt?.close(); } catch {}
  }
}

const argv = process.argv.slice(2);
const routeArg = argv.includes("--route") ? argv[argv.indexOf("--route") + 1] : null;
if (import.meta.url === `file://${process.argv[1]}`) {
  const live = liveStatus();
  if (!live.updated_at) {
    console.log("Tiada data langsung. / No live data (collector down or outside service hours).");
    process.exit(1);
  }
  console.log(`live ${live.updated_at} · sampled ${live.sampled} · usable ${live.considered}`);
  const routes = routeArg ? { [routeArg]: live.routes[routeArg] } : live.routes;
  for (const r of Object.values(routes)) {
    if (!r) {
      console.log(`${routeArg}: tiada kenderaan langsung / no live vehicle`);
      continue;
    }
    console.log(`\n${r.label} (${r.feed}) · ${r.vehicles} kenderaan · median ${r.median_delay_min >= 0 ? "+" : ""}${r.median_delay_min} min (${r.spread_min})`);
    for (const v of r.list) {
      console.log(`  ${v.id} ${v.trip} · dekat ${v.near_stop} · ${v.delay_min >= 0 ? "+" : ""}${v.delay_min} min`);
    }
  }
}
