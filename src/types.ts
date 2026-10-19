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
  tripId?: string;
  from?: string;
  to?: string;
  live?: { vehicles: number; delay_min: number; updated_at: string; feed?: string };
};

export type Plan = {
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  date?: string;
  total_minutes: number;
  source: { feed: string; ingested_at: string | null };
  clock?: string;
  warning?: string;
  legs: PlanLeg[];
};
