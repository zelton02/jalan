import { useEffect, useMemo, useState } from "react";
import type { Plan, PlanLeg } from "./types";
import type { Fix } from "./useGeolocation";

const R = 6371000;

/** Point -> local metres, origin at the point itself. */
const toLocal = (lat: number, lon: number, lat0: number, lon0: number): [number, number] => [
  ((lon - lon0) * Math.PI * R * Math.cos((lat0 * Math.PI) / 180)) / 180,
  ((lat - lat0) * Math.PI * R) / 180,
];

/** Project a fix onto a polyline: distance along it (metres) and distance off it. */
export function projectOnLine(fix: { lat: number; lon: number }, line: [number, number][]) {
  let along = 0;
  let best = { s: 0, off: Infinity, length: 0 };
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toLocal(line[i - 1][0], line[i - 1][1], fix.lat, fix.lon);
    const [bx, by] = toLocal(line[i][0], line[i][1], fix.lat, fix.lon);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const off = Math.hypot(cx, cy);
    const seg = Math.hypot(dx, dy);
    if (off < best.off) best = { s: along + t * seg, off, length: along + seg };
    along += seg;
  }
  best.length = Math.max(best.length, along);
  return best;
}

const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const [x, y] = toLocal(b.lat, b.lon, a.lat, a.lon);
  return Math.hypot(x, y);
};

export type Progress = {
  legIndex: number;
  leg: PlanLeg | null;
  /** Metres left on the current leg, null when unknown. */
  remainingM: number | null;
  /** Name of the stop the vehicle is heading to (ride legs only). */
  nextStop: string | null;
  nextStopM: number | null;
  alert: "near" | "now" | null;
  arrived: boolean;
  /** Skip to the next leg by hand (the GPS is not always right, especially indoors). */
  advance: () => void;
};

const NEAR_M = 500;
const NOW_M = 150;
const RIDE_ARRIVE_M = 90;
const WALK_ARRIVE_M = 35;

/**
 * Follows the plan with the rider's GPS: which leg they are on, how far to the next stop, and
 * when to shout "turun sekarang".
 */
export function useJourneyProgress(plan: Plan, fix: Fix | null, active: boolean): Progress {
  const [legIndex, setLegIndex] = useState(0);
  const [remainingM, setRemainingM] = useState<number | null>(null);
  const [nextStop, setNextStop] = useState<string | null>(null);
  const [nextStopM, setNextStopM] = useState<number | null>(null);

  const leg = plan.legs[legIndex] ?? null;
  const arrived = legIndex >= plan.legs.length;

  useEffect(() => {
    if (!active || !fix || !leg) {
      setRemainingM(null);
      setNextStop(null);
      setNextStopM(null);
      return;
    }

    const end = leg.to_point;
    let left: number | null = null;
    let stop: string | null = null;
    let stopM: number | null = null;

    if (leg.kind === "ride" && leg.polyline?.length && leg.stop_dist?.length && leg.length_m) {
      const proj = projectOnLine(fix, leg.polyline);
      // If the fix is far off the route (tunnel, wrong road) the projection is meaningless.
      if (proj.length > 0 && proj.off < 400) {
        const frac = Math.min(1, Math.max(0, proj.s / proj.length));
        left = Math.max(0, (1 - frac) * leg.length_m);
        // Per-stop distances come from the full shape; compare as fractions of the leg.
        const stops = leg.stop_dist.map((d: number) => d / (leg.length_m || 1));
        const idx = stops.findIndex((f: number) => f > frac + 0.0005);
        const at = idx === -1 ? stops.length - 1 : idx;
        stop = leg.stations?.[at]?.name ?? null;
        stopM = Math.max(0, Math.round((stops[at] - frac) * leg.length_m));
      }
    }

    if (left == null && end) left = Math.round(metres(fix, { lat: end[0], lon: end[1] }));

    setRemainingM(left);
    setNextStop(stop);
    setNextStopM(stopM);

    // Advance as soon as the fix says we are at the end of the leg. A fix that is too vague to
    // trust (accuracy > 80 m) is ignored; the rider can always press "Saya dah turun".
    const nearEnd = end ? metres(fix, { lat: end[0], lon: end[1] }) : Infinity;
    const limit = leg.kind === "ride" ? RIDE_ARRIVE_M : WALK_ARRIVE_M;
    const done = (left != null && left < limit) || nearEnd < limit;
    if (done && (fix.accuracy ?? 999) <= 80 && !arrived) {
      setLegIndex((i) => Math.min(plan.legs.length, i + 1));
    }
  }, [active, fix, leg, arrived, plan.legs.length]);

  const alert: Progress["alert"] =
    active && leg?.kind === "ride" && remainingM != null
      ? remainingM <= NOW_M
        ? "now"
        : remainingM <= NEAR_M
          ? "near"
          : null
      : null;

  return useMemo(
    () => ({
      legIndex,
      leg,
      remainingM,
      nextStop,
      nextStopM,
      alert,
      arrived,
      advance: () => setLegIndex((i) => Math.min(plan.legs.length, i + 1)),
    }),
    [legIndex, leg, remainingM, nextStop, nextStopM, alert, arrived, plan.legs.length],
  );
}
