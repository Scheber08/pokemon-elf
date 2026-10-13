import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { localLeaderboard } from '../src/lib/leaderboard/local';
import { isToday, type LeaderboardEntry } from '../src/lib/leaderboard/types';
import { STORAGE_KEYS } from '../src/lib/storage';

/** Gerätezeitzone fern von Berlin – „Heute" darf trotzdem nur der Berliner Tag sein. */
const originalTz = process.env.TZ;
const setTz = (tz: string | undefined) => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
};

beforeAll(() => setTz('America/New_York'));
afterAll(() => setTz(originalTz));

describe('isToday (Berliner Kalendertag)', () => {
  it('Gerät in New York: Run vom Berliner Vortag gehört nicht zu „Heute"', () => {
    // 01:00 UTC = 03:00 Berlin am 13.10., aber erst 21:00 am 12.10. in New York
    const now = new Date('2026-10-13T01:00:00Z');
    expect(new Date('2026-10-12T20:00:00Z').getDate()).toBe(12); // Gerät: gleicher Ortstag wie now
    expect(isToday('2026-10-12T20:00:00Z', now)).toBe(false); // Berlin: 12.10., 22:00
    expect(isToday('2026-10-12T22:30:00Z', now)).toBe(true); // Berlin: 13.10., 00:30
    expect(isToday('2026-10-13T00:59:00Z', now)).toBe(true);
  });

  it('Gerät in Tokio: Run vom selben Berliner Tag zählt, obwohl lokal schon morgen', () => {
    setTz('Asia/Tokyo');
    try {
      // 16:00 UTC = 18:00 Berlin am 12.10., in Tokio schon 01:00 am 13.10.
      const now = new Date('2026-10-12T16:00:00Z');
      expect(isToday('2026-10-12T14:00:00Z', now)).toBe(true); // Tokio: 12.10. 23:00, Berlin 16:00
      expect(isToday('2026-10-11T21:59:00Z', now)).toBe(false); // Berlin: 11.10., 23:59
      expect(isToday('2026-10-11T22:00:00Z', now)).toBe(true); // Berlin: 12.10., 00:00
    } finally {
      setTz('America/New_York');
    }
  });

  it('ungültige Zeitstempel sind nie „heute"', () => {
    expect(isToday('kaputt', new Date('2026-10-12T12:00:00Z'))).toBe(false);
    expect(isToday('', new Date('2026-10-12T12:00:00Z'))).toBe(false);
  });
});

describe('lokale Rangliste – Zeitraum „Heute"', () => {
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  const entry = (id: string, player: string, points: number, createdAt: string): LeaderboardEntry => ({
    id,
    challenge: 'daily',
    player,
    record: { w: 0, d: 0, l: 0 },
    points,
    score: 500,
    formation: '4-3-3' as LeaderboardEntry['formation'],
    lineup: [],
    teamName: '',
    createdAt,
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    store.clear();
  });

  it('zeigt nur Runs des aktuellen Berliner Tags – passend zum Label', async () => {
    vi.stubGlobal('localStorage', fakeStorage);
    store.set(
      `pokemon-elf:${STORAGE_KEYS.leaderboard}`,
      JSON.stringify([
        entry('a', 'Ash', 90, '2026-10-12T20:00:00Z'), // Berlin 12.10. – gestern
        entry('b', 'Misty', 60, '2026-10-12T22:30:00Z'), // Berlin 13.10. – heute
        entry('c', 'Rocko', 30, '2026-10-13T00:45:00Z'), // Berlin 13.10. – heute
      ]),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T01:00:00Z')); // New York: noch 12.10.

    const today = await localLeaderboard.top('daily', 'today');
    expect(today.map((e) => e.id)).toEqual(['b', 'c']);
    const all = await localLeaderboard.top('daily', 'all');
    expect(all.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('Einträge ohne eigenen Namen („Trainer", leer) werden gelöscht – nicht umbenannt, nicht gezeigt', async () => {
    vi.stubGlobal('localStorage', fakeStorage);
    const key = `pokemon-elf:${STORAGE_KEYS.leaderboard}`;
    store.set(
      key,
      JSON.stringify([
        entry('a', 'Trainer', 99, '2026-10-12T20:00:00Z'),
        entry('b', '  trainer ', 98, '2026-10-12T20:00:00Z'),
        entry('c', '', 97, '2026-10-12T20:00:00Z'),
        entry('d', 'Misty', 60, '2026-10-12T20:00:00Z'),
        entry('e', 'Trainer Rot', 50, '2026-10-12T20:00:00Z'),
        entry('f', 'Trainer\uFE0F', 45, '2026-10-12T20:00:00Z'),
      ]),
    );
    const all = await localLeaderboard.top('daily', 'all');
    expect(all.map((e) => [e.id, e.player])).toEqual([
      ['d', 'Misty'],
      ['e', 'Trainer Rot'],
    ]);
    // Endgültig aus der Historie entfernt (wie online) – beim ersten Lesen
    const stored = () => (JSON.parse(store.get(key) ?? '[]') as LeaderboardEntry[]).map((e) => e.id);
    expect(stored()).toEqual(['d', 'e']);

    // Ein neuer Run mit Namen ändert die alten Einträge nicht.
    const fresh = await localLeaderboard.submit({ ...entry('x', 'Ash', 70, ''), id: undefined } as never);
    expect(stored()).toEqual(['d', 'e', fresh.id]);
    expect((await localLeaderboard.top('daily', 'all')).map((e) => e.player)).toEqual(['Ash', 'Misty', 'Trainer Rot']);
  });
});
