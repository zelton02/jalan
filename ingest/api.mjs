#!/usr/bin/env node
/**
 * Read-only API for the app. Run beside `vite dev` (vite proxies /api here).
 *
 *   node ingest/api.mjs            # http://127.0.0.1:8795
 *   node ingest/api.mjs --at 17:00 # pin the clock for demos/tests
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/plan                        -> Sungai Long -> KL Sentral (default demo trip)
 *   GET /api/plan?from=Sungai+Long&to=KL+Sentral
 *   GET /api/plan?from=3.04,101.80&to=3.13,101.68&at=08:00&rounds=3
 */
import { createServer } from "node:http";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, metaMap } from "./lib.mjs";
import { buildIndex, planJourney, planAlternatives } from "./router.mjs";
import { geocode } from "./geocode.mjs";

const argv = process.argv.slice(2);
const atIdx = argv.indexOf("--at");
const atArg = atIdx >= 0 ? argv[atIdx + 1] : null;
const pinned = atArg ? (() => { const [h, m] = atArg.split(":").map(Number); return h * 3600 + m * 60; })() : null;

const DB_PATH = resolve("data/jalan.db");
let db, dbMtime, index;

function load() {
  db = openDb(DB_PATH);
  dbMtime = statSync(DB_PATH).mtimeMs;
  index = buildIndex(db);
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

const DEFAULT_FROM = { lat: 3.041707, lon: 101.80142, name: "Sungai Long" };
const DEFAULT_TO = { lat: 3.13442, lon: 101.68625, name: "KL Sentral" };

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
  const hit = await geocode(text);
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

  const requestedAt = parseHHMM(url.searchParams.get("at") ?? atArg);
  const atSec = requestedAt ?? pinned ?? undefined;
  const rounds = Math.min(5, Math.max(1, Number(url.searchParams.get("rounds") ?? 3) || 3));
  const count = Math.min(3, Math.max(1, Number(url.searchParams.get("count") ?? 3) || 3));

  const key = `${mode}|${from.lat},${from.lon}|${to.lat},${to.lon}|${atSec ?? "live"}|${rounds}|${mode === "plans" ? count : 1}|${dbMtime}`;
  const cached = planCache.get(key);
  // A live plan goes stale within minutes; only a pinned clock is safe to keep.
  const fresh = cached && (atSec != null || Date.now() - cached.at < 30_000);
  if (fresh) return json(res, 200, cached.payload);

  let plans;
  if (mode === "plans") {
    plans = withDb((current) => planAlternatives(
      current, { from, to, atSec, maxRounds: rounds, index }, { count }
    ));
  } else {
    const one = withDb((current) => planJourney(current, { from, to, atSec, maxRounds: rounds, index }));
    plans = one ? [one] : [];
  }
  if (!plans.length) {
    return json(res, 404, { error: "Tiada laluan pada waktu ini. / No route at this time." });
  }

  const clock = requestedAt != null || pinned != null ? `pinned ${atArg ?? url.searchParams.get("at")}` : "live";
  const clean = plans.map(({ _debug, ...rest }) => rest);
  const payload = mode === "plans" ? { plans: clean, clock } : { ...clean[0], clock };
  planCache.set(key, { payload, at: Date.now() });
  if (planCache.size > 200) planCache.delete(planCache.keys().next().value);
  json(res, 200, payload);
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
