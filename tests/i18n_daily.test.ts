/**
 * Übersetzung von Tägliche Elf und Rangliste: Mit Englisch als gespeicherter Sprache stehen
 * auf den Seiten keine deutschen Texte mehr (Spielernamen bleiben, wie sie sind), Teil-Text
 * und Datumsangaben folgen der Sprache. Deutsch bleibt unverändert (siehe daily.test.ts).
 * Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom();
// React-DOM und alles mit UI erst nach dem Mini-DOM laden (React prüft beim Laden, ob es ein DOM gibt)
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { Leaderboard } = await import('../src/pages/Leaderboard');
const { Daily } = await import('../src/pages/Daily');
const { de } = await import('../src/i18n/de');
const { en } = await import('../src/i18n/en');
const { setCurrentLang } = await import('../src/i18n/lang');
const { dayKey } = await import('../src/lib/daily');
const { buildDailyShareText, formatDayLong, weekdayName } = await import('../src/lib/dailyShare');
const { CHALLENGE_LABEL } = await import('../src/lib/leaderboard');
const engine = await import('../src/lib/challengeEngine');
const { dailyRunSeed } = await import('../src/lib/daily');
const { CLUB_NAMES } = await import('../src/config/season');

const { act, createElement: h } = React;
type ReactElement = import('react').ReactElement;

/** Typisch deutsche Wörter/Zeichen – nichts davon darf im englischen Text stehen. */
const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|für|ist|wird|noch|heute|Heute|Allzeit|Platz|Bilanz|Punkte|Pkt|Spieler|Rangliste|Tagesrangliste|Gerät|Geräts|Lade|Speichern|Verbindung|gewertet|Gewertet|Würfe|Versuch|Elf|Spieltag|Mannschaft|wählen|Team-Score|Tägliche|Montag|Dienstag)\b/;

/**
 * Alle festen deutschen Texte eines Katalog-Bereichs, die sich vom Englischen unterscheiden
 * (ab minLength Zeichen – kurze Wörter wie „Bilanz" kommen auch in fremden Bausteinen vor).
 */
function germanStrings(deNs: Record<string, unknown>, enNs: Record<string, unknown>, minLength = 4): string[] {
  return Object.entries(deNs)
    .filter(([k, v]) => typeof v === 'string' && v !== enNs[k] && v.length >= minLength)
    .map(([, v]) => v as string);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const row = (over: Record<string, unknown>) => ({
  rank: 1,
  entryId: 'e1',
  player: 'Ash',
  teamName: 'Pallet Power',
  record: { w: 30, d: 2, l: 2 },
  points: 92,
  score: 812,
  formation: '4-3-3',
  createdAt: '2026-10-13T08:00:00.000Z',
  day: dayKey(),
  me: false,
  ...over,
});

/** fetch: Pokémon-Daten, Health ok, Rangliste nach Vorgabe */
function stubFetch(leaderboard: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.endsWith('data/forms.json')) return json(200, []);
      if (url.includes('/api/health')) return json(200, { ok: true, version: 1, day: dayKey() });
      if (url.includes('/api/leaderboard')) return leaderboard();
      throw new TypeError('Failed to fetch');
    }),
  );
  return calls;
}

/** Gespeicherte Einstellungen vorgeben, so wie src/state/Settings.tsx sie liest */
function storeLang(lang: 'de' | 'en') {
  localStorage.clear();
  localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang }));
}

