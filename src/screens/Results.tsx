import LineBadge from "../components/LineBadge";
import Button from "../components/Button";
import { routes, type Route } from "../data/routes";

export default function Results({ onBack, onSelect }: { onBack: () => void; onSelect: (route: Route) => void }) {
  return (
    <div className="screen">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">SUNGAI LONG → KL SENTRAL</div>
          <h1 className="h2">{routes.length} laluan / routes</h1>
        </div>
      </header>

      <ul className="plain-list">
        {routes.map((route) => (
          <li key={route.id}>
            <button type="button" className="route" onClick={() => onSelect(route)}>
              <div className="route__top">
                <span className="route__time">{route.total}</span>
                <span className="route__fare">{route.fare}</span>
              </div>
              <div className="route__meta">
                {route.transfers} tukar / transfer · sampai {route.arrive}
              </div>
              <div className="route__lines">
                {route.lines.map((line) => (
                  <LineBadge key={line} line={line} short={line.toUpperCase()} />
                ))}
                <span className="route__tag">{route.tags[0]}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <p className="footnote">Ketuk satu laluan untuk langkah demi langkah.</p>
    </div>
  );
}
