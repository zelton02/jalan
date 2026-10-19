import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Plan } from "../types";

const RIDE_COLOR = "#0b6b3a";
const PAPER = "#f7f5ef";
const MUTED = "#5b6068";

const dotIcon = (color: string) =>
  L.divIcon({
    className: "map-dot",
    html: `<span style="background:${color}"></span>`,
    iconSize: [15, 15],
    iconAnchor: [7.5, 7.5],
  });

/** Route map: GTFS shapes for ride legs, plain markers for the two ends. */
export default function RouteMap({ plan }: { plan: Plan }) {
  const node = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!node.current) return;
    if (!map.current) {
      map.current = L.map(node.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
    }

    const group = layer.current;
    if (!group) return;
    group.clearLayers();

    const bounds: [number, number][] = [];
    const rides: [number, number][][] = [];
    for (const leg of plan.legs) {
      if (leg.kind !== "ride" || !leg.polyline?.length) continue;
      L.polyline(leg.polyline, { color: RIDE_COLOR, weight: 5, opacity: 0.9, lineJoin: "round" }).addTo(group);
      rides.push(leg.polyline);
      bounds.push(...leg.polyline);
    }

    // Dashed connectors stand in for the walk to the first stop, transfers, and the final walk.
    const dash = { color: MUTED, weight: 3, opacity: 0.85, dashArray: "4 6" };
    if (plan.origin_point && rides[0]) {
      L.polyline([plan.origin_point, rides[0][0]], dash).addTo(group);
    }
    for (let i = 1; i < rides.length; i++) {
      L.polyline([rides[i - 1][rides[i - 1].length - 1], rides[i][0]], dash).addTo(group);
    }
    if (plan.destination_point && rides.length) {
      const last = rides[rides.length - 1];
      L.polyline([last[last.length - 1], plan.destination_point], dash).addTo(group);
    }

    if (plan.origin_point) {
      L.marker(plan.origin_point, { icon: dotIcon(PAPER), keyboard: false }).addTo(group);
      bounds.push(plan.origin_point);
    }
    if (plan.destination_point) {
      L.marker(plan.destination_point, { icon: dotIcon(RIDE_COLOR), keyboard: false }).addTo(group);
      bounds.push(plan.destination_point);
    }

    if (bounds.length === 1) map.current.setView(bounds[0], 14);
    else if (bounds.length > 1) map.current.fitBounds(L.latLngBounds(bounds), { padding: [22, 22] });
    else map.current.setView([3.139, 101.6869], 10);
  }, [plan]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      layer.current = null;
    },
    [],
  );

  return <div className="map" ref={node} role="img" aria-label="Peta laluan / Route map" />;
}
