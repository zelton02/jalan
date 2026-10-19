#!/usr/bin/env node
/**
 * Live bus / KTMB status inferred from GTFS-RT vehicle positions.
 *
 * The inference lives in estimate.mjs (shared with the history aggregation). This module only
 * takes the latest snapshot, groups the estimates by route, and caches the result for 20 s.
 *
 *   node ingest/live.mjs --route U2020
 *   node ingest/live.mjs            # every route with a live vehicle
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { estimateSample, median } from "./estimate.mjs";

const RT_PATH = resolve("data/realtime.db");
const FEEDS = ["bus-kl", "mrt-feeder", "ktmb"];
const MAX_AGE_SEC = 180;

let cache = { at: 0, data: null };

export function liveStatus({ now = Math.floor(Date.now() / 1000), maxAgeSec = MAX_AGE_SEC } = {}) {
  if (cache.data && now - cache.at < 20) return cache.data;
  const empty = { updated_at: null, feeds: {}, routes: {} };
  if (!existsSync(RT_PATH)) return empty;

  let rt;
  try {
    rt = new DatabaseSync(RT_PATH, { readOnly: true });
    const latest = rt.prepare("SELECT MAX(ts) m FROM vp").get()?.m;
    if (!latest || now - latest > maxAgeSec) return empty;

    const rows = rt.prepare("SELECT feed, ts, vid, trip, lat, lon, speed FROM vp WHERE ts = ?").all(latest);
    const routes = {};
    let considered = 0;

    for (const v of rows) {
      const est = estimateSample(v.trip, v);
      if (!est) continue;
      considered++;
      const bucket = (routes[est.info.routeId] ??= {
        route: est.info.routeId,
        label: est.info.label,
        feed: v.feed,
        delays: [],
        vehicles: [],
      });
      bucket.delays.push(est.delayMin);
      bucket.vehicles.push({
        id: v.vid,
        trip: v.trip,
        near_stop: est.nearStop,
        delay_min: Math.round(est.delayMin),
      });
    }

    for (const [id, b] of Object.entries(routes)) {
      routes[id] = {
        route: id,
        label: b.label,
        feed: b.feed,
        vehicles: b.vehicles.length,
        median_delay_min: Math.round(median(b.delays)),
        spread_min: Math.round(Math.min(...b.delays)) + "…" + Math.round(Math.max(...b.delays)),
        list: b.vehicles.slice(0, 8),
      };
    }

    const feeds = {};
    for (const feed of FEEDS) feeds[feed] = rows.filter((r) => r.feed === feed).length;

    const data = {
      updated_at: new Date(latest * 1000).toISOString(),
      feeds,
      considered,
      sampled: rows.length,
      routes,
    };
    cache = { at: now, data };
    return data;
  } catch (error) {
    console.error("[live]", String(error));
    return empty;
  } finally {
    try { rt?.close(); } catch {}
  }
}

const argv = process.argv.slice(2);
const routeArg = argv.includes("--route") ? argv[argv.indexOf("--route") + 1] : null;
if (import.meta.url === `file://${process.argv[1]}`) {
  const live = liveStatus();
  if (!live.updated_at) {
    console.log("Tiada data langsung. / No live data (collector down or outside service hours).");
    process.exit(1);
  }
  console.log(`live ${live.updated_at} · sampled ${live.sampled} · usable ${live.considered}`);
  const routes = routeArg ? { [routeArg]: live.routes[routeArg] } : live.routes;
  for (const r of Object.values(routes)) {
    if (!r) {
      console.log(`${routeArg}: tiada kenderaan langsung / no live vehicle`);
      continue;
    }
    console.log(`\n${r.label} (${r.feed}) · ${r.vehicles} kenderaan · median ${r.median_delay_min >= 0 ? "+" : ""}${r.median_delay_min} min (${r.spread_min})`);
    for (const v of r.list) {
      console.log(`  ${v.id} ${v.trip} · dekat ${v.near_stop} · ${v.delay_min >= 0 ? "+" : ""}${v.delay_min} min`);
    }
  }
}
