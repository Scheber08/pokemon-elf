/**
 * Online-Draft: Härtung des Servers nach dem Review – Verbindungen (hello-Frist, Limits,
 * Platz für Team-Besitzer), Anmeldung außerhalb der Warteschlange, Online-Flags, Gnadenfristen
 * (Host-Wechsel, Auto-Pick durch andere), Moderation, Lobby-Liste, D1-Fehler, Flut-Limits,
 * geheimer Liga-Seed, Liganame und das gespeicherte Saisonergebnis.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAuth } from '../src/lib/api/contract';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_LIMITS,
  type CreateDraftResponse,
  type DraftSettings,
  type DraftSnapshot,
  type PublicLobbiesResponse,
} from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  draftedIds,
  freeSlots,
  joinDraft,
  leagueSeed,
  normalizeSettings,
  poolOf,
  sha256Words,
  snapshotOf,
  startDraft,
  withLeague,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { hashSeed } from '../src/lib/rng';
import {
  DRAFT_CLOSE,
  DRAFT_CREATES_PER_IP,
  DRAFT_HELLO_TIMEOUT_MS,
  DRAFT_MAX_CONNECTIONS,
  DRAFT_MAX_PENDING,
  DRAFT_MAX_PENDING_PER_IP,
  DRAFT_MAX_SOCKETS_PER_DEVICE,
  DRAFT_MAX_SPECTATORS_PER_IP,
  DRAFT_RATE,
  LOBBY_RETRY_MS,
  LOBBY_SYNC_MS,
  type LobbyRow,
} from '../server/draftCore';
import type { Db, DbResult, DbStatement } from '../server/env';
import { handleApi, type Env } from '../server/handler';
import { D1Shim } from './d1shim';
import { FakeNamespace, FakeRoom, type FakeSocket } from './fakeSocket';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');

let db: D1Shim;
/** Datenbank, die die Räume sehen – umschaltbar (neues Objekt = kalter Geräte-Cache) */
let roomDb: Db;
let drafts: FakeNamespace;
let env: Env;

beforeEach(() => {
  db = new D1Shim();
  roomDb = db;
  const roomEnv = {
    get DB() {
      return roomDb;
    },
  };
  drafts = new FakeNamespace(() => new FakeRoom(roomEnv, ALL, SCALE));
  env = { DB: db, DRAFTS: drafts };
});

// ---------------------------------------------------------------- D1 mit Fehlern und Sperren

class FlakyStatement implements DbStatement {
  constructor(
    private readonly owner: FlakyDb,
    readonly inner: DbStatement,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new FlakyStatement(this.owner, this.inner.bind(...values), this.sql);
  }

  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName: string): Promise<T | null>;
  async first<T>(colName?: string): Promise<T | null> {
    await this.owner.check(this.sql);
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  async all<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    await this.owner.check(this.sql);
    return this.inner.all<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<DbResult<T>> {
    await this.owner.check(this.sql);
    return this.inner.run<T>();
  }
}

/** D1, das ausgewählte Anweisungen scheitern lässt bzw. anhält (bis release()). */
class FlakyDb implements Db {
  fail: ((sql: string) => boolean) | null = null;
  private gates: { match: (sql: string) => boolean; hit: () => void; opened: Promise<void> }[] = [];

  constructor(readonly inner: D1Shim) {}

  prepare(query: string): DbStatement {
    return new FlakyStatement(this, this.inner.prepare(query), query);
  }

  async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
    for (const s of statements) await this.check((s as FlakyStatement).sql);
    return this.inner.batch<T>(statements.map((s) => (s as FlakyStatement).inner));
  }

  async check(sql: string): Promise<void> {
    if (this.fail?.(sql)) throw new Error('D1_ERROR: simuliert');
    const gate = this.gates.find((g) => g.match(sql));
    if (gate) {
      gate.hit();
      await gate.opened;
    }
  }

  /** Hält passende Anweisungen an: hit = erreicht, release() = weiter. */
  gate(match: (sql: string) => boolean): { hit: Promise<void>; release: () => void } {
    let hit!: () => void;
    let open!: () => void;
    const reached = new Promise<void>((r) => (hit = r));
    const opened = new Promise<void>((r) => (open = r));
    const entry = { match, hit, opened };
    this.gates.push(entry);
    return {
      hit: reached,
      release: () => {
        this.gates = this.gates.filter((g) => g !== entry);
        open();
      },
    };
  }
}

const DEVICE_SQL = (sql: string) => /FROM devices WHERE id/.test(sql);

// ---------------------------------------------------------------- Helfer

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const newDevice = (): DeviceAuth => ({ deviceId: crypto.randomUUID(), deviceSecret: hex(32) });

async function call<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await handleApi(new Request(`http://localhost${path}`, init), env);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
}

async function createLeague(dev: DeviceAuth, settings: Partial<DraftSettings> = {}, headers: Record<string, string> = {}) {
  const res = await call<CreateDraftResponse>('POST', '/api/drafts', { ...dev, settings, teamName: 'Host-Elf', formation: '4-3-3' }, headers);
  expect(res.status, res.text).toBe(200);
  return { code: res.body.code, room: drafts.room(res.body.code) };
}

async function hello(room: FakeRoom, dev: DeviceAuth, ip: string | null = null): Promise<FakeSocket> {
  const sock = room.connect(ip);
  await room.send(sock, { type: 'hello', ...dev });
  return sock;
}

