/**
 * One place for turning a GTFS-RT vehicle position into a schedule delay.
 *
 * Bus trips are frequency templates: one trip_id repeats every N minutes for hours, and the
 * feed often keeps broadcasting a stale template (a 14:15 bus still reporting its 09:25 trip).
 * So the run is matched against every frequency window of the pattern, not the trip's own.
 *
 *   inferred start = now - time already spent on the pattern
 *   delay = (now + time to the nearest stop) - (run start + scheduled offset)
 *
 * A match is only accepted when it is within 40% of the headway; otherwise the vehicle is
 * dropped. One minute of GPS jitter and the nearest-stop projection stay in the noise.
 */
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const ST_PATH = resolve("data/jalan.db");
export const MAX_DELAY_MIN = 45;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function haversine(a, b, c, d) {
  const dLat = rad(c - a);
  const dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const secOf = (t) => {
  const [h, m, s] = String(t).split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/** Bus feeds name services "weekday"/"weekend"; derive it from the sample, not today. */
export const serviceFor = (ts) => {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "short",
  }).format(new Date(ts * 1000));
  return day === "Sat" || day === "Sun" ? "weekend" : "weekday";
};

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

let staticCache = { mtime: 0, db: null };
const patternCache = new Map();
const windowCache = new Map();

/** Static lookups are stable until the nightly refresh swaps jalan.db. */
export function staticDb() {
  const mtime = statSync(ST_PATH).mtimeMs;
  if (staticCache.db && staticCache.mtime === mtime) return staticCache;
  try { staticCache.db?.close(); } catch {}
  // Trip/pattern ids may be reused by a new feed version; never mix old offsets with new data.
  patternCache.clear();
  windowCache.clear();

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

export function tripInfo(tripId) {
  if (patternCache.has(tripId)) return patternCache.get(tripId);
  const s = staticDb();
  const pt = s.trip.get(tripId);
  const pat = pt ? s.pattern.get(pt.pattern_id) : null;
  const info = pt && pat
    ? {
        patternId: pt.pattern_id,
        feed: pat.feed,
        routeId: pat.route_id,
        label: s.labels.get(`${pat.feed}|${pat.route_id}`) ?? pat.route_id,
        stops: JSON.parse(pat.stops),
        offsets: JSON.parse(pat.offsets),
        firstDep: pt.first_dep,
      }
    : null;
  patternCache.set(tripId, info);
  return info;
}

/** Every run this pattern operates, filtered to the weekday/weekend service of the sample. */
export function runsFor(info, service) {
  const key = `${info.patternId}|${service}`;
  if (windowCache.has(key)) return windowCache.get(key);
  const s = staticDb();
  const runs = [];
  for (const w of s.windows.all(info.patternId)) {
    if (service && w.service_id && w.service_id !== service) continue;
    const start = secOf(w.start_time), end = secOf(w.end_time), hw = w.headway_secs;
    if (hw <= 0) continue;
    for (let t = start; t <= end; t += hw) runs.push({ t, headway: hw });
  }
  runs.sort((a, b) => a.t - b.t);
  windowCache.set(key, runs);
  return runs;
}

/** The run this vehicle most likely belongs to; null when the headway makes it ambiguous. */
export function runStart(info, atStop, offset, service) {
  const runs = runsFor(info, service);
  if (!runs.length) return info.firstDep;
  const inferred = atStop - offset;
  let best = null;
  for (const run of runs) {
    const gap = Math.abs(inferred - run.t);
    if (!best || gap < best.gap) best = { ...run, gap };
  }
  if (!best) return null;
  if (best.gap > best.headway * 0.4) return null;
  return best.t;
}

/**
 * @param tripId GTFS trip id from the realtime feed
 * @param sample { ts, lat, lon, speed } — unix seconds, degrees, km/h
 * @returns { info, nearStop, delayMin } or null when the sample cannot be matched
 */
export function estimateSample(tripId, sample) {
  if (!tripId) return null;
  const info = tripInfo(tripId);
  if (!info) return null;

  const s = staticDb();
  let near = null;
  for (let i = 0; i < info.stops.length; i++) {
    const stop = s.stops.get(info.stops[i]);
    if (!stop) continue;
    const d = haversine(sample.lat, sample.lon, stop.lat, stop.lon);
    if (!near || d < near.d) near = { d, i, stop };
  }
  if (!near || near.d > 350) return null;

  // Local seconds of the service day; before 04:00 the previous day is still running.
  let local = (((sample.ts + 8 * 3600) % 86400) + 86400) % 86400;
  if (local < 4 * 3600) local += 86400;

  const speedKmh = Math.min(50, Math.max(10, Number(sample.speed) || 0));
  const atStop = local + near.d / (speedKmh / 3.6);
  const offset = info.offsets[near.i][0];
  const service = serviceFor(sample.ts);
  const start = runStart(info, atStop, offset, service);
  if (start == null) return null;

  const delayMin = (atStop - (start + offset)) / 60;
  if (Math.abs(delayMin) > MAX_DELAY_MIN) return null;

  return { info, nearStop: near.stop.stop_name, delayMin };
}
