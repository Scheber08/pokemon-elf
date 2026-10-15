/**
 * Browser-Client des Online-Drafts (src/lib/api/draftClient.ts) und die reinen Helfer des
 * Raum-Hooks (src/state/useDraftRoom.ts): Adressen (ws/wss, VITE_API_BASE), Liga-Codes,
 * Wiederverbinden mit Backoff, Uhrenabgleich, WebSocket-Ablauf mit gestubbtem WebSocket und
 * die Ansicht, die die Seite aus einem Schnappschuss ableitet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthResponse } from '../src/lib/api/contract';
import {
  ClockSync,
  CONNECT_TIMEOUT_MS,
  connectDraft,
  draftLinkFor,
  draftWsUrl,
  apiBaseFrom,
  isDraftCode,
  normalizeDraftCode,
  PING_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  reconnectDelay,
  STALE_CONNECT_MS,
  type DraftSocketStatus,
} from '../src/lib/api/draftClient';
import { DEFAULT_DRAFT_SETTINGS, DRAFT_ALL_GENS, DRAFT_LIMITS, type DraftSnapshot } from '../src/lib/api/draftContract';
import { getDevice } from '../src/lib/device';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft as createEngineDraft,
  currentTeam,
  joinDraft,
  maxTeamsForPool,
  snapshotOf,
  startDraft,
  teamIndexForPick,
  totalPicks,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale, positionFit } from '../src/lib/fit';
import { FORMATIONS } from '../src/config/formations';
import {
  cleanTeamName,
  draftRoomView,
  fitSettingsPatch,
  forgetLeague,
  loadRecentLeagues,
  ownerOfPicks,
  pickFeed,
  rememberLeague,
  remainingMs,
  startBlocker,
} from '../src/state/useDraftRoom';
import { ALL } from './helpers';

type DraftClient = typeof import('../src/lib/api/draftClient');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(...answers: Response[]) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next.clone();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Modul frisch laden (Health-Cache, VITE_API_BASE werden beim Laden gelesen). */
async function fresh(): Promise<DraftClient> {
  vi.resetModules();
  return import('../src/lib/api/draftClient');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- Adressen

describe('Adressen', () => {
  it('API-Basis wie client.ts: ohne VITE_API_BASE gleiche Domain', () => {
    expect(apiBaseFrom(undefined)).toBe('/api');
    expect(apiBaseFrom('')).toBe('/api');
    expect(apiBaseFrom('https://api.example.com')).toBe('https://api.example.com/api');
    expect(apiBaseFrom('https://api.example.com//')).toBe('https://api.example.com/api');
  });

  it('WebSocket-Adresse: relative Basis nutzt Host und Protokoll der Seite', () => {
    expect(draftWsUrl('ABC234', '/api', { protocol: 'https:', host: 'elf.example' })).toBe(
      'wss://elf.example/api/drafts/ABC234/ws',
    );
    expect(draftWsUrl('ABC234', '/api', { protocol: 'http:', host: 'localhost:5195' })).toBe(
      'ws://localhost:5195/api/drafts/ABC234/ws',
    );
  });

  it('WebSocket-Adresse: absolute Basis → ws bzw. wss, unabhängig von der Seite', () => {
    const page = { protocol: 'http:', host: 'localhost:5195' };
    expect(draftWsUrl('ABC234', 'https://api.example.com/api', page)).toBe('wss://api.example.com/api/drafts/ABC234/ws');
    expect(draftWsUrl('ABC234', 'http://127.0.0.1:8790/api', page)).toBe('ws://127.0.0.1:8790/api/drafts/ABC234/ws');
    expect(draftWsUrl('ABC234', '//api.example.com/api', { protocol: 'https:', host: 'x' })).toBe(
      'wss://api.example.com/api/drafts/ABC234/ws',
    );
  });

  it('VITE_API_BASE gilt für HTTP und WebSocket', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com/');
    const client = await fresh();
    const fetch = stubFetch(json(200, { lobbies: [] }));
    await client.fetchPublicLobbies();
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/api/drafts/public');
    expect(client.draftWsUrl('ABC234', undefined, { protocol: 'http:', host: 'localhost' })).toBe(
      'wss://api.example.com/api/drafts/ABC234/ws',
    );
  });

  it('ohne VITE_API_BASE: /api der eigenen Seite', async () => {
    const client = await fresh();
    vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
    expect(client.draftWsUrl('ABC234')).toBe('wss://elf.example/api/drafts/ABC234/ws');
  });

  it('Einladungslink: origin + BASE_URL + draft/CODE', () => {
    expect(draftLinkFor('https://elf.example', '/', 'ABC234')).toBe('https://elf.example/draft/ABC234');
    expect(draftLinkFor('https://elf.example/', '/elf/', 'ABC234')).toBe('https://elf.example/elf/draft/ABC234');
    expect(draftLinkFor('https://elf.example', '/elf', 'ABC234')).toBe('https://elf.example/elf/draft/ABC234');
  });
});

// ---------------------------------------------------------------- Codes

