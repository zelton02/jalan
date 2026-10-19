import { useId, type KeyboardEvent, type ReactNode } from "react";

type Props = {
  label: string;
  sublabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  action?: ReactNode;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  children?: ReactNode; // suggestion dropdown, positioned under the input
};

export default function Field({ label, sublabel, value, onChange, placeholder, action, onFocus, onBlur, onKeyDown, children }: Props) {
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
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(children)}
      />
      {children}
    </div>
  );
}
