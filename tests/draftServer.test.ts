/**
 * Online-Draft auf dem Server: DraftRoomCore mit Fake-Sockets, -Uhr, -Alarm und -Speicher
 * (tests/fakeSocket.ts), D1 auf node:sqlite (tests/d1shim.ts) – und die HTTP-Endpunkte
 * unter /api/drafts, durch handleApi mit einem Fake-Namespace für env.DRAFTS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorBody, DeviceAuth, HealthResponse } from '../src/lib/api/contract';
import {
  DRAFT_LIMITS,
  type CreateDraftResponse,
  DRAFT_ALL_GENS,
  type DraftSettingsPatch,
  type DraftSnapshot,
  type PublicLobbiesResponse,
} from '../src/lib/api/draftContract';
import { currentTeam, draftedIds, draftSeason, DRAFT_SS_SLOT, freeSlots, poolOf } from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import type { FormationId } from '../src/types';
import {
  CLOSED_LOBBY_KEEP_MS,
  DRAFT_CLOSE,
  DRAFT_MAX_HELLOS,
  DRAFT_MESSAGE_MAX_BYTES,
  DRAFT_RATE,
  LOBBY_SYNC_MS,
  nextAlarmAt,
  parseClientMessage,
  type LobbyRow,
} from '../server/draftCore';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const BY_ID = new Map(ALL.map((p) => [p.id, p]));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CODE_RE = new RegExp(`^[${DRAFT_LIMITS.codeAlphabet}]{${DRAFT_LIMITS.codeLength}}$`);

let db: D1Shim;
let drafts: FakeNamespace;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  drafts = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
  env = { DB: db, DRAFTS: drafts };
});

// ---------------------------------------------------------------- Helfer

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

interface Res<T> {
  status: number;
  body: T;
  headers: Headers;
  text: string;
}

async function call<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  e: Env = env,
): Promise<Res<T>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), e);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, headers: res.headers, text };
}

function createBody(dev: DeviceAuth, settings: DraftSettingsPatch = {}, extra: Record<string, unknown> = {}) {
  return { ...dev, settings, teamName: 'Host-Elf', formation: '4-3-3', ...extra };
}

async function createLeague(dev: DeviceAuth, settings: DraftSettingsPatch = {}, extra: Record<string, unknown> = {}) {
  const res = await call<CreateDraftResponse>('POST', '/api/drafts', createBody(dev, settings, extra));
  expect(res.status, res.text).toBe(200);
  return { code: res.body.code, room: drafts.room(res.body.code) };
}

/** Verbinden + hello */
async function hello(room: FakeRoom, dev: DeviceAuth, ip: string | null = null): Promise<FakeSocket> {
  const sock = room.connect(ip);
  await room.send(sock, { type: 'hello', ...dev });
  return sock;
}

/** Liga mit Host (verbunden) und einem beigetretenen Gast. */
async function lobbyWithGuest(settings: DraftSettingsPatch = {}) {
  const hostDev = newDevice();
  const guestDev = newDevice();
  const { code, room } = await createLeague(hostDev, settings);
  const host = await hello(room, hostDev);
  const guest = await hello(room, guestDev);
  await room.send(guest, { type: 'join', teamName: 'Gast-Elf', formation: '4-4-2' });
  const hostTeam = host.state!.you!;
  const guestTeam = guest.state!.you!;
  expect(hostTeam).toBeTruthy();
  expect(guestTeam).toBeTruthy();
  return { code, room, host, guest, hostDev, guestDev, hostTeam, guestTeam };
}

const lobbyRow = (code: string) => db.query<LobbyRow>('SELECT * FROM draft_lobbies WHERE code = ?', code)[0];

/** Einfache Wahl: erstes freies Pokémon des Pools in den ersten freien Slot. */
function simpleChoice(s: DraftSnapshot, teamId: string) {
  const team = s.teams.find((t) => t.id === teamId)!;
  const taken = draftedIds(s);
  const p = poolOf(s.settings, ALL).find((x) => !taken.has(x.id))!;
  return { pokemonId: p.id, slot: freeSlots(team, s.settings)[0] };
}

const teamOf = (s: DraftSnapshot, id: string) => s.teams.find((t) => t.id === id)!;

// ---------------------------------------------------------------- HTTP

