// Round-based (RAPTOR-lite) journey planner over the SQLite GTFS store.
//
// Input is a pair of coordinates, not a hardcoded corridor. Each round boards one
// vehicle; every stop reached by a trip is labelled with the earliest arrival and
// the ride that produced it, then the next round boards from that frontier.
//
// The response keeps the same leg shape as lib.planDoorToDoor so the client does
// not change when the engine is swapped.
import { activeServices, dayBefore, klNow, hhmm, sec, metaMap } from "./lib.mjs";

const WALK_SPEED_M_MIN = 75;   // average walking pace
const DETOUR = 1.3;            // straight line -> street network
export const ACCESS_RADIUS_M = 1200;   // how far we let the rider walk to/from transit
const TRANSFER_RADIUS_M = 350;         // stop-to-stop footpath for transfers
const TRANSFER_PENALTY_SEC = 180;      // minimum time to change vehicle
const SERVICE_DAY_CUTOFF = 4 * 3600;   // GTFS service day rolls at 04:00 local

export const haversineM = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const walkSecondsFor = (meters) => Math.round((meters * DETOUR) / WALK_SPEED_M_MIN * 60);

const cleanName = (name) => (name ?? "").replace(/\s*-\s*REDONE\s*$/i, "").trim();

const lineIdFor = (feed, routeId) => {
  if (feed === "ktmb") return "ktm";
  if (feed === "rail") {
    if (routeId === "KGL") return "kajang";
    if (routeId === "KJ") return "kelana";
    if (routeId === "AG" || routeId === "PH") return "ampang";
    return undefined;
  }
  return "bus";
};

