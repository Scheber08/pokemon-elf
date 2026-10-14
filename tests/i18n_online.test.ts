/**
 * Online-Liga auf Englisch: Katalog, Server-/Engine-Meldungen (per Meldung, Muster oder Code
 * übersetzt – auf Deutsch wörtlich), Ansagen und die Oberfläche von Lobby, Live-Draft, Raum-Seite
 * und /draft. Geprüft werden nur die eigenen Teile – eingebettete Komponenten anderer Bereiche
 * (Board, Einstellungen, Raster …) haben eigene Tests.
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSettingsPatch, DraftSnapshot, PublicLobby } from '../src/lib/api/draftContract';
import type { DraftRoom } from '../src/state/useDraftRoom';
import type { DraftState } from '../src/lib/draftEngine';
import { ALL, byName } from './helpers';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom();
// React-DOM und alles mit UI erst nach dem Mini-DOM laden
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { DraftLive } = await import('../src/components/DraftLive');
const { DraftLobby } = await import('../src/components/DraftLobby');
const { DraftRoom: DraftRoomPage } = await import('../src/pages/DraftRoom');
const { DraftOnline } = await import('../src/pages/DraftOnline');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider, useSettings } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const hook = await import('../src/state/useDraftRoom');
const engine = await import('../src/lib/draftEngine');
const { buildScale } = await import('../src/lib/fit');
const { messages, setCurrentLang } = await import('../src/i18n');
const { save, STORAGE_KEYS } = await import('../src/lib/storage');

const { act, createElement: h } = React;
const SCALE = buildScale(ALL, 'all');
const byId = new Map(ALL.map((p) => [p.id, p]));

/** Typische deutsche Wörter bzw. Zeichen – in englischen Texten darf nichts davon stehen. */
const GERMAN =
  /[äöüÄÖÜß„]|\b(und|der|die|das|den|dem|nicht|mit|ist|bist|du|dich|dein\w*|wird|werden|Liga\w*|Runde\w*|Zug|wähl\w*|gewählt|Vorschlag|Spielfeld|Verbind\w*|Einstellungen|Mitspielen|Beitreten|Teilen|kopieren|Warte|starten|Vergeben\w*|zeigen|frei|Letzter|automatisch|Zuschauen|Aktualisieren|Fertig|Weiter|Ergebnis|Erneut|Mannschaft|Spieltag|Team-Score|Gerät|Anmeldung|Fehler)\b/i;

function expectEnglish(text: string) {
  expect(text.trim()).not.toBe('');
  expect(text, text).not.toMatch(GERMAN);
}

/** Sichtbarer Text samt aria-label/title/placeholder eines Teilbaums. */
function uiText(el: MiniElement | null): string {
  expect(el).not.toBeNull();
  const parts = [el!.textContent];
  const walk = (e: MiniElement) => {
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = e.getAttribute(a);
      if (v) parts.push(v);
    }
    e.children.forEach((c) => walk(c as MiniElement));
  };
  walk(el!);
  return parts.join(' | ');
}

function expectEnglishIn(container: MiniElement, selector: string) {
  const found = container.querySelectorAll(selector);
  expect(found.length, selector).toBeGreaterThan(0);
  for (const el of found) expectEnglish(uiText(el));
}

// ---------------------------------------------------------------- Helfer wie in draftRender.test.ts

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(lobbies: PublicLobby[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.endsWith('/drafts/public')) return json(200, { lobbies });
      throw new TypeError('Failed to fetch');
    }),
  );
}

const mounted: (() => Promise<void>)[] = [];

async function render(el: ReactElement) {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(el));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  });
  return { container, root };
}

const app = (child: ReactElement, path = '/') =>
  h(
    MemoryRouter,
    { initialEntries: [path] },
    h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))),
  );

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

