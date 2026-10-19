#!/usr/bin/env node
/**
 * Read-only API for the app. Run beside `vite dev` (vite proxies /api here).
 *
 *   node ingest/api.mjs            # http://127.0.0.1:8795
 *   node ingest/api.mjs --at 17:00 # pin the clock for demos/tests
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/stops?q=UTAR                 -> stop search for the board
 *   GET /api/departures?stop=bus|1000383  -> next departures at a stop
 *   GET /api/live?route=U5900             -> vehicles + inferred delay
 *   GET /api/punctuality?route=U5900      -> median delay by hour from history
 *   GET /api/plan                        -> Sungai Long -> KL Sentral (default demo trip)
 *   GET /api/plan?from=Sungai+Long&to=KL+Sentral
 *   GET /api/plan?from=3.04,101.80&to=3.13,101.68&at=08:00&rounds=3
 */
import { createServer } from "node:http";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, metaMap, klNow, ymdInfo, hhmm } from "./lib.mjs";
import { buildIndex, planJourney, planAlternatives, ACCESS_RADIUS_M, haversineM } from "./router.mjs";
import { geocode, suggestPlaces } from "./geocode.mjs";
import { googleEnabled, autocompletePlaces, placeById, geocodeWithGoogle } from "./google.mjs";
import { walkMatrix, walkRoute } from "./walk.mjs";
import { liveStatus } from "./live.mjs";
import { searchStops, nextDepartures } from "./board.mjs";
import { routePunctuality } from "./punctuality.mjs";

const argv = process.argv.slice(2);
const atIdx = argv.indexOf("--at");
const atArg = atIdx >= 0 ? argv[atIdx + 1] : null;
const pinned = atArg ? (() => { const [h, m] = atArg.split(":").map(Number); return h * 3600 + m * 60; })() : null;

const DB_PATH = resolve("data/jalan.db");
let db, dbMtime, index;
let coverage = [];
let coverageMax = null;

function load() {
  db = openDb(DB_PATH);
  dbMtime = statSync(DB_PATH).mtimeMs;
  index = buildIndex(db);
  coverage = db.prepare(
    "SELECT feed, MIN(start_date) mn, MAX(end_date) mx FROM calendar GROUP BY feed"
  ).all().map((r) => ({ feed: r.feed, min: r.mn, max: r.mx }));
  coverageMax = coverage.reduce((m, c) => (c.max > m ? c.max : m), "");
}
load();

const planCache = new Map();
const placeCache = new Map();

/** Pick up a freshly swapped DB without restarting the process. */
function freshen() {
  const mtime = statSync(DB_PATH).mtimeMs;
  if (mtime === dbMtime) return db;
  try { db.close(); } catch {}
  load();
  planCache.clear();
  console.log(`[api] reloaded db + index (${new Date().toISOString()})`);
  return db;
}

/** If a request races the swap, reopen once and retry. */
function withDb(fn) {
  try {
    return fn(freshen());
  } catch (error) {
    try { db.close(); } catch {}
    load();
    return fn(db);
  }
}

const PORT = Number(process.env.PORT || 8795);
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

const parseHHMM = (value) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null;
};

const dash = (ymd) => (ymd ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : null);

/**
 * `at=2026-10-20T07:00` (datetime-local), `date=2026-10-20&at=07:00`, or `at=07:00` (today,
 * used as a demo clock). With nothing, fall back to the server-level --at pin or now.
 */
function parseWhen(params) {
  const atRaw = params.get("at");
  const dateRaw = params.get("date");

  if (atRaw && atRaw.includes("T")) {
    const [d, t] = atRaw.split("T");
    const info = ymdInfo(d);
    const atSec = parseHHMM(t);
    if (!info) return { error: "Format tarikh salah. / Bad date." };
    if (atSec == null) return { error: "Format masa salah. / Bad time." };
    return { date: info.ymd, atSec };
  }
  if (dateRaw) {
    const info = ymdInfo(dateRaw);
    if (!info) return { error: "Format tarikh salah. / Bad date." };
    const atSec = atRaw ? parseHHMM(atRaw) : pinned;
    if (atRaw && atSec == null) return { error: "Format masa salah. / Bad time." };
    return { date: info.ymd, atSec };
  }
  if (atRaw) {
    const atSec = parseHHMM(atRaw);
    if (atSec == null) return { error: "Format masa salah. / Bad time." };
    return { date: null, atSec };
  }
  return { date: null, atSec: pinned };
}

