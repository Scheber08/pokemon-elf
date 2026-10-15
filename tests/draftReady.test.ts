/** Lobby: „Bereit“ melden – nur Mitglieder, nur in der Lobby, Schnappschuss zeigt es allen. */
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

describe('Bereit in der Lobby', () => {
  it('Mitglied meldet bereit und nimmt es zurück; Zuschauer nicht; nach dem Start nicht mehr', async () => {
    const hostDev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hostDev, settings: { maxTeams: 4, pickSeconds: 0 }, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host = room.connect(null);
    await room.send(host, { type: 'hello', ...hostDev });
    const viewer = room.connect(null);
    await room.send(viewer, { type: 'hello', ...newDevice() });
    await room.send(viewer, { type: 'ready', ready: true });
    expect(viewer.lastError?.code).toBe('not_joined');
    await room.send(host, { type: 'ready', ready: true });
    expect(room.stored!.state.teams[0].ready).toBe(true);
    expect(viewer.state!.teams[0].ready).toBe(true);
    await room.send(host, { type: 'ready', ready: false });
    expect(room.stored!.state.teams[0]).not.toHaveProperty('ready');
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'start' });
    await room.send(host, { type: 'ready', ready: true });
    expect(host.lastError).toBeTruthy();
    expect(parseClientMessage(JSON.stringify({ type: 'ready', ready: 'ja' })).ok).toBe(false);
  });
});
