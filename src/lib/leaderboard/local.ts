import { load, save, STORAGE_KEYS } from '../storage';
import { bestPerPlayer, isToday, type LeaderboardEntry, type LeaderboardService, type NewEntry } from './types';

const MAX_ENTRIES = 500;

function readAll(): LeaderboardEntry[] {
  return load<LeaderboardEntry[]>(STORAGE_KEYS.leaderboard, []);
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
    // „Heute" = Berliner Kalendertag – wie das Label und die Online-Tageswertung
    const now = new Date();
    const entries = readAll().filter(
      (e) => e.challenge === challenge && (period === 'all' || isToday(e.createdAt, now)),
    );
    return bestPerPlayer(entries).slice(0, limit);
  },
};
