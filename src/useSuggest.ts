import { useEffect, useRef, useState } from "react";
import { fetchPlaceSuggestions, fetchStopSuggestions, type LatLon } from "./api";

export type Suggestion = {
  id: string;
  kind: "stop" | "place";
  name: string;
  sub: string;
  value: string; // "lat,lon"; empty for a Google place until details are fetched
  placeId?: string;
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

const newSession = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Two requests per query: stops from our own GTFS index (instant), places from Nominatim
 * (rate-limited, slower). The list shows stops first and appends places when they arrive.
 */
export function useSuggest(query: string, at: LatLon | null, enabled: boolean) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  // Google bills one typing burst + the final details call as a session when they share a token.
  const session = useRef(newSession());

  useEffect(() => {
    if (!query.trim()) session.current = newSession();
  }, [query]);

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

      // Fire both providers at once; stops render first because they are local.
      const stopPromise = fetchStopSuggestions(q, { at, signal: ctrl.signal }).catch(() => []);
      const placePromise = fetchPlaceSuggestions(q, { at, signal: ctrl.signal, session: session.current }).catch(() => []);

      const stops = await stopPromise;
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

      const places = await placePromise;
      if (id !== seq.current) return;
      if (!places.length) return;
      const mapped = places.map((place) => {
        const hasCoords = Number.isFinite(place.lat) && Number.isFinite(place.lon);
        const coords = hasCoords ? point(place.lat as number, place.lon as number) : "";
        const address = place.display.includes(",")
          ? place.display.split(",").slice(0, 3).join(",").trim()
          : place.display;
        return {
          id: `place:${place.place_id ?? coords}`,
          kind: "place" as const,
          name: place.name,
          sub: [hasCoords ? metres(place.distance_m) : "", address].filter(Boolean).join(" · "),
          value: coords,
          placeId: place.place_id ?? undefined,
        };
      });
      setItems((prev) => [...prev.filter((item) => item.kind === "stop"), ...mapped]);
      setOpen(true);
    }, 260);

    return () => clearTimeout(timer);
  }, [query, enabled, at?.lat, at?.lon]);

  return {
    items,
    open,
    close: () => setOpen(false),
  };
}