function checkDate(ymd) {
  if (!ymd) return null;
  if (ymd < klNow().ymd) return "Tarikh sudah lepas. / That date has passed.";
  if (coverageMax && ymd > coverageMax) {
    return `Data jadual hanya sampai ${dash(coverageMax)}. / Timetable data ends ${dash(coverageMax)}.`;
  }
  return null;
}

// A trip can still be planned when one feed has no calendar rows for the date, but the result
// is incomplete (e.g. rail absent -> a bus-only route that looks slower for no visible reason).
const CORE_FEEDS = ["bus", "rail", "mrtfeeder"];
function coverageWarning(ymd) {
  if (!ymd) return null;
  const missing = coverage
    .filter((c) => CORE_FEEDS.includes(c.feed) && (ymd < c.min || ymd > c.max))
    .map((c) => c.feed);
  return missing.length
    ? `Jadual ${missing.join(", ")} tiada untuk tarikh ini — laluan mungkin tidak lengkap. / No ${missing.join(", ")} timetable for this date.`
    : null;
}

const DEFAULT_FROM = { lat: 3.041707, lon: 101.80142, name: "Sungai Long" };
const DEFAULT_TO = { lat: 3.13442, lon: 101.68625, name: "KL Sentral" };

/**
 * Attach live route status to ride legs at response time, never inside the plan cache: the
 * cached itinerary is a schedule fact, the live number is only true for ~a minute.
 */
function withLive(payload) {
  const live = liveStatus();
  if (!live.updated_at) return payload;

  const decorate = (plan) => {
    const legs = plan.legs.map((leg) => {
      if (leg.kind !== "ride" || !leg.routeId) return leg;
      const status = live.routes[leg.routeId];
      if (!status) return leg;
      return {
        ...leg,
        live: {
          vehicles: status.vehicles,
          delay_min: status.median_delay_min,
          updated_at: live.updated_at,
          feed: status.feed,
        },
      };
    });
    return { ...plan, legs };
  };

  return payload.plans
    ? { ...payload, plans: payload.plans.map(decorate) }
    : decorate(payload);
}

