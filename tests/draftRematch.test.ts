/**
 * Revanche im Online-Draft: POST /api/drafts/:code/rematch legt nach einer fertigen Liga eine
 * neue an (gleiche Teams und Einstellungen, Menschen sofort Mitglied), die alte zeigt auf sie –
 * und der Verlauf ergibt die ewige Tabelle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiErrorBody, DeviceAuth } from '../src/lib/api/contract';
import type { CreateDraftResponse, DraftHistoryEntry, DraftSnapshot } from '../src/lib/api/draftContract';
import { currentTeam, eternalTable, groupEntries, historyEntryOf } from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');

let db: D1Shim;
let drafts: FakeNamespace;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
  env = { DB: db, DRAFTS: drafts };
});

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handleApi(new Request(`http://localhost${path}`, init), env);
  return { status: res.status, body: (await res.json()) as T };
}

async function hello(room: FakeRoom, dev: DeviceAuth): Promise<FakeSocket> {
  const sock = room.connect(null);
  await room.send(sock, { type: 'hello', ...dev });
  return sock;
}

/** Liga mit Host, Gast und einer CPU – fertig gedraftet (Auto-Picks). */
async function finishedLeague(name = 'Pokal') {
  const hostDev = newDevice();
  const guestDev = newDevice();
  const res = await call<CreateDraftResponse>('POST', '/api/drafts', {
    ...hostDev,
    settings: { name, pickSeconds: 0, order: 'host' },
    teamName: 'Host-Elf',
    formation: '4-3-3',
  });
  expect(res.status).toBe(200);
  const code = res.body.code;
  const room = drafts.room(code);
  const host = await hello(room, hostDev);
  const guest = await hello(room, guestDev);
  await room.send(guest, { type: 'join', teamName: 'Gast-Elf', formation: '4-4-2' });
  await room.send(host, { type: 'add-cpu' });
  await room.send(host, { type: 'start' });
  await draftToEnd(room, { [host.state!.you!]: host, [guest.state!.you!]: guest });
  expect(host.state!.phase).toBe('done');
  return { code, room, host, guest, hostDev, guestDev };
}

async function draftToEnd(room: FakeRoom, socks: Record<string, FakeSocket>) {
  for (let i = 0; i < 100 && room.stored!.state.phase === 'drafting'; i++) {
    const cur = currentTeam(room.stored!.state)!;
    if (cur.cpu) await room.fireAlarm();
    else await room.send(socks[cur.id], { type: 'auto-pick' });
  }
}

