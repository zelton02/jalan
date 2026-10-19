import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Plan, Vehicle } from "../types";

const RIDE_COLOR = "#0b6b3a";
const PAPER = "#f7f5ef";
const MUTED = "#5b6068";
const VEHICLE = "#1d4ed8";

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
  /** Small, non-interactive preview (results cards). */
  compact?: boolean;
};

/** Route map: GTFS shapes for rides, OSRM paths for walks, live vehicles on top. */
export default function RouteMap({ plan, focus = null, vehicles = [], compact = false }: Props) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.LayerGroup | null>(null);
  const moving = useRef<L.LayerGroup | null>(null);
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
    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
      base.current = null;
      moving.current = null;
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

    for (const leg of plan.legs) {
      if (leg.polyline?.length) {
        if (leg.kind === "ride") {
          L.polyline(leg.polyline, { color: RIDE_COLOR, weight: 5, opacity: 0.9, lineJoin: "round" }).addTo(group);
          rides.push(leg.polyline);
        } else {
          // Walk / transfer: the OSRM footpath when the API returned one.
          L.polyline(leg.polyline, walkDash).addTo(group);
        }
        bounds.push(...leg.polyline);
      } else if (leg.kind === "ride" && leg.from_point && leg.to_point) {
        // The feed's shape does not cover this leg (loop detours); draw a faded straight line.
        L.polyline([leg.from_point, leg.to_point], { color: RIDE_COLOR, weight: 3, opacity: 0.5, dashArray: "2 6" }).addTo(group);
        rides.push([leg.from_point, leg.to_point]);
        bounds.push(leg.from_point, leg.to_point);
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

  return <div className={compact ? "map map--compact" : "map"} ref={node} role="img" aria-label="Peta laluan / Route map" />;
}
