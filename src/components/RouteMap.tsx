import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Plan, PlanLeg, Vehicle } from "../types";
import { planRouteColors } from "../data/lines";

const RIDE_COLOR = "#0b6b3a";
const PAPER = "#f7f5ef";
const MUTED = "#5b6068";
const INK = "#14161a";
const VEHICLE = "#1d4ed8";

/** Yellow and pale lines need a dark casing; everything else reads fine on white. */
const isLightColor = (color: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
};

const dotIcon = (color: string) =>
  L.divIcon({
    className: "map-dot",
    html: `<span style="background:${color}"></span>`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  });

type Props = {
  plan: Plan;
  /** Index of the leg to frame; null fits the whole journey. */
  focus?: number | null;
  vehicles?: Vehicle[];
  /** Live rider position while a journey is running. */
  me?: { lat: number; lon: number; accuracy?: number } | null;
  /** Keep the map centred on `me` as it moves. */
  follow?: boolean;
  /** Small, non-interactive preview (results cards). */
  compact?: boolean;
};

/** Route map: GTFS shapes for rides, OSRM paths for walks, live vehicles on top. */
export default function RouteMap({ plan, focus = null, vehicles = [], me = null, follow = false, compact = false }: Props) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.LayerGroup | null>(null);
  const moving = useRef<L.LayerGroup | null>(null);
  const rider = useRef<L.LayerGroup | null>(null);
  const journeyBounds = useRef<L.LatLngBounds | null>(null);

  useEffect(() => {
    if (!node.current || map.current) return;
    const instance = L.map(node.current, {
      zoomControl: false,
      scrollWheelZoom: !compact,
      dragging: !compact,
      doubleClickZoom: !compact,
      touchZoom: !compact,
      boxZoom: false,
      keyboard: false,
      attributionControl: true,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    base.current = L.layerGroup().addTo(instance);
    moving.current = L.layerGroup().addTo(instance);
    rider.current = L.layerGroup().addTo(instance);
    map.current = instance;

    // Exposed for smoke tests and debugging.
    const stamp = () => {
      try {
        instance.getContainer().dataset.zoom = String(instance.getZoom());
        instance.getContainer().dataset.center = `${instance.getCenter().lat.toFixed(5)},${instance.getCenter().lng.toFixed(5)}`;
      } catch {
        // The map has no view yet (still booting); the next zoomend/moveend will stamp it.
      }
    };
    instance.on("zoomend moveend", stamp);
    stamp();

    return () => {
      instance.remove();
      map.current = null;
      base.current = null;
      moving.current = null;
      rider.current = null;
    };
  }, [compact]);

  // Route geometry: redraws when the plan changes.
  useEffect(() => {
    const instance = map.current;
    const group = base.current;
    if (!instance || !group) return;
    group.clearLayers();

    const bounds: [number, number][] = [];
    const rides: [number, number][][] = [];
    const walkDash = { color: MUTED, weight: 3, opacity: 0.9, dashArray: "5 5" };
    const dashed = (a: [number, number], b: [number, number]) => L.polyline([a, b], walkDash).addTo(group);
    const stopDot = (point: [number, number], color: string, name?: string) => {
      const dot = L.circleMarker(point, { radius: 5, color, weight: 3, fillColor: "#ffffff", fillOpacity: 1 });
      if (name) dot.bindTooltip(name, { direction: "top", offset: [0, -5] });
      dot.addTo(group);
    };

    // Colours are assigned in plan order and never repeat inside one plan, so two routes read as
    // different lines. Same helper as the legend under the map.
    const colors = planRouteColors(plan);
    const colorForLeg = (leg: PlanLeg) => {
      if (leg.kind !== "ride") return MUTED;
      return colors.get(leg.routeId ?? leg.route ?? "bus") ?? RIDE_COLOR;
    };

    for (const leg of plan.legs) {
      const color = colorForLeg(leg);
      if (leg.polyline?.length) {
        if (leg.kind === "ride") {
          // Casing first so pale line colours (Putrajaya yellow) stay readable on the map.
          const casing = isLightColor(color) ? { color: INK, opacity: 0.45 } : { color: "#ffffff", opacity: 0.85 };
          L.polyline(leg.polyline, { ...casing, weight: 9, lineJoin: "round" }).addTo(group);
          L.polyline(leg.polyline, { color, weight: 5, opacity: 0.95, lineJoin: "round" }).addTo(group);
          rides.push(leg.polyline);
        } else {
          // Walk / transfer: the OSRM footpath when the API returned one.
          L.polyline(leg.polyline, walkDash).addTo(group);
        }
        bounds.push(...leg.polyline);
      } else if (leg.kind === "ride" && leg.from_point && leg.to_point) {
        // The feed's shape does not cover this leg (loop detours); draw a faded straight line.
        L.polyline([leg.from_point, leg.to_point], { color, weight: 3, opacity: 0.5, dashArray: "2 6" }).addTo(group);
        rides.push([leg.from_point, leg.to_point]);
        bounds.push(leg.from_point, leg.to_point);
      }

      if (leg.kind === "ride") {
        if (leg.from_point) stopDot(leg.from_point, color, leg.from);
        if (leg.to_point) stopDot(leg.to_point, color, leg.to);
      } else if (leg.kind === "transfer" && leg.from_point) {
        // Ring around the platform where the rider changes.
        const ring = L.circleMarker(leg.from_point, { radius: 8, color: INK, weight: 2, fill: false, dashArray: "1 3" });
        ring.bindTooltip(leg.title, { direction: "top", offset: [0, -9] });
        ring.addTo(group);
      }
    }

    // Older responses carry no walking geometry: connect the ends with a straight dashed line.
    if (plan.origin_point && rides[0] && !plan.legs[0]?.polyline) dashed(plan.origin_point, rides[0][0]);
    for (let i = 1; i < rides.length; i++) dashed(rides[i - 1][rides[i - 1].length - 1], rides[i][0]);
    if (plan.destination_point && rides.length) {
      const last = rides[rides.length - 1];
      const tail = plan.legs[plan.legs.length - 1];
      if (!tail?.polyline) dashed(last[last.length - 1], plan.destination_point);
    }

    if (plan.origin_point) {
      L.marker(plan.origin_point, { icon: dotIcon(PAPER), keyboard: false }).addTo(group);
      bounds.push(plan.origin_point);
    }
    if (plan.destination_point) {
      L.marker(plan.destination_point, { icon: dotIcon(RIDE_COLOR), keyboard: false }).addTo(group);
      bounds.push(plan.destination_point);
    }

    journeyBounds.current = bounds.length ? L.latLngBounds(bounds) : null;
    if (bounds.length === 1) instance.setView(bounds[0], 14);
    else if (bounds.length > 1) instance.fitBounds(L.latLngBounds(bounds), { padding: [22, 22], maxZoom: 15 });
    else instance.setView([3.139, 101.6869], 10);
  }, [plan]);

  // Live vehicles.
  useEffect(() => {
    const group = moving.current;
    if (!group) return;
    group.clearLayers();
    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
      const dot = L.circleMarker([vehicle.lat, vehicle.lon], {
        radius: 5,
        color: "#ffffff",
        weight: 2,
        fillColor: VEHICLE,
        fillOpacity: 1,
        className: "vehicle-dot",
      });
      const delay = vehicle.delay_min;
      const label = `${vehicle.label ?? vehicle.route}${delay != null ? ` · ${delay >= 0 ? "+" : "−"}${Math.abs(delay)}′` : ""}`;
      dot.bindTooltip(label, { direction: "top", offset: [0, -6] });
      dot.addTo(group);
    }
  }, [vehicles]);

  // Zoom to one leg when the rider taps it.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const leg = focus != null ? plan.legs[focus] : null;
    const pts = leg?.polyline ?? (leg?.from_point && leg?.to_point ? [leg.from_point, leg.to_point] : null);
    if (pts && pts.length > 1) instance.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
    else if (journeyBounds.current) instance.fitBounds(journeyBounds.current, { padding: [22, 22], maxZoom: 15 });
  }, [focus, plan]);

  // Rider position: pulsing dot, accuracy halo, and follow mode while the journey runs.
  useEffect(() => {
    const instance = map.current;
    const group = rider.current;
    if (!instance || !group) return;
    group.clearLayers();
    if (!me) return;

    const point: [number, number] = [me.lat, me.lon];
    if (me.accuracy && me.accuracy > 15) {
      L.circle(point, {
        radius: me.accuracy,
        color: "#1d4ed8",
        weight: 1,
        opacity: 0.35,
        fillColor: "#1d4ed8",
        fillOpacity: 0.08,
      }).addTo(group);
    }
    L.marker(point, {
      keyboard: false,
      icon: L.divIcon({
        className: "me-dot",
        html: "<span></span>",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    }).addTo(group);

    if (follow) instance.setView(point, Math.max(instance.getZoom(), 16), { animate: true });
  }, [me, follow]);

  return <div className={compact ? "map map--compact" : "map"} ref={node} role="img" aria-label="Peta laluan / Route map" />;
}
