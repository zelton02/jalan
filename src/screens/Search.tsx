import { useState } from "react";
import Field from "../components/Field";
import Button from "../components/Button";
import Alert from "../components/Alert";

type Props = { onSearch: (from: string, to: string, fromName?: string, at?: string) => void; loading: boolean; error: string | null };

export default function Search({ onSearch, loading, error }: Props) {
  const [from, setFrom] = useState("Sungai Long");
  const [to, setTo] = useState("KL Sentral");
  const [fromName, setFromName] = useState<string | undefined>();
  const [when, setWhen] = useState("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const minWhen = new Date().toLocaleString("sv-SE").slice(0, 16).replace(" ", "T");

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
    setFromName(undefined);
  };

  return (
    <div className="screen">
      <div className="brand">JALAN</div>

      <h1 className="h1">Dari mana?</h1>
      <p className="sub">Where are you starting from?</p>

      <div className="fields">
        <Field label="DARI" sublabel="FROM" value={from} onChange={(value) => { setFrom(value); setFromName(undefined); }} placeholder="Stesen, hentian, alamat" />
        <button type="button" className="swap" onClick={swap} aria-label="Tukar asal dan destinasi">
          ↑↓
        </button>
        <Field label="KE" sublabel="TO" value={to} onChange={setTo} placeholder="Destinasi" />
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

      <Button variant="primary" block onClick={() => onSearch(from, to, fromName, when || undefined)} disabled={loading}>
        {loading ? "Mencari… / Searching…" : "Cari laluan / Find routes"}
      </Button>
      <p className="footnote">Mana-mana alamat di Malaysia. / Any address in Malaysia.</p>

      <section className="section">
        <div className="eyebrow">BARU-BARU / RECENT</div>
        <ul className="plain-list">
          <li className="recent">
            <span>Sungai Long → KL Sentral</span>
            <span className="recent__meta">MRT · LRT</span>
          </li>
        </ul>
      </section>

      <p className="footnote">Jadual rasmi data.gov.my. Waktu berubah mengikut perkhidmatan.</p>
    </div>
  );
}
