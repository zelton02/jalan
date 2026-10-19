import type { LineId, Plan } from "../types";

export const lineNames: Record<LineId, string> = {
  kajang: "MRT Kajang",
  kelana: "LRT Kelana Jaya",
  ampang: "LRT Ampang",
  ktm: "KTM Komuter",
  bus: "Bas",
};

export const lineShort: Record<LineId, string> = {
  kajang: "KGL",
  kelana: "KJ",
  ampang: "AG",
  ktm: "KTM",
  bus: "BUS",
};

/** Bus routes have no official colour; rail colours come from tokens.css. */
const BUS_PALETTE = ["#7c3aed", "#1d4ed8", "#be123c", "#0e7490", "#a21caf", "#4338ca"];

const cssVar = (name: string) =>
  typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * One colour per route inside a plan: rail legs take the line's signage colour, bus legs take the
 * next palette slot in plan order. Deterministic, so the map and any legend always agree.
 */
export function planRouteColors(plan: Plan): Map<string, string> {
  const colors = new Map<string, string>();
  let bus = 0;
  for (const leg of plan.legs) {
    if (leg.kind !== "ride") continue;
    const key = leg.routeId ?? leg.route ?? "bus";
    if (colors.has(key)) continue;
    if (leg.line && leg.line !== "bus") colors.set(key, cssVar(`--line-${leg.line}`) || "#0b6b3a");
    else colors.set(key, BUS_PALETTE[bus++ % BUS_PALETTE.length]);
  }
  return colors;
}
