import { lazy, Suspense, useState } from 'react';
import type { FormationId } from '../types';
import { useT } from '../i18n';
import { copyText } from '../lib/exportImage';
import { cleanJerseys } from '../lib/jerseys';
import { cleanKit } from '../lib/kits';
import { load, save, STORAGE_KEYS } from '../lib/storage';
import { shareUrl, type SharedLineup } from '../lib/urlState';
import { useSettings } from '../state/Settings';
import { useToast } from '../state/Toast';
import { cleanCheer } from '../lib/cheer';
import { cleanCrest } from '../lib/crest';

/** Testspiel erst beim Öffnen laden – es zieht die Draft-Engine mit, die der Builder sonst nicht braucht */
const FriendlyMatch = lazy(() => import('./FriendlyMatch').then((m) => ({ default: m.FriendlyMatch })));

/** „2026-10-16" – Kalendertag in der Zeitzone des Geräts */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
        !!x &&
        typeof x === 'object' &&
        typeof x.id === 'string' &&
        typeof x.name === 'string' &&
        typeof x.formation === 'string' &&
        !!x.state,
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

/** Felder, die ein Testspiel braucht (siehe Builder-Zustand) */
interface Playable {
  teamName: string;
  formation: string;
  slots?: (number | null)[];
  ss?: number | null;
  ssEnabled?: boolean;
}

interface Props<T extends Playable> {
  current: T;
  onLoad: (state: T) => void;
}

/** „Meine Teams": aktuelle Elf speichern, gespeicherte laden oder löschen (localStorage). */
export function SavedTeams<T extends Playable>({ current, onLoad }: Props<T>) {
  const t = useT();
  const tx = t.builder.saved;
  const toast = useToast();
  const { sprite } = useSettings();
  const [list, setList] = useState<SavedTeam<T>[]>(() => loadSavedTeams<T>());
  /** Testspiel der aktuellen Elf gegen diese gespeicherte (id) */
  const [vs, setVs] = useState<string | null>(null);
  const persist = (next: SavedTeam<T>[]) => {
    setList(next);
    save(STORAGE_KEYS.savedTeams, next);
  };

  const store = () => {
    const name = current.teamName.trim() || tx.unnamed(list.length + 1);
    const replaced = list.some((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    const now = Date.now();
    persist(
      withSavedTeam(list, {
        id: `${now}`,
        name,
        formation: current.formation,
        at: now,
        state: current,
      }),
    );
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
                {x.name}{' '}
                <small className="muted">
                  <span className="saved-teams__formation">{x.formation}</span>
                  {/* Speicherdatum (lokaler Kalendertag) */}
                  {x.at > 0 && <span className="saved-teams__at"> · {t.game.day(localDay(x.at))}</span>}
                  {/* Steht genau diese Elf gerade im Builder? (Formation und Aufstellung – ohne Namen speichert der Builder „Team n“) */}
                  {x.formation === current.formation && JSON.stringify(x.state.slots ?? []) === JSON.stringify(current.slots ?? []) && (
                    <span className="saved-teams__current"> · {tx.current}</span>
                  )}
                </small>
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
                className="btn btn--small btn--ghost"
                title={tx.linkTitle(x.name)}
                onClick={async () => {
                  // Gespeicherter Builder-Zustand hat alle Felder des Teilen-Links
                  const lineup = x.state as unknown as SharedLineup;
                  const url = shareUrl({ ...lineup, sprite, ss: lineup.ssEnabled ? (lineup.ss ?? null) : null });
                  toast((await copyText(url)) ? t.common.linkCopied : t.common.copyFailed);
                }}
              >
                {tx.link}
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                aria-pressed={vs === x.id}
                title={tx.friendlyTitle(x.name)}
                onClick={() => setVs((v) => (v === x.id ? null : x.id))}
              >
                {tx.friendly}
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
      {(() => {
        const opp = list.find((x) => x.id === vs);
        if (!opp?.state.slots) return null;
        return (
          <Suspense fallback={<p className="muted small">{tx.loadingFriendly}</p>}>
            <FriendlyMatch
              key={opp.id}
              opponent={{
                name: opp.name,
                formation: opp.formation as FormationId,
                slots: opp.state.slots,
                ss: opp.state.ssEnabled ? (opp.state.ss ?? null) : null,
                jerseys: cleanJerseys((opp.state as { jerseys?: unknown }).jerseys),
                kit: cleanKit((opp.state as { kit?: unknown }).kit),
                cheer: cleanCheer((opp.state as { cheer?: unknown }).cheer),
                crest: cleanCrest((opp.state as { crest?: unknown }).crest),
                captain: typeof (opp.state as { captain?: unknown }).captain === 'number' ? ((opp.state as { captain?: number }).captain ?? null) : null,
              }}
            />
          </Suspense>
        );
      })()}
      <button type="button" className="btn btn--small" onClick={store}>
        {tx.save}
      </button>
    </div>
  );
}
