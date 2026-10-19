import { useEffect, useRef, useState } from "react";
import { fetchPlaceSuggestions, fetchStopSuggestions, type LatLon } from "./api";

export type Suggestion = {
  id: string;
  kind: "stop" | "place";
  name: string;
  sub: string;
  value: string; // "lat,lon"
};

const FEED_LABEL: Record<string, string> = {
  rail: "MRT / LRT",
  ktmb: "KTM",
  bus: "BUS",
  mrtfeeder: "FEEDER",
};

function metres(m: number | null | undefined) {
  if (m == null) return "";
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const point = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/**
 * Two requests per query: stops from our own GTFS index (instant), places from Nominatim
 * (rate-limited, slower). The list shows stops first and appends places when they arrive.
 */
export function useSuggest(query: string, at: LatLon | null, enabled: boolean) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    inflight.current?.abort();
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      const id = ++seq.current;
      const ctrl = new AbortController();
      inflight.current = ctrl;

      try {
        const stops = await fetchStopSuggestions(q, { at, signal: ctrl.signal });
        if (id !== seq.current) return;
        setItems(
          stops.map((stop) => ({
            id: `stop:${stop.key}`,
            kind: "stop" as const,
            name: stop.name,
            sub: [FEED_LABEL[stop.feed] ?? stop.feed.toUpperCase(), metres(stop.distance_m)].filter(Boolean).join(" · "),
            value: point(stop.lat, stop.lon),
          })),
        );
        setOpen(stops.length > 0);
      } catch {
        return; // aborted or offline
      }

      try {
        const places = await fetchPlaceSuggestions(q, { at, signal: ctrl.signal });
        if (id !== seq.current) return;
        if (!places.length) return;
        const mapped = places.map((place) => ({
          id: `place:${point(place.lat, place.lon)}`,
          kind: "place" as const,
          name: place.name,
          sub: [metres(place.distance_m), place.display.split(",").slice(1, 3).join(",").trim()].filter(Boolean).join(" · "),
          value: point(place.lat, place.lon),
        }));
        setItems((prev) => [...prev.filter((item) => item.kind === "stop"), ...mapped]);
        setOpen(true);
      } catch {
        // places are optional; the stop list stays
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [query, enabled, at?.lat, at?.lon]);

  return {
    items,
    open,
    close: () => setOpen(false),
  };
}
