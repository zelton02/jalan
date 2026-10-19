// Round-based (RAPTOR) journey planner over the SQLite GTFS store.
//
// The search scans precomputed *patterns* — one ordered stop list per
// route+direction — instead of asking SQLite for departures at every reached
// stop. 19k trips collapse into ~650 patterns, so a round is ~650 in-memory
// scans rather than ~1,500 SQL queries over 80k rows.
//
// The response keeps the same leg shape as lib.planDoorToDoor so the client does
// not change when the engine is swapped.
import { activeServices, dayBefore, klNow, hhmm, metaMap, ymdInfo } from "./lib.mjs";

const WALK_SPEED_M_MIN = 75;   // fallback pace when the foot router is unavailable
const DETOUR = 1.3;            // fallback straight line -> street network
export const ACCESS_RADIUS_M = 1200;   // how far we let the rider walk to/from transit
const TRANSFER_RADIUS_M = 350;         // stop-to-stop footpath for transfers
const SERVICE_DAY_CUTOFF = 4 * 3600;   // GTFS service day rolls at 04:00 local

// Minimum time between reaching a stop and the vehicle leaving. The old code only applied a
// penalty on transfers, so a walk that ended the same minute as a departure counted as a catch.
const BOARD_BUFFER_SEC = 90;
const TRANSFER_BASE_SEC = 120;         // same-mode change (platform to platform)
const TRANSFER_MODE_SEC = 240;         // bus <-> rail, usually a different building
const RAIL_FEEDS = new Set(["rail", "ktmb"]);

// Street to platform. GTFS puts a station on one coordinate, so a stop at the station door
// measured 0 m and the planner claimed you could board in one minute. These are the walking
// minutes inside each station, from the entrance to the platform.
const STATION_WALK_SEC = new Map([
  ["rail|KJ15", 600],  // KL Sentral
  ["ktmb|19100", 540], // KL Sentral (KTM side)
  ["rail|SP15", 420],  // Bandar Tasik Selatan
  ["rail|AG3", 300], ["rail|SP3", 300], ["rail|PY17", 300], ["rail|MR11", 300], // Titiwangsa
  ["rail|AG7", 240], ["rail|KJ13", 240], ["rail|SP7", 240],   // Masjid Jamek
  ["rail|KG18A", 240], ["rail|MR6", 240],                     // Bukit Bintang
  ["rail|AG13", 240], ["rail|KG22", 240],                     // Maluri
  ["rail|AG11", 240], ["rail|SP11", 240], ["rail|PY24", 240], // Chan Sow Lin
  ["rail|KJ14", 180], ["rail|KG16", 180],                     // Pasar Seni
  ["rail|KJ10", 180],                                         // KLCC
  ["rail|KJ17", 180], ["ktmb|52700", 180],                    // Abdullah Hukum
]);
const STATION_WALK_DEFAULT_RAIL = 120;

// Extra time to change platforms inside a large interchange, on top of the mode penalty.
const TRANSFER_EXTRA_SEC = new Map([
  ["rail|KJ15", 180], ["ktmb|19100", 180],
  ["rail|SP15", 120], ["rail|PY17", 120], ["rail|AG3", 120],
  ["rail|AG7", 120], ["rail|KJ13", 120],
  ["rail|KG18A", 90], ["rail|AG13", 90], ["rail|AG11", 90],
]);

/** Walking time from the street to the platform (and back out). */
export function stationWalkSec(stop) {
  if (!stop) return 0;
  const exact = STATION_WALK_SEC.get(stop.key);
  if (exact != null) return exact;
  return RAIL_FEEDS.has(stop.feed) ? STATION_WALK_DEFAULT_RAIL : 0;
}

/** Extra walking inside the interchange before you reach the next platform. */
export function transferWalkSec(fromStop, toStop) {
  if (!RAIL_FEEDS.has(toStop?.feed)) return 0;
  return TRANSFER_EXTRA_SEC.get(toStop.key) ?? 30;
}

/** Buffer between reaching the platform and boarding (mode change costs more). */
export function transferPenaltySec(fromStop, toStop) {
  const fromRail = RAIL_FEEDS.has(fromStop?.feed);
  const toRail = RAIL_FEEDS.has(toStop?.feed);
  return fromRail === toRail ? TRANSFER_BASE_SEC : TRANSFER_MODE_SEC;
}