const drafting = (teams = 2) =>
  engine.startDraft(lobby(teams, { region: 0, maxTeams: 4, order: 'host', pickSeconds: 0 }), 'dev-h', 0, ALL);

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
    answerOffer: vi.fn(() => true),
    react: vi.fn(() => true),
    reactions: [],
    reconnect: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  localStorage.clear();
  // Englisch wählen – wie der Sprachumschalter (gespeicherte Einstellung) und für Nicht-React-Code
  save(STORAGE_KEYS.settings, { lang: 'en' });
  setCurrentLang('en');
  stubFetch();
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  localStorage.clear();
  setCurrentLang('de');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- Katalog & Meldungen

describe('Katalog online (en)', () => {
  it('alle englischen Texte sind frei von Deutsch (Funktionen mit Beispielwerten)', () => {
    const check = (v: unknown, path: string) => {
      if (typeof v === 'string') {
        if (v.trim()) expect(v, path).not.toMatch(GERMAN);
      } else if (typeof v === 'function') {
        const args = Array.from({ length: v.length }, (_, i) => (i === 0 ? 2 : i + 1));
        expect(v(...args), path).not.toMatch(GERMAN);
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) check(x, `${path}.${k}`);
      }
    };
    check(messages('en').online, 'online');
  });

  it('Mehrzahl: ein bzw. mehrere', () => {
    const t = messages('en').online;
    expect(t.server.fmt.tooManyTeams(1)).toBe('1 team has already joined');
    expect(t.server.fmt.tooManyTeams(3)).toBe('3 teams have already joined');
    expect(t.retention(1)).toBe('Leagues are deleted after 1 day. More in the');
    expect(t.startInfo(2, 11)).toBe('2 teams · snake draft over 11 rounds.');
  });
});

describe('draftErrorText', () => {
  const glurak = byName('Glurak');

  it('jede bekannte Server-Meldung hat eine englische Fassung', () => {
    const de = messages('de').online.server.msg;
    const en = messages('en').online.server.msg;
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(hook.draftErrorText(de[key], 'bad_request')).toBe(en[key]);
    }
  });

  it('Muster mit Zahlen und Namen, dann Code, dann allgemein', () => {
    expect(hook.draftErrorText('Du bist nicht dran', 'not_your_turn')).toBe('It’s not your turn');
    expect(hook.draftErrorText('Der Pool reicht nur für 3 Teams à 11 Pokémon', 'bad_request')).toBe(
      'The pool is only big enough for 3 teams of 11 Pokémon each',
    );
    expect(hook.draftErrorText('Der Pool hat nur 20 Pokémon, gebraucht werden 33', 'pool_too_small')).toBe(
      'The pool only has 20 Pokémon, 33 are needed',
    );
    expect(hook.draftErrorText('Zwischen 2 und 8 Teams', 'bad_settings')).toBe('Between 2 and 8 teams');
    expect(hook.draftErrorText(`${glurak.de} ist schon vergeben`, 'bad_pick', ALL)).toBe(`${glurak.en} is already taken`);
    expect(hook.draftErrorText('Auto-Pick für „Team 1" geht erst, wenn das Team 15 s offline ist', 'not_allowed')).toBe(
      'Auto-pick for “Team 1” is only possible once the team has been offline for 15 s',
    );
    expect(hook.draftErrorText('Teamname ist zu lang (max. 24 Zeichen)', 'bad_name')).toBe(
      'Team name is too long (max. 24 characters)',
    );
    // Unbekannte Meldung: Code – unbekannter Code: allgemeiner Text
    expect(hook.draftErrorText('Etwas ganz Neues', 'league_full')).toBe('The league is full');
    expect(hook.draftErrorText('Etwas ganz Neues', 'brand_new')).toBe('Unknown error');
    expect(hook.draftErrorText('', undefined)).toBe('');
  });

  it('auf Deutsch bleibt die Meldung des Servers wörtlich', () => {
    for (const msg of ['Du bist nicht dran', 'Der Pool reicht nur für 3 Teams à 11 Pokémon', 'Etwas ganz Neues', '']) {
      expect(hook.draftErrorText(msg, 'bad_request', ALL, 'de')).toBe(msg);
    }
  });
});

