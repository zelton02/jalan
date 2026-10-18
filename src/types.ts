export type LineId = "kajang" | "kelana" | "ampang" | "ktm" | "bus";

export type PlanLeg = {
  kind: "walk" | "ride" | "transfer" | "arrive";
  start: string;
  duration: string;
  title: string;
  subtitle?: string;
  line?: LineId;
  stops?: string;
  headsign?: string;
};

export type Plan = {
  origin: string;
  destination: string;
  depart: string;
  arrive: string;
  total_minutes: number;
  source: { feed: string; ingested_at: string | null };
  clock?: string;
  legs: PlanLeg[];
};
