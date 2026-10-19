// Address -> coordinates through Nominatim, cached on disk.
// Usage policy: one request per second, a real User-Agent, results cached.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CACHE_PATH = new URL("../data/geocode.json", import.meta.url).pathname;
const USER_AGENT = "jalan-transit/0.1 (https://zhng.tech; transit app dev)";
const MIN_GAP_MS = 1100;

let cache = null;
let lastCall = 0;

function load() {
  if (cache) return cache;
  try {
    cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // A read-only data dir must not break planning; the in-memory cache still works.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function geocode(query) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const store = load();
  if (store[key]) return store[key];

  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "my");
  url.searchParams.set("accept-language", "en");

  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;

  const hit = {
    lat: Number(rows[0].lat),
    lon: Number(rows[0].lon),
    name: query.trim(),
    display: rows[0].display_name,
    at: new Date().toISOString(),
  };
  store[key] = hit;
  save();
  return hit;
}

// ---- suggestions (search-as-you-type) ------------------------------------------------------
//
// Same Nominatim instance and the same 1 req/s budget as geocode(). Keystrokes are coalesced:
// while a newer query is waiting, older ones resolve with an empty list instead of spending a
// request, so typing "bandar utama" does not queue six calls.

const SUGGEST_PATH = new URL("../data/suggest.json", import.meta.url).pathname;
const SUGGEST_TTL_MS = 14 * 24 * 3600 * 1000;
const SUGGEST_KEEP = 400;

let suggestCache = null;
let currentQuery = null;
let chain = Promise.resolve();

function loadSuggest() {
  if (suggestCache) return suggestCache;
  try {
    suggestCache = existsSync(SUGGEST_PATH) ? JSON.parse(readFileSync(SUGGEST_PATH, "utf8")) : {};
  } catch {
    suggestCache = {};
  }
  return suggestCache;
}

function saveSuggest() {
  const store = loadSuggest();
  const keys = Object.keys(store);
  if (keys.length > SUGGEST_KEEP) {
    keys.sort((a, b) => Date.parse(store[a].at) - Date.parse(store[b].at));
    for (const key of keys.slice(0, keys.length - SUGGEST_KEEP)) delete store[key];
  }
  try {
    writeFileSync(SUGGEST_PATH, JSON.stringify(store));
  } catch {
    // read-only data dir: keep the in-memory copy
  }
}

async function fetchSuggest(query, limit) {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "my");
  url.searchParams.set("accept-language", "en");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!Array.isArray(rows)) return null;
  return rows.map((row) => ({
    name: row.name || String(row.display_name ?? "").split(",")[0],
    display: row.display_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    type: row.type,
    category: row.category,
  }));
}

/** Up to `limit` place suggestions. Returns [] when the query is too short or got overtaken. */
export function suggestPlaces(query, limit = 6) {
  const key = String(query ?? "").trim().toLowerCase();
  if (key.length < 3) return Promise.resolve([]);

  const store = loadSuggest();
  const cached = store[key];
  if (cached && Date.now() - Date.parse(cached.at) < SUGGEST_TTL_MS) return Promise.resolve(cached.places);

  currentQuery = key;
  const run = chain.then(async () => {
    if (currentQuery !== key) return [];           // a newer keystroke arrived while queueing
    const places = await fetchSuggest(key, limit);
    if (places) {
      store[key] = { at: new Date().toISOString(), places };
      saveSuggest();
      return places;
    }
    return [];
  });
  chain = run.then(() => {}, () => {});
  return run;
}
