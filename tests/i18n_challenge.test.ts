/**
 * Übersetzung der Challenges (34–0, 151, Retro), der Saisonbilanz, des Live-Tickers und der
 * API-Fehler: Mit Englisch als gespeicherter Sprache steht nirgends mehr Deutsch – auch nicht in
 * Hinweisen, Fehlermeldungen (Server-Codes werden übersetzt) und Vorlesetexten. Deutsch bleibt
 * unverändert. Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, MiniEvent, type MiniElement } from './miniDom';

const doc = installMiniDom();
// React-DOM und alles mit UI erst nach dem Mini-DOM laden (React prüft beim Laden, ob es ein DOM gibt)
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { Challenge340 } = await import('../src/pages/Challenge340');
const { Challenge151 } = await import('../src/pages/Challenge151');
const { SeasonResultView } = await import('../src/components/SeasonResultView');
const { SeasonTicker } = await import('../src/components/SeasonTicker');
const { de } = await import('../src/i18n/de');
const { en } = await import('../src/i18n/en');
const { setCurrentLang } = await import('../src/i18n/lang');
const engine = await import('../src/lib/challengeEngine');
const { computeRun, finishErrorMessage, finishRun } = await import('../src/lib/runFinish');
const { ApiRequestError, startRun: apiStartRun, fetchLeaderboard } = await import('../src/lib/api/client');
const { engineErrorText, startFailure } = await import('../src/state/useChallengeRun');
const { scorerSummary } = await import('../src/lib/seasonTimeline');
const { buildScale } = await import('../src/lib/fit');
const { CLUB_NAMES } = await import('../src/config/season');

const { act, createElement: h } = React;
type ReactElement = import('react').ReactElement;

/** Typisch deutsche Wörter/Zeichen – nichts davon darf im englischen Text stehen. */
const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|für|ist|wird|noch|heute|allzeit|Platz|Plätze|Bilanz|Punkte|Pkt|Tore|Spiele|Spieltag|Siege|Sieg|Niederlage|Niederlagen|Remis|Rangliste|Gewertet|gewertet|Runde|Wähle|Elf|Meister|Abpfiff|Anpfiff|Tabelle|Stärke|Heimspiel|Teilen|Speichern|Mannschaft|wählen|Team-Score|Teamname|Legendäre|Saison|Modus|Aus|An|Standard)\b/;

/** Alle festen deutschen Texte eines Katalog-Bereichs (rekursiv), die sich vom Englischen unterscheiden. */
function germanStrings(deNs: unknown, enNs: unknown, minLength = 5): string[] {
  if (typeof deNs === 'string') return deNs !== enNs && deNs.length >= minLength ? [deNs] : [];
  if (!deNs || typeof deNs !== 'object' || Array.isArray(deNs)) return [];
  return Object.entries(deNs).flatMap(([k, v]) => germanStrings(v, (enNs as Record<string, unknown>)?.[k], minLength));
}
/** Alle festen englischen Texte – ein deutscher Text, der auch auf Englisch so heißt („Pause"), zählt nicht. */
function allStrings(ns: unknown): string[] {
  if (typeof ns === 'string') return [ns];
  if (!ns || typeof ns !== 'object') return [];
  return Object.values(ns).flatMap(allStrings);
}
const ENGLISH = new Set([...allStrings(en.challenge), ...allStrings(en.result), ...allStrings(en.errors)]);
const OWN_GERMAN = [
  ...germanStrings(de.challenge, en.challenge),
  ...germanStrings(de.result, en.result),
  ...germanStrings(de.errors, en.errors),
].filter((s) => !ENGLISH.has(s));
/** Deutsche Vereinsnamen, die es auf Englisch anders gibt */
const GERMAN_CLUBS = CLUB_NAMES.filter((n) => en.game.club(n) !== n);

const DATA = engine.createEngineData(ALL);
const SCALE = buildScale(ALL, 'all');

/** Spielt einen Run automatisch: erster wählbarer Kandidat, erster freier Slot. */
function autoPlay(config: import('../src/lib/challengeEngine').RunConfig) {
  let s = engine.startRun(config, DATA);
  while (!engine.isComplete(s)) {
    const pick =
      engine.MODE_RULES[config.challenge].roll === 'pokemon'
        ? DATA.byId.get(s.roll!.pokemonId!)!
        : engine.candidates(s, DATA).filter((p) => !engine.legendBlocked(s, p, DATA))[0];
    let slot = s.slots.findIndex((_, i) => engine.isFreeSlot(s, i));
    if (slot < 0) slot = engine.SS_SLOT;
    s = engine.place(s, pick.id, slot, DATA);
  }
  return s;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch: Pokémon-Daten echt, Backend nicht erreichbar */
function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      throw new TypeError('Failed to fetch');
    }),
  );
}

