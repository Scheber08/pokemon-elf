import type { ChallengeKey, FormationId, Record3 } from '../../types';

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

/**
 * Austauschbare Ranglisten-Schnittstelle. Heute lokal (localStorage),
 * später z. B. Supabase – die UI spricht nur mit diesem Interface.
 */
export interface LeaderboardService {
  readonly kind: 'local' | 'remote';
  /** true, wenn man sich für Einträge anmelden muss */
  readonly requiresLogin: boolean;
  isLoggedIn(): boolean;
  submit(entry: NewEntry): Promise<LeaderboardEntry>;
  rename(id: string, player: string): Promise<void>;
  /** Bester Eintrag je Spieler, sortiert. */
  top(challenge: ChallengeKey, period: Period, limit?: number): Promise<LeaderboardEntry[]>;
}

export const CHALLENGE_LABEL: Record<ChallengeKey, string> = {
  c340: '34–0 Challenge',
  retro340: 'Retro 34–0',
  c151: '151 Challenge',
};

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

export function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
