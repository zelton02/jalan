/**
 * Walking times from a self-hosted OSRM foot server (OpenStreetMap paths), with the old
 * straight-line estimate as the fallback when the service is down or a pair is unroutable.
 *
 * The planner is synchronous, so the API builds two matrices before planning:
 * origin -> every candidate stop, and destination -> every candidate stop (walking is
 * symmetric). One HTTP call each, ~20 ms locally.
 */
const OSRM_URL = process.env.OSRM_URL ?? "http://127.0.0.1:5000";
const TIMEOUT_MS = 2500;
const cache = new Map();

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const coords = (points) => points.map((p) => `${p.lon},${p.lat}`).join(";");

/** One origin to many stops. Returns Map(stopKey -> {sec, m}); empty when OSRM is unavailable. */
export async function walkMatrix(origin, stops) {
  if (!stops.length) return new Map();
  const limited = stops.slice(0, 99); // OSRM default max-table-size is 100
  const url = `${OSRM_URL}/table/v1/foot/${coords([origin, ...limited])}?sources=0&annotations=duration,distance`;
  const body = await getJson(url);
  const out = new Map();
  if (body?.code !== "Ok" || !body.durations?.[0]) return out;
  for (let i = 0; i < limited.length; i++) {
    const sec = body.durations[0][i + 1];
    const m = body.distances?.[0]?.[i + 1];
    if (sec != null) out.set(limited[i].key, { sec: Math.round(sec), m: Math.round(m ?? 0) });
  }
  return out;
}

/** Single pair, cached. Used for transfers and one-off checks. */
export async function walkOne(from, to) {
  const key = `${from.lat.toFixed(5)},${from.lon.toFixed(5)}|${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const body = await getJson(`${OSRM_URL}/route/v1/foot/${coords([from, to])}?overview=false`);
  const route = body?.code === "Ok" ? body.routes?.[0] : null;
  const out = route ? { sec: Math.round(route.duration), m: Math.round(route.distance) } : null;
  cache.set(key, out);
  return out;
}

export async function walkHealthy() {
  const body = await getJson(`${OSRM_URL}/nearest/v1/foot/101.8,3.0?number=1`);
  return body?.code === "Ok";
}
