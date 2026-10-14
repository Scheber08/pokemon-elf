import { useMemo, useState } from 'react';
import { FORMATIONS } from '../config/formations';
import { useT } from '../i18n';
import { dexJerseys, isJerseyNumber, jerseyNumbers, setJersey, type Jerseys } from '../lib/jerseys';
import { usePokemonData } from '../state/PokemonData';
import type { FormationId, PosCode, Slots } from '../types';
import { PosBadge } from './Badges';

interface Props {
  formation: FormationId;
  slots: Slots;
  /** Standardschütze (null = keiner) */
  ss: number | null;
  /** Bank (Manager-Saison) – bekommt ebenfalls Nummern */
  bench?: readonly number[];
  jerseys: Jerseys;
  onChange: (jerseys: Jerseys) => void;
  /** Aufgeklappt starten */
  open?: boolean;
}

/**
 * Trikotnummern eines Teams bearbeiten: je Spieler ein Zahlenfeld (1–99). Übernommen wird mit Enter
 * bzw. beim Verlassen des Felds; ist die Nummer schon vergeben, tauschen beide Spieler.
 */
export function JerseyEditor({ formation, slots, ss, bench = [], jerseys, onChange, open = false }: Props) {
  const t = useT();
  const tx = t.builder.jerseys;
  const { byId } = usePokemonData();
  const defs = FORMATIONS[formation].slots;
  const players = useMemo(() => {
    const list: { pokemonId: number; pos: PosCode | null }[] = defs.flatMap((d, i) => (slots[i] != null ? [{ pokemonId: slots[i] as number, pos: d.pos }] : []));
    if (ss != null) list.push({ pokemonId: ss, pos: 'SS' });
    for (const id of bench) if (!list.some((p) => p.pokemonId === id)) list.push({ pokemonId: id, pos: null });
    return list;
  }, [defs, slots, ss, bench]);
  const numbers = useMemo(() => jerseyNumbers(players, jerseys), [players, jerseys]);
  if (!players.length) return null;
  const custom = Object.keys(jerseys).length > 0;
  return (
    <details className="card details jersey-editor" open={open}>
      <summary>{tx.title}</summary>
      <p className="muted small">{tx.note}</p>
      <ul className="jersey-editor__list">
        {players.map((p) => {
          const mon = byId.get(p.pokemonId);
          return (
            <li key={p.pokemonId}>
              {p.pos ? <PosBadge pos={p.pos} /> : <span className="jersey-editor__bench">{tx.bench}</span>}
              <span className="jersey-editor__name">{mon ? t.game.pokemon(mon) : `#${p.pokemonId}`}</span>
              <NumberField
                value={numbers.get(p.pokemonId) ?? null}
                label={tx.aria(mon ? t.game.pokemon(mon) : `#${p.pokemonId}`)}
                onCommit={(n) => onChange(setJersey(jerseys, p.pokemonId, n, numbers))}
              />
            </li>
          );
        })}
      </ul>
      <div className="jersey-editor__actions">
        <button
          type="button"
          className="btn btn--small"
          title={tx.dexTitle}
          onClick={() => onChange(dexJerseys(players.map((p) => ({ pokemonId: p.pokemonId, dex: byId.get(p.pokemonId)?.base ?? p.pokemonId }))))}
        >
          {tx.dex}
        </button>
        {custom && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => onChange({})}>
            {tx.reset}
          </button>
        )}
      </div>
    </details>
  );
}

/** Zahlenfeld mit eigenem Entwurf – erst Enter/Verlassen übernimmt (sonst würde „1" beim Tippen von „10" schon tauschen). */
function NumberField({ value, label, onCommit }: { value: number | null; label: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    setDraft(null);
    if (isJerseyNumber(n) && n !== value) onCommit(n);
  };
  return (
    <input
      className="input jersey-editor__input"
      type="number"
      inputMode="numeric"
      min={1}
      max={99}
      aria-label={label}
      value={draft ?? (value ?? '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