/** Gespeicherte Einstellungen vorgeben, so wie src/state/Settings.tsx sie liest */
function storeLang(lang: 'de' | 'en') {
  localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang }));
}

/** Spieler- und Teamname vorgeben (beides Pflicht für den Start), so wie Hook und runFinish sie lesen */
function storeNames(storageId: string, player = 'Ash', teamName = 'Pallet Power') {
  localStorage.setItem('pokemon-elf:player-name', JSON.stringify(player));
  localStorage.setItem(`pokemon-elf:run:${storageId}`, JSON.stringify({ v: 2, phase: 'setup', setup: { teamName } }));
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

/** Ausstehende fetch-Antworten und Effekte abarbeiten */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

/** Sichtbarer Text plus Text-Attribute (aria-label, aria-valuetext, title, alt, placeholder) */
function allText(el: MiniElement): string {
  const attrs = ['aria-label', 'aria-valuetext', 'title', 'alt', 'placeholder'].flatMap((a) =>
    el.querySelectorAll(`[${a}]`).map((e) => e.getAttribute(a) ?? ''),
  );
  return [el.textContent, ...attrs].join('\n');
}

function expectEnglish(text: string) {
  expect(text).not.toMatch(GERMAN);
  for (const s of OWN_GERMAN) expect(text).not.toContain(s);
  for (const club of GERMAN_CLUBS) expect(text).not.toContain(club);
}

const button = (el: MiniElement, label: string) => {
  const b = el.querySelectorAll('button').find((x) => x.textContent === label);
  if (!b) throw new Error(`Button „${label}" fehlt`);
  return b;
};

async function click(el: MiniElement) {
  await act(async () => el.click());
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  vi.stubGlobal('scrollTo', () => {});
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setCurrentLang('de');
});

describe('Texte außerhalb von React (Englisch)', () => {
  beforeEach(() => setCurrentLang('en'));

  it('Abschluss- und Startfehler', () => {
    const rate = new ApiRequestError('Too many runs in a short time – please try again later', 429, 'rate_limited');
    const texts = [
      finishErrorMessage(new ApiRequestError('Server unreachable', 0, 'network')),
      finishErrorMessage(new ApiRequestError('This run has already been ranked', 409, 'token_used')),
      finishErrorMessage(rate),
      finishErrorMessage(new Error('Boom')),
      JSON.stringify(startFailure(rate, 'auto')),
      JSON.stringify(startFailure(new ApiRequestError('Server unreachable', 0, 'network'), 'ask')),
    ];
    for (const text of texts) expectEnglish(text);
    expect(texts[3]).toBe('Couldn’t finish the run: Boom');
    expect(texts[2]).toMatch(/^Too many runs in a short time – please try again later\. Your run hasn’t been ranked yet/);
  });

  it('Engine-Fehler über den Code: englisch mit englischem Pokémon-Namen, deutsch unverändert', () => {
    const s0 = engine.startRun({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 7 }, DATA);
    const p = engine.candidates(s0, DATA).filter((x) => !engine.legendBlocked(s0, x, DATA))[0];
    const s1 = engine.place(s0, p.id, 0, DATA);
    const err = (() => {
      try {
        engine.place(s1, p.id, 1, DATA);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(engine.EngineError);
    expect(engineErrorText(err, DATA.byId)).toBe(`${p.en} is already in the team`);
    setCurrentLang('de');
    expect(engineErrorText(err, DATA.byId)).toBe((err as Error).message);
    expect(engineErrorText(err, DATA.byId)).toBe(`${p.de} steht schon im Team`);
  });

  it('Torschützen: Standard heißt „set piece"', () => {
    const name = (id: number) => DATA.byId.get(id)!.en;
    expect(scorerSummary([{ pokemonId: 6, pos: 'ST' }, { pokemonId: 6, pos: 'ST' }, { pokemonId: 25, pos: 'SS' }], name)).toBe(
      'Charizard 2×, Pikachu (set piece)',
    );
  });

  it('Server-Fehler (deutsch, mit Code) werden übersetzt; ohne Server „Server unreachable"', async () => {
    const answers = [
      json(409, {
        error: 'already_played',
        message: "Die Tägliche Elf vom 12.10.2026 hast du schon gespielt – morgen gibt's eine neue!",
      }),
      json(429, { error: 'rate_limited', message: 'Zu viele neue Geräte von dieser Verbindung – bitte in einer Stunde erneut versuchen' }),
      json(422, { error: 'invalid_run', message: 'Ungültiger Run (Runde 3): Glurak passt nicht zum Wurf' }),
      new Response('nope', { status: 429 }),
      json(418, { error: 'teapot', message: 'Ich bin eine Teekanne' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift() ?? Promise.reject(new TypeError('Failed to fetch'))));
    const messages: string[] = [];
    for (let i = 0; i < 6; i++) messages.push(await apiStartRun('daily').then(() => 'ok', (e: Error) => e.message));
    expect(messages).toEqual([
      'You’ve already played the Daily XI for Oct 12, 2026 – there’s a new one tomorrow!',
      'Too many new devices from this connection – please try again in an hour',
      'Invalid run (round 3)',
      'Too many requests in a short time – please try again later',
      // Unbekannter Code: Meldung des Servers bleibt
      'Ich bin eine Teekanne',
      'Server unreachable',
    ]);
  });

  it('Deutsch: Server-Meldungen bleiben unverändert', async () => {
    setCurrentLang('de');
    const msg = "Die Tägliche Elf vom 12.10.2026 hast du schon gespielt – morgen gibt's eine neue!";
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'already_played', message: msg })));
    await expect(apiStartRun('daily')).rejects.toThrow(msg);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    await expect(fetchLeaderboard('c340', 'all')).rejects.toThrow('HTTP 503');
  });

  it('Offline-Abschluss: Hinweis englisch und als Code gemerkt', async () => {
    const state = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 11 });
    const out = await finishRun({ state, teamName: '', token: null, day: null, byId: DATA.byId, scale: SCALE });
    expect(out.ranking).toMatchObject({ status: 'offline', message: 'Played offline – not ranked', note: 'played_offline' });
  });
});

