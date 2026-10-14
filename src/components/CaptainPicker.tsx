import { useId } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId, Slots } from '../types';

interface Props {
  formation: FormationId;
  slots: Slots;
  /** Pokémon-ID des Kapitäns (null = keiner) */
  captain: number | null;
  onChange: (captain: number | null) => void;
  disabled?: boolean;
  /** Zusatzzeile unter der Auswahl (z. B. Wirkung auf den Score) */
  hint?: string | null;
}

/** Kapitän wählen: einer der elf Spieler auf dem Feld (nicht der Standardschütze). */
export function CaptainPicker({ formation, slots, captain, onChange, disabled = false, hint }: Props) {
  const t = useT();
  const tx = t.captain;
  const { byId } = usePokemonData();
  const id = useId();
  const defs = FORMATIONS[formation].slots;
  const players = defs.flatMap((d, i) => {
    const mon = slots[i] != null ? byId.get(slots[i] as number) : undefined;
    return mon ? [{ id: mon.id, label: `${t.game.posShort[d.pos]} · ${t.game.pokemon(mon)}` }] : [];
  });
  if (!players.length) return null;
  return (
    <div className="captain-picker">
      <label className="field__label" htmlFor={id}>
        {tx.label}
      </label>
      <select
        id={id}
        className="input"
        value={captain != null && players.some((p) => p.id === captain) ? String(captain) : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{tx.none}</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <p className="muted small">{hint ?? tx.note}</p>
    </div>
  );
}
