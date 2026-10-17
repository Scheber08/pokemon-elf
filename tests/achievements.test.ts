/** Erfolge: Definitionen, Kennzahlen aus D1, POST /api/me und die Abschlüsse fertiger Online-Ligen. */
import { describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENTS, achievementStates, earnedCoins, longestDayStreak, type AchievementStats } from '../src/lib/achievements';
import type { MeResponse } from '../src/lib/api/contract';
import { affordableCount, DEFAULT_LOOK, nextGoal, itemOnSale, lockedItem, nextSeason, parseLook, shopCollection, TRAINER_ITEMS, TRAINER_SLOTS } from '../src/lib/trainer';
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
  draft: { leagues: 0, titles: 0, cups: 0, manager: 0, podiums: 0, unbeaten: 0, seasons: 0, managerPodiums: 0 },
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

  it('Tages-Serie in Stufen 3/7/14/30: 14 Tage erreichen die neue Stufe, 13 noch nicht', () => {
    const ids = ACHIEVEMENTS.filter((a) => a.id.startsWith('daily_streak_')).map((a) => a.goal);
    expect(ids).toEqual([3, 7, 14, 30]);
    const state = (n: number) => achievementStates({ ...EMPTY, dailyStreak: n }).find((a) => a.id === 'daily_streak_14')!;
    expect(state(13)).toMatchObject({ done: false, value: 13, goal: 14 });
    expect(state(14).done).toBe(true);
  });

  it('Online-Ligen in Stufen 1/5/20/50: 50 beendete Ligen erreichen die neue Stufe', () => {
    expect(ACHIEVEMENTS.filter((a) => a.id === 'draft_first' || /^draft_\d+$/.test(a.id)).map((a) => a.goal)).toEqual([1, 5, 20, 50]);
    const state = (n: number) => achievementStates({ ...EMPTY, draft: { ...EMPTY.draft, leagues: n } }).find((a) => a.id === 'draft_50')!;
    expect(state(49)).toMatchObject({ done: false, value: 49, goal: 50, coins: 1200 });
    expect(state(50).done).toBe(true);
  });

  it('Run-Stufen 10/50/200/500: 500 Runs erreichen die neue Stufe, 499 noch nicht', () => {
    expect(ACHIEVEMENTS.filter((a) => /^runs_\d+$/.test(a.id)).map((a) => a.goal)).toEqual([10, 50, 200, 500]);
    const state = (n: number) => achievementStates({ ...EMPTY, runs: n }).find((a) => a.id === 'runs_500')!;
    expect(state(499)).toMatchObject({ done: false, value: 499, goal: 500, coins: 1200 });
    expect(state(500).done).toBe(true);
  });

  it('Siege-Stufen 25/30 in allen drei Challenges (aus dem besten Run)', () => {
    for (const c of ['c340', 'retro340', 'c151'] as const) {
      expect(ACHIEVEMENTS.filter((a) => a.id === `${c}_25` || a.id === `${c}_30`).map((a) => [a.id, a.goal, a.coins])).toEqual([
        [`${c}_25`, 25, 100],
        [`${c}_30`, 30, 200],
      ]);
      const state = (wins: number) =>
        achievementStates({ ...EMPTY, runs: 1, challenges: { [c]: { runs: 1, bestWins: wins, perfect: 0 } } }).find((a) => a.id === `${c}_25`)!;
      expect(state(24)).toMatchObject({ done: false, value: 24 });
      expect(state(25).done).toBe(true);
    }
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
    expect(s.draft).toEqual({ leagues: 1, titles: 0, cups: 1, manager: 0, podiums: 1, unbeaten: 0, seasons: 0, managerPodiums: 0, managerCups: 0, shinies: 0, captainGoals: 0, blitz: 0, cleanSheets: 0, mostGoals: 8, hatTricks: 0, goalsReached: 0, duo: 0, winStreak: 0, bigWin: 0 });
    // Doppelt gespeichert (Neuversuch) zählt nicht doppelt
    // (Liga-Zeile plus Zusatzzeile „#goals“ für die Torfabrik)
    expect(db.query('SELECT code FROM draft_results ORDER BY code').map((r) => (r as { code: string }).code)).toEqual(['ABC234', 'ABC234#goals']);
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
    expect(m.draft).toMatchObject({ leagues: 2, manager: 0, seasons: 1, managerPodiums: 1 });
    expect(achievementStates(m).find((a) => a.id === 'manager_first')?.done).toBe(true);
    expect(achievementStates(m).find((a) => a.id === 'manager_cup')?.done).toBe(false);
    // Pokalsieg (Manager-Saison): eigene Zeile, zählt nur für den Pokal – nicht als Liga oder Treppchen
    await saveDraftResults(
      db,
      {
        code: 'CUP234',
        settings: { format: 'manager' } as never,
        teams: [{ id: 'c', cpu: true } as never, { id: 'h', cpu: false } as never],
        owners: { h: dev },
        league: { teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }], matches: [], table: [
          { team: 0, name: 'C', rating: 1, isUser: false, played: 2, w: 2, d: 0, l: 0, gf: 4, ga: 1, gd: 3, pts: 6 },
          { team: 1, name: 'H', rating: 1, isUser: false, played: 2, w: 0, d: 0, l: 2, gf: 1, ga: 4, gd: -3, pts: 0 },
        ] },
        manager: {
          cup: {
            bracket: [0, 1],
            rounds: [{ stage: 'final', round: 16, ties: [{ home: 0, away: 1, winner: 1, pens: null }] }],
            matches: [{ round: 16, home: 0, away: 1, hg: 0, ag: 1, homeScorers: [], awayScorers: [] }],
          },
        } as never,
      },
      3,
    );
    const c = await achievementStats(db, dev, '2026-10-14');
    expect(c.draft).toMatchObject({ leagues: 3, seasons: 2, managerPodiums: 2, managerCups: 1, podiums: 3 });
    expect(achievementStates(c).find((a) => a.id === 'manager_cup')?.done).toBe(true);
    // Shiny im Kader am Ende: eigene Zeile, zählt nur für den Shiny-Erfolg
    await saveDraftResults(
      db,
      {
        code: 'SHI234',
        settings: { format: 'league' } as never,
        teams: [{ id: 'c', cpu: true, slots: [], ss: null } as never, { id: 'h', cpu: false, slots: [129, 1], ss: null } as never],
        owners: { h: dev },
        league: { teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }], matches: [], table: [
          { team: 0, name: 'C', rating: 1, isUser: false, played: 2, w: 2, d: 0, l: 0, gf: 4, ga: 1, gd: 3, pts: 6 },
          { team: 1, name: 'H', rating: 1, isUser: false, played: 2, w: 0, d: 0, l: 2, gf: 1, ga: 4, gd: -3, pts: 0 },
        ] },
        shinies: [129],
      },
      4,
    );
    const sh = await achievementStats(db, dev, '2026-10-14');
    expect(sh.draft).toMatchObject({ leagues: 4, shinies: 1, podiums: 4 });
    expect(achievementStates(sh).find((a) => a.id === 'shiny_first')?.done).toBe(true);
    const collector = achievementStates(sh).find((a) => a.id === 'shiny_5');
    expect(collector).toMatchObject({ done: false, value: 1, goal: 5 });
    // Kapitänstore: eigene Zeile (Maximum über die Ligen), zählt nicht als Liga
    // Die ersten drei Tore jedes Spiels legt Pokémon 1 auf (Traumduo 1 → 129: 6 gemeinsame Tore)
    const goal = (n: number) => Array.from({ length: n }, (_, k) => ({ pokemonId: 129, pos: 'ST', minute: 10, ...(k < 3 ? { assist: 1 } : {}) }));
    await saveDraftResults(
      db,
      {
        code: 'CAP234',
        settings: { format: 'league' } as never,
        teams: [{ id: 'c', cpu: true, slots: [], ss: null } as never, { id: 'h', cpu: false, slots: [129, 1], ss: null, captain: 129, goal: 'title' } as never],
        owners: { h: dev },
        // Blitz-Picks: 6 eigene Picks je 2 s nach dem vorigen, dazu ein langsamer und automatische CPU-Picks
        picks: [
          { pick: 0, teamId: 'c', pokemonId: 1, slot: 0, auto: true, at: 0 },
          ...Array.from({ length: 6 }, (_, k) => ({ pick: k + 1, teamId: 'h', pokemonId: 10 + k, slot: k, auto: false, at: 2_000 * (k + 1) })),
          { pick: 7, teamId: 'c', pokemonId: 2, slot: 1, auto: true, at: 13_000 },
          { pick: 8, teamId: 'h', pokemonId: 20, slot: 6, auto: false, at: 40_000 },
        ],
        league: {
          teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }],
          matches: [
            { round: 1, home: 1, away: 0, hg: 6, ag: 0, homeScorers: goal(6), awayScorers: [] },
            { round: 2, home: 0, away: 1, hg: 0, ag: 5, homeScorers: [], awayScorers: goal(5) },
          ],
          table: [
            { team: 1, name: 'H', rating: 1, isUser: false, played: 2, w: 2, d: 0, l: 0, gf: 11, ga: 0, gd: 11, pts: 6 },
            { team: 0, name: 'C', rating: 1, isUser: false, played: 2, w: 0, d: 0, l: 2, gf: 0, ga: 11, gd: -11, pts: 0 },
          ],
        } as never,
      },
      5,
    );
    const cap = await achievementStats(db, dev, '2026-10-14');
    expect(cap.draft).toMatchObject({ leagues: 5, captainGoals: 11, goalsReached: 1, blitz: 6, podiums: 5, cleanSheets: 2 });
    expect(achievementStates(cap).find((a) => a.id === 'clean_10')).toMatchObject({ done: false, value: 2, goal: 10 });
    // Hattrick-Held: der Kapitän trifft in beiden Spielen mindestens dreimal (6 bzw. 5 Tore) → zwei Hattricks
    expect(cap.draft.hatTricks).toBe(2);
    expect(achievementStates(cap).find((a) => a.id === 'hattrick_1')?.done).toBe(true);
    // Traumduo: 6 Tore derselben Vorlage-Kombination (zählt nicht als Liga)
    expect(cap.draft.duo).toBe(6);
    expect(achievementStates(cap).find((a) => a.id === 'duo_5')?.done).toBe(true);
    // Siegesserie: zwei Siege in Folge (Ziel 7)
    expect(cap.draft.winStreak).toBe(2);
    expect(achievementStates(cap).find((a) => a.id === 'streak_7')).toMatchObject({ done: false, value: 2, goal: 7 });
    // Schützenfest: höchster Sieg 6:0 (zählt nicht als Liga)
    expect(cap.draft.bigWin).toBe(6);
    expect(achievementStates(cap).find((a) => a.id === 'rout_5')?.done).toBe(true);
    // Bollwerk: 10 Spiele ohne Gegentor in einer Liga
    await saveDraftResults(
      db,
      {
        code: 'CLN234',
        settings: { format: 'league' } as never,
        teams: [{ id: 'c', cpu: true, slots: [], ss: null } as never, { id: 'h', cpu: false, slots: [1], ss: null } as never],
        owners: { h: dev },
        league: {
          teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }],
          matches: Array.from({ length: 10 }, (_, k) => (k % 2 ? { round: k + 1, home: 0, away: 1, hg: 0, ag: 1, homeScorers: [], awayScorers: goal(1) } : { round: k + 1, home: 1, away: 0, hg: 1, ag: 0, homeScorers: goal(1), awayScorers: [] })),
          table: [
            { team: 1, name: 'H', rating: 1, isUser: false, played: 10, w: 10, d: 0, l: 0, gf: 10, ga: 0, gd: 10, pts: 30 },
            { team: 0, name: 'C', rating: 1, isUser: false, played: 10, w: 0, d: 0, l: 10, gf: 0, ga: 10, gd: -10, pts: 0 },
          ],
        } as never,
      },
      6,
    );
    const fortress = await achievementStats(db, dev, '2026-10-14');
    expect(fortress.draft).toMatchObject({ leagues: 6, cleanSheets: 10 });
    expect(achievementStates(fortress).find((a) => a.id === 'clean_10')?.done).toBe(true);
    // Torfabrik: eigene Tore aus der Tabelle (Maximum über die Ligen), ab 80
    expect(fortress.draft.mostGoals).toBeGreaterThanOrEqual(11);
    expect(achievementStates(fortress).find((a) => a.id === 'goals_80')?.done).toBe(false);
    await saveDraftResults(
      db,
      {
        code: 'GOL234',
        settings: { format: 'league' } as never,
        teams: [{ id: 'c', cpu: true, slots: [], ss: null } as never, { id: 'h', cpu: false, slots: [1], ss: null } as never],
        owners: { h: dev },
        league: {
          teams: [{ name: 'C', rating: 1 }, { name: 'H', rating: 1 }],
          matches: [],
          table: [
            { team: 1, name: 'H', rating: 1, isUser: false, played: 34, w: 30, d: 2, l: 2, gf: 85, ga: 20, gd: 65, pts: 92 },
            { team: 0, name: 'C', rating: 1, isUser: false, played: 34, w: 2, d: 2, l: 30, gf: 20, ga: 85, gd: -65, pts: 8 },
          ],
        } as never,
      },
      7,
    );
    const factory = await achievementStats(db, dev, '2026-10-14');
    expect(factory.draft).toMatchObject({ leagues: 7, mostGoals: 85 });
    expect(achievementStates(factory).find((a) => a.id === 'goals_80')?.done).toBe(true);
    expect(achievementStates(cap).find((a) => a.id === 'blitz_5')).toMatchObject({ done: true, value: 5, goal: 5 });
    expect(achievementStates(cap).find((a) => a.id === 'goal_reached')?.done).toBe(true);
    expect(achievementStates(cap).find((a) => a.id === 'captain_10')?.done).toBe(true);
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
    expect(again.achievements.filter((a) => a.done).map((a) => a.id).sort()).toEqual(['c151_25', 'c151_30', 'first_run']);
    expect(again.coins.balance).toBe(350);
    // Bilanz: Kennzahlen hinter den Erfolgen
    expect(again.stats).toMatchObject({ runs: 1, dailyStreak: 0, draft: { leagues: 0 } });
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
    // 350 Münzen verdient (erster Run + 25 und 30 Siege in der 151 Challenge)
    addEntry(db, auth.deviceId, 'c151', '2026-10-01', 30, 2, 2);
    const bought = await post('/me/buy', { item: 'hat:beanie' });
    expect(bought.status).toBe(200);
    expect(bought.body.owned).toEqual(['hat:beanie']);
    expect(bought.body.coins).toEqual({ earned: 350, spent: 150, balance: 200 });
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
      achievements?: { done: number; total: number };
      online?: { leagues: number; titles: number };
    };
    expect(profile.trainer).toMatchObject({ hat: 'beanie' });
    // Erfolge im Profil: erreichte von allen
    expect(profile.achievements?.total).toBe(ACHIEVEMENTS.length);
    expect(profile.achievements?.done).toBeGreaterThanOrEqual(3);
    expect(profile.online).toEqual({ leagues: 0, titles: 0 });
    // Shinys und Pokalsiege der Manager-Saison erscheinen im Profil
    db.update("INSERT INTO draft_results (code, device_id, format, rank, teams, wins, draws, losses, points, finished_at) VALUES ('X#shiny', ?, 'shiny', 3, 0, 0, 0, 0, 0, 1)", auth.deviceId);
    db.update("INSERT INTO draft_results (code, device_id, format, rank, teams, wins, draws, losses, points, finished_at) VALUES ('X#cup', ?, 'manager_cup', 1, 16, 4, 0, 0, 0, 1)", auth.deviceId);
    const again = (await (await handleApi(new Request(`http://localhost/api/entries/${board.rows[0].entryId}/player`), { DB: db })).json()) as typeof profile;
    expect(again.online).toEqual({ leagues: 0, titles: 0, shinies: 3, managerCups: 1 });
    db.update("INSERT INTO draft_results (code, device_id, format, rank, teams, wins, draws, losses, points, finished_at) VALUES ('X#captain', ?, 'captain', 12, 0, 0, 0, 0, 0, 1)", auth.deviceId);
    const third = (await (await handleApi(new Request(`http://localhost/api/entries/${board.rows[0].entryId}/player`), { DB: db })).json()) as typeof profile;
    expect(third.online).toMatchObject({ captainGoals: 12 });
    expect(third.online).not.toHaveProperty('goalsReached');
    db.update("INSERT INTO draft_results (code, device_id, format, rank, teams, wins, draws, losses, points, finished_at) VALUES ('X#goal', ?, 'goal', 2, 18, 0, 0, 0, 0, 1)", auth.deviceId);
    const fourth = (await (await handleApi(new Request(`http://localhost/api/entries/${board.rows[0].entryId}/player`), { DB: db })).json()) as typeof profile;
    expect(fourth.online).toMatchObject({ goalsReached: 1, leagues: 0 });
  });
});

