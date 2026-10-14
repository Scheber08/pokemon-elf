/**
 * Render-Tests des Online-Drafts mit react-dom/client auf einem Mini-DOM (tests/miniDom.ts):
 * der Raum-Hook mit gestubbtem WebSocket und fetch (abgelehnte Anmeldung, Existenzprüfung,
 * eigene Rolle beim Wiederverbinden, Sperren laufender Aktionen, Auto-Pick mit Ziel, Aufwachen),
 * das Pokémon-Raster (Scrollposition bei Schnappschüssen) und der Live-Draft (eine Live-Region,
 * Nur-Ansicht ohne Verbindung).
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSettingsPatch, DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftRoom } from '../src/state/useDraftRoom';
import type { DraftState } from '../src/lib/draftEngine';
import { ALL } from './helpers';
import { FakeObserver, installMiniDom, MiniElement, MiniEvent } from './miniDom';

const doc = installMiniDom();
// <select> (Formation der Manager-Saison): React liest select.options – im Mini-DOM nachgerüstet
Object.defineProperty(MiniElement.prototype, 'options', {
  configurable: true,
  get(this: MiniElement) {
    if (this.localName !== 'select') return undefined;
    return this.querySelectorAll('option').map((o) => {
      if (o.value == null) o.value = o.getAttribute('value') ?? o.textContent;
      return o;
    });
  },
});
// React-DOM und alles mit UI erst nach dem Mini-DOM laden (React prüft beim Laden, ob es ein DOM gibt)
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { PokemonGrid } = await import('../src/components/PokemonGrid');
const { DraftLive } = await import('../src/components/DraftLive');
const { DraftLobby } = await import('../src/components/DraftLobby');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { MemoryRouter } = await import('react-router-dom');
const hook = await import('../src/state/useDraftRoom');
const engine = await import('../src/lib/draftEngine');
const { buildScale } = await import('../src/lib/fit');

const { act, createElement: h } = React;
const SCALE = buildScale(ALL, 'all');

// ---------------------------------------------------------------- Helfer

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type SnapshotAnswer = () => Response | Promise<Response>;

/** fetch: Pokémon-Daten echt, Liga-Schnappschuss nach Plan (letzte Antwort wiederholt sich). */
function stubFetch(...snapshots: SnapshotAnswer[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.endsWith('data/forms.json')) return json(200, []);
      calls.push(url);
      const next = snapshots.length > 1 ? snapshots.shift()! : snapshots[0];
      if (!next) throw new TypeError('Failed to fetch');
      return next();
    }),
  );
  return calls;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('Socket nicht offen');
    this.sent.push(data);
  }
  close(code?: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1005 });
  }
  accept() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  messages() {
    return this.sent.map((s) => JSON.parse(s) as { type: string } & Record<string, unknown>);
  }
}
const sock = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

/** Zeit vorspulen und dabei Promises (fetch) und React-Updates abarbeiten. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Zustellen einer Server-Nachricht innerhalb von act. */
async function serverSays(ws: FakeWebSocket, msg: unknown) {
  await act(async () => ws.receive(msg));
}

const mounted: (() => Promise<void>)[] = [];

async function render(el: ReactElement) {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(el));
  const unmount = async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  };
  mounted.push(unmount);
  return { container, root, unmount };
}

