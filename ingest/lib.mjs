// Shared GTFS query helpers. One source for time, service-day and ride logic.
import { DatabaseSync } from "node:sqlite";

export const KL = "Asia/Kuala_Lumpur";
export const pad = (n) => String(n).padStart(2, "0");

export const sec = (t) => {
  if (!t) return null;
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
};

export const hhmm = (s) => {
  const t = ((s % 86400) + 86400) % 86400;
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}`;
};

const WEEKDAY = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };

export function klNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: KL, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  return {
    ymd: `${y}${pad(m)}${pad(d)}`,
    weekday: WEEKDAY[parts.weekday],
    seconds: (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

export function dayBefore(ymd) {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
  d.setUTCDate(d.getUTCDate() - 1);
  return {
    ymd: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getUTCDay()],
  };
}

/** "2026-10-20" or "20261020" → { ymd, weekday }; null when it is not a real date. */
export function ymdInfo(input) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(input ?? ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return {
    ymd: `${y}${pad(mo)}${pad(d)}`,
    weekday: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getUTCDay()],
  };
}

export const openDb = (path) => new DatabaseSync(path, { readOnly: true });

export function metaMap(db) {
  return Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));
}

export function activeServices(db, feed, ymd, weekday) {
  const rows = db.prepare(
    `SELECT service_id, ${weekday} AS day FROM calendar WHERE feed = ? AND start_date <= ? AND end_date >= ?`
  ).all(feed, ymd, ymd).filter((r) => r.day === 1).map((r) => r.service_id);
  const set = new Set(rows);
  for (const e of db.prepare(`SELECT service_id, exception_type FROM calendar_dates WHERE feed = ? AND date = ?`).all(feed, ymd)) {
    if (e.exception_type === 1) set.add(e.service_id);
    if (e.exception_type === 2) set.delete(e.service_id);
  }
  return set;
}

export function resolveStop(db, arg, feed) {
  const rows = db.prepare(
    `SELECT feed, stop_id, stop_name FROM stops
     WHERE (UPPER(stop_id) = UPPER(?) OR UPPER(stop_name) LIKE UPPER(?)) ${feed ? "AND feed = ?" : ""}`
  ).all(...(feed ? [arg, `%${arg}%`, feed] : [arg, `%${arg}%`]));
  return rows;
}

/** The direction whose trips visit fromId before toId. Direction ids are not standardised. */
export function directionServing(db, feed, routeId, fromId, toId) {
  const row = db.prepare(
    `SELECT t.direction_id AS dir
     FROM trips t
     JOIN stop_times a ON a.feed = t.feed AND a.trip_id = t.trip_id AND a.stop_id = ?
     JOIN stop_times b ON b.feed = t.feed AND b.trip_id = t.trip_id AND b.stop_id = ?
     WHERE t.feed = ? AND t.route_id = ? AND a.stop_sequence < b.stop_sequence
     LIMIT 1`
  ).get(fromId, toId, feed, routeId);
  return row ? row.dir : null;
}

function stopNames(db, feed) {
  const clean = (name) => name.replace(/\s*-\s*REDONE\s*$/i, "").trim();
  return new Map(
    db.prepare("SELECT stop_id, stop_name FROM stops WHERE feed = ?")
      .all(feed)
      .map((r) => [r.stop_id, clean(r.stop_name)])
  );
}

/** Earliest ride on one route between two stops, expanding frequency-based trips. */
export function findRide(db, { feed, routeId, fromId, toId, afterSec, ymd, weekday }) {
  const dir = directionServing(db, feed, routeId, fromId, toId);
  if (dir == null) return null;
  const services = [...activeServices(db, feed, ymd, weekday)];
  if (!services.length) return null;

  const trips = db.prepare(
    `SELECT trip_id, headsign FROM trips
     WHERE feed = ? AND route_id = ? AND direction_id IS ?
       AND service_id IN (${services.map(() => "?").join(",")})`
  ).all(feed, routeId, dir, ...services);

  const names = stopNames(db, feed);
  let best = null;
  for (const trip of trips) {
    const times = db.prepare(
      `SELECT stop_id, arrival, departure, stop_sequence FROM stop_times
       WHERE feed = ? AND trip_id = ? ORDER BY stop_sequence`
    ).all(feed, trip.trip_id);
    if (times.length < 2) continue;

    const firstDep = sec(times[0].departure);
    const fromIdx = times.findIndex((t) => t.stop_id === fromId);
    const toIdx = times.findIndex((t) => t.stop_id === toId);
    if (firstDep == null || fromIdx < 0 || toIdx < 0) continue;
    if (fromIdx >= toIdx) continue;

    const from = times[fromIdx];
    const to = times[toIdx];
    const offFrom = sec(from.departure) - firstDep;
    const offTo = sec(to.arrival) - firstDep;
    const freqs = db.prepare(`SELECT start_time, end_time, headway_secs FROM frequencies WHERE feed = ? AND trip_id = ?`).all(feed, trip.trip_id);

    let start = null;
    if (freqs.length) {
      for (const f of freqs) {
        const ws = sec(f.start_time), we = sec(f.end_time), step = f.headway_secs;
        if (ws == null || we == null || !step) continue;
        const k = Math.max(0, Math.ceil((afterSec - offFrom - ws) / step));
        const candidate = ws + k * step;
        if (candidate <= we && (start == null || candidate < start)) start = candidate;
      }
    } else if (sec(from.departure) >= afterSec) {
      start = firstDep;
    }

    if (start == null) continue;

    const stations = times.slice(fromIdx, toIdx + 1).map((t, i) => {
      // Origin uses departure; every other station uses arrival (the moment you get there).
      const at = i === 0 ? sec(t.departure) : (sec(t.arrival) ?? sec(t.departure));
      return { name: names.get(t.stop_id) ?? t.stop_id, time: at == null ? null : hhmm(start + at - firstDep) };
    });

    const ride = {
      tripId: trip.trip_id,
      headsign: trip.headsign,
      dep: start + offFrom,
      arr: start + offTo,
      stops: stations.length - 1,
      stations,
      directionId: dir,
    };
    if (!best || ride.dep < best.dep) best = ride;
  }
  return best;
}

/** The one corridor this app supports in v1: Sungai Long -> KL Sentral. */
export function planCorridor(db, { atSec }) {
  const now = atSec ?? klNow().seconds;
  const kl = klNow();
  const dates = [{ ymd: kl.ymd, weekday: kl.weekday, offset: 0 }];
  if (now < 4 * 3600) {
    const y = dayBefore(kl.ymd);
    dates.unshift({ ...y, offset: -86400 });
  }

  for (const date of dates) {
    const walkTo = now + 8 * 60;
    const ride1 = findRide(db, {
      feed: "rail", routeId: "KGL", fromId: "KG31", toId: "KG16",
      afterSec: walkTo, ymd: date.ymd, weekday: date.weekday,
    });
    if (!ride1) continue;

    const transferStart = ride1.arr + 5 * 60;
    const ride2 = findRide(db, {
      feed: "rail", routeId: "KJ", fromId: "KJ14", toId: "KJ15",
      afterSec: transferStart, ymd: date.ymd, weekday: date.weekday,
    });
    if (!ride2) continue;

    const arrive = ride2.arr + 5 * 60;
    const dep = now;
    return {
      origin: "Sungai Long",
      destination: "KL Sentral",
      depart: hhmm(dep),
      arrive: hhmm(arrive + date.offset),
      total_minutes: Math.round((arrive - dep) / 60),
      source: { feed: "rail", ingested_at: metaMap(db)["rail:ingested_at"] ?? null },
      legs: [
        { kind: "walk", start: hhmm(dep + date.offset), duration: "8 min", title: "Jalan kaki ke MRT Bukit Dukung", subtitle: "Walk to Bukit Dukung MRT" },
        { kind: "ride", start: hhmm(ride1.dep + date.offset), duration: `${Math.round((ride1.arr - ride1.dep) / 60)} min`, title: "MRT ke Pasar Seni", line: "kajang", stations: ride1.stations, headsign: ride1.headsign },
        { kind: "transfer", start: hhmm(ride1.arr + date.offset), duration: "5 min", title: "Tukar ke LRT Kelana Jaya", subtitle: "Transfer at Pasar Seni", line: "kelana" },
        { kind: "ride", start: hhmm(ride2.dep + date.offset), duration: `${Math.round((ride2.arr - ride2.dep) / 60)} min`, title: "LRT ke KL Sentral", line: "kelana", stations: ride2.stations, headsign: ride2.headsign },
        { kind: "arrive", start: hhmm(arrive + date.offset), duration: "", title: "Sampai di KL Sentral", subtitle: "Arrive · exit B" },
      ],
    };
  }
  return null;
}

const FEEDER_FEED = "mrtfeeder";
const FEEDER_ROUTE = "30000094";
const FEEDER_FROM = "12000972"; // SG. LONG CLUB HOUSE
const FEEDER_TO = "12001792";   // MRT BUKIT DUKUNG PINTU A
const WALK_TO_STOP_MIN = 4;     // 323 m at ~75 m/min
const WALK_TO_PLATFORM_MIN = 1;

/** Next T453 from Sungai Long to the MRT bay, with its own stop list. */
function nextFeederRide(db, { afterSec, ymd, weekday }) {
  const services = [...activeServices(db, FEEDER_FEED, ymd, weekday)];
  if (!services.length) return null;
  const trips = db.prepare(
    `SELECT trip_id FROM trips WHERE feed = ? AND route_id = ?
       AND service_id IN (${services.map(() => "?").join(",")})`
  ).all(FEEDER_FEED, FEEDER_ROUTE, ...services);

  const names = stopNames(db, FEEDER_FEED);
  let best = null;
  for (const trip of trips) {
    const times = db.prepare(
      `SELECT stop_id, arrival, departure, stop_sequence FROM stop_times
       WHERE feed = ? AND trip_id = ? ORDER BY stop_sequence`
    ).all(FEEDER_FEED, trip.trip_id);
    if (times.length < 2) continue;

    const fromIdx = times.findIndex((t) => t.stop_id === FEEDER_FROM);
    if (fromIdx < 0) continue;
    // The loop visits the station twice; take the visit after the origin.
    const toIdx = times.findIndex((t, i) => i > fromIdx && t.stop_id === FEEDER_TO);
    if (toIdx < 0) continue;

    const dep = sec(times[fromIdx].departure);
    if (dep == null || dep < afterSec) continue;
    if (!best || dep < best.dep) {
      best = {
        dep,
        arr: sec(times[toIdx].departure) ?? sec(times[toIdx].arrival),
        tripId: trip.trip_id,
        stations: times.slice(fromIdx, toIdx + 1).map((t, i) => {
          const at = i === 0 ? sec(t.departure) : (sec(t.arrival) ?? sec(t.departure));
          return { name: names.get(t.stop_id) ?? t.stop_id, time: at == null ? null : hhmm(at) };
        }),
      };
    }
  }
  return best;
}

/** Door-to-door from Sungai Long to KL Sentral: feeder bus first, then MRT + LRT. */
export function planDoorToDoor(db, { atSec }) {
  const now = atSec ?? klNow().seconds;
  const kl = klNow();
  const dates = [{ ymd: kl.ymd, weekday: kl.weekday, offset: 0 }];
  if (now < 4 * 3600) dates.unshift({ ...dayBefore(kl.ymd), offset: -86400 });

  for (const date of dates) {
    const leave = now;
    const feeder = nextFeederRide(db, { afterSec: leave + WALK_TO_STOP_MIN * 60, ymd: date.ymd, weekday: date.weekday });
    if (!feeder) continue;

    const atPlatform = feeder.arr + WALK_TO_PLATFORM_MIN * 60;
    const mrt1 = findRide(db, {
      feed: "rail", routeId: "KGL", fromId: "KG31", toId: "KG16",
      afterSec: atPlatform, ymd: date.ymd, weekday: date.weekday,
    });
    if (!mrt1) continue;
    const mrt2 = findRide(db, {
      feed: "rail", routeId: "KJ", fromId: "KJ14", toId: "KJ15",
      afterSec: mrt1.arr + 5 * 60, ymd: date.ymd, weekday: date.weekday,
    });
    if (!mrt2) continue;

    const arrive = mrt2.arr + 5 * 60;
    return {
      origin: "Sungai Long",
      destination: "KL Sentral",
      depart: hhmm(leave),
      arrive: hhmm(arrive + date.offset),
      total_minutes: Math.round((arrive - leave) / 60),
      source: { feed: FEEDER_FEED, ingested_at: metaMap(db)[`${FEEDER_FEED}:ingested_at`] ?? null },
      legs: [
        { kind: "walk", start: hhmm(leave + date.offset), duration: `${WALK_TO_STOP_MIN} min`, title: "Jalan kaki ke hentian T453", subtitle: "SG. LONG CLUB HOUSE · 323 m" },
        { kind: "ride", start: hhmm(feeder.dep + date.offset), duration: `${Math.round((feeder.arr - feeder.dep) / 60)} min`, title: "Bas T453 ke MRT Bukit Dukung", line: "bus", stations: feeder.stations },
        { kind: "walk", start: hhmm(feeder.arr + date.offset), duration: `${WALK_TO_PLATFORM_MIN} min`, title: "Jalan kaki ke platform", subtitle: "MRT Bukit Dukung" },
        { kind: "ride", start: hhmm(mrt1.dep + date.offset), duration: `${Math.round((mrt1.arr - mrt1.dep) / 60)} min`, title: "MRT ke Pasar Seni", line: "kajang", stations: mrt1.stations },
        { kind: "transfer", start: hhmm(mrt1.arr + date.offset), duration: "5 min", title: "Tukar ke LRT Kelana Jaya", subtitle: "Transfer at Pasar Seni", line: "kelana" },
        { kind: "ride", start: hhmm(mrt2.dep + date.offset), duration: `${Math.round((mrt2.arr - mrt2.dep) / 60)} min`, title: "LRT ke KL Sentral", line: "kelana", stations: mrt2.stations },
        { kind: "arrive", start: hhmm(arrive + date.offset), duration: "", title: "Sampai di KL Sentral", subtitle: "Arrive · exit B" },
      ],
    };
  }
  return null;
}
