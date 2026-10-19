import LineBadge from "../components/LineBadge";
import Button from "../components/Button";
import Alert from "../components/Alert";
import { lineShort } from "../data/lines";
import type { Plan } from "../types";

type Props = { plans: Plan[]; onBack: () => void; onSelect: (index: number) => void };

export default function Results({ plans, onBack, onSelect }: Props) {
  const best = plans[0];
  const ingested = best.source.ingested_at
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" }).format(new Date(best.source.ingested_at))
    : "—";

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
  const scheduled = best.clock?.startsWith("scheduled") ?? false;
  const dayLabel = best.date
    ? best.date === today
      ? "hari ini / today"
      : new Intl.DateTimeFormat("ms-MY", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${best.date}T00:00:00+08:00`))
    : "";
  const whenLabel = scheduled ? `Berlepas ${dayLabel} · ${best.depart}` : null;

  return (
    <div className="screen">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">{best.origin.toUpperCase()} → {best.destination.toUpperCase()}</div>
          <h1 className="h2">{plans.length} laluan / routes</h1>
          {whenLabel ? <div className="route__meta">{whenLabel}</div> : null}
        </div>
      </header>

      {best.warning ? <Alert>{best.warning}</Alert> : null}

      <ul className="plain-list">
        {plans.map((plan, index) => {
          const transfers = plan.legs.filter((leg) => leg.kind === "transfer").length;
          const lines = plan.legs.filter((leg) => leg.line).map((leg) => leg.line!);
          const unique = [...new Set(lines)];
          return (
            <li key={`${plan.depart}-${plan.arrive}-${index}`}>
              <button type="button" className="route" onClick={() => onSelect(index)}>
                <div className="route__top">
                  <span className="route__time">{plan.total_minutes} min</span>
                  <span className="route__fare">{plan.depart} → {plan.arrive}</span>
                </div>
                <div className="route__meta">
                  {transfers} tukar / transfer · sampai {plan.arrive}
                </div>
                <div className="route__lines">
                  {unique.map((line) => (
                    <LineBadge key={line} line={line} short={lineShort[line]} />
                  ))}
                  <span className="route__tag">{index === 0 ? "Tercepat" : "Alternatif"}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="footnote">
        Jadual: {ingested} MYT · {plans.length} laluan.
      </p>
    </div>
  );
}