function lobby(teams = 2, settings: DraftSettingsPatch = { region: 1, maxTeams: 4 }): DraftState {
  let s = engine.createDraft({
    code: 'ABC234',
    seed: 42,
    settings,
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  for (let i = 1; i < teams; i++) {
    s = engine.joinDraft(s, { teamId: `t${i}`, deviceId: `dev-${i}`, name: `Team ${i}`, formation: '4-4-2' });
  }
  return s;
}

function autoPick(s: DraftState): DraftState {
  const team = engine.currentTeam(s)!;
  const c = engine.autoPickChoice(s, team.id, ALL, SCALE, false);
  return engine.applyPick(s, team.id, c.pokemonId, c.slot, true, 1000, ALL);
}

const snap = (s: DraftState, you: string | null = 'h'): DraftSnapshot => engine.snapshotOf(s, you, Date.now());

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeObserver.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  doc.visibilityState = 'visible';
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- Raum-Hook

describe('useDraftRoom', () => {
  let room: DraftRoom;
  function Probe() {
    room = hook.useDraftRoom('ABC234');
    return null;
  }
  const mount = () => render(h(PokemonDataProvider, null, h(Probe)));

  // CLIENT-2 / SEASON-3
  it('abgelehnte Anmeldung: echte Meldung bleibt stehen, öffentliche Vorschau statt Spinner, Neuversuch', async () => {
    stubFetch(() => json(200, snap(lobby(2), null)));
    await mount();
    await settle();
    expect(room.state?.you).toBeNull();
    expect(hook.draftRoomReady(room)).toBe(false); // erster Aufbau läuft noch: kurz warten
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'error', code: 'rate_limited', message: 'Zu viele neue Geräte – bitte später erneut versuchen' });
    expect(room.authError).toBe('Zu viele neue Geräte – bitte später erneut versuchen');
    expect(room.error).toBeNull();
    expect(room.status).toBe('reconnecting');
    expect(room.live).toBe(false);
    expect(hook.draftRoomReady(room)).toBe(true);
    // Kein Ping vor der Anmeldung → keine zweite, irreführende Meldung
    expect(ws.messages().map((m) => m.type)).toEqual(['hello']);
    // Bleibt stehen (kein Ausblenden nach 6 s)
    await settle(hook.DRAFT_ERROR_MS);
    expect(room.authError).not.toBeNull();
    // Neuer Versuch klappt → Meldung weg, eigene Ansicht
    const retry = sock();
    expect(retry).not.toBe(ws);
    retry.accept();
    await serverSays(retry, { type: 'state', state: snap(lobby(2), 'h') });
    expect(room.authError).toBeNull();
    expect(room.live).toBe(true);
    expect(room.status).toBe('open');
    expect(room.isHost).toBe(true);
  });

  // CLIENT-8
  it('Existenzprüfung: nach Netzfehlern mit Pause erneut, bis die Antwort eindeutig ist (404 → nicht gefunden)', async () => {
    const calls = stubFetch(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json(404, { error: 'not_found', message: 'Diese Liga gibt es nicht' }),
    );
    await mount();
    await settle();
    expect(calls).toHaveLength(1);
    expect(room.status).toBe('connecting');
    await settle(hook.checkRetryDelay(0));
    expect(calls).toHaveLength(2);
    await settle(hook.checkRetryDelay(1));
    expect(calls).toHaveLength(3);
    expect(room.status).toBe('not_found');
  });

  it('Existenzprüfung frischt die Vorschau auf, solange keine Anmeldung klappt – und hört danach auf', async () => {
    const s = lobby(2);
    const calls = stubFetch(
      () => json(200, snap(s, null)),
      () => json(200, snap(engine.startDraft(s, 'dev-h', 0, ALL), null)),
    );
    await mount();
    await settle();
    expect(room.state?.phase).toBe('lobby');
    await settle(hook.CHECK_REFRESH_MS);
    expect(calls).toHaveLength(2);
    expect(room.state?.phase).toBe('drafting');
    // Angemeldet → keine Prüfungen mehr
    await act(async () => room.reconnect());
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(engine.startDraft(s, 'dev-h', 0, ALL), 'h') });
    expect(room.status).toBe('open');
    for (let i = 0; i < 4; i++) {
      await serverSays(ws, { type: 'pong', serverNow: Date.now() });
      await settle(24_000);
    }
    expect(room.status).toBe('open');
    expect(calls).toHaveLength(2);
  });

  // CLIENT-7
  it('beim Wiederverbinden bleibt die eigene Rolle – die Vorschau (ohne „du") überschreibt nichts', async () => {
    const s = lobby(2);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    await settle();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    expect(room.isHost).toBe(true);
    await act(async () => ws.drop());
    await settle();
    expect(room.status).toBe('reconnecting');
    expect(room.state?.you).toBe('h');
    expect(room.isHost).toBe(true);
    expect(room.live).toBe(true);
  });

  // CLIENT-5
  it('Start/CPU/Beitreten: Doppelklick sendet nur einmal; fremde Schnappschüsse lösen die Sperre nicht', async () => {
    const s = lobby(2);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    let first = false;
    let second = true;
    await act(async () => {
      first = room.start();
      second = room.start();
    });
    expect([first, second]).toEqual([true, false]);
    expect(room.busy.start).toBe(true);
    // Online-Wechsel eines anderen Teams: Sperre bleibt
    await serverSays(ws, { type: 'state', state: snap(engine.setOnline(s, 't1', true), 'h') });
    expect(room.busy.start).toBe(true);
    await act(async () => void room.start());
    // Draft läuft → frei
    const started = engine.startDraft(s, 'dev-h', 0, ALL);
    await serverSays(ws, { type: 'state', state: snap(started, 'h') });
    expect(room.busy.start).toBe(false);
    expect(ws.messages().filter((m) => m.type === 'start')).toHaveLength(1);

    // CPU: zweimal schnell → eine Nachricht; Fehler löst die Sperre
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    await act(async () => {
      room.addCpu();
      room.addCpu();
    });
    expect(ws.messages().filter((m) => m.type === 'add-cpu')).toHaveLength(1);
    await serverSays(ws, { type: 'error', code: 'full', message: 'Die Liga ist voll' });
    expect(room.busy['add-cpu']).toBe(false);
    expect(room.error).toBe('Die Liga ist voll');
  });

  it('Pick: „wird gesendet" bis zum eigenen Pick – nicht bis zum nächsten beliebigen Schnappschuss', async () => {
    const s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host' }), 'dev-h', 0, ALL);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    expect(room.myTurn).toBe(true);
    const c = engine.autoPickChoice(s, 'h', ALL, SCALE, false);
    await act(async () => {
      room.pick(c.pokemonId, c.slot);
      room.pick(c.pokemonId, c.slot);
    });
    expect(ws.messages().filter((m) => m.type === 'pick')).toHaveLength(1);
    expect(room.pending).toBe(true);
    await serverSays(ws, { type: 'state', state: snap(engine.setOnline(s, 't1', false), 'h') });
    expect(room.pending).toBe(true);
    await serverSays(ws, { type: 'state', state: snap(engine.applyPick(s, 'h', c.pokemonId, c.slot, false, 1, ALL), 'h') });
    expect(room.pending).toBe(false);
  });

  it('ohne Antwort: Sperre nach 10 s frei, Hinweis, Verbindung wird geprüft', async () => {
    const s = lobby(2);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    await serverSays(ws, { type: 'pong', serverNow: Date.now() });
    await act(async () => void room.start());
    await settle(hook.DRAFT_ACTION_TIMEOUT_MS - 1);
    expect(room.busy.start).toBe(true);
    await settle(1);
    expect(room.busy.start).toBe(false);
    expect(room.error).toMatch(/Keine Antwort vom Server/);
    // Prüf-Ping ging raus
    expect(ws.messages().filter((m) => m.type === 'ping')).toHaveLength(2);
  });

  it('ohne Antwort: feuert der Timer „zu früh" (Uhr nachgestellt), wird er neu gestellt statt die Sperre zu vergessen', async () => {
    const s = lobby(2);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    await act(async () => void room.start());
    vi.setSystemTime(Date.now() - 5); // Systemuhr springt 5 ms zurück
    await settle(hook.DRAFT_ACTION_TIMEOUT_MS);
    expect(room.busy.start).toBe(true);
    await settle(10);
    expect(room.busy.start).toBe(false);
    expect(room.error).toMatch(/Keine Antwort vom Server/);
  });

  it('ein fremder Fehler gibt einen laufenden Pick nicht frei', async () => {
    const s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    const c = engine.autoPickChoice(s, 'h', ALL, SCALE, false);
    await act(async () => void room.pick(c.pokemonId, c.slot));
    expect(room.pending).toBe(true);
    await serverSays(ws, { type: 'error', code: 'rate_limited', message: 'Zu viele Änderungen', for: 'settings' });
    expect(room.pending).toBe(true);
    await act(async () => void room.pick(c.pokemonId, c.slot));
    expect(ws.messages().filter((m) => m.type === 'pick')).toHaveLength(1);
    // Der Fehler zum Pick selbst gibt ihn frei
    await serverSays(ws, { type: 'error', code: 'not_your_turn', message: 'Du bist nicht dran', for: 'pick' });
    expect(room.pending).toBe(false);
  });

  // CLIENT-3
  it('Auto-Pick des Hosts nennt das Team, sperrt bis zum nächsten Pick und sendet nichts für einen veralteten Zug', async () => {
    let s = engine.startDraft(lobby(3, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    s = autoPick(s); // Host hat gewählt → Team 1 (offline) ist dran
    expect(engine.currentTeam(s)?.id).toBe('t1');
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    await act(async () => {
      room.autoPick('t1');
      room.autoPick('t1');
    });
    expect(ws.messages().filter((m) => m.type === 'auto-pick')).toEqual([{ type: 'auto-pick', teamId: 't1', pickIndex: 1 }]);
    expect(room.busy['auto-pick']).toBe(true);
    const next = autoPick(s);
    await serverSays(ws, { type: 'state', state: snap(next, 'h') });
    expect(room.busy['auto-pick']).toBe(false);
    // Jetzt ist Team 2 dran – ein veralteter (zweiter) Klick für Team 1 geht nicht raus
    expect(engine.currentTeam(next)?.id).toBe('t2');
    let sent = true;
    await act(async () => {
      sent = room.autoPick('t1');
    });
    expect(sent).toBe(false);
    expect(ws.messages().filter((m) => m.type === 'auto-pick')).toHaveLength(1);
  });

  // CLIENT-4
  it('Tab wieder sichtbar: Prüf-Ping; wieder online: sofort neue Verbindung', async () => {
    const s = lobby(2);
    stubFetch(() => json(200, snap(s, null)));
    await mount();
    const ws = sock();
    ws.accept();
    await serverSays(ws, { type: 'state', state: snap(s, 'h') });
    await serverSays(ws, { type: 'pong', serverNow: Date.now() });
    await act(async () => void doc.dispatchEvent(new MiniEvent('visibilitychange')));
    expect(ws.messages().filter((m) => m.type === 'ping')).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(async () => void (globalThis as unknown as { dispatchEvent(e: MiniEvent): boolean }).dispatchEvent(new MiniEvent('online')));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(ws.readyState).toBe(3);
    expect(room.status).toBe('reconnecting');
  });
});

