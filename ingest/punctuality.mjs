#!/usr/bin/env node
/**
 * How late a route usually is, by hour of day, from the collected vehicle-position history.
 *
 * Each vehicle is sampled once a minute; those samples are highly autocorrelated, so they are
 * first collapsed into one median per vehicle per 10 minutes, then the hour's median is taken
 * over those buckets. `n` is the number of buckets, not raw rows.
 *
 *   node ingest/punctuality.mjs --route U5900
 *   node ingest/punctuality.mjs --route U5900 --days 7
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { estimateSample, median } from "./estimate.mjs";

const RT_PATH = resolve("data/realtime.db");
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];

export function routePunctuality(routeId, { days = 14, now = Math.floor(Date.now() / 1000) } = {}) {
  const key = `${routeId}|${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const empty = { route: routeId, label: routeId, days, samples: 0, matched: 0, buckets: 0, days_covered: 0, hours: [] };
  if (!existsSync(RT_PATH)) return empty;

  let rt;
  try {
    rt = new DatabaseSync(RT_PATH, { readOnly: true });
    const rows = rt.prepare(
      "SELECT ts, vid, trip, lat, lon, speed FROM vp WHERE route = ? AND ts >= ? ORDER BY ts"
    ).all(routeId, now - days * 86400);
    if (!rows.length) return empty;

    let label = null;
    let matched = 0;
    const buckets = new Map();
    const daysSeen = new Set();

    for (const v of rows) {
      const est = estimateSample(v.trip, v);
      if (!est) continue;
      matched++;
      if (!label) label = est.info.label;

      const local = v.ts + 8 * 3600; // MYT
      const day = Math.floor(local / 86400);
      const hour = Math.floor((local % 86400) / 3600);
      daysSeen.add(day);

      const bkey = `${day}|${hour}|${v.vid}|${Math.floor(v.ts / 600)}`;
      const list = buckets.get(bkey);
      if (list) list.push(est.delayMin);
      else buckets.set(bkey, [est.delayMin]);
    }

    const byHour = new Map();
    for (const [k, list] of buckets) {
      const hour = Number(k.split("|")[1]);
      const m = median(list);
      const arr = byHour.get(hour);
      if (arr) arr.push(m);
      else byHour.set(hour, [m]);
    }

    const hours = [...byHour.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, vals]) => {
        vals.sort((a, b) => a - b);
        return {
          hour,
          n: vals.length,
          median: Math.round(median(vals)),
          p25: Math.round(quantile(vals, 0.25)),
          p75: Math.round(quantile(vals, 0.75)),
        };
      });

    const data = {
      route: routeId,
      label: label ?? routeId,
      days,
      samples: rows.length,
      matched,
      buckets: buckets.size,
      days_covered: daysSeen.size,
      first_ts: rows[0].ts,
      last_ts: rows[rows.length - 1].ts,
      hours,
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (error) {
    console.error("[punctuality]", String(error));
    return empty;
  } finally {
    try { rt?.close(); } catch {}
  }
}

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
if (import.meta.url === `file://${process.argv[1]}`) {
  const route = arg("route");
  if (!route) {
    console.log("usage: node ingest/punctuality.mjs --route U5900 [--days 14]");
    process.exit(1);
  }
  const data = routePunctuality(route, { days: Number(arg("days", 14)) });
  if (!data.samples) {
    console.log(`${route}: tiada sejarah. / no history for this route yet.`);
    process.exit(1);
  }
  console.log(
    `${data.label} (${route}) · ${data.days} hari · ${data.samples} sampel · ${data.matched} dipadankan · ${data.days_covered} hari data`
  );
  for (const h of data.hours) {
    const sign = h.median > 0 ? "+" : "";
    console.log(
      `  ${String(h.hour).padStart(2, "0")}:00  n=${String(h.n).padStart(3)}  median ${sign}${h.median} min  (p25 ${h.p25}, p75 ${h.p75})`
    );
  }
}
