/**
 * Google Places API (New): autocomplete, place details, and text geocoding.
 *
 * The legacy Maps APIs are not enabled on the key, so everything goes through
 * places.googleapis.com. Content other than the place id is cached for 30 days
 * (Google's limit); autocomplete prefixes are cached for one day.
 *
 *   GOOGLE_MAPS_API_KEY in the environment, or ~/.config/jalan/google.env
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import dns from "node:dns";

// The key is restricted to this server's IPv4 address. Node prefers AAAA records, and Google
// rejects the request as coming from an unlisted IPv6 address, so resolve IPv4 first.
dns.setDefaultResultOrder("ipv4first");

const KEY_FILE = `${homedir()}/.config/jalan/google.env`;
const CACHE_PATH = new URL("../data/google-cache.json", import.meta.url).pathname;
const AUTOCOMPLETE_TTL = 24 * 3600 * 1000;
const CONTENT_TTL = 30 * 24 * 3600 * 1000;
const DAILY_CAP = Number(process.env.GOOGLE_DAILY_CAP ?? 800);

let cache = null;
let warned = false;

function key() {
  if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY.trim();
  try {
    const match = readFileSync(KEY_FILE, "utf8").match(/^GOOGLE_MAPS_API_KEY=(.+)$/m);
    if (match) {
      process.env.GOOGLE_MAPS_API_KEY = match[1].trim();
      return process.env.GOOGLE_MAPS_API_KEY;
    }
  } catch {
    // no key file: fall back to the other providers
  }
  return "";
}

export function googleEnabled() {
  return Boolean(key());
}

function store() {
  if (cache) return cache;
  try {
    cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
  } catch {
    cache = {};
  }
  cache.autocomplete ??= {};
  cache.places ??= {};
  cache.search ??= {};
  cache.usage ??= {};
  return cache;
}

function save() {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(store()));
  } catch {
    // read-only data dir: in-memory cache still works
  }
}

function underCap() {
  const today = new Date().toISOString().slice(0, 10);
  const used = store().usage[today] ?? 0;
  if (used >= DAILY_CAP) {
    if (!warned) {
      console.warn(`[google] daily cap ${DAILY_CAP} reached; falling back to Nominatim today`);
      warned = true;
    }
    return false;
  }
  store().usage[today] = used + 1;
  return true;
}

const fresh = (entry, ttl) => entry && Date.now() - Date.parse(entry.at) < ttl;

/**
 * Autocomplete. Returns [] when the key is missing, the call fails, or the daily cap is hit.
 * `session` is a Google session token so a typing burst + the final details call bill as one.
 */
export async function autocompletePlaces(query, { at = null, limit = 5, session = null } = {}) {
  if (!googleEnabled()) return [];
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];

  const cacheKey = `${q.toLowerCase()}|${at ? `${at.lat.toFixed(2)},${at.lon.toFixed(2)}` : ""}`;
  const cached = store().autocomplete[cacheKey];
  if (fresh(cached, AUTOCOMPLETE_TTL)) return cached.results;
  if (!underCap()) return [];

  const body = { input: q, includedRegionCodes: ["my"], languageCode: "en" };
  if (at) body.locationBias = { circle: { center: { latitude: at.lat, longitude: at.lon }, radius: 50_000 } };
  if (session) body.sessionToken = session;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn("[google] autocomplete", data?.error?.status ?? res.status, data?.error?.message ?? "");
      return [];
    }
    const results = (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .slice(0, limit)
      .map((p) => ({
        placeId: p.placeId,
        name: p.structuredFormat?.mainText?.text ?? p.text?.text?.split(",")[0] ?? "",
        address: p.structuredFormat?.secondaryText?.text ?? "",
        text: p.text?.text ?? "",
      }));
    store().autocomplete[cacheKey] = { at: new Date().toISOString(), results };
    save();
    return results;
  } catch (error) {
    console.warn("[google] autocomplete failed:", error.message);
    return [];
  }
}

/** Place id -> coordinates. Cached for 30 days. */
export async function placeById(placeId) {
  if (!googleEnabled() || !placeId) return null;
  const id = String(placeId);
  const cached = store().places[id];
  if (fresh(cached, CONTENT_TTL)) return cached.place;
  if (!underCap()) return null;

  try {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(id)}?languageCode=en`;
    const res = await fetch(url, {
      headers: {
        "x-goog-api-key": key(),
        "x-goog-fieldmask": "id,displayName,formattedAddress,location",
      },
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn("[google] place", data?.error?.status ?? res.status, data?.error?.message ?? "");
      return null;
    }
    const place = {
      placeId: data.id ?? id,
      name: data.displayName?.text ?? "",
      address: data.formattedAddress ?? "",
      lat: data.location?.latitude,
      lon: data.location?.longitude,
    };
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
    store().places[id] = { at: new Date().toISOString(), place };
    save();
    return place;
  } catch (error) {
    console.warn("[google] place failed:", error.message);
    return null;
  }
}

/** Free-text address -> coordinates through Text Search. Cached for 30 days. */
export async function geocodeWithGoogle(query) {
  if (!googleEnabled()) return null;
  const q = String(query ?? "").trim();
  if (q.length < 3) return null;

  const cacheKey = q.toLowerCase();
  const cached = store().search[cacheKey];
  if (fresh(cached, CONTENT_TTL)) return cached.place;
  if (!underCap()) return null;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key(),
        "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q, regionCode: "MY", languageCode: "en", maxResultCount: 1 }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn("[google] searchText", data?.error?.status ?? res.status, data?.error?.message ?? "");
      return null;
    }
    const hit = data.places?.[0];
    if (!hit?.location) return null;
    const place = {
      placeId: hit.id,
      name: hit.displayName?.text ?? q,
      address: hit.formattedAddress ?? "",
      lat: hit.location.latitude,
      lon: hit.location.longitude,
    };
    store().search[cacheKey] = { at: new Date().toISOString(), place };
    save();
    return place;
  } catch (error) {
    console.warn("[google] searchText failed:", error.message);
    return null;
  }
}