export const haversineM = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export const walkSecondsFor = (meters) => Math.round((meters * DETOUR) / WALK_SPEED_M_MIN * 60);

const cleanName = (name) => (name ?? "").replace(/\s*-\s*REDONE\s*$/i, "").trim();

export const lineIdFor = (feed, routeId) => {
  if (feed === "ktmb") return "ktm";
  if (feed === "rail") {
    if (routeId === "KGL") return "kajang";
    if (routeId === "KJ") return "kelana";
    if (routeId === "AG" || routeId === "PH") return "ampang";
    return undefined;
  }
  return "bus";
};

const toSec = (t) => {
  if (!t) return null;
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

/** Stops, a lat/lon grid, walking distances, and the pattern index. Built once per DB handle. */
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

  const routes = new Map(
    db.prepare("SELECT feed, route_id, short_name, long_name FROM routes")
      .all().map((r) => [`${r.feed}|${r.route_id}`, r])
  );

  const freqs = new Map();
  for (const f of db.prepare(
    "SELECT feed, trip_id, start_time, end_time, headway_secs FROM frequencies"
  ).all()) {
    const key = `${f.feed}|${f.trip_id}`;
    const window = { start: toSec(f.start_time), end: toSec(f.end_time), step: f.headway_secs };
    const list = freqs.get(key);
    if (list) list.push(window);
    else freqs.set(key, [window]);
  }

  const patterns = [];
  const byId = new Map();
  for (const r of db.prepare(
    "SELECT pattern_id, feed, route_id, direction_id, headsign, stops, offsets FROM patterns ORDER BY pattern_id"
  ).all()) {
    const stopIds = JSON.parse(r.stops);
    const offsets = JSON.parse(r.offsets);
    const base = offsets[0][1]; // departure at the first stop
    const pattern = {
      id: r.pattern_id,
      feed: r.feed,
      routeId: r.route_id,
      directionId: r.direction_id,
      headsign: r.headsign,
      stopIds,
      stopKeys: stopIds.map((id) => `${r.feed}|${id}`),
      relArr: offsets.map((o) => o[0] - base),
      relDep: offsets.map((o) => o[1] - base),
      scheduled: [],
      frequency: [],
      route: routes.get(`${r.feed}|${r.route_id}`) ?? null,
    };
    patterns.push(pattern);
    byId.set(pattern.id, pattern);
  }

  for (const t of db.prepare(
    "SELECT pattern_id, feed, trip_id, service_id, first_dep FROM pattern_trips ORDER BY first_dep"
  ).all()) {
    const pattern = byId.get(t.pattern_id);
    if (!pattern) continue;
    const trip = {
      tripId: t.trip_id,
      serviceId: t.service_id,
      firstDep: t.first_dep,
      freq: freqs.get(`${t.feed}|${t.trip_id}`) ?? null,
    };
    (trip.freq ? pattern.frequency : pattern.scheduled).push(trip);
  }

  // stop -> every pattern that calls there, with the position on the pattern
  const patternsAtStop = new Map();
  for (const pattern of patterns) {
    for (let i = 0; i < pattern.stopKeys.length; i++) {
      const key = pattern.stopKeys[i];
      const entry = { pattern, idx: i };
      const list = patternsAtStop.get(key);
      if (list) list.push(entry);
      else patternsAtStop.set(key, [entry]);
    }
  }

  return { stops, byKey, near, neighbours, patterns, patternsAtStop };
}

/** Per-service-day view: only patterns with a trip running today, only those trips. */
function makeContext(db, index, ymd, weekday) {
  const servicesCache = new Map();
  const servicesFor = (feed) => {
    if (!servicesCache.has(feed)) servicesCache.set(feed, activeServices(db, feed, ymd, weekday));
    return servicesCache.get(feed);
  };

  const active = [];
  for (const pattern of index.patterns) {
    const services = servicesFor(pattern.feed);
    if (!services.size) continue;
    const scheduled = pattern.scheduled.filter((t) => services.has(t.serviceId));
    const frequency = pattern.frequency.filter((t) => services.has(t.serviceId));
    if (!scheduled.length && !frequency.length) continue;
    active.push({ pattern, scheduled, frequency });
  }

  const byId = new Map(active.map((entry) => [entry.pattern.id, entry]));
  const stats = { patterns: active.length, candidates: 0, rides: 0 };
  return { servicesFor, active, byId, stats };
}

