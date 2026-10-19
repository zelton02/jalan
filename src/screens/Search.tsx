import { useEffect, useState, type KeyboardEvent } from "react";
import Field from "../components/Field";
import Button from "../components/Button";
import Alert from "../components/Alert";
import { useSuggest, type Suggestion } from "../useSuggest";
import { fetchPlaceById, type LatLon } from "../api";
import { getPlaces, getRecent, setPlace, type RecentTrip, type SavedPlace } from "../saved";

type Props = {
  onSearch: (from: string, to: string, fromName?: string, at?: string, toName?: string) => void;
  onBoard: () => void;
  loading: boolean;
  error: string | null;
};

type FieldKey = "from" | "to";

const isCoord = (s: string) => /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(s.trim());

const parsePoint = (s?: string): LatLon | null => {
  if (!s || !isCoord(s)) return null;
  const [lat, lon] = s.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
};

function SuggestList({
  items,
  hi,
  onPick,
  onHover,
}: {
  items: Suggestion[];
  hi: number;
  onPick: (item: Suggestion) => void;
  onHover: (index: number) => void;
}) {
  return (
    <ul className="suggest" role="listbox">
      {items.map((item, index) => (
        <li key={item.id} role="option" aria-selected={index === hi}>
          <button
            type="button"
            className={index === hi ? "suggest__item is-active" : "suggest__item"}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span className="suggest__kind">{item.kind === "stop" ? "HENTIAN" : "TEMPAT"}</span>
            <span className="suggest__name">{item.name}</span>
            {item.sub ? <span className="suggest__sub">{item.sub}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Search({ onSearch, onBoard, loading, error }: Props) {
  const [fromText, setFromText] = useState("Sungai Long");
  const [toText, setToText] = useState("KL Sentral");
  const [fromCoord, setFromCoord] = useState<string>();
  const [toCoord, setToCoord] = useState<string>();
  const [fromName, setFromName] = useState<string>();
  const [toName, setToName] = useState<string>();
  const [active, setActive] = useState<FieldKey | null>(null);
  const [hi, setHi] = useState(0);
  const [geo, setGeo] = useState<LatLon | null>(null);
  const [when, setWhen] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [home, setHome] = useState<SavedPlace | undefined>();
  const [work, setWork] = useState<SavedPlace | undefined>();
  const [recent, setRecent] = useState<RecentTrip[]>([]);
  const minWhen = new Date().toLocaleString("sv-SE").slice(0, 16).replace(" ", "T");

  const fromSug = useSuggest(fromText, geo ?? parsePoint(toCoord), active === "from");
  const toSug = useSuggest(toText, geo ?? parsePoint(fromCoord), active === "to");
  const shown = active === "from" ? fromSug : active === "to" ? toSug : null;

  useEffect(() => {
    const places = getPlaces();
    setHome(places.home);
    setWork(places.work);
    setRecent(getRecent());
  }, []);

  useEffect(() => {
    setHi(0);
  }, [active, shown?.items.length]);

  const locate = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Peranti ini tiada lokasi. / This device has no location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const label = "Lokasi saya";
        const coord = `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setFromText(label);
        setFromCoord(coord);
        setFromName(label);
        setLocating(false);
        setActive(null);
      },
      () => {
        setLocating(false);
        setGeoError("Tidak dapat lokasi. Taip alamat. / Couldn't get your location. Type an address.");
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const swap = () => {
    setFromText(toText);
    setToText(fromText);
    setFromCoord(toCoord);
    setToCoord(fromCoord);
    setFromName(toName);
    setToName(fromName);
    setActive(null);
  };

  const change = (field: FieldKey, value: string) => {
    if (field === "from") {
      setFromText(value);
      setFromCoord(undefined);
      setFromName(undefined);
    } else {
      setToText(value);
      setToCoord(undefined);
      setToName(undefined);
    }
    setActive(field);
  };

  const pick = async (field: FieldKey, item: Suggestion) => {
    let value = item.value;
    let name = item.name;
    // Google autocomplete returns an id, not coordinates; resolve it on selection.
    if (!value && item.placeId) {
      try {
        const place = await fetchPlaceById(item.placeId);
        if (place) {
          value = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
          name = item.name || place.name;
        }
      } catch {
        // fall through: the text will be geocoded server-side
      }
    }
    if (field === "from") {
      setFromText(name);
      setFromCoord(value || undefined);
      setFromName(name);
    } else {
      setToText(name);
      setToCoord(value || undefined);
      setToName(name);
    }
    setActive(null);
  };

  const useSaved = (field: FieldKey, place: SavedPlace) => {
    const coord = isCoord(place.value) ? place.value : undefined;
    const text = place.name ?? place.value;
    if (field === "from") {
      setFromText(text);
      setFromCoord(coord);
      setFromName(place.name ?? text);
    } else {
      setToText(text);
      setToCoord(coord);
      setToName(place.name ?? text);
    }
    setActive(null);
  };

  const toggleHome = () => {
    if (home) {
      setPlace("home", null);
      setHome(undefined);
      return;
    }
    if (!fromText.trim()) return;
    const place: SavedPlace = { label: "Rumah", value: fromCoord ?? fromText.trim(), name: fromName ?? fromText.trim() };
    setPlace("home", place);
    setHome(place);
  };

  const toggleWork = () => {
    if (work) {
      setPlace("work", null);
      setWork(undefined);
      return;
    }
    if (!toText.trim()) return;
    const place: SavedPlace = { label: "Kerja", value: toCoord ?? toText.trim(), name: toName ?? toText.trim() };
    setPlace("work", place);
    setWork(place);
  };

  const submit = () => {
    onSearch(fromCoord ?? fromText, toCoord ?? toText, fromName ?? fromText, when || undefined, toName ?? toText);
  };

  const onKey = (field: FieldKey) => (event: KeyboardEvent<HTMLInputElement>) => {
    const sug = field === "from" ? fromSug : toSug;
    if (!sug.open || !sug.items.length) {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHi((h) => (h + 1) % sug.items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHi((h) => (h - 1 + sug.items.length) % sug.items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(field, sug.items[Math.min(hi, sug.items.length - 1)]);
    } else if (event.key === "Escape") {
      sug.close();
    }
  };

  const blur = (field: FieldKey) => () => {
    window.setTimeout(() => setActive((current) => (current === field ? null : current)), 120);
  };

  return (
    <div className="screen">
      <div className="brand">JALAN</div>

      <h1 className="h1">Dari mana?</h1>
      <p className="sub">Where are you starting from?</p>

      {home || work ? (
        <div className="chips">
          {home ? (
            <button type="button" className="chip" onClick={() => useSaved("from", home)}>
              ⌂ {home.label}
            </button>
          ) : null}
          {work ? (
            <button type="button" className="chip" onClick={() => useSaved("to", work)}>
              ◎ {work.label}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fields">
        <Field
          label="DARI"
          sublabel="FROM"
          value={fromText}
          onChange={(value) => change("from", value)}
          onFocus={() => setActive("from")}
          onBlur={blur("from")}
          onKeyDown={onKey("from")}
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
        >
          {active === "from" && fromSug.open && fromSug.items.length ? (
            <SuggestList items={fromSug.items} hi={hi} onPick={(item) => void pick("from", item)} onHover={setHi} />
          ) : null}
        </Field>

        <button type="button" className="swap" onClick={swap} aria-label="Tukar asal dan destinasi">
          ↑↓
        </button>

        <Field
          label="KE"
          sublabel="TO"
          value={toText}
          onChange={(value) => change("to", value)}
          onFocus={() => setActive("to")}
          onBlur={blur("to")}
          onKeyDown={onKey("to")}
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
        >
          {active === "to" && toSug.open && toSug.items.length ? (
            <SuggestList items={toSug.items} hi={hi} onPick={(item) => void pick("to", item)} onHover={setHi} />
          ) : null}
        </Field>
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
