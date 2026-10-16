import { useId } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { positionFit, type Scale } from '../lib/fit';
import { bestCaptain } from '../lib/teamScore';
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
  /** Skala für „Beste Wahl“ (Standard: alle 1.025) */
  scale?: Scale;
  /** Weitere wählbare Spieler (Manager-Saison: Bank) – zählen nur, wenn sie in der Elf stehen */
  bench?: readonly number[];
}

/** Kapitän wählen: einer der elf Spieler auf dem Feld (nicht der Standardschütze). */
export function CaptainPicker({ formation, slots, captain, onChange, disabled = false, hint, scale: scaleProp, bench = [] }: Props) {
  const t = useT();
  const tx = t.captain;
  const { byId, scale } = usePokemonData();
  const id = useId();
  const defs = FORMATIONS[formation].slots;
  const sc = scaleProp ?? scale('all');
  // Mit Fit auf der eigenen Position – der Kapitän zählt doppelt, der Fit hilft bei der Wahl
  const players = defs.flatMap((d, i) => {
    const mon = slots[i] != null ? byId.get(slots[i] as number) : undefined;
    return mon ? [{ id: mon.id, label: `${t.game.posShort[d.pos]} · ${t.game.pokemon(mon)} · ${tx.fit(Math.round(positionFit(mon, d.pos, sc)))}` }] : [];
  });
  for (const b of bench) {
    const mon = byId.get(b);
    if (mon && !players.some((p) => p.id === b)) players.push({ id: mon.id, label: `${t.draft.bench.short} · ${t.game.pokemon(mon)}` });
  }
  if (!players.length) return null;
  const best = bestCaptain(
    formation,
    defs.map((_, i) => (slots[i] != null ? byId.get(slots[i] as number) : undefined)),
    sc,
  );
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
      {best != null && (
        <button type="button" className="btn btn--small captain-picker__best" disabled={disabled || best === captain} onClick={() => onChange(best)}>
          {tx.best}
        </button>
      )}
      <p className="muted small">{hint ?? tx.note}</p>
    </div>
  );
}
