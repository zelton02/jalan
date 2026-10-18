#!/usr/bin/env node
/**
 * Read-only API for the app. Run beside `vite dev` (vite proxies /api here).
 *
 *   node ingest/api.mjs            # http://127.0.0.1:8795
 *   node ingest/api.mjs --at 17:00 # pin the clock for demos/tests
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/plan                 -> the Sungai Long -> KL Sentral itinerary
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { planCorridor, openDb, metaMap } from "./lib.mjs";

const argv = process.argv.slice(2);
const atIdx = argv.indexOf("--at");
const atArg = atIdx >= 0 ? argv[atIdx + 1] : null;
const pinned = atArg ? (() => { const [h, m] = atArg.split(":").map(Number); return h * 3600 + m * 60; })() : null;

const db = openDb(resolve("data/jalan.db"));
const PORT = Number(process.env.PORT || 8795);
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/health") {
    return json(res, 200, { ok: true, feeds: metaMap(db)["rail:ingested_at"] ? "loaded" : "missing" });
  }

  if (url.pathname === "/api/plan") {
    const plan = planCorridor(db, { atSec: pinned ?? undefined });
    if (!plan) return json(res, 404, { error: "no service for this corridor right now" });
    return json(res, 200, { ...plan, clock: pinned != null ? `pinned ${atArg}` : "live" });
  }

  json(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`jalan api on http://127.0.0.1:${PORT}${pinned ? ` (clock pinned to ${atArg})` : ""}`);
});
