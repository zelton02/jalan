import { useState } from "react";
import Field from "../components/Field";
import Button from "../components/Button";
import Alert from "../components/Alert";

type Props = { onSearch: (from: string, to: string) => void; loading: boolean; error: string | null };

export default function Search({ onSearch, loading, error }: Props) {
  const [from, setFrom] = useState("Sungai Long");
  const [to, setTo] = useState("KL Sentral");

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="screen">
      <div className="brand">JALAN</div>

      <h1 className="h1">Dari mana?</h1>
      <p className="sub">Where are you starting from?</p>

      <div className="fields">
        <Field label="DARI" sublabel="FROM" value={from} onChange={setFrom} placeholder="Stesen, hentian, alamat" />
        <button type="button" className="swap" onClick={swap} aria-label="Tukar asal dan destinasi">
          ↑↓
        </button>
        <Field label="KE" sublabel="TO" value={to} onChange={setTo} placeholder="Destinasi" />
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <Button variant="primary" block onClick={() => onSearch(from, to)} disabled={loading}>
        {loading ? "Mencari… / Searching…" : "Cari laluan / Find routes"}
      </Button>
      <p className="footnote">Buat masa ini: Sungai Long → KL Sentral sahaja. / This corridor only, for now.</p>

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
