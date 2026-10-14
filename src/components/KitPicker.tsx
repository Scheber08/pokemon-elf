import { useState } from 'react';
import { useT } from '../i18n';
import { CHEER_MAX, cleanCheer } from '../lib/cheer';
import { DEFAULT_KIT, KIT_COLORS, type Kit } from '../lib/kits';

interface Props {
  /** null = Standardfarben */
  kit: Kit | null;
  onChange: (kit: Kit | null) => void;
  disabled?: boolean;
  /** Torjubel (Spruch unter „TOR!“) – ohne onCheer kein Feld */
  cheer?: string;
  onCheer?: (cheer: string) => void;
}

/** Trikotfarben wählen: je eine Farbe für Heim und Auswärts aus der Palette. */
export function KitPicker({ kit, onChange, disabled = false, cheer = '', onCheer }: Props) {
  const t = useT();
  const tx = t.kit;
  /** Entwurf des Spruchs – gesendet bzw. gespeichert erst mit Enter oder beim Verlassen */
  const [draft, setDraft] = useState<string | null>(null);
  const commitCheer = () => {
    if (draft == null || !onCheer) return;
    const next = cleanCheer(draft);
    setDraft(null);
    if (next !== cheer) onCheer(next);
  };
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
        {onCheer ? tx.titleCheer : tx.title}
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
      {onCheer && (
        <label className="field kit-picker__cheer">
          <span className="field__label">{tx.cheer}</span>
          <input
            className="input"
            type="text"
            maxLength={CHEER_MAX + 10}
            placeholder={tx.cheerPlaceholder}
            value={draft ?? cheer}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCheer}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCheer();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
        </label>
      )}
      {kit && (
        <button type="button" className="btn btn--small btn--ghost" disabled={disabled} onClick={() => onChange(null)}>
          {tx.reset}
        </button>
      )}
    </details>
  );
}
