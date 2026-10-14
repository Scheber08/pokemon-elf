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
  draft: { leagues: 0, titles: 0, cups: 0, manager: 0, podiums: 0, unbeaten: 0, seasons: 0 },
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

describe('Erfolgs-Texte', () => {
  it('jeder Erfolg hat einen eigenen Namen (DE und EN)', async () => {
    for (const lang of ['de', 'en'] as const) {
      const { default: tr } = await import(`../src/i18n/${lang}/trainer.ts`);
      const names = ACHIEVEMENTS.map((a) => tr.list[a.id]?.name);
      expect(names.every(Boolean)).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

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

  it('jeder Titel hat einen Text (DE und EN)', async () => {
    for (const lang of ['de', 'en'] as const) {
      const { default: tr } = await import(`../src/i18n/${lang}/trainer.ts`);
      for (const i of TRAINER_ITEMS.filter((x) => x.slot === 'title')) expect(tr.titles[i.id], `${lang}:${i.id}`).toBeTruthy();
    }
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
    expect(s.draft).toEqual({ leagues: 1, titles: 0, cups: 1, manager: 0, podiums: 1, unbeaten: 0, seasons: 0 });
    // Doppelt gespeichert (Neuversuch) zählt nicht doppelt
    expect(db.query('SELECT * FROM draft_results')).toHaveLength(1);
    // Manager-Saison als Zweiter: zählt als Saison, nicht als Titel
    await saveDraftResults(
      db,
      {
        code: 'MGR234',
        settings: { format: 'manager' } as never,
        teams: [{ id: 'c', cpu: true } as never, { id: 'h', cpu: false } as never],
        owners: { h: dev },
        league: { teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }], matches: [], table: [
          { team: 0, name: 'C', rating: 1, isUser: false, played: 2, w: 2, d: 0, l: 0, gf: 4, ga: 1, gd: 3, pts: 6 },
          { team: 1, name: 'H', rating: 1, isUser: false, played: 2, w: 0, d: 0, l: 2, gf: 1, ga: 4, gd: -3, pts: 0 },
        ] },
      },
      2,
    );
    const m = await achievementStats(db, dev, '2026-10-14');
    expect(m.draft).toMatchObject({ leagues: 2, manager: 0, seasons: 1 });
    expect(achievementStates(m).find((a) => a.id === 'manager_first')?.done).toBe(true);
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
    // Andere sehen den Trainer in der Rangliste und im Profil (mit eigenem Namen)
    expect((await post('/player', { player: 'Ash' })).status).toBe(200);
    addEntry(db, auth.deviceId, 'c340', '2026-10-02', 31, 1, 2, ['all']);
    const board = (await (await handleApi(new Request('http://localhost/api/leaderboard?challenge=c340&period=all'), { DB: db })).json()) as {
      rows: { entryId: string; trainer?: unknown }[];
    };
    expect(board.rows[0].trainer).toMatchObject({ hat: 'beanie' });
    const profile = (await (await handleApi(new Request(`http://localhost/api/entries/${board.rows[0].entryId}/player`), { DB: db })).json()) as {
      trainer?: unknown;
    };
    expect(profile.trainer).toMatchObject({ hat: 'beanie' });
  });
});

describe('Trainer im Online-Draft', () => {
  it('beim Anmelden bzw. Beitreten hängt der Trainer am eigenen Team (Schnappschuss zeigt ihn)', async () => {
    const { FakeNamespace, FakeRoom } = await import('./fakeSocket');
    const { ALL } = await import('./helpers');
    const { buildScale } = await import('../src/lib/fit');
    const db = new D1Shim();
    await ensureSchema(db);
    const drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, buildScale(ALL, 'all')));
    const env = { DB: db, DRAFTS: drafts };
    const host = { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
    const guest = { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
    const look = { ...DEFAULT_LOOK, hat: 'crown', companion: '25' };
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...host, settings: { pickSeconds: 0 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as { code: string };
    db.update('INSERT INTO trainers (device_id, look_json, updated_at) VALUES (?, ?, 0)', host.deviceId, JSON.stringify(look));
    db.update('INSERT INTO trainers (device_id, look_json, updated_at) VALUES (?, ?, 0)', guest.deviceId, JSON.stringify({ ...DEFAULT_LOOK, hair: 'long' }));
    const room = drafts.room(code);
    const a = room.connect(null);
    await room.send(a, { type: 'hello', ...host });
    expect(room.stored!.state.teams[0].trainer).toEqual(look);
    expect(a.state!.teams[0].trainer).toEqual(look);
    const b = room.connect(null);
    await room.send(b, { type: 'hello', ...guest });
    await room.send(b, { type: 'join', teamName: 'Gast-Elf', formation: '4-4-2' });
    expect(room.stored!.state.teams[1].trainer).toMatchObject({ hair: 'long' });
  });
});

describe('Pixel-Trainer', () => {
  it('jeder Katalog-Eintrag ergibt ein volles 32×32-Raster (Hintergrund deckt alles), gleiches Aussehen → gleiches Raster', async () => {
    const { trainerPixels, pixelRuns, PX } = await import('../src/lib/trainerPixels');
    for (const it of TRAINER_ITEMS) {
      const grid = trainerPixels({ ...DEFAULT_LOOK, [it.slot]: it.id });
      expect(grid).toHaveLength(PX);
      expect(grid.every((row) => row.length === PX && row.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)))).toBe(true);
    }
    const a = pixelRuns(trainerPixels({ ...DEFAULT_LOOK, hat: 'crown' }));
    expect(a.reduce((n, r) => n + r.w, 0)).toBe(PX * PX);
    // Alte gespeicherte Looks ohne „face" bekommen den Standard
    expect(parseLook({ hair: 'long' }).face).toBe('smile');
  });
});

describe('Zufälliger Trainer', () => {
  it('nur Freies und Gekauftes – immer speicherbar', async () => {
    const { randomLook } = await import('../src/components/TrainerEditor');
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const owned = new Set(['hat:crown']);
    let crowns = 0;
    for (let i = 0; i < 200; i++) {
      const look = randomLook(owned, rnd);
      expect(lockedItem(look, owned)).toBeNull();
      if (look.hat === 'crown') crowns++;
    }
    expect(crowns).toBeGreaterThan(0);
  });
});
