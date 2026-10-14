/** Erfolge: Definitionen, Kennzahlen aus D1, POST /api/me und die Abschlüsse fertiger Online-Ligen. */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, achievementStates, earnedCoins, longestDayStreak, type AchievementStats } from '../src/lib/achievements';
import type { MeResponse } from '../src/lib/api/contract';
import { DEFAULT_LOOK, lockedItem, parseLook, TRAINER_ITEMS, TRAINER_SLOTS } from '../src/lib/trainer';
import { achievementStats, saveDraftResults } from '../server/achievements';
import { handleApi } from '../server/handler';
import { ensureSchema } from '../server/schema';
import { D1Shim } from './d1shim';

const EMPTY: AchievementStats = {
  runs: 0,
  challenges: {},
  dailyDays: 0,
  dailyStreak: 0,
  dailyWins: 0,
  bestPlace: null,
  draft: { leagues: 0, titles: 0, cups: 0, manager: 0, podiums: 0 },
};

const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

function addEntry(db: D1Shim, dev: string, challenge: string, day: string, w: number, d: number, l: number, scopes: string[] = []) {
  const id = crypto.randomUUID();
  db.update(
    `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name, score, wins, draws, losses, points, season_seed, created_at)
     VALUES (?, ?, ?, ?, '4-3-3', 0, '[]', '[]', 'Elf', 700, ?, ?, ?, ?, 1, 0)`,
    id, dev, challenge, day, w, d, l, w * 3 + d,
  );
  for (const scope of scopes) {
    db.update(
      'INSERT OR REPLACE INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at) VALUES (?, ?, ?, ?, ?, 700, 0)',
      challenge, scope, dev, id, w * 3 + d,
    );
  }
}

describe('Trainer-Katalog', () => {
  it('Standard-Look ist frei, Schlüssel eindeutig, jeder Slot hat etwas Freies', () => {
    expect(lockedItem(DEFAULT_LOOK, new Set())).toBeNull();
    expect(new Set(TRAINER_ITEMS.map((i) => `${i.slot}:${i.id}`)).size).toBe(TRAINER_ITEMS.length);
    for (const slot of TRAINER_SLOTS) expect(TRAINER_ITEMS.some((i) => i.slot === slot && i.price === 0)).toBe(true);
    expect(parseLook(null)).toEqual(DEFAULT_LOOK);
    expect(parseLook({ hat: 'crown', skin: 7 })).toEqual({ ...DEFAULT_LOOK, hat: 'crown' });
    expect(lockedItem({ ...DEFAULT_LOOK, hat: 'crown' }, new Set())).toBe('hat:crown');
    expect(lockedItem({ ...DEFAULT_LOOK, hat: 'crown' }, new Set(['hat:crown']))).toBeNull();
  });
});

describe('Definitionen', () => {
  it('eindeutige IDs, Ziele und Münzen positiv', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.every((a) => a.goal > 0 && a.coins > 0)).toBe(true);
    expect(earnedCoins(EMPTY)).toBe(0);
    expect(achievementStates(EMPTY).every((a) => !a.done && a.value === 0)).toBe(true);
  });

  it('Fortschritt bis zum Ziel, Münzen nur für erreichte', () => {
    const s: AchievementStats = { ...EMPTY, runs: 12, challenges: { c340: { runs: 12, bestWins: 34, perfect: 1 } }, bestPlace: 7 };
    const st = Object.fromEntries(achievementStates(s).map((a) => [a.id, a]));
    expect(st.runs_10).toMatchObject({ done: true, value: 10 });
    expect(st.runs_50).toMatchObject({ done: false, value: 12, goal: 50 });
    expect(st.c340_perfect.done).toBe(true);
    expect(st.top_10.done).toBe(true);
    expect(st.top_1.done).toBe(false);
    expect(earnedCoins(s)).toBe(50 + 100 + 100 + 200 + 500 + 100 + 300);
  });

  it('längste Tagesserie', () => {
    expect(longestDayStreak([])).toBe(0);
    expect(longestDayStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-03', '2026-10-03', '2026-10-10'])).toBe(4);
    expect(longestDayStreak(['2026-02-28', '2026-03-01'])).toBe(2);
  });
});

