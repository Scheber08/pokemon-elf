import { useId, type ReactNode } from 'react';

interface Option<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface Props<T> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  wrap?: boolean;
  hideLabel?: boolean;
}

/** Segment-Buttons (Radio-Gruppe). */
export function Segmented<T extends string | number | boolean>({ label, value, options, onChange, wrap, hideLabel }: Props<T>) {
  const id = useId();
  return (
    <div className="field">
      <span className={hideLabel ? 'sr-only' : 'field__label'} id={id}>
        {label}
      </span>
      <div className={`segmented ${wrap ? 'segmented--wrap' : ''}`} role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            title={o.title}
            className={`segmented__btn ${o.value === value ? 'is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