/** Spieler- und Teamname vorgeben (beides Pflicht für den Start) */
function storeNames(player = 'Ash', teamName = 'Pallet Power') {
  localStorage.setItem('pokemon-elf:player-name', JSON.stringify(player));
  localStorage.setItem('pokemon-elf:run:daily', JSON.stringify({ v: 2, phase: 'setup', setup: { teamName } }));
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

/** Text-Attribute (aria-label, title, alt, placeholder) aller Elemente */
function attrsOf(el: MiniElement): string[] {
  return el
    .querySelectorAll('[aria-label]')
    .map((e) => e.getAttribute('aria-label') ?? '')
    .concat(el.querySelectorAll('[title]').map((e) => e.getAttribute('title') ?? ''))
    .concat(el.querySelectorAll('[placeholder]').map((e) => e.getAttribute('placeholder') ?? ''));
}

beforeEach(() => {
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setCurrentLang('de');
});

describe('Tägliche Elf: Texte außerhalb von React', () => {
  const base = {
    day: '2026-10-12',
    number: 1,
    record: { w: 34, d: 0, l: 0 },
    points: 102,
    score: 905,
    position: 1,
    outcomes: Array(34).fill('S') as 'S'[],
    url: 'https://pokemon-elf.example/taeglich',
  };

  it('Teil-Text auf Englisch – Emoji-Raster und Link bleiben', () => {
    setCurrentLang('en');
    const lines = buildDailyShareText(base).split('\n');
    expect(lines[0]).toBe('Pokémon Elf · Daily XI #1 (Oct 12, 2026)');
    expect(lines[1]).toBe('34–0–0 · 102 pts · Score 905 · 1st place 🏆');
    expect(lines[2]).toBe('🟩'.repeat(17));
    expect(lines[3]).toBe('🟩'.repeat(17));
    expect(lines[4]).toBe(base.url);
    expect(buildDailyShareText({ ...base, position: 12 }).split('\n')[1]).toContain('12th place');
    expect(buildDailyShareText({ ...base, position: 23 }).split('\n')[1]).toContain('23rd place');
  });

  it('ausdrücklich übergebene Sprache gewinnt; Deutsch unverändert', () => {
    setCurrentLang('en');
    expect(buildDailyShareText(base, de).split('\n')[0]).toBe('Pokémon Elf · Tägliche Elf #1 (12.10.2026)');
    setCurrentLang('de');
    expect(buildDailyShareText(base, en).split('\n')[1]).toBe('34–0–0 · 102 pts · Score 905 · 1st place 🏆');
    expect(formatDayLong('2026-10-12')).toBe('Montag, 12.10.2026');
  });

  it('Wochentag und langes Datum auf Englisch', () => {
    setCurrentLang('en');
    expect(weekdayName('2026-10-12')).toBe('Monday');
    expect(weekdayName('2026-10-18')).toBe('Sunday');
    expect(formatDayLong('2026-10-17')).toBe('Saturday, Oct 17, 2026');
  });

  it('CHALLENGE_LABEL folgt der aktiven Sprache', () => {
    expect(CHALLENGE_LABEL.daily).toBe('Tägliche Elf');
    setCurrentLang('en');
    expect(CHALLENGE_LABEL.daily).toBe('Daily XI');
    expect(Object.keys(CHALLENGE_LABEL)).toEqual(['c340', 'daily', 'retro340', 'c151']);
  });
});

describe('Rangliste auf Englisch', () => {
  it('Online-Tabelle samt eigener Zeile: kein Deutsch, Spielernamen unverändert', async () => {
    storeLang('en');
    stubFetch(() =>
      json(200, {
        challenge: 'c340',
        period: 'all',
        day: dayKey(),
        players: 1234,
        rows: [row({}), row({ rank: 2, entryId: 'e2', player: 'Brock', teamName: '' })],
        mine: row({ rank: 77, entryId: 'e3', player: 'Misty', teamName: 'Cerulean', me: true }),
      }),
    );
    const c = await render(app(h(Leaderboard)));
    await settle();
    const text = c.textContent;
    expect(text).toContain('Leaderboard');
    expect(text).toContain('All time · 1,234 players');
    expect(text).toContain('Your position');
    expect(text).toContain('Ash');
    expect(text).toContain('Misty');
    expect(text).toContain('Online leaderboard');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
    for (const a of attrsOf(c)) expect(a.match(GERMAN)?.[0] ?? null, a).toBeNull();
    for (const s of germanStrings(de.leaderboard, en.leaderboard)) expect(text).not.toContain(s);
  });

  it('Fehler der API: englischer Text zum Code statt der deutschen Meldung', async () => {
    storeLang('en');
    stubFetch(() => json(429, { error: 'rate_limited', message: 'Zu viele Anfragen in kurzer Zeit' }));
    const c = await render(app(h(Leaderboard)));
    await settle();
    const text = c.textContent;
    expect(text).toContain('Leaderboard unavailable: Too many requests in a short time');
    expect(text).toContain('Try again');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
  });

  it('Fehler ohne Meldung (503 vom CDN) und ohne Server: englisch, Status bleibt', async () => {
    storeLang('en');
    stubFetch(() => new Response('<html>down</html>', { status: 503 }));
    const c = await render(app(h(Leaderboard)));
    await settle();
    expect(c.textContent).toContain('Leaderboard unavailable: Request failed (HTTP 503)');
    expect(c.textContent.match(GERMAN)?.[0] ?? null, c.textContent).toBeNull();
    // Übersetzung beim Anzeigen: auch eine deutsch gespeicherte Meldung erscheint englisch
    expect(en.leaderboard.apiError('network', 'Server nicht erreichbar')).toBe('Server unreachable');
    expect(en.leaderboard.apiError('server_error', 'HTTP 502')).toBe('Request failed (HTTP 502)');
    expect(en.leaderboard.apiError('teapot', 'Ich bin eine Teekanne')).toBe('Ich bin eine Teekanne');
    expect(de.leaderboard.apiError('rate_limited', 'Zu viele Anfragen')).toBe('Zu viele Anfragen');
  });

  it('Deutsch: die Meldung des Servers bleibt wörtlich', async () => {
    storeLang('de');
    stubFetch(() => json(429, { error: 'rate_limited', message: 'Zu viele Anfragen in kurzer Zeit' }));
    const c = await render(app(h(Leaderboard)));
    await settle();
    expect(c.textContent).toContain('Rangliste nicht erreichbar: Zu viele Anfragen in kurzer Zeit');
    expect(c.textContent).toContain('Pro Spieler zählt der beste Run – sortiert nach Punkten, dann Team-Score.');
  });
});

describe('Tägliche Elf auf Englisch', () => {
  it('heute schon gespielt: Kopf, Platzierung und Hinweise ohne Deutsch', async () => {
    storeLang('en');
    stubFetch(() =>
      json(200, {
        challenge: 'daily',
        period: 'today',
        day: dayKey(),
        players: 1,
        rows: [],
        mine: row({ rank: 3, player: 'Misty', teamName: 'Cerulean', me: true }),
      }),
    );
    const c = await render(app(h(Daily)));
    await settle();
    const done = c.querySelector('.daily-done');
    expect(done, c.textContent).not.toBeNull();
    const head = c.querySelector('.daily-head')!.textContent;
    const mine = `${head} ${done!.textContent}`;
    expect(head).toContain('Daily XI #');
    expect(head).toContain('New XI in');
    expect(mine).toContain('Already played today');
    expect(mine).toContain('3rd');
    // Ein einziger Spieler: kein „top n%"
    expect(c.querySelector('.daily-done__top')).toBeNull();
    expect(mine).toContain('1 player today · your team: Cerulean');
    expect(mine).toContain('Today’s leaderboard');
    expect(mine.match(GERMAN)?.[0] ?? null, mine).toBeNull();
    // Keiner der deutschen Sätze dieses Bereichs steht irgendwo auf der Seite
    for (const s of germanStrings(de.daily, en.daily, 12)) expect(c.textContent).not.toContain(s);
    expect(c.textContent).toContain(en.daily.howTo);
    // Auch die gemeinsamen Bausteine (Bestwerte, So funktioniert's) sind übersetzt
    expectNoGerman(c);
  });

  it('Deutsch bleibt wörtlich wie bisher', async () => {
    storeLang('de');
    stubFetch(() =>
      json(200, {
        challenge: 'daily',
        period: 'today',
        day: dayKey(),
        players: 1234,
        rows: [],
        mine: row({ rank: 3, player: 'Misty', teamName: 'Cerulean', me: true }),
      }),
    );
    const c = await render(app(h(Daily)));
    await settle();
    const text = c.textContent;
    expect(text).toContain('Heute schon gespielt');
    expect(text).toContain('Neue Elf in');
    expect(text).toContain('Morgen gibt es neue Würfe – wieder für alle dieselben.');
    expect(text).toContain('1.234 Spieler heute · dein Team: Cerulean');
    expect(c.querySelector('.daily-done__facts')!.textContent).toContain('Platz3.');
    // 3. von 1.234 → Top 1 %
    expect(c.querySelector('.daily-done__top')!.textContent).toBe(' Top 1 %');
  });
});

/** fetch: nur die Pokémon-Daten – das Backend ist nicht erreichbar */
function stubOffline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.endsWith('data/forms.json')) return json(200, []);
      throw new TypeError('Failed to fetch');
    }),
  );
}