// ---------------------------------------------------------------- Pokémon-Raster (CLIENT-1)

describe('PokemonGrid', () => {
  const items = ALL.slice(0, 300);
  const grid = (list: typeof items, resetKey?: string) =>
    h(SettingsProvider, null, h(PokemonGrid, { items: list, sprite: 'pixel', onPick: () => {}, resetKey }));
  const cards = (c: MiniElement) => c.querySelectorAll('[data-grid-item]').length;

  it('mit resetKey: neue Liste (Pick) behält die angezeigte Menge, neuer Schlüssel beginnt von vorn', async () => {
    const { container, root } = await render(grid(items, 'a'));
    expect(cards(container)).toBe(84);
    await act(async () => FakeObserver.fireAll());
    expect(cards(container)).toBe(168);
    // Schnappschuss nach einem Pick: neue Liste ohne ein Pokémon
    await act(async () => root.render(grid(items.filter((p) => p.id !== items[3].id), 'a')));
    expect(cards(container)).toBe(168);
    await act(async () => root.render(grid([...items], 'a')));
    expect(cards(container)).toBe(168);
    // Anderer Filter → von vorn
    await act(async () => root.render(grid(items.slice(0, 200), 'b')));
    expect(cards(container)).toBe(84);
  });

  it('ohne resetKey (andere Aufrufer): neue Liste beginnt wie bisher von vorn', async () => {
    const { container, root } = await render(grid(items));
    await act(async () => FakeObserver.fireAll());
    expect(cards(container)).toBe(168);
    await act(async () => root.render(grid([...items])));
    expect(cards(container)).toBe(84);
  });
});