describe('Kennzahlen und /api/me', () => {
  it('aus Runs, Tageswertung und Online-Ligen', async () => {
    const db = new D1Shim();
    await ensureSchema(db);
    const dev = crypto.randomUUID();
    const rival = crypto.randomUUID();
    db.update("INSERT INTO devices (id, secret_hash, name, created_at) VALUES (?, 'x', 'Ash', 0)", dev);
    db.update("INSERT INTO devices (id, secret_hash, name, created_at) VALUES (?, 'x', 'Gary', 0)", rival);
    addEntry(db, dev, 'c340', '2026-10-01', 34, 0, 0, ['all']);
    addEntry(db, dev, 'c340', '2026-10-02', 28, 3, 3);
    // Tägliche Elf: drei Tage am Stück, Tagessieg am 12., am 13. nur Zweiter, heute (14.) zählt noch nicht
    addEntry(db, dev, 'daily', '2026-10-12', 30, 2, 2, ['2026-10-12', 'all']);
    addEntry(db, rival, 'daily', '2026-10-13', 33, 1, 0, ['2026-10-13']);
    addEntry(db, dev, 'daily', '2026-10-13', 20, 2, 12, ['2026-10-13']);
    addEntry(db, dev, 'daily', '2026-10-14', 31, 0, 3, ['2026-10-14']);
    await saveDraftResults(
      db,
      {
        code: 'ABC234',
        settings: { format: 'cup' } as never,
        teams: [
          { id: 'h', cpu: false } as never,
          { id: 'c', cpu: true } as never,
        ],
        owners: { h: dev },
        league: { teams: [{ name: 'H', rating: 1 }, { name: 'C', rating: 1 }], matches: [], table: [
          { team: 0, name: 'H', rating: 1, isUser: false, played: 4, w: 4, d: 0, l: 0, gf: 8, ga: 1, gd: 7, pts: 12 },
          { team: 1, name: 'C', rating: 1, isUser: false, played: 4, w: 2, d: 0, l: 2, gf: 5, ga: 5, gd: 0, pts: 6 },
        ] },
      },
      1,
    );
    const s = await achievementStats(db, dev, '2026-10-14');
    expect(s.runs).toBe(5);
    expect(s.challenges.c340).toEqual({ runs: 2, bestWins: 34, perfect: 1 });
    expect(s.dailyDays).toBe(3);
    expect(s.dailyStreak).toBe(3);
    expect(s.dailyWins).toBe(1);
    expect(s.bestPlace).toBe(1);
    expect(s.draft).toEqual({ leagues: 1, titles: 0, cups: 1, manager: 0, podiums: 1 });
    // Doppelt gespeichert (Neuversuch) zählt nicht doppelt
    expect(db.query('SELECT * FROM draft_results')).toHaveLength(1);
  });

  it('POST /api/me: Erfolge und Münzen des eigenen Geräts (neues Gerät: alles offen)', async () => {
    const db = new D1Shim();
    const auth = { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
    const call = () =>
      handleApi(new Request('http://localhost/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(auth) }), { DB: db });
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeResponse;
    expect(body.player).toBeNull();
    expect(body.coins).toEqual({ earned: 0, spent: 0, balance: 0 });
    expect(body.achievements).toHaveLength(ACHIEVEMENTS.length);
    addEntry(db, auth.deviceId, 'c151', '2026-10-01', 30, 2, 2);
    const again = (await (await call()).json()) as MeResponse;
    expect(again.achievements.filter((a) => a.done).map((a) => a.id).sort()).toEqual(['c151_30', 'first_run']);
    expect(again.coins.balance).toBe(250);
    // Falscher Schlüssel → 401
    const bad = await handleApi(
      new Request('http://localhost/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, deviceSecret: hex(32) }) }),
      { DB: db },
    );
    expect(bad.status).toBe(401);
  });

  it('Trainer: Freies speichern, Gesperrtes erst nach dem Kauf; Kauf nur mit genug Münzen (atomar, wiederholbar)', async () => {
    const db = new D1Shim();
    const auth = { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
    const post = async (path: string, extra: Record<string, unknown> = {}) => {
      const res = await handleApi(
        new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...extra }) }),
        { DB: db },
      );
      return { status: res.status, body: (await res.json()) as MeResponse & { error?: string } };
    };
    const first = await post('/me');
    expect(first.body.trainer).toEqual(DEFAULT_LOOK);
    expect(first.body.owned).toEqual([]);
    // Frei: speichern geht
    const free = await post('/me/trainer', { look: { ...DEFAULT_LOOK, hair: 'long', hairColor: 'blonde' } });
    expect(free.status).toBe(200);
    expect(free.body.trainer.hair).toBe('long');
    // Gesperrt: 400, nichts geändert
    const locked = await post('/me/trainer', { look: { ...DEFAULT_LOOK, hat: 'beanie' } });
    expect(locked).toMatchObject({ status: 400, body: { error: 'locked_item' } });
    expect((await post('/me')).body.trainer.hair).toBe('long');
    // Ohne Münzen kein Kauf; Unbekanntes bzw. Freies → 400
    expect(await post('/me/buy', { item: 'hat:beanie' })).toMatchObject({ status: 400, body: { error: 'not_enough_coins' } });
    expect((await post('/me/buy', { item: 'hat:zylinder' })).status).toBe(400);
    expect((await post('/me/buy', { item: 'hat:cap' })).status).toBe(400);
    // 250 Münzen verdient (erster Run + 30 Siege in der 151 Challenge)
    addEntry(db, auth.deviceId, 'c151', '2026-10-01', 30, 2, 2);
    const bought = await post('/me/buy', { item: 'hat:beanie' });
    expect(bought.status).toBe(200);
    expect(bought.body.owned).toEqual(['hat:beanie']);
    expect(bought.body.coins).toEqual({ earned: 250, spent: 150, balance: 100 });
    // Nochmal kaufen: nichts passiert; teurer als der Rest: nein
    expect((await post('/me/buy', { item: 'hat:beanie' })).body.coins.spent).toBe(150);
    expect(await post('/me/buy', { item: 'hat:pokecap' })).toMatchObject({ status: 400, body: { error: 'not_enough_coins' } });
    // Jetzt darf die Mütze getragen werden; Unbekanntes im Look wird zum Standard
    const worn = await post('/me/trainer', { look: { ...DEFAULT_LOOK, hat: 'beanie', title: 'quatsch' } });
    expect(worn.status).toBe(200);
    expect(worn.body.trainer).toMatchObject({ hat: 'beanie', title: DEFAULT_LOOK.title });
  });
});