describe('Ansagen und Hinweise (en)', () => {
  it('startBlocker', () => {
    expect(hook.startBlocker(snap(lobby(1)), ALL)).toBe('At least 2 teams – invite people or add CPU teams');
    expect(hook.startBlocker(snap(drafting()), ALL)).toBe('The draft is already under way');
    // Deutsch bleibt wie bisher
    expect(hook.startBlocker(snap(lobby(1)), ALL, messages('de'))).toBe(
      'Mindestens 2 Teams – lade Leute ein oder füge CPU-Teams hinzu',
    );
  });

  it('Pick-Ansage und Verlauf mit englischen Pokémon-Namen', () => {
    const s = autoPick(drafting());
    const mon = byId.get(s.picks[0].pokemonId)!;
    expect(hook.pickAnnouncement(snap(s, null), byId)).toBe(`Pick 1: ${mon.en} to Host FC (automatic). On the clock: Team 1.`);
    expect(hook.pickAnnouncement(snap(s, 'h'), byId)).toBe(`Pick 1: ${mon.en} to you (automatic). On the clock: Team 1.`);
    expect(hook.pickFeed(snap(s), byId)[0].pokemon).toBe(mon.en);
  });
});

describe('CPU-Vereine (en)', () => {
  /** Lobby mit Host + zwei CPU-Teams (intern deutsche Vereinsnamen) */
  const withCpus = (order: 'host' | 'random' = 'host') => {
    let s = lobby(1, { region: 0, maxTeams: 4, order, pickSeconds: 0 });
    s = engine.addCpuTeam(s, 'dev-h', 'c1');
    s = engine.addCpuTeam(s, 'dev-h', 'c2');
    return s;
  };
  const cpuNames = (s: DraftState) => s.teams.filter((t) => t.cpu).map((t) => t.name);
  const en = (name: string) => messages('en').game.club(name);

  it('teamLabel übersetzt nur CPU-Vereine', () => {
    const s = withCpus();
    const [cpu] = s.teams.filter((t) => t.cpu);
    expect(en(cpu.name)).not.toBe(cpu.name);
    expect(hook.teamLabel(cpu)).toBe(en(cpu.name));
    expect(hook.teamLabel(cpu, messages('de'))).toBe(cpu.name);
    // Selbst gewählte Namen bleiben, auch wenn sie wie ein Verein heißen
    expect(hook.teamLabel({ name: cpu.name, cpu: false })).toBe(cpu.name);
  });

  it('Verlauf, Ansage, Lobby und Live-Draft zeigen englische Vereinsnamen', async () => {
    const lobbyState = withCpus();
    const names = cpuNames(lobbyState);
    const l = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobbyState)) })));
    const list = uiText(l.container.querySelector('.draft-lobby__teams'));
    for (const n of names) {
      expect(list).not.toContain(n);
      expect(list).toContain(en(n));
      expect(list).toContain(`Remove ${en(n)}`);
    }

    // Host wählt zuerst, dann ist die erste CPU dran
    let s = engine.startDraft(lobbyState, 'dev-h', 0, ALL);
    s = autoPick(s);
    s = autoPick(s); // CPU 1 hat gewählt, CPU 2 ist dran
    const cpu1 = s.teams.find((t) => t.id === s.picks[1].teamId)!;
    const cpu2 = engine.currentTeam(s)!;
    expect(cpu1.cpu && cpu2.cpu).toBe(true);
    const mon = byId.get(s.picks[1].pokemonId)!;
    expect(hook.pickFeed(snap(s), byId)[0].team).toBe(en(cpu1.name));
    expect(hook.pickAnnouncement(snap(s), byId)).toBe(
      `Pick 2: ${mon.en} to ${en(cpu1.name)} (automatic). On the clock: ${en(cpu2.name)}.`,
    );
    const live = await render(app(h(DraftLive, { room: fakeRoom(snap(s, null)) })));
    const text = uiText(live.container.querySelector('.draft-live'));
    for (const n of names) expect(text).not.toContain(n);
    expect(live.container.querySelector('.draft-turnbar__team')!.textContent).toBe(`On the clock: ${en(cpu2.name)} (CPU)`);
    expect(live.container.querySelector('.draft-turnbar__last')!.textContent).toBe(`Last pick: ${mon.en} → ${en(cpu1.name)} (auto)`);
  });

  it('auf Deutsch bleiben die Vereinsnamen', () => {
    let s = engine.startDraft(withCpus(), 'dev-h', 0, ALL);
    s = autoPick(autoPick(s));
    const cpu1 = s.teams.find((t) => t.id === s.picks[1].teamId)!;
    expect(hook.pickFeed(snap(s), byId, 8, messages('de'))[0].team).toBe(cpu1.name);
  });
});

