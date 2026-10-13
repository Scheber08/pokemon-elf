import { messages } from '../../i18n';
import type { ChallengeKey, FormationId, Record3 } from '../../types';
import { dayKey } from '../daily';

export interface LeaderboardEntry {
  id: string;
  challenge: ChallengeKey;
  player: string;
  record: Record3;
  points: number;
  score: number;
  formation: FormationId;
  /** 11 Pokémon-IDs (+ optional SS am Ende) */
  lineup: (number | null)[];
  teamName: string;
  /** ISO-Zeitstempel */
  createdAt: string;
}

export type NewEntry = Omit<LeaderboardEntry, 'id' | 'createdAt'>;

export type Period = 'today' | 'all';

/** Lokale Run-Historie (localStorage). Die Online-Rangliste: src/lib/api/client.ts. */
export interface LeaderboardService {
  readonly kind: 'local' | 'remote';
  /** true, wenn man sich für Einträge anmelden muss */
  readonly requiresLogin: boolean;
  isLoggedIn(): boolean;
  submit(entry: NewEntry): Promise<LeaderboardEntry>;
  rename(id: string, player: string): Promise<void>;
  /** Bester Eintrag je Spieler, sortiert – Einträge ohne eigenen Namen („Trainer") sind gelöscht. */
  top(challenge: ChallengeKey, period: Period, limit?: number): Promise<LeaderboardEntry[]>;
}

const CHALLENGE_KEYS: readonly ChallengeKey[] = ['c340', 'daily', 'retro340', 'c151'];

/**
 * Anzeigenamen der Challenges in der aktiven Sprache – liest bei jedem Zugriff
 * t.game.challenge (Quelle der Namen). In Komponenten besser direkt useT().game.challenge.
 */
export const CHALLENGE_LABEL: Readonly<Record<ChallengeKey, string>> = Object.freeze(
  Object.defineProperties(
    {} as Record<ChallengeKey, string>,
    Object.fromEntries(
      CHALLENGE_KEYS.map((k) => [k, { enumerable: true, get: () => messages().game.challenge[k] }]),
    ),
  ),
);

/** Sortierung: Punkte, dann Team-Score, dann früherer Eintrag. */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return b.points - a.points || b.score - a.score || a.createdAt.localeCompare(b.createdAt);
}

/** Behält pro Spieler (ohne Groß-/Kleinschreibung) nur den besten Eintrag. */
export function bestPerPlayer(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const e of entries) {
    const key = e.player.trim().toLowerCase();
    const cur = best.get(key);
    if (!cur || compareEntries(e, cur) < 0) best.set(key, e);
  }
  return [...best.values()].sort(compareEntries);
}

/**
 * Liegt der Zeitstempel am heutigen Tag der Tageswertung? Gezählt wird – wie beim Server
 * und im Label „Heute · …" – der Kalendertag in Berlin (dayKey), nicht der des Geräts.
 */
export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || Number.isNaN(now.getTime())) return false;
  return dayKey(d) === dayKey(now);
}