/** Stops, a lat/lon grid, and walking distances. Built once per DB handle. */
export function buildIndex(db) {
  const stops = db.prepare(
    "SELECT feed, stop_id, stop_name, lat, lon FROM stops WHERE lat IS NOT NULL AND lon IS NOT NULL"
  ).all().map((r) => ({
    feed: r.feed,
    id: r.stop_id,
    name: cleanName(r.stop_name),
    lat: r.lat,
    lon: r.lon,
    key: `${r.feed}|${r.stop_id}`,
  }));

  const byKey = new Map(stops.map((s) => [s.key, s]));
  const CELL = 0.01; // ~1.1 km
  const grid = new Map();
  for (const s of stops) {
    const k = `${Math.floor(s.lat / CELL)}:${Math.floor(s.lon / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  }

  const near = (lat, lon, radiusM) => {
    const span = Math.max(1, Math.ceil(radiusM / 1100 / CELL));
    const gx = Math.floor(lat / CELL), gy = Math.floor(lon / CELL);
    const out = [];
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        const list = grid.get(`${gx + dx}:${gy + dy}`);
        if (!list) continue;
        for (const s of list) {
          const meters = haversineM({ lat, lon }, s);
          if (meters <= radiusM) out.push({ stop: s, meters, walkSec: walkSecondsFor(meters) });
        }
      }
    }
    return out.sort((a, b) => a.meters - b.meters);
  };

  const footCache = new Map();
  const neighbours = (stop) => {
    let list = footCache.get(stop.key);
    if (list) return list;
    list = near(stop.lat, stop.lon, TRANSFER_RADIUS_M).filter((n) => n.stop.key !== stop.key);
    footCache.set(stop.key, list);
    return list;
  };

  return { stops, byKey, near, neighbours };
}

/** Per-service-day query context: active services, trip times, frequencies, route names. */
function makeContext(db, index, ymd, weekday) {
  const servicesCache = new Map();
  const tripsCache = new Map();
  const freqCache = new Map();
  const routeCache = new Map();
  const stats = { stopsExpanded: 0, departureCalls: 0, rowsScanned: 0, ridesLoaded: 0, rideCalls: 0, msDepartures: 0, msRide: 0, msFoot: 0 };

  const stmtStopTimes = db.prepare(
    `SELECT st.trip_id, st.stop_sequence, st.arrival, st.departure,
            t.route_id, t.direction_id, t.headsign, t.service_id
     FROM stop_times st
     JOIN trips t ON t.feed = st.feed AND t.trip_id = st.trip_id
     WHERE st.feed = ? AND st.stop_id = ?`
  );
  const stmtTrip = db.prepare(
    `SELECT stop_id, stop_sequence, arrival, departure
     FROM stop_times WHERE feed = ? AND trip_id = ? ORDER BY stop_sequence`
  );
  const stmtFreq = db.prepare(
    "SELECT start_time, end_time, headway_secs FROM frequencies WHERE feed = ? AND trip_id = ?"
  );
  const stmtRoute = db.prepare(
    "SELECT short_name, long_name, route_type FROM routes WHERE feed = ? AND route_id = ?"
  );

  const servicesFor = (feed) => {
    if (!servicesCache.has(feed)) servicesCache.set(feed, activeServices(db, feed, ymd, weekday));
    return servicesCache.get(feed);
  };

  const tripTimes = (feed, tripId) => {
    const key = `${feed}|${tripId}`;
    let times = tripsCache.get(key);
    if (!times) {
      times = stmtTrip.all(feed, tripId).map((t) => ({
        stopId: t.stop_id,
        seq: t.stop_sequence,
        arr: sec(t.arrival),
        dep: sec(t.departure),
      }));
      tripsCache.set(key, times);
    }
    return times;
  };

  const freqsFor = (feed, tripId) => {
    const key = `${feed}|${tripId}`;
    let freqs = freqCache.get(key);
    if (!freqs) {
      freqs = stmtFreq.all(feed, tripId).map((f) => ({
        start: sec(f.start_time), end: sec(f.end_time), step: f.headway_secs,
      }));
      freqCache.set(key, freqs);
    }
    return freqs;
  };

  const routeFor = (feed, routeId) => {
    const key = `${feed}|${routeId}`;
    let route = routeCache.get(key);
    if (route === undefined) {
      route = stmtRoute.get(feed, routeId) ?? null;
      routeCache.set(key, route);
    }
    return route;
  };

  /**
   * Earliest vehicle departure per (route, direction, headsign) from one stop at or
   * after `boardSec`. Grouping by line keeps the search cheap and matches RAPTOR's
   * "board the first vehicle of each line" rule.
   */
  const earliestDepartures = (stop, boardSec) => {
    stats.stopsExpanded++;
    const t0 = performance.now();
    const services = servicesFor(stop.feed);
    if (!services.size) return [];
    const rows = stmtStopTimes.all(stop.feed, stop.id);
    stats.departureCalls++;
    stats.rowsScanned += rows.length;
    const best = new Map();

    for (const row of rows) {
      if (!services.has(row.service_id)) continue;
      const dep = sec(row.departure);
      if (dep == null) continue;
      const freqs = freqsFor(stop.feed, row.trip_id);
      let next = null;
      if (freqs.length) {
        const times = tripTimes(stop.feed, row.trip_id);
        const first = times.length ? times[0].dep : null;
        if (first == null) continue;
        const offset = dep - first;
        for (const f of freqs) {
          if (f.start == null || f.end == null || !f.step) continue;
          const k = Math.max(0, Math.ceil((boardSec - offset - f.start) / f.step));
          const candidate = f.start + k * f.step;
          if (candidate <= f.end && (next == null || candidate + offset < next)) next = candidate + offset;
        }
      } else if (dep >= boardSec) {
        next = dep;
      }
      if (next == null) continue;

      const key = `${row.route_id}|${row.direction_id}|${row.headsign ?? ""}`;
      const prev = best.get(key);
      if (!prev || next < prev.dep) {
        best.set(key, {
          feed: stop.feed,
          tripId: row.trip_id,
          seq: row.stop_sequence,
          dep: next,
          routeId: row.route_id,
          directionId: row.direction_id,
          headsign: row.headsign,
        });
      }
    }
    stats.msDepartures += performance.now() - t0;
    return [...best.values()];
  };

  /**
   * All stops after the boarding stop on that exact trip, with the actual clock
   * times (frequency templates shifted by the chosen departure).
   */
  const rideFrom = (board) => {
    stats.rideCalls++;
    const t0 = performance.now();
    const times = tripTimes(board.feed, board.tripId);
    if (!times.length) stats.ridesLoaded++;
    const idx = times.findIndex((t) => t.seq === board.seq);
    if (idx < 0) return [];
    const shift = board.dep - times[idx].dep;
    const out = [];
    for (let i = idx; i < times.length; i++) {
      const t = times[i];
      const stop = index.byKey.get(`${board.feed}|${t.stopId}`);
      if (!stop) continue;
      out.push({
        stop,
        arr: (t.arr ?? t.dep) + shift,
        dep: t.dep == null ? null : t.dep + shift,
        seq: t.seq,
      });
    }
    stats.msRide += performance.now() - t0;
    return out;
  };

  return { ymd, weekday, servicesFor, tripTimes, earliestDepartures, rideFrom, routeFor, stats };
}

/**
 * Plan a journey from one coordinate to another.
 *
 * @param db   open DatabaseSync handle
 * @param opts.from/to   {lat, lon, name?}
 * @param opts.atSec     departure time in seconds (defaults to now, KL)
 * @param opts.maxRounds vehicles allowed (1 = direct, 2 = one transfer, ...)
 */
export function planJourney(db, { from, to, atSec, maxRounds = 3, index }) {
  const idx = index ?? buildIndex(db);
  const now = atSec ?? klNow().seconds;
  const kl = klNow();

  const dates = [{ ymd: kl.ymd, weekday: kl.weekday, dayOffset: 0 }];
  if (now < SERVICE_DAY_CUTOFF) {
    dates.unshift({ ...dayBefore(kl.ymd), dayOffset: 86400 });
  }

  let best = null;
  for (const date of dates) {
    const startSec = now + date.dayOffset;
    const result = runRaptor(db, idx, {
      from, to, startSec, maxRounds, ymd: date.ymd, weekday: date.weekday, dayOffset: date.dayOffset,
    });
    if (result && (!best || result.arrive < best.arrive)) best = result;
  }
  return best;
}

function runRaptor(db, index, { from, to, startSec, maxRounds, ymd, weekday, dayOffset }) {
  const ctx = makeContext(db, index, ymd, weekday);
  const labels = new Map();
  const directM = haversineM(from, to);
  // Only stops near the straight line are worth expanding. A route that wanders far
  // off the line is a detour a rider would not take; this keeps the search city-sized.
  const corridorM = Math.max(8000, directM * 0.35);
  const offCorridor = (stop) => {
    if (directM < 1500) return false;
    const ax = from.lon, ay = from.lat, bx = to.lon, by = to.lat;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((stop.lon - ax) * dx + (stop.lat - ay) * dy) / (dx * dx + dy * dy)));
    return haversineM(stop, { lat: ay + t * dy, lon: ax + t * dx }) > corridorM;
  };

  const originStops = index.near(from.lat, from.lon, ACCESS_RADIUS_M);
  if (!originStops.length) return null;
  for (const o of originStops) {
    const arr = startSec + o.walkSec;
    labels.set(o.stop.key, {
      stop: o.stop, arr, round: 0,
      parent: { type: "walk", prev: null, to: o.stop, meters: o.meters, secs: o.walkSec },
    });
  }

  let frontier = [...labels.values()];

  for (let round = 1; round <= maxRounds && frontier.length; round++) {
    const improved = new Map();
    const riddenThisRound = new Set();
    frontier.sort((a, b) => a.arr - b.arr);

    for (const label of frontier) {
      const boardSec = label.arr + (round > 1 ? TRANSFER_PENALTY_SEC : 0);
      for (const departure of ctx.earliestDepartures(label.stop, boardSec)) {
        // Riding a trip again in the same round can only arrive later at every
        // downstream stop than the first boarding already did.
        const tripKey = `${departure.feed}|${departure.tripId}`;
        if (riddenThisRound.has(tripKey)) continue;
        riddenThisRound.add(tripKey);
        const ride = ctx.rideFrom(departure);
        for (let i = 1; i < ride.length; i++) {
          const call = ride[i];
          if (offCorridor(call.stop)) continue;
          const current = labels.get(call.stop.key);
          if (current && current.arr <= call.arr) continue;
          const parent = {
            type: "ride", prev: label, feed: departure.feed,
            tripId: departure.tripId, routeId: departure.routeId,
            headsign: departure.headsign, dep: ride[0].dep ?? departure.dep,
            arr: call.arr, path: ride, toIdx: i,
          };
          const next = { stop: call.stop, arr: call.arr, round, parent };
          labels.set(call.stop.key, next);
          const known = improved.get(call.stop.key);
          if (!known || call.arr < known.arr) improved.set(call.stop.key, next);
        }
      }
    }

    // Footpaths between nearby stops (different platforms, same interchange).
    // These stay in this round and are boarded in the next one.
    for (const label of [...improved.values()]) {
      for (const nb of index.neighbours(label.stop)) {
        if (offCorridor(nb.stop)) continue;
        const arr = label.arr + nb.walkSec;
        const current = labels.get(nb.stop.key);
        if (current && current.arr <= arr) continue;
        const next = {
          stop: nb.stop, arr, round,
          parent: { type: "foot", prev: label, to: nb.stop, meters: nb.meters, secs: nb.walkSec },
        };
        labels.set(nb.stop.key, next);
        const known = improved.get(nb.stop.key);
        if (!known || arr < known.arr) improved.set(nb.stop.key, next);
      }
    }

    frontier = [...improved.values()];
  }

  // Destination: any stop within walking range, plus the last mile.
  let target = null;
  for (const d of index.near(to.lat, to.lon, ACCESS_RADIUS_M)) {
    const label = labels.get(d.stop.key);
    if (!label) continue;
    const arrive = label.arr + d.walkSec;
    if (!target || arrive < target.arrive) {
      target = { label, arrive, meters: d.meters, walkSec: d.walkSec };
    }
  }
  if (!target) return null;

  // Reconstruct: walk the parent pointers back to the origin.
  const chain = [];
  let cursor = target.label;
  const guard = new Set();
  while (cursor && !guard.has(cursor.stop.key + "@" + cursor.round)) {
    guard.add(cursor.stop.key + "@" + cursor.round);
    chain.push(cursor);
    cursor = cursor.parent?.prev ?? null;
  }
  chain.reverse();

  const legs = [];
  for (const node of chain) {
    const p = node.parent;
    if (!p) continue;
    const start = node.arr - (p.secs ?? (p.arr - p.dep));
    if (p.type === "walk") {
      legs.push({
        kind: "walk",
        start: hhmm(start - dayOffset),
        duration: `${Math.max(1, Math.round(p.secs / 60))} min`,
        title: `Jalan kaki ke ${p.to.name}`,
        subtitle: `${p.to.name} · ${Math.round(p.meters)} m`,
      });
    } else if (p.type === "foot") {
      legs.push({
        kind: "transfer",
        start: hhmm(start - dayOffset),
        duration: `${Math.max(1, Math.round(p.secs / 60))} min`,
        title: `Tukar di ${p.to.name}`,
        subtitle: `${p.to.name} · ${Math.round(p.meters)} m`,
      });
    } else if (p.type === "ride") {
      const route = ctx.routeFor(p.feed, p.routeId);
      const label = route?.short_name || route?.long_name || p.routeId;
      const slice = p.path.slice(0, p.toIdx + 1);
      const stations = slice.map((call, i) => ({
        name: call.stop.name,
        time: hhmm((i === 0 ? call.dep ?? call.arr : call.arr) - dayOffset),
      }));
      legs.push({
        kind: "ride",
        start: hhmm(p.dep - dayOffset),
        duration: `${Math.max(1, Math.round((p.arr - p.dep) / 60))} min`,
        title: `${label} ke ${slice[slice.length - 1].stop.name}`,
        line: lineIdFor(p.feed, p.routeId),
        route: label,
        stations,
        headsign: p.headsign ?? undefined,
        tripId: p.tripId,
        from: p.path[0].stop.name,
        to: slice[slice.length - 1].stop.name,
      });
    }
  }

  const depart = hhmm(startSec - dayOffset);
  const arrive = hhmm(target.arrive - dayOffset);
  const lastArrival = chain.length ? chain[chain.length - 1].arr : startSec;
  if (target.walkSec >= 30) {
    legs.push({
      kind: "walk",
      start: hhmm(lastArrival - dayOffset),
      duration: `${Math.max(1, Math.round(target.walkSec / 60))} min`,
      title: `Jalan kaki ke ${to.name ?? "destinasi"}`,
      subtitle: `${Math.round(target.meters)} m`,
    });
  }
  legs.push({
    kind: "arrive",
    start: arrive,
    duration: "",
    title: `Sampai di ${to.name ?? "destinasi"}`,
    subtitle: "Arrive",
  });
  return {
    origin: from.name ?? `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`,
    destination: to.name ?? `${to.lat.toFixed(4)},${to.lon.toFixed(4)}`,
    depart,
    arrive,
    total_minutes: Math.round((target.arrive - startSec) / 60),
    source: { feed: "router", ingested_at: metaMap(db)["rail:ingested_at"] ?? null },
    legs,
    _debug: {
      rounds: chain.filter((n) => n.parent?.type === "ride").length,
      destinationWalkMeters: Math.round(target.meters),
      stats: ctx.stats,
      rides: chain.filter((n) => n.parent?.type === "ride").map((n) => ({
        round: n.round, tripId: n.parent.tripId, routeId: n.parent.routeId,
        dep: hhmm(n.parent.dep - dayOffset), arr: hhmm(n.parent.arr - dayOffset),
        from: n.parent.path[0].stop.name, to: n.stop.name,
      })),
    },
  };
}