async function lobbyWithGuest(settings: Partial<DraftSettings> = {}) {
  const hostDev = newDevice();
  const guestDev = newDevice();
  const { code, room } = await createLeague(hostDev, settings);
  const host = await hello(room, hostDev);
  const guest = await hello(room, guestDev);
  await room.send(guest, { type: 'join', teamName: 'Gast-Elf', formation: '4-4-2' });
  return { code, room, host, guest, hostDev, guestDev, hostTeam: host.state!.you!, guestTeam: guest.state!.you! };
}

/** Draft läuft: Reihenfolge Host → Gast, ohne Timer (bzw. mit `settings`). */
async function started(settings: Partial<DraftSettings> = {}) {
  const ctx = await lobbyWithGuest({ order: 'host', pickSeconds: 0, ...settings });
  await ctx.room.send(ctx.host, { type: 'start' });
  expect(currentTeam(ctx.host.state!)!.id).toBe(ctx.hostTeam);
  return ctx;
}

const lobbyRow = (code: string) => db.query<LobbyRow>('SELECT * FROM draft_lobbies WHERE code = ?', code)[0];
const teamOf = (s: DraftSnapshot, id: string) => s.teams.find((t) => t.id === id)!;
const publicCodes = async () => (await call<PublicLobbiesResponse>('GET', '/api/drafts/public')).body.lobbies.map((l) => l.code);
const updates = () => db.executed.filter((e) => e.sql.includes('UPDATE draft_lobbies SET name')).length;