/** Ganze Seite (Text + Text-Attribute) ohne Deutsch – die Marke „Pokémon Elf" ausgenommen */
function expectNoGerman(c: MiniElement) {
  const GERMAN_CLUBS = CLUB_NAMES.filter((n) => en.game.club(n) !== n);
  for (const s of [c.textContent, ...attrsOf(c)]) {
    const text = s.replaceAll('Pokémon Elf', '');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
    for (const club of GERMAN_CLUBS) expect(text).not.toContain(club);
  }
  for (const s of germanStrings(de.daily, en.daily, 12)) expect(c.textContent).not.toContain(s);
}

const buttonByText = (c: MiniElement, label: string) => {
  const b = c.querySelectorAll('button').find((x) => x.textContent === label);
  if (!b) throw new Error(`Button „${label}" fehlt: ${c.textContent}`);
  return b;
};

describe('Tägliche Elf auf Englisch – ganze Seite', () => {
  beforeEach(() => {
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

  it('Setup ohne Server → Startfehler → offline spielen', async () => {
    storeLang('en');
    storeNames();
    stubOffline();
    const c = await render(app(h(Daily)));
    await settle();
    expectNoGerman(c);
    expect(c.textContent).toContain('How it works');
    expect(c.textContent).toContain('Best score');
    expect(c.textContent).toContain('with no more than 2 Legendaries');

    // Der Start prüft den Server neu (das Ergebnis früherer Tests ist zwischengespeichert)
    await act(async () => buttonByText(c, 'Start run').click());
    await settle();
    expectNoGerman(c);
    expect(c.textContent).toContain('No connection to the server – your run hasn’t started yet.');

    await act(async () => buttonByText(c, 'Play offline (unranked – uses today’s attempt)').click());
    await settle();
    expectNoGerman(c);
    expect(c.textContent).toContain('Round 1/11');
    expect(c.textContent).toContain('Legendaries 0/2');
    expect(c.textContent).toContain('Offline');
  });

  it('fertige Elf → Saisonbilanz mit Kopfzeile und Teil-Text', async () => {
    storeLang('en');
    localStorage.setItem('pokemon-elf:player-name', JSON.stringify('Ash'));
    stubOffline();
    const data = engine.createEngineData(ALL);
    const today = dayKey();
    let s = engine.startRun({ challenge: 'daily', formation: '4-3-3', ssEnabled: false, seed: dailyRunSeed(today) }, data);
    while (!engine.isComplete(s)) {
      const pick = engine.candidates(s, data).filter((p) => !engine.legendBlocked(s, p, data))[0];
      s = engine.place(s, pick.id, s.slots.findIndex((_, i) => engine.isFreeSlot(s, i)), data);
    }
    localStorage.setItem(
      'pokemon-elf:run:daily',
      JSON.stringify({
        v: 2,
        phase: 'play',
        setup: { challenge: 'daily', formation: '4-3-3', ssEnabled: false, teamName: 'Pallet Power' },
        engine: s,
        token: null,
        day: today,
        online: false,
        result: null,
      }),
    );
    const c = await render(app(h(Daily)));
    await settle();
    expectNoGerman(c);
    expect(c.textContent).toContain('Your XI is ready. Time for the season!');

    await act(async () => buttonByText(c, 'See result').click());
    await settle();
    const skip = c.querySelectorAll('button').find((x) => x.textContent === 'Skip');
    if (skip) {
      expectNoGerman(c);
      await act(async () => skip.click());
      await settle();
    }
    expectNoGerman(c);
    const text = c.textContent;
    expect(text).toContain(`Daily XI #`);
    expect(text).toContain('Offline – unranked');
    expect(text).toContain('Played offline – not ranked');
    expect(text).toMatch(/Share Daily XI #\d+/);
    expect(text).toMatch(/\d+–\d+–\d+ · \d+ pts · Score \d+ · \d+(st|nd|rd|th) place/);
    expect(text).toContain('Share result');
    expect(text).toContain('Today’s leaderboard');
    expect(text).toContain('Season summary · Daily XI');
    // Bei der Tagesaufgabe gibt es keinen „Neuer Run"-Knopf
    expect(text).not.toContain('New run');
  });
});