describe('Liga-Codes', () => {
  it('normalisiert Eingaben: Großbuchstaben, nur gültige Zeichen, höchstens 6', () => {
    expect(normalizeDraftCode('abc234')).toBe('ABC234');
    expect(normalizeDraftCode(' ab c-2 34 ')).toBe('ABC234');
    expect(normalizeDraftCode('ABC2345678')).toBe('ABC234');
    // 0/O, 1/I/L gibt es im Alphabet nicht
    expect(normalizeDraftCode('O0I1Ll')).toBe('');
  });

  it('erkennt den Code in einem eingefügten Einladungslink', () => {
    expect(normalizeDraftCode('https://elf.example/draft/xyz789?ref=1')).toBe('XYZ789');
    expect(normalizeDraftCode('elf.example/elf/draft/QWE234/')).toBe('QWE234');
  });

  it('prüft Länge und Alphabet', () => {
    expect(isDraftCode('ABC234')).toBe(true);
    expect(isDraftCode('ABC23')).toBe(false);
    expect(isDraftCode('ABC2345')).toBe(false);
    expect(isDraftCode('ABCO23')).toBe(false);
    expect(isDraftCode('abc234')).toBe(false);
    for (const ch of DRAFT_LIMITS.codeAlphabet) expect(isDraftCode(ch.repeat(DRAFT_LIMITS.codeLength))).toBe(true);
  });
});

// ---------------------------------------------------------------- Backoff & Uhr

describe('Wiederverbinden & Uhrenabgleich', () => {
  it('Backoff verdoppelt sich von 1 s bis höchstens 15 s', () => {
    expect([0, 1, 2, 3, 4, 5, 10, 50].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000]);
    expect(reconnectDelay(-3)).toBe(1000);
  });

  it('Schnappschuss-Probe: Serverzeit minus Empfangszeit', () => {
    const c = new ClockSync();
    expect(c.offset).toBe(0);
    c.addOneWay(105_000, 100_000);
    expect(c.offset).toBe(5000);
  });

  it('Ping-Probe zieht die halbe Laufzeit ab, die schnellste Probe gilt', () => {
    const c = new ClockSync();
    c.addOneWay(105_000, 100_000);
    // gesendet 0, empfangen 400 → Server stempelte bei ~200 lokal
    c.addRoundTrip(3200, 0, 400);
    expect(c.offset).toBe(3000);
    // langsamere Probe zählt nicht
    c.addRoundTrip(11_000, 1000, 3000);
    expect(c.offset).toBe(3000);
    // schnellere schon
    c.addRoundTrip(5_040, 2000, 2080);
    expect(c.offset).toBe(3000);
    c.addRoundTrip(6_520, 3000, 3040);
    expect(c.offset).toBe(3500);
    // Schnappschüsse ändern nichts mehr, sobald es Ping-Proben gibt
    c.addOneWay(999_999, 0);
    expect(c.offset).toBe(3500);
  });

  it('ignoriert unsinnige Proben', () => {
    const c = new ClockSync();
    c.addRoundTrip(Number.NaN, 0, 10);
    c.addRoundTrip(5000, 100, 50);
    c.addOneWay(Number.NaN, 0);
    expect(c.offset).toBe(0);
  });
});

// ---------------------------------------------------------------- WebSocket

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static failNext = false;
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  /** Der Server hat schon mit diesem Code geschlossen (sein Close-Frame ist unterwegs) */
  serverCloseCode: number | undefined;
  /** Schließen dauert (wie im Browser): onclose erst mit finishClose() */
  lazyClose = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    if (FakeWebSocket.failNext) {
      FakeWebSocket.failNext = false;
      throw new SyntaxError('ungültige Adresse');
    }
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('Socket nicht offen');
    this.sent.push(data);
  }
  close(code?: number) {
    if (this.readyState >= 2) return;
    this.closedWith = code;
    if (this.lazyClose) {
      this.readyState = 2;
      return;
    }
    this.readyState = 3;
    this.onclose?.({ code: this.serverCloseCode ?? code ?? 1005 });
  }
  finishClose() {
    this.readyState = 3;
    this.onclose?.({ code: this.serverCloseCode ?? this.closedWith ?? 1005 });
  }
  // --- Steuerung im Test
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.({ code: 1006 });
  }
  /** Server schließt mit Code */
  serverClose(code: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  /** Server bestätigt hello mit dem ersten Schnappschuss */
  welcome(over: Partial<DraftSnapshot> = {}) {
    this.receive({ type: 'state', state: snapshot(over) });
  }
  messages() {
    return this.sent.map((s) => JSON.parse(s) as { type: string } & Record<string, unknown>);
  }
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

function snapshot(over: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    code: 'ABC234',
    phase: 'lobby',
    settings: { ...DEFAULT_DRAFT_SETTINGS },
    teams: [],
    hostTeamId: null,
    pickIndex: 0,
    totalPicks: 0,
    deadline: null,
    picks: [],
    season: null,
    createdAt: 0,
    serverNow: 0,
    you: null,
    ...over,
  };
}

