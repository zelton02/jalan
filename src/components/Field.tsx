type Props = {
  label: string;
  sublabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export default function Field({ label, sublabel, value, onChange, placeholder }: Props) {
  return (
    <label className="field">
      <span className="eyebrow">{label} / {sublabel}</span>
      <input
        className="field__input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}