describe('34–0 Challenge auf Englisch', () => {
  it('Setup, Spielfeld, Ergebnis per Ticker und Saisonbilanz ohne Deutsch', async () => {
    storeLang('en');
    storeNames('c340');
    stubFetch();
    const el = await render(app(h(Challenge340)));
    await settle();

    // Setup
    let text = allText(el);
    expectEnglish(text);
    expect(text).toContain('34–0 Challenge');
    expect(text).toContain('All 1,025 Pokémon. Can you go 34–0?');
    expect(text).toContain('How it works');
    expect(text).toContain('Set-piece taker');
    expect(text).toContain('e.g. Dynamo Mahogany');
    expect(text).toContain('Your name on the leaderboard');
    expect(text).toContain('Team name');
    expect(text).toContain('Offline – runs are only saved on this device');

    // Start (Backend weg → lokaler Run)
    await click(button(el, 'Start run'));
    await settle();
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Round 1/11');
    expect(text).toContain('Legendaries 0/2');
    expect(text).toMatch(/Reroll type \(1×\)/);
    expect(text).toContain('Pick a Pokémon that matches the region and type.');
    expect(text).toContain('Abandon run');

    // Kandidat wählen
    const card = el.querySelectorAll('button.pcard')[0];
    await click(card);
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain(' selected. Click a free spot on the pitch to lock it in.');
  });

  it('fertige Elf → Ticker → Saisonbilanz', async () => {
    storeLang('en');
    storeNames('c340');
    stubFetch();
    const engineState = autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: true, seed: 99 });
    localStorage.setItem(
      'pokemon-elf:run:c340',
      JSON.stringify({
        v: 2,
        phase: 'play',
        setup: { challenge: 'c340', formation: '4-3-3', ssEnabled: true, teamName: 'Pallet Power' },
        engine: engineState,
        token: null,
        day: null,
        online: false,
        result: null,
      }),
    );
    const el = await render(app(h(Challenge340)));
    await settle();
    let text = allText(el);
    expectEnglish(text);
    expect(text).toContain('All spots filled');
    expect(text).toContain('Your XI is ready. Time for the season!');

    await click(button(el, 'See result'));
    await settle();
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Season ticker');
    expect(text).toContain('Pallet Power');
    expect(text).toContain('Kick-off');

    await click(button(el, 'Skip'));
    await settle();
    text = allText(el);
    expectEnglish(text);
    for (const s of ['Season summary · 34–0 Challenge', 'Final table', 'Top scorers', 'Wins – Draws – Defeats', 'Played offline – not ranked']) {
      expect(text).toContain(s);
    }
    expect(text).toMatch(/Positions by weight: GK 1\.6 · ST 1\.4 · CB\/AM 1\.2 · DM 1\.1 · others 1\.0/);
    expect(text).toMatch(/Season details – all 34 matches/);
  });
});

