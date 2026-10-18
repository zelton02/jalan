import LineBadge from "../components/LineBadge";
import Button from "../components/Button";
import { lineShort } from "../data/lines";
import type { Plan } from "../types";

type Props = { plan: Plan; onBack: () => void; onSelect: () => void };

export default function Results({ plan, onBack, onSelect }: Props) {
  const transfers = plan.legs.filter((leg) => leg.kind === "transfer").length;
  const lines = plan.legs.filter((leg) => leg.line).map((leg) => leg.line!);
  const unique = [...new Set(lines)];
  const ingested = plan.source.ingested_at
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" }).format(new Date(plan.source.ingested_at))
    : "—";

  return (
    <div className="screen">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">{plan.origin.toUpperCase()} → {plan.destination.toUpperCase()}</div>
          <h1 className="h2">1 laluan / route</h1>
        </div>
      </header>

      <ul className="plain-list">
        <li>
          <button type="button" className="route" onClick={onSelect}>
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
              <span className="route__tag">Jadual rasmi</span>
            </div>
          </button>
        </li>
      </ul>

      <p className="footnote">
        Jadual: {ingested} MYT{plan.clock?.startsWith("pinned") ? ` · demo clock ${plan.clock.slice(7)}` : ""} · {plan.legs.length} langkah.
      </p>
    </div>
  );
}
