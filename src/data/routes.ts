export type LineId = "kajang" | "kelana" | "ampang" | "ktm" | "bus";

export type LegKind = "walk" | "wait" | "ride" | "transfer" | "arrive";

export type Leg = {
  id: string;
  kind: LegKind;
  start: string;
  duration: string;
  title: string;
  subtitle?: string;
  line?: LineId;
  stops?: string;
};

export type Route = {
  id: string;
  total: string;
  fare: string;
  transfers: number;
  tags: string[];
  notice?: string;
  lines: LineId[];
  arrive: string;
  legs: Leg[];
};

export const lineNames: Record<LineId, string> = {
  kajang: "MRT Kajang",
  kelana: "LRT Kelana Jaya",
  ampang: "LRT Ampang",
  ktm: "KTM Komuter",
  bus: "Bas T454",
};

export const routes: Route[] = [
  {
    id: "kajang-kelana",
    total: "52 min",
    fare: "RM 5.80",
    transfers: 1,
    tags: ["Tercepat", "Fastest"],
    notice: "LRT Kelana Jaya: kelewatan 4 min / 4 min delay",
    lines: ["kajang", "kelana"],
    arrive: "14:40",
    legs: [
      {
        id: "l1",
        kind: "walk",
        start: "13:48",
        duration: "8 min",
        title: "Jalan kaki ke MRT Bukit Dukung",
        subtitle: "Walk to Bukit Dukung MRT",
      },
      {
        id: "l2",
        kind: "wait",
        start: "13:56",
        duration: "6 min",
        title: "Tunggu MRT",
        subtitle: "Platform 1 · ke arah Pasar Seni",
      },
      {
        id: "l3",
        kind: "ride",
        start: "14:02",
        duration: "22 min",
        title: "MRT ke Pasar Seni",
        subtitle: "6 stesen",
        line: "kajang",
        stops: "6 stops",
      },
      {
        id: "l4",
        kind: "transfer",
        start: "14:24",
        duration: "5 min",
        title: "Tukar ke LRT Kelana Jaya",
        subtitle: "Transfer at Pasar Seni",
        line: "kelana",
      },
      {
        id: "l5",
        kind: "ride",
        start: "14:29",
        duration: "6 min",
        title: "LRT ke KL Sentral",
        subtitle: "1 stesen",
        line: "kelana",
        stops: "1 stop",
      },
      {
        id: "l6",
        kind: "arrive",
        start: "14:40",
        duration: "",
        title: "Sampai di KL Sentral",
        subtitle: "Arrive · exit B",
      },
    ],
  },
  {
    id: "ktm",
    total: "61 min",
    fare: "RM 4.20",
    transfers: 1,
    tags: ["Termurah", "Cheapest"],
    lines: ["bus", "ktm"],
    arrive: "14:49",
    legs: [
      {
        id: "k1",
        kind: "walk",
        start: "13:48",
        duration: "5 min",
        title: "Jalan kaki ke hentian bas",
        subtitle: "Walk to the bus stop",
      },
      {
        id: "k2",
        kind: "ride",
        start: "13:53",
        duration: "14 min",
        title: "Bas T454 ke Kajang",
        subtitle: "Kajang KTM",
        line: "bus",
        stops: "9 stops",
      },
      {
        id: "k3",
        kind: "transfer",
        start: "14:12",
        duration: "8 min",
        title: "Tukar ke KTM Komuter",
        subtitle: "Transfer at Kajang",
        line: "ktm",
      },
      {
        id: "k4",
        kind: "ride",
        start: "14:20",
        duration: "29 min",
        title: "KTM ke KL Sentral",
        subtitle: "Seremban line",
        line: "ktm",
        stops: "7 stops",
      },
    ],
  },
  {
    id: "ampang",
    total: "58 min",
    fare: "RM 6.10",
    transfers: 2,
    tags: ["Kurang jalan", "Least walking"],
    lines: ["kajang", "ampang", "kelana"],
    arrive: "14:46",
    legs: [
      {
        id: "a1",
        kind: "walk",
        start: "13:48",
        duration: "8 min",
        title: "Jalan kaki ke MRT Bukit Dukung",
        subtitle: "Walk to Bukit Dukung MRT",
      },
      {
        id: "a2",
        kind: "ride",
        start: "13:56",
        duration: "16 min",
        title: "MRT ke Maluri",
        subtitle: "4 stesen",
        line: "kajang",
        stops: "4 stops",
      },
      {
        id: "a3",
        kind: "transfer",
        start: "14:12",
        duration: "6 min",
        title: "Tukar ke LRT Ampang",
        subtitle: "Transfer at Maluri",
        line: "ampang",
      },
      {
        id: "a4",
        kind: "ride",
        start: "14:18",
        duration: "12 min",
        title: "LRT ke Masjid Jamek",
        subtitle: "5 stesen",
        line: "ampang",
        stops: "5 stops",
      },
      {
        id: "a5",
        kind: "transfer",
        start: "14:32",
        duration: "4 min",
        title: "Tukar ke LRT Kelana Jaya",
        subtitle: "Transfer at Masjid Jamek",
        line: "kelana",
      },
      {
        id: "a6",
        kind: "ride",
        start: "14:36",
        duration: "6 min",
        title: "LRT ke KL Sentral",
        subtitle: "2 stesen",
        line: "kelana",
        stops: "2 stops",
      },
      {
        id: "a7",
        kind: "arrive",
        start: "14:46",
        duration: "",
        title: "Sampai di KL Sentral",
        subtitle: "Arrive · exit B",
      },
    ],
  },
];
