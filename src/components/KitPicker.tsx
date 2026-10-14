import { useT } from '../i18n';
import { DEFAULT_KIT, KIT_COLORS, type Kit } from '../lib/kits';

interface Props {
  /** null = Standardfarben */
  kit: Kit | null;
  onChange: (kit: Kit | null) => void;
  disabled?: boolean;
}

/** Trikotfarben wählen: je eine Farbe für Heim und Auswärts aus der Palette. */
export function KitPicker({ kit, onChange, disabled = false }: Props) {
  const t = useT();
  const tx = t.kit;
  const cur = kit ?? DEFAULT_KIT;
  const row = (side: 'home' | 'away') => (
    <div className="kit-picker__row" role="radiogroup" aria-label={tx[side]}>
      <span className="kit-picker__label">{tx[side]}</span>
      {KIT_COLORS.map((c) => {
        const active = cur[side] === c.id;
        const name = tx.colors[c.id] ?? c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={tx.pick(tx[side], name)}
            title={name}
            disabled={disabled}
            className={`kit-picker__swatch ${active ? 'is-active' : ''}`}
            style={{ background: c.fill, boxShadow: `inset 0 0 0 2px ${c.stroke}` }}
            onClick={() => onChange({ ...cur, [side]: c.id })}
          />
        );
      })}
    </div>
  );
  return (
    <details className="card details kit-picker">
      <summary>
        {tx.title}
        <span className="kit-picker__preview" aria-hidden="true">
          {(['home', 'away'] as const).map((side) => {
            const c = KIT_COLORS.find((x) => x.id === cur[side])!;
            return <span key={side} className="kit-picker__dot" style={{ background: c.fill, boxShadow: `inset 0 0 0 2px ${c.stroke}` }} />;
          })}
        </span>
      </summary>
      <p className="muted small">{tx.note}</p>
      {row('home')}
      {row('away')}
      {kit && (
        <button type="button" className="btn btn--small btn--ghost" disabled={disabled} onClick={() => onChange(null)}>
          {tx.reset}
        </button>
      )}
    </details>
  );
}