describe('34–0 Challenge auf Deutsch (unverändert)', () => {
  it('Setup und Spielfeld', async () => {
    storeLang('de');
    storeNames('c340');
    stubFetch();
    const el = await render(app(h(Challenge340)));
    await settle();
    let text = allText(el);
    for (const s of [
      'Alle 1.025 Pokémon. Schaffst du 34–0?',
      "So funktioniert's",
      'Jede Runde würfelt eine Region und einen Typ. Setze ein passendes Pokémon auf einen freien Platz, mit höchstens 2 Legendären.',
      'Standardschütze',
      'Dein Name auf der Rangliste',
      'Teamname',
      'z. B. Ash',
      'z. B. Dynamo Mahagonia',
      'Offline – Runs werden nur lokal gespeichert',
    ]) {
      expect(text).toContain(s);
    }
    await click(button(el, 'Run starten'));
    await settle();
    text = allText(el);
    for (const s of ['Runde 1/11', 'Legendäre 0/2', 'Typ neu würfeln (1×)', 'Region neu würfeln (1×)', 'Run abbrechen']) {
      expect(text).toContain(s);
    }
    expect(text).toContain('Wähle ein Pokémon, das zu Region und Typ passt. Festgelegte Spieler bleiben stehen.');
    await click(el.querySelectorAll('button.pcard')[0]);
    expect(el.textContent).toContain(' gewählt. Klicke auf einen freien Platz auf dem Feld, um ihn festzulegen.');
  });
});

describe('151 Challenge auf Englisch', () => {
  it('Setup und gewürfeltes Pokémon', async () => {
    storeLang('en');
    storeNames('c151');
    stubFetch();
    const el = await render(app(h(Challenge151)));
    await settle();
    let text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Mode');
    expect(text).toContain('Only the original 151.');

    await click(button(el, 'Start run'));
    await settle();
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Your Pokémon');
    expect(text).toContain('Reroll Pokémon (5)');
    expect(text).toContain('Click a free spot on the pitch to lock in ');
    expect(text).toContain('Original 151');
  });
});

