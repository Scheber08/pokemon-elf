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
    fillCpu: vi.fn(() => true),
    setReady: vi.fn(() => true),
    kickoff: vi.fn(() => true),
    setGoal: vi.fn(() => true),
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

  it('Wartehinweis nennt die noch offenen Positionen der eigenen Elf', async () => {
    const { FORMATIONS } = await import('../src/config/formations');
    const s = autoPick(drafting());
    const { container } = await renderLive(fakeRoom(snap(s, 'h')));
    const me = s.teams.find((t) => t.id === 'h')!;
    const open = FORMATIONS[me.formation].slots.filter((_, j) => me.slots[j] == null);
    expect(open).toHaveLength(10);
    const hint = container.querySelector('.draft-live .hint')!.textContent!;
    expect(hint).toMatch(/Noch offen: .+\.$/);
    // Mehrfach vorkommende Positionen gruppiert
    const ivs = open.filter((d) => d.pos === 'IV').length;
    if (ivs > 1) expect(hint).toContain(`${ivs}× IV`);
  });

  it('Wunschliste: Taste W setzt das ausgewählte Pokémon drauf', async () => {
    const { DraftQueue } = await import('../src/components/DraftQueue');
    const st = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    const id = ALL.find((p) => p.gen === 1)!.id;
    const room = fakeRoom({ ...snap(st, 'h'), queue: [] });
    const qv = await render(app(h(DraftQueue, { room, selected: id })));
    await settle();
    // Leere Liste: kompakt, ohne den Absatz zum Auto-Pick (der steht kurz im Leertext)
    expect(qv.container.textContent).toContain('der Auto-Pick nimmt dann zuerst von hier');
    expect(qv.container.textContent).not.toContain('Läuft dein Timer ab');
    const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'w', ctrlKey: false, metaKey: false, altKey: false });
    await act(async () => void window.dispatchEvent(ev as unknown as Event));
    expect(room.setQueue).toHaveBeenCalledWith([id]);
  });

  it('Turnbar: die nächsten drei Picks in Snake-Reihenfolge', async () => {
    const { container } = await renderLive(fakeRoom(snap(drafting(), 'h')));
    // 2 Teams, Snake: Pick 1 Host (jetzt), dann Team 1, Team 1, Host
    expect(container.querySelector('.draft-turnbar__next')!.textContent).toBe('Danach: Team 1 → Team 1 → Du');
  });

  it('Turnbar: wer nicht dran ist, sieht, in wie vielen Picks er dran ist', async () => {
    // Pick 1 Host (jetzt) → Team 1 ist als Nächstes dran
    let r = await renderLive(fakeRoom(snap(drafting(), 't1')));
    expect(r.container.querySelector('.draft-turnbar__until')!.textContent).toBe(' · du bist als Nächstes dran');
    // Nach Pick 1: Team 1 hat Pick 2 und 3, der Host ist erst in 2 Picks wieder dran (Pick 4)
    const s = autoPick(drafting());
    r = await renderLive(fakeRoom(snap(s, 'h')));
    expect(r.container.querySelector('.draft-turnbar__until')!.textContent).toBe(' · du bist in 2 Picks dran');
    // Wer selbst dran ist, sieht keinen Hinweis
    r = await renderLive(fakeRoom(snap(s, 't1')));
    expect(r.container.querySelector('.draft-turnbar__until')).toBeNull();
  });

  it('Turnbar: höchstens verbleibende Draft-Dauer bei Pick-Uhr', async () => {
    // Ohne Pick-Uhr keine Angabe
    let r = await renderLive(fakeRoom(snap(drafting(), 'h')));
    expect(r.container.querySelector('.draft-turnbar__rest')).toBeNull();
    const s = engine.startDraft(lobby(2, { region: 0, maxTeams: 4, order: 'host', pickSeconds: 90 }), 'dev-h', 0, ALL);
    const total = s.teams.length * engine.rounds(s.settings);
    const humans = s.teams.filter((tm) => !tm.cpu).length;
    expect(humans).toBe(2);
    r = await renderLive(fakeRoom(snap(s, 'h')));
    // Nach dem aktuellen Pick noch total − 1 menschliche Picks à 90 s
    expect(r.container.querySelector('.draft-turnbar__rest')!.textContent).toBe(` · Draft-Ende spätestens in ~${Math.ceil(((total - 1) * 90) / 60)} Min.`);
  });

  it('Taste V holt einen Vorschlag (wie der Knopf)', async () => {
    const st = drafting();
    const { container } = await renderLive(fakeRoom(snap(st, 'h')));
    const choice = engine.autoPickChoice(st, 'h', ALL, SCALE, false);
    const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: 'v', ctrlKey: false, metaKey: false, altKey: false });
    await act(async () => void window.dispatchEvent(ev as unknown as Event));
    expect(container.querySelector('.draft-live .hint strong')!.textContent).toBe(ALL.find((p) => p.id === choice.pokemonId)!.de);
    expect(container.querySelector('.draft-pooltools button')!.getAttribute('aria-keyshortcuts')).toBe('V');
  });

  it('Wunschliste im Raster: „★ Wunsch n“ auf den Karten', async () => {
    const { DraftLive } = await import('../src/components/DraftLive');
    const st = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    const [a, b] = ALL.filter((p) => p.gen === 1).slice(0, 2).map((p) => p.id);
    const { container } = await render(app(h(DraftLive, { room: fakeRoom({ ...snap(st, 'h'), queue: [b, a] }) })));
    await settle();
    const notes = container.querySelectorAll('.pcard__note').map((n) => n.textContent);
    expect(notes).toContain('★ Wunsch 1');
    expect(notes).toContain('★ Wunsch 2');
  });

  it('„Beste zuerst“: Karten zeigen den bestpassenden freien Platz mit Fit', async () => {
    const { DraftLive } = await import('../src/components/DraftLive');
    const st = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    const { container } = await render(app(h(DraftLive, { room: fakeRoom({ ...snap(st, 'h'), queue: [] }) })));
    await settle();
    expect(container.querySelectorAll('.pcard__note')).toHaveLength(0);
    const box = container
      .querySelectorAll('label')
      .find((l) => l.textContent?.includes('Beste für mein Team zuerst'))!
      .querySelector('input') as MiniElement;
    await act(async () => {
      (box as unknown as { checked: boolean }).checked = true;
      box.click();
    });
    await settle();
    const notes = container.querySelectorAll('.pcard__note').map((n) => n.textContent!);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/^[A-ZÄÖÜ]{2,3} \d+$/);
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

  it('Host-Hinweis: Pool-Größe und Picks, Draft-Dauer mit Bankrunden (Manager)', async () => {
    const st = lobby(2, { region: 1, format: 'manager', pickSeconds: 60 });
    const picks = engine.rounds(st.settings) * st.teams.length;
    expect(engine.rounds(st.settings)).toBeGreaterThan(11);
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(st, 'h')) })));
    await settle();
    const pool = engine.poolOf(st.settings, ALL).length;
    expect(container.textContent).toContain(`Pool: ${pool} Pokémon für ${picks} Picks.`);
  });

  it('Host mischt die Draft-Reihenfolge (nur bei Reihenfolge wie in der Liste)', async () => {
    const st = lobby(2, { order: 'host' });
    const room = fakeRoom(snap(st, 'h'));
    const { container } = await render(app(h(DraftLobby, { room })));
    await settle();
    const btn = container.querySelectorAll('button').find((b) => b.textContent === '🎲 Reihenfolge mischen') as MiniElement;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    await act(async () => btn.click());
    rnd.mockRestore();
    expect(room.setOrder).toHaveBeenCalledWith([...st.teams.map((t) => t.id)].reverse());
    // Mitspieler und ausgeloste Reihenfolge: kein Knopf
    const other = await render(app(h(DraftLobby, { room: fakeRoom(snap(st, 't1')) })));
    await settle();
    expect(other.container.textContent).not.toContain('Reihenfolge mischen');
    const random = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2, { order: 'random' }), 'h')) })));
    await settle();
    expect(random.container.textContent).not.toContain('Reihenfolge mischen');
  });

  // CLIENT-7 / SEASON-3
  it('Nur-Ansicht: kein Beitreten-Formular, Hinweis statt dessen', async () => {
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2), null), { live: false }), readOnly: true })));
    await settle();
    expect(container.textContent).toContain('Nur Ansicht');
    expect(container.querySelector('form')).toBeNull();
  });

  // CLIENT-5
  it('Lobby: vom Host zurückgesetztes „bereit“ meldet sich als Hinweis', async () => {
    const ready = engine.setTeamReady(lobby(2), 'dev-1', true);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as unknown as Element);
    await act(async () => root.render(app(h(DraftLobby, { room: fakeRoom(snap(ready, 't1')) }))));
    await settle();
    const reset = engine.updateSettings(ready, 'dev-h', { pickSeconds: 30 }, ALL);
    await act(async () => root.render(app(h(DraftLobby, { room: fakeRoom(snap(reset, 't1')) }))));
    await settle();
    expect(container.querySelector('.toasts')!.textContent).toContain('melde dich bitte erneut bereit');
    await act(async () => root.unmount());
  });

  it('Lobby: Host sieht, wie viele Mitspieler bereit sind', async () => {
    const st = engine.setTeamGoal(engine.setTeamReady(lobby(3), 'dev-1', true), 'dev-2', 'title');
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(st, 'h')) })));
    await settle();
    expect(container.querySelector('.draft-start')!.textContent).toContain('1/2 Mitspieler bereit');
    expect(container.textContent).toContain('✓ bereit');
    expect(container.querySelector('.draft-lobby__goal select')).toBeTruthy();
    expect(container.textContent).toContain('🎯 Meister werden');
    expect(container.querySelectorAll('.draft-start--go')).toHaveLength(0);
    const all = engine.setTeamReady(st, 'dev-2', true);
    const r2 = await render(app(h(DraftLobby, { room: fakeRoom(snap(all, 'h')) })));
    await settle();
    expect(r2.container.querySelector('.draft-start')!.textContent).toContain('Alle Mitspieler bereit (2)');
    expect(r2.container.querySelectorAll('.draft-start--go')).toHaveLength(1);
  });

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

  it('Karriere-Lobby: Saison, Liga-Stufe, Aufstieg und „Saison starten“', async () => {
    const state = { ...lobby(2), career: { season: 3, tier: 1 as const, move: 'up' as const } };
    const room = fakeRoom(snap(state, 'h'));
    const { container } = await render(app(h(DraftLobby, { room })));
    await settle();
    const card = container.querySelector('.draft-career')!;
    expect(card.textContent).toContain('Saison 3 · 1. Pokémon-Liga');
    expect(card.textContent).toContain('Aufgestiegen!');
    expect(container.querySelector('.draft-start button')!.textContent).toBe('Saison starten');
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

  it('Kapitän: Hinweis, wenn er auf der Bank sitzt oder ausfällt', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.find((t) => t.id === 'h')!;
    const lineup = s.manager!.lineups.h;
    const benchId = engine.rosterOf(me).find((id) => !lineup.slots.includes(id) && id !== lineup.ss)!;
    const withCaptain = (captain: number, out = {}) => ({
      ...s,
      teams: s.teams.map((t) => (t.id === 'h' ? { ...t, captain } : t)),
      manager: { ...s.manager!, out },
    });
    const text = async (st: typeof s) => {
      const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(st, 'h')), readOnly: false })));
      await settle();
      return container.querySelector('.manager__lineup')!.textContent;
    };
    expect(await text(withCaptain(lineup.slots[0]))).not.toContain('Dein Kapitän');
    expect(await text(withCaptain(benchId))).toContain('steht nicht in der Startelf');
    {
      const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(withCaptain(benchId), 'h')), readOnly: false })));
      await settle();
      // Kapitän auf der Bank: in der Auswahl als Bank-Spieler, in der Kader-Tabelle markiert
      const opts = container.querySelectorAll('.captain-picker option') as unknown as { selected?: boolean; textContent: string; getAttribute(n: string): string | null }[];
      const chosen = opts.find((o) => o.selected);
      expect(chosen?.getAttribute('value')).toBe(String(benchId));
      expect(chosen?.textContent).toMatch(/^BK · /);
      expect(container.querySelectorAll('.manager__squad .manager__captain')).toHaveLength(1);
    }
    expect(await text(withCaptain(lineup.slots[0], { [lineup.slots[0]]: { kind: 'red', until: 2, since: 0 } }))).toContain('keinen Kapitänsbonus');
  });

  it('Karriere: frühere Saisons des eigenen Teams im Status', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const st = { ...s, career: { season: 3, tier: 1 as const, history: [{ season: 1, tier: 2 as const, places: { h: 2 } as Record<string, number> }, { season: 2, tier: 1 as const, places: { h: 7, x: 1 } as Record<string, number> }] } };
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(st, 'h')), readOnly: false })));
    await settle();
    expect(container.querySelector('.manager__career')!.textContent).toBe('Bisher: S1 Liga 2: Platz 2 · S2 Liga 1: Platz 7');
  });

  it('Transfermarkt: Hinweis, wenn der Kapitän abgegeben werden soll', async () => {
    const { TransferMarket } = await import('../src/components/ManagerMarket');
    const { startManagerSeason, freeAgents } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.find((t) => t.id === 'h')!;
    const out = engine.rosterOf(me)[0];
    const claim = { in: freeAgents(s, ALL)[0].id, out };
    const view = async (captain: number) => {
      const { container } = await render(
        app(h(TransferMarket, { state: s, team: { ...me, captain }, claim, matchday: 1, onTransfer: () => {} })),
      );
      await settle();
      return container.textContent;
    };
    expect(await view(out)).toContain('übernimmt der Neuzugang die Binde');
    expect(await view(engine.rosterOf(me)[1])).not.toContain('übernimmt der Neuzugang die Binde');
    // Saisontore stehen in der Auswahl „Abgeben“
    const { container } = await render(
      app(h(TransferMarket, { state: s, team: me, claim, matchday: 1, onTransfer: () => {}, goals: new Map([[out, 3]]) })),
    );
    await settle();
    expect(container.querySelector('.manager__market select')!.textContent).toContain('3 Tore');
  });

  it('Wunschliste: Vergebene markiert und mit einem Klick entfernt', async () => {
    const { DraftQueue } = await import('../src/components/DraftQueue');
    let st = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    st = autoPick(st);
    const taken = st.picks[0].pokemonId;
    const free = ALL.find((p) => p.gen === 1 && p.id !== taken && !st.picks.some((x) => x.pokemonId === p.id))!.id;
    const snapshot = { ...snap(st, 'h'), queue: [taken, free] };
    const room = fakeRoom(snapshot);
    const picked: number[] = [];
    const { container } = await render(app(h(DraftQueue, { room, selected: null, onSelect: (id: number) => picked.push(id) })));
    await settle();
    expect(container.querySelectorAll('.draft-queue__list li.is-taken')).toHaveLength(1);
    // Freien Eintrag antippen wählt ihn aus (vergebene sind keine Buttons)
    const picks = container.querySelectorAll('.draft-queue__pick');
    expect(picks).toHaveLength(1);
    await act(async () => (picks[0] as MiniElement).click());
    expect(picked).toEqual([free]);
    const clear = container.querySelectorAll('button').find((b) => b.textContent === 'Vergebenes entfernen') as MiniElement;
    await act(async () => clear.click());
    expect(room.setQueue).toHaveBeenCalledWith([free]);
    // Nach unten schieben: erster Eintrag tauscht mit dem zweiten
    const down = container.querySelectorAll('.draft-queue__btn').find((b) => b.textContent === '↓') as MiniElement;
    await act(async () => down.click());
    expect(room.setQueue).toHaveBeenLastCalledWith([free, taken]);
  });

  it('Shiny-Neuzugang: Hinweis im Status nur fürs eigene Team', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = playMatchday(startManagerSeason(s, ALL, SCALE), ALL, SCALE);
    const me = s.teams.find((t) => t.id === 'h')!;
    const inn = engine.rosterOf(me)[0];
    const st = {
      ...s,
      teams: s.teams.map((t) => (t.id === 'h' ? { ...t, goal: 'stay' as const } : t)),
      manager: { ...s.manager!, transfers: [{ matchday: 1, teamId: 'h', in: inn, out: 9999, shiny: true }] },
    };
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(st, 'h')), readOnly: false })));
    await settle();
    expect(container.querySelector('.manager__shiny')!.textContent).toContain(ALL.find((p) => p.id === inn)!.de);
    expect(container.querySelector('.manager__place')!.textContent).toMatch(/^Dein Team: Platz \d+ · \d+ Pkt.* · (\d+ Pkt (Vorsprung|hinter Platz 1)|punktgleich)/);
    expect(container.querySelector('.manager__goal')!.textContent).toContain('🎯 Nicht auf den letzten 3 Plätzen');
    // Kader-Tabelle: Tore dieser Saison je Pokémon (Summe = eigene Tore am 1. Spieltag)
    const idx = st.teams.findIndex((t) => t.id === 'h');
    const m1 = st.league!.matches.find((m) => m.round === 1 && (m.home === idx || m.away === idx))!;
    const own = m1.home === idx ? m1.hg : m1.ag;
    const cells = container.querySelectorAll('.manager__squad tbody tr').map((tr) => Number(tr.querySelectorAll('td')[4].textContent) || 0);
    expect(cells.reduce((a, b) => a + b, 0)).toBe(own);
    const ownScorers = m1.home === idx ? m1.homeScorers : m1.awayScorers;
    const assistCells = container.querySelectorAll('.manager__squad tbody tr').map((tr) => Number(tr.querySelectorAll('td')[5].textContent) || 0);
    expect(assistCells.reduce((a, b) => a + b, 0)).toBe(ownScorers.filter((g) => g.assist != null && engine.rosterOf(me).includes(g.assist)).length);
    // Sortieren nach Toren: absteigend
    const goalsBtn = container.querySelectorAll('.manager__squad .manager__sort').find((b) => b.textContent === 'Tore') as MiniElement;
    await act(async () => goalsBtn.click());
    const sortedGoals = container.querySelectorAll('.manager__squad tbody tr').map((tr) => Number(tr.querySelectorAll('td')[4].textContent) || 0);
    expect(sortedGoals).toEqual([...sortedGoals].sort((a, b) => b - a));
  });

  it('Pokal: Auslosung vor der ersten Runde, nach dem Finale der Sieger', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const first = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    const cup = first.container.querySelector('.manager__cup')!;
    expect(cup.textContent).toContain('Auslosung (Achtelfinale)');
    expect(cup.querySelectorAll('.manager__cup-ties li')).toHaveLength(8);
    expect(cup.textContent).toContain('Nächste Runde: Achtelfinale nach Spieltag 4');
    for (let k = 0; k < 16; k++) s = playMatchday(s, ALL, SCALE);
    const later = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(later.container.querySelector('.manager__cup')!.textContent).toMatch(/Pokalsieger|holt den Pokal/);
    expect(later.container.querySelectorAll('.manager__cup-round')).toHaveLength(4);
  });

  it('Live: kurz nach dem Anpfiff läuft der Spieltag mit Minute, ohne Spieler des Spieltags; danach normal', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    s = playMatchday(s, ALL, SCALE);
    const step = 12 * 3_600_000;
    const liveState = { ...s, season: { ...s.season!, startsAt: Date.now() - 60_000, stepMs: step } };
    const live = await render(app(h(ManagerSeason, { room: fakeRoom(snap(liveState, 'h')), readOnly: false })));
    await settle();
    const head = live.container.querySelector('h2[id="manager-last"]')!.textContent!;
    expect(head).toContain('LIVE');
    expect(head).toMatch(/Spieltag 1 · \d+\. Minute/);
    expect(live.container.querySelector('.manager__star')).toBeNull();
    const doneState = { ...s, season: { ...s.season!, startsAt: Date.now() - 10 * 60_000, stepMs: step } };
    const after = await render(app(h(ManagerSeason, { room: fakeRoom(snap(doneState, 'h')), readOnly: false })));
    await settle();
    expect(after.container.querySelector('h2[id="manager-last"]')!.textContent).not.toContain('LIVE');
  });

  it('Saisonende: Vorschau der nächsten Karriere-Saison neben dem Knopf', async () => {
    const { DraftSeasonStage } = await import('../src/components/DraftSeasonStage');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    while (s.phase === 'season') s = playMatchday(s, ALL, SCALE);
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(snap(s, 'h')) })));
    await settle();
    expect(container.querySelector('.draft-career__preview')!.textContent).toMatch(/Nächste Saison: \d\. Pokémon-Liga/);
    // Manager-Saison (Karriere-Start in Liga 2): Abschlusstabelle mit drei Aufstiegsplätzen
    const rows = container.querySelectorAll('.draft-results__table tbody tr');
    expect(rows.slice(0, 3).every((r) => r.className.includes('is-zone-top'))).toBe(true);
    expect(rows[3].className).not.toContain('is-zone-top');
    expect(container.querySelector('.table-legend')!.textContent).toContain('Aufstieg');
  });

  it('Nächster Gegner: seine Ausfälle stehen dabei', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, managerSchedule } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.findIndex((t) => t.id === 'h');
    const other = s.teams.findIndex((t) => t.id !== 'h');
    // Spieltag, an dem die beiden gedrafteten Teams aufeinandertreffen
    const k = managerSchedule(18).findIndex((round) => round.some(([a, b]) => (a === me && b === other) || (a === other && b === me)));
    expect(k).toBeGreaterThanOrEqual(0);
    const hurt = s.teams[other].slots[0]!;
    s = { ...s, manager: { ...s.manager!, played: k, out: { [hurt]: { kind: 'red', until: k + 1, since: k } } } };
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(container.querySelector('.manager__rival-out')!.textContent).toContain(ALL.find((p) => p.id === hurt)!.de);
  });

  it('Nächster Gegner: sein bester Torschütze steht dabei (gedraftete Gegner)', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday, managerSchedule } = await import('../src/lib/manager');
    const { storedLeague } = await import('../src/lib/leagueTimeline');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.findIndex((t) => t.id === 'h');
    const rival = s.teams.findIndex((t) => t.id !== 'h');
    // Spieltag des Duells der beiden gedrafteten Teams – bis dahin spielen (mindestens ein paar Spieltage)
    const k = managerSchedule(18).findIndex((round) => round.some(([a, b]) => (a === me && b === rival) || (a === rival && b === me)));
    while (s.manager!.played < k) s = playMatchday(s, ALL, SCALE);
    const goals = new Map<number, number>();
    for (const m of storedLeague(s.league, s.teams.length)!.matches)
      for (const g of m.home === rival ? m.homeScorers : m.away === rival ? m.awayScorers : []) goals.set(g.pokemonId, (goals.get(g.pokemonId) ?? 0) + 1);
    const best = Math.max(0, ...goals.values());
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    const el = container.querySelector('.manager__rival-scorer');
    expect(best).toBeGreaterThanOrEqual(2);
    expect(el!.textContent).toContain(`(${best} Tore)`);
    // Gedrafteter Gegner: seine aktuelle Formation steht neben dem Namen
    expect(container.querySelector('.manager__rival-formation')!.textContent).toBe(` · spielt ${s.manager!.lineups[s.teams[rival].id].formation}`);
  });

  it('Manager: aktuelle Serie des eigenen Teams (ungeschlagen/sieglos ab 3 Spielen)', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    const { storedLeague } = await import('../src/lib/leagueTimeline');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.findIndex((t) => t.id === 'h');
    const seriesOf = () => {
      const res = storedLeague(s.league, s.teams.length)!
        .matches.filter((m) => m.home === me || m.away === me)
        .sort((a, b) => b.round - a.round)
        .map((m) => Math.sign(m.home === me ? m.hg - m.ag : m.ag - m.hg));
      const run = (ok: (r: number) => boolean) => res.findIndex((r) => !ok(r)) < 0 ? res.length : res.findIndex((r) => !ok(r));
      const up = run((r) => r >= 0);
      const down = run((r) => r <= 0);
      return up >= 3 ? `Seit ${up} Spielen ungeschlagen` : down >= 3 ? `Seit ${down} Spielen sieglos` : null;
    };
    // Bis zum ersten Spieltag mit einer Serie spielen (der positive Fall muss vorkommen)
    let expected: string | null = null;
    while (s.manager!.played < s.manager!.total) {
      s = playMatchday(s, ALL, SCALE);
      if (s.manager!.played >= 3 && (expected = seriesOf())) break;
    }
    expect(expected).not.toBeNull();
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(container.querySelector('.manager__series')!.textContent).toContain(expected!);
    // Auch der nächste Gegner zeigt seine Serie (gleiche Hilfsfunktion) – Gegner über den Spielplan
    const { currentRun } = await import('../src/lib/leagueTimeline');
    const { scheduleOf } = await import('../src/lib/manager');
    const league = storedLeague(s.league, s.teams.length)!;
    const [a, b] = scheduleOf(s.manager, league.teams.length)[s.manager!.played].find(([x, y]) => x === me || y === me)!;
    const run = currentRun(league.matches, a === me ? b : a);
    const line = container.querySelectorAll('.manager__rival .manager__series')[0];
    if (run) expect(line!.textContent).toContain(run.kind === 'unbeaten' ? `Seit ${run.length} Spielen ungeschlagen` : `Seit ${run.length} Spielen sieglos`);
    else expect(line).toBeUndefined();
  });

  it('Manager: nächster Gegner zeigt seine Bilanz am Spielort', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday, scheduleOf } = await import('../src/lib/manager');
    const { storedLeague } = await import('../src/lib/leagueTimeline');
    const { sideTable, formatRecord } = await import('../src/lib/season');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    // Vor dem ersten Spieltag gibt es noch keine Bilanz
    const { container: before } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(before.querySelector('.manager__rival-venue')).toBeNull();
    for (let i = 0; i < 4; i++) s = playMatchday(s, ALL, SCALE);
    const me = s.teams.findIndex((t) => t.id === 'h');
    const league = storedLeague(s.league, s.teams.length)!;
    const [home, away] = scheduleOf(s.manager, league.teams.length)[s.manager!.played].find(([a, b]) => a === me || b === me)!;
    const rival = home === me ? away : home;
    const side = home === me ? 'away' : 'home';
    const row = sideTable(league.teams, league.matches, side).find((r) => r.team === rival)!;
    const { container } = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    const el = container.querySelector('.manager__rival-venue');
    expect(row.played).toBeGreaterThan(0);
    expect(el!.textContent).toBe(`${side === 'home' ? 'Zu Hause' : 'Auswärts'}: ${formatRecord(row)} (S–U–N, ${row.played === 1 ? '1 Spiel' : `${row.played} Spiele`})`);
    // Formation des Gegners (nur gedraftete Teams haben eine Aufstellung)
    const lineup = s.teams[rival] ? s.manager!.lineups[s.teams[rival].id] : undefined;
    const f = container.querySelector('.manager__rival-formation');
    if (lineup) expect(f!.textContent).toBe(` · spielt ${lineup.formation}`);
    else expect(f).toBeNull();
  });

  it('Aufstellung: Tipp für eine stärkere Formation, Knopf übernimmt sie', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, bestLineup, lineupScore } = await import('../src/lib/manager');
    const { FORMATIONS, FORMATION_IDS } = await import('../src/config/formations');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = startManagerSeason(s, ALL, SCALE);
    const me = s.teams.find((t) => t.id === 'h')!;
    const form = s.manager!.form;
    const byIdAll = new Map(ALL.map((p) => [p.id, p]));
    const scoreOf = (f: (typeof FORMATION_IDS)[number]) => {
      const l = bestLineup(me, f, byIdAll, SCALE, form, s.settings.setPiece, new Set(), undefined, me.captain);
      const squad = l.slots.flatMap((id, i) => [{ p: byIdAll.get(id)!, pos: FORMATIONS[f].slots[i].pos }]);
      return { l, n: lineupScore(squad, SCALE, (id) => form[id] ?? 0, me.captain) };
    };
    const ranked = [...FORMATION_IDS].map((f) => ({ f, ...scoreOf(f) })).sort((a, b) => a.n - b.n);
    const worst = ranked[0];
    const top = ranked.at(-1)!;
    expect(top.n).toBeGreaterThanOrEqual(worst.n + 5);
    const st = { ...s, manager: { ...s.manager!, lineups: { ...s.manager!.lineups, h: { ...worst.l, auto: false } } } };
    const room = fakeRoom(snap(st, 'h'));
    const { container } = await render(app(h(ManagerSeason, { room, readOnly: false })));
    await settle();
    const tip = container.querySelector('.manager__formation-tip')!;
    expect(tip.textContent).toContain(`Tipp: Mit ${top.f} wäre Stärke ${top.n} möglich.`);
    await act(async () => (tip.querySelector('button') as MiniElement).click());
    expect((room.setLineup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].formation).toBe(top.f);
    // Bank-Karten: bestpassende Position mit Fit
    const benchBest = container.querySelectorAll('.manager__bench-best');
    expect(benchBest.length).toBe(engine.rosterOf(me).length - 11);
    expect(benchBest[0].textContent).toMatch(/^[A-ZÄÖÜ]{2,3} \d+$/);
    // In der stärksten Formation: kein Tipp
    const best = { ...s, manager: { ...s.manager!, lineups: { ...s.manager!.lineups, h: { ...top.l, auto: false } } } };
    const r2 = await render(app(h(ManagerSeason, { room: fakeRoom(snap(best, 'h')), readOnly: false })));
    await settle();
    expect(r2.container.querySelector('.manager__formation-tip')).toBeNull();
  });

  it('Eigener Platz: Hochrechnung der Punkte aufs Saisonende ab dem 3. Spieltag', async () => {
    const { ManagerSeason } = await import('../src/components/ManagerSeason');
    const { startManagerSeason, playMatchday } = await import('../src/lib/manager');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0, format: 'manager' }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = playMatchday(playMatchday(startManagerSeason(s, ALL, SCALE), ALL, SCALE), ALL, SCALE);
    let r = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(r.container.querySelector('.manager__projection')).toBeNull();
    expect(r.container.querySelector('.manager__rest')).toBeNull();
    for (let k = 0; k < 2; k++) s = playMatchday(s, ALL, SCALE);
    r = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    const idx = s.teams.findIndex((t) => t.id === 'h');
    const row = s.league!.table.find((x) => x.team === idx)!;
    expect(row.played).toBe(4);
    expect(r.container.querySelector('.manager__projection')!.textContent).toContain(`Hochrechnung: ${Math.round((row.pts / 4) * s.manager!.total)} Pkt`);
    // Restprogramm: Ø Platz der restlichen Gegner
    {
      const { scheduleOf } = await import('../src/lib/manager');
      const table = s.league!.table;
      const placeOf = (i: number) => table.findIndex((x) => x.team === i) + 1;
      const opps = scheduleOf(s.manager, table.length)
        .slice(s.manager!.played)
        .flatMap((round) => round.flatMap(([a, b]) => (a === idx ? [b] : b === idx ? [a] : [])));
      expect(opps).toHaveLength(s.manager!.total - s.manager!.played);
      const avg = opps.reduce((sum, o) => sum + placeOf(o), 0) / opps.length;
      expect(r.container.querySelector('.manager__rest')!.textContent).toContain(
        `Restprogramm: Ø Platz ${avg.toFixed(1).replace('.', ',')} der ${opps.length} Gegner`,
      );
      // Die nächsten drei Gegner mit Platz
      const up = r.container.querySelector('.manager__upnext')!.textContent!;
      expect(up.startsWith('Die nächsten Gegner: ')).toBe(true);
      expect(up.split(' → ')).toHaveLength(3);
      expect(up.match(/\((\d+)\.\)/g)!.map((x) => Number(x.slice(1, -2)))).toEqual(opps.slice(0, 3).map(placeOf));
    }
    // Topspiel des nächsten Spieltags: beste Platzsumme
    {
      const { scheduleOf } = await import('../src/lib/manager');
      const table = s.league!.table;
      const placeOf = (i: number) => table.findIndex((x) => x.team === i) + 1;
      const next = scheduleOf(s.manager, table.length)[s.manager!.played];
      const top = [...next].sort((a, b) => placeOf(a[0]) + placeOf(a[1]) - (placeOf(b[0]) + placeOf(b[1])))[0];
      expect(r.container.querySelector('.manager__topgame')!.textContent).toContain(`Topspiel: ${placeOf(top[0])}. `);
      expect(r.container.querySelector('.manager__topgame')!.textContent).toContain(` – ${placeOf(top[1])}. `);
    }
    // Zone des eigenen Platzes (Karriere-Start in Liga 2: Plätze 1–3 sind Aufstiegsplätze)
    const place = s.league!.table.findIndex((x) => x.team === idx) + 1;
    const zone = r.container.querySelector('.manager__zone');
    if (place <= 3) expect(zone!.textContent).toContain('Aufstiegsplatz');
    else if (place > s.league!.table.length - 3) expect(zone!.textContent).toContain('Abstiegsplatz');
    else expect(zone).toBeNull();
    // Führungsserie: ab 3 Spieltagen in Folge an der Spitze
    const tl = await import('../src/lib/leagueTimeline');
    const days = tl.leagueTimeline(tl.storedLeague(s.league, s.teams.length)!);
    const n = tl.leaderSince(days, days.at(-1)!.round);
    const lead = r.container.querySelector('.manager__leader');
    if (n >= 3) expect(lead!.textContent).toContain(`führt seit ${n} Spieltagen die Tabelle an`);
    else expect(lead).toBeNull();
    // Weiterspielen, bis jemand 3 Spieltage in Folge vorn steht
    let k = n;
    while (k < 3 && s.manager!.played < s.manager!.total - 1) {
      s = playMatchday(s, ALL, SCALE);
      const d = tl.leagueTimeline(tl.storedLeague(s.league, s.teams.length)!);
      k = tl.leaderSince(d, d.at(-1)!.round);
    }
    expect(k).toBeGreaterThanOrEqual(3);
    const r3 = await render(app(h(ManagerSeason, { room: fakeRoom(snap(s, 'h')), readOnly: false })));
    await settle();
    expect(r3.container.querySelector('.manager__leader')!.textContent).toContain(`führt seit ${k} Spieltagen die Tabelle an`);
    // Kader-Tabelle: ⭐ für „Spieler des Spieltags“ je eigenem Pokémon
    const lg = tl.storedLeague(s.league, s.teams.length)!;
    const starCount = new Map<number, number>();
    for (let rd = 1; rd <= s.manager!.played; rd++) {
      const st = tl.playerOfRound(lg.matches.filter((m) => m.round === rd));
      if (st && st.teamIndex === idx) starCount.set(st.pokemonId, (starCount.get(st.pokemonId) ?? 0) + 1);
    }
    const marks = r3.container.querySelectorAll('.manager__squad .manager__stars');
    expect(marks).toHaveLength(starCount.size);
    for (const el of marks) expect(el.textContent).toMatch(/Spieler des Spieltags/);
    // Letzter Spieltag: Last-Minute-Sieg, falls es einen gab
    const late = tl.lateWinner(lg.matches.filter((m) => m.round === s.manager!.played));
    const lateEl = r3.container.querySelector('.manager__late');
    if (late) expect(lateEl!.textContent).toMatch(/Last-Minute-Sieg: .+ – Siegtor in der \d/);
    else expect(lateEl).toBeNull();
    // Manager-Tabelle: Umschalter auf „Auswärts“ zeigt die Auswärtstabelle (ohne Zonen)
    {
      const { sideTable } = await import('../src/lib/season');
      const awayBtn = r3.container.querySelectorAll('[role="radio"]').find((b) => b.textContent === 'Auswärts') as MiniElement;
      await act(async () => awayBtn.click());
      const away = sideTable(lg.teams, lg.matches, 'away');
      const tableEl = r3.container.querySelectorAll('table.league-table').find((tb) => !tb.className.includes('manager__squad'))!;
      const first = tableEl.querySelectorAll('tbody tr')[0];
      expect(first.querySelector('strong')!.textContent).toBe(String(away[0].pts));
      expect(first.className).not.toContain('is-zone');
    }
    // Überraschung des letzten Spieltags (Außenseiter-Sieg mit ≥ 100 Rückstand), falls es eine gab
    {
      const up = tl.biggestUpset(lg.matches.filter((m) => m.round === s.manager!.played), lg.teams.map((x) => x.rating));
      const el = r3.container.querySelector('.manager__upset');
      if (up) expect(el!.textContent).toMatch(/Überraschung: .+ schlägt .+ \d+:\d+/);
      else expect(el).toBeNull();
    }
    // Gezielt: ein Spiel des letzten Spieltags als 2:1 mit Siegtor in der 89. Minute → Zeile erscheint
    const md = s.manager!.played;
    const raw = s.league!;
    const at = raw.matches.findIndex((x) => x.round === md && x.home === idx);
    const pick = raw.matches.findIndex((x) => x.round === md);
    const k2 = at >= 0 ? at : pick;
    const ids = s.teams[idx].slots.filter((x): x is number => x != null);
    const goal = (id: number, minute: number) => ({ pokemonId: id, pos: 'ST' as const, minute });
    const patched = {
      ...s,
      league: {
        ...raw,
        matches: raw.matches.map((x, i) =>
          i === k2 ? { ...x, hg: 2, ag: 1, homeScorers: [goal(ids[0], 10), goal(ids[1], 89)], awayScorers: [goal(ids[2], 40)] } : x,
        ),
      },
    };
    const r4 = await render(app(h(ManagerSeason, { room: fakeRoom(snap(patched, 'h')), readOnly: false })));
    await settle();
    expect(r4.container.querySelector('.manager__late')!.textContent).toContain("Siegtor in der 89'");
  });

  it('Saisonende: Saisonrekorde mit Angriff, Abwehr und ggf. Remis-König', async () => {
    const { DraftSeasonStage } = await import('../src/components/DraftSeasonStage');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = engine.withLeague(s, ALL, SCALE);
    const done = { ...s, season: { ...s.season!, startsAt: Date.now() - 30 * 86_400_000 } };
    const { container } = await render(app(h(DraftSeasonStage, { room: fakeRoom(snap(done, 'h')) })));
    await settle();
    const rec = container.querySelector('.draft-records')!;
    expect(rec.textContent).toMatch(/Bester Angriff.+ – \d+ Tore/);
    const most = Math.max(...s.league!.table.map((r) => r.d));
    expect(most).toBeGreaterThanOrEqual(4);
    expect(rec.textContent).toContain(`Remis-König`);
    expect(rec.textContent).toContain(`${most} Unentschieden`);
    // Herbstmeister: Führender nach der Hälfte der Spieltage
    const { leagueTimeline } = await import('../src/lib/leagueTimeline');
    const days = leagueTimeline(s.league!);
    const half = days[days.length / 2 - 1];
    expect(rec.textContent).toContain(`Herbstmeister`);
    expect(rec.textContent).toContain(`${half.leader.pts} Pkt nach der Hinrunde (${days.length / 2}. Spieltag)`);
    const { buildTable } = await import('../src/lib/season');
    const second = buildTable(s.league!.teams, s.league!.matches.filter((m) => m.round > days.length / 2))[0];
    expect(rec.textContent).toContain(`${second.pts} Pkt in der Rückrunde`);
    // Tabellen-Zonen in der Abschlusstabelle: Meister oben, die letzten drei unten
    const rows = container.querySelectorAll('.draft-results__table tbody tr');
    expect(rows[0].className).toContain('is-zone-top');
    expect(rows.slice(-3).every((r) => r.className.includes('is-zone-bottom'))).toBe(true);
    expect(rows[3].className).not.toContain('is-zone');
    expect(container.querySelector('.draft-results__table')!.closest('section')!.querySelector('.table-legend')!.textContent).toBe('Meisterletzte 3 Plätze');
    // Heimtabelle: Umschalter wechselt die Zeilen (Punkte nur aus Heimspielen), ohne Zonen
    const { sideTable } = await import('../src/lib/season');
    const homeBtn = container.querySelectorAll('button').find((b) => b.textContent === 'Heim') as MiniElement;
    await act(async () => homeBtn.click());
    const home = sideTable(s.league!.teams, s.league!.matches, 'home');
    const homeRows = container.querySelectorAll('.draft-results__table tbody tr');
    expect(homeRows[0].querySelector('strong')!.textContent).toBe(String(home[0].pts));
    expect(homeRows[0].className).not.toContain('is-zone');
    // Elf der Saison: Feld und 11 Namen
    expect(container.querySelector('.draft-results__eleven h2')!.textContent).toBe('Elf der Saison');
    expect(container.querySelector('.draft-results__eleven button')!.getAttribute('aria-label')).toBe('Elf der Saison als Bild speichern');
    expect(container.querySelectorAll('.draft-results__eleven-list li')).toHaveLength(11);
    // Eigener bester / schwächster Pick nach Positions-Fit
    {
      const { FORMATIONS } = await import('../src/config/formations');
      const { positionFit } = await import('../src/lib/fit');
      const mine = s.teams.find((t) => t.id === 'h')!;
      const fits = FORMATIONS[mine.formation].slots.map((d, j) => Math.round(positionFit(ALL.find((p) => p.id === mine.slots[j])!, d.pos, SCALE)));
      const picksLine = container.querySelector('.draft-results__ownpicks')!.textContent!;
      expect(picksLine).toMatch(new RegExp(`^Dein bester Pick: .+ \\(\\S+, Fit ${Math.max(...fits)}, Pick \\d+\\) · dein schwächster: .+ \\(\\S+, Fit ${Math.min(...fits)}, Pick \\d+\\)$`));
    }
    // Eigene Extreme: höchster Sieg / höchste Niederlage aus eigener Sicht
    const me = s.teams.findIndex((t) => t.id === 'h');
    const own = s.league!.matches.filter((m) => m.home === me || m.away === me).map((m) => (m.home === me ? [m.hg, m.ag] : [m.ag, m.hg]));
    const ext = container.querySelector('.draft-results__extremes')!.textContent!;
    const wins = own.filter(([a, b]) => a > b);
    if (wins.length) {
      const top = Math.max(...wins.map(([a, b]) => a - b));
      expect(ext).toMatch(/Dein höchster Sieg: (\d+):(\d+) gegen/);
      const [, a, b] = ext.match(/Dein höchster Sieg: (\d+):(\d+)/)!;
      expect(Number(a) - Number(b)).toBe(top);
    }
    if (own.some(([a, b]) => a < b)) expect(ext).toMatch(/Deine höchste Niederlage: (\d+):(\d+) gegen/);
  });

  it('Nach dem letzten Pick: Kapitän bis zum Anpfiff wählbar (mit Countdown), danach nicht mehr', async () => {
    const { DraftSeasonStage } = await import('../src/components/DraftSeasonStage');
    let s = engine.startDraft(lobby(2, { region: 1, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);
    while (s.phase === 'drafting') s = autoPick(s);
    s = engine.withLeague(s, ALL, SCALE);
    const open = { ...s, season: { ...s.season!, startsAt: Date.now() + 20_000 } };
    const room = fakeRoom(snap(open, 'h'));
    const a = await render(app(h(DraftSeasonStage, { room })));
    await settle();
    const card = a.container.querySelector('.draft-captain-window')!;
    expect(card.textContent).toMatch(/Kapitän wählen – noch \d+ s bis zum Anpfiff/);
    expect(card.textContent).toMatch(/Wirkung auf den Team-Score: [+−]\d+\.\d/);
    // Favorit und eigener Rang nach Team-Score (alle Teams der Liga)
    const ratings = s.league!.teams.map((x) => x.rating);
    const me = s.teams.findIndex((x) => x.id === 'h');
    const rank = ratings.filter((r) => r > ratings[me]).length + 1;
    expect(card.querySelector('.draft-captain-window__odds')!.textContent).toMatch(
      new RegExp(`^Favorit: .+ \\(Team-Score ${Math.round(Math.max(...ratings))}\\) · dein Team-Score: Platz ${rank} von ${ratings.length}$`),
    );
    const go = card.querySelectorAll('button').find((b) => b.textContent === 'Jetzt anpfeifen (alle fertig)') as MiniElement | undefined;
    expect(go).toBeTruthy();
    await act(async () => go!.click());
    expect(room.kickoff).toHaveBeenCalled();
    const select = card.querySelector('select') as MiniElement;
    const id = s.teams.find((t) => t.id === 'h')!.slots[4]!;
    await act(async () => {
      select.value = String(id);
      select.dispatchEvent(new MiniEvent('change', { bubbles: true }));
    });
    expect(room.setCaptain).toHaveBeenCalledWith(id);
    const closed = { ...s, season: { ...s.season!, startsAt: Date.now() - 1000 } };
    const b = await render(app(h(DraftSeasonStage, { room: fakeRoom(snap(closed, 'h')) })));
    await settle();
    expect(b.container.querySelector('.draft-captain-window')).toBeNull();
  });
});

