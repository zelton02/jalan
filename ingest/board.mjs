#!/usr/bin/env node
/**
 * Departure board: what leaves a stop next, using the in-memory pattern index.
 *
 *   node ingest/board.mjs --q UTAR
 *   node ingest/board.mjs --stop "bus|1000383"
 */
import { activeServices, dayBefore, hhmm, klNow } from "./lib.mjs";
import { lineIdFor } from "./router.mjs";

const SERVICE_DAY_CUTOFF = 4 * 3600;
const HORIZON_SEC = 90 * 60;
const GRACE_SEC = 30;

const servicesCache = new Map();
function servicesFor(db, feed, ymd, weekday) {
  const key = `${feed}|${ymd}`;
  if (servicesCache.has(key)) return servicesCache.get(key);
  const set = activeServices(db, feed, ymd, weekday);
  // A new GTFS day invalidates everything; cheap enough to clear once a day.
  if (servicesCache.size > 200) servicesCache.clear();
  servicesCache.set(key, set);
  return set;
}

/** Service day + seconds-of-service-day for "now" (the day rolls at 04:00). */
export function boardNow() {
  const kl = klNow();
  let ymd = kl.ymd;
  let weekday = kl.weekday;
  let nowSec = kl.seconds;
  if (nowSec < SERVICE_DAY_CUTOFF) {
    const y = dayBefore(kl.ymd);
    ymd = y.ymd;
    weekday = y.weekday;
    nowSec += 86400;
  }
  return { ymd, weekday, nowSec };
}

/** Name search over the stop index. Rail stations rank above bus stops with the same name. */
export function searchStops(index, query, limit = 8) {
  const q = String(query ?? "").trim().toLowerCase();
  if (q.length < 2) return [];

  const hits = [];
  for (const stop of index.stops) {
    const name = stop.name.toLowerCase();
    const at = name.indexOf(q);
    if (at < 0) continue;
    const patterns = index.patternsAtStop.get(stop.key);
    if (!patterns?.length) continue;

    // "UTAR" must beat "CYBERJAYA UTARA": exact token / phrase beats a token prefix.
    const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
    const rank = tokens.includes(q) || name.startsWith(q)
      ? 0
      : tokens.some((t) => t.startsWith(q)) ? 1 : 2;
    const railBonus = stop.feed === "rail" || stop.feed === "ktmb" ? 0 : 0.5;
    hits.push({ stop, patterns: patterns.length, score: rank + railBonus, at });
  }
  hits.sort((a, b) => a.score - b.score || a.at - b.at || b.patterns - a.patterns);

  const picked = [];
  for (const hit of hits) {
    const dup = picked.some((p) =>
      p.stop.name.toLowerCase() === hit.stop.name.toLowerCase() &&
      Math.abs(p.stop.lat - hit.stop.lat) < 0.001 &&
      Math.abs(p.stop.lon - hit.stop.lon) < 0.001
    );
    if (dup) continue;
    picked.push(hit);
    if (picked.length >= limit) break;
  }
  return picked.map(({ stop, patterns }) => ({
    key: stop.key,
    name: stop.name,
    feed: stop.feed,
    lat: stop.lat,
    lon: stop.lon,
    routes: patterns,
  }));
}

/**
 * Next departures at one stop. Frequency trips are expanded on the fly; scheduled trips use
 * first_dep. The same route can appear more than once per minute through different patterns,
 * so dedupe on (route, departure).
 */
export function nextDepartures(db, index, stopKey, { limit = 8 } = {}) {
  const { ymd, weekday, nowSec } = boardNow();
  const entries = index.patternsAtStop.get(stopKey) ?? [];
  const candidates = [];

  for (const { pattern, idx } of entries) {
    // A stop that is the last stop of a pattern has arrivals, not departures.
    if (idx >= pattern.stopKeys.length - 1) continue;
    const services = servicesFor(db, pattern.feed, ymd, weekday);
    if (!services.size) continue;
    const rel = pattern.relDep[idx];
    const patternDeps = [];

    for (const trip of pattern.scheduled) {
      if (!services.has(trip.serviceId)) continue;
      const dep = trip.firstDep + rel;
      if (dep < nowSec - GRACE_SEC || dep > nowSec + HORIZON_SEC) continue;
      patternDeps.push({ dep, tripId: trip.tripId });
    }

    for (const trip of pattern.frequency) {
      if (!services.has(trip.serviceId)) continue;
      for (const window of trip.freq ?? []) {
        const k0 = Math.max(0, Math.ceil((nowSec - rel - window.start) / window.step));
        for (let k = k0; k < k0 + 6; k++) {
          const run = window.start + k * window.step;
          if (run > window.end) break;
          const dep = run + rel;
          if (dep > nowSec + HORIZON_SEC) break;
          if (dep < nowSec - GRACE_SEC) continue;
          patternDeps.push({ dep, tripId: trip.tripId });
        }
      }
    }

    // One pattern can leave this stop several times inside the horizon.
    patternDeps.sort((a, b) => a.dep - b.dep);
    for (const d of patternDeps.slice(0, 6)) candidates.push({ ...d, pattern });
  }

  candidates.sort((a, b) => a.dep - b.dep);
  const seen = new Set();
  const list = [];
  for (const c of candidates) {
    const key = `${c.pattern.routeId}|${c.dep}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const route = c.pattern.route;
    const lastKey = c.pattern.stopKeys[c.pattern.stopKeys.length - 1];
    const long = route?.long_name ?? "";
    const longDest = long.includes("~") ? long.split("~").pop().trim() : long;
    // Loop services start and end at the same stop, so "last stop" is where you already are.
    const isLoop = c.pattern.stopKeys[0] === lastKey;
    const destination = isLoop
      ? (longDest || null)
      : (index.byKey.get(lastKey)?.name || longDest || null);
    list.push({
      routeId: c.pattern.routeId,
      route: route?.short_name || longDest || c.pattern.routeId,
      feed: c.pattern.feed,
      line: lineIdFor(c.pattern.feed, c.pattern.routeId),
      headsign: c.pattern.headsign || destination,
      time: hhmm(c.dep),
      in_min: Math.max(0, Math.floor((c.dep - nowSec) / 60)),
      patternId: c.pattern.id,
    });
    if (list.length >= limit) break;
  }
  return { date: ymd, at: hhmm(nowSec), departures: list };
}

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : null);
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import("./lib.mjs");
  const { buildIndex } = await import("./router.mjs");
  const db = openDb("data/jalan.db");
  let index = buildIndex(db);
  if (arg("q")) {
    for (const s of searchStops(index, arg("q"), 10)) console.log(`${s.key}  ${s.name}  (${s.routes} laluan)`);
  } else if (arg("stop")) {
    const board = nextDepartures(db, index, arg("stop"), { limit: 10 });
    console.log(`${arg("stop")} · ${board.date} ${board.at}`);
    for (const d of board.departures) {
      console.log(`  ${d.time}  ${String(d.in_min).padStart(3)} min  ${d.route.padEnd(6)} → ${d.headsign ?? "?"}`);
    }
  } else {
    console.log("usage: node ingest/board.mjs --q UTAR | --stop 'bus|1000383'");
  }
}
