#!/usr/bin/env node
/**
 * Door-to-door: Sungai Long Residence → KL Sentral, using the real first mile.
 *
 *   npm run door -- --at 08:00
 *
 * Legs: walk to KJ438/T453 stop → feeder bus T453 → MRT Bukit Dukung →
 *       MRT Kajang line → transfer at Pasar Seni → LRT Kelana Jaya → walk.
 *
 * The walk to Bukit Dukung is NOT modelled: the station is 3.6 km from the housing area.
 */
import { resolve } from "node:path";
import { openDb, findRide, hhmm, klNow, sec } from "./lib.mjs";

const argv = process.argv.slice(2);
const atIdx = argv.indexOf("--at");
const at = atIdx >= 0 ? argv[atIdx + 1] : null;

const db = openDb(resolve("data/jalan.db"));
const now = klNow();
const startSec = at ? (() => { const [h, m] = at.split(":").map(Number); return h * 3600 + m * 60; })() : now.seconds;

const FEEDER_STOP = "12000972"; // SG. LONG CLUB HOUSE — 323 m from the housing area
const FEEDER_TO = "12001792";   // MRT BUKIT DUKUNG PINTU A
const WALK_TO_STOP = 4;         // minutes at ~75 m/min
const WALK_TO_PLATFORM = 1;

function nextFeeder(afterSec) {
  const services = db.prepare(
    `SELECT service_id FROM calendar WHERE feed='mrtfeeder' AND start_date <= ? AND end_date >= ? AND ${now.weekday}=1`
  ).all(now.ymd, now.ymd).map((r) => r.service_id);
  if (!services.length) return null;

  const trips = db.prepare(
    `SELECT trip_id FROM trips WHERE feed='mrtfeeder' AND route_id='30000094'
     AND service_id IN (${services.map(() => "?").join(",")})`
  ).all(...services);

  let best = null;
  for (const t of trips) {
    const times = db.prepare(`SELECT stop_id, stop_sequence, departure FROM stop_times WHERE feed='mrtfeeder' AND trip_id=? ORDER BY stop_sequence`).all(t.trip_id);
    const from = times.find((x) => x.stop_id === FEEDER_STOP);
    if (!from) continue;
    const to = times.find((x) => x.stop_id === FEEDER_TO && x.stop_sequence > from.stop_sequence);
    if (!to) continue;
    const dep = sec(from.departure);
    if (dep == null || dep < afterSec) continue;
    if (!best || dep < best.dep) best = { dep, arr: sec(to.departure), trip: t.trip_id };
  }
  return best;
}

const leaveHome = startSec;
const atStop = leaveHome + WALK_TO_STOP * 60;
const feeder = nextFeeder(atStop);
if (!feeder) {
  console.log("Tiada perkhidmatan feeder T453 pada waktu ini.");
  process.exit(1);
}

const atPlatform = feeder.arr + WALK_TO_PLATFORM * 60;
const mrt1 = findRide(db, { feed: "rail", routeId: "KGL", fromId: "KG31", toId: "KG16", afterSec: atPlatform, ymd: now.ymd, weekday: now.weekday });
const transfer = mrt1 ? mrt1.arr + 5 * 60 : 0;
const mrt2 = mrt1 ? findRide(db, { feed: "rail", routeId: "KJ", fromId: "KJ14", toId: "KJ15", afterSec: transfer, ymd: now.ymd, weekday: now.weekday }) : null;
if (!mrt1 || !mrt2) {
  console.log("Tiada perkhidmatan rel pada waktu ini.");
  process.exit(1);
}

const arrive = mrt2.arr + 5 * 60;
const total = Math.round((arrive - leaveHome) / 60);

console.log(`SUNGAI LONG → KL SENTRAL   ${hhmm(leaveHome)} → ${hhmm(arrive)}  (${total} min)\n`);
console.log(`  ${hhmm(leaveHome)}  JALAN   ${WALK_TO_STOP} min → ${"SG. LONG CLUB HOUSE"}`);
console.log(`  ${hhmm(feeder.dep)}  BAS     T453 → MRT Bukit Dukung   ${Math.round((feeder.arr - feeder.dep) / 60)} min`);
console.log(`  ${hhmm(atPlatform)}  JALAN   ${WALK_TO_PLATFORM} min → platform`);
console.log(`  ${hhmm(mrt1.dep)}  MRT     KG31 → KG16 Pasar Seni    ${Math.round((mrt1.arr - mrt1.dep) / 60)} min · ${mrt1.stations.length} stesen`);
console.log(`  ${hhmm(mrt1.arr)}  TUKAR   5 min → LRT Kelana Jaya`);
console.log(`  ${hhmm(mrt2.dep)}  LRT     KJ14 → KJ15 KL Sentral    ${Math.round((mrt2.arr - mrt2.dep) / 60)} min`);
console.log(`  ${hhmm(arrive)}  SAMPAI  KL Sentral`);
