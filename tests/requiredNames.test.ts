/**
 * Namenspflicht für Runs: Ohne eigenen Spielernamen („Trainer" zählt nicht) und ohne Teamnamen
 * startet kein Run – online wie offline. Geprüft werden die Helfer in runFinish, das Senden des
 * Namens vor dem gewerteten Start (gegen den echten Server mit D1-Shim) und die Formulare im
 * Mini-DOM: Meldung direkt am Feld, aria-invalid/aria-describedby, Fokus aufs erste fehlende Feld,
 * Nachfrage während eines Runs von vor der Namenspflicht und das Umbenennen auf Bilanz/Rangliste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, MiniEvent, type MiniElement } from './miniDom';

const doc = installMiniDom();
// Texteingaben: React nimmt das input-Ereignis nur, wenn das DOM es kennt („oninput" in document).
(doc as unknown as Record<string, unknown>).oninput = null;
// React-DOM und alles mit UI erst nach dem Mini-DOM laden (React prüft beim Laden, ob es ein DOM gibt)
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { Challenge340 } = await import('../src/pages/Challenge340');
const { Daily } = await import('../src/pages/Daily');
const { Leaderboard } = await import('../src/pages/Leaderboard');
const { SeasonResultView } = await import('../src/components/SeasonResultView');
const { setCurrentLang } = await import('../src/i18n/lang');
const engine = await import('../src/lib/challengeEngine');
const rf = await import('../src/lib/runFinish');
const { ApiRequestError, apiHealth, startRun: apiStartRun, renamePlayer } = await import('../src/lib/api/client');
const { startFailure, startRankedRun } = await import('../src/state/useChallengeRun');
const { getDevice } = await import('../src/lib/device');
const { localLeaderboard } = await import('../src/lib/leaderboard/local');
const { handleApi } = await import('../server/handler');
const { D1Shim } = await import('./d1shim');
const { buildScale } = await import('../src/lib/fit');

const { act, createElement: h } = React;
type ReactElement = import('react').ReactElement;
type D1ShimT = InstanceType<typeof D1Shim>;

const DATA = engine.createEngineData(ALL);
const SCALE = buildScale(ALL, 'all');

/** Spielt einen Run automatisch: erster wählbarer Kandidat, erster freier Slot. */
function autoPlay(config: import('../src/lib/challengeEngine').RunConfig) {
  let s = engine.startRun(config, DATA);
  while (!engine.isComplete(s)) {
    const pick = engine.candidates(s, DATA).filter((p) => !engine.legendBlocked(s, p, DATA))[0];
    let slot = s.slots.findIndex((_, i) => engine.isFreeSlot(s, i));
    if (slot < 0) slot = engine.SS_SLOT;
    s = engine.place(s, pick.id, slot, DATA);
  }
  return s;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Override = (path: string, init?: RequestInit) => Response | undefined;

/**
 * fetch: Pokémon-Daten echt, /api/* gegen den echten Server (frische D1) – `override` kann einzelne
 * Antworten vorgeben. `calls` sammelt die API-Aufrufe als „POST /api/player".
 */
async function stubServer(override?: Override, db: D1ShimT = new D1Shim()) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      const path = url.replace(/\?.*$/, '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      return override?.(path, init) ?? handleApi(new Request(`http://localhost${url}`, init), { DB: db });
    }),
  );
  await apiHealth(true); // zwischengespeicherten Health-Check an den neuen Stub anpassen
  return { calls, db, api: () => calls.filter((c) => /\/api\/(player|runs\/)/.test(c)) };
}

/** fetch: nur die Pokémon-Daten – das Backend ist nicht erreichbar */
async function stubOffline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      throw new TypeError('Failed to fetch');
    }),
  );
  await apiHealth(true);
}

const deviceName = (db: D1ShimT) =>
  db.query<{ name: string }>('SELECT name FROM devices WHERE id = ?', getDevice().deviceId)[0]?.name;

function storeLang(lang: 'de' | 'en') {
  localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang }));
}
function storePlayer(name: unknown) {
  localStorage.setItem('pokemon-elf:player-name', JSON.stringify(name));
}
function storeTeam(storageId: string, teamName: string) {
  localStorage.setItem(`pokemon-elf:run:${storageId}`, JSON.stringify({ v: 2, phase: 'setup', setup: { teamName } }));
}
const stored = (key: string) => JSON.parse(localStorage.getItem(`pokemon-elf:${key}`) ?? 'null');