describe('Meldungen im Raum folgen dem Sprachwechsel', () => {
  /** Minimaler WebSocket für useDraftRoom */
  class FakeWs {
    static last: FakeWs;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly url: string) {
      FakeWs.last = this;
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
    }
  }

  let room!: DraftRoom;
  let setLang!: (lang: 'de' | 'en') => void;
  function Probe() {
    room = hook.useDraftRoom('ABC234');
    setLang = useSettings().setLang;
    return null;
  }
  async function connect() {
    vi.stubGlobal('WebSocket', FakeWs);
    await render(app(h(Probe)));
    const ws = FakeWs.last;
    await act(async () => {
      ws.readyState = 1;
      ws.onopen?.();
    });
    return (msg: unknown) => act(async () => ws.onmessage?.({ data: JSON.stringify(msg) }));
  }

  it('abgelehnte Anmeldung', async () => {
    const say = await connect();
    await say({ type: 'error', code: 'rate_limited', message: 'Zu viele neue Ligen in kurzer Zeit – bitte später erneut versuchen' });
    expect(room.authError).toBe('Too many new leagues in a short time – please try again later');
    await act(async () => setLang('de'));
    expect(room.authError).toBe('Zu viele neue Ligen in kurzer Zeit – bitte später erneut versuchen');
  });

  it('Fehler einer Aktion und eigene Hinweise', async () => {
    const say = await connect();
    await say({ type: 'state', state: snap(lobby(2), 'h') });
    await say({ type: 'error', code: 'league_full', message: 'Die Liga ist voll' });
    expect(room.error).toBe('The league is full');
    await act(async () => setLang('de'));
    expect(room.error).toBe('Die Liga ist voll');
    // Eigener Hinweis (ohne Server)
    await act(async () => void room.join('   ', '4-4-2'));
    expect(room.error).toBe('Gib deinem Team einen Namen');
    await act(async () => setLang('en'));
    expect(room.error).toBe('Give your team a name');
  });
});

describe('Ersatzmeldungen des Draft-Clients', () => {
  it('folgen der aktiven Sprache – auch nach einem Sprachwechsel', () => {
    const de = messages('de').online.client;
    const en = messages('en').online.client;
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(hook.draftErrorText(de[key], 'network', undefined, 'en')).toBe(en[key]);
      expect(hook.draftErrorText(en[key], 'network', undefined, 'de')).toBe(de[key]);
      expect(hook.draftErrorText(de[key], 'network', undefined, 'de')).toBe(de[key]);
    }
    // Unbekannter HTTP-Status: auf Deutsch wie bisher, auf Englisch über den Code
    expect(hook.draftErrorText('HTTP 502', 'server_error', undefined, 'de')).toBe('HTTP 502');
    expect(hook.draftErrorText('HTTP 502', 'server_error', undefined, 'en')).toBe('Server error – please try again');
  });
});

// ---------------------------------------------------------------- Oberfläche

