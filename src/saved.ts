export type SavedPlace = { label: string; value: string; name?: string };
export type Slots = { home?: SavedPlace; work?: SavedPlace };
export type RecentTrip = { from: string; to: string; fromName?: string; toName?: string };

const PLACES_KEY = "jalan.places.v1";
const RECENT_KEY = "jalan.recent.v1";

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota: saved places are a convenience, not core */
  }
};

export const getPlaces = (): Slots => read<Slots>(PLACES_KEY, {});

export const setPlace = (slot: keyof Slots, place: SavedPlace | null) => {
  const places = getPlaces();
  if (place) places[slot] = place;
  else delete places[slot];
  write(PLACES_KEY, places);
};

export const getRecent = (): RecentTrip[] => read<RecentTrip[]>(RECENT_KEY, []);

/** Newest first, same from+to collapses to the top instead of duplicating. */
export const pushRecent = (trip: RecentTrip) => {
  const list = getRecent().filter((t) => !(t.from === trip.from && t.to === trip.to));
  list.unshift(trip);
  write(RECENT_KEY, list.slice(0, 5));
};
