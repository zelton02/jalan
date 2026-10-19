import { useId, type ReactNode } from "react";

type Props = {
  label: string;
  sublabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  action?: ReactNode;
};

export default function Field({ label, sublabel, value, onChange, placeholder, action }: Props) {
  const id = useId();
  return (
    <div className="field">
      <div className="field__head">
        <label className="eyebrow" htmlFor={id}>
          {label} / {sublabel}
        </label>
        {action}
      </div>
      <input
        id={id}
        className="field__input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
