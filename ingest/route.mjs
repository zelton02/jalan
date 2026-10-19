#!/usr/bin/env node
/**
 * Plan any A → B journey from coordinates.
 *
 *   node ingest/route.mjs --from 3.0417,101.8014 --to 3.1344,101.6863 --at 08:00
 *   node ingest/route.mjs --from ... --to ... --date 2026-10-21 --at 07:00
 *   node ingest/route.mjs --from ... --to ... --rounds 4
 */
import { resolve } from "node:path";
import { openDb } from "./lib.mjs";
import { buildIndex, planJourney } from "./router.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const coord = (value) => {
  const [lat, lon] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`bad coordinate: ${value}`);
  return { lat, lon };
};

const from = coord(arg("from", "3.0417,101.8014"));
const to = coord(arg("to", "3.1344,101.6863"));
const at = arg("at");
const date = arg("date");
const rounds = Number(arg("rounds", "3"));
const atSec = at ? at.split(":").reduce((s, v, i) => s + Number(v) * (i === 0 ? 3600 : 60), 0) : undefined;

const db = openDb(resolve("data/jalan.db"));
const index = buildIndex(db);
const started = performance.now();
const plan = planJourney(db, { from, to, atSec, date, maxRounds: rounds, index });
const elapsed = Math.round(performance.now() - started);

if (!plan) {
  console.log("Tiada perkhidmatan untuk perjalanan ini.");
  process.exit(1);
}

console.log(`${plan.origin.toUpperCase()} → ${plan.destination.toUpperCase()}   ${plan.date ?? ""} ${plan.depart} → ${plan.arrive}  (${plan.total_minutes} min, ${elapsed} ms)\n`);
const label = { walk: "JALAN ", ride: "NAIK  ", transfer: "TUKAR ", arrive: "SAMPAI" };
for (const leg of plan.legs) {
  console.log(`  ${leg.start}  ${label[leg.kind]} ${leg.route ? `[${leg.route}] ` : ""}${leg.title}${leg.duration ? `  ${leg.duration}` : ""}`);
}
console.log(`\n  ${plan._debug.rounds} kenderaan · ${plan._debug.destinationWalkMeters} m jalan ke destinasi`);
