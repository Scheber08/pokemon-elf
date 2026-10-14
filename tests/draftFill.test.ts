/**
 * Online-Draft: Die Saison wird auf DRAFT_LIMITS.leagueSize Teams aufgefüllt – mit Teams echter
 * Spieler aus der Allzeit-Rangliste (34–0 Challenge), sonst mit Vereinen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceAuth } from '../src/lib/api/contract';
import { DRAFT_LIMITS, type CreateDraftResponse } from '../src/lib/api/draftContract';
import { CLUB_NAMES, SEASON } from '../src/config/season';
import { FORMATIONS } from '../src/config/formations';
import { createDraft, currentTeam, fillTeams, joinDraft, type FillCandidate } from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { fillCandidateRows } from '../server/db';
import { loadFillCandidates, toFillCandidate } from '../server/fill';
import { handleApi, type Env } from '../server/handler';
import { ensureSchema } from '../server/schema';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const BY_ID = new Map(ALL.map((p) => [p.id, p]));

/** Kandidat i: eine 4-3-3-Elf aus aufeinanderfolgenden Pokémon */
const candidate = (i: number, over: Partial<FillCandidate> = {}): FillCandidate => ({
  player: `Spieler ${i}`,
  teamName: `Team ${i}`,
  formation: '4-3-3',
  slots: ALL.slice(i * 11, i * 11 + 11).map((p) => p.id),
  ss: null,
  ...over,
});