/** Fertig gesetzter Run in Phase 'play' (z. B. vor der Namenspflicht gestartet) */
function storePlayingRun(over: { teamName: string; token?: string | null }) {
  const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 21 });
  localStorage.setItem(
    'pokemon-elf:run:c340',
    JSON.stringify({
      v: 2,
      phase: 'play',
      setup: { challenge: 'c340', formation: '4-3-3', ssEnabled: false, teamName: over.teamName },
      engine: state,
      token: over.token ?? null,
      day: null,
      online: over.token != null,
      result: null,
    }),
  );
}

const mounted: (() => Promise<void>)[] = [];

async function render(el: ReactElement) {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(el));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  });
  return container;
}

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

const button = (el: MiniElement, label: string) => {
  const b = el.querySelectorAll('button').find((x) => x.textContent === label);
  if (!b) throw new Error(`Button „${label}" fehlt: ${el.textContent}`);
  return b;
};
const byId = (id: string) => doc.getElementById(id);
const field = (id: string) => {
  const el = byId(id);
  if (!el) throw new Error(`Feld #${id} fehlt`);
  return el;
};
const valueOf = (el: MiniElement) => (el.value as string | undefined) ?? '';

async function click(el: MiniElement) {
  await act(async () => el.click());
  await settle();
}

/** Tippt einen neuen Wert in ein Textfeld (wie der Browser: value setzen, input-Ereignis). */
async function typeInto(el: MiniElement, value: string) {
  await act(async () => {
    el.type = 'text';
    el.value = value;
    el.dispatchEvent(new MiniEvent('input', { bubbles: true }));
  });
}

