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
    // Neue Spielregeln setzen „bereit“ zurück, ein neuer Liganame nicht
    await room.send(host, { type: 'ready', ready: true });
    await room.send(host, { type: 'settings', settings: { name: 'Neue Liga' } });
    expect(room.stored!.state.teams[0].ready).toBe(true);
    await room.send(host, { type: 'settings', settings: { pickSeconds: 30 } });
    expect(room.stored!.state.teams[0]).not.toHaveProperty('ready');
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'start' });
    await room.send(host, { type: 'ready', ready: true });
    expect(host.lastError).toBeTruthy();
    expect(parseClientMessage(JSON.stringify({ type: 'ready', ready: 'ja' })).ok).toBe(false);
  });
});

describe('Saisonziel', () => {
  it('gesetzt in der Lobby, gespiegelt an alle; ungültige Ziele abgelehnt; erreicht je nach Platz', async () => {
    const { goalReached } = await import('../src/lib/draftEngine');
    const hostDev = newDevice();
    const res = await handleApi(
      new Request('http://localhost/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...hostDev, settings: {}, teamName: 'Host-Elf', formation: '4-3-3' }),
      }),
      env,
    );
    const { code } = (await res.json()) as CreateDraftResponse;
    const room = drafts.room(code);
    const host = room.connect(null);
    await room.send(host, { type: 'hello', ...hostDev });
    await room.send(host, { type: 'goal', goal: 'top3' });
    expect(room.stored!.state.teams[0].goal).toBe('top3');
    await room.send(host, { type: 'goal', goal: null });
    expect(room.stored!.state.teams[0]).not.toHaveProperty('goal');
    expect(parseClientMessage(JSON.stringify({ type: 'goal', goal: 'weltmeister' })).ok).toBe(false);
    expect([goalReached('title', 1, 18), goalReached('title', 2, 18)]).toEqual([true, false]);
    expect([goalReached('top3', 3, 18), goalReached('upper', 9, 18), goalReached('upper', 10, 18)]).toEqual([true, true, false]);
    expect([goalReached('stay', 15, 18), goalReached('stay', 16, 18)]).toEqual([true, false]);
  });
});
