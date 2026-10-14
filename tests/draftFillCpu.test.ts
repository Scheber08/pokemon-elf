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

beforeEach(() => {
  const db = new D1Shim();
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

  it('Nachricht: fill nur als true', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu', fill: true }))).toMatchObject({ ok: true, msg: { type: 'add-cpu', fill: true } });
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'add-cpu', fill: 3 })).ok).toBe(false);
  });
});
