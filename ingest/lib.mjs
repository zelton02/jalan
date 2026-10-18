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

  let best = null;
  for (const trip of trips) {
    const times = db.prepare(
      `SELECT stop_id, arrival, departure, stop_sequence FROM stop_times
       WHERE feed = ? AND trip_id = ? ORDER BY stop_sequence`
    ).all(feed, trip.trip_id);
    if (times.length < 2) continue;

    const firstDep = sec(times[0].departure);
    const from = times.find((t) => t.stop_id === fromId);
    const to = times.find((t) => t.stop_id === toId);
    if (firstDep == null || !from || !to) continue;
    if (from.stop_sequence >= to.stop_sequence) continue;

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
    const ride = {
      tripId: trip.trip_id,
      headsign: trip.headsign,
      dep: start + offFrom,
      arr: start + offTo,
      stops: to.stop_sequence - from.stop_sequence,
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
        { kind: "ride", start: hhmm(ride1.dep + date.offset), duration: `${Math.round((ride1.arr - ride1.dep) / 60)} min`, title: "MRT ke Pasar Seni", subtitle: `${ride1.stops} stesen`, line: "kajang", stops: `${ride1.stops} stop${ride1.stops === 1 ? "" : "s"}`, headsign: ride1.headsign },
        { kind: "transfer", start: hhmm(ride1.arr + date.offset), duration: "5 min", title: "Tukar ke LRT Kelana Jaya", subtitle: "Transfer at Pasar Seni", line: "kelana" },
        { kind: "ride", start: hhmm(ride2.dep + date.offset), duration: `${Math.round((ride2.arr - ride2.dep) / 60)} min`, title: "LRT ke KL Sentral", subtitle: `${ride2.stops} stesen`, line: "kelana", stops: `${ride2.stops} stop${ride2.stops === 1 ? "" : "s"}`, headsign: ride2.headsign },
        { kind: "arrive", start: hhmm(arrive + date.offset), duration: "", title: "Sampai di KL Sentral", subtitle: "Arrive · exit B" },
      ],
    };
  }
  return null;
}
