/** Emoji-Reaktionen im Online-Draft: an alle, nur Mitglieder, eigenes Limit, nichts gespeichert. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DeviceAuth } from '../src/lib/api/contract';
import type { CreateDraftResponse, DraftServerMessage } from '../src/lib/api/draftContract';
import { buildScale } from '../src/lib/fit';
import { parseClientMessage } from '../server/draftCore';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
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

async function setup() {
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
  const hello = async (dev: DeviceAuth) => {
    const sock = room.connect(null);
    await room.send(sock, { type: 'hello', ...dev });
    return sock;
  };
  const host = await hello(hostDev);
  const viewer = await hello(newDevice());
  return { room, host, viewer };
}

const reactions = (s: FakeSocket) =>
  s.received.filter((m): m is Extract<DraftServerMessage, { type: 'reaction' }> => m.type === 'reaction');

describe('Reaktionen', () => {
  it('gehen an alle Verbindungen, mit Team des Absenders – der Zustand bleibt gleich', async () => {
    const { room, host, viewer } = await setup();
    const before = JSON.stringify(room.stored!.state);
    await room.send(host, { type: 'react', emoji: '🔥' });
    for (const s of [host, viewer]) expect(reactions(s).map((r) => [r.teamId, r.emoji])).toEqual([[host.state!.you, '🔥']]);
    expect(JSON.stringify(room.stored!.state)).toBe(before);
  });

  it('Zuschauer dürfen nicht, und nach 5 schnellen Reaktionen ist kurz Pause', async () => {
    const { room, host, viewer } = await setup();
    await room.send(viewer, { type: 'react', emoji: '👏' });
    expect(viewer.lastError?.code).toBe('not_joined');
    for (let i = 0; i < 8; i++) await room.send(host, { type: 'react', emoji: '😂' });
    expect(reactions(viewer)).toHaveLength(5);
  });

  it('nur Emojis aus der festen Auswahl', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'react', emoji: '🔥' })).ok).toBe(true);
    // Neu dazugekommen: Jubel, Fußball, Affe
    for (const emoji of ['🎉', '⚽', '🙈']) expect(parseClientMessage(JSON.stringify({ type: 'react', emoji })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'react', emoji: 'hallo' })).ok).toBe(false);
  });
});