function simpleChoice(s: DraftSnapshot, teamId: string) {
  const team = s.teams.find((t) => t.id === teamId)!;
  const taken = draftedIds(s);
  const p = poolOf(s.settings, ALL).find((x) => !taken.has(x.id))!;
  return { pokemonId: p.id, slot: freeSlots(team, s.settings)[0] };
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------- Verbindungen

describe('Verbindungen: hello-Frist, Limits und Platz für Team-Besitzer', () => {
  it('ohne hello fliegt eine Verbindung nach DRAFT_HELLO_TIMEOUT_MS raus – beim nächsten Upgrade und beim Alarm', async () => {
    const { room } = await lobbyWithGuest();
    const idle = room.connect('198.51.100.1');
    room.now += DRAFT_HELLO_TIMEOUT_MS - 1;
    room.connect('198.51.100.2');
    expect(idle.closed).toBeNull();
    room.now += 1;
    room.connect('198.51.100.3');
    expect(idle.closed?.code).toBe(DRAFT_CLOSE.timeout);

    const idle2 = room.connect('198.51.100.4');
    room.now += DRAFT_HELLO_TIMEOUT_MS;
    await room.core.alarm();
    expect(idle2.closed?.code).toBe(DRAFT_CLOSE.timeout);
  });

  it(`unangemeldete Verbindungen: höchstens ${DRAFT_MAX_PENDING} pro Raum – die älteste weicht, nie ein 429`, async () => {
    const { room, guest, guestDev, guestTeam } = await lobbyWithGuest();
    await room.drop(guest);
    // Angreifer: viele nackte Verbindungen von vielen IPs, ohne je hello zu schicken
    const idle = Array.from({ length: DRAFT_MAX_CONNECTIONS + 10 }, (_, i) => room.connect(`203.0.113.${i + 1}`));
    const pending = room.open.filter((s) => !s.attachment()!.authed);
    expect(pending).toHaveLength(DRAFT_MAX_PENDING);
    expect(idle[0].closed?.code).toBe(DRAFT_CLOSE.timeout);
    expect(idle.at(-1)!.closed).toBeNull();
    // Der Gast kommt trotzdem wieder hinein
    const back = await hello(room, guestDev, '192.0.2.7');
    expect(back.state!.you).toBe(guestTeam);
    expect(teamOf(back.state!, guestTeam).online).toBe(true);
  });

  it(`pro IP höchstens ${DRAFT_MAX_PENDING_PER_IP} unangemeldete Verbindungen (IPv6: pro /64)`, async () => {
    const { room } = await lobbyWithGuest();
    const same = Array.from({ length: DRAFT_MAX_PENDING_PER_IP }, (_, i) => room.connect(`2001:db8:1:2::${i + 1}`));
    const other = room.connect('198.51.100.9');
    expect(same.every((s) => !s.closed)).toBe(true);
    room.connect('2001:db8:1:2:ffff::1');
    expect(same[0].closed?.code).toBe(DRAFT_CLOSE.timeout);
    expect(same.slice(1).every((s) => !s.closed)).toBe(true);
    expect(other.closed).toBeNull();
  });

  it(`angemeldet höchstens ${DRAFT_MAX_CONNECTIONS}: Team-Besitzer verdrängen Zuschauer, Zuschauer bekommen keinen Platz`, async () => {
    const { room, host, guest, guestDev, guestTeam } = await lobbyWithGuest();
    await room.drop(guest);
    const spectators: FakeSocket[] = [];
    while (room.open.filter((s) => s.attachment()!.authed).length < DRAFT_MAX_CONNECTIONS) {
      spectators.push(await hello(room, newDevice()));
    }
    expect(spectators.every((s) => s.state && !s.closed)).toBe(true);
    // Noch ein Zuschauer: kein Platz
    const late = await hello(room, newDevice());
    expect(late.lastError?.code).toBe('room_full');
    expect(late.closed?.code).toBe(DRAFT_CLOSE.full);
    expect(late.states).toHaveLength(0);
    // Der Gast (Team-Besitzer) kommt hinein, der älteste Zuschauer geht
    const back = await hello(room, guestDev);
    expect(back.closed).toBeNull();
    expect(back.state!.you).toBe(guestTeam);
    expect(spectators[0].closed?.code).toBe(DRAFT_CLOSE.full);
    expect(spectators[0].lastError?.code).toBe('room_full');
    expect(spectators[1].closed).toBeNull();
    expect(teamOf(host.state!, guestTeam).online).toBe(true);
  });

  it(`pro Gerät höchstens ${DRAFT_MAX_SOCKETS_PER_DEVICE} Verbindungen (Tabs) – der älteste weicht, auch nach der Hibernation`, async () => {
    const { room, host, hostDev, hostTeam } = await lobbyWithGuest();
    const tabs = [];
    for (let i = 1; i < DRAFT_MAX_SOCKETS_PER_DEVICE; i++) {
      room.now += 1000;
      tabs.push(await hello(room, hostDev));
    }
    expect(tabs.every((t) => t.state && !t.closed)).toBe(true);
    // Raum schläft zwischendurch (Speicher weg) – das darf niemanden aussperren
    room.restart();
    room.now += 1000;
    const fresh = await hello(room, hostDev);
    expect(fresh.closed).toBeNull();
    expect(fresh.state!.you).toBe(hostTeam);
    // Der älteste Tab (der erste) geht – endgültig, mit Hinweis
    expect(host.closed?.code).toBe(DRAFT_CLOSE.replaced);
    expect(host.lastError?.code).toBe('replaced');
    expect(tabs.every((t) => !t.closed)).toBe(true);
    expect(room.open.filter((s) => s.attachment()?.deviceId === hostDev.deviceId)).toHaveLength(DRAFT_MAX_SOCKETS_PER_DEVICE);
  });

  it(`höchstens ${DRAFT_MAX_SPECTATORS_PER_IP} Zuschauer pro IP – Team-Mitglieder derselben IP kommen immer hinein`, async () => {
    const { room, guestDev, guestTeam, guest } = await lobbyWithGuest();
    await room.drop(guest);
    const ip = '198.51.100.7';
    const watchers = [];
    for (let i = 0; i < DRAFT_MAX_SPECTATORS_PER_IP; i++) watchers.push(await hello(room, newDevice(), ip));
    expect(watchers.every((w) => w.state && !w.closed)).toBe(true);
    const more = await hello(room, newDevice(), ip);
    expect(more.lastError?.code).toBe('too_many_connections');
    expect(more.closed?.code).toBe(DRAFT_CLOSE.full);
    // IPv6 im selben /64 zählt wie eine IP – ein anderes Netz nicht
    expect((await hello(room, newDevice(), '203.0.113.9')).state).not.toBeNull();
    // Das Team-Mitglied aus demselben Netz kommt trotzdem hinein
    const back = await hello(room, guestDev, ip);
    expect(back.closed).toBeNull();
    expect(back.state!.you).toBe(guestTeam);
    expect(watchers.every((w) => !w.closed)).toBe(true);
  });
});

// ---------------------------------------------------------------- Anmeldung und Online-Flags

describe('Anmeldung außerhalb der Warteschlange und Online-Flags', () => {
  it('eine langsame D1-Prüfung (hello) hält den Raum nicht auf', async () => {
    const { room, host } = await lobbyWithGuest();
    const flaky = new FlakyDb(db);
    roomDb = flaky;
    const gate = flaky.gate(DEVICE_SQL);
    const newcomer = room.connect();
    const pending = room.send(newcomer, { type: 'hello', ...newDevice() });
    await gate.hit;
    // Während das hello auf D1 wartet, laufen Nachrichten anderer Verbindungen weiter.
    host.reset();
    await room.send(host, { type: 'ping' });
    await room.send(host, { type: 'add-cpu' });
    expect(host.received[0].type).toBe('pong');
    expect(host.state!.teams).toHaveLength(3);
    expect(newcomer.states).toHaveLength(0);
    gate.release();
    await pending;
    expect(newcomer.state!.teams).toHaveLength(3);
    expect(newcomer.state!.you).toBeNull();
  });

  it('Nachrichten einer Verbindung bleiben in Reihenfolge: ping direkt nach hello wartet auf die Anmeldung', async () => {
    const { room } = await lobbyWithGuest();
    const flaky = new FlakyDb(db);
    roomDb = flaky;
    const gate = flaky.gate(DEVICE_SQL);
    const sock = room.connect();
    const a = room.send(sock, { type: 'hello', ...newDevice() });
    const b = room.send(sock, { type: 'ping' });
    await gate.hit;
    gate.release();
    await Promise.all([a, b]);
    expect(sock.received.map((m) => m.type)).toEqual(['state', 'pong']);
  });

  it('erfolgreich geprüfte Geräte merkt sich der Raum (Wiederverbinden ohne D1), falsche Schlüssel nicht', async () => {
    const { room, guest, guestDev } = await lobbyWithGuest();
    const reads = () => db.executed.filter((e) => DEVICE_SQL(e.sql)).length;
    await room.drop(guest);
    const before = reads();
    const back = await hello(room, guestDev);
    expect(back.state!.you).toBeTruthy();
    expect(reads()).toBe(before);
    const wrong = await hello(room, { ...guestDev, deviceSecret: hex(32) });
    expect(wrong.lastError?.code).toBe('unauthorized');
    expect(reads()).toBe(before + 1);
  });

  it('vorübergehender D1-Fehler beim hello: Verbindung zu (retry) statt halb offen, zählt nicht als Fehlversuch', async () => {
    const { room, guest, guestDev, guestTeam } = await lobbyWithGuest();
    await room.drop(guest);
    const flaky = new FlakyDb(db);
    flaky.fail = DEVICE_SQL;
    roomDb = flaky;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sock = room.connect();
    // Wie der Client: hello und gleich danach ping
    await Promise.all([room.send(sock, { type: 'hello', ...guestDev }), room.send(sock, { type: 'ping' })]);
    spy.mockRestore();
    expect(sock.closed?.code).toBe(DRAFT_CLOSE.retry);
    expect(sock.received).toEqual([]);
    expect(sock.attachment()!.hellos).toBe(0);
    // D1 wieder da → der Client verbindet neu und ist sofort drin
    flaky.fail = null;
    const back = await hello(room, guestDev);
    expect(back.state!.you).toBe(guestTeam);
    expect(teamOf(back.state!, guestTeam).online).toBe(true);
  });

  it('Verbindung schließt, während ihr hello noch auf D1 wartet: das Team bleibt offline (kein Hängenbleiben ohne Timer)', async () => {
    const { room, host, guest, guestDev, guestTeam } = await started();
    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, host.state!.you!) });
    expect(currentTeam(host.state!)!.id).toBe(guestTeam);
    await room.drop(guest);
    const flaky = new FlakyDb(db);
    roomDb = flaky;
    const gate = flaky.gate(DEVICE_SQL);
    const back = room.connect();
    const pending = room.send(back, { type: 'hello', ...guestDev });
    await gate.hit;
    await room.drop(back);
    gate.release();
    await pending;
    expect(back.received).toEqual([]);
    expect(back.attachment()!.authed).toBe(false);
    expect(room.stored!.state.teams.find((t) => t.id === guestTeam)!.online).toBe(false);
    // Der Draft hängt nicht: Nach der Gnadenfrist darf der Host für den Gast wählen.
    await room.advance(DRAFT_LIMITS.offlineGraceMs);
    await room.send(host, { type: 'auto-pick' });
    expect(host.state!.picks[1]).toMatchObject({ teamId: guestTeam, auto: true });
  });

  it('Neustart ohne webSocketClose (Deploy): Online-Flags werden beim Laden mit den offenen Verbindungen abgeglichen', async () => {
    const { room, host, guest, guestTeam } = await lobbyWithGuest();
    guest.close(1006, 'weg'); // kein disconnect – die Laufzeit hat ihn verloren
    room.restart();
    host.reset();
    room.now += 5000;
    expect(await room.core.exists()).toBe(true);
    const stored = room.stored!.state.teams.find((t) => t.id === guestTeam)!;
    expect(stored).toMatchObject({ online: false, offlineSince: room.now });
    expect(teamOf(host.state!, guestTeam).online).toBe(false);
  });

  it('beim Schließen zählen schon geschlossene Verbindungen desselben Geräts nicht mehr', async () => {
    const { room, host, guest, guestDev, guestTeam } = await lobbyWithGuest();
    const tab2 = await hello(room, guestDev);
    tab2.close(1006, 'weg'); // ohne Close-Ereignis (noch in getWebSockets)
    await room.drop(guest);
    expect(teamOf(host.state!, guestTeam).online).toBe(false);
  });
});

