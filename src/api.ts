import type { Plan } from "./types";

type Options = { fromName?: string; toName?: string; signal?: AbortSignal };

export async function fetchPlans(from: string, to: string, { fromName, toName, signal }: Options = {}): Promise<Plan[]> {
  const params = new URLSearchParams({ from, to });
  if (fromName) params.set("fromName", fromName);
  if (toName) params.set("toName", toName);
  const res = await fetch(`/api/plans?${params}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json();
  return Array.isArray(body.plans) ? body.plans : [];
}