// ---------------------------------------------------------------- Live-Draft & Lobby

function fakeRoom(s: DraftSnapshot, over: Partial<DraftRoom> = {}): DraftRoom {
  return {
    ...hook.draftRoomView(s),
    status: 'open',
    state: s,
    live: true,
    error: null,
    clearError() {},
    authError: null,
    clockOffset: 0,
    pending: false,
    busy: { pick: false, 'auto-pick': false, start: false, join: false, 'add-cpu': false, settings: false, reroll: false },
    drafted: engine.draftedIds(s),
    join: vi.fn(() => true),
    leave: vi.fn(() => true),
    updateTeam: vi.fn(() => true),
    updateSettings: vi.fn(() => true),
    addCpu: vi.fn(() => true),
    removeTeam: vi.fn(() => true),
    setOrder: vi.fn(() => true),
    start: vi.fn(() => true),
    pick: vi.fn(() => true),
    autoPick: vi.fn(() => true),
    reroll: vi.fn(() => true),
    setQueue: vi.fn(() => true),
    setLineup: vi.fn(() => true),
    setTransfer: vi.fn(() => true),
    offerTrade: vi.fn(() => true),
    setJerseys: vi.fn(() => true),
    setCaptain: vi.fn(() => true),
    setKit: vi.fn(() => true),
    setCheer: vi.fn(() => true),
    setCrest: vi.fn(() => true),
    answerOffer: vi.fn(() => true),
    react: vi.fn(() => true),
    reactions: [],
    reconnect: vi.fn(),
    ...over,
  };
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

describe('DraftLive', () => {
  beforeEach(() => {
    stubFetch();
  });

  async function renderLive(room: DraftRoom, readOnly?: boolean) {
    const r = await render(app(h(DraftLive, { room, readOnly })));
    await settle();
    return r;
  }

  // Alle Regionen (großer Pool), Reihenfolge wie gelistet: Host zuerst
  const drafting = () => engine.startDraft(lobby(2, { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);

  // CLIENT-9
  it('genau eine Live-Region, eine Ansage pro Pick', async () => {
    let s = autoPick(drafting());
    const { container, root } = await renderLive(fakeRoom(snap(s, 't1')));
    // Nur innerhalb des Drafts zählen (die Toast-Leiste der App hat ihre eigene Region)
    const draft = () => container.querySelector('.draft-live')!;
    const live = () => draft().querySelectorAll('[aria-live]');
    expect(live()).toHaveLength(1);
    expect(draft().querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(live()[0].textContent).toMatch(/^Pick 1: .+ an Host FC \(automatisch\)\.$/);
    // Team 1 ist dran → „Du bist dran!" als Alarm, Ansage ohne „Am Zug"
    expect(draft().querySelectorAll('[role="alert"]')).toHaveLength(1);
    s = autoPick(s);
    await act(async () => root.render(app(h(DraftLive, { room: fakeRoom(snap(s, 'h')) }))));
    expect(live()).toHaveLength(1);
    expect(draft().querySelectorAll('[role="alert"]')).toHaveLength(0);
    // Snake: Team 1 wählt gleich noch einmal
    expect(live()[0].textContent).toMatch(/^Pick 2: .+ an Team 1 \(automatisch\)\. Am Zug: Team 1\.$/);
  });

  // CLIENT-1
  it('Pool behält die angezeigte Menge, wenn ein Schnappschuss kommt', async () => {
    let s = drafting();
    const { container, root } = await renderLive(fakeRoom(snap(s, 't1')));
    const cards = () => container.querySelectorAll('.pgrid [data-grid-item]').length;
    expect(cards()).toBe(84);
    await act(async () => FakeObserver.fireAll());
    expect(cards()).toBe(168);
    // Online-Wechsel (neues Objekt, nichts vergeben)
    await act(async () => root.render(app(h(DraftLive, { room: fakeRoom(snap(engine.setOnline(s, 'h', true), 't1')) }))));
    expect(cards()).toBe(168);
    // Fremder Pick: eine Karte weniger in der Liste, die Menge bleibt
    s = autoPick(s);
    await act(async () => root.render(app(h(DraftLive, { room: fakeRoom(snap(s, 't1')) }))));
    expect(cards()).toBe(168);
  });

  // CLIENT-3
  it('Host-Auto-Pick: Knopf nennt das aktuelle Team und ist gesperrt, solange er läuft', async () => {
    const s = autoPick(drafting()); // Team 1 (offline) ist dran
    const room = fakeRoom(snap(s, 'h'));
    const { container, root } = await renderLive(room);
    const button = () => container.querySelector('.draft-hostauto button')!;
    expect(button()).not.toBeNull();
    expect(button().textContent).toBe('Automatisch für Team 1 wählen');
    await act(async () => button().click());
    expect(room.autoPick).toHaveBeenCalledWith('t1');
    const busy = fakeRoom(snap(s, 'h'), { busy: { ...room.busy, 'auto-pick': true } });
    await act(async () => root.render(app(h(DraftLive, { room: busy }))));
    // aria-disabled statt disabled: Der Tastaturfokus bleibt auf dem Knopf
    expect(button().getAttribute('aria-disabled')).toBe('true');
    expect(button().hasAttribute('disabled')).toBe(false);
    expect(button().textContent).toBe('Wird gewählt …');
    await act(async () => button().click());
    expect(busy.autoPick).not.toHaveBeenCalled();
  });

  it('Auto-Pick für Abwesende: jedes Mitglied, erst nach der Frist (vorher Countdown)', async () => {
    const three = engine.startDraft(lobby(3, { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    let s = autoPick(three); // Team 1 ist dran …
    s = engine.setOnline(engine.setOnline(s, 't1', true), 't1', false, Date.now() - 5000); // … und seit 5 s weg
    s = { ...s, turnStartedAt: Date.now() - 5000 }; // (ohne Timer zählt sonst auch der alte Zugbeginn)
    const room = fakeRoom(snap(s, 't2')); // Team 2 ist nicht Host
    const { container } = await renderLive(room);
    const notice = () => container.querySelector('.draft-hostauto');
    expect(notice()?.textContent).toBe('Team 1 ist offline. Auto-Pick in 15 s möglich.');
    expect(notice()?.querySelector('button')).toBeNull();
    // sekundenweise: Der Hinweis plant seinen nächsten Tick erst nach dem Rendern
    const seconds = async (n: number) => {
      for (let i = 0; i < n; i++) await act(async () => vi.advanceTimersByTime(1000));
    };
    await seconds(10);
    expect(notice()?.textContent).toContain('Auto-Pick in 5 s möglich.');
    await seconds(5);
    const button = notice()!.querySelector('button')!;
    expect(button.textContent).toBe('Automatisch für Team 1 wählen');
    await act(async () => button.click());
    expect(room.autoPick).toHaveBeenCalledWith('t1');
  });

  // CLIENT-7
  it('Nur-Ansicht (ohne Verbindung): kein „Du schaust zu", keine Host-Knöpfe', async () => {
    const s = autoPick(drafting());
    const { container } = await renderLive(fakeRoom(snap(s, null), { live: false, status: 'reconnecting' }), true);
    expect(container.textContent).toContain('Nur Ansicht');
    expect(container.textContent).not.toContain('Du schaust zu');
    expect(container.querySelector('.draft-hostauto')).toBeNull();
  });
});

describe('DraftLobby', () => {
  beforeEach(() => {
    stubFetch();
  });

  // CLIENT-7 / SEASON-3
  it('Nur-Ansicht: kein Beitreten-Formular, Hinweis statt dessen', async () => {
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2), null), { live: false }), readOnly: true })));
    await settle();
    expect(container.textContent).toContain('Nur Ansicht');
    expect(container.querySelector('form')).toBeNull();
  });

  // CLIENT-5
  it('Start, CPU und Einstellungen nehmen nichts an, solange die Aktion läuft', async () => {
    const room = fakeRoom(snap(lobby(2), 'h'), {
      busy: { pick: false, 'auto-pick': false, start: true, join: false, 'add-cpu': true, settings: true, reroll: false },
    });
    const { container } = await render(app(h(DraftLobby, { room })));
    await settle();
    const start = container.querySelector('.draft-start button')!;
    expect(start.textContent).toBe('Draft wird gestartet …');
    expect(start.hasAttribute('disabled')).toBe(true);
    const cpu = container.querySelectorAll('button').find((b) => b.textContent === 'CPU-Team hinzufügen')!;
    expect(cpu.getAttribute('aria-disabled')).toBe('true');
    await act(async () => cpu.click());
    expect(room.addCpu).not.toHaveBeenCalled();
    // Einstellungen: Klick auf eine andere Option wird nicht gesendet
    const johto = container.querySelectorAll('.draft-settings button').find((b) => b.textContent === 'Johto')!;
    expect(johto.getAttribute('aria-disabled')).toBe('true');
    await act(async () => johto.click());
    expect(room.updateSettings).not.toHaveBeenCalled();
  });

  it('ohne laufende Aktion: CPU und Einstellungen senden', async () => {
    const room = fakeRoom(snap(lobby(2), 'h'));
    const { container } = await render(app(h(DraftLobby, { room })));
    await settle();
    const cpu = container.querySelectorAll('button').find((b) => b.textContent === 'CPU-Team hinzufügen')!;
    expect(cpu.hasAttribute('aria-disabled')).toBe(false);
    await act(async () => cpu.click());
    expect(room.addCpu).toHaveBeenCalledTimes(1);
    const johto = container.querySelectorAll('.draft-settings button').find((b) => b.textContent === 'Johto')!;
    expect(johto.getAttribute('aria-pressed')).toBe('false');
    await act(async () => johto.click());
    // Generationen sind eine Mehrfachauswahl: Johto kommt zu Kanto dazu
    expect(room.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ gens: [1, 2] }));
  });
});