describe('Online-Draft: HTTP-Endpunkte', () => {
  it('POST /api/drafts legt Liga, Lobby-Zeile und Raum an; GET /api/drafts/:code zeigt sie Zuschauern', async () => {
    const dev = newDevice();
    const { code, room } = await createLeague(dev, { name: '  Kanto  Cup ', region: 1, visibility: 'public', maxTeams: 6 });
    expect(code).toMatch(CODE_RE);
    expect(room.stored?.state.code).toBe(code);
    expect(room.stored?.state.owners).toEqual({ [room.stored!.state.hostTeamId!]: dev.deviceId });
    // Gerät wurde dabei registriert
    expect(db.query('SELECT id FROM devices WHERE id = ?', dev.deviceId)).toHaveLength(1);

    const row = lobbyRow(code);
    expect(row).toMatchObject({
      code,
      host_device: dev.deviceId,
      name: 'Kanto Cup',
      host_name: 'Host-Elf',
      region: 1,
      legends: 0,
      pick_seconds: 60,
      teams: 1,
      max_teams: 6,
      visibility: 'public',
      phase: 'lobby',
    });

    // Klein geschriebener Code geht auch
    const snap = await call<DraftSnapshot>('GET', `/api/drafts/${code.toLowerCase()}`);
    expect(snap.status).toBe(200);
    expect(snap.body).toMatchObject({ code, phase: 'lobby', you: null, pickIndex: 0, totalPicks: 0, season: null });
    expect(snap.body.settings.name).toBe('Kanto Cup');
    expect(snap.body.teams).toHaveLength(1);
    expect(snap.body.teams[0]).toMatchObject({ name: 'Host-Elf', formation: '4-3-3', cpu: false, online: false });
    expect(snap.body.hostTeamId).toBe(snap.body.teams[0].id);
    expect(typeof snap.body.serverNow).toBe('number');
    expect(snap.text).not.toContain(dev.deviceId);
    expect(snap.text).not.toContain(dev.deviceSecret);
    expect(snap.headers.get('cache-control')).toBe('no-store');
  });

  it('prüft die Anfrage streng (400) und das Gerät (401)', async () => {
    const dev = newDevice();
    const bad: [unknown, RegExp][] = [
      ['kein json', /JSON/],
      [{ ...createBody(dev), deviceId: 'x' }, /Geräte-ID/],
      [createBody(dev, {}, { formation: '4-4-4' }), /Formation/],
      [createBody(dev, {}, { teamName: '   ' }), /Teamname/],
      [createBody(dev, {}, { teamName: '​​' }), /Teamname/],
      [createBody(dev, {}, { teamName: 'x'.repeat(DRAFT_LIMITS.teamNameMax + 1) }), /zu lang/],
      [createBody(dev, {}, { teamName: 42 }), /Teamname/],
      [createBody(dev, {}, { settings: 'alles' }), /Einstellungen/],
      [createBody(dev, { maxTeams: 9 }), /Teams/],
      [createBody(dev, { pickSeconds: 45 as never }), /Timer/],
      [createBody(dev, { region: 12 as never }), /Region/],
      [createBody(dev, { name: 'n'.repeat(DRAFT_LIMITS.leagueNameMax + 1) }), /Liganame/],
    ];
    for (const [body, msg] of bad) {
      const res = await call<ApiErrorBody>('POST', '/api/drafts', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toBe('bad_request');
      expect(res.body.message).toMatch(msg);
    }
    expect(db.query('SELECT * FROM draft_lobbies')).toHaveLength(0);

    await createLeague(dev);
    const wrong = await call<ApiErrorBody>('POST', '/api/drafts', createBody({ ...dev, deviceSecret: hex(32) }));
    expect(wrong.status).toBe(401);
    expect(db.query('SELECT * FROM draft_lobbies')).toHaveLength(1);
  });

  it('der Pool muss für die maximale Teamzahl reichen', async () => {
    // Gen 7 ohne Legendäre ist klein – 8 Teams à 12 Pokémon passen nicht hinein.
    const res = await call<ApiErrorBody>('POST', '/api/drafts', createBody(newDevice(), { region: 7, setPiece: true, maxTeams: 8 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Pool reicht nur/);
  });

  it('begrenzt neue Ligen pro Gerät und Stunde – auch geschlossene zählen, bis sie aufgeräumt sind', async () => {
    const dev = newDevice();
    for (let i = 0; i < DRAFT_LIMITS.createsPerHour; i++) await createLeague(dev);
    const res = await call<ApiErrorBody>('POST', '/api/drafts', createBody(dev));
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('rate_limited');
    expect(res.headers.get('retry-after')).toBe('3600');
    // Ein anderes Gerät ist nicht betroffen
    await createLeague(newDevice());

    // Eine geschlossene Lobby (alle weg) zählt noch eine Stunde, dann wird sie gelöscht.
    const other = newDevice();
    const { code, room } = await createLeague(other);
    const sock = await hello(room, other);
    await room.send(sock, { type: 'leave' });
    expect(lobbyRow(code).phase).toBe('closed');
    db.update('UPDATE draft_lobbies SET created_at = created_at - ?, updated_at = updated_at - ?', 2 * HOUR, 2 * HOUR);
    await createLeague(other);
    expect(lobbyRow(code)).toBeUndefined();
    // Nach einer Stunde darf dev wieder
    await createLeague(dev);
  });

  it('GET /api/drafts/public listet offene, öffentliche Lobbys der letzten zwei Stunden (neueste zuerst)', async () => {
    const a = await createLeague(newDevice(), { visibility: 'public', name: 'Alpha', region: 0, legends: true, pickSeconds: 30 });
    await createLeague(newDevice(), { visibility: 'private', name: 'Geheim' });
    const c = await createLeague(newDevice(), { visibility: 'public', name: 'Gamma' });
    const old = await createLeague(newDevice(), { visibility: 'public', name: 'Alt' });
    db.update('UPDATE draft_lobbies SET updated_at = ? WHERE code = ?', Date.now() - 3 * HOUR, old.code);
    // Sortiert wird nach Anlage – eine spätere Änderung (updated_at) schiebt Alpha nicht nach oben.
    db.update('UPDATE draft_lobbies SET created_at = created_at - 1000, updated_at = updated_at + 1000 WHERE code = ?', a.code);

    const res = await call<PublicLobbiesResponse>('GET', '/api/drafts/public');
    expect(res.status).toBe(200);
    expect(res.body.lobbies.map((l) => l.name)).toEqual(['Gamma', 'Alpha']);
    expect(res.body.lobbies[1]).toEqual({
      code: a.code,
      name: 'Alpha',
      hostName: 'Host-Elf',
      teams: 1,
      maxTeams: 4,
      region: 0,
      legends: true,
      pickSeconds: 30,
      createdAt: expect.any(Number),
    });
    expect(res.text).not.toMatch(/host_device|deviceId/);

    // Beitritt und CPU werden nachgezogen, gestartete Ligen verschwinden.
    const hostDev = newDevice();
    const started = await createLeague(hostDev, { visibility: 'public', name: 'Start' });
    const host = await hello(started.room, hostDev);
    await started.room.send(host, { type: 'add-cpu' });
    let list = (await call<PublicLobbiesResponse>('GET', '/api/drafts/public')).body.lobbies;
    expect(list.find((l) => l.code === started.code)?.teams).toBe(2);
    await started.room.send(host, { type: 'start' });
    list = (await call<PublicLobbiesResponse>('GET', '/api/drafts/public')).body.lobbies;
    expect(list.find((l) => l.code === started.code)).toBeUndefined();
    expect(list.find((l) => l.code === c.code)).toBeDefined();

    // Abfrage nutzt die Indizes (Liste und „neueste pro Gerät")
    const sql = db.log.find((q) => q.includes('FROM draft_lobbies AS l'))!;
    expect(db.plan(sql, 0, 0, 50).join(' ')).toContain('idx_draft_lobbies_public');
  });

  it('unbekannte oder ungültige Codes → 404 bzw. 400', async () => {
    const missing = await call<ApiErrorBody>('GET', '/api/drafts/ABCDEF');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not_found');
    for (const bad of ['ABC', 'ABCDEFG', 'ABCDE1', 'ABCDE0', 'ABC%20EF']) {
      const res = await call<ApiErrorBody>('GET', `/api/drafts/${bad}`);
      expect(res.status, bad).toBe(400);
    }
    expect((await call('GET', '/api/drafts/ABCDEF/nope')).status).toBe(404);
    expect((await call('GET', '/api/drafts')).status).toBe(405);
    expect((await call('POST', '/api/drafts/public', {})).status).toBe(405);
    expect((await call('POST', '/api/drafts/ABCDEF', {})).status).toBe(405);
  });

  it('GET /api/drafts/:code/ws: 426 ohne Upgrade, 404 ohne Liga, sonst weiter an den Raum', async () => {
    const { code } = await createLeague(newDevice());
    const noUpgrade = await call<ApiErrorBody>('GET', `/api/drafts/${code}/ws`);
    expect(noUpgrade.status).toBe(426);
    expect(noUpgrade.headers.get('upgrade')).toBe('websocket');
    const unknown = await call<ApiErrorBody>('GET', '/api/drafts/ZZZZZZ/ws', undefined, { Upgrade: 'websocket' });
    expect(unknown.status).toBe(404);
    expect(drafts.forwarded).toHaveLength(0);
    const ok = await call('GET', `/api/drafts/${code.toLowerCase()}/ws`, undefined, {
      Upgrade: 'websocket',
      'CF-Connecting-IP': '203.0.113.9',
    });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('weitergereicht');
    expect(drafts.forwarded).toHaveLength(1);
    expect(drafts.forwarded[0].headers.get('cf-connecting-ip')).toBe('203.0.113.9');
  });

  it('ohne DRAFTS-Binding: alle Draft-Endpunkte → 501, health ohne features', async () => {
    const plain: Env = { DB: db };
    const dev = newDevice();
    const cases: [string, string, unknown?][] = [
      ['POST', '/api/drafts', createBody(dev)],
      ['GET', '/api/drafts/public'],
      ['GET', '/api/drafts/ABCDEF'],
      ['GET', '/api/drafts/ABCDEF/ws'],
    ];
    for (const [method, path, body] of cases) {
      const res = await call<ApiErrorBody>(method, path, body, {}, plain);
      expect(res.status, path).toBe(501);
      expect(res.body).toEqual({ error: 'server_error', message: 'Online-Draft ist auf diesem Server nicht verfügbar' });
    }
    const without = await call<HealthResponse>('GET', '/api/health', undefined, {}, plain);
    expect(without.status).toBe(200);
    expect(without.body.features).toBeUndefined();
    const withDrafts = await call<HealthResponse>('GET', '/api/health');
    expect(withDrafts.status).toBe(200);
    expect(withDrafts.body).toMatchObject({ ok: true, features: { drafts: true } });
    expect(withDrafts.headers.get('cache-control')).toBe('no-store');
  });

  it('ein Fehler im Raum lässt keine verwaiste Lobby-Zeile zurück', async () => {
    const broken = new FakeNamespace(() => new FakeRoom({ DB: db }, ALL, SCALE));
    broken.get = () => ({
      create: async () => {
        throw new Error('Raum kaputt');
      },
      snapshot: async () => null,
      fetch: async () => new Response(null, { status: 500 }),
      rematchTemplate: async () => ({ ok: false, code: 'not_found', message: '' }),
      createFrom: async () => ({ ok: true }),
      setRematch: async () => null,
      discard: async () => undefined,
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call<ApiErrorBody>('POST', '/api/drafts', createBody(newDevice()), {}, { DB: db, DRAFTS: broken });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(db.query('SELECT * FROM draft_lobbies')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- Raum: Anmeldung & Nachrichten

describe('Draft-Raum: Anmeldung und Nachrichten', () => {
  it('ohne hello: nur Fehler „unauthorized", kein Zustand', async () => {
    const { room } = await createLeague(newDevice());
    const sock = room.connect();
    for (const msg of [{ type: 'join', teamName: 'X', formation: '4-3-3' }, { type: 'ping' }, { type: 'start' }]) {
      await room.send(sock, msg);
      expect(sock.lastError?.code).toBe('unauthorized');
    }
    expect(sock.states).toHaveLength(0);
    // Andere Änderungen erreichen ihn auch nicht
    const other = await hello(room, newDevice());
    await room.send(other, { type: 'join', teamName: 'Zweiter', formation: '4-3-3' });
    expect(other.state?.teams).toHaveLength(2);
    expect(sock.states).toHaveLength(0);
  });

  it('hello prüft Format und Schlüssel, registriert neue Geräte und schließt nach zu vielen Fehlversuchen', async () => {
    const hostDev = newDevice();
    const { room } = await createLeague(hostDev);
    const sock = room.connect();
    await room.send(sock, { type: 'hello', deviceId: 'abc', deviceSecret: hex(32) });
    expect(sock.lastError).toMatchObject({ code: 'bad_request', message: expect.stringMatching(/Geräte-ID/) });
    await room.send(sock, { type: 'hello', deviceId: hostDev.deviceId, deviceSecret: hex(32) });
    expect(sock.lastError?.code).toBe('unauthorized');
    expect(sock.states).toHaveLength(0);
    for (let i = 2; i < DRAFT_MAX_HELLOS; i++) await room.send(sock, { type: 'hello', ...hostDev, deviceSecret: hex(32) });
    expect(sock.closed).toBeNull();
    // Ab jetzt hilft auch der richtige Schlüssel nicht mehr
    await room.send(sock, { type: 'hello', ...hostDev });
    expect(sock.closed?.code).toBe(DRAFT_CLOSE.unauthorized);
    expect(sock.states).toHaveLength(0);

    // Neues Gerät: wird registriert (Großbuchstaben in der ID werden normalisiert)
    const fresh = newDevice();
    const s2 = room.connect('198.51.100.4');
    await room.send(s2, { type: 'hello', deviceId: fresh.deviceId.toUpperCase(), deviceSecret: fresh.deviceSecret });
    expect(s2.state?.you).toBeNull();
    expect(db.query<{ ip_hash: string | null }>('SELECT ip_hash FROM devices WHERE id = ?', fresh.deviceId)[0].ip_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    // Wiederholtes hello desselben Geräts schickt nur den Stand
    await room.send(s2, { type: 'hello', ...fresh });
    expect(s2.states).toHaveLength(2);
    await room.send(s2, { type: 'hello', ...newDevice() });
    expect(s2.lastError?.code).toBe('bad_message');
  });

  it('hello registriert höchstens LIMITS.devicesPerIpPerHour neue Geräte pro IP', async () => {
    const { room } = await createLeague(newDevice());
    for (let i = 0; i < 20; i++) {
      const s = await hello(room, newDevice(), '203.0.113.50');
      expect(s.state, `Gerät ${i}`).not.toBeNull();
      // wieder weg – sonst greift vorher das Zuschauer-Limit pro IP
      await room.drop(s);
    }
    const blocked = await hello(room, newDevice(), '203.0.113.50');
    expect(blocked.lastError?.code).toBe('rate_limited');
    expect(blocked.states).toHaveLength(0);
    // Andere IP geht
    expect((await hello(room, newDevice(), '203.0.113.51')).state).not.toBeNull();
  });

  it('kaputte, zu große und unbekannte Nachrichten bringen den Raum nicht zum Absturz', async () => {
    const { room, host } = await lobbyWithGuest();
    const before = structuredClone(room.stored);
    const inputs: unknown[] = [
      'kein json',
      '[1,2,3]',
      'null',
      '{"type":42}',
      '{"type":"nope"}',
      '{"type":"__proto__"}',
      { type: 'pick', pokemonId: '25', slot: 0 },
      { type: 'pick', pokemonId: 25.5, slot: 0 },
      { type: 'join', teamName: 5, formation: '4-3-3' },
      { type: 'update-team' },
      { type: 'settings', settings: [1] },
      { type: 'set-order', order: 'abc' },
      { type: 'set-order', order: [1, 2] },
      { type: 'remove-team', teamId: { id: 1 } },
      { type: 'hello', deviceId: 1, deviceSecret: 2 },
      new ArrayBuffer(8),
      JSON.stringify({ type: 'ping', pad: 'x'.repeat(DRAFT_MESSAGE_MAX_BYTES) }),
      JSON.stringify({ type: 'ping', pad: 'ä'.repeat(DRAFT_MESSAGE_MAX_BYTES / 2) }),
    ];
    for (const input of inputs) {
      host.reset();
      room.now += 1000;
      await room.send(host, input);
      expect(host.errors.length, String(input)).toBe(1);
      expect(['bad_message', 'too_large', 'bad_request']).toContain(host.lastError!.code);
    }
    expect(room.stored).toEqual(before);
    // Der Raum funktioniert weiter
    await room.send(host, { type: 'ping' });
    expect(host.received.at(-1)).toEqual({ type: 'pong', serverNow: room.now });
    expect(parseClientMessage({} as unknown).ok).toBe(false);
  });

  it(`begrenzt Nachrichten pro Verbindung (${DRAFT_RATE.socket.perSecond}/s, Vorrat ${DRAFT_RATE.socket.burst})`, async () => {
    const { room, host } = await lobbyWithGuest();
    // Vorrat wieder voll (das hello zählt sonst mit)
    room.now += 10_000;
    host.reset();
    for (let i = 0; i < DRAFT_RATE.socket.burst + 5; i++) await room.send(host, { type: 'ping' });
    expect(host.received.filter((m) => m.type === 'pong')).toHaveLength(DRAFT_RATE.socket.burst);
    expect(host.errors).toEqual([{ code: 'rate_limited', message: expect.any(String) }]);
    // Nach einer Sekunde sind perSecond Nachrichten wieder frei
    room.now += 1000;
    host.reset();
    for (let i = 0; i < DRAFT_RATE.socket.perSecond + 1; i++) await room.send(host, { type: 'ping' });
    expect(host.received.filter((m) => m.type === 'pong')).toHaveLength(DRAFT_RATE.socket.perSecond);
    expect(host.closed).toBeNull();
  });
});

// ---------------------------------------------------------------- Raum: Lobby

describe('Draft-Raum: Lobby', () => {
  it('Beitritt: alle sehen ihn sofort, jeder bekommt seine eigene Sicht', async () => {
    const { code, room, host, guest, hostTeam, guestTeam } = await lobbyWithGuest();
    expect(host.state!.you).toBe(hostTeam);
    expect(guest.state!.you).toBe(guestTeam);
    expect(host.state!.teams.map((t) => [t.name, t.online])).toEqual([
      ['Host-Elf', true],
      ['Gast-Elf', true],
    ]);
    expect(guestTeam).toMatch(/^[0-9a-f]{8}$/);
    expect(lobbyRow(code).teams).toBe(2);

    await room.send(guest, { type: 'join', teamName: 'Nochmal', formation: '4-3-3' });
    expect(guest.lastError?.code).toBe('already_joined');
    const third = await hello(room, newDevice());
    await room.send(third, { type: 'join', teamName: ' ⠀ ', formation: '4-3-3' });
    expect(third.lastError?.code).toBe('bad_name');
    await room.send(third, { type: 'join', teamName: 'Dritter', formation: '9-9-9' });
    expect(third.lastError?.code).toBe('bad_formation');
    await room.send(third, { type: 'update-team', teamName: 'X' });
    expect(third.lastError?.code).toBe('not_joined');

    await room.send(guest, { type: 'update-team', teamName: '  Neue   Elf ', formation: '3-5-2' });
    expect(teamOf(host.state!, guestTeam)).toMatchObject({ name: 'Neue Elf', formation: '3-5-2' });
    expect(teamOf(host.state!, guestTeam).slots).toHaveLength(11);
  });

  it('Einstellungen nur vom Host; gelistete Felder landen in der Lobby-Zeile', async () => {
    const { code, room, host, guest } = await lobbyWithGuest();
    await room.send(guest, { type: 'settings', settings: { maxTeams: 6 } });
    expect(guest.lastError?.code).toBe('not_host');

    const updatedBefore = lobbyRow(code).updated_at;
    room.now += 5000;
    await room.send(host, {
      type: 'settings',
      settings: { name: ' Liga\u0000 der  Elf ', maxTeams: 6, visibility: 'public', region: 0, legends: true, pickSeconds: 90, junk: 1 },
    });
    expect(host.state!.settings).toMatchObject({
      name: 'Liga der Elf',
      maxTeams: 6,
      visibility: 'public',
      gens: [...DRAFT_ALL_GENS],
      legendary: true,
      mythical: true,
      pickSeconds: 90,
    });
    expect(host.state!.settings).not.toHaveProperty('junk');
    // gebündelt: spätestens LOBBY_SYNC_MS nach dem letzten Schreiben (Beitritt des Gasts)
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ name: 'Liga der Elf', max_teams: 6, visibility: 'public', region: 0, legends: 1, pick_seconds: 90 });
    const written = lobbyRow(code).updated_at;
    expect(written).toBeGreaterThan(updatedBefore);

    // Ungelistetes (Reihenfolge) ändert die Zeile nicht
    room.now += 5000;
    await room.send(host, { type: 'settings', settings: { order: 'host', setPiece: true } });
    expect(host.state!.settings).toMatchObject({ order: 'host', setPiece: true });
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code).updated_at).toBe(written);

    await room.send(host, { type: 'settings', settings: { pickSeconds: 15 } });
    expect(host.lastError?.code).toBe('bad_settings');
    await room.send(host, { type: 'settings', settings: { maxTeams: 1 } });
    expect(host.lastError?.code).toBe('bad_settings');
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'settings', settings: { maxTeams: 2 } });
    expect(host.lastError?.code).toBe('too_many_teams');
  });

  it('CPU-Teams, Entfernen und Reihenfolge – nur der Host, Reihenfolge nur im Modus „host"', async () => {
    const ctx = await lobbyWithGuest({ maxTeams: 4 });
    const { host, guest, hostTeam, guestTeam } = ctx;
    // Viele Nachrichten hintereinander – mit kleinen Pausen (Limit pro Verbindung)
    const room = {
      send: async (sock: FakeSocket, msg: unknown) => {
        ctx.room.now += 400;
        await ctx.room.send(sock, msg);
      },
    };
    await room.send(guest, { type: 'add-cpu' });
    expect(guest.lastError?.code).toBe('not_host');
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'add-cpu' });
    const s = host.state!;
    expect(s.teams).toHaveLength(4);
    const cpus = s.teams.filter((t) => t.cpu);
    expect(cpus).toHaveLength(2);
    expect(cpus.every((t) => t.online && t.name)).toBe(true);
    await room.send(host, { type: 'add-cpu' });
    expect(host.lastError?.code).toBe('league_full');

    await room.send(guest, { type: 'remove-team', teamId: cpus[0].id });
    expect(guest.lastError?.code).toBe('not_host');
    await room.send(host, { type: 'remove-team', teamId: hostTeam });
    expect(host.lastError?.code).toBe('cannot_remove_host');
    await room.send(host, { type: 'remove-team', teamId: 'deadbeef' });
    expect(host.lastError?.code).toBe('no_team');
    await room.send(host, { type: 'remove-team', teamId: cpus[0].id });
    expect(host.state!.teams.map((t) => t.id)).toEqual([hostTeam, guestTeam, cpus[1].id]);

    const order = [cpus[1].id, guestTeam, hostTeam];
    await room.send(host, { type: 'set-order', order });
    expect(host.lastError?.code).toBe('order_random');
    expect(host.state!.teams.map((t) => t.id)).toEqual([hostTeam, guestTeam, cpus[1].id]);
    await room.send(host, { type: 'settings', settings: { order: 'host' } });
    await room.send(guest, { type: 'set-order', order });
    expect(guest.lastError?.code).toBe('not_host');
    await room.send(host, { type: 'set-order', order: [hostTeam, guestTeam] });
    expect(host.lastError?.code).toBe('bad_order');
    await room.send(host, { type: 'set-order', order });
    expect(host.state!.teams.map((t) => t.id)).toEqual(order);

    // Ein entfernter Mensch bleibt als Zuschauer verbunden
    await room.send(host, { type: 'remove-team', teamId: guestTeam });
    expect(guest.state!.you).toBeNull();
    expect(guest.state!.teams.map((t) => t.id)).toEqual([cpus[1].id, hostTeam]);
    expect(guest.closed).toBeNull();
  });

  it('Start nur vom Host und mit mindestens zwei Teams; Host-Reihenfolge bleibt erhalten', async () => {
    const hostDev = newDevice();
    const { code, room } = await createLeague(hostDev, { order: 'host', pickSeconds: 30 });
    const host = await hello(room, hostDev);
    await room.send(host, { type: 'start' });
    expect(host.lastError?.code).toBe('too_few_teams');
    const guestDev = newDevice();
    const guest = await hello(room, guestDev);
    await room.send(guest, { type: 'join', teamName: 'Gast', formation: '5-3-2' });
    await room.send(guest, { type: 'start' });
    expect(guest.lastError?.code).toBe('not_host');
    await room.send(host, { type: 'set-order', order: [guest.state!.you!, host.state!.you!] });
    await room.send(host, { type: 'start' });
    const s = host.state!;
    expect(s.phase).toBe('drafting');
    expect(s.teams.map((t) => t.name)).toEqual(['Gast', 'Host-Elf']);
    expect(s.totalPicks).toBe(22);
    expect(s.deadline).toBe(room.now + 30_000);
    expect(room.alarmAt).toBe(s.deadline);
    expect(lobbyRow(code).phase).toBe('drafting');
    // In der Draft-Phase gibt es keine Lobby-Aktionen mehr
    await room.send(host, { type: 'add-cpu' });
    expect(host.lastError?.code).toBe('not_lobby');
    await room.send(host, { type: 'start' });
    expect(host.lastError?.code).toBe('not_lobby');
    const late = await hello(room, newDevice());
    await room.send(late, { type: 'join', teamName: 'Zu spät', formation: '4-3-3' });
    expect(late.lastError?.code).toBe('not_lobby');
  });

  it('Verlassen der Lobby: Host wandert weiter, ohne Menschen wird die Liga geschlossen', async () => {
    const { code, room, host, guest, guestTeam } = await lobbyWithGuest();
    await room.send(host, { type: 'add-cpu' });
    const spectator = await hello(room, newDevice());

    await room.send(host, { type: 'leave' });
    expect(host.state!.you).toBeNull();
    expect(guest.state!.hostTeamId).toBe(guestTeam);
    expect(guest.state!.teams).toHaveLength(2);
    // Kosmetisches (Hostname, Teamzahl) schreibt der Raum gebündelt – spätestens nach LOBBY_SYNC_MS
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code)).toMatchObject({ host_name: 'Gast-Elf', teams: 2, phase: 'lobby' });
    // Verbunden, aber (noch) nicht angemeldet
    const lurker = room.connect();
    // Verlassen ohne Team ändert nichts
    host.reset();
    await room.send(host, { type: 'leave' });
    expect(host.states).toHaveLength(1);
    expect(host.errors).toHaveLength(0);

    // Der letzte Mensch geht → Liga zu (CPU-Teams zählen nicht); nur ein Grabstein bleibt
    await room.send(guest, { type: 'leave' });
    expect(room.stored).toBeNull();
    expect(room.closedRec).toEqual({ closed: { code, deleteAt: room.now + CLOSED_LOBBY_KEEP_MS } });
    expect(room.alarmAt).toBe(room.now + CLOSED_LOBBY_KEEP_MS);
    for (const s of [host, guest, spectator, lurker]) expect(s.closed?.code).toBe(DRAFT_CLOSE.closed);
    expect(guest.lastError?.code).toBe('closed');
    expect(lurker.received).toHaveLength(0);
    expect(lobbyRow(code).phase).toBe('closed');
    expect((await call('GET', `/api/drafts/${code}`)).status).toBe(404);
    expect((await call('GET', `/api/drafts/${code}/ws`, undefined, { Upgrade: 'websocket' })).status).toBe(404);
    expect(await room.core.exists()).toBe(false);
    expect(await room.core.snapshot()).toBeNull();
    // Nach einer Stunde löscht der Raum die Zeile selbst (auch ohne neue Ligen) – dann ist er ganz leer
    await room.advance(CLOSED_LOBBY_KEEP_MS);
    expect(lobbyRow(code)).toBeUndefined();
    expect(room.closedRec).toBeNull();
    expect(room.alarmAt).toBeNull();
  });

  it('Verbindungsabbruch in der Lobby: Team bleibt (offline), Wiederkehr mit demselben Gerät = dasselbe Team', async () => {
    const { room, host, guest, guestDev, guestTeam } = await lobbyWithGuest();
    await room.drop(guest);
    expect(teamOf(host.state!, guestTeam)).toMatchObject({ online: false, name: 'Gast-Elf' });
    expect(host.state!.teams).toHaveLength(2);

    // Zwei Tabs: einer zu → bleibt online
    const tab1 = await hello(room, guestDev);
    expect(tab1.state!.you).toBe(guestTeam);
    expect(teamOf(host.state!, guestTeam).online).toBe(true);
    const tab2 = await hello(room, guestDev);
    expect(tab2.state!.you).toBe(guestTeam);
    host.reset();
    await room.drop(tab1);
    expect(host.states).toHaveLength(0);
    expect(teamOf(tab2.state!, guestTeam).online).toBe(true);
    await room.drop(tab2);
    expect(teamOf(host.state!, guestTeam).online).toBe(false);

    // Nicht angemeldete oder unbeteiligte Verbindungen ändern nichts
    host.reset();
    await room.drop(room.connect());
    await room.drop(await hello(room, newDevice()));
    expect(host.states).toHaveLength(0);
  });

  it('Schnappschüsse enthalten nie Geräte-IDs oder -Schlüssel', async () => {
    const { room, host, guest, hostDev, guestDev } = await lobbyWithGuest();
    const spectatorDev = newDevice();
    const spectator = await hello(room, spectatorDev);
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'start' });
    const cur = currentTeam(host.state!)!;
    const sock = cur.id === host.state!.you ? host : guest;
    await room.send(sock, { type: 'pick', ...simpleChoice(sock.state!, cur.id) });
    const secrets = [hostDev, guestDev, spectatorDev].flatMap((d) => [d.deviceId, d.deviceSecret]);
    for (const s of [host, guest, spectator]) {
      expect(s.raw.length).toBeGreaterThan(2);
      for (const raw of s.raw) for (const secret of secrets) expect(raw).not.toContain(secret);
      for (const st of s.states) expect(st).not.toHaveProperty('owners');
    }
    expect(spectator.state!.you).toBeNull();
    const snap = await call('GET', `/api/drafts/${host.state!.code}`);
    for (const secret of secrets) expect(snap.text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------- Raum: Draft

describe('Draft-Raum: Draft', () => {
  /** Zwei Menschen, Reihenfolge Host → Gast, ohne Timer. */
  async function started(settings: DraftSettingsPatch = {}) {
    const ctx = await lobbyWithGuest({ order: 'host', pickSeconds: 0, ...settings });
    await ctx.room.send(ctx.host, { type: 'start' });
    expect(ctx.host.state!.phase).toBe('drafting');
    return ctx;
  }

  it('lehnt falsche Picks ab: nicht dran, vergeben, Slot besetzt, nicht im Pool, Zuschauer', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started({ region: 1 });
    const pool = poolOf(host.state!.settings, ALL);
    await room.send(guest, { type: 'pick', pokemonId: pool[0].id, slot: 0 });
    expect(guest.lastError).toMatchObject({ code: 'bad_pick', message: 'Du bist nicht dran' });
    await room.send(host, { type: 'pick', pokemonId: 25, slot: 0 });
    expect(teamOf(guest.state!, hostTeam).slots[0]).toBe(25);
    expect(guest.state!.picks.at(-1)).toMatchObject({ pick: 0, teamId: hostTeam, pokemonId: 25, slot: 0, auto: false, at: room.now });

    await room.send(guest, { type: 'pick', pokemonId: 25, slot: 1 });
    expect(guest.lastError?.message).toMatch(/schon vergeben/);
    await room.send(guest, { type: 'pick', pokemonId: 152, slot: 1 });
    expect(guest.lastError?.message).toMatch(/nicht im Pool/);
    await room.send(guest, { type: 'pick', pokemonId: 1, slot: 11 });
    expect(guest.lastError?.message).toMatch(/nicht frei/);
    await room.send(guest, { type: 'pick', pokemonId: 1, slot: DRAFT_SS_SLOT });
    expect(guest.lastError?.message).toMatch(/nicht frei/);

    // Snake: Gast hat in Runde 1 und 2 zwei Picks hintereinander
    await room.send(guest, { type: 'pick', pokemonId: 1, slot: 3 });
    await room.send(guest, { type: 'pick', pokemonId: 4, slot: 3 });
    expect(guest.lastError?.message).toMatch(/nicht frei/);
    await room.send(guest, { type: 'pick', pokemonId: 4, slot: 4 });
    expect(teamOf(host.state!, guestTeam).slots.filter((x) => x != null)).toEqual([1, 4]);
    expect(currentTeam(host.state!)!.id).toBe(hostTeam);

    const spectator = await hello(room, newDevice());
    await room.send(spectator, { type: 'pick', pokemonId: 7, slot: 0 });
    expect(spectator.lastError?.code).toBe('not_joined');
  });

  it('CPU-Teams picken per Alarm nach DRAFT_LIMITS.cpuPickMs; veraltete Alarme werden ignoriert', async () => {
    const hostDev = newDevice();
    const { room } = await createLeague(hostDev, { order: 'host', pickSeconds: 0 });
    const host = await hello(room, hostDev);
    await room.send(host, { type: 'add-cpu' });
    await room.send(host, { type: 'add-cpu' });
    const [hostTeam, cpu1, cpu2] = host.state!.teams.map((t) => t.id);
    await room.send(host, { type: 'start' });
    expect(currentTeam(host.state!)!.id).toBe(hostTeam);
    expect(room.alarmAt).toBe(room.stored!.state.createdAt + DRAFT_LIMITS.retentionDays * DAY);

    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, hostTeam) });
    const pickedAt = room.now;
    expect(room.alarmAt).toBe(pickedAt + DRAFT_LIMITS.cpuPickMs);

    // Zu früh (z. B. ein alter Alarm, der noch lief): nichts passiert, Alarm wird neu gestellt.
    room.now += 500;
    await room.core.alarm();
    expect(host.state!.pickIndex).toBe(1);
    expect(room.alarmAt).toBe(pickedAt + DRAFT_LIMITS.cpuPickMs);

    await room.fireAlarm();
    expect(host.state!.pickIndex).toBe(2);
    expect(host.state!.picks[1]).toMatchObject({ teamId: cpu1, auto: true, at: pickedAt + DRAFT_LIMITS.cpuPickMs });
    expect(room.alarmAt).toBe(room.now + DRAFT_LIMITS.cpuPickMs);
    await room.fireAlarm();
    expect(host.state!.picks[2]).toMatchObject({ teamId: cpu2, auto: true });
    // Snake: CPU 2 gleich noch einmal
    await room.fireAlarm();
    expect(host.state!.picks[3]).toMatchObject({ teamId: cpu2, auto: true });
    await room.fireAlarm();
    expect(host.state!.picks[4]).toMatchObject({ teamId: cpu1, auto: true });
    // Mensch dran, kein Timer → Alarm erst zur Löschfrist; ein Alarm jetzt ändert nichts
    expect(currentTeam(host.state!)!.id).toBe(hostTeam);
    expect(room.alarmAt).toBe(room.stored!.state.createdAt + DRAFT_LIMITS.retentionDays * DAY);
    await room.core.alarm();
    expect(host.state!.pickIndex).toBe(5);
    // Alle CPU-Picks sind legal und verschieden
    expect(new Set(host.state!.picks.map((p) => p.pokemonId)).size).toBe(5);
  });

  it('abgelaufene Bedenkzeit: der Server wählt automatisch (ohne Zufall), auch für Offline-Spieler', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started({ pickSeconds: 30 });
    const deadline = host.state!.deadline!;
    expect(deadline).toBe(room.now + 30_000);
    expect(room.alarmAt).toBe(deadline);

    // Alarm vor Ablauf (veraltet) → nichts
    room.now = deadline - 1;
    await room.core.alarm();
    expect(host.state!.pickIndex).toBe(0);
    expect(room.alarmAt).toBe(deadline);

    await room.advanceTo(deadline);
    const s = guest.state!;
    expect(s.pickIndex).toBe(1);
    expect(s.picks[0]).toMatchObject({ teamId: hostTeam, auto: true, at: deadline });
    expect(s.deadline).toBe(deadline + 30_000);
    expect(currentTeam(s)!.id).toBe(guestTeam);

    // Gast offline → läuft trotzdem weiter
    await room.drop(guest);
    await room.advance(30_000);
    expect(host.state!.picks[1]).toMatchObject({ teamId: guestTeam, auto: true });
    expect(teamOf(host.state!, guestTeam).online).toBe(false);
    expect(host.state!.picks.map((p) => p.pokemonId)).toEqual(room.stored!.state.picks.map((p) => p.pokemonId));
  });

  it('Auto-Pick per Nachricht: für sich selbst, für andere erst nach der Gnadenfrist (Offline) bzw. für CPU', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started();
    await room.send(guest, { type: 'auto-pick' });
    expect(guest.lastError).toMatchObject({ code: 'not_allowed', message: 'Du bist nicht dran' });
    await room.send(host, { type: 'auto-pick' });
    expect(host.state!.picks[0]).toMatchObject({ teamId: hostTeam, auto: true });
    // Gast ist dran und online → Host darf nicht
    await room.send(host, { type: 'auto-pick' });
    expect(host.lastError?.code).toBe('not_allowed');
    // Gast kurz weg (Netzwackler) → noch nicht; erst nach DRAFT_LIMITS.offlineGraceMs
    await room.drop(guest);
    expect(teamOf(host.state!, guestTeam).offlineSince).toBe(room.now);
    await room.send(host, { type: 'auto-pick' });
    expect(host.lastError).toMatchObject({ code: 'not_allowed', message: expect.stringMatching(/20 s offline/) });
    expect(host.state!.pickIndex).toBe(1);
    await room.advance(DRAFT_LIMITS.offlineGraceMs);
    await room.send(host, { type: 'auto-pick' });
    expect(host.state!.picks[1]).toMatchObject({ teamId: guestTeam, auto: true });
    // Gast offline, aber nicht Host → darf nicht für den Host
    const back = await hello(room, newDevice());
    await room.send(back, { type: 'auto-pick' });
    expect(back.lastError?.code).toBe('not_allowed');
  });

  it('Wiederkehr mitten im Draft: gleiches Team, online-Flag, voller Stand', async () => {
    const { room, host, guest, guestDev, guestTeam } = await started();
    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, host.state!.you!) });
    await room.drop(guest);
    expect(teamOf(host.state!, guestTeam).online).toBe(false);
    const back = await hello(room, guestDev);
    expect(back.state!.you).toBe(guestTeam);
    expect(back.state!.picks).toHaveLength(1);
    expect(teamOf(host.state!, guestTeam).online).toBe(true);
    await room.send(back, { type: 'pick', ...simpleChoice(back.state!, guestTeam) });
    expect(host.state!.pickIndex).toBe(2);
    // „leave" während des Drafts ändert nichts (das Team bleibt)
    await room.send(back, { type: 'leave' });
    expect(back.state!.you).toBe(guestTeam);
  });

  it('übersteht Hibernation: neuer Kern lädt den Raum aus dem Speicher und spielt weiter', async () => {
    const { room, host, hostTeam } = await started({ pickSeconds: 60 });
    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, hostTeam) });
    const deadline = room.stored!.state.deadline!;
    room.restart();
    room.alarmAt = deadline;
    await room.advanceTo(deadline);
    expect(host.state!.pickIndex).toBe(2);
    expect(host.state!.picks[1].auto).toBe(true);
    await room.send(host, { type: 'ping' });
    expect(host.received.at(-1)?.type).toBe('pong');
  });

  it('kompletter Draft bis „done": gleiche Endstände, gemeinsame Saison, Löschfrist als nächster Alarm', async () => {
    const { code, room, host, guest, hostTeam, guestTeam } = await lobbyWithGuest({ region: 1, setPiece: true, pickSeconds: 30 });
    await room.send(host, { type: 'add-cpu' });
    const spectator = await hello(room, newDevice());
    await room.send(host, { type: 'start' });
    const sockets = new Map([
      [hostTeam, host],
      [guestTeam, guest],
    ]);
    for (let guard = 0; host.state!.phase === 'drafting'; guard++) {
      expect(guard).toBeLessThan(100);
      const s = host.state!;
      const cur = currentTeam(s)!;
      if (cur.cpu) {
        await room.fireAlarm();
      } else {
        room.now += 700;
        await room.send(sockets.get(cur.id)!, { type: 'pick', ...simpleChoice(s, cur.id) });
      }
    }
    const final = host.state!;
    expect(final.phase).toBe('done');
    expect(final.pickIndex).toBe(36);
    expect(final.totalPicks).toBe(36);
    expect(final.picks).toHaveLength(36);
    expect(final.deadline).toBeNull();
    expect(final.season).toEqual({
      seed: expect.any(Number),
      startsAt: room.now + DRAFT_LIMITS.seasonLeadMs,
      stepMs: DRAFT_LIMITS.seasonStepMs,
    });
    for (const t of final.teams) {
      expect(t.slots.every((x) => x != null)).toBe(true);
      expect(t.ss).not.toBeNull();
    }
    expect(new Set(final.picks.map((p) => p.pokemonId)).size).toBe(36);
    const cpu = final.teams.find((t) => t.cpu)!;
    expect(final.picks.filter((p) => p.teamId === cpu.id).every((p) => p.auto)).toBe(true);

    // Alle sehen denselben Endstand (bis auf „you")
    const strip = (s: DraftSnapshot) => ({ ...s, you: null });
    expect(strip(guest.state!)).toEqual(strip(final));
    expect(strip(spectator.state!)).toEqual(strip(final));
    expect(guest.state!.you).toBe(guestTeam);
    expect(spectator.state!.you).toBeNull();
    const http = await call<DraftSnapshot>('GET', `/api/drafts/${code}`);
    expect({ ...http.body, serverNow: final.serverNow }).toEqual(strip(final));

    // Saison: deterministisch, für jeden Client gleich
    const a = draftSeason(final, BY_ID, SCALE)!;
    const b = draftSeason(guest.state!, BY_ID, SCALE)!;
    expect(a.table).toHaveLength(3);
    expect(a).toEqual(b);
    // … und einmal auf dem Server berechnet und gespeichert (kompakt: Teams ohne Kader)
    expect(final.league).toEqual({ ...a, teams: a.teams.map((t) => ({ name: t.name, rating: t.rating })) });
    expect(final.ratings).toEqual(a.teams.map((t) => t.rating));
    expect(room.stored!.state.league).toEqual(final.league);
    expect(http.body.league).toEqual(final.league);

    expect(lobbyRow(code).phase).toBe('done');
    expect(room.alarmAt).toBe(final.createdAt + DRAFT_LIMITS.retentionDays * DAY);
    expect(nextAlarmAt(room.stored!)).toBe(room.alarmAt);
    await room.send(host, { type: 'pick', pokemonId: 150, slot: 0 });
    expect(host.lastError?.code).toBe('bad_pick');
  });

  it('nach DRAFT_LIMITS.retentionDays wird die Liga gelöscht (Speicher, Lobby-Zeile, Verbindungen)', async () => {
    const { code, room, host } = await lobbyWithGuest();
    const created = room.stored!.state.createdAt;
    await room.advanceTo(created + DRAFT_LIMITS.retentionDays * DAY - 1);
    expect(room.stored).not.toBeNull();
    await room.advanceTo(created + DRAFT_LIMITS.retentionDays * DAY);
    expect(room.stored).toBeNull();
    expect(lobbyRow(code)).toBeUndefined();
    expect(host.closed?.code).toBe(DRAFT_CLOSE.closed);
    expect(host.lastError).toMatchObject({ code: 'closed', message: expect.stringMatching(/abgelaufen/) });
    const late = room.connect();
    await room.send(late, { type: 'hello', ...newDevice() });
    expect(late.lastError?.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------- Kleinkram

describe('Draft-Raum: Hilfsfunktionen', () => {
  it('parseClientMessage kennt alle Typen des Vertrags', () => {
    const formation: FormationId = '4-3-3';
    const ok = [
      { type: 'hello', deviceId: 'a', deviceSecret: 'b' },
      { type: 'join', teamName: 'A', formation },
      { type: 'leave' },
      { type: 'update-team', formation },
      { type: 'settings', settings: {} },
      { type: 'add-cpu' },
      { type: 'remove-team', teamId: 'abc' },
      { type: 'set-order', order: ['a', 'b'] },
      { type: 'start' },
      { type: 'pick', pokemonId: 1, slot: 0 },
      { type: 'auto-pick' },
      { type: 'auto-pick', teamId: 'abc', pickIndex: 3 },
      { type: 'reroll', kind: 'type' },
      { type: 'reroll', kind: 'region' },
      { type: 'reroll', kind: 'type', pickIndex: 4, roll: { gen: 2, type: 'fire' } },
      { type: 'ping' },
    ];
    for (const m of ok) {
      const parsed = parseClientMessage(JSON.stringify({ ...m, extra: 'egal' }));
      expect(parsed, m.type).toEqual({ ok: true, msg: m });
    }
    for (const bad of [
      { type: 'auto-pick', teamId: 5 },
      { type: 'auto-pick', pickIndex: 1.5 },
      { type: 'auto-pick', teamId: 'x'.repeat(65) },
      { type: 'reroll' },
      { type: 'reroll', kind: 'gen' },
      { type: 'reroll', kind: ['type'] },
      { type: 'reroll', kind: 'type', pickIndex: 1.5 },
      { type: 'reroll', kind: 'type', pickIndex: '3' },
      { type: 'reroll', kind: 'type', roll: null },
      { type: 'reroll', kind: 'type', roll: { gen: '2', type: 'fire' } },
      { type: 'reroll', kind: 'type', roll: { gen: 2 } },
      { type: 'reroll', kind: 'type', roll: { gen: 2, type: 'x'.repeat(17) } },
      { type: 'reroll', kind: 'type', roll: [2, 'fire'] },
    ]) {
      expect(parseClientMessage(JSON.stringify(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