function twoTeams() {
  let s = createDraft({
    code: 'FILL23',
    seed: 7,
    settings: { pickSeconds: 0 },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Team 3', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  s = joinDraft(s, { teamId: 'g', deviceId: 'dev-g', name: 'Gast', formation: '4-4-2' });
  return s;
}

describe('fillTeams', () => {
  it('füllt mit gültigen Ranglisten-Teams auf – zufällig, aber deterministisch, ohne doppelte Namen', () => {
    const s = twoTeams();
    const cands = [
      ...Array.from({ length: 30 }, (_, i) => candidate(i)),
      candidate(40, { slots: [...candidate(40).slots.slice(0, 10), 999_999] }), // unbekanntes Pokémon
      candidate(41, { slots: candidate(41).slots.slice(0, 10) }), // zu kurz
      candidate(42, { teamName: 'team 5' }), // gleicher Name wie Kandidat 5 (ohne Groß/klein)
      candidate(43, { teamName: '', player: 'Nur Spieler' }),
    ];
    const fill = fillTeams(s, cands, BY_ID, SCALE);
    expect(fill).toHaveLength(DRAFT_LIMITS.leagueSize - 2);
    expect(fill.every((t) => t.player && t.squad?.length === 11)).toBe(true);
    const names = fill.map((t) => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    // „Team 3" heißt schon ein gedraftetes Team
    expect(names).not.toContain('team 3');
    expect(fill.some((t) => t.player === 'Spieler 40' || t.player === 'Spieler 41')).toBe(false);
    expect(fillTeams(s, cands, BY_ID, SCALE)).toEqual(fill);
    // anderer Liga-Seed → andere Auswahl
    expect(fillTeams({ ...s, seed: 8 }, cands, BY_ID, SCALE).map((t) => t.name)).not.toEqual(fill.map((t) => t.name));
    // Positionen der Elf wie in der Formation
    const t0 = cands.find((c) => c.player === fill[0].player)!;
    expect(fill[0].squad!.map((p) => p.pos)).toEqual(FORMATIONS[t0.formation].slots.map((d) => d.pos));
  });

  it('Standardschütze nur, wenn die Liga mit Standardschützen spielt', () => {
    const s = twoTeams();
    const cand = [candidate(0, { ss: ALL[200].id })];
    const off = fillTeams({ ...s, settings: { ...s.settings, setPiece: false } }, cand, BY_ID, SCALE);
    expect(off[0].setPieceTaker).toBeNull();
    const on = fillTeams({ ...s, settings: { ...s.settings, setPiece: true } }, cand, BY_ID, SCALE);
    expect(on[0].setPieceTaker?.pokemonId).toBe(ALL[200].id);
  });

  it('zu wenige Kandidaten: der Rest sind Vereine mit Ratings wie die Challenge-Gegner', () => {
    const s = twoTeams();
    const fill = fillTeams(s, [candidate(0), candidate(1)], BY_ID, SCALE);
    expect(fill).toHaveLength(16);
    expect(fill.filter((t) => t.player)).toHaveLength(2);
    const clubs = fill.filter((t) => !t.player);
    expect(clubs.every((t) => CLUB_NAMES.includes(t.name) && !t.squad)).toBe(true);
    expect(clubs.every((t) => t.rating >= SEASON.minRating && t.rating <= SEASON.maxRating)).toBe(true);
    expect(fillTeams(s, [], BY_ID, SCALE)).toHaveLength(16);
  });
});

describe('Niveau der Auffüllteams', () => {
  it('Durchschnitt wie die gedrafteten Teams, Abstände bleiben', async () => {
    const { centerFillRatings } = await import('../src/lib/draftEngine');
    const drafted = [{ name: 'A', rating: 600 }, { name: 'B', rating: 700 }];
    const fill = [{ name: 'X', rating: 900 }, { name: 'Y', rating: 950 }, { name: 'Z', rating: 850 }];
    const out = centerFillRatings(drafted, fill);
    expect(out.map((t) => t.rating)).toEqual([650, 700, 600]);
    expect(centerFillRatings([], fill)).toBe(fill);
    // Nie über die Skala hinaus
    expect(centerFillRatings([{ name: 'A', rating: 980 }], [{ name: 'X', rating: 500 }, { name: 'Y', rating: 900 }]).map((t) => t.rating)).toEqual([780, 1000]);
  });
});

describe('Kandidaten aus der Rangliste', () => {
  const row = (over: Partial<Parameters<typeof toFillCandidate>[0]> = {}) => ({
    player: 'Ash',
    entry_id: 'e-1',
    team_name: 'Pallet Power',
    formation: '4-3-3',
    lineup_json: JSON.stringify(candidate(0).slots),
    ss_enabled: 0,
    ...over,
  });

  it('toFillCandidate: Elf und Standardschütze, kaputte Zeilen und Standardnamen fallen weg', () => {
    expect(toFillCandidate(row())).toEqual({ player: 'Ash', entryId: 'e-1', teamName: 'Pallet Power', formation: '4-3-3', slots: candidate(0).slots, ss: null });
    const withSs = toFillCandidate(row({ ss_enabled: 1, lineup_json: JSON.stringify([...candidate(0).slots, 25]) }))!;
    expect(withSs.ss).toBe(25);
    expect(toFillCandidate(row({ formation: '9-9-9' }))).toBeNull();
    expect(toFillCandidate(row({ lineup_json: '{' }))).toBeNull();
    expect(toFillCandidate(row({ lineup_json: '[1,2,3]' }))).toBeNull();
    expect(toFillCandidate(row({ player: 'Trainer' }))).toBeNull();
  });

  it('fillCandidateRows: Allzeit-Bestwerte der 34–0 Challenge, beste zuerst, nur Spieler mit eigenem Namen', async () => {
    const db = new D1Shim();
    await ensureSchema(db);
    const add = (dev: string, name: string, points: number, challenge = 'c340', scope = 'all') => {
      db.update('INSERT OR IGNORE INTO devices (id, secret_hash, name, created_at) VALUES (?, ?, ?, 0)', dev, 'x', name);
      const id = `${dev}-${challenge}-${scope}`;
      db.update(
        `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name, score, wins, draws, losses, points, season_seed, created_at)
         VALUES (?, ?, ?, '2026-10-14', '4-3-3', 0, '[]', ?, ?, 700, 0, 0, 0, ?, 1, 0)`,
        id, dev, challenge, JSON.stringify(candidate(0).slots), `${name} FC`, points,
      );
      db.update('INSERT INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at) VALUES (?, ?, ?, ?, ?, 700, 0)', challenge, scope, dev, id, points);
    };
    add('d1', 'Ash', 60);
    add('d2', 'Misty', 90);
    add('d3', 'Trainer', 99);
    add('d4', 'Brock', 99, 'c151');
    add('d5', 'Rocko', 99, 'c340', '2026-10-14');
    const rows = await fillCandidateRows(db, 'c340', 10);
    expect(rows.map((r) => r.player)).toEqual(['Misty', 'Ash']);
    expect((await loadFillCandidates(db)).map((c) => c.teamName)).toEqual(['Misty FC', 'Ash FC']);
  });

  it('loadFillCandidates: Datenbankfehler → leere Liste (die Saison spielt dann mit Vereinen)', async () => {
    const broken = { prepare: () => { throw new Error('kaputt'); }, batch: async () => { throw new Error('kaputt'); }, exec: async () => { throw new Error('kaputt'); } };
    expect(await loadFillCandidates(broken as never)).toEqual([]);
  });
});

describe('Draft-Raum: Saison mit Ranglisten-Teams', () => {
  let db: D1Shim;
  let drafts: FakeNamespace;
  let env: Env;
  beforeEach(() => {
    db = new D1Shim();
    drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
    env = { DB: db, DRAFTS: drafts };
  });
  const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

  it('am Ende des Drafts: 18 Teams, die Auffüllteams tragen Teamnamen und Spieler der Rangliste', async () => {
    await ensureSchema(db);
    for (let i = 0; i < 20; i++) {
      const dev = `rank-${i}`;
      db.update('INSERT INTO devices (id, secret_hash, name, created_at) VALUES (?, ?, ?, 0)', dev, 'x', `Profi ${i}`);
      db.update(
        `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name, score, wins, draws, losses, points, season_seed, created_at)
         VALUES (?, ?, 'c340', '2026-10-14', '4-3-3', 0, '[]', ?, ?, 700, 0, 0, 0, ?, 1, 0)`,
        `e${i}`, dev, JSON.stringify(candidate(i + 5).slots), `Elf ${i}`, 50 + i,
      );
      db.update("INSERT INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at) VALUES ('c340', 'all', ?, ?, ?, 700, 0)", dev, `e${i}`, 50 + i);
    }
    const hostDev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hostDev, settings: { pickSeconds: 0 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host: FakeSocket = room.connect(null);
    await room.send(host, { type: 'hello', ...hostDev });
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'start' });
    for (let i = 0; i < 100 && room.stored!.state.phase === 'drafting'; i++) {
      const cur = currentTeam(room.stored!.state)!;
      if (cur.cpu) await room.fireAlarm();
      else await room.send(host, { type: 'auto-pick' });
    }
    const league = room.stored!.state.league!;
    expect(league.teams).toHaveLength(DRAFT_LIMITS.leagueSize);
    expect(league.teams.slice(0, 2).every((t) => !t.player)).toBe(true);
    const fill = league.teams.slice(2);
    expect(fill.every((t) => /^Profi \d+$/.test(t.player!) && /^Elf \d+$/.test(t.name))).toBe(true);
    // Spielername und Teamname gehören zusammen
    expect(fill.every((t) => t.name.slice(4) === t.player!.slice(6))).toBe(true);
    // … und der Ranglisten-Eintrag (Profil-Link)
    expect(fill.every((t) => t.playerEntry === `e${t.name.slice(4)}`)).toBe(true);
    // Auch der Schnappschuss trägt die Spieler (für die Anzeige)
    expect(host.state!.league!.teams.slice(2).map((t) => t.player)).toEqual(fill.map((t) => t.player));
    // Torschützen auch bei den Auffüllteams (echte Elf)
    expect(league.matches.some((m) => m.home >= 2 && m.homeScorers.length > 0)).toBe(true);
  });
});
