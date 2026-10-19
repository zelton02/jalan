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