describe('connectDraft', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = false;
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  });

  function connect() {
    const statuses: DraftSocketStatus[] = [];
    const events: string[] = [];
    const handlers = {
      onStatus: vi.fn((s: DraftSocketStatus) => statuses.push(s)),
      onState: vi.fn((s: DraftSnapshot) => events.push(`state:${s.code}`)),
      onError: vi.fn(),
      onClockOffset: vi.fn((o: number) => events.push(`offset:${o}`)),
    };
    const conn = connectDraft('ABC234', handlers);
    return { conn, handlers, statuses, events };
  }

  // Geändert mit CLIENT-2: „offen" und der erste Ping erst nach dem ersten Schnappschuss (= hello bestätigt)
  it('öffnet die wss-Adresse, schickt hello mit der Geräte-Identität; offen und Ping erst nach dem ersten Schnappschuss', () => {
    const { conn, statuses } = connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(last().url).toBe('wss://elf.example/api/drafts/ABC234/ws');
    expect(conn.status).toBe('connecting');
    last().accept();
    expect(statuses).toEqual([]);
    expect(conn.authed).toBe(false);
    expect(last().messages()).toEqual([{ type: 'hello', ...getDevice() }]);
    last().welcome();
    expect(statuses).toEqual(['open']);
    expect(conn.authed).toBe(true);
    expect(last().messages()[1]).toEqual({ type: 'ping' });
  });

  it('Schnappschuss: erst der Uhren-Offset, dann der Zustand', () => {
    const { handlers, events } = connect();
    last().accept();
    last().receive({ type: 'state', state: snapshot({ serverNow: 1_004_000 }) });
    expect(events).toEqual(['offset:4000', 'state:ABC234']);
    expect(handlers.onState).toHaveBeenCalledTimes(1);
  });

  it('Pong: Offset mit halber Laufzeit, gilt vor Schnappschuss-Proben', () => {
    const { conn } = connect();
    last().accept();
    last().welcome({ serverNow: 1_000_000 }); // Ping bei t = 1_000_000
    vi.advanceTimersByTime(200);
    last().receive({ type: 'pong', serverNow: 1_000_100 + 2500 });
    expect(conn.clockOffset).toBe(2500);
    last().receive({ type: 'state', state: snapshot({ serverNow: 2_000_000 }) });
    expect(conn.clockOffset).toBe(2500);
  });

  it('verbindet nach Abbrüchen mit 1 s, 2 s, 4 s … neu und sagt erneut hello', () => {
    const { statuses } = connect();
    last().drop();
    expect(statuses).toEqual(['reconnecting']);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    last().drop();
    vi.advanceTimersByTime(4000);
    expect(FakeWebSocket.instances).toHaveLength(4);
    last().accept();
    expect(last().messages()[0]).toMatchObject({ type: 'hello' });
    last().welcome();
    expect(statuses).toEqual(['reconnecting', 'open']);
    // Erfolgreiche Anmeldung setzt die Wartezeit zurück
    last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(5);
  });

  it('Wartezeit bleibt bei 15 s gedeckelt', () => {
    connect();
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = FakeWebSocket.instances.length;
      last().drop();
      let waited = 0;
      while (FakeWebSocket.instances.length === before) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it('wirft der Konstruktor, wird ebenfalls später neu versucht', () => {
    FakeWebSocket.failNext = true;
    const { statuses } = connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(statuses).toEqual(['reconnecting']);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('pingt alle 25 s; bleibt der Pong aus, wird neu verbunden', () => {
    const { statuses } = connect();
    const ws = last();
    ws.accept();
    ws.welcome();
    ws.receive({ type: 'pong', serverNow: 1_000_000 });
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.messages().filter((m) => m.type === 'ping')).toHaveLength(2);
    expect(ws.readyState).toBe(1);
    // kein Pong auf den zweiten Ping
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.readyState).toBe(3);
    expect(statuses).toEqual(['open', 'reconnecting']);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('send klappt nur bei offener Verbindung', () => {
    const { conn } = connect();
    expect(conn.send({ type: 'start' })).toBe(false);
    last().accept();
    // Geändert mit CLIENT-2: erst nach bestätigtem hello
    expect(conn.send({ type: 'start' })).toBe(false);
    last().welcome();
    expect(conn.send({ type: 'pick', pokemonId: 6, slot: 3 })).toBe(true);
    expect(last().messages().at(-1)).toEqual({ type: 'pick', pokemonId: 6, slot: 3 });
    last().drop();
    expect(conn.send({ type: 'start' })).toBe(false);
  });

  it('Fehler gehen an onError, kaputte Nachrichten werden ignoriert', () => {
    const { handlers } = connect();
    last().accept();
    last().welcome();
    last().receive('kein json');
    last().receive({ foo: 1 });
    last().receive({ type: 'error', code: 'not_your_turn', message: 'Du bist nicht dran' });
    expect(handlers.onError).toHaveBeenCalledWith({ code: 'not_your_turn', message: 'Du bist nicht dran' });
    expect(handlers.onState).toHaveBeenCalledTimes(1);
    expect(last().readyState).toBe(1);
  });

  it('reconnectNow verbindet sofort statt nach der Wartezeit', () => {
    const { conn } = connect();
    last().drop();
    vi.advanceTimersByTime(300);
    expect(conn.reconnectNow()).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Geändert mit CLIENT-4: Ein laufender (evtl. hängender) Aufbau wird ersetzt statt ignoriert
    const pending = last();
    conn.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(pending.readyState).toBe(3);
    // Der alte Timer feuert nicht noch einmal
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('close beendet endgültig – kein Wiederverbinden, kein Ping', () => {
    const { conn, statuses } = connect();
    const ws = last();
    ws.accept();
    ws.welcome();
    conn.close();
    expect(ws.closedWith).toBe(1000);
    expect(conn.status).toBe('closed');
    expect(statuses).toEqual(['open', 'closed']);
    vi.advanceTimersByTime(120_000);
    expect(conn.reconnectNow()).toBe(false);
    conn.checkAlive();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.messages().filter((m) => m.type === 'ping')).toHaveLength(1);
  });
});

describe('connectDraft: Anmeldung, Zeitlimits, Lebenszeichen', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.failNext = false;
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  });

  function connect() {
    const statuses: DraftSocketStatus[] = [];
    const errors: { code: string; message: string; hello?: boolean }[] = [];
    const conn = connectDraft('ABC234', {
      onStatus: (s) => statuses.push(s),
      onError: (e) => errors.push(e),
    });
    return { conn, statuses, errors };
  }

  /** Bis zum nächsten neuen Socket warten – gibt die Wartezeit zurück. */
  function waitForSocket(): number {
    const before = FakeWebSocket.instances.length;
    let waited = 0;
    while (FakeWebSocket.instances.length === before && waited < 600_000) {
      vi.advanceTimersByTime(500);
      waited += 500;
    }
    return waited;
  }

  // CLIENT-2 / SEASON-3
  it('abgelehntes hello: Meldung bleibt die echte, Socket wird geschlossen, kein Ping, Neuversuch mit Pause', () => {
    const { conn, statuses, errors } = connect();
    const ws = last();
    ws.accept();
    ws.receive({ type: 'error', code: 'rate_limited', message: 'Zu viele neue Geräte' });
    expect(errors).toEqual([{ code: 'rate_limited', message: 'Zu viele neue Geräte', hello: true }]);
    expect(ws.readyState).toBe(3);
    expect(ws.messages().map((m) => m.type)).toEqual(['hello']);
    expect(conn.status).toBe('reconnecting');
    expect(statuses).not.toContain('open');
    expect(conn.send({ type: 'start' })).toBe(false);
    // Kein toter Socket, der 25 s lang „offen" bleibt: nach 1 s neuer Versuch mit neuem hello
    expect(waitForSocket()).toBe(1000);
    last().accept();
    expect(last().messages()).toEqual([{ type: 'hello', ...getDevice() }]);
  });

  it('nach der Ablehnung zählt nichts mehr auf diesem Socket – die erste Meldung bleibt', () => {
    const { conn, errors } = connect();
    const ws = last();
    ws.lazyClose = true;
    ws.accept();
    ws.receive({ type: 'error', code: 'unauthorized', message: 'Gerät nicht erkannt' });
    expect(ws.readyState).toBe(2);
    ws.receive({ type: 'error', code: 'unauthorized', message: 'Bitte zuerst anmelden (hello)' });
    ws.receive({ type: 'state', state: snapshot() });
    expect(errors).toEqual([{ code: 'unauthorized', message: 'Gerät nicht erkannt', hello: true }]);
    expect(conn.status).toBe('connecting');
    ws.finishClose();
    expect(conn.status).toBe('reconnecting');
    expect(waitForSocket()).toBe(1000);
  });

  it('wiederholt abgelehnt: Pausen wachsen bis 60 s – erst ein Schnappschuss setzt sie zurück', () => {
    const { conn } = connect();
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      last().accept();
      last().receive({ type: 'error', code: 'unauthorized', message: 'Gerät nicht erkannt' });
      waits.push(waitForSocket());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]);
    last().accept();
    last().welcome();
    expect(conn.status).toBe('open');
    last().drop();
    expect(waitForSocket()).toBe(1000);
  });

  it('Serverfehler beim hello: normale Pausen (höchstens 15 s)', () => {
    connect();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      last().accept();
      last().receive({ type: 'error', code: 'server_error', message: 'Interner Serverfehler' });
      waits.push(waitForSocket());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });

  it('Öffnen ohne Anmeldung setzt die Wartezeit nicht zurück', () => {
    connect();
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      last().accept();
      last().serverClose(1011);
      waits.push(waitForSocket());
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
  });

  it('endgültiges Schließen (4000/4001): kein automatischer Neuversuch, „Jetzt verbinden" geht weiter', () => {
    for (const code of [4000, 4001]) {
      FakeWebSocket.instances = [];
      const { conn, statuses } = connect();
      last().accept();
      if (code === 4001) {
        // Server meldet den Fehler und schließt gleich danach – sein Close-Code kommt an
        last().serverCloseCode = code;
        last().receive({ type: 'error', code: 'unauthorized', message: 'Gerät nicht erkannt' });
      } else {
        last().welcome();
        last().serverClose(code);
      }
      expect(conn.status).toBe('closed');
      expect(statuses.at(-1)).toBe('closed');
      vi.advanceTimersByTime(600_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
      // Tab-Wechsel weckt keine endgültig geschlossene Verbindung …
      conn.checkAlive();
      expect(FakeWebSocket.instances).toHaveLength(1);
      // … der Knopf schon
      expect(conn.reconnectNow()).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(conn.status).toBe('reconnecting');
      conn.close();
    }
  });

  it('anderer Close-Code des Servers (vorübergehend): neuer Versuch', () => {
    const { conn } = connect();
    last().accept();
    last().serverClose(4002);
    expect(conn.status).toBe('reconnecting');
    expect(waitForSocket()).toBe(1000);
  });

  // CLIENT-4
  it('Aufbau hängt: nach 8 s aufgeben und neu versuchen – auch, wenn hello unbeantwortet bleibt', () => {
    const { conn } = connect();
    const first = last();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(first.readyState).toBe(0);
    vi.advanceTimersByTime(1);
    expect(first.readyState).toBe(3);
    expect(conn.status).toBe('reconnecting');
    expect(waitForSocket()).toBe(1000);
    const second = last();
    second.accept();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(second.readyState).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Mit Schnappschuss rechtzeitig: kein Abbruch
    expect(waitForSocket()).toBe(2000);
    last().accept();
    last().welcome();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
    expect(last().readyState).toBe(1);
  });

  it('reconnectNow ersetzt auch eine offene Verbindung (z. B. wieder online)', () => {
    const { conn, statuses } = connect();
    const ws = last();
    ws.accept();
    ws.welcome();
    expect(conn.reconnectNow()).toBe(true);
    expect(ws.readyState).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(statuses).toEqual(['open', 'reconnecting']);
    expect(conn.send({ type: 'start' })).toBe(false);
  });

  it('checkAlive: wartende Verbindung sofort, hängender Aufbau nach 3 s ersetzt', () => {
    const { conn } = connect();
    last().drop();
    conn.checkAlive();
    expect(FakeWebSocket.instances).toHaveLength(2);
    // Frischer Aufbau bleibt …
    conn.checkAlive();
    expect(FakeWebSocket.instances).toHaveLength(2);
    // … ein hängender wird ersetzt
    vi.advanceTimersByTime(STALE_CONNECT_MS);
    conn.checkAlive();
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(FakeWebSocket.instances[1].readyState).toBe(3);
  });

  it('checkAlive bei offener Verbindung: Prüf-Ping – Antwort hält sie, Schweigen ersetzt sie sofort', () => {
    const { conn } = connect();
    const ws = last();
    ws.accept();
    ws.welcome();
    ws.receive({ type: 'pong', serverNow: 1_000_000 });
    vi.advanceTimersByTime(1000);
    conn.checkAlive();
    expect(ws.messages().filter((m) => m.type === 'ping')).toHaveLength(2);
    vi.advanceTimersByTime(100);
    ws.receive({ type: 'pong', serverNow: 1_001_100 });
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
    expect(ws.readyState).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    // Zombie: Socket wirkt offen, aber nichts kommt zurück
    conn.checkAlive();
    vi.advanceTimersByTime(PROBE_TIMEOUT_MS - 1);
    expect(ws.readyState).toBe(1);
    vi.advanceTimersByTime(1);
    expect(ws.readyState).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(conn.status).toBe('reconnecting');
  });

  it('checkAlive nach langer Stille (Hintergrund): sofort neu statt erst zu prüfen', () => {
    const { conn } = connect();
    const ws = last();
    ws.accept();
    ws.welcome();
    // Timer im Hintergrund gedrosselt: Uhr läuft, Intervalle feuern nicht
    vi.setSystemTime(Date.now() + PING_INTERVAL_MS + 1);
    conn.checkAlive();
    expect(ws.readyState).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('Ping-Wächter: jede Nachricht zählt als Lebenszeichen', () => {
    const { conn } = connect();
    const ws = last();
    ws.accept();
    ws.welcome(); // Ping 1 – bleibt unbeantwortet
    vi.advanceTimersByTime(PING_INTERVAL_MS - 10);
    ws.welcome(); // anderer Schnappschuss kurz vor dem Intervall
    vi.advanceTimersByTime(10);
    expect(ws.readyState).toBe(1);
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(ws.readyState).toBe(3);
    expect(conn.status).toBe('reconnecting');
  });

  // SEASON-4
  it('erste Uhrenprobe erst nach dem hello – nicht hinter der Anmeldung im Raum', () => {
    const { conn } = connect();
    const ws = last();
    ws.accept();
    // Anmeldung dauert 900 ms (Datenbank)
    vi.advanceTimersByTime(900);
    ws.welcome({ serverNow: 1_000_900 + 5000 });
    expect(ws.messages().map((m) => m.type)).toEqual(['hello', 'ping']);
    vi.advanceTimersByTime(40);
    ws.receive({ type: 'pong', serverNow: 1_000_920 + 5000 });
    expect(conn.clockOffset).toBe(5000);
  });
});

describe('ClockSync: nur frische Proben', () => {
  it('eine alte schnelle Probe gilt nach 60 s nicht mehr (Geräteuhr gesprungen)', () => {
    const c = new ClockSync();
    c.addRoundTrip(10_020, 0, 40); // RTT 40, Offset 10 000
    // Uhr springt um 3 s; neue Proben sind langsamer
    c.addRoundTrip(13_000 + 25_100, 25_000, 25_200); // RTT 200, Offset 13 000
    expect(c.offset).toBe(10_000);
    c.addRoundTrip(13_000 + 50_100, 50_000, 50_200);
    expect(c.offset).toBe(10_000);
    c.addRoundTrip(13_000 + 75_100, 75_000, 75_200);
    expect(c.offset).toBe(13_000);
  });

  it('nur die letzten 5 Proben', () => {
    const c = new ClockSync();
    c.addRoundTrip(1010, 0, 20); // schnellste, Offset 1000
    for (let i = 1; i <= 4; i++) c.addRoundTrip(2000 + i * 1000 + 50, i * 1000, i * 1000 + 100);
    expect(c.offset).toBe(1000);
    c.addRoundTrip(2000 + 5000 + 50, 5000, 5100);
    expect(c.offset).toBe(2000);
  });

  it('nach langer Pause zählt der frische Schnappschuss, bis ein neuer Pong kommt', () => {
    const c = new ClockSync();
    c.addRoundTrip(1020, 0, 40);
    expect(c.offset).toBe(1000);
    c.addOneWay(600_000 + 4000, 600_000);
    expect(c.offset).toBe(4000);
    c.addRoundTrip(600_100 + 3900, 600_050, 600_150);
    expect(c.offset).toBe(3900);
  });
});

// ---------------------------------------------------------------- HTTP

describe('HTTP', () => {
  it('createDraft hängt die Geräte-Identität an', async () => {
    const client = await fresh();
    const fetch = stubFetch(json(200, { code: 'ABC234' }));
    const res = await client.createDraft({ settings: { region: 2 }, teamName: 'FC Test', formation: '4-4-2' });
    expect(res).toEqual({ code: 'ABC234' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/drafts');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    const device = (await import('../src/lib/device')).getDevice();
    expect(body).toEqual({ ...device, settings: { region: 2 }, teamName: 'FC Test', formation: '4-4-2' });
  });

  it('Schnappschuss: 404 → ApiRequestError not_found (auch ohne JSON)', async () => {
    const client = await fresh();
    const { ApiRequestError } = await import('../src/lib/api/client');
    stubFetch(json(404, { error: 'not_found', message: 'Diese Liga gibt es nicht' }));
    await expect(client.fetchDraftSnapshot('ABC234')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    stubFetch(new Response('nope', { status: 404 }));
    const err = await client.fetchDraftSnapshot('ABC234').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'Liga nicht gefunden' });
  });

  it('Netzwerkfehler und Rate-Limit', async () => {
    const client = await fresh();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(client.fetchPublicLobbies()).rejects.toMatchObject({ code: 'network', status: 0 });
    stubFetch(new Response('', { status: 429 }));
    await expect(client.fetchPublicLobbies()).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
  });

  it('draftsSupported liest features.drafts aus dem Health-Check', async () => {
    const health: HealthResponse = { ok: true, version: 1, day: '2026-10-12' };
    let client = await fresh();
    stubFetch(json(200, { ...health, features: { drafts: true } }));
    expect(await client.draftsSupported()).toBe(true);

    client = await fresh();
    stubFetch(json(200, health));
    expect(await client.draftsSupported()).toBe(false);

    client = await fresh();
    stubFetch(new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await client.draftsSupported()).toBe(false);
  });
});

// ---------------------------------------------------------------- Ansicht aus dem Schnappschuss

const SCALE = buildScale(ALL, 'all');

function lobby(teams = 1): DraftState {
  let s = createEngineDraft({
    code: 'ABC234',
    seed: 42,
    settings: { region: 1, maxTeams: 4 },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  for (let i = 1; i < teams; i++) {
    s = joinDraft(s, { teamId: `t${i}`, deviceId: `dev-${i}`, name: `Team ${i}`, formation: '4-4-2' });
  }
  return s;
}

/** Nächsten Pick so setzen, wie der Server einen Auto-Pick setzen würde. */
function autoPick(s: DraftState, now: number): DraftState {
  const team = currentTeam(s)!;
  const c = autoPickChoice(s, team.id, ALL, SCALE, false);
  return applyPick(s, team.id, c.pokemonId, c.slot, true, now, ALL);
}

describe('draftRoomView', () => {
  it('ohne Schnappschuss: leer', () => {
    expect(draftRoomView(null)).toMatchObject({ me: null, isHost: false, current: null, myTurn: false, full: false });
  });

  it('Lobby: Host, Zuschauer, volle Liga', () => {
    const s = lobby(2);
    const host = draftRoomView(snapshotOf(s, 'h', 0));
    expect(host.me?.name).toBe('Host FC');
    expect(host.isHost).toBe(true);
    expect(host.current).toBeNull();
    expect(host.full).toBe(false);
    const guest = draftRoomView(snapshotOf(s, 't1', 0));
    expect(guest.isHost).toBe(false);
    const viewer = draftRoomView(snapshotOf(s, null, 0));
    expect(viewer.me).toBeNull();
    expect(draftRoomView(snapshotOf(lobby(4), null, 0)).full).toBe(true);
  });

  it('Draft: wer dran ist, Runde und Pick, letzter Pick', () => {
    let s = startDraft(addCpuTeam(lobby(2), 'dev-h', 'cpu1'), 'dev-h', 0, ALL);
    const n = s.teams.length;
    const first = s.teams[teamIndexForPick(0, n)];
    const v0 = draftRoomView(snapshotOf(s, first.id, 0));
    expect(v0.myTurn).toBe(true);
    expect(v0.current?.id).toBe(first.id);
    expect(v0).toMatchObject({ round: 1, rounds: 11, pickNo: 1, totalPicks: n * 11, lastPick: null });
    const other = s.teams.find((t) => t.id !== first.id && !t.cpu)!;
    expect(draftRoomView(snapshotOf(s, other.id, 0)).myTurn).toBe(false);

    // Snake: nach n Picks ist Runde 2 und das letzte Team aus Runde 1 wieder dran
    for (let i = 0; i < n; i++) s = autoPick(s, 1000 + i);
    const v = draftRoomView(snapshotOf(s, null, 5000));
    expect(v).toMatchObject({ round: 2, pickNo: n + 1 });
    expect(v.current?.id).toBe(s.teams[n - 1].id);
    expect(v.lastPick).toMatchObject({ pick: n - 1, teamId: s.teams[n - 1].id, auto: true });
  });

  it('fertig: Pick-Anzeige bleibt beim letzten Pick stehen', () => {
    let s = startDraft(lobby(2), 'dev-h', 0, ALL);
    for (let i = 0; i < totalPicks(s); i++) s = autoPick(s, i);
    expect(s.phase).toBe('done');
    const v = draftRoomView(snapshotOf(s, 'h', 0));
    expect(v).toMatchObject({ myTurn: false, current: null, pickNo: totalPicks(s), round: 11 });
  });
});

describe('Lobby-Helfer', () => {
  it('startBlocker: zu wenige Teams', () => {
    expect(startBlocker(snapshotOf(lobby(1), 'h', 0), ALL)).toMatch(/Mindestens 2 Teams/);
    expect(startBlocker(snapshotOf(lobby(2), 'h', 0), ALL)).toBeNull();
    const started = startDraft(lobby(2), 'dev-h', 0, ALL);
    expect(startBlocker(snapshotOf(started, 'h', 0), ALL)).toMatch(/läuft/);
  });

  it('fitSettingsPatch senkt maxTeams, wenn der Pool kleiner wird', () => {
    const base = lobby(1).settings; // Kanto, 4 Teams
    const big = { ...base, maxTeams: 8 };
    const kalos = Math.min(8, maxTeamsForPool({ ...big, gens: [6] }, ALL));
    expect(kalos).toBeLessThan(8);
    expect(fitSettingsPatch(big, { gens: [6] }, ALL)).toEqual({ gens: [6], maxTeams: kalos });
    // passt ohnehin → unverändert
    expect(fitSettingsPatch(base, { gens: [...DRAFT_ALL_GENS] }, ALL)).toEqual({ gens: [...DRAFT_ALL_GENS] });
    // schon mehr Teams beigetreten, als der neue Pool trägt → geht nicht
    expect(fitSettingsPatch(big, { gens: [6] }, ALL, kalos + 1)).toBeNull();
    // weniger Plätze als Teams → geht nicht
    expect(fitSettingsPatch(big, { maxTeams: 2 }, ALL, 3)).toBeNull();
  });

  it('Teamnamen: Leerraum zusammenfassen und kürzen', () => {
    expect(cleanTeamName('  FC   Glurak  ')).toBe('FC Glurak');
    expect(cleanTeamName('x'.repeat(60))).toHaveLength(DRAFT_LIMITS.teamNameMax);
    expect(cleanTeamName('   ')).toBe('');
  });

  it('Restzeit nach Serveruhr', () => {
    expect(remainingMs(null, 0, 0)).toBeNull();
    expect(remainingMs(10_000, 500, 9_000)).toBe(500);
    expect(remainingMs(10_000, -2_000, 9_000)).toBe(3_000);
    expect(remainingMs(10_000, 0, 20_000)).toBe(0);
  });

  it('Verlauf: neueste Picks zuerst, mit Namen; Besitzer der Pokémon', () => {
    let s = startDraft(lobby(2), 'dev-h', 0, ALL);
    for (let i = 0; i < 3; i++) s = autoPick(s, i);
    const snap = snapshotOf(s, 'h', 0);
    const byId = new Map(ALL.map((p) => [p.id, p]));
    const feed = pickFeed(snap, byId, 2);
    expect(feed).toHaveLength(2);
    expect(feed[0].no).toBe(3);
    expect(feed[1].no).toBe(2);
    expect(feed[0].pokemon).toBe(byId.get(s.picks[2].pokemonId)!.de);
    expect(feed[0].team).toBe(s.teams.find((t) => t.id === s.picks[2].teamId)!.name);
    expect(feed[0].auto).toBe(true);
    const owners = ownerOfPicks(snap);
    expect(owners.size).toBe(3);
    expect(owners.get(s.picks[0].pokemonId)?.id).toBe(s.picks[0].teamId);
    // Position (wo das Pokémon jetzt steht) und Fit mit Skala; ohne Skala nur die Position
    const withFit = pickFeed(snap, byId, 2, undefined, SCALE);
    const team = s.teams.find((t) => t.id === s.picks[2].teamId)!;
    const pos = FORMATIONS[team.formation].slots[team.slots.indexOf(s.picks[2].pokemonId)].pos;
    expect(withFit[0].pos).toBe(pos);
    expect(withFit[0].fit).toBe(Math.round(positionFit(byId.get(s.picks[2].pokemonId)!, pos, SCALE)));
    expect(feed[0].pos).toBe(pos);
    expect(feed[0].fit).toBeUndefined();
    // 🏅 höchster Fit aller Picks (bei Gleichstand der frühere), nur mit Skala
    const all = pickFeed(snap, byId, 8, undefined, SCALE);
    const best = Math.max(...all.map((f) => f.fit ?? -1));
    expect(all.filter((f) => f.top).map((f) => f.no)).toEqual([Math.min(...all.filter((f) => f.fit === best).map((f) => f.no))]);
    expect(pickFeed(snap, byId, 8).some((f) => f.top)).toBe(false);
    expect(pickFeed(snapshotOf(autoPick(startDraft(lobby(2), 'dev-h', 0, ALL), 0), 'h', 0), byId, 8, undefined, SCALE)[0].top).toBeUndefined();
  });
});

describe('Deine Ligen (lokal gemerkt)', () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    });
    return map;
  }

  it('merkt sich nur Ligen mit eigenem Team, neueste zuerst, ohne Doppelte', () => {
    const map = memoryStorage();
    const s = lobby(2);
    const T = Date.now();
    rememberLeague(snapshotOf(s, null, 0), T + 1000);
    expect(loadRecentLeagues(T + 1000)).toEqual([]);
    rememberLeague(snapshotOf(s, 't1', 0), T + 1000);
    rememberLeague(snapshotOf({ ...s, code: 'QWE234' }, 'h', 0), T + 2000);
    expect(loadRecentLeagues(T + 3000).map((l) => [l.code, l.team, l.phase])).toEqual([
      ['QWE234', 'Host FC', 'lobby'],
      ['ABC234', 'Team 1', 'lobby'],
    ]);
    // Phasenwechsel aktualisiert den Eintrag und schiebt ihn nach vorn
    const started = startDraft(s, 'dev-h', 0, ALL);
    rememberLeague(snapshotOf(started, 't1', 0), T + 4000);
    expect(loadRecentLeagues(T + 5000).map((l) => [l.code, l.phase])).toEqual([
      ['ABC234', 'drafting'],
      ['QWE234', 'lobby'],
    ]);
    // Gleicher Stand kurz danach → kein erneutes Schreiben
    const writes = map.get('pokemon-elf:draft-online:recent');
    rememberLeague(snapshotOf(started, 't1', 0), T + 9000);
    expect(map.get('pokemon-elf:draft-online:recent')).toBe(writes);
    forgetLeague('ABC234');
    expect(loadRecentLeagues(T + 5000).map((l) => l.code)).toEqual(['QWE234']);
  });

  it('vergisst Ligen nach der Aufbewahrungszeit und übersteht kaputte Daten', () => {
    const map = memoryStorage();
    rememberLeague(snapshotOf(lobby(1), 'h', 0), 0);
    expect(loadRecentLeagues(DRAFT_LIMITS.retentionDays * 86_400_000 - 1)).toHaveLength(1);
    expect(loadRecentLeagues(DRAFT_LIMITS.retentionDays * 86_400_000)).toHaveLength(0);
    map.set('pokemon-elf:draft-online:recent', '{"kaputt":');
    expect(loadRecentLeagues()).toEqual([]);
    map.set('pokemon-elf:draft-online:recent', JSON.stringify([null, { code: 1 }, { code: 'ABC234', at: Date.now() }]));
    expect(loadRecentLeagues().map((l) => l.code)).toEqual(['ABC234']);
  });
});
