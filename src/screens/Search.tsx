import { useEffect, useState } from "react";
import Field from "../components/Field";
import Button from "../components/Button";
import Alert from "../components/Alert";
import { getPlaces, getRecent, setPlace, type RecentTrip, type SavedPlace } from "../saved";

type Props = {
  onSearch: (from: string, to: string, fromName?: string, at?: string, toName?: string) => void;
  onBoard: () => void;
  loading: boolean;
  error: string | null;
};

export default function Search({ onSearch, onBoard, loading, error }: Props) {
  const [from, setFrom] = useState("Sungai Long");
  const [to, setTo] = useState("KL Sentral");
  const [fromName, setFromName] = useState<string | undefined>();
  const [toName, setToName] = useState<string | undefined>();
  const [when, setWhen] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [home, setHome] = useState<SavedPlace | undefined>();
  const [work, setWork] = useState<SavedPlace | undefined>();
  const [recent, setRecent] = useState<RecentTrip[]>([]);
  const minWhen = new Date().toLocaleString("sv-SE").slice(0, 16).replace(" ", "T");

  useEffect(() => {
    const places = getPlaces();
    setHome(places.home);
    setWork(places.work);
    setRecent(getRecent());
  }, []);

  const locate = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Peranti ini tiada lokasi. / This device has no location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFrom(`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`);
        setFromName("Lokasi saya");
        setLocating(false);
      },
      () => {
        setLocating(false);
        setGeoError("Tidak dapat lokasi. Taip alamat. / Couldn't get your location. Type an address.");
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
    setFromName(toName);
    setToName(fromName);
  };

  const toggleHome = () => {
    if (home) {
      setPlace("home", null);
      setHome(undefined);
      return;
    }
    if (!from.trim()) return;
    const place: SavedPlace = { label: "Rumah", value: from.trim(), name: fromName };
    setPlace("home", place);
    setHome(place);
  };

  const toggleWork = () => {
    if (work) {
      setPlace("work", null);
      setWork(undefined);
      return;
    }
    if (!to.trim()) return;
    const place: SavedPlace = { label: "Kerja", value: to.trim(), name: toName };
    setPlace("work", place);
    setWork(place);
  };

  const submit = () => onSearch(from, to, fromName, when || undefined, toName);

  return (
    <div className="screen">
      <div className="brand">JALAN</div>

      <h1 className="h1">Dari mana?</h1>
      <p className="sub">Where are you starting from?</p>

      {home || work ? (
        <div className="chips">
          {home ? (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setFrom(home.value);
                setFromName(home.name);
              }}
            >
              ⌂ {home.label}
            </button>
          ) : null}
          {work ? (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setTo(work.value);
                setToName(work.name);
              }}
            >
              ◎ {work.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fields">
        <Field
          label="DARI"
          sublabel="FROM"
          value={from}
          onChange={(value) => {
            setFrom(value);
            setFromName(undefined);
          }}
          placeholder="Stesen, hentian, alamat"
          action={
            <button
              type="button"
              className={home ? "field__star field__star--on" : "field__star"}
              onClick={toggleHome}
              aria-label={home ? "Buang Rumah" : "Simpan sebagai Rumah"}
              title={home ? "Buang Rumah" : "Simpan sebagai Rumah"}
            >
              {home ? "★" : "☆"}
            </button>
          }
        />
        <button type="button" className="swap" onClick={swap} aria-label="Tukar asal dan destinasi">
          ↑↓
        </button>
        <Field
          label="KE"
          sublabel="TO"
          value={to}
          onChange={(value) => {
            setTo(value);
            setToName(undefined);
          }}
          placeholder="Destinasi"
          action={
            <button
              type="button"
              className={work ? "field__star field__star--on" : "field__star"}
              onClick={toggleWork}
              aria-label={work ? "Buang Kerja" : "Simpan sebagai Kerja"}
              title={work ? "Buang Kerja" : "Simpan sebagai Kerja"}
            >
              {work ? "★" : "☆"}
            </button>
          }
        />
      </div>

      <Button variant="secondary" block className="locate" onClick={locate} disabled={locating || loading}>
        {locating ? "Mencari lokasi… / Locating…" : "◎ Guna lokasi saya / Use my location"}
      </Button>

      <div className="when">
        <label className="field">
          <span className="eyebrow">BILA / WHEN</span>
          <input
            className="field__input"
            type="datetime-local"
            value={when}
            min={minWhen}
            onChange={(event) => setWhen(event.target.value)}
          />
        </label>
        {when ? (
          <button type="button" className="when__clear" onClick={() => setWhen("")}>
            Sekarang
          </button>
        ) : null}
      </div>

      {geoError ? <Alert>{geoError}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Button variant="primary" block onClick={submit} disabled={loading}>
        {loading ? "Mencari… / Searching…" : "Cari laluan / Find routes"}
      </Button>
      <button type="button" className="linkish" onClick={onBoard}>
        Jadual hentian / Stop board →
      </button>
      <p className="footnote">Mana-mana alamat di Malaysia. / Any address in Malaysia.</p>

      {recent.length ? (
        <section className="section">
          <div className="eyebrow">BARU-BARU / RECENT</div>
          <ul className="plain-list">
            {recent.map((trip) => (
              <li key={`${trip.from}|${trip.to}`}>
                <button
                  type="button"
                  className="recent recent--button"
                  onClick={() => onSearch(trip.from, trip.to, trip.fromName, when || undefined, trip.toName)}
                >
                  {trip.fromName ?? trip.from} → {trip.toName ?? trip.to}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="footnote">Jadual rasmi data.gov.my. Waktu berubah mengikut perkhidmatan.</p>
    </div>
  );
}