/** OSRM footpath geometry for the walking legs, so the map draws the real path. */
async function attachWalkGeometry(plans) {
  const jobs = [];
  for (const plan of plans) {
    for (const leg of plan.legs) {
      if (leg.kind !== "walk" && leg.kind !== "transfer") continue;
      if (!leg.from_point || !leg.to_point) continue;
      const from = { lat: leg.from_point[0], lon: leg.from_point[1] };
      const to = { lat: leg.to_point[0], lon: leg.to_point[1] };
      jobs.push(
        walkRoute(from, to)
          .then((route) => {
            if (route?.polyline) leg.polyline = route.polyline;
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
}

/** "3.04,101.80" is used as-is; anything else goes through the cached geocoder. */
async function resolvePlace(value, fallback, nameOverride) {
  if (!value) return fallback;
  const text = value.trim();
  const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), name: nameOverride || text };

  const key = text.toLowerCase();
  if (placeCache.has(key)) {
    const hit = placeCache.get(key);
    return nameOverride ? { ...hit, name: nameOverride } : hit;
  }
  const hit = (googleEnabled() ? await geocodeWithGoogle(text) : null) ?? (await geocode(text));
  if (!hit) return null;
  const place = { lat: hit.lat, lon: hit.lon, name: hit.name };
  placeCache.set(key, place);
  return nameOverride ? { ...place, name: nameOverride } : place;
}

async function handlePlan(url, res, mode = "plan") {
  const from = await resolvePlace(url.searchParams.get("from"), DEFAULT_FROM, url.searchParams.get("fromName"));
  const to = await resolvePlace(url.searchParams.get("to"), DEFAULT_TO, url.searchParams.get("toName"));
  if (!from) return json(res, 404, { error: "Lokasi asal tidak dijumpai. / Origin not found." });
  if (!to) return json(res, 404, { error: "Destinasi tidak dijumpai. / Destination not found." });

  const when = parseWhen(url.searchParams);
  if (when.error) return json(res, 400, { error: when.error });
  const dateError = checkDate(when.date);
  if (dateError) return json(res, 400, { error: dateError });

  const atSec = when.atSec ?? undefined;
  const rounds = Math.min(5, Math.max(1, Number(url.searchParams.get("rounds") ?? 3) || 3));
  const count = Math.min(3, Math.max(1, Number(url.searchParams.get("count") ?? 3) || 3));

  const key = `${mode}|${from.lat},${from.lon}|${to.lat},${to.lon}|${when.date ?? "auto"}|${atSec ?? "live"}|${rounds}|${mode === "plans" ? count : 1}|${dbMtime}`;
  const cached = planCache.get(key);
  // A live plan goes stale within minutes; only a pinned clock is safe to keep.
  const fresh = cached && (atSec != null || Date.now() - cached.at < 30_000);
  if (fresh) return json(res, 200, withLive(cached.payload));

  let plans;
  freshen();
  // Real footpaths for the first and last mile. Two matrix calls; an empty map means OSRM is
  // down and the router falls back to straight-line x 1.3.
  const originWalks = await walkMatrix(from, index.near(from.lat, from.lon, ACCESS_RADIUS_M).map((o) => o.stop));
  const destWalks = await walkMatrix(to, index.near(to.lat, to.lon, ACCESS_RADIUS_M).map((o) => o.stop));

  if (mode === "plans") {
    plans = withDb((current) => planAlternatives(
      current, { from, to, atSec, date: when.date, maxRounds: rounds, index, originWalks, destWalks }, { count }
    ));
  } else {
    const one = withDb((current) => planJourney(current, { from, to, atSec, date: when.date, maxRounds: rounds, index, originWalks, destWalks }));
    plans = one ? [one] : [];
  }
  if (!plans.length) {
    return json(res, 404, { error: "Tiada laluan pada waktu ini. / No route at this time." });
  }

  await attachWalkGeometry(plans);

  const clock = when.date
    ? `scheduled ${dash(when.date)}${atSec != null ? ` ${hhmm(atSec)}` : ""}`
    : atSec != null ? `pinned ${hhmm(atSec)}` : "live";
  const warning = coverageWarning(when.date);
  const clean = plans.map(({ _debug, ...rest }) => rest);
  const payload = mode === "plans"
    ? {
        plans: clean.map((plan) => ({ ...plan, clock, ...(warning ? { warning } : {}) })),
        clock,
        ...(warning ? { warning } : {}),
      }
    : { ...clean[0], clock, ...(warning ? { warning } : {}) };
  planCache.set(key, { payload, at: Date.now() });
  if (planCache.size > 200) planCache.delete(planCache.keys().next().value);
  json(res, 200, withLive(payload));
}

// Warm the JIT and the per-day caches so the first real request is not ~1s slower.
try {
  const started = performance.now();
  planJourney(db, { from: DEFAULT_FROM, to: DEFAULT_TO, atSec: 8 * 3600, index });
  console.log(`[api] warmup ${Math.round(performance.now() - started)} ms`);
} catch (error) {
  console.error("[api] warmup failed:", error.message);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        feeds: metaMap(freshen())["rail:ingested_at"] ? "loaded" : "missing",
        stops: index.stops.length,
      });
    }
    if (url.pathname === "/api/live") {
      const live = liveStatus();
      if (!live.updated_at) {
        return json(res, 503, { error: "Tiada data langsung. / No live data.", ...live });
      }
      const route = url.searchParams.get("route");
      if (route) {
        const hit = live.routes[route];
        if (!hit) {
          return json(res, 404, {
            error: `Tiada kenderaan langsung untuk ${route}. / No live vehicle on ${route}.`,
            updated_at: live.updated_at,
          });
        }
        return json(res, 200, { updated_at: live.updated_at, ...hit });
      }
      return json(res, 200, live);
    }
    if (url.pathname === "/api/suggest") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return json(res, 200, { q, stops: [], places: [] });
      freshen();
      const lat = Number.parseFloat(url.searchParams.get("lat") ?? "");
      const lon = Number.parseFloat(url.searchParams.get("lon") ?? "");
      const here = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      const dist = (p) => (here ? Math.round(haversineM(here, p)) : null);

      // One station can appear several times (KG09 + SA1 at Bandar Utama); same name within
      // 500 m is one answer.
      const stops = [];
      for (const stop of searchStops(index, q, 20, here)) {
        const dup = stops.some((s) => s.name.toLowerCase() === stop.name.toLowerCase() && haversineM(s, stop) < 500);
        if (dup) continue;
        stops.push({ ...stop, distance_m: dist(stop) });
        if (stops.length >= 5) break;
      }

      // Places come from Nominatim and cost a rate-limited request, so the client asks for them
      // in a second call and shows the stops immediately.
      let places = [];
      if (url.searchParams.get("places") === "1") {
        if (googleEnabled()) {
          const session = url.searchParams.get("session") ?? null;
          places = (await autocompletePlaces(q, { at: here, limit: 5, session })).map((place) => ({
            place_id: place.placeId,
            name: place.name,
            display: place.address,
            lat: null,
            lon: null,
            distance_m: null,
          }));
        } else {
          places = (await suggestPlaces(q, 8))
            .map((place) => ({ ...place, distance_m: dist(place) }))
            .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
          const near = places.filter((place) => place.distance_m != null && place.distance_m <= 150_000);
          places = (near.length >= 2 ? near : places).slice(0, 4);
        }
      }
      return json(res, 200, { q, stops, places });
    }
    if (url.pathname === "/api/vehicles") {
      const wanted = (url.searchParams.get("routes") ?? "")
        .split(",")
        .map((route) => route.trim())
        .filter(Boolean);
      const live = liveStatus();
      if (!live.updated_at) return json(res, 200, { updated_at: null, vehicles: [] });
      const vehicles = [];
      for (const [id, bucket] of Object.entries(live.routes)) {
        if (wanted.length && !wanted.includes(id)) continue;
        for (const v of bucket.list) {
          if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
          vehicles.push({ route: id, label: bucket.label, feed: bucket.feed, ...v });
        }
      }
      return json(res, 200, { updated_at: live.updated_at, vehicles });
    }
    if (url.pathname === "/api/place") {
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { error: "id diperlukan. / id is required." });
      const place = await placeById(id);
      return place
        ? json(res, 200, place)
        : json(res, 404, { error: "Tempat tidak dijumpai. / Place not found." });
    }
    if (url.pathname === "/api/stops") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 8) || 8));
      return json(res, 200, { stops: searchStops(index, q, limit) });
    }
    if (url.pathname === "/api/departures") {
      const stopKey = url.searchParams.get("stop");
      if (!stopKey) return json(res, 400, { error: "stop diperlukan. / stop is required." });
      freshen();
      if (!index.patternsAtStop.has(stopKey)) {
        return json(res, 404, { error: "Hentian tidak dijumpai. / Stop not found." });
      }
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 8) || 8));
      const board = nextDepartures(db, index, stopKey, { limit });
      const live = liveStatus();
      const departures = board.departures.map((d) => {
        const status = live.routes[d.routeId];
        return status
          ? { ...d, live: { delay_min: status.median_delay_min, vehicles: status.vehicles } }
          : d;
      });
      const stop = index.byKey.get(stopKey);
      return json(res, 200, {
        stop: {
          key: stopKey,
          name: stop?.name ?? stopKey,
          feed: stop?.feed ?? null,
          lat: stop?.lat ?? null,
          lon: stop?.lon ?? null,
        },
        date: board.date,
        at: board.at,
        updated_at: live.updated_at,
        departures,
      });
    }
    if (url.pathname === "/api/punctuality") {
      const route = url.searchParams.get("route");
      if (!route) return json(res, 400, { error: "route diperlukan. / route is required." });
      const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days") ?? 14) || 14));
      const data = routePunctuality(route, { days });
      // No history yet is a normal answer for an optional enrichment, not a 404.
      return json(res, 200, { ...data, available: Boolean(data.samples) });
    }
    if (url.pathname === "/api/plan") return await handlePlan(url, res, "plan");
    if (url.pathname === "/api/plans") return await handlePlan(url, res, "plans");
    json(res, 404, { error: "not found" });
  } catch (error) {
    console.error("[api]", error);
    json(res, 500, { error: "internal error" });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`jalan api on http://127.0.0.1:${PORT}${pinned ? ` (clock pinned to ${atArg})` : ""}`);
});
