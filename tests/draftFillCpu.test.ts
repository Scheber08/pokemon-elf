/** Lobby: „Mit CPU auffüllen“ – eine Nachricht füllt alle freien Plätze, nur der Host darf. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceAuth } from '../src/lib/api/contract';
import type { CreateDraftResponse } from '../src/lib/api/draftContract';
import { buildScale } from '../src/lib/fit';
import { parseClientMessage } from '../server/draftCore';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
let drafts: FakeNamespace;
let env: Env;
let db: D1Shim;

beforeEach(() => {
  db = new D1Shim();
  drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
  env = { DB: db, DRAFTS: drafts };
});

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

describe('Mit CPU auffüllen', () => {
  it('füllt bis maxTeams, mit verschiedenen Namen; Zuschauer dürfen nicht', async () => {
    const hostDev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hostDev, settings: { maxTeams: 6 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host = room.connect(null);
    await room.send(host, { type: 'hello', ...hostDev });
    const viewer = room.connect(null);
    await room.send(viewer, { type: 'hello', ...newDevice() });
    await room.send(viewer, { type: 'add-cpu', fill: true });
    expect(viewer.lastError).toBeTruthy();
    await room.send(host, { type: 'add-cpu', fill: true });
    const teams = room.stored!.state.teams;
    expect(teams).toHaveLength(6);
    expect(teams.filter((t) => t.cpu)).toHaveLength(5);
    expect(new Set(teams.map((t) => t.name)).size).toBe(6);
    // Voll: weitere Nachricht scheitert
    await room.send(host, { type: 'add-cpu', fill: true });
    expect(host.lastError?.code).toBe('league_full');
  });

  it('CPU-Teams heißen wie Teams aus der Online-Rangliste (Rest Vereinsnamen)', async () => {
    const { CLUB_NAMES } = await import('../src/config/season');
    const { addCpuTeam, createDraft } = await import('../src/lib/draftEngine');
    // Drei Ranglisten-Teams, eins davon heißt wie der Host
    const ranked = ['Elf 0', 'Elf 1', 'host-elf'];
    // Engine: deterministisch aus dem Liga-Code, ohne vergebene Namen (Groß/klein egal)
    const base = createDraft({
      code: 'NAME23',
      seed: 1,
      settings: { maxTeams: 6 },
      host: { teamId: 'h', deviceId: 'dev-h', name: 'Host-Elf', formation: '4-3-3' },
      now: 0,
      list: ALL,
    });
    let st = base;
    for (let i = 0; i < 5; i++) st = addCpuTeam(st, 'dev-h', `c${i}`, ranked);
    const names = st.teams.slice(1).map((t) => t.name);
    expect(names.slice(0, 2).sort()).toEqual(['Elf 0', 'Elf 1']);
    expect(names.slice(2).every((n) => CLUB_NAMES.includes(n))).toBe(true);
    expect(addCpuTeam(base, 'dev-h', 'c0', ranked).teams[1].name).toBe(names[0]);
    // Ohne Namen wie bisher nur Vereine
    expect(CLUB_NAMES).toContain(addCpuTeam(base, 'dev-h', 'c0').teams[1].name);

    // Server: Namen aus der Allzeit-Rangliste der 34–0 Challenge
    for (let i = 0; i < 3; i++) {
      const dev = `rank-${i}`;
      db.update('INSERT INTO devices (id, secret_hash, name, created_at) VALUES (?, ?, ?, 0)', dev, 'x', `Profi ${i}`);
      db.update(
        `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json, team_name, score, wins, draws, losses, points, season_seed, created_at)
         VALUES (?, ?, 'c340', '2026-10-14', '4-3-3', 0, '[]', ?, ?, 700, 0, 0, 0, ?, 1, 0)`,
        `e${i}`, dev, JSON.stringify(ALL.slice(i * 11 + 30, i * 11 + 41).map((p) => p.id)), `Rangteam ${i}`, 50 + i,
      );
      db.update("INSERT INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at) VALUES ('c340', 'all', ?, ?, ?, 700, 0)", dev, `e${i}`, 50 + i);
    }
    const hostDev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hostDev, settings: { maxTeams: 6 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host = room.connect(null);
    await room.send(host, { type: 'hello', ...hostDev });
    await room.send(host, { type: 'add-cpu', fill: true });
    const cpu = room.stored!.state.teams.filter((t) => t.cpu).map((t) => t.name);
    expect(cpu).toHaveLength(5);
    expect(cpu.filter((n) => /^Rangteam \d$/.test(n)).sort()).toEqual(['Rangteam 0', 'Rangteam 1', 'Rangteam 2']);
    expect(cpu.filter((n) => !n.startsWith('Rangteam ')).every((n) => CLUB_NAMES.includes(n))).toBe(true);
  });

  it('Nachricht: fill nur als true', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu', fill: true }))).toMatchObject({ ok: true, msg: { type: 'add-cpu', fill: true } });
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu', fill: 3 })).ok).toBe(false);
  });
});