describe('Revanche', () => {
  it('legt eine neue Liga an: gleiche Teams (IDs), gleiche Einstellungen, Menschen sofort dabei', async () => {
    const { code, room, host, hostDev, guestDev } = await finishedLeague();
    const old = room.stored!.state;
    const res = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    expect(res.status).toBe(200);
    const next = res.body.code;
    expect(next).not.toBe(code);
    // Die alte Liga zeigt auf die Revanche – auch für verbundene Clients
    expect(room.stored!.state.rematch).toBe(next);
    expect((host.state as DraftSnapshot).rematch).toBe(next);
    const nroom = drafts.room(next);
    const s = nroom.stored!.state;
    expect(s.phase).toBe('lobby');
    expect(s.teams.map((t) => [t.id, t.name, t.cpu])).toEqual(old.teams.map((t) => [t.id, t.name, t.cpu]));
    expect(s.teams.every((t) => t.slots.every((x) => x == null))).toBe(true);
    expect(s.settings).toEqual(old.settings);
    expect(s.hostTeamId).toBe(old.hostTeamId);
    expect(s.seed).not.toBe(old.seed);
    expect(s.history).toHaveLength(1);
    expect(s.history![0]).toEqual(historyEntryOf(old));
    // Gast meldet sich in der neuen Liga an – er ist schon Mitglied
    const guest2 = await hello(nroom, guestDev);
    expect(guest2.state!.you).toBe(old.owners && Object.entries(old.owners).find(([, d]) => d === guestDev.deviceId)![0]);
    expect(guest2.state!.history).toHaveLength(1);
    // Lobby-Zeile der neuen Liga
    expect(db.query('SELECT code FROM draft_lobbies WHERE code = ?', next)).toHaveLength(1);
  });

  it('zweite Anfrage (auch vom Gast) bekommt dieselbe Revanche', async () => {
    const { code, hostDev, guestDev } = await finishedLeague();
    const a = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, guestDev);
    const b = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    expect(a.status).toBe(200);
    expect(b.body.code).toBe(a.body.code);
    expect(db.query('SELECT code FROM draft_lobbies')).toHaveLength(2);
  });

  it('gleichzeitige Klicks: wer verliert, dessen Raum und Lobby-Zeile verschwinden ganz', async () => {
    const { code, hostDev } = await finishedLeague();
    // Eine andere Anfrage ist schneller: Während unsere Revanche angelegt wird, setzt sie ihren Code
    const get = drafts.get.bind(drafts);
    drafts.get = (id) => {
      const stub = get(id);
      return {
        ...stub,
        createFrom: async (state) => {
          await drafts.room(code).core.setRematch('WINNER');
          return stub.createFrom(state);
        },
      };
    };
    const res = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    expect(res.body.code).toBe('WINNER');
    const losers = [...drafts.rooms.keys()].filter((c) => c !== code);
    expect(losers).toHaveLength(1);
    expect(drafts.room(losers[0]).stored).toBeNull();
    expect(db.query('SELECT code FROM draft_lobbies WHERE code = ?', losers[0])).toEqual([]);
  });

  it('haben alle die Revanche verlassen, gibt es beim nächsten Klick eine neue', async () => {
    const { code, hostDev } = await finishedLeague();
    const first = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    // Alle haben die Revanche verlassen: Die leere Lobby wird geschlossen (Zeile „closed“)
    db.update(`UPDATE draft_lobbies SET phase = 'closed' WHERE code = ?`, first.body.code);
    const second = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    expect(second.status).toBe(200);
    expect(second.body.code).not.toBe(first.body.code);
    expect(drafts.room(code).stored!.state.rematch).toBe(second.body.code);
    // Und die lebt: ein weiterer Klick bleibt dabei
    const third = await call<CreateDraftResponse>('POST', `/api/drafts/${code}/rematch`, hostDev);
    expect(third.body.code).toBe(second.body.code);
  });

  it('nur Mitglieder, nur fertige Ligen', async () => {
    const { code } = await finishedLeague();
    const stranger = await call<ApiErrorBody>('POST', `/api/drafts/${code}/rematch`, newDevice());
    expect(stranger.status).toBe(409);
    expect(stranger.body.message).toBe('Du bist in dieser Liga nicht dabei');

    const dev = newDevice();
    const res = await call<CreateDraftResponse>('POST', '/api/drafts', { ...dev, settings: {}, teamName: 'X', formation: '4-3-3' });
    const early = await call<ApiErrorBody>('POST', `/api/drafts/${res.body.code}/rematch`, dev);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe('Die Liga ist noch nicht fertig');

    const missing = await call<ApiErrorBody>('POST', '/api/drafts/ZZZZZZ/rematch', dev);
    expect(missing.status).toBe(404);
  });

  it('Kette: der Verlauf wächst, die ewige Tabelle zählt alle Ligen zusammen', async () => {
    const first = await finishedLeague('Runde 1');
    const r = await call<CreateDraftResponse>('POST', `/api/drafts/${first.code}/rematch`, first.hostDev);
    const room2 = drafts.room(r.body.code);
    const host2 = await hello(room2, first.hostDev);
    const guest2 = await hello(room2, first.guestDev);
    await room2.send(host2, { type: 'start' });
    await draftToEnd(room2, { [host2.state!.you!]: host2, [guest2.state!.you!]: guest2 });
    const s2 = room2.stored!.state;
    expect(s2.phase).toBe('done');
    const entries = groupEntries(s2);
    expect(entries.map((e) => e.name)).toEqual(['Runde 1', 'Runde 1']);
    const table = eternalTable(entries);
    expect(table).toHaveLength(3);
    for (const row of table) {
      expect(row.leagues).toBe(2);
      const per = entries.map((e) => e.rows.find((x) => x.teamId === row.teamId)!);
      expect(row.pts).toBe(per[0].pts + per[1].pts);
      expect(row.played).toBe(per[0].played + per[1].played);
    }
    expect(table.reduce((n, row) => n + row.titles, 0)).toBe(2);
    // Revanche der Revanche: zwei Ligen im Verlauf
    const r3 = await call<CreateDraftResponse>('POST', `/api/drafts/${r.body.code}/rematch`, first.guestDev);
    expect(drafts.room(r3.body.code).stored!.state.history!.map((e) => e.code)).toEqual([first.code, r.body.code]);
  });
});

describe('ewige Tabelle', () => {
  const row = (teamId: string, rank: number, pts: number, gf = 10, ga = 10) => ({
    teamId, name: teamId.toUpperCase(), cpu: false, rank, played: 6, w: 0, d: 0, l: 0, gf, ga, pts,
  });
  const entry = (rows: ReturnType<typeof row>[]): DraftHistoryEntry => ({ code: 'X', name: '', finishedAt: 0, rows });

  it('nach Punkten, dann Tordifferenz, Toren und Titeln; neuester Name', () => {
    const t = eternalTable([
      entry([row('a', 1, 12, 15, 5), row('b', 2, 9), row('c', 3, 3)]),
      entry([row('b', 1, 12), { ...row('a', 2, 9, 9, 9), name: 'Neu A' }, row('c', 3, 3, 20, 2)]),
    ]);
    expect(t.map((r) => [r.teamId, r.pts, r.titles])).toEqual([
      ['a', 21, 1],
      ['b', 21, 1],
      ['c', 6, 0],
    ]);
    expect(t[0].name).toBe('Neu A');
  });
});