// ---------------------------------------------------------------- Gnadenfristen

describe('Gnadenfristen: Host-Wechsel und Auto-Pick durch andere Mitglieder', () => {
  it('Lobby: Host länger weg → ein verbundener Mensch wird Host und kann starten', async () => {
    const { room, host, guest, hostDev, hostTeam, guestTeam } = await lobbyWithGuest();
    await room.drop(host);
    // In der Lobby gilt die längere Frist (Einladen, App wechseln …)
    expect(room.alarmAt).toBe(room.now + DRAFT_LIMITS.lobbyHostGraceMs);
    await room.advance(DRAFT_LIMITS.lobbyHostGraceMs - 1);
    await room.send(guest, { type: 'add-cpu' });
    expect(guest.lastError?.code).toBe('not_host');
    await room.advance(1);
    expect(guest.state!.hostTeamId).toBe(guestTeam);
    room.now += 1000;
    await room.send(guest, { type: 'add-cpu' });
    await room.send(guest, { type: 'start' });
    expect(guest.state!.phase).toBe('drafting');
    // Der alte Host kommt zurück – als normales Mitglied
    const back = await hello(room, hostDev);
    expect(back.state!.you).toBe(hostTeam);
    expect(back.state!.hostTeamId).toBe(guestTeam);
  });

  it('kurz weg (Neuladen) ändert nichts: kein Host-Wechsel, die Lobby bleibt gelistet', async () => {
    const { code, room, host, hostDev, hostTeam } = await lobbyWithGuest({ visibility: 'public' });
    await room.drop(host);
    room.now += 2000;
    const back = await hello(room, hostDev);
    await room.advance(DRAFT_LIMITS.hostGraceMs);
    expect(back.state!.hostTeamId).toBe(hostTeam);
    expect(await publicCodes()).toContain(code);
  });

  it('öffentliche Lobby ohne anwesenden Host verschwindet aus der Liste – und kommt mit ihm zurück', async () => {
    const hostDev = newDevice();
    const { code, room } = await createLeague(hostDev, { visibility: 'public' });
    expect(await publicCodes()).toContain(code);
    // Der Ersteller verbindet sich nie
    await room.advance(DRAFT_LIMITS.hostGraceMs);
    expect(lobbyRow(code).visibility).toBe('private');
    expect(await publicCodes()).not.toContain(code);
    const host = await hello(room, hostDev);
    // wieder gelistet – gebündelt mit den übrigen Lobby-Änderungen
    await room.advance(LOBBY_SYNC_MS);
    expect(await publicCodes()).toContain(code);
    // Host geht, niemand übernimmt → nach der Gnadenfrist wieder weg
    await room.drop(host);
    await room.advance(DRAFT_LIMITS.hostGraceMs);
    expect(await publicCodes()).not.toContain(code);
    expect(room.stored!.state.settings.visibility).toBe('public');
  });

  it('Draft ohne Timer, Host weg: andere picken nach der Gnadenfrist für ihn, die Host-Rolle wandert', async () => {
    const { room, host, guest, hostTeam, guestTeam } = await started();
    await room.drop(host);
    await room.send(guest, { type: 'auto-pick' });
    expect(guest.lastError?.code).toBe('not_allowed');
    // Alarm zur Gnadenfrist: alle bekommen den Stand (Auto-Pick ist jetzt erlaubt)
    guest.reset();
    await room.advance(DRAFT_LIMITS.offlineGraceMs);
    expect(guest.states).toHaveLength(1);
    await room.send(guest, { type: 'auto-pick', teamId: hostTeam, pickIndex: 0 });
    expect(guest.state!.picks[0]).toMatchObject({ teamId: hostTeam, auto: true });
    await room.advance(DRAFT_LIMITS.hostGraceMs);
    expect(guest.state!.hostTeamId).toBe(guestTeam);
  });

  it(`ohne Timer: Wer online ist, aber nicht pickt, kann nach ${DRAFT_LIMITS.afkMs / 60_000} Minuten von anderen auto-gepickt werden`, async () => {
    const { room, host, guest, hostTeam } = await started();
    const turn = guest.state!.turnStartedAt!;
    expect(turn).toBe(room.now);
    await room.send(guest, { type: 'auto-pick' });
    expect(guest.lastError).toMatchObject({ code: 'not_allowed', message: 'Du bist nicht dran' });
    expect(room.alarmAt).toBe(turn + DRAFT_LIMITS.afkMs);
    guest.reset();
    await room.advance(DRAFT_LIMITS.afkMs);
    expect(guest.states).toHaveLength(1);
    await room.send(guest, { type: 'auto-pick' });
    expect(host.state!.picks[0]).toMatchObject({ teamId: hostTeam, auto: true });
    expect(host.state!.turnStartedAt).toBe(room.now);
    // Spectators dürfen das nie
    const spectator = await hello(room, newDevice());
    room.now += DRAFT_LIMITS.afkMs;
    await room.send(spectator, { type: 'auto-pick' });
    expect(spectator.lastError?.code).toBe('not_allowed');
  });

  it('mit Timer: Offline-Team erst nach der Gnadenfrist (nicht sofort), ein anwesendes nie', async () => {
    const { room, host, guest, guestDev, guestTeam } = await started({ pickSeconds: 90 });
    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, host.state!.you!) });
    const deadline = host.state!.deadline!;
    // Gast online, aber langsam → Host darf nicht (der Timer schützt ihn)
    room.now += 60_000;
    await room.send(host, { type: 'auto-pick' });
    expect(host.lastError?.code).toBe('not_allowed');
    // Netzwackler: Gast kurz weg → immer noch nicht
    await room.drop(guest);
    await room.send(host, { type: 'auto-pick' });
    expect(host.lastError?.code).toBe('not_allowed');
    const back = await hello(room, guestDev);
    expect(teamOf(back.state!, guestTeam).online).toBe(true);
    await room.drop(back);
    await room.advance(DRAFT_LIMITS.offlineGraceMs - 1);
    expect(room.now).toBeLessThan(deadline);
    await room.send(host, { type: 'auto-pick' });
    expect(host.lastError?.code).toBe('not_allowed');
  });

  it('gezielter Auto-Pick: veraltetes Ziel → „stale" (ein Doppelklick nimmt nie den nächsten Pick)', async () => {
    const { room, host, guest, guestTeam } = await started();
    await room.send(host, { type: 'pick', ...simpleChoice(host.state!, host.state!.you!) });
    await room.drop(guest);
    await room.advance(DRAFT_LIMITS.offlineGraceMs);
    const target = { type: 'auto-pick', teamId: guestTeam, pickIndex: 1 };
    await room.send(host, target);
    expect(host.state!.picks[1]).toMatchObject({ teamId: guestTeam, auto: true });
    // Snake: der Gast ist gleich noch einmal dran – der zweite Klick zielte aber auf Pick 1
    await room.send(host, target);
    expect(host.lastError?.code).toBe('stale');
    expect(host.state!.pickIndex).toBe(2);
    await room.send(host, { type: 'auto-pick', teamId: guestTeam, pickIndex: 2 });
    expect(host.state!.pickIndex).toBe(3);
    // Jetzt ist der Host dran: ein Klick „für den Gast" wählt nicht für den Host
    await room.send(host, { type: 'auto-pick', teamId: guestTeam });
    expect(host.lastError?.code).toBe('stale');
    expect(host.state!.pickIndex).toBe(3);
  });
});

