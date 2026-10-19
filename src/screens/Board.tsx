import { useEffect, useState } from "react";
import Alert from "../components/Alert";
import Button from "../components/Button";
import LineBadge from "../components/LineBadge";
import { lineShort } from "../data/lines";
import type { LineId } from "../types";

type Stop = { key: string; name: string; feed: string; routes: number };
type Live = { delay_min: number; vehicles: number };
type Departure = {
  routeId: string;
  route: string;
  feed: string;
  line?: LineId;
  headsign: string | null;
  time: string;
  in_min: number;
  live?: Live;
};

export default function Board({ onBack }: { onBack: () => void }) {
  const [q, setQ] = useState("");
  const [stops, setStops] = useState<Stop[]>([]);
  const [stop, setStop] = useState<Stop | null>(null);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (stop) return;
    const query = q.trim();
    if (query.length < 2) {
      setStops([]);
      setSearched(false);
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stops?q=${encodeURIComponent(query)}`);
        const body = await res.json();
        if (alive) {
          setStops(body.stops ?? []);
          setSearched(true);
        }
      } catch {
        if (alive) setError("Carian gagal. / Search failed.");
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, stop]);

  useEffect(() => {
    if (!stop) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/departures?stop=${encodeURIComponent(stop.key)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (alive) {
          setDepartures(body.departures ?? []);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Data unavailable");
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [stop]);

  const reset = () => {
    setStop(null);
    setDepartures([]);
    setQ("");
    setStops([]);
    setSearched(false);
  };

  return (
    <div className="screen">
      <header className="topbar">
        <Button variant="ghost" onClick={onBack} aria-label="Kembali">
          ←
        </Button>
        <div>
          <div className="eyebrow">{stop ? "HENTIAN / STOP" : "CARI HENTIAN / FIND A STOP"}</div>
          <h1 className="h2">{stop ? stop.name : "Jadual hentian"}</h1>
        </div>
      </header>

      {!stop ? (
        <>
          <label className="field">
            <span className="eyebrow">NAMA HENTIAN / STOP NAME</span>
            <input
              className="field__input"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Contoh: UTAR, KL Sentral"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>

          {error ? <Alert>{error}</Alert> : null}

          <ul className="plain-list">
            {stops.map((s) => (
              <li key={s.key}>
                <button type="button" className="stop-hit" onClick={() => setStop(s)}>
                  <span>{s.name}</span>
                  <span className="stop-hit__meta">{s.routes} laluan</span>
                </button>
              </li>
            ))}
          </ul>
          {searched && !stops.length ? (
            <p className="footnote">Tiada hentian dijumpai. / No stop found.</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="board__head">
            <span className="eyebrow">{departures.length} perlepasan / departures</span>
            <button type="button" className="board__change" onClick={reset}>
              Tukar
            </button>
          </div>

          {error ? <Alert>{error}</Alert> : null}

          <ul className="plain-list">
            {departures.map((d) => (
              <li className="dep" key={`${d.routeId}-${d.time}`}>
                <div className="dep__min">
                  {d.in_min <= 0 ? "kini" : d.in_min}
                  {d.in_min > 0 ? <span>′</span> : null}
                </div>
                <div className="dep__body">
                  <div className="dep__top">
                    <span className="dep__route">{d.route}</span>
                    <span className="dep__dest">{d.headsign ?? "—"}</span>
                  </div>
                  <div className="dep__meta">
                    {d.line ? <LineBadge line={d.line} short={lineShort[d.line]} /> : null}
                    <span>{d.time}</span>
                    {d.live ? (
                      <span className="dep__live">
                        LIVE {d.live.delay_min >= 0 ? "+" : ""}
                        {d.live.delay_min}′
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {!departures.length ? (
            <p className="footnote">Tiada perlepasan dalam 90 minit. / No departures in the next 90 minutes.</p>
          ) : null}
          <p className="footnote">
            Dikemas kini setiap 30 saat. LIVE = anggaran dari kenderaan di laluan ini sekarang. /
            Refresh every 30s; LIVE is a route estimate.
          </p>
        </>
      )}
    </div>
  );
}