async function submit(form: MiniElement) {
  await act(async () => {
    form.dispatchEvent(new MiniEvent('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Prüft ein Pflichtfeld: Meldung am Feld (per aria-describedby verknüpft) oder keine. */
function expectFieldError(id: string, message: string | null) {
  const input = field(id);
  if (message == null) {
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(byId(`${id}-error`)).toBeNull();
    return;
  }
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(input.getAttribute('aria-describedby')).toBe(`${id}-error`);
  expect(byId(`${id}-error`)?.textContent).toBe(message);
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal('confirm', () => true);
  // Reduzierte Bewegung: keine Würfel-Animation, kein Konfetti
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  doc.activeElement = null;
  setCurrentLang('de');
});

describe('Helfer: Spieler- und Teamname', () => {
  it('playerName(): gespeichertes „Trainer" (früherer Standard) zählt wie kein Name', () => {
    expect(rf.playerName()).toBe('');
    for (const old of ['Trainer', '  trainer ', 'TRAINER', '', '   ', 42, null]) {
      storePlayer(old);
      expect(rf.playerName()).toBe('');
    }
    storePlayer('  Ash   Ketchum ');
    expect(rf.playerName()).toBe('Ash Ketchum');
  });

  it('playerNameProblem/teamNameProblem: leer, Standardname, nichts Sichtbares', () => {
    expect(rf.playerNameProblem('')).toBe('empty');
    expect(rf.playerNameProblem('   ')).toBe('empty');
    expect(rf.playerNameProblem('Trainer')).toBe('default');
    expect(rf.playerNameProblem(' tRaInEr  ')).toBe('default');
    expect(rf.playerNameProblem('!!!')).toBe('invisible');
    expect(rf.playerNameProblem('​')).toBe('invisible');
    // „Trainer" mit unsichtbarem Zusatz (Variantenwähler) bleibt der Standardname
    expect(rf.playerNameProblem(`Trainer${String.fromCodePoint(0xfe0f)}`)).toBe('default');
    expect(rf.playerNameProblem('Trainer Rot')).toBeNull();
    expect(rf.playerNameProblem('⚽')).toBeNull();
    expect(rf.playerNameProblem('Ash')).toBeNull();

    expect(rf.teamNameProblem('')).toBe('empty');
    expect(rf.teamNameProblem(' \t ')).toBe('empty');
    expect(rf.teamNameProblem('– – –')).toBe('invisible');
    expect(rf.teamNameProblem('FC 1')).toBeNull();
    // Ein Team darf „Trainer" heißen – nur der Spielername nicht
    expect(rf.teamNameProblem('Trainer')).toBeNull();
  });

  it('cleanTeamName: Leerraum zusammengefasst, höchstens 32 Zeichen (Emoji = 1)', () => {
    expect(rf.cleanTeamName('  Dynamo   Mahagonia  ')).toBe('Dynamo Mahagonia');
    expect([...rf.cleanTeamName('⚽'.repeat(40))].length).toBe(32);
  });

  it('checkNames: deutsche Meldungen je Feld, null wenn alles passt', () => {
    expect(rf.checkNames('', '')).toEqual({
      player: 'Bitte gib deinen Namen für die Rangliste ein.',
      teamName: 'Bitte gib deinem Team einen Namen.',
    });
    expect(rf.checkNames('trainer', 'FC Glurak')).toEqual({
      player: '„Trainer" heißen hier alle – bitte wähle einen eigenen Namen.',
    });
    expect(rf.checkNames('Ash', '...')).toEqual({
      teamName: 'Der Teamname braucht mindestens einen Buchstaben, eine Ziffer oder ein Emoji.',
    });
    expect(rf.checkNames('Ash', 'Alabastia')).toBeNull();
  });

  it('Englisch: Meldungen übersetzt', () => {
    setCurrentLang('en');
    expect(rf.checkNames('Trainer', '')).toEqual({
      player: 'Everyone here is called “Trainer” – please choose a name of your own.',
      teamName: 'Please give your team a name.',
    });
  });

  it('rejectedNameField und startFailure: Namensfehler des Servers gehören ans Feld, nie offline', () => {
    const nameRequired = new ApiRequestError('Bitte wähle zuerst deinen Namen für die Rangliste', 400, 'name_required');
    const badName = new ApiRequestError('Bitte wähle einen eigenen Namen', 400, 'bad_name');
    const teamRequired = new ApiRequestError('Bitte gib deinem Team einen Namen', 400, 'team_name_required');
    expect(rf.rejectedNameField(nameRequired)).toBe('player');
    expect(rf.rejectedNameField(badName)).toBe('player');
    expect(rf.rejectedNameField(teamRequired)).toBe('teamName');
    expect(rf.rejectedNameField(new ApiRequestError('x', 400, 'bad_request'))).toBeNull();
    expect(rf.rejectedNameField(new Error('x'))).toBeNull();
    for (const mode of ['auto', 'ask'] as const) {
      expect(startFailure(nameRequired, mode)).toEqual({ kind: 'name', field: 'player', error: nameRequired.message });
      expect(startFailure(badName, mode)).toEqual({ kind: 'name', field: 'player', error: badName.message });
    }
  });
});

describe('Name beim Server sichern', () => {
  it('Server-Fehlercodes: Deutsch unverändert, Englisch übersetzt', async () => {
    const answers = () => [
      json(400, { error: 'name_required', message: 'Bitte wähle zuerst deinen Namen für die Rangliste' }),
      json(400, { error: 'bad_name', message: 'Bitte wähle einen eigenen Namen' }),
      json(400, { error: 'team_name_required', message: 'Bitte gib deinem Team einen Namen' }),
      json(400, { error: 'bad_request', message: 'Spielername ist zu lang (max. 24 Zeichen)' }),
    ];
    const run = async () => {
      const queue = answers();
      vi.stubGlobal('fetch', vi.fn(async () => queue.shift()!));
      const out: string[] = [];
      for (let i = 0; i < 4; i++) out.push(await apiStartRun('c340').then(() => 'ok', (e: Error) => e.message));
      return out;
    };
    expect(await run()).toEqual([
      'Bitte wähle zuerst deinen Namen für die Rangliste',
      'Bitte wähle einen eigenen Namen',
      'Bitte gib deinem Team einen Namen',
      'Spielername ist zu lang (max. 24 Zeichen)',
    ]);
    setCurrentLang('en');
    expect(await run()).toEqual([
      'Please choose your name for the leaderboard first',
      'Please choose a name of your own',
      'Please give your team a name',
      'That name won’t work – please choose another one',
    ]);
  });

  it('syncPlayerName: sendet nur bei geändertem Namen; 400 vom Server wird bad_name', async () => {
    const { api, db } = await stubServer();
    await rf.syncPlayerName('Rocko');
    await rf.syncPlayerName('Rocko');
    expect(api()).toEqual(['POST /api/player']);
    expect(deviceName(db)).toBe('Rocko');
    await rf.syncPlayerName('Rocko', true);
    expect(api()).toEqual(['POST /api/player', 'POST /api/player']);

    for (const bad of ['Trainer', '!!!']) {
      const err = await rf.syncPlayerName(bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as InstanceType<typeof ApiRequestError>).code).toBe('bad_name');
      expect(rf.rejectedNameField(err)).toBe('player');
    }
    expect(deviceName(db)).toBe('Rocko');
  });

  it('startRankedRun: kennt der Server den Namen doch nicht (frische DB), wird er einmal neu gesendet', async () => {
    await stubServer();
    await rf.syncPlayerName('Lt. Surge');
    // Gleiches Gerät, neue Datenbank: Gerät heißt dort wieder „Trainer", der Client meint, der Name sei bekannt
    const { api, db } = await stubServer();
    const res = await startRankedRun('c340', 'Lt. Surge');
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    expect(api()).toEqual(['POST /api/runs/start', 'POST /api/player', 'POST /api/runs/start']);
    expect(deviceName(db)).toBe('Lt. Surge');
    // Jetzt bekannt: kein weiteres Senden
    await startRankedRun('c340', 'Lt. Surge');
    expect(api().slice(3)).toEqual(['POST /api/runs/start']);
  });

  it('startRankedRun: bleibt der Name abgelehnt, kommt name_required beim Aufrufer an', async () => {
    const { api } = await stubServer((path) =>
      path === '/api/runs/start'
        ? json(400, { error: 'name_required', message: 'Bitte wähle zuerst deinen Namen für die Rangliste' })
        : undefined,
    );
    const err = await startRankedRun('c340', 'Gary').catch((e: unknown) => e);
    expect(rf.rejectedNameField(err)).toBe('player');
    expect(api()).toEqual(['POST /api/player', 'POST /api/runs/start', 'POST /api/player', 'POST /api/runs/start']);
  });

  it('savePlayerName: Standardname/leer → PlayerNameError, nichts gespeichert', async () => {
    await stubOffline();
    storePlayer('Ash');
    for (const bad of ['Trainer', '  trainer', '', '   ']) {
      const err = await rf.savePlayerName(bad, null).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(rf.PlayerNameError);
    }
    expect(stored('player-name')).toBe('Ash');
  });

  it('savePlayerName: online gesendet; lehnt der Server ab, bleibt alles beim Alten', async () => {
    const { db } = await stubServer();
    expect(await rf.savePlayerName('  Erika ', null)).toEqual({ online: true });
    expect(stored('player-name')).toBe('Erika');
    expect(deviceName(db)).toBe('Erika');

    await stubServer((path) =>
      path === '/api/player' ? json(400, { error: 'bad_name', message: 'Bitte wähle einen eigenen Namen' }) : undefined,
    );
    const err = await rf.savePlayerName('Koga', null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(rf.PlayerNameError);
    expect((err as Error).message).toBe('Bitte wähle einen eigenen Namen');
    expect(stored('player-name')).toBe('Erika');
  });

  it('savePlayerName offline: nur lokal – alte Runs ohne eigenen Namen bekommen ihn nicht, sie sind gelöscht', async () => {
    await stubOffline();
    const base = { challenge: 'c340' as const, record: { w: 1, d: 0, l: 33 }, points: 3, score: 400, formation: '4-3-3' as const, lineup: [], teamName: 'X' };
    localStorage.setItem(
      'pokemon-elf:leaderboard',
      JSON.stringify([
        { ...base, id: 'alt', player: 'Trainer', createdAt: '2026-10-01T10:00:00Z' },
        { ...base, id: 'misty', player: 'Misty', createdAt: '2026-10-01T11:00:00Z' },
      ]),
    );

    expect(await rf.savePlayerName('Sabrina', null)).toEqual({ online: false });
    expect(stored('player-name')).toBe('Sabrina');
    expect((await localLeaderboard.top('c340', 'all')).map((e) => e.player)).toEqual(['Misty']);
    expect((stored('leaderboard') as { id: string }[]).map((e) => e.id)).toEqual(['misty']);
  });

  it('startRankedRun: Kennt der Server den Namen, ist er auch lokal gespeichert – selbst wenn der Start scheitert', async () => {
    storePlayer('Trainer');
    const { db } = await stubServer((path) =>
      path === '/api/runs/start' ? json(503, { error: 'unavailable', message: 'Wartung' }) : undefined,
    );
    const err = await startRankedRun('c340', 'Koga').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(deviceName(db)).toBe('Koga');
    expect(stored('player-name')).toBe('Koga');
    expect(rf.playerName()).toBe('Koga');

    // Lehnt der Server den Namen ab, wird lokal nichts übernommen.
    await stubServer((path) =>
      path === '/api/player' ? json(400, { error: 'bad_name', message: 'Bitte wähle einen eigenen Namen' }) : undefined,
    );
    await startRankedRun('c340', 'Giovanni').catch(() => undefined);
    expect(stored('player-name')).toBe('Koga');
  });
});

describe('Setup: beide Felder sind Pflicht', () => {
  it('ohne Namen: Start meldet beide Felder am Feld, fokussiert den Namen – keine Anfrage, kein Run', async () => {
    storeLang('de');
    storePlayer('Trainer'); // Gerät aus der Zeit vor der Namenspflicht
    const { api } = await stubServer();
    const el = await render(app(h(Challenge340)));
    await settle();

    // „Trainer" wird nicht vorbelegt; beide Felder beschriftet
    expect(valueOf(field('run-player-name'))).toBe('');
    expect(el.querySelector('label[for="run-player-name"]')?.textContent).toBe('Dein Name auf der Rangliste');
    expect(el.querySelector('label[for="run-team-name"]')?.textContent).toBe('Teamname');
    expect(el.textContent).not.toContain('optional');
    expect(field('run-player-name').getAttribute('aria-required')).toBe('true');
    expectFieldError('run-player-name', null);

    const start = button(el, 'Run starten');
    expect(start.getAttribute('disabled')).toBeNull(); // bleibt klickbar
    await click(start);
    expectFieldError('run-player-name', 'Bitte gib deinen Namen für die Rangliste ein.');
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen.');
    expect(doc.activeElement).toBe(field('run-player-name'));
    expect(el.textContent).not.toContain('Runde 1/11');
    expect(api()).toEqual([]);

    // Standardname getippt → eigene Meldung; Tippen nimmt nur die Meldung dieses Felds zurück
    await typeInto(field('run-player-name'), ' trainer ');
    expectFieldError('run-player-name', null);
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen.');
    await click(button(el, 'Run starten'));
    expectFieldError('run-player-name', '„Trainer" heißen hier alle – bitte wähle einen eigenen Namen.');
    expect(doc.activeElement).toBe(field('run-player-name'));
    expect(api()).toEqual([]);
  });

  it('nur der Teamname fehlt: Fokus aufs Teamfeld; nach dem Tippen startet der Run (offline)', async () => {
    storeLang('de');
    storePlayer('Misty');
    await stubOffline();
    const el = await render(app(h(Challenge340)));
    await settle();
    expect(valueOf(field('run-player-name'))).toBe('Misty');

    await click(button(el, 'Run starten'));
    expectFieldError('run-player-name', null);
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen.');
    expect(doc.activeElement).toBe(field('run-team-name'));

    // Erneuter Versuch fokussiert erneut
    doc.activeElement = null;
    await click(button(el, 'Run starten'));
    expect(doc.activeElement).toBe(field('run-team-name'));

    await typeInto(field('run-team-name'), '  Azuria   Wellen ');
    expectFieldError('run-team-name', null);
    await click(button(el, 'Run starten'));
    expect(el.textContent).toContain('Runde 1/11');
    // Teamname bleibt je Challenge gespeichert, der Name global
    expect(stored('run:c340').setup.teamName).toBe('  Azuria   Wellen ');
    expect(stored('player-name')).toBe('Misty');
  });

  it('online: Name wird vor dem Start gesendet – nur wenn er sich geändert hat – dann gewertet', async () => {
    storeLang('de');
    storePlayer('Brock');
    storeTeam('c340', 'Marmoria Felsen');
    const { api, db } = await stubServer();
    const el = await render(app(h(Challenge340)));
    await settle();
    await click(button(el, 'Run starten'));
    expect(el.textContent).toContain('Runde 1/11');
    expect(el.textContent).toContain('Gewertet');
    expect(api()).toEqual(['POST /api/player', 'POST /api/runs/start']);
    expect(deviceName(db)).toBe('Brock');

    // Abbrechen und neu starten: Name unverändert → nur der Start
    await click(button(el, 'Run abbrechen'));
    expect(valueOf(field('run-team-name'))).toBe('Marmoria Felsen');
    await click(button(el, 'Run starten'));
    expect(api()).toEqual(['POST /api/player', 'POST /api/runs/start', 'POST /api/runs/start']);

    // Neuer Name im Setup → wird vor dem Start gesendet und lokal gespeichert
    await click(button(el, 'Run abbrechen'));
    await typeInto(field('run-player-name'), 'Rocko');
    await click(button(el, 'Run starten'));
    expect(api().slice(3)).toEqual(['POST /api/player', 'POST /api/runs/start']);
    expect(deviceName(db)).toBe('Rocko');
    expect(stored('player-name')).toBe('Rocko');
  });

  it('Server lehnt den Namen ab: Meldung am Feld, Fokus, kein Offline-Fallback', async () => {
    storeLang('de');
    storePlayer('Giovanni');
    storeTeam('c340', 'Team Rocket');
    const { api } = await stubServer((path) =>
      path === '/api/player' ? json(400, { error: 'bad_name', message: 'Bitte wähle einen eigenen Namen' }) : undefined,
    );
    const el = await render(app(h(Challenge340)));
    await settle();
    await click(button(el, 'Run starten'));
    expectFieldError('run-player-name', 'Bitte wähle einen eigenen Namen');
    expect(doc.activeElement).toBe(field('run-player-name'));
    expect(el.textContent).not.toContain('Runde 1/11');
    expect(api()).toEqual(['POST /api/player']);
    // Abgelehnter Name wird nicht lokal übernommen
    expect(stored('player-name')).toBe('Giovanni');
  });

  it('Tägliche Elf: ebenfalls Pflicht', async () => {
    storeLang('de');
    await stubOffline();
    const el = await render(app(h(Daily)));
    await settle();
    await click(button(el, 'Run starten'));
    expectFieldError('run-player-name', 'Bitte gib deinen Namen für die Rangliste ein.');
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen.');
    expect(el.textContent).not.toContain('Runde 1/11');
    expect(el.textContent).not.toContain('Keine Verbindung zum Server');
  });

  it('Tägliche Elf schon gespielt: Der gesendete Name ist trotzdem lokal gespeichert und überall vorbelegt', async () => {
    storeLang('de');
    storePlayer('Trainer');
    storeTeam('daily', 'Tagesform');
    const message = "Die Tägliche Elf hast du schon gespielt – morgen gibt's eine neue!";
    const { api, db } = await stubServer((path) =>
      path === '/api/runs/start' ? json(409, { error: 'already_played', message }) : undefined,
    );
    const el = await render(app(h(Daily)));
    await settle();
    expect(valueOf(field('run-player-name'))).toBe('');
    await typeInto(field('run-player-name'), 'Ash');
    await click(button(el, 'Run starten'));
    expect(el.textContent).toContain(message);
    expect(el.textContent).not.toContain('Runde 1/11');
    expect(api()).toEqual(['POST /api/player', 'POST /api/runs/start']);
    expect(deviceName(db)).toBe('Ash');
    expect(stored('player-name')).toBe('Ash');

    // Eine andere Challenge: der Name steht schon im Feld.
    for (const unmount of mounted.splice(0)) await unmount();
    await render(app(h(Challenge340)));
    await settle();
    expect(valueOf(field('run-player-name'))).toBe('Ash');
  });

  it('Pflichtfelder: Meldung mit role="alert", bei jedem Fehlversuch neu angesagt (neues Element)', async () => {
    storeLang('de');
    await stubOffline();
    const el = await render(app(h(Challenge340)));
    await settle();
    await click(button(el, 'Run starten'));
    const first = byId('run-player-name-error')!;
    expect(first.getAttribute('role')).toBe('alert');
    expect(byId('run-team-name-error')?.getAttribute('role')).toBe('alert');
    await click(button(el, 'Run starten'));
    expect(byId('run-player-name-error')).not.toBe(first);
    expectFieldError('run-player-name', 'Bitte gib deinen Namen für die Rangliste ein.');
  });

  it('Englisch: Felder und Meldungen ohne Deutsch', async () => {
    storeLang('en');
    await stubOffline();
    const el = await render(app(h(Challenge340)));
    await settle();
    await click(button(el, 'Start run'));
    expect(el.querySelector('label[for="run-player-name"]')?.textContent).toBe('Your name on the leaderboard');
    expect(field('run-player-name').getAttribute('placeholder')).toBe('e.g. Ash');
    expectFieldError('run-player-name', 'Please enter your name for the leaderboard.');
    expectFieldError('run-team-name', 'Please give your team a name.');
  });
});

describe('Während des Runs: fehlende Namen nachtragen', () => {
  it('Run ohne Namen: Nachfrage über dem Spielfeld, Auswertung erst mit beiden Namen', async () => {
    storeLang('de');
    storePlayer('Trainer');
    storePlayingRun({ teamName: '' });
    await stubOffline();
    const el = await render(app(h(Challenge340)));
    await settle();
    expect(el.textContent).toContain('Bevor die Saison startet: Gib dir und deinem Team noch einen Namen.');
    expect(el.querySelector('section.run-names')?.getAttribute('aria-label')).toBe('Namen für die Wertung');

    await click(button(el, 'Ergebnis ansehen'));
    expectFieldError('run-player-name', 'Bitte gib deinen Namen für die Rangliste ein.');
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen.');
    expect(doc.activeElement).toBe(field('run-player-name'));
    expect(el.textContent).not.toContain('Saisonbilanz');

    await typeInto(field('run-player-name'), 'Erika');
    await typeInto(field('run-team-name'), 'Prismania Blüten');
    // Die Nachfrage bleibt stehen, solange der Run läuft – Felder verschwinden nicht beim Tippen
    expect(byId('run-team-name')).not.toBeNull();
    await click(button(el, 'Ergebnis ansehen'));
    const skip = el.querySelectorAll('button').find((b) => b.textContent === 'Überspringen');
    if (skip) await click(skip);
    expect(el.textContent).toContain('Prismania Blüten');
    expect(el.textContent).toContain('Saisonbilanz');
    expect(stored('player-name')).toBe('Erika');
    const history = stored('leaderboard') as { player: string; teamName: string }[];
    expect(history.at(-1)).toMatchObject({ player: 'Erika', teamName: 'Prismania Blüten' });
  });

  it('Server lehnt den Teamnamen beim Abschluss ab (team_name_required): Run bleibt, Feld markiert', async () => {
    storeLang('de');
    storePlayer('Blaine');
    storePlayingRun({ teamName: 'Zinnober', token: 'a'.repeat(64) });
    const { api } = await stubServer((path) =>
      path === '/api/runs/finish'
        ? json(400, { error: 'team_name_required', message: 'Bitte gib deinem Team einen Namen' })
        : undefined,
    );
    const el = await render(app(h(Challenge340)));
    await settle();
    expect(el.querySelector('section.run-names')).toBeNull();

    await click(button(el, 'Ergebnis ansehen'));
    expect(api()).toEqual(['POST /api/runs/finish']);
    expect(el.textContent).toContain('Bevor die Saison startet');
    expectFieldError('run-team-name', 'Bitte gib deinem Team einen Namen');
    expect(doc.activeElement).toBe(field('run-team-name'));
    expect(el.textContent).not.toContain('Saisonbilanz');
    // Kein „abgelehnt"-Ergebnis: Token und Phase bleiben, erneut senden ist möglich
    expect(stored('run:c340')).toMatchObject({ phase: 'play', token: 'a'.repeat(64) });
    expect(stored('leaderboard')).toBeNull();
  });

  it('finishRun wirft Namensfehler des Servers, statt den Run als abgelehnt auszuwerten', async () => {
    for (const [error, field] of [
      ['team_name_required', 'teamName'],
      ['name_required', 'player'],
      ['bad_name', 'player'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => json(400, { error, message: 'nein' })));
      const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 3 });
      const err = await rf
        .finishRun({ state, teamName: 'X', player: 'Ash', token: 'tok', day: null, byId: DATA.byId, scale: SCALE })
        .catch((e: unknown) => e);
      expect(rf.rejectedNameField(err)).toBe(field);
    }
    expect(stored('leaderboard')).toBeNull();
  });
});

describe('Umbenennen auf Bilanz und Rangliste', () => {
  const input = {
    formation: '4-3-3' as const,
    slots: autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 5 }).slots,
    teamName: 'Alabastia',
    seed: 1234,
  };

  it('Saisonbilanz: „Trainer" wird am Feld abgelehnt, nichts gespeichert', async () => {
    storeLang('de');
    storePlayer('Ash');
    await stubOffline();
    const el = await render(
      app(h(SeasonResultView, { challenge: 'c340', input, scaleKind: 'all', sprite: 'pixel', entryId: null, onNewRun: () => {} })),
    );
    await settle();
    expect(valueOf(field('player-name'))).toBe('Ash');
    await typeInto(field('player-name'), 'Trainer');
    await submit(el.querySelector('form.namefield')!);
    expectFieldError('player-name', '„Trainer" heißen hier alle – bitte wähle einen eigenen Namen.');
    expect(doc.activeElement).toBe(field('player-name'));
    expect(stored('player-name')).toBe('Ash');

    await typeInto(field('player-name'), 'Ash Ketchum');
    expectFieldError('player-name', null);
    await submit(el.querySelector('form.namefield')!);
    expect(stored('player-name')).toBe('Ash Ketchum');
  });

  it('Rangliste: früheres „Trainer" ist nicht vorbelegt, leerer Name wird am Feld abgelehnt', async () => {
    storeLang('de');
    storePlayer('Trainer');
    await stubOffline();
    const el = await render(app(h(Leaderboard)));
    await settle();
    expect(valueOf(field('lb-name'))).toBe('');
    await submit(el.querySelector('form.namefield')!);
    expectFieldError('lb-name', 'Bitte gib deinen Namen für die Rangliste ein.');
    expect(doc.activeElement).toBe(field('lb-name'));
    expect(stored('player-name')).toBe('Trainer');

    await typeInto(field('lb-name'), 'Misty');
    await submit(el.querySelector('form.namefield')!);
    expectFieldError('lb-name', null);
    expect(stored('player-name')).toBe('Misty');
  });

  it('Umbenennen auf der Bilanz gilt auch für den nächsten Run („Neuer Run" liest den Namen neu)', async () => {
    storeLang('de');
    storePlayer('Brock');
    storePlayingRun({ teamName: 'Marmoria Felsen' }); // fertiger, lokal gestarteter Run
    const { api, db } = await stubServer();
    const el = await render(app(h(Challenge340)));
    await settle();
    await click(button(el, 'Ergebnis ansehen'));
    const skip = el.querySelectorAll('button').find((b) => b.textContent === 'Überspringen');
    if (skip) await click(skip);
    expect(valueOf(field('player-name'))).toBe('Brock');

    await typeInto(field('player-name'), 'Rocko');
    await submit(el.querySelector('form.namefield')!);
    expect(deviceName(db)).toBe('Rocko');
    expect(stored('player-name')).toBe('Rocko');

    await click(button(el, 'Neuer Run'));
    expect(valueOf(field('run-player-name'))).toBe('Rocko');
    await click(button(el, 'Run starten'));
    expect(el.textContent).toContain('Runde 1/11');
    // Der neue Name ist schon beim Server – kein erneutes (oder gar altes) Senden
    expect(api()).toEqual(['POST /api/player', 'POST /api/runs/start']);
    expect(deviceName(db)).toBe('Rocko');
    expect(stored('player-name')).toBe('Rocko');
  });

  it('Ablehnung wird angesagt: role="alert", Fokus erst mit verknüpfter Meldung – auch beim erneuten Absenden', async () => {
    storeLang('de');
    storePlayer('Ash');
    await stubOffline();
    const forms = [
      { id: 'player-name', el: () => h(SeasonResultView, { challenge: 'c340', input, scaleKind: 'all', sprite: 'pixel', entryId: null, onNewRun: () => {} }) },
      { id: 'lb-name', el: () => app(h(Leaderboard)) },
    ];
    for (const f of forms) {
      const el = await render(f.id === 'player-name' ? app(f.el()) : f.el());
      await settle();
      const input = field(f.id);
      // Was beim Fokussieren schon verknüpft ist, liest der Screenreader vor.
      const describedAtFocus: (string | null)[] = [];
      const focus = input.focus.bind(input);
      input.focus = () => {
        describedAtFocus.push(input.getAttribute('aria-describedby'));
        focus();
      };
      await typeInto(input, 'Trainer');
      const form = el.querySelector('form.namefield')!;
      await submit(form);
      expect(describedAtFocus, f.id).toEqual([`${f.id}-error`]);
      expect(doc.activeElement).toBe(input);
      const first = byId(`${f.id}-error`)!;
      expect(first.getAttribute('role'), f.id).toBe('alert');

      // Erneut mit Enter absenden (Fokus steht schon im Feld): die Meldung kommt als neues Element.
      await submit(form);
      const second = byId(`${f.id}-error`)!;
      expect(second).not.toBe(first);
      expect(second.getAttribute('role')).toBe('alert');
      expect(second.textContent).toBe('„Trainer" heißen hier alle – bitte wähle einen eigenen Namen.');
      expect(describedAtFocus).toEqual([`${f.id}-error`, `${f.id}-error`]);
      for (const unmount of mounted.splice(0)) await unmount();
    }
  });

  it('renamePlayer gegen den Server: „Trainer" ist kein Name (bad_name)', async () => {
    await stubServer();
    await expect(renamePlayer('Trainer')).rejects.toMatchObject({ status: 400, code: 'bad_name' });
  });
});
