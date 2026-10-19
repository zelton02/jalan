export type LineId = "kajang" | "kelana" | "ampang" | "ktm" | "bus";

export type Station = { name: string; time: string | null };

export type PlanLeg = {
  kind: "walk" | "ride" | "transfer" | "arrive";
  start: string;
  duration: string;
  title: string;
  subtitle?: string;
  line?: LineId;
  stations?: Station[];
  headsign?: string;
  route?: string;
  routeId?: string;
  feed?: string;
  tripId?: string;
  from?: string;
  to?: string;
  /** GTFS shape between boarding and alighting: [[lat, lon], ...] */
  polyline?: [number, number][];
  live?: { vehicles: number; delay_min: number; updated_at: string; feed?: string };
};

export type Plan = {
  origin: string;
  destination: string;
  origin_point?: [number, number];
  destination_point?: [number, number];
  depart: string;
  arrive: string;
  date?: string;
  total_minutes: number;
  source: { feed: string; ingested_at: string | null };
  clock?: string;
  warning?: string;
  legs: PlanLeg[];
};