// ---------------------------------------------------------------- Manager-Saison

describe('ManagerSeason', () => {
  beforeEach(() => {
    stubFetch();
  });

  it('Bankspieler antippen, dann einen Feldspieler: Tausch wird als eigene Aufstellung gesendet (nicht automatisch)', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const room = fakeRoom(snap(s, 'h'));
    const { container } = await render(app(h(ManagerSeason, { room, readOnly: false })));
    await settle();
    const lineup = s.manager!.lineups.h;
    const bench = container.querySelectorAll('.manager__lineup .draft-bench__slot');
    expect(bench).toHaveLength(engine.rosterOf(s.teams.find((t) => t.id === 'h')!).length - 11);
    expect(container.textContent).toContain('Spieltag 0 von 17 gespielt');
    expect(container.textContent).toContain('Spieltag 1 – die Paarungen');
    await act(async () => (bench[0] as MiniElement).click());
    const first = container.querySelector('.manager__lineup .pitch .slot') as MiniElement;
    await act(async () => first.click());
    expect(room.setLineup).toHaveBeenCalledTimes(1);
    const sent = (room.setLineup as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.auto).toBe(false);
    expect(sent.slots.slice(1)).toEqual(lineup.slots.slice(1));
    expect(lineup.slots).not.toContain(sent.slots[0]);
  });

  it('Ausfälle: Liste mit Team, Markierung im Kader und Hinweis auf Ersatz in der eigenen Elf', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const lineup = s.manager!.lineups.h;
    const hurt = lineup.slots[2];
    s = {
      ...s,
      manager: { ...s.manager!, lineups: { ...s.manager!.lineups, h: { ...lineup, auto: false } }, out: { [hurt]: { kind: 'injury', until: 2, since: 0 } } },
    };
    const room = fakeRoom(snap(s, 'h'));
    const { container } = await render(app(h(ManagerSeason, { room, readOnly: false })));
    await settle();
    const name = ALL.find((p) => p.id === hurt)!.de;
    expect(container.querySelector('.manager__out-list')!.textContent).toContain(name);
    expect(container.querySelector('.manager__out-list')!.textContent).toContain('verletzt bis Spieltag 2');
    expect(container.querySelector('.manager__lineup')!.textContent).toContain('beim Anpfiff springt der beste verfügbare Ersatz ein');
    expect(container.querySelectorAll('.manager__squad .manager__out')).toHaveLength(1);
  });
});