describe('Saisonartikel', () => {
  it('nächste Saison: nächstes Startdatum nach heute (über den Jahreswechsel), laufende zählen nicht', () => {
    const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
    const it = (icon: string, from: string, to: string) => ({ slot: 'hat' as const, id: icon, price: 1, season: { from, to, icon } });
    const items = [it('🎃', '10-01', '11-07'), it('🎄', '12-01', '01-06'), it('🐣', '03-20', '04-30'), { slot: 'hat' as const, id: 'n', price: 0 }];
    expect(nextSeason(items, at('2026-10-16'))).toEqual({ from: '12-01', icon: '🎄' });
    expect(nextSeason(items, at('2026-12-24'))).toEqual({ from: '03-20', icon: '🐣' });
    // Sammelstand: nur kaufbare Artikel, doppelte/unbekannte/freie Schlüssel zählen nicht
    const paid = TRAINER_ITEMS.filter((i) => i.price > 0);
    const free = TRAINER_ITEMS.find((i) => i.price === 0)!;
    const k = (i: (typeof TRAINER_ITEMS)[number]) => `${i.slot}:${i.id}`;
    expect(shopCollection([])).toEqual({ have: 0, total: paid.length });
    expect(shopCollection([k(paid[0]), k(paid[0]), k(paid[1]), k(free), 'hat:gibtsnicht'])).toEqual({ have: 2, total: paid.length });
    // Leistbar: kaufbar, nicht gekauft, im Verkauf, Preis ≤ Guthaben (Saisonartikel nur in ihrer Saison)
    const shop = [it('🎃', '10-01', '11-07'), it('🎄', '12-01', '01-06'), { slot: 'hat' as const, id: 'a', price: 100 }, { slot: 'hat' as const, id: 'b', price: 300 }, { slot: 'hat' as const, id: 'n', price: 0 }];
    expect(affordableCount([], 400, at('2026-10-16'), shop)).toBe(3); // 🎃 (in Saison), a, b – nicht 🎄, nicht gratis
    expect(affordableCount(['hat:a'], 400, at('2026-10-16'), shop)).toBe(2);
    expect(affordableCount([], 150, at('2026-10-16'), shop)).toBe(2); // 🎃 (1 Münze) und a (100)
    expect(affordableCount([], 0, at('2026-10-16'), shop)).toBe(0);
    // 🎯 Nächstes Ziel: günstigster nicht leistbarer, nicht gekaufter Artikel im Verkauf
    expect(nextGoal([], 150, at('2026-10-16'), shop)?.id).toBe('b');
    expect(nextGoal([], 50, at('2026-10-16'), shop)?.id).toBe('a');
    expect(nextGoal(['hat:b'], 150, at('2026-10-16'), shop)).toBeNull(); // 🎄 nicht im Verkauf
    expect(nextGoal([], 400, at('2026-10-16'), shop)).toBeNull();
    expect(nextSeason(items, at('2026-05-01'))).toEqual({ from: '10-01', icon: '🎃' });
    expect(nextSeason([], at('2026-05-01'))).toBeNull();
    // Mit den echten Artikeln gibt es immer eine nächste Saison
    expect(nextSeason(TRAINER_ITEMS, at('2026-10-16'))).not.toBeNull();
  });
  it('nur in ihrem Zeitraum (auch über den Jahreswechsel)', () => {
    const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
    const spooky = { slot: 'hat' as const, id: 'x', price: 1, season: { from: '10-01', to: '11-07', icon: '🎃' } };
    expect(itemOnSale(spooky, at('2026-10-01'))).toBe(true);
    expect(itemOnSale(spooky, at('2026-11-07'))).toBe(true);
    expect(itemOnSale(spooky, at('2026-11-08'))).toBe(false);
    expect(itemOnSale(spooky, at('2026-09-30'))).toBe(false);
    const winter = { ...spooky, season: { from: '12-01', to: '01-06', icon: '🎄' } };
    expect(itemOnSale(winter, at('2026-12-24'))).toBe(true);
    expect(itemOnSale(winter, at('2027-01-03'))).toBe(true);
    expect(itemOnSale(winter, at('2027-02-01'))).toBe(false);
    expect(itemOnSale({ slot: 'hat', id: 'cap', price: 0 }, at('2026-06-01'))).toBe(true);
    expect(TRAINER_ITEMS.some((i) => i.season)).toBe(true);
    // 🌱 Weltumwelttag: Keimling und Unratütox vom 1. bis 5. Juni
    const env = TRAINER_ITEMS.filter((i) => i.season?.icon === '🌱').map((i) => `${i.slot}:${i.id}`);
    expect(env).toEqual(['hat:sprout', 'companion:568']);
    const sprout = TRAINER_ITEMS.find((i) => i.id === 'sprout')!;
    expect([at('2027-05-31'), at('2027-06-01'), at('2027-06-05'), at('2027-06-06')].map((d) => itemOnSale(sprout, d))).toEqual([false, true, true, false]);
    // 📚 Welttag des Buches: Offenes Buch und Icognito vom 20. bis 26. April
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '📚').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:book', 'companion:201']);
    const book = TRAINER_ITEMS.find((i) => i.id === 'book')!;
    expect([at('2027-04-19'), at('2027-04-20'), at('2027-04-26'), at('2027-04-27')].map((d) => itemOnSale(book, d))).toEqual([false, true, true, false]);
    // 🐷 Weltspartag: Sparschwein und Gierspenst vom 25. bis 31. Oktober
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🐷').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:piggy', 'companion:999']);
    const piggy = TRAINER_ITEMS.find((i) => i.id === 'piggy')!;
    expect([at('2026-10-24'), at('2026-10-25'), at('2026-10-31'), at('2026-11-01')].map((d) => itemOnSale(piggy, d))).toEqual([false, true, true, false]);
    // 👨‍👩‍👧 Tag der Familie: Kochmütze und Famieps vom 15. bis 21. Mai
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '👨‍👩‍👧').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:chef', 'companion:924']);
    const chef = TRAINER_ITEMS.find((i) => i.id === 'chef')!;
    expect([at('2027-05-14'), at('2027-05-15'), at('2027-05-21'), at('2027-05-22')].map((d) => itemOnSale(chef, d))).toEqual([false, true, true, false]);
    // 🐧 Weltpinguintag: Pinguinmütze und Plinfa vom 21. bis 27. April
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🐧').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:penguin', 'companion:393']);
    const penguin = TRAINER_ITEMS.find((i) => i.id === 'penguin')!;
    expect([at('2027-04-20'), at('2027-04-21'), at('2027-04-27'), at('2027-04-28')].map((d) => itemOnSale(penguin, d))).toEqual([false, true, true, false]);
    // 🍫 Tag der Schokolade: Praline und Pokusan vom 4. bis 10. Juli
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🍫').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:praline', 'companion:869']);
    const praline = TRAINER_ITEMS.find((i) => i.id === 'praline')!;
    expect([at('2027-07-03'), at('2027-07-04'), at('2027-07-10'), at('2027-07-11')].map((d) => itemOnSale(praline, d))).toEqual([false, true, true, false]);
    // 🌙 Tag des Mondes: Mondsichel-Reif und Lunastein vom 17. bis 23. Juli
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🌙').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:crescent', 'companion:337']);
    const crescent = TRAINER_ITEMS.find((i) => i.id === 'crescent')!;
    expect([at('2027-07-16'), at('2027-07-17'), at('2027-07-23'), at('2027-07-24')].map((d) => itemOnSale(crescent, d))).toEqual([false, true, true, false]);
    // 🩺 Weltgesundheitstag: Schwesternhaube und Ohrdoch vom 4. bis 10. April
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🩺').map((i) => `${i.slot}:${i.id}`)).toEqual(['hat:nursecap', 'companion:531']);
    const nursecap = TRAINER_ITEMS.find((i) => i.id === 'nursecap')!;
    expect([at('2027-04-03'), at('2027-04-04'), at('2027-04-10'), at('2027-04-11')].map((d) => itemOnSale(nursecap, d))).toEqual([false, true, true, false]);
    // ☕ Tag des Kaffees: Kaffeebecher und Backel vom 28. September bis 4. Oktober
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '☕').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:coffee', 'companion:926']);
    const coffee = TRAINER_ITEMS.find((i) => i.id === 'coffee')!;
    expect([at('2027-09-27'), at('2027-09-28'), at('2027-10-04'), at('2027-10-05')].map((d) => itemOnSale(coffee, d))).toEqual([false, true, true, false]);
    // 🥧 π-Tag: Stück Kuchen und Porygon vom 11. bis 17. März
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🥧').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:pie', 'companion:137']);
    const pie = TRAINER_ITEMS.find((i) => i.id === 'pie')!;
    expect([at('2027-03-10'), at('2027-03-11'), at('2027-03-17'), at('2027-03-18')].map((d) => itemOnSale(pie, d))).toEqual([false, true, true, false]);
    // 💧 Weltwassertag: Trinkflasche und Azumarill vom 19. bis 25. März
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '💧').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:bottle', 'companion:184']);
    const bottle = TRAINER_ITEMS.find((i) => i.id === 'bottle')!;
    expect([at('2027-03-18'), at('2027-03-19'), at('2027-03-25'), at('2027-03-26')].map((d) => itemOnSale(bottle, d))).toEqual([false, true, true, false]);
    // 🛸 Welt-UFO-Tag: Mini-UFO und Elgyem vom 29. Juni bis 5. Juli
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🛸').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:ufo', 'companion:605']);
    const ufo = TRAINER_ITEMS.find((i) => i.id === 'ufo')!;
    expect([at('2027-06-28'), at('2027-06-29'), at('2027-07-05'), at('2027-07-06')].map((d) => itemOnSale(ufo, d))).toEqual([false, true, true, false]);
    // 🫖 Tag des Tees: Teekanne und Fragitee vom 12. bis 18. Dezember
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '🫖').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:teapot', 'companion:854']);
    const teapot = TRAINER_ITEMS.find((i) => i.id === 'teapot')!;
    expect([at('2027-12-11'), at('2027-12-12'), at('2027-12-18'), at('2027-12-19')].map((d) => itemOnSale(teapot, d))).toEqual([false, true, true, false]);
    // 💋 Tag des Kusses: Kussmund und Kussilla vom 3. bis 9. Juli
    expect(TRAINER_ITEMS.filter((i) => i.season?.icon === '💋').map((i) => `${i.slot}:${i.id}`)).toEqual(['accessory:kiss', 'companion:238']);
    const kiss = TRAINER_ITEMS.find((i) => i.id === 'kiss')!;
    expect([at('2027-07-02'), at('2027-07-03'), at('2027-07-09'), at('2027-07-10')].map((d) => itemOnSale(kiss, d))).toEqual([false, true, true, false]);
  });

  it('Kauf nur in der Saison (400 not_on_sale), danach bleibt er tragbar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const db = new D1Shim();
      const auth = { deviceId: crypto.randomUUID(), deviceSecret: hex(32) };
      const post = async (path: string, extra: Record<string, unknown> = {}) => {
        const res = await handleApi(
          new Request(`http://localhost/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...auth, ...extra }) }),
          { DB: db },
        );
        return { status: res.status, body: (await res.json()) as MeResponse & { error?: string } };
      };
      vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
      await post('/me');
      addEntry(db, auth.deviceId, 'c340', '2026-05-30', 34, 0, 0);
      expect(await post('/me/buy', { item: 'hat:pumpkin' })).toMatchObject({ status: 400, body: { error: 'not_on_sale' } });
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
      expect((await post('/me/buy', { item: 'hat:pumpkin' })).body.owned).toEqual(['hat:pumpkin']);
      vi.setSystemTime(new Date('2027-03-01T12:00:00Z'));
      const worn = await post('/me/trainer', { look: { ...DEFAULT_LOOK, hat: 'pumpkin' } });
      expect(worn).toMatchObject({ status: 200, body: { trainer: { hat: 'pumpkin' } } });
    } finally {
      vi.useRealTimers();
    }
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

describe('Fast geschafft', () => {
  it('offene Erfolge mit Teilfortschritt, am weitesten zuerst, höchstens 3', async () => {
    const { closest } = await import('../src/pages/Trainer');
    const a = (id: string, value: number, goal: number, done = false) => ({ id, value, goal, done, coins: 1 });
    const me = {
      achievements: [a('x', 1, 10), a('y', 8, 10), a('z', 0, 5), a('w', 1, 1, true), a('v', 25, 30), a('u', 2, 3), a('t', 1, 1)],
    } as unknown as MeResponse;
    expect(closest(me).map((x) => x.id)).toEqual(['v', 'y', 'u']);
  });
});
