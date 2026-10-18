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

export default function Journey({ plan, onBack }: { plan: Plan; onBack: () => void }) {
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
        {plan.legs.map((leg, index) => (
          <li key={`${leg.kind}-${leg.start}-${index}`} className={`step ${index === 0 ? "step--next" : ""}`}>
            <div className="step__time">{leg.start}</div>
            <div className="step__rail" aria-hidden="true">
              <span className="step__dot" />
            </div>
            <div className="step__body">
              <div className="eyebrow">{kindLabel[leg.kind]}</div>
              <div className="step__title">{leg.title}</div>
              {leg.subtitle ? <div className="step__sub">{leg.subtitle}</div> : null}
              <div className="step__meta">
                {leg.line ? <LineBadge line={leg.line} short={lineShort[leg.line]} /> : null}
                {leg.duration ? <span>{leg.duration}</span> : null}
                {leg.stops ? <span>{leg.stops}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

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
