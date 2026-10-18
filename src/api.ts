import type { Plan } from "./types";

export async function fetchPlan(signal?: AbortSignal): Promise<Plan> {
  const res = await fetch("/api/plan", { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
