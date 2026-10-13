import { isDefaultPlayerName } from '../api/contract';
import { load, save, STORAGE_KEYS } from '../storage';
import { bestPerPlayer, isToday, type LeaderboardEntry, type LeaderboardService, type NewEntry } from './types';

const MAX_ENTRIES = 500;

/**
 * Alle Runs dieses Browsers. Runs ohne eigenen Namen („Trainer" bzw. leer – von vor der
 * Namenspflicht) werden dabei endgültig gelöscht, wie online (cleanupDefaultNames): beim ersten
 * Lesen danach, weil neue Runs immer einen Namen haben.
 */
function readAll(): LeaderboardEntry[] {
  const stored = load<LeaderboardEntry[]>(STORAGE_KEYS.leaderboard, []);
  const all = Array.isArray(stored) ? stored : [];
  const named = all.filter((e) => !isDefaultPlayerName(e?.player));
  if (named.length !== all.length) writeAll(named);
  return named;
}

function writeAll(entries: LeaderboardEntry[]) {
  save(STORAGE_KEYS.leaderboard, entries.slice(-MAX_ENTRIES));
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Rein lokale Rangliste – alle Runs dieses Browsers. */
export const localLeaderboard: LeaderboardService = {
  kind: 'local',
  requiresLogin: false,
  isLoggedIn: () => true,

  async submit(entry: NewEntry) {
    const full: LeaderboardEntry = { ...entry, id: newId(), createdAt: new Date().toISOString() };
    writeAll([...readAll(), full]);
    return full;
  },

  async rename(id: string, player: string) {
    writeAll(readAll().map((e) => (e.id === id ? { ...e, player } : e)));
  },

  async top(challenge, period, limit = 50) {
    // „Heute" = Berliner Kalendertag – wie das Label und die Online-Tageswertung.
    // Runs ohne eigenen Namen („Trainer") gibt es nicht mehr (readAll) – wie online.
    const now = new Date();
    const entries = readAll().filter(
      (e) => e.challenge === challenge && (period === 'all' || isToday(e.createdAt, now)),
    );
    return bestPerPlayer(entries).slice(0, limit);
  },
};
