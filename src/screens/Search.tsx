import { useState } from "react";
import Field from "../components/Field";
import Button from "../components/Button";

export default function Search({ onSearch }: { onSearch: () => void }) {
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

      <Button variant="primary" block onClick={onSearch}>
        Cari laluan / Find routes
      </Button>

      <section className="section">
        <div className="eyebrow">BARU-BARU / RECENT</div>
        <ul className="plain-list">
          <li className="recent">
            <span>Sungai Long → KLCC</span>
            <span className="recent__meta">MRT · 54 min</span>
          </li>
          <li className="recent">
            <span>Kajang → Mid Valley</span>
            <span className="recent__meta">KTM · 47 min</span>
          </li>
        </ul>
      </section>

      <p className="footnote">Data contoh. Waktu dan tambang bukan masa sebenar.</p>
    </div>
  );
}