// ---------------------------------------------------------------- Moderation und Lobby-Liste

describe('Moderation und Lobby-Liste', () => {
  it('entfernte Geräte können nicht wieder beitreten („banned") – andere schon; die Sperrliste bleibt intern', async () => {
    const { room, host, guest, guestDev, guestTeam } = await lobbyWithGuest({ maxTeams: 4 });
    await room.send(host, { type: 'remove-team', teamId: guestTeam });
    expect(guest.state!.you).toBeNull();
    await room.send(guest, { type: 'join', teamName: 'Wieder da', formation: '4-3-3' });
    expect(guest.lastError?.code).toBe('banned');
    const tab = await hello(room, guestDev);
    await room.send(tab, { type: 'join', teamName: 'Neuer Tab', formation: '4-3-3' });
    expect(tab.lastError?.code).toBe('banned');
    expect(host.state!.teams).toHaveLength(1);
    const other = await hello(room, newDevice());
    await room.send(other, { type: 'join', teamName: 'Andere', formation: '4-3-3' });
    expect(other.state!.you).toBeTruthy();
    expect(room.stored!.state.banned).toEqual([guestDev.deviceId]);
    for (const raw of [...host.raw, ...other.raw]) expect(raw).not.toContain(guestDev.deviceId);
  });

  it('Lobby-Liste: pro Gerät nur die neueste, nach Anlage sortiert – Änderungen schieben nicht nach oben', async () => {
    const spammer = newDevice();
    const first = await createLeague(spammer, { visibility: 'public', name: 'Eins' });
    const fair = await createLeague(newDevice(), { visibility: 'public', name: 'Fair' });
    db.update('UPDATE draft_lobbies SET created_at = created_at - 2000 WHERE code = ?', first.code);
    db.update('UPDATE draft_lobbies SET created_at = created_at - 1000 WHERE code = ?', fair.code);
    expect(await publicCodes()).toEqual([fair.code, first.code]);
    // Änderung an „Eins" (bumpt updated_at) → Reihenfolge bleibt
    const host = await hello(first.room, spammer);
    await first.room.send(host, { type: 'settings', settings: { name: 'Eins!' } });
    expect(lobbyRow(first.code).name).toBe('Eins!');
    expect(await publicCodes()).toEqual([fair.code, first.code]);
    // Zweite öffentliche Lobby desselben Geräts verdrängt seine erste
    const second = await createLeague(spammer, { visibility: 'public', name: 'Zwei' });
    expect(await publicCodes()).toEqual([second.code, fair.code]);
  });

  it(`neue Ligen pro IP begrenzt (${DRAFT_CREATES_PER_IP}/h) – auch mit immer neuen Geräten`, async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.77' };
    for (let i = 0; i < DRAFT_CREATES_PER_IP; i++) await createLeague(newDevice(), {}, ip);
    const res = await call<{ error: string; message: string }>(
      'POST',
      '/api/drafts',
      { ...newDevice(), settings: {}, teamName: 'Spam', formation: '4-3-3' },
      ip,
    );
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/von dieser Verbindung/);
    await createLeague(newDevice(), {}, { 'CF-Connecting-IP': '198.51.100.78' });
    // Gespeichert wird nur ein gesalzener Hash, und nur für die laufende Stunde
    const keys = db.query<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'draft-ip|%'").map((r) => r.key);
    expect(keys).toHaveLength(2);
    expect(keys.join()).not.toContain('198.51.100');
    db.update("UPDATE meta SET key = 'draft-ip|000000001|alt' WHERE key = ?", keys[0]);
    await createLeague(newDevice(), {}, { 'CF-Connecting-IP': '198.51.100.79' });
    expect(db.query("SELECT key FROM meta WHERE key = 'draft-ip|000000001|alt'")).toHaveLength(0);
  });

  it('Limit neuer Ligen pro IP hält auch bei gleichzeitigen Anfragen', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.90' };
    const all = await Promise.all(
      Array.from({ length: DRAFT_CREATES_PER_IP + 5 }, () =>
        call('POST', '/api/drafts', { ...newDevice(), settings: {}, teamName: 'Gleichzeitig', formation: '4-3-3' }, ip),
      ),
    );
    expect(all.filter((r) => r.status === 200)).toHaveLength(DRAFT_CREATES_PER_IP);
    expect(all.filter((r) => r.status === 429)).toHaveLength(5);
  });

  it('geschlossene Lobby-Zeilen verschwinden auch ohne neue Ligen (Abruf der Liste)', async () => {
    const { code } = await createLeague(newDevice(), { visibility: 'public' });
    db.update("UPDATE draft_lobbies SET phase = 'closed', updated_at = ? WHERE code = ?", Date.now() - 2 * 3_600_000, code);
    expect(lobbyRow(code)).toBeDefined();
    await call('GET', '/api/drafts/public');
    expect(lobbyRow(code)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- D1-Fehler der Lobby-Zeile

describe('D1-Fehler der Lobby-Zeile', () => {
  it('Schließen scheitert: Der Raum löscht die Zeile kurz darauf – keine Geister-Lobby', async () => {
    const hostDev = newDevice();
    const { code, room } = await createLeague(hostDev, { visibility: 'public' });
    const host = await hello(room, hostDev);
    const flaky = new FlakyDb(db);
    flaky.fail = (sql) => sql.includes("phase = 'closed'");
    roomDb = flaky;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await room.send(host, { type: 'leave' });
    spy.mockRestore();
    expect(room.stored).toBeNull();
    expect(room.closedRec!.closed.deleteAt).toBe(room.now + LOBBY_RETRY_MS);
    expect(lobbyRow(code).phase).toBe('lobby');
    flaky.fail = null;
    await room.advance(LOBBY_RETRY_MS);
    expect(lobbyRow(code)).toBeUndefined();
    expect(await publicCodes()).not.toContain(code);
    expect(room.closedRec).toBeNull();
  });

  it('Aktualisierung scheitert (Start): wird per Alarm wiederholt, bis die Zeile stimmt', async () => {
    const { code, room, host } = await lobbyWithGuest({ visibility: 'public', pickSeconds: 0, order: 'host' });
    const flaky = new FlakyDb(db);
    flaky.fail = (sql) => sql.includes('UPDATE draft_lobbies SET name');
    roomDb = flaky;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await room.send(host, { type: 'start' });
    expect(host.state!.phase).toBe('drafting');
    expect(lobbyRow(code).phase).toBe('lobby');
    expect(room.stored!.syncAt).toBe(room.now + LOBBY_RETRY_MS);
    expect(room.alarmAt).toBe(room.now + LOBBY_RETRY_MS);
    // Noch kaputt: nächster Versuch scheitert auch, wird wieder geplant
    await room.advance(LOBBY_RETRY_MS);
    expect(lobbyRow(code).phase).toBe('lobby');
    spy.mockRestore();
    flaky.fail = null;
    await room.advance(LOBBY_RETRY_MS);
    expect(lobbyRow(code).phase).toBe('drafting');
    expect(room.stored!.syncAt).toBeNull();
    expect(await publicCodes()).not.toContain(code);
  });
});

// ---------------------------------------------------------------- Flut und Kontingente

describe('Flut und Kontingente', () => {
  it('Limit pro Gerät über alle seine Verbindungen; wer weiterflutet, wird getrennt', async () => {
    const { room, host, hostDev } = await lobbyWithGuest();
    const tab2 = await hello(room, hostDev);
    const tab3 = await hello(room, hostDev);
    room.now += 60_000;
    for (const tab of [host, tab2, tab3]) tab.reset();
    for (const tab of [host, tab2]) for (let i = 0; i < DRAFT_RATE.socket.burst; i++) await room.send(tab, { type: 'ping' });
    await room.send(tab3, { type: 'ping' });
    expect(host.received.filter((m) => m.type === 'pong')).toHaveLength(DRAFT_RATE.socket.burst);
    expect(tab3.lastError?.code).toBe('rate_limited');

    room.now += 60_000;
    for (let i = 0; i < DRAFT_RATE.socket.burst + DRAFT_RATE.closeAfter; i++) await room.send(tab3, { type: 'ping' });
    expect(tab3.closed?.code).toBe(DRAFT_CLOSE.flood);
    expect(tab3.errors.filter((e) => e.code === 'rate_limited')).toHaveLength(2);
  });

  it(`Lobby-Änderungen pro Gerät gedrosselt (Vorrat ${DRAFT_RATE.changes.burst})`, async () => {
    const { room, host } = await lobbyWithGuest();
    room.now += 60_000;
    // 4 Änderungen pro Sekunde: unter dem Limit pro Verbindung, aber schneller als der Nachschub
    let ok = 0;
    for (let i = 0; i < 200 && !host.lastError; i++) {
      room.now += 250;
      await room.send(host, { type: 'settings', settings: { name: `Liga ${i}` } });
      if (!host.lastError) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(DRAFT_RATE.changes.burst);
    expect(host.lastError).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/Änderungen/) });
    expect(host.state!.settings.name).toBe(`Liga ${ok - 1}`);
    room.now += 1000 / DRAFT_RATE.changes.perSecond;
    host.reset();
    await room.send(host, { type: 'settings', settings: { name: 'Wieder ok' } });
    expect(host.state!.settings.name).toBe('Wieder ok');
  });

  it('der Eimer der Lobby-Änderungen übersteht die Hibernation (Raum-Speicher)', async () => {
    const { room, host, hostDev } = await lobbyWithGuest();
    room.now += 60_000;
    for (let i = 0; i < 200 && !host.lastError; i++) {
      room.now += 250;
      await room.send(host, { type: 'settings', settings: { name: `Liga ${i}` } });
    }
    expect(host.lastError?.code).toBe('rate_limited');
    // Raum schläft ein (Speicher weg), dieselbe Verbindung schickt sofort weiter
    room.restart();
    const tab = await hello(room, hostDev);
    tab.reset();
    room.now += 250;
    await room.send(tab, { type: 'settings', settings: { name: 'Gleich nach dem Aufwachen' } });
    expect(tab.lastError?.code).toBe('rate_limited');
    expect(room.stored!.state.settings.name).not.toBe('Gleich nach dem Aufwachen');
  });

  it('nichts geändert (gleiche Einstellung) → nichts gespeichert, nichts an andere verteilt', async () => {
    const { room, host, guest } = await lobbyWithGuest({ name: 'Gleich' });
    const before = room.stored;
    guest.reset();
    host.reset();
    await room.send(host, { type: 'settings', settings: { name: 'Gleich', region: 1 } });
    expect(room.stored).toBe(before);
    expect(guest.received).toEqual([]);
    expect(host.states).toHaveLength(1);
  });

  it(`Lobby-Zeile: Änderungen höchstens alle ${LOBBY_SYNC_MS / 1000} s, nur die Phase sofort`, async () => {
    const { code, room, host } = await lobbyWithGuest({ order: 'host', pickSeconds: 0 });
    room.now += 60_000;
    const base = updates();
    for (let i = 0; i < 5; i++) {
      room.now += 500;
      await room.send(host, { type: 'settings', settings: { name: `Name ${i}` } });
    }
    expect(updates()).toBe(base + 1);
    expect(lobbyRow(code).name).toBe('Name 0');
    await room.advance(LOBBY_SYNC_MS);
    expect(updates()).toBe(base + 2);
    expect(lobbyRow(code).name).toBe('Name 4');
    // Sichtbarkeit gebündelt (Umschalten im Sekundentakt schreibt D1 nicht jedes Mal)
    for (const visibility of ['public', 'private', 'public'] as const) {
      room.now += 2000;
      await room.send(host, { type: 'settings', settings: { visibility } });
    }
    expect(updates()).toBe(base + 2);
    expect(lobbyRow(code).visibility).toBe('private');
    await room.advance(LOBBY_SYNC_MS);
    expect(updates()).toBe(base + 3);
    expect(lobbyRow(code).visibility).toBe('public');
    expect(await publicCodes()).toContain(code);
    // Start sofort
    await room.send(host, { type: 'start' });
    expect(lobbyRow(code).phase).toBe('drafting');
  });
});

// ---------------------------------------------------------------- Liga-Seed, Liganame, Saisonergebnis

describe('Liga-Seed, Liganame und gespeichertes Saisonergebnis', () => {
  it('der Liga-Seed ist geheim (32 Zufallsbytes) und erscheint in keinem Schnappschuss', async () => {
    const { room, host } = await lobbyWithGuest();
    const seed = room.stored!.state.seed;
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    for (const raw of host.raw) expect(raw).not.toContain(String(seed));
  });

  it('CPU-Namen und -Formationen hängen nur am (öffentlichen) Code, nicht am Seed', () => {
    const make = (seed: string) => {
      let s = createDraft({
        code: 'ABC234',
        seed,
        settings: { maxTeams: 6 },
        host: { teamId: 'h', deviceId: 'dev-h', name: 'Host', formation: '4-3-3' },
        now: 0,
        list: ALL,
      });
      for (let i = 0; i < 4; i++) s = addCpuTeam(s, 'dev-h', `c${i}`);
      return s.teams.filter((t) => t.cpu).map((t) => [t.name, t.formation]);
    };
    expect(make('a'.repeat(64))).toEqual(make('b'.repeat(64)));
  });

  it('leagueSeed: Text-Seeds per SHA-256 je Zweck, Zahlen wie bisher (hashSeed)', () => {
    for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'ä€😀'.repeat(40)]) {
      const words = Array.from(sha256Words(text), (w) => w.toString(16).padStart(8, '0')).join('');
      expect(words, text).toBe(createHash('sha256').update(text).digest('hex'));
    }
    const secret = hex(32);
    const expected = createHash('sha256').update(`${secret}|season`).digest().readUInt32BE(0) & 0x7fffffff;
    expect(leagueSeed(secret, 'season')).toBe(expected);
    expect(leagueSeed(secret, 'order')).not.toBe(leagueSeed(secret, 'season'));
    expect(leagueSeed(42, 'season')).toBe(hashSeed(42, 'season'));
  });

  it('Liganame wird nach Codepoints gekürzt – nie ein halbes Emoji', async () => {
    const s = normalizeSettings({ name: '🔥'.repeat(45) }, DEFAULT_DRAFT_SETTINGS, ALL);
    expect(Array.from(s.name)).toHaveLength(DRAFT_LIMITS.leagueNameMax);
    expect(s.name).not.toMatch(LONE_SURROGATE);
    const name = `a${'🔥'.repeat(20)}`;
    const { room, host, code } = await lobbyWithGuest();
    room.now += 60_000;
    await room.send(host, { type: 'settings', settings: { name } });
    expect(host.state!.settings.name).toBe(name);
    await room.advance(LOBBY_SYNC_MS);
    expect(lobbyRow(code).name).toBe(name);
  });

  it('Saisonergebnis: einmal gespeichert, bleibt nach Neustart gleich, wird nicht neu berechnet; Schnappschuss bleibt klein', () => {
    let s: DraftState = createDraft({
      code: 'QWE234',
      seed: hex(32),
      settings: { maxTeams: 8, setPiece: true, region: 0 },
      host: { teamId: 'h', deviceId: 'dev-h', name: 'Host', formation: '4-3-3' },
      now: 0,
      list: ALL,
    });
    s = joinDraft(s, { teamId: 'g', deviceId: 'dev-g', name: 'Gast', formation: '4-4-2' });
    for (let i = 0; i < 6; i++) s = addCpuTeam(s, 'dev-h', `c${i}`);
    s = startDraft(s, 'dev-h', 0, ALL);
    for (let t = 1; s.phase === 'drafting'; t++) {
      const cur = currentTeam(s)!;
      const c = autoPickChoice(s, cur.id, ALL, SCALE, cur.cpu);
      s = applyPick(s, cur.id, c.pokemonId, c.slot, true, t, ALL);
    }
    expect(s.league).toBeUndefined();
    const done = withLeague(s, ALL, SCALE);
    expect(done.league!.teams).toHaveLength(8);
    expect(done.league!.matches).toHaveLength(56);
    expect(done.league!.teams[0]).toEqual({ name: expect.any(String), rating: expect.any(Number) });
    // Gespeichert ist gespeichert: auch mit anderen Daten wird nichts neu berechnet
    expect(withLeague(done, ALL.slice(0, 10), SCALE)).toBe(done);
    const snap = snapshotOf(structuredClone(done), null, 1);
    expect(snap.league).toEqual(done.league);
    expect(snap.ratings).toEqual(done.league!.teams.map((t) => t.rating));
    expect(JSON.stringify(snap).length).toBeLessThan(40_000);
    expect(snapshotOf(s, null, 1)).not.toHaveProperty('league');
  });
});