describe('DraftLive (en)', () => {
  it('eigener Zug: Statusleiste, Ansage, Pool-Hinweis mit Vorschlag und Spielfeld', async () => {
    const s = drafting();
    const { container } = await render(app(h(DraftLive, { room: fakeRoom(snap(s, 'h')) })));
    expect(container.querySelector('.draft-myturn')!.textContent).toBe('It’s your turn!');
    expect(container.querySelector('.draft-turnbar .statusline')!.textContent).toMatch(/^Round 1\/11Pick 1\/22On the clock: You/);
    expectEnglishIn(container, '.draft-turnbar, .draft-myturn, [id="draft-pool-title"], .draft-pooltools, p.hint, .challenge__pitch h2');
    expect(container.querySelector('.pitch')!.getAttribute('aria-label')).toBe('Pitch of Host FC, formation 4-3-3');
    // Vorschlag: Pokémon vorgemerkt, Position auf Englisch
    const suggest = container.querySelectorAll('.draft-pooltools button').find((b) => b.textContent === 'Suggest')!;
    await act(async () => suggest.click());
    const hint = container.querySelector('p.hint')!.textContent;
    expect(hint).toMatch(/^.+ selected – suggestion: .+\. Click a free spot on your pitch\.$/);
    expectEnglish(hint);
  });

  it('fremder Zug: Ansage mit englischem Namen, Auto-Pick für ein abwesendes Team', async () => {
    const s = autoPick(drafting()); // Team 1 (offline) ist dran
    const mon = byId.get(s.picks[0].pokemonId)!;
    const { container } = await render(app(h(DraftLive, { room: fakeRoom(snap(s, 'h')) })));
    expect(container.querySelector('.draft-live [aria-live]')!.textContent).toBe(`Pick 1: ${mon.en} to you (automatic). On the clock: Team 1.`);
    expect(container.querySelector('.draft-turnbar__last')!.textContent).toBe(`Last pick: ${mon.en} → Host FC (auto)`);
    expect(container.querySelector('.draft-hostauto button')!.textContent).toBe('Pick automatically for Team 1');
    expect(container.querySelector('p.hint')!.textContent).toBe(
      // Snake mit zwei Teams: Team 1 wählt zweimal hintereinander
      'Team 1 is on the clock. You can already browse and shortlist a favourite. 2 picks until your turn.',
    );
    expectEnglishIn(container, '.draft-turnbar, .draft-live [aria-live], .draft-hostauto, p.hint, .draft-timer');
  });

  it('Zuschauer und Nur-Ansicht', async () => {
    const s = autoPick(drafting());
    const watch = await render(app(h(DraftLive, { room: fakeRoom(snap(s, null)) })));
    expectEnglishIn(watch.container, '.draft-turnbar, .draft-live__play .notice');
    const view = await render(app(h(DraftLive, { room: fakeRoom(snap(s, null), { live: false }), readOnly: true })));
    expect(view.container.querySelector('.draft-readonly')!.textContent).toMatch(/^View only/);
    expectEnglishIn(view.container, '.draft-readonly');
  });
});

