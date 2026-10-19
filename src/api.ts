import type { Plan } from "./types";

export async function fetchPlan(from: string, to: string, signal?: AbortSignal): Promise<Plan> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/plan?${params}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
