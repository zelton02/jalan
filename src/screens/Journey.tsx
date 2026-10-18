import Alert from "../components/Alert";
import Button from "../components/Button";
import LineBadge from "../components/LineBadge";
import { type Route } from "../data/routes";

const kindLabel: Record<string, string> = {
  walk: "JALAN / WALK",
  wait: "TUNGGU / WAIT",
  ride: "NAIK / RIDE",
  transfer: "TUKAR / TRANSFER",
  arrive: "SAMPAI / ARRIVE",
};

export default function Journey({ route, onBack }: { route: Route; onBack: () => void }) {
  const current = route.legs[0];

  return (
    <div className="screen screen--journey">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">SUNGAI LONG → KL SENTRAL</div>
          <h1 className="h2">{route.total} · {route.fare}</h1>
        </div>
      </header>

      {route.notice ? <Alert>{route.notice}</Alert> : null}
      {!navigator.onLine ? <Alert>Luar talian. Waktu dianggarkan. / Offline — times are estimates.</Alert> : null}

      <ol className="steps">
        {route.legs.map((leg, index) => {
          const isNext = index === 0;
          return (
            <li key={leg.id} className={`step ${isNext ? "step--next" : ""}`}>
              <div className="step__time">{leg.start}</div>
              <div className="step__rail" aria-hidden="true">
                <span className="step__dot" />
              </div>
              <div className="step__body">
                <div className="eyebrow">{kindLabel[leg.kind]}</div>
                <div className="step__title">{leg.title}</div>
                {leg.subtitle ? <div className="step__sub">{leg.subtitle}</div> : null}
                <div className="step__meta">
                  {leg.line ? <LineBadge line={leg.line} short={leg.line.toUpperCase()} /> : null}
                  {leg.duration ? <span>{leg.duration}</span> : null}
                  {leg.stops ? <span>{leg.stops}</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="bottom">
        <div className="bottom__label">SETERUSNYA / NEXT</div>
        <div className="bottom__next">{current.title} · {current.duration}</div>
        <Button variant="primary" block>
          Mula / Start
        </Button>
      </div>
    </div>
  );
}