describe('DraftLobby (en)', () => {
  it('Host: Code, Teams, Werkzeuge, Start', async () => {
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2, { region: 1, maxTeams: 4, order: 'host' }))) })));
    expect(container.querySelector('.draft-code__value')!.getAttribute('aria-label')).toBe('League code A B C 2 3 4');
    expect(container.querySelector('.draft-start button')!.textContent).toBe('Start draft');
    // Dauer: 2 Menschen × 11 Runden × 60 s = 22 min; Ticker 30 s + 34 × 5 s ≈ 3 min
    expect(container.querySelectorAll('.draft-start .hint').map((e) => e.textContent)).toContain(
      'Duration: draft at most ~22 min, then the season ticker ~3 min.',
    );
    expectEnglishIn(
      container,
      '.draft-code, [id="draft-teams-title"], .draft-lobby__tools, [aria-labelledby="draft-teams-title"] p, [aria-labelledby="draft-teams-title"] button.btn, [id="draft-me-title"], [aria-labelledby="draft-me-title"] button.btn, [id="draft-settings-title"], .draft-start',
    );
  });

  it('Host allein: Start-Hinweis auf Englisch', async () => {
    const { container } = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(1))) })));
    expect(container.querySelector('.draft-start .hint')!.textContent).toBe('At least 2 teams – invite people or add CPU teams');
  });

  it('Mitglied, Gast und Nur-Ansicht', async () => {
    const member = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2), 't1')) })));
    expectEnglishIn(member.container, '[id="draft-me-title"], .draft-wait');
    const guest = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2), null)) })));
    expectEnglishIn(guest.container, '[id="draft-join-title"], [aria-labelledby="draft-join-title"] button');
    const full = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2, { region: 1, maxTeams: 2 }), null)) })));
    expect(full.container.querySelector('[aria-labelledby="draft-join-title"] .notice')!.textContent).toBe(
      'The league is full (2/2). You can watch – maybe a place will free up.',
    );
    const view = await render(app(h(DraftLobby, { room: fakeRoom(snap(lobby(2), null), { live: false }), readOnly: true })));
    expectEnglishIn(view.container, '.draft-readonly, .draft-wait');
  });
});

describe('Seiten (en)', () => {
  it('/draft/:code – unbekannter Code', async () => {
    const { container } = await render(
      app(h(Routes, null, h(Route, { path: '/draft/:code', element: h(DraftRoomPage) })), '/draft/XY'),
    );
    expect(container.querySelector('h1')!.textContent).toBe('League not found');
    expectEnglishIn(container, '.draft-notfound');
  });

  it('/draft – Server nicht verfügbar', async () => {
    const { container } = await render(
      app(h(DraftOnline, { modeSwitch: null, supported: false, onRetry: vi.fn(), onLocal: vi.fn() })),
    );
    expectEnglishIn(container, '.page-head, .draft-offline');
  });

  it('/draft – Liga erstellen, beitreten, eigene und öffentliche Ligen', async () => {
    save('draft-online:recent', [{ code: 'XYZ789', name: '', team: 'FC Test', phase: 'drafting', at: Date.now() - 120_000 }]);
    stubFetch([
      {
        code: 'ABC234',
        name: '',
        hostName: 'Host FC',
        teams: 2,
        maxTeams: 4,
        region: 5,
        legends: true,
        pickSeconds: 60,
        createdAt: Date.now() - 3 * 3_600_000,
      },
      // Mehrere (nicht alle) Generationen: region 10
      {
        code: 'QWE789',
        name: 'Mixed',
        hostName: 'Mix FC',
        teams: 1,
        maxTeams: 2,
        region: 10,
        legends: false,
        pickSeconds: 0,
        createdAt: Date.now() - 4 * 3_600_000,
      },
    ]);
    const { container } = await render(
      app(h(DraftOnline, { modeSwitch: null, supported: true, onRetry: vi.fn(), onLocal: vi.fn() })),
    );
    const lobbies = container.querySelectorAll('.draft-lobbies');
    expect(lobbies).toHaveLength(2);
    expect(lobbies[0].textContent).toContain('League XYZ789');
    expect(lobbies[0].textContent).toContain('Drafting');
    expect(lobbies[0].textContent).toContain('2 min ago');
    expect(lobbies[1].textContent).toContain('by Host FC · 3 h ago');
    expect(lobbies[1].textContent).toContain('2/4 teams');
    // Die Spalte legends heißt „Legendäre oder Mysteriöse" – das Etikett nennt beide
    expect(lobbies[1].textContent).toContain('Unova + legendaries/mythicals');
    expect(lobbies[1].textContent).toContain('60 s');
    expect(lobbies[1].textContent).toContain('Several generations');
    expect(lobbies[1].textContent).not.toContain('?');
    expectEnglishIn(
      container,
      '.page-head, [id="draft-create-title"], .draft-create .draft-subtitle, .draft-create button.btn--big, .draft-create p.muted, .draft-joincode, .draft-lobbies, .draft-online__side p.muted',
    );
  });
});
