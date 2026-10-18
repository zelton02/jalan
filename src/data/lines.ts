import type { LineId } from "../types";

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