/** Earliest departure of a pattern at stop index `idx` at or after `boardSec`. */
function earliestDeparture(entry, idx, boardSec) {
  const { pattern, scheduled, frequency } = entry;
  const relDep = pattern.relDep[idx];
  let best = null;

  // Scheduled trips are sorted by first departure: binary search the first usable one.
  let lo = 0, hi = scheduled.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (scheduled[mid].firstDep + relDep < boardSec) lo = mid + 1;
    else hi = mid;
  }
  if (lo < scheduled.length) {
    const trip = scheduled[lo];
    best = { trip, T: trip.firstDep, dep: trip.firstDep + relDep };
  }

  // Frequency templates expand to a departure inside each window.
  for (const trip of frequency) {
    for (const w of trip.freq) {
      if (w.start == null || w.end == null || !w.step) continue;
      const k = Math.max(0, Math.ceil((boardSec - relDep - w.start) / w.step));
      const T = w.start + k * w.step;
      if (T > w.end) continue;
      const dep = T + relDep;
      if (!best || dep < best.dep) best = { trip, T, dep };
    }
  }
  return best;
}

/**
 * Plan a journey from one coordinate to another.
 *
 * @param db   open DatabaseSync handle
 * @param opts.from/to   {lat, lon, name?}
 * @param opts.atSec     departure time in seconds (defaults to now, KL)
 * @param opts.maxRounds vehicles allowed (1 = direct, 2 = one transfer, ...)
 */