describe('Saisonbilanz und Ticker', () => {
  const input = {
    formation: '4-3-3' as const,
    slots: autoPlay({ challenge: 'c340', formation: '4-3-3', ssEnabled: false, seed: 5 }).slots,
    teamName: '',
    seed: 1234,
  };

  const resultView = (lang: 'de' | 'en') => {
    storeLang(lang);
    stubFetch();
    return render(
      app(
        h(SeasonResultView, {
          challenge: 'c340',
          input,
          scaleKind: 'all',
          sprite: 'pixel',
          entryId: null,
          onNewRun: () => {},
          ranking: { status: 'ranked', entryId: 'e1', rankToday: 2, rankAllTime: 13, day: '2026-10-12', message: null },
          stats: { bestScore: 700, bestRecord: { w: 20, d: 5, l: 9 }, runs: 3 },
        }),
      ),
    );
  };

  it('Spielwiedergabe: Ergebnis öffnet den Bericht; „Aus“ macht die Ergebnisse wieder zu Text', async () => {
    const el = await resultView('de');
    await settle();
    const buttons = () => el.querySelectorAll('.match__score--btn');
    expect(buttons().length).toBe(34);
    await act(async () => (buttons()[0] as unknown as { click(): void }).click());
    await settle();
    expect(allText(document.body as never)).toContain('Spielbericht');
    // 2D-Ansicht: Tempo schaltet 1× → 2× → 4× → 1×
    const rate = () => document.body.querySelector('.match-pitch__rate') as unknown as { click(): void; textContent: string };
    expect(rate().textContent).toBe('1×');
    for (const next of ['2×', '4×', '1×']) {
      await act(async () => rate().click());
      expect(rate().textContent).toBe(next);
    }
    // „⏭ Tor“: springt vor das nächste Tor; nach dem letzten ist der Knopf aus
    const skip = () => document.body.querySelector('.match-pitch__skip') as unknown as { click(): void; getAttribute(n: string): string | null };
    const goals = (buttons()[0] as unknown as { textContent: string }).textContent.split(':').reduce((n, x) => n + Number(x), 0);
    let jumps = 0;
    while (skip().getAttribute('disabled') == null && jumps < 20) {
      await act(async () => skip().click());
      jumps++;
    }
    expect(goals).toBeGreaterThan(0);
    expect(document.body.querySelectorAll('.match-pitch__mark')).toHaveLength(goals);
    expect(jumps).toBe(goals);
    // Tastatur: Leertaste schaltet Abspielen/Pause
    const play = () => document.body.querySelector('.match-pitch__controls .btn') as unknown as { textContent: string };
    const key = (k: string) =>
      act(async () => {
        window.dispatchEvent(Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key: k }) as unknown as Event);
      });
    expect(play().textContent).toBe('Pause');
    await key(' ');
    expect(play().textContent).toBe('Abspielen');
    await key(' ');
    expect(play().textContent).toBe('Pause');
    // Dialog zu, Wiedergabe ausschalten
    const close = document.body.querySelector('.modal .icon-btn') as unknown as { click(): void };
    await act(async () => close.click());
    const off = el.querySelectorAll('.replay-toggle [role="radio"]').find((b) => b.textContent === 'Aus') as unknown as { click(): void };
    await act(async () => off.click());
    expect(buttons()).toHaveLength(0);
  });

  it('Englisch: keine deutschen Texte, Vereine übersetzt, Ordnungszahlen', async () => {
    const el = await resultView('en');
    await settle();
    const text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Ranked online · 2nd today · 13th all-time');
    expect(text).toContain('Leaderboard');
    expect(text).toContain('New run');
    expect(text).toContain('Best record');
    expect(el.querySelector('.result-hero__record')?.getAttribute('aria-label')).toMatch(/^Record: \d+ wins?, \d+ draws?, \d+ defeats?$/);
    expect(el.querySelectorAll('.match__outcome').every((o) => ['W', 'D', 'L'].includes(o.textContent))).toBe(true);
  });

  it('Englisch: ältere gespeicherte Ergebnisse (nur deutsche Meldung, ohne note) zeigen den Hinweis englisch', async () => {
    storeLang('en');
    stubFetch();
    const legacy = (message: string) =>
      h(SeasonResultView, {
        challenge: 'c340',
        input,
        scaleKind: 'all',
        sprite: 'pixel',
        entryId: null,
        onNewRun: () => {},
        ranking: { status: 'offline', entryId: null, rankToday: null, rankAllTime: null, day: null, message },
      });
    const el = await render(app(h('div', null, legacy(de.challenge.playedOffline), legacy(de.challenge.unreachableNotRanked))));
    await settle();
    const notes = el.querySelectorAll('.result-ranking').map((n) => n.textContent);
    expect(notes).toEqual(['Played offline – not ranked', 'Server unreachable – run not ranked']);
    expectEnglish(allText(el));
  });

  it('Deutsch: Texte wie bisher', async () => {
    const el = await resultView('de');
    await settle();
    const text = el.textContent;
    for (const s of [
      'Saisonbilanz · 34–0 Challenge',
      'Online gewertet · Platz 2 heute · Platz 13 allzeit',
      'Siege – Remis – Niederlagen',
      'Abschlusstabelle',
      'Torschützenliste',
      'Positionen nach Gewicht: TW 1,6 · ST 1,4 · IV/OM 1,2 · DM 1,1 · übrige 1,0',
      'Schwachstellen laut Scouting: ',
      'Meine Elf',
      'Neuer Run',
    ]) {
      expect(text).toContain(s);
    }
    expect(el.querySelectorAll('.match__outcome').every((o) => ['S', 'U', 'N'].includes(o.textContent))).toBe(true);
  });

  it('Ticker: Anpfiff, Spieltage und Abpfiff auf Englisch', async () => {
    vi.useFakeTimers();
    storeLang('en');
    const run = computeRun(input, DATA.byId, SCALE);
    const onDone = vi.fn();
    const el = await render(
      h(SettingsProvider, null, h(SeasonTicker, { season: run.season, teamName: 'My XI', sprite: 'pixel', byId: DATA.byId, onDone })),
    );
    /** n Ticker-Schritte (je ein Timer, der erst nach dem Rendern neu gesetzt wird) */
    const steps = async (n: number, ms = 700) => {
      for (let i = 0; i < n; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      }
    };
    let text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Kick-off! The season is under way.');
    expect(text).toContain('Goal: 34–0 – win every match');

    await steps(5);
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Table after matchday 5');
    expect(text).toMatch(/Matchday 5: (Win|Draw|Defeat) \d+:\d+ (v|at) /);
    expect(text).toContain('5 of 34 matchdays played');

    await steps(30);
    text = allText(el);
    expectEnglish(text);
    expect(text).toContain('Full time!');
    expect(text).toContain('See season summary');
    expect(text).toMatch(/Full time! Season record \d+–\d+–\d+, \d+ points?, \d+(st|nd|rd|th) place\./);
    await steps(1, 2000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
