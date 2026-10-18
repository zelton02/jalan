#!/usr/bin/env node
/**
 * Door-to-door: Sungai Long Residence → KL Sentral, using the real first mile.
 *
 *   npm run door -- --at 08:00
 *
 * The plan comes from lib.planDoorToDoor(), the same function the API serves.
 */
import { resolve } from "node:path";
import { openDb, planDoorToDoor, klNow } from "./lib.mjs";

const argv = process.argv.slice(2);
const atIdx = argv.indexOf("--at");
const at = atIdx >= 0 ? argv[atIdx + 1] : null;
const atSec = at ? (() => { const [h, m] = at.split(":").map(Number); return h * 3600 + m * 60; })() : undefined;

const db = openDb(resolve("data/jalan.db"));
const plan = planDoorToDoor(db, { atSec });
if (!plan) {
  console.log("Tiada perkhidmatan pada waktu ini.");
  process.exit(1);
}

console.log(`${plan.origin.toUpperCase()} → ${plan.destination.toUpperCase()}   ${plan.depart} → ${plan.arrive}  (${plan.total_minutes} min)\n`);
const label = { walk: "JALAN ", ride: "NAIK  ", transfer: "TUKAR ", arrive: "SAMPAI" };
for (const leg of plan.legs) {
  const line = leg.line ? `[${leg.line === "bus" ? "BUS" : leg.line === "kajang" ? "KGL" : leg.line === "kelana" ? "KJ" : leg.line}] ` : "";
  console.log(`  ${leg.start}  ${label[leg.kind]} ${line}${leg.title}${leg.duration ? `  ${leg.duration}` : ""}`);
}
