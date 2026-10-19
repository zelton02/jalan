import { useEffect, useState } from "react";
import Alert from "../components/Alert";
import Button from "../components/Button";
import LineBadge from "../components/LineBadge";
import { lineShort } from "../data/lines";
import type { Plan, PlanLeg } from "../types";

const kindLabel: Record<PlanLeg["kind"], string> = {
  walk: "JALAN / WALK",
  ride: "NAIK / RIDE",
  transfer: "TUKAR / TRANSFER",
  arrive: "SAMPAI / ARRIVE",
};

const klHM = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

type Live = NonNullable<PlanLeg["live"]>;
const liveLabel = (live: Live) => {
  const delay =
    live.delay_min === 0 ? "tepat masa" : `${live.delay_min > 0 ? "lewat" : "awal"} ${Math.abs(live.delay_min)} min`;
  return `${delay} · ${live.vehicles} ${live.feed === "ktmb" ? "tren" : "bas"}`;
};

type HourStat = { hour: number; n: number; median: number; p25: number; p75: number };
const signed = (minutes: number) => (minutes === 0 ? "0" : `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)}`);

export default function Journey({ plan, onBack }: { plan: Plan; onBack: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [now, setNow] = useState(klHM);
  const [punct, setPunct] = useState<Record<string, HourStat[]>>({});
  const [punctDays, setPunctDays] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(klHM()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const routes = [
      ...new Set(
        plan.legs
          .filter((leg) => leg.routeId && leg.feed !== "rail")
          .map((leg) => leg.routeId as string),
      ),
    ];
    if (!routes.length) return;
    let alive = true;
    (async () => {
      const next: Record<string, HourStat[]> = {};
      let days = 0;
      await Promise.all(
        routes.map(async (route) => {
          try {
            const res = await fetch(`/api/punctuality?route=${encodeURIComponent(route)}&days=14`);
            if (!res.ok) return;
            const body = await res.json();
            next[route] = body.hours ?? [];
            days = Math.max(days, body.days_covered ?? 0);
          } catch {
            /* history is optional */
          }
        }),
      );
      if (alive) {
        setPunct(next);
        setPunctDays(days);
      }
    })();
    return () => {
      alive = false;
    };
  }, [plan]);

  const next = plan.legs[0];
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="screen screen--journey">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">{plan.origin.toUpperCase()} → {plan.destination.toUpperCase()}</div>
          <h1 className="h2">{plan.total_minutes} min · sampai {plan.arrive}</h1>
        </div>
      </header>

      {offline ? <Alert>Luar talian. Waktu dianggarkan. / Offline — times are estimates.</Alert> : null}

      <ol className="steps">
        {plan.legs.map((leg, index) => {
          const stations = (leg.stations ?? []).filter((s): s is { name: string; time: string } => Boolean(s.time));
          const inWindow = stations.length > 1 && now >= stations[0].time && now <= stations[stations.length - 1].time;
          let current = -1;
          if (inWindow) stations.forEach((s, i) => { if (s.time <= now) current = i; });
          const isOpen = open === index;

          return (
            <li key={`${leg.kind}-${leg.start}-${index}`} className={`step ${index === 0 ? "step--next" : ""}`}>
              <div className="step__time">{leg.start}</div>
              <div className="step__rail" aria-hidden="true">
                <span className="step__dot" />
              </div>
              <div className="step__body">
                <div className="eyebrow">{kindLabel[leg.kind]}</div>
                <div className="step__title">{leg.title}</div>
                {leg.subtitle ? <div className="step__sub">{leg.subtitle}</div> : null}
                {leg.live ? (
                  <div
                    className="step__live"
                    title="Anggaran dari kenderaan di laluan ini sekarang, bukan trip ini. / Estimate from vehicles on this route now, not this trip."
                  >
                    <span className="step__live-dot" aria-hidden="true" />
                    LIVE {liveLabel(leg.live)}
                  </div>
                ) : null}
                {leg.routeId && (() => {
                  const hour = Number(leg.start.slice(0, 2));
                  const stat = punct[leg.routeId]?.find((h) => h.hour === hour);
                  if (!stat || stat.n < 8) return null;
                  return (
                    <div className="step__hist" title="Median sejarah pada jam ini. / Historical median at this hour.">
                      BIASA {signed(stat.median)}′ · {stat.n} SAMPEL
                    </div>
                  );
                })()}
                <div className="step__meta">
                  {leg.line ? <LineBadge line={leg.line} short={lineShort[leg.line]} /> : null}
                  {leg.duration ? <span>{leg.duration}</span> : null}
                  {leg.stations?.length ? (
                    <button
                      type="button"
                      className="stations__toggle"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : index)}
                    >
                      {leg.stations?.length} stesen <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
                    </button>
                  ) : null}
                </div>

                {isOpen && stations.length ? (
                  <div className="stations">
                    <ol className="stations__list">
                      {stations.map((station, i) => (
                        <li key={`${station.name}-${i}`} className={`station${i === current ? " station--now" : ""}`}>
                          <span className="station__time">{station.time}</span>
                          <span className="station__dot" aria-hidden="true" />
                          <span className="station__name">{station.name}</span>
                          <span className="station__tag">
                            {i === 0 ? "NAIK" : i === stations.length - 1 ? "TURUN" : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {current >= 0 ? <p className="footnote">Kedudukan dianggarkan dari jadual.</p> : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {plan.legs.some((leg) => leg.live) || punctDays > 0 ? (
        <p className="footnote">
          LIVE: anggaran dari kenderaan di laluan ini sekarang, bukan trip ini. BIASA: median
          sejarah {punctDays} hari pada jam itu. / LIVE is a route estimate; BIASA is the historical
          median at that hour.
        </p>
      ) : null}

      <div className="bottom">
        <div className="bottom__label">SETERUSNYA / NEXT</div>
        <div className="bottom__next">{next.title} · {next.start}</div>
        <Button variant="primary" block>
          Mula / Start
        </Button>
      </div>
    </div>
  );
}