export function planJourney(db, { from, to, atSec, date, maxRounds = 3, index, bannedFirstPatterns, originWalks, destWalks }) {
  const idx = index ?? buildIndex(db);
  const now = atSec ?? klNow().seconds;

  let dates;
  if (date) {
    const info = typeof date === "string" ? ymdInfo(date) : date;
    if (!info) throw new Error(`bad date: ${date}`);
    // A trip before 04:00 belongs to the previous service day; shift the absolute clock by a
    // day so it still sorts after the previous evening's trips.
    dates = now < SERVICE_DAY_CUTOFF
      ? [{ ...dayBefore(info.ymd), dayOffset: 86400 }]
      : [{ ...info, dayOffset: 0 }];
  } else {
    const kl = klNow();
    dates = [{ ymd: kl.ymd, weekday: kl.weekday, dayOffset: 0 }];
    if (now < SERVICE_DAY_CUTOFF) dates.unshift({ ...dayBefore(kl.ymd), dayOffset: 86400 });
  }

  let best = null;
  for (const date of dates) {
    const startSec = now + date.dayOffset;
    const result = runRaptor(db, idx, {
      from, to, startSec, maxRounds, ymd: date.ymd, weekday: date.weekday, dayOffset: date.dayOffset,
      banned: bannedFirstPatterns, originWalks, destWalks,
    });
    // Compare numeric arrivals; "00:10" sorts after "23:50" as a string.
    if (result && (!best || result._arrive < best._arrive)) best = result;
  }
  if (best) {
    const ymd = best._ymd;
    delete best._arrive;
    delete best._ymd;
    // The client needs to know which service day won (a 01:00 trip belongs to yesterday).
    best.date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return best;
}

/**
 * Up to `count` itineraries, each forced to start on a different first vehicle.
 * Alternatives that arrive more than `maxExtraMinutes` later than the best are dropped.
 */
export function planAlternatives(db, opts, { count = 3, maxExtraMinutes = 45 } = {}) {
  const index = opts.index ?? buildIndex(db);
  const plans = [];
  const banned = new Set();

  for (let i = 0; i < count; i++) {
    const plan = planJourney(db, { ...opts, index, bannedFirstPatterns: banned });
    if (!plan) break;

    const signature = plan.legs
      .filter((leg) => leg.kind === "ride")
      .map((leg) => `${leg.route}|${leg.from}|${leg.to}`)
      .join(">");
    if (plans.some((p) => p._signature === signature)) break;
    plan._signature = signature;
    plans.push(plan);

    const first = plan._debug.rides[0]?.patternId;
    if (first == null || banned.has(first)) break;
    banned.add(first);
  }

  const best = plans[0];
  return plans
    .filter((plan, i) => i === 0 || plan.total_minutes - best.total_minutes <= maxExtraMinutes)
    .map((plan) => {
      delete plan._signature;
      return plan;
    });
}

function runRaptor(db, index, { from, to, startSec, maxRounds, ymd, weekday, dayOffset, banned, originWalks, destWalks }) {
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
    const routed = originWalks?.get(o.stop.key);
    const walkSec = (routed?.sec ?? o.walkSec) + stationWalkSec(o.stop);
    const arr = startSec + walkSec;
    labels.set(o.stop.key, {
      stop: o.stop, arr, round: 0,
      boardPenalty: BOARD_BUFFER_SEC,
      parent: { type: "walk", prev: null, to: o.stop, meters: routed?.m ?? o.meters, secs: walkSec },
    });
  }

  let frontier = [...labels.values()];

  for (let round = 1; round <= maxRounds && frontier.length; round++) {
    const improved = new Map();
    const ridden = new Map(); // pattern|trip|T -> lowest boarding index already expanded
    frontier.sort((a, b) => a.arr - b.arr);

    for (const label of frontier) {
      const at = index.patternsAtStop.get(label.stop.key);
      if (!at) continue;
      const boardSec = label.arr + (label.boardPenalty ?? BOARD_BUFFER_SEC);

      for (const { pattern, idx } of at) {
        if (banned?.has(pattern.id)) continue;
        const entry = ctx.byId.get(pattern.id);
        if (!entry) continue;
        const best = earliestDeparture(entry, idx, boardSec);
        if (!best) continue;
        ctx.stats.candidates++;

        // Boarding the same vehicle again further along only arrives later; boarding
        // it earlier covers more stops. Re-ride only when a lower index shows up.
        const rideKey = `${pattern.id}|${best.trip.tripId}|${best.T}`;
        const seen = ridden.get(rideKey);
        if (seen != null && seen <= idx) continue;
        ridden.set(rideKey, idx);
        ctx.stats.rides++;

        for (let j = idx + 1; j < pattern.stopKeys.length; j++) {
          const stopKey = pattern.stopKeys[j];
          const stop = index.byKey.get(stopKey);
          if (!stop || offCorridor(stop)) continue;
          const arr = best.T + pattern.relArr[j];
          const current = labels.get(stopKey);
          if (current && current.arr <= arr) continue;
          const next = {
            stop, arr, round,
            parent: {
              type: "ride",
              prev: label,
              pattern,
              tripId: best.trip.tripId,
              T: best.T,
              fromIdx: idx,
              toIdx: j,
              dep: best.dep,
              arr,
            },
          };
          labels.set(stopKey, next);
          const known = improved.get(stopKey);
          if (!known || arr < known.arr) improved.set(stopKey, next);
        }
      }
    }

    // Footpaths between nearby stops (different platforms, same interchange).
    // These stay in this round and are boarded in the next one.
    for (const label of [...improved.values()]) {
      for (const nb of index.neighbours(label.stop)) {
        if (offCorridor(nb.stop)) continue;
        const innerWalk = transferWalkSec(label.stop, nb.stop);
        const arr = label.arr + nb.walkSec + innerWalk;
        const current = labels.get(nb.stop.key);
        if (current && current.arr <= arr) continue;
        const next = {
          stop: nb.stop, arr, round,
          boardPenalty: BOARD_BUFFER_SEC + transferPenaltySec(label.stop, nb.stop),
          parent: { type: "foot", prev: label, to: nb.stop, meters: nb.meters, secs: nb.walkSec + innerWalk },
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
    const routed = destWalks?.get(d.stop.key);
    const walkSec = (routed?.sec ?? d.walkSec) + stationWalkSec(d.stop);
    const arrive = label.arr + walkSec;
    if (!target || arrive < target.arrive) {
      target = { label, arrive, meters: routed?.m ?? d.meters, walkSec };
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
  let lastRide = null;
  for (const node of chain) {
    const p = node.parent;
    if (!p) continue;
    const start = p.type === "ride" ? p.dep : node.arr - p.secs;
    if (p.type === "walk") {
      lastRide = null;
      legs.push({
        kind: "walk",
        start: hhmm(start - dayOffset),
        duration: `${Math.max(1, Math.round(p.secs / 60))} min`,
        title: `Jalan kaki ke ${p.to.name}`,
        subtitle: `${p.to.name} · ${Math.round(p.meters)} m`,
      });
    } else if (p.type === "foot") {
      lastRide = null;
      legs.push({
        kind: "transfer",
        start: hhmm(start - dayOffset),
        duration: `${Math.max(1, Math.round(p.secs / 60))} min`,
        title: `Tukar di ${p.to.name}`,
        subtitle: `${p.to.name} · ${Math.round(p.meters)} m`,
      });
    } else if (p.type === "ride") {
      const routeLabel = p.pattern.route?.short_name || p.pattern.route?.long_name || p.pattern.routeId;
      const stations = [];
      for (let j = p.fromIdx; j <= p.toIdx; j++) {
        const name = index.byKey.get(p.pattern.stopKeys[j])?.name ?? p.pattern.stopIds[j];
        const rel = j === p.fromIdx ? p.pattern.relDep[j] : p.pattern.relArr[j];
        stations.push({ name, time: hhmm(p.T + rel - dayOffset) });
      }

      // The same route can be split into two trips at a terminal (loop services do
      // this constantly). If the rider stays on the same line at the same stop, show
      // one leg with the wait, not two "board" steps.
      const gap = lastRide ? p.dep - lastRide.arr : Infinity;
      if (lastRide && lastRide.routeId === p.pattern.routeId && lastRide.to === stations[0].name && gap >= 0 && gap <= 15 * 60) {
        const leg = lastRide.leg;
        leg.stations.push(...stations.slice(1));
        leg.duration = `${Math.max(1, Math.round((p.arr - lastRide.dep) / 60))} min`;
        leg.title = `${routeLabel} ke ${stations[stations.length - 1].name}`;
        leg.to = stations[stations.length - 1].name;
        if (gap >= 60) leg.subtitle = `Sambung di ${stations[0].name} · tunggu ${Math.round(gap / 60)} min`;
        lastRide.arr = p.arr;
        lastRide.to = leg.to;
        continue;
      }

      const leg = {
        kind: "ride",
        start: hhmm(p.dep - dayOffset),
        duration: `${Math.max(1, Math.round((p.arr - p.dep) / 60))} min`,
        title: `${routeLabel} ke ${stations[stations.length - 1].name}`,
        line: lineIdFor(p.pattern.feed, p.pattern.routeId),
        route: routeLabel,
        routeId: p.pattern.routeId,
        feed: p.pattern.feed,
        stations,
        headsign: p.pattern.headsign ?? undefined,
        tripId: p.tripId,
        from: stations[0].name,
        to: stations[stations.length - 1].name,
      };
      legs.push(leg);
      lastRide = { leg, route: routeLabel, routeId: p.pattern.routeId, to: leg.to, arr: p.arr, dep: p.dep };
    }
  }

  const depart = hhmm(startSec - dayOffset);
  const arrive = hhmm(target.arrive - dayOffset);
  // Match the clock labels: both ends are floored to the minute when displayed, so the
  // duration must be their difference or "13:34 → 14:31" reads 57 while the chip says 56.
  const totalMinutes = Math.max(1, Math.floor(target.arrive / 60) - Math.floor(startSec / 60));
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
    total_minutes: totalMinutes,
    source: { feed: "router", ingested_at: metaMap(db)["rail:ingested_at"] ?? null },
    legs,
    _arrive: target.arrive,
    _ymd: ymd,
    _debug: {
      rounds: chain.filter((n) => n.parent?.type === "ride").length,
      destinationWalkMeters: Math.round(target.meters),
      stats: ctx.stats,
      rides: chain.filter((n) => n.parent?.type === "ride").map((n) => ({
        round: n.round,
        patternId: n.parent.pattern.id,
        tripId: n.parent.tripId,
        routeId: n.parent.pattern.routeId,
        dep: hhmm(n.parent.dep - dayOffset),
        arr: hhmm(n.parent.arr - dayOffset),
        from: index.byKey.get(n.parent.pattern.stopKeys[n.parent.fromIdx])?.name,
        to: n.stop.name,
      })),
    },
  };
}
