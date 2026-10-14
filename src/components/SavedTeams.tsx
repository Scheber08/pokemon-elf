import { useState } from 'react';
import { useT } from '../i18n';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { useToast } from '../state/Toast';

/** Gespeicherte Elf im Builder (nur dieses Gerät) */
export interface SavedTeam<T> {
  id: string;
  name: string;
  formation: string;
  /** Zeitpunkt des Speicherns (ms) */
  at: number;
  state: T;
}

/** So viele Elfen lassen sich speichern */
export const SAVED_TEAMS_MAX = 5;

/** Gespeicherte Elfen lesen – kaputte Einträge fallen weg. */
export function loadSavedTeams<T>(): SavedTeam<T>[] {
  const raw = load<unknown>(STORAGE_KEYS.savedTeams, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (x): x is SavedTeam<T> =>
        !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.formation === 'string' && !!x.state,
    )
    .slice(0, SAVED_TEAMS_MAX);
}

/**
 * Elf speichern: gleicher Name (ohne Groß/klein) ersetzt den Eintrag, neue kommen nach vorn;
 * ist die Liste voll, fällt die älteste weg. Liefert die neue Liste.
 */
export function withSavedTeam<T>(list: SavedTeam<T>[], entry: SavedTeam<T>): SavedTeam<T>[] {
  const key = entry.name.trim().toLowerCase();
  const rest = list.filter((x) => x.name.trim().toLowerCase() !== key);
  return [entry, ...rest].slice(0, SAVED_TEAMS_MAX);
}

interface Props<T extends { teamName: string; formation: string }> {
  current: T;
  onLoad: (state: T) => void;
}

/** „Meine Teams": aktuelle Elf speichern, gespeicherte laden oder löschen (localStorage). */
export function SavedTeams<T extends { teamName: string; formation: string }>({ current, onLoad }: Props<T>) {
  const t = useT();
  const tx = t.builder.saved;
  const toast = useToast();
  const [list, setList] = useState<SavedTeam<T>[]>(() => loadSavedTeams<T>());
  const persist = (next: SavedTeam<T>[]) => {
    setList(next);
    save(STORAGE_KEYS.savedTeams, next);
  };

  const store = () => {
    const name = current.teamName.trim() || tx.unnamed(list.length + 1);
    const replaced = list.some((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    const now = Date.now();
    persist(withSavedTeam(list, { id: `${now}`, name, formation: current.formation, at: now, state: current }));
    toast(replaced ? tx.updated(name) : tx.saved(name));
  };

  return (
    <div className="field saved-teams">
      <span className="field__label">
        {tx.title} <small>{tx.note(SAVED_TEAMS_MAX)}</small>
      </span>
      {list.length > 0 && (
        <ul className="saved-teams__list">
          {list.map((x) => (
            <li key={x.id} className="saved-teams__item">
              <span className="saved-teams__name">
                {x.name} <small className="muted">{x.formation}</small>
              </span>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  onLoad(x.state);
                  toast(tx.loaded(x.name));
                }}
              >
                {tx.load}
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost saved-teams__remove"
                aria-label={tx.removeAria(x.name)}
                title={tx.remove}
                onClick={() => persist(list.filter((y) => y.id !== x.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--small" onClick={store}>
        {tx.save}
      </button>
    </div>
  );
}
