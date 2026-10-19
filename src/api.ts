import type { Plan } from "./types";

type Options = { fromName?: string; toName?: string; at?: string; signal?: AbortSignal };

export async function fetchPlans(from: string, to: string, { fromName, toName, at, signal }: Options = {}): Promise<Plan[]> {
  const params = new URLSearchParams({ from, to });
  if (fromName) params.set("fromName", fromName);
  if (toName) params.set("toName", toName);
  if (at) params.set("at", at);
  const res = await fetch(`/api/plans?${params}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json();
  return Array.isArray(body.plans) ? body.plans : [];
}

export type LatLon = { lat: number; lon: number };

export type StopSuggestion = {
  key: string;
  name: string;
  feed: string;
  lat: number;
  lon: number;
  routes: number;
  distance_m: number | null;
};

export type PlaceSuggestion = {
  name: string;
  display: string;
  lat: number;
  lon: number;
  type?: string;
  category?: string;
  distance_m: number | null;
};

type SuggestOptions = { at?: LatLon | null; places?: boolean; signal?: AbortSignal };

async function suggest(q: string, { at, places, signal }: SuggestOptions = {}) {
  const params = new URLSearchParams({ q });
  if (at) {
    params.set("lat", String(at.lat));
    params.set("lon", String(at.lon));
  }
  if (places) params.set("places", "1");
  const res = await fetch(`/api/suggest?${params}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) return { stops: [] as StopSuggestion[], places: [] as PlaceSuggestion[] };
  const body = await res.json();
  return {
    stops: Array.isArray(body.stops) ? (body.stops as StopSuggestion[]) : [],
    places: Array.isArray(body.places) ? (body.places as PlaceSuggestion[]) : [],
  };
}

export async function fetchStopSuggestions(q: string, options: SuggestOptions = {}) {
  const body = await suggest(q, options);
  return body.stops;
}

export async function fetchPlaceSuggestions(q: string, options: SuggestOptions = {}) {
  const body = await suggest(q, { ...options, places: true });
  return body.places;
}
