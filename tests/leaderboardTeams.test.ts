/**
 * Rangliste: Teams ansehen. Jede Zeile (Top-Liste, eigene Zeile, Runs dieses Geräts) öffnet ihr
 * Team im Dialog – Kopfdaten, Spielfeld, Teamblatt und „Im Builder öffnen" (Share-Link ?elf=…).
 * Online kommt das Team per GET /api/entries/:id (Laden, 404, Fehler + erneut versuchen), lokale
 * Runs bringen es mit. Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryDetail, LeaderboardResponse, LeaderboardRow } from '../src/lib/api/contract';
import type { LeaderboardEntry } from '../src/lib/leaderboard';
import type { SpriteStyle } from '../src/types';
import { ALL } from './helpers';
import { installMiniDom, MiniElement, MiniEvent } from './miniDom';

const doc = installMiniDom();
// Texteingaben: React nimmt das input-Ereignis nur, wenn das DOM es kennt („oninput" in document).
(doc as unknown as Record<string, unknown>).oninput = null;
// React-DOM und alles mit UI erst nach dem Mini-DOM laden (React prüft beim Laden, ob es ein DOM gibt)
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Route, Routes } = await import('react-router-dom');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { Leaderboard } = await import('../src/pages/Leaderboard');
const { Builder } = await import('../src/pages/Builder');
const { setCurrentLang } = await import('../src/i18n/lang');
const { dayKey } = await import('../src/lib/daily');
const { decodeLineup, encodeLineup, URL_PARAM } = await import('../src/lib/urlState');
const { builderSearch, LINK_NAME_BYTES, localEntryDetail, parseEntryDetail } = await import('../src/lib/leaderboard/entryDetail');
const { LIMITS } = await import('../src/lib/api/contract');
const client = await import('../src/lib/api/client');
const engine = await import('../src/lib/challengeEngine');
const { handleApi } = await import('../server/handler');
const { D1Shim } = await import('./d1shim');

const { act, createElement: h } = React;
type ReactElement = import('react').ReactElement;

// ---------------------------------------------------------------- Daten

/** Standard-Elf des Builders (alles Gen 1, keine Legendären) + Arkani als Standardschütze */
const ELF = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];
const SS = 59;
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

const mon = (id: number) => ALL.find((p) => p.id === id)!;

const row = (over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  rank: 1,
  entryId: ID1,
  player: 'Ash',
  teamName: 'Pallet Power',
  record: { w: 30, d: 2, l: 2 },
  points: 92,
  score: 812,
  formation: '4-3-3',
  createdAt: '2026-10-12T08:00:00.000Z',
  day: '2026-10-12',
  me: false,
  ...over,
});

const detail = (over: Partial<EntryDetail> = {}): EntryDetail => ({
  entryId: ID1,
  challenge: 'c340',
  day: '2026-10-12',
  player: 'Ash',
  teamName: 'Pallet Power',
  formation: '4-3-3',
  slots: ELF,
  ss: SS,
  ssEnabled: true,
  record: { w: 30, d: 2, l: 2 },
  points: 92,
  score: 812,
  createdAt: '2026-10-12T08:00:00.000Z',
  ...over,
});

const BOARD: LeaderboardResponse = {
  challenge: 'c340',
  period: 'all',
  day: dayKey(),
  players: 3,
  rows: [row(), row({ rank: 2, entryId: ID2, player: 'Brock', teamName: '', formation: '4-4-2' })],
  mine: row({ rank: 77, entryId: ID3, player: 'Misty', teamName: 'Cerulean', me: true }),
};

const DETAILS: Record<string, EntryDetail> = {
  [ID1]: detail(),
  [ID2]: detail({ entryId: ID2, player: 'Brock', teamName: '', formation: '4-4-2', ssEnabled: false, ss: null }),
  [ID3]: detail({ entryId: ID3, player: 'Misty', teamName: 'Cerulean', ssEnabled: false, ss: null }),
};

const localEntry = (over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  id: 'local-1',
  challenge: 'c340',
  player: 'Ash',
  record: { w: 20, d: 5, l: 9 },
  points: 65,
  score: 700,
  formation: '4-3-3',
  lineup: [...ELF, SS],
  teamName: 'Alabastia',
  createdAt: new Date().toISOString(),
  ...over,
});

// ---------------------------------------------------------------- Umgebung

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** fetch: Pokémon-Daten, Health ok, Rangliste (Standard: BOARD), Teams nach Vorgabe (Standard: DETAILS) */
async function stubServer(
  entries: (id: string) => Response | Promise<Response> = (id) => json(200, DETAILS[id]),
  board: (n: number) => Response | Promise<Response> = () => json(200, BOARD),
) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.includes('/api/health')) return json(200, { ok: true, version: 1, day: dayKey() });
      if (url.includes('/api/player')) return json(200, { ok: true });
      if (url.includes('/api/leaderboard')) return board(calls.filter((u) => u.includes('/api/leaderboard')).length);
      const m = /\/api\/entries\/([^/?#]+)$/.exec(url);
      if (m) return entries(decodeURIComponent(m[1]));
      throw new TypeError('Failed to fetch');
    }),
  );
  await client.apiHealth(true); // zwischengespeicherten Health-Check an den neuen Stub anpassen
  return {
    calls,
    entryCalls: () => calls.filter((u) => u.includes('/api/entries/')),
    boardCalls: () => calls.filter((u) => u.includes('/api/leaderboard')).length,
  };
}

/** Kein Backend: nur die Pokémon-Daten laden */
async function stubOffline() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      throw new TypeError('Failed to fetch');
    }),
  );
  await client.apiHealth(true);
  return calls;
}

function storeSettings(lang: 'de' | 'en', sprite?: SpriteStyle) {
  localStorage.setItem('pokemon-elf:settings', JSON.stringify(sprite ? { lang, sprite } : { lang }));
}
function storeLocalRuns(entries: LeaderboardEntry[]) {
  localStorage.setItem('pokemon-elf:leaderboard', JSON.stringify(entries));
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

/** Die App wie in App.tsx: Builder unter „/", Rangliste unter „/rangliste" */
const app = () =>
  h(
    MemoryRouter,
    { initialEntries: ['/rangliste'] },
    h(
      SettingsProvider,
      null,
      h(
        ToastProvider,
        null,
        h(
          PokemonDataProvider,
          null,
          h(Routes, null, h(Route, { path: '/', element: h(Builder) }), h(Route, { path: '/rangliste', element: h(Leaderboard) })),
        ),
      ),
    ),
  );

async function click(el: MiniElement) {
  await act(async () => {
    el.click();
  });
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

/**
 * Wie im Browser: focus() auf einem Element, das nicht (mehr) im Dokument hängt, bewirkt nichts.
 * Das Mini-DOM setzt activeElement sonst trotzdem – ein verlorener Fokus fiele so nicht auf.
 */
function browserLikeFocus() {
  const focus = MiniElement.prototype.focus;
  vi.spyOn(MiniElement.prototype, 'focus').mockImplementation(function (this: MiniElement) {
    if (this.getRootNode() === doc) focus.call(this);
  });
}

/** Der Fokus steht auf einem Element im Dokument (nicht auf einem entfernten Knoten) */
const focusInDocument = () => doc.activeElement != null && doc.body.contains(doc.activeElement);

/** Taste am fokussierten Element (blubbert bis zum Dokument, wo der Dialog lauscht) */
async function press(key: string) {
  const ev = Object.assign(new MiniEvent('keydown', { bubbles: true, cancelable: true }), { key });
  await act(async () => {
    (doc.activeElement ?? doc.body).dispatchEvent(ev);
  });
}

const dialog = () => doc.querySelector('[role="dialog"]');
const teamButtons = (root: MiniElement) => root.querySelectorAll('button.lb-team');
const teamButton = (root: MiniElement, player: string) =>
  teamButtons(root).find((b) => b.closest('tr')?.querySelector('.lb-who__player')?.textContent === player)!;
const buttonByText = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent === text);
/** Name des Dialogs (aria-labelledby → Überschrift) */
const dialogName = (d: MiniElement) => doc.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent;
const sheetNames = (d: MiniElement) => d.querySelectorAll('.sheet__name strong').map((s) => s.textContent);
const builderHref = (d: MiniElement) => d.querySelectorAll('a').find((a) => (a.getAttribute('href') ?? '').includes(`${URL_PARAM}=`))?.getAttribute('href') ?? null;
const decodeHref = (href: string) => decodeLineup(new URLSearchParams(href.split('?')[1]).get(URL_PARAM)!, ALL.length);

/** Text-Attribute (aria-label, title) aller Elemente */
function attrsOf(el: MiniElement): string[] {
  return el
    .querySelectorAll('[aria-label]')
    .map((e) => e.getAttribute('aria-label') ?? '')
    .concat(el.querySelectorAll('[title]').map((e) => e.getAttribute('title') ?? ''));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('location', { protocol: 'https:', host: 'elf.example', origin: 'https://elf.example' });
  browserLikeFocus();
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setCurrentLang('de');
});

// ---------------------------------------------------------------- Bausteine ohne React

describe('EntryDetail aus lokalen Runs und vom Server', () => {
  it('lokaler Run: 11 Slots, Standardschütze nur als 12. Eintrag; Tag aus dem Zeitstempel (Berlin)', () => {
    const withSs = localEntryDetail(localEntry({ createdAt: '2026-10-12T22:30:00.000Z' }))!;
    expect(withSs).toMatchObject({
      entryId: 'local-1',
      challenge: 'c340',
      player: 'Ash',
      teamName: 'Alabastia',
      formation: '4-3-3',
      slots: ELF,
      ss: SS,
      ssEnabled: true,
      record: { w: 20, d: 5, l: 9 },
      points: 65,
      score: 700,
    });
    // 22:30 UTC ist in Berlin schon der nächste Tag – wie die Tageswertung
    expect(withSs.day).toBe('2026-10-13');

    const noSs = localEntryDetail(localEntry({ lineup: ELF }))!;
    expect(noSs.ssEnabled).toBe(false);
    expect(noSs.ss).toBeNull();
    expect(noSs.slots).toEqual(ELF);

    // leerer Standardschützen-Platz bleibt „mit Standardschütze"
    expect(localEntryDetail(localEntry({ lineup: [...ELF, null] }))).toMatchObject({ ssEnabled: true, ss: null });
  });

  it('kaputte lokale Daten: unbekannte Formation oder keine Liste → nicht lesbar; Unsinn im Slot → leer', () => {
    expect(localEntryDetail(localEntry({ formation: '9-9-9' as never }))).toBeNull();
    expect(localEntryDetail(localEntry({ lineup: 'kaputt' as never }))).toBeNull();
    expect(localEntryDetail(null as never)).toBeNull();
    const odd = localEntryDetail(localEntry({ lineup: [143, 'x' as never, -1, 2.5, null] }))!;
    expect(odd.slots).toEqual([143, null, null, null, null, null, null, null, null, null, null]);
    expect(odd.ssEnabled).toBe(false);
    expect(localEntryDetail(localEntry({ createdAt: 'gestern' }))!.day).toBe('');
  });

  it('Server-Antwort: Slots auf die Formation gebracht, ungültiger Tag → leer, interne Felder fallen weg', () => {
    const d = parseEntryDetail({ ...detail(), slots: [...ELF, 150, 151], day: '2026-02-30', seasonSeed: 1, deviceId: 'x' })!;
    expect(d.slots).toEqual(ELF);
    expect(d.day).toBe('');
    expect(Object.keys(d).sort()).toEqual(Object.keys(detail()).sort());
    expect(parseEntryDetail({ ...detail(), ss: 59, ssEnabled: 'ja' })).toMatchObject({ ssEnabled: false, ss: null });
  });

  it('Builder-Link: dieselbe Formation, Slots, Standardschütze und Teamname, Sprite des Nutzers', () => {
    const byId = new Map(ALL.map((p) => [p.id, p]));
    const search = builderSearch(detail(), 'retro', byId);
    expect(search.startsWith(`?${URL_PARAM}=`)).toBe(true);
    const shared = decodeHref(`/${search}`)!;
    expect(shared).toMatchObject({
      formation: '4-3-3',
      slots: ELF,
      ss: SS,
      ssEnabled: true,
      teamName: 'Pallet Power',
      sprite: 'retro',
      region: 1, // alle aus Gen 1
      legends: false,
    });

    // ohne Standardschütze: kein SS im Link, auch wenn einer gespeichert wäre
    expect(decodeHref(`/${builderSearch(detail({ ssEnabled: false, ss: 59 }), 'pixel', byId)}`)).toMatchObject({
      ssEnabled: false,
      ss: null,
      sprite: 'pixel',
    });

    // Legendäre im Team → Legendäre an; gemischte Generationen → alle Regionen
    const mixed = [...ELF.slice(0, 9), 150, 448];
    expect(mon(150).leg).toBe(1);
    expect(decodeHref(`/${builderSearch(detail({ slots: mixed, ssEnabled: false, ss: null }), 'artwork', byId)}`)).toMatchObject({
      slots: mixed,
      region: 0,
      legends: true,
      sprite: 'artwork',
    });
  });

  it('Builder-Link: Teamnamen bis LIMITS.teamNameMax Zeichen kommen vollständig an – auch über 40 Bytes', () => {
    const byId = new Map(ALL.map((p) => [p.id, p]));
    const bytes = (t: string) => new TextEncoder().encode(t).length;
    expect(LINK_NAME_BYTES).toBe(4 * LIMITS.teamNameMax);
    const names = [
      'Glühwürmchen-Größenwahn 🔥🔥🔥🔥', // 28 Zeichen, 44 Bytes
      'Ü'.repeat(19) + '🔥🔥', // 46 Bytes
      'Ü'.repeat(LIMITS.teamNameMax), // 64 Bytes
      '🔥'.repeat(LIMITS.teamNameMax), // 128 Bytes – das Maximum
      '👩‍👩‍👧'.repeat(6) + 'ab', // ZWJ-Sequenzen: 32 Codepoints, 110 Bytes
    ];
    for (const name of names) {
      expect([...name].length, name).toBeLessThanOrEqual(LIMITS.teamNameMax);
      expect(bytes(name), name).toBeGreaterThan(40);
      const shared = decodeHref(`/${builderSearch(detail({ teamName: name }), 'pixel', byId)}`)!;
      expect(shared.teamName).toBe(name);
    }
  });

  it('Builder-Link: überlange Namen (mehr als der Server erlaubt) werden auf ganze Zeichen gekürzt', () => {
    const byId = new Map(ALL.map((p) => [p.id, p]));
    const name = '🔥'.repeat(LIMITS.teamNameMax) + 'ÜÜ'; // 128 + 4 Bytes
    const shared = decodeHref(`/${builderSearch(detail({ teamName: name }), 'pixel', byId)}`)!;
    expect(shared.teamName).toBe('🔥'.repeat(LIMITS.teamNameMax));
    expect(shared.teamName).not.toContain('�');
  });

  it('encodeLineup: Standard bleibt 40 Bytes (Teilen aus dem Builder); maxNameBytes erlaubt mehr, decodeLineup liest beides', () => {
    const base = { formation: '4-3-3' as const, slots: ELF, ss: null, region: 0 as const, legends: false, ssEnabled: false, sprite: 'pixel' as const };
    const name = 'Glühwürmchen-Größenwahn 🔥🔥🔥🔥';
    const short = decodeLineup(encodeLineup({ ...base, teamName: name }), ALL.length)!;
    expect(new TextEncoder().encode(short.teamName).length).toBeLessThanOrEqual(40);
    expect(name.startsWith(short.teamName)).toBe(true);
    expect(short.teamName).not.toBe(name);
    const full = decodeLineup(encodeLineup({ ...base, teamName: name }, { maxNameBytes: LINK_NAME_BYTES }), ALL.length)!;
    expect(full).toEqual({ ...base, teamName: name });
  });
});

// ---------------------------------------------------------------- Online-Rangliste

describe('Rangliste: Team ansehen (online)', () => {
  it('jede Zeile – Top-Liste und eigene Platzierung – hat einen zugänglichen Team-Knopf', async () => {
    storeSettings('de');
    await stubServer();
    const c = await render(app());
    await settle();
    const buttons = teamButtons(c);
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Team ansehen: Pallet Power von Ash',
      'Team ansehen: Team von Brock',
      'Team ansehen: Cerulean von Misty',
    ]);
    expect(buttons.map((b) => b.textContent)).toEqual(['Pallet Power', 'Team ansehen', 'Cerulean']);
    // Label in Name (WCAG 2.5.3): Der zugängliche Name enthält den sichtbaren Text – „klicke Team ansehen" trifft
    for (const b of buttons) expect(b.getAttribute('aria-label'), b.textContent).toContain(b.textContent);
    for (const b of buttons) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.getAttribute('aria-haspopup')).toBe('dialog');
      expect(b.getAttribute('title')).toBe('Team ansehen');
    }
    // eigene Zeile außerhalb der Top-Liste ebenfalls
    expect(c.querySelector('tbody.lb-mine button.lb-team')?.textContent).toBe('Cerulean');
    // punktgleich mit der letzten Zeile: kein Abstand
    expect(c.querySelector('.lb-mine__gap')).toBeNull();
  });

  it('eigene Zeile außerhalb der Top-Liste: Punkte-Abstand zur letzten angezeigten Zeile', async () => {
    storeSettings('de');
    const saved = BOARD.mine;
    BOARD.mine = { ...saved!, points: 80 };
    try {
      await stubServer();
      const c = await render(app());
      await settle();
      expect(c.querySelector('.lb-mine__gap')?.textContent).toBe(' · noch 12 Pkt bis in die Top 2');
    } finally {
      BOARD.mine = saved;
    }
  });

  it('🆕 an Einträgen aus der letzten Stunde (neben dem Team-Knopf, nicht darin)', async () => {
    storeSettings('de');
    const saved = BOARD.rows;
    BOARD.rows = [{ ...saved[0], createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }, ...saved.slice(1)];
    try {
      await stubServer();
      const c = await render(app());
      await settle();
      const fresh = c.querySelectorAll('.lb-fresh');
      expect(fresh).toHaveLength(1);
      expect(fresh[0].getAttribute('aria-label')).toBe('In der letzten Stunde eingetragen');
      expect(teamButtons(c)[0].textContent).toBe('Pallet Power');
    } finally {
      BOARD.rows = saved;
    }
  });

  it('Klick öffnet den Dialog: erst Laden mit den Daten der Zeile, dann Spielfeld, Teamblatt und Kopfdaten', async () => {
    storeSettings('de');
    let resolve!: (r: Response) => void;
    const server = await stubServer(() => new Promise<Response>((r) => (resolve = r)));
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));

    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(dialogName(d)).toBe('Pallet Power');
    expect(d.textContent).toContain('Team wird geladen …');
    expect(d.querySelector('[role="status"]')?.textContent).toBe('Team wird geladen …');
    // Kopfdaten stehen schon da (aus der Zeile)
    expect(d.textContent).toContain('von Ash · Platz 1');
    expect(d.querySelector('.entry__facts')?.textContent).toContain('30–2–2');
    expect(d.querySelector('.pitch')).toBeNull();
    expect(builderHref(d)).toBeNull();
    expect(server.entryCalls()).toEqual([`/api/entries/${ID1}`]);

    await act(async () => resolve(json(200, DETAILS[ID1])));
    await settle();
    const text = d.textContent;
    expect(text).not.toContain('Team wird geladen');
    expect(text).toContain('34–0 Challenge · 12.10.2026');
    expect(text).toContain('von Ash · Platz 1');
    const facts = d.querySelectorAll('.entry__facts div').map((f) => [f.querySelector('dt')!.textContent, f.querySelector('dd')!.textContent]);
    expect(facts).toEqual([
      ['Bilanz', '30–2–230 Siege, 2 Unentschieden, 2 Niederlagen'],
      ['Punkte', '92'],
      ['Team-Score', '812'],
      ['Formation', '4-3-3'],
    ]);
    // Bilanz für Screenreader ausgeschrieben, die Kurzform verborgen
    expect(d.querySelector('.entry__facts dd span[aria-hidden="true"]')?.textContent).toBe('30–2–2');
    expect(d.querySelector('.entry__facts dd .sr-only')?.textContent).toBe('30 Siege, 2 Unentschieden, 2 Niederlagen');

    // Spielfeld nur zum Ansehen: keine Knöpfe, alle 11 Plätze + Standardschütze auf der Bank
    const pitch = d.querySelector('.pitch')!;
    expect(pitch.getAttribute('role')).toBe('group');
    expect(pitch.getAttribute('aria-label')).toBe('Aufstellung von Pallet Power (4-3-3)');
    expect(pitch.querySelectorAll('[data-slot-index]')).toHaveLength(11);
    expect(d.querySelectorAll('.pitch-wrap button')).toHaveLength(0);
    expect(d.querySelector('.bench [data-slot-index="11"]')).not.toBeNull();
    expect(pitch.querySelector('[data-slot-index="0"]')?.getAttribute('aria-label')).toContain(mon(143).de);

    // Teamblatt: alle Spieler in Slot-Reihenfolge, Standardschütze am Ende, nichts anklickbar
    expect(d.querySelector('.sheet .section-title')?.textContent).toBe('Aufstellung');
    expect(sheetNames(d)).toEqual([...ELF, SS].map((id) => mon(id).de));
    expect(d.querySelectorAll('.sheet button')).toHaveLength(0);
  });

  it('Schließen (Knopf, ✕, Esc) gibt den Fokus an den Team-Knopf der Zeile zurück', async () => {
    storeSettings('de');
    await stubServer();
    const c = await render(app());
    await settle();
    const ash = teamButton(c, 'Ash');

    await click(ash);
    await settle();
    expect(dialog()).not.toBeNull();
    expect(doc.activeElement?.getAttribute('role')).toBe('dialog');
    expect(doc.body.style.overflow).toBe('hidden');
    await click(buttonByText(dialog()!, 'Schließen')!);
    expect(dialog()).toBeNull();
    expect(doc.activeElement).toBe(ash);
    expect(doc.body.style.overflow).not.toBe('hidden');

    await click(ash);
    await settle();
    await click(dialog()!.querySelector('.modal__head button')!);
    expect(dialog()).toBeNull();
    expect(doc.activeElement).toBe(ash);

    const misty = teamButton(c, 'Misty');
    await click(misty);
    await settle();
    expect(dialogName(dialog()!)).toBe('Cerulean');
    await press('Escape');
    expect(dialog()).toBeNull();
    expect(doc.activeElement).toBe(misty);
  });

  it('Klick irgendwo in die Zeile öffnet das Team ebenfalls (Fokus danach am Knopf der Zeile)', async () => {
    storeSettings('de');
    const server = await stubServer();
    const c = await render(app());
    await settle();
    const brockRow = teamButton(c, 'Brock').closest('tr')!;
    await click(brockRow.querySelectorAll('td')[2]); // Bilanz-Spalte
    await settle();
    const d = dialog()!;
    expect(dialogName(d)).toBe('Team von Brock');
    expect(server.entryCalls()).toEqual([`/api/entries/${ID2}`]);
    expect(d.querySelector('.pitch')?.getAttribute('aria-label')).toBe('Aufstellung von Brock (4-4-2)');
    expect(d.querySelector('.bench')).toBeNull();
    expect(sheetNames(d)).toEqual(ELF.map((id) => mon(id).de));
    await press('Escape');
    expect(doc.activeElement).toBe(teamButton(c, 'Brock'));
  });

  it('eigene Zeile: lädt ihr Team; der Spielername kommt aus der Zeile (ohne Cache), nicht aus der Team-Antwort', async () => {
    storeSettings('de');
    // Team-Antwort mit einem älteren Namen – so, wie sie bis zu 60 s aus dem HTTP-Cache kommen kann
    const server = await stubServer((id) => json(200, { ...DETAILS[id], player: `${DETAILS[id].player} (alt)` }));
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Misty'));
    await settle();
    let d = dialog()!;
    expect(server.entryCalls()).toEqual([`/api/entries/${ID3}`]);
    expect(dialogName(d)).toBe('Cerulean');
    expect(d.querySelector('.pitch')).not.toBeNull();
    expect(d.textContent).toContain('von Misty · Platz 77');
    expect(d.textContent).not.toContain('(alt)');
    await press('Escape');

    // Ohne Teamnamen: Titel und Spielfeld nennen ebenfalls den Namen aus der Zeile
    await click(teamButton(c, 'Brock'));
    await settle();
    d = dialog()!;
    expect(d.querySelector('.pitch')).not.toBeNull();
    expect(dialogName(d)).toBe('Team von Brock');
    expect(d.querySelector('.pitch')?.getAttribute('aria-label')).toBe('Aufstellung von Brock (4-4-2)');
    expect(d.textContent).toContain('von Brock · Platz 2');
    expect(d.textContent + attrsOf(d).join(' ')).not.toContain('(alt)');
  });

  it('nach dem Umbenennen auf derselben Seite: Dialog zeigt den neuen Namen, auch wenn die Team-Antwort noch den alten trägt', async () => {
    storeSettings('de');
    let player = 'Misty';
    const server = await stubServer(
      // GET /api/entries/:id ist public, max-age=60 – der Browser liefert nach dem Umbenennen noch den alten Namen
      (id) => json(200, { ...DETAILS[id], player: 'Misty' }),
      // GET /api/leaderboard ist no-store – nach dem Umbenennen kommt der neue Name
      () => json(200, { ...BOARD, mine: { ...BOARD.mine!, player } }),
    );
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Misty'));
    await settle();
    expect(dialog()!.textContent).toContain('von Misty · Platz 77');
    await press('Escape');

    player = 'Misty Neu';
    await typeInto(doc.getElementById('lb-name')!, 'Misty Neu');
    await submit(c.querySelector('form.namefield')!);
    await settle();
    expect(server.calls.filter((u) => u.includes('/api/player'))).toHaveLength(1);
    expect(server.boardCalls()).toBe(2);

    await click(teamButton(c, 'Misty Neu'));
    await settle();
    const d = dialog()!;
    expect(server.entryCalls()).toEqual([`/api/entries/${ID3}`, `/api/entries/${ID3}`]);
    expect(d.querySelector('.pitch')).not.toBeNull();
    expect(d.textContent).toContain('von Misty Neu · Platz 77');
  });

  it('„Im Builder öffnen": Share-Link mit Formation, Slots, Standardschütze und Teamname – der Builder übernimmt das Team', async () => {
    storeSettings('de');
    await stubServer();
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    const d = dialog()!;
    const href = builderHref(d)!;
    expect(href.startsWith(`/?${URL_PARAM}=`)).toBe(true);
    expect(decodeHref(href)).toMatchObject({ formation: '4-3-3', slots: ELF, ss: SS, ssEnabled: true, teamName: 'Pallet Power', sprite: 'pixel' });
    const link = d.querySelectorAll('a').find((a) => a.textContent === 'Im Builder öffnen')!;
    expect(link.getAttribute('aria-describedby')).toBe('entry-builder-hint');
    expect(doc.getElementById('entry-builder-hint')?.textContent).toBe('Ersetzt deine Aufstellung im Builder.');

    await click(link);
    await settle();
    expect(dialog()).toBeNull();
    expect(doc.body.style.overflow).not.toBe('hidden');
    expect(c.querySelector('h1.team-title')?.textContent).toBe('Pallet Power');
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:lineup')!);
    expect(saved).toMatchObject({ formation: '4-3-3', slots: ELF, ss: SS, ssEnabled: true, teamName: 'Pallet Power' });
    expect(doc.body.textContent).toContain('Geteilte Aufstellung geladen');
  });

  it('„Im Builder öffnen" mit langem Teamnamen (über 40 Bytes): der Builder bekommt den ganzen Namen', async () => {
    storeSettings('de');
    const name = 'Glühwürmchen-Größenwahn 🔥🔥🔥🔥';
    const longBoard = { ...BOARD, rows: [row({ teamName: name }), BOARD.rows[1]] };
    await stubServer((id) => json(200, { ...DETAILS[id], teamName: name }), () => json(200, longBoard));
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    const d = dialog()!;
    expect(dialogName(d)).toBe(name);
    expect(decodeHref(builderHref(d)!)?.teamName).toBe(name);
    await click(d.querySelectorAll('a').find((a) => a.textContent === 'Im Builder öffnen')!);
    await settle();
    expect(c.querySelector('h1.team-title')?.textContent).toBe(name);
    expect(JSON.parse(localStorage.getItem('pokemon-elf:lineup')!).teamName).toBe(name);
  });

  it('Lieblingsformation der gezeigten Einträge in der Kopfzeile (ab 3, eindeutig)', async () => {
    storeSettings('de');
    const board = { ...BOARD, rows: [row(), BOARD.rows[1], row({ rank: 3, entryId: ID3, player: 'Misty', formation: '4-3-3' })] };
    await stubServer(undefined, () => json(200, board));
    const c = await render(app());
    await settle();
    expect(c.querySelector('.lb-meta')!.textContent).toContain('Lieblingsformation der Top 3: 4-3-3 (2×)');
  });

  it('Sprites folgen der Einstellung des Nutzers – im Dialog und im Builder-Link', async () => {
    storeSettings('de', 'artwork');
    await stubServer();
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    const d = dialog()!;
    const imgs = d.querySelectorAll('img.sprite');
    expect(imgs.length).toBeGreaterThanOrEqual(12 * 2); // Spielfeld + Teamblatt
    for (const img of imgs) expect(img.getAttribute('src')).toContain('official-artwork');
    expect(decodeHref(builderHref(d)!)?.sprite).toBe('artwork');
  });

  it('404: „nicht mehr in der Rangliste" – Rangliste neu laden schließt den Dialog und lädt neu', async () => {
    storeSettings('de');
    const server = await stubServer(() => json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' }));
    const c = await render(app());
    await settle();
    expect(server.boardCalls()).toBe(1);
    await click(teamButton(c, 'Ash'));
    await settle();
    const d = dialog()!;
    const alert = d.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Dieses Team ist nicht mehr in der Rangliste.');
    expect(alert.textContent).toContain('lade die Rangliste neu');
    expect(buttonByText(d, 'Erneut versuchen')).toBeUndefined();
    expect(builderHref(d)).toBeNull();
    // Kopfdaten der Zeile bleiben sichtbar
    expect(dialogName(d)).toBe('Pallet Power');

    await click(buttonByText(d, 'Rangliste neu laden')!);
    expect(dialog()).toBeNull();
    expect(focusInDocument()).toBe(true);
    await settle();
    expect(server.boardCalls()).toBe(2);
    expect(teamButtons(c)).toHaveLength(3);
    // Fokus nicht verloren: wieder am Team-Knopf von Ash (neu gerenderte Tabelle)
    expect(focusInDocument()).toBe(true);
    expect(doc.activeElement).toBe(teamButton(c, 'Ash'));
  });

  it('„Rangliste neu laden": Fokus erst aufs Panel, nach dem Laden an den Team-Knopf desselben Spielers', async () => {
    storeSettings('de');
    let release!: () => void;
    const ID4 = '44444444-4444-4444-8444-444444444444';
    // Inzwischen hat Ash einen besseren Run (neue Eintrags-ID, anderer Teamname)
    const after: LeaderboardResponse = {
      ...BOARD,
      rows: [row({ entryId: ID4, teamName: 'Pallet Power II', points: 95 }), BOARD.rows[1]],
    };
    const server = await stubServer(
      () => json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' }),
      (n) => (n === 1 ? json(200, BOARD) : new Promise<Response>((r) => (release = () => r(json(200, after))))),
    );
    const c = await render(app());
    await settle();
    const panel = c.querySelector('section[role="tabpanel"]')!;
    expect(panel.getAttribute('tabindex')).toBe('-1');
    const oldAsh = teamButton(c, 'Ash');
    await click(oldAsh);
    await settle();
    await click(buttonByText(dialog()!, 'Rangliste neu laden')!);

    // Während des Ladens: Tabelle (samt Knopf, der den Dialog geöffnet hat) ist weg, der Fokus steht auf dem Panel
    expect(dialog()).toBeNull();
    expect(panel.textContent).toContain('Lade …');
    expect(doc.body.contains(oldAsh)).toBe(false);
    expect(doc.activeElement).toBe(panel);
    expect(focusInDocument()).toBe(true);

    await act(async () => release());
    await settle();
    expect(server.boardCalls()).toBe(2);
    const newAsh = teamButton(c, 'Ash');
    expect(newAsh).not.toBe(oldAsh);
    expect(newAsh.textContent).toBe('Pallet Power II');
    expect(doc.activeElement).toBe(newAsh);
    expect(focusInDocument()).toBe(true);

    // Danach normales Verhalten: Öffnen und Schließen gibt den Fokus an den Knopf der Zeile zurück
    await click(teamButton(c, 'Brock'));
    await settle();
    await press('Escape');
    expect(doc.activeElement).toBe(teamButton(c, 'Brock'));
  });

  it('„Rangliste neu laden": Spieler nicht mehr in der Liste oder Laden scheitert → Fokus bleibt auf dem Panel', async () => {
    storeSettings('de');
    let second: () => Response = () => json(200, { ...BOARD, rows: [BOARD.rows[1]], mine: null });
    const server = await stubServer(
      () => json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' }),
      (n) => (n === 1 ? json(200, BOARD) : second()),
    );
    const c = await render(app());
    await settle();
    const panel = c.querySelector('section[role="tabpanel"]')!;
    await click(teamButton(c, 'Ash'));
    await settle();
    await click(buttonByText(dialog()!, 'Rangliste neu laden')!);
    await settle();
    expect(server.boardCalls()).toBe(2);
    expect(teamButtons(c).map((b) => b.textContent)).toEqual(['Team ansehen']); // nur Brock
    expect(doc.activeElement).toBe(panel);
    expect(focusInDocument()).toBe(true);

    // Laden scheitert: Meldung, Fokus weiter auf dem Panel
    second = () => json(503, { error: 'server_error', message: 'Datenbank nicht erreichbar' });
    await click(teamButton(c, 'Brock'));
    await settle();
    await click(buttonByText(dialog()!, 'Rangliste neu laden')!);
    await settle();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain('Datenbank nicht erreichbar');
    expect(doc.activeElement).toBe(panel);
    expect(focusInDocument()).toBe(true);
  });

  it('„Rangliste neu laden": Wer währenddessen woanders hin wechselt, behält seinen Fokus', async () => {
    storeSettings('de');
    let release!: () => void;
    await stubServer(
      () => json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' }),
      (n) => (n === 1 ? json(200, BOARD) : new Promise<Response>((r) => (release = () => r(json(200, BOARD))))),
    );
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    await click(buttonByText(dialog()!, 'Rangliste neu laden')!);
    const input = doc.getElementById('lb-name')!;
    input.focus();
    await act(async () => release());
    await settle();
    expect(teamButtons(c)).toHaveLength(3);
    expect(doc.activeElement).toBe(input);
  });

  it('andere Fehler: Meldung + „Erneut versuchen" (Fokus bleibt im Dialog), danach das Team', async () => {
    storeSettings('de');
    let fail = true;
    const server = await stubServer((id) =>
      fail ? json(500, { error: 'server_error', message: 'Interner Fehler' }) : json(200, DETAILS[id]),
    );
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    const d = dialog()!;
    expect(d.querySelector('[role="alert"]')?.textContent).toContain('Team nicht erreichbar: Interner Fehler');
    expect(d.querySelector('.pitch')).toBeNull();

    fail = false;
    await click(buttonByText(d, 'Erneut versuchen')!);
    expect(doc.activeElement?.getAttribute('class')).toContain('entry');
    expect(d.contains(doc.activeElement)).toBe(true);
    await settle();
    expect(server.entryCalls()).toEqual([`/api/entries/${ID1}`, `/api/entries/${ID1}`]);
    expect(d.querySelector('[role="alert"]')).toBeNull();
    expect(sheetNames(d)).toEqual([...ELF, SS].map((id) => mon(id).de));
  });

  it('Netzwerkfehler beim Laden des Teams: Meldung statt Absturz', async () => {
    storeSettings('de');
    await stubServer(() => {
      throw new TypeError('Failed to fetch');
    });
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toContain('Team nicht erreichbar: Server nicht erreichbar');
  });
});

// ---------------------------------------------------------------- Runs dieses Geräts

describe('Rangliste: Team ansehen (Runs dieses Geräts)', () => {
  it('ohne Server: Team kommt aus der lokalen Historie, ohne Abruf – mit und ohne Standardschütze', async () => {
    storeSettings('de');
    storeLocalRuns([
      localEntry(),
      localEntry({ id: 'local-2', player: 'Misty', teamName: 'Azuria', lineup: ELF, points: 50 }),
    ]);
    const calls = await stubOffline();
    const c = await render(app());
    await settle();
    expect(teamButtons(c).map((b) => b.textContent)).toEqual(['Alabastia', 'Azuria']);

    await click(teamButton(c, 'Ash'));
    let d = dialog()!;
    expect(dialogName(d)).toBe('Alabastia');
    expect(d.textContent).not.toContain('Team wird geladen');
    expect(d.textContent).toContain('von Ash · Platz 1');
    expect(d.querySelector('.bench [data-slot-index="11"]')).not.toBeNull();
    expect(sheetNames(d)).toEqual([...ELF, SS].map((id) => mon(id).de));
    expect(decodeHref(builderHref(d)!)).toMatchObject({ slots: ELF, ss: SS, ssEnabled: true, teamName: 'Alabastia' });
    await press('Escape');
    expect(doc.activeElement).toBe(teamButton(c, 'Ash'));

    await click(teamButton(c, 'Misty'));
    d = dialog()!;
    expect(dialogName(d)).toBe('Azuria');
    expect(d.querySelector('.bench')).toBeNull();
    expect(sheetNames(d)).toEqual(ELF.map((id) => mon(id).de));
    await settle();
    expect(calls.filter((u) => u.includes('/api/entries'))).toEqual([]);
  });

  it('Tag des lokalen Runs (Berlin) in der Kopfzeile', async () => {
    storeSettings('de');
    storeLocalRuns([localEntry()]);
    await stubOffline();
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    const [y, m, day] = dayKey().split('-');
    expect(dialog()!.textContent).toContain(`34–0 Challenge · ${day}.${m}.${y}`);
  });

  it('online umgeschaltet auf „Dieses Gerät": ebenfalls lokal, kein Abruf beim Server', async () => {
    storeSettings('de');
    storeLocalRuns([localEntry()]);
    const server = await stubServer();
    const c = await render(app());
    await settle();
    await click(c.querySelectorAll('button[role="radio"]').find((b) => b.textContent === 'Dieses Gerät')!);
    await settle();
    expect(teamButtons(c).map((b) => b.textContent)).toEqual(['Alabastia']);
    await click(teamButton(c, 'Ash'));
    await settle();
    expect(sheetNames(dialog()!)).toEqual([...ELF, SS].map((id) => mon(id).de));
    expect(server.entryCalls()).toEqual([]);
  });

  it('unlesbarer lokaler Run: Meldung statt Spielfeld, kein Builder-Link', async () => {
    storeSettings('de');
    storeLocalRuns([localEntry({ formation: '9-9-9' as never })]);
    await stubOffline();
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    const d = dialog()!;
    expect(d.querySelector('[role="alert"]')?.textContent).toBe('Diese Aufstellung lässt sich nicht anzeigen.');
    expect(d.querySelector('.pitch')).toBeNull();
    expect(builderHref(d)).toBeNull();
    expect(buttonByText(d, 'Schließen')).toBeDefined();
  });
});

// ---------------------------------------------------------------- Englisch

describe('Zugänglicher Name des Team-Knopfs (WCAG 2.5.3 Label in Name)', () => {
  it('enthält in beiden Sprachen immer den sichtbaren Text – mit und ohne Teamnamen', async () => {
    const de = (await import('../src/i18n/de/leaderboard')).default;
    const en = (await import('../src/i18n/en/leaderboard')).default;
    for (const lb of [de, en]) {
      for (const player of ['Brock', 'Ash Ketchum', '🔥']) {
        // ohne Teamnamen ist der sichtbare Text „Team ansehen"/„View team" – er steht am Anfang
        expect(lb.viewTeamOf('', player).startsWith(lb.viewTeam), lb.viewTeamOf('', player)).toBe(true);
        expect(lb.viewTeamOf('', player)).toContain(player);
        // mit Teamnamen ist der sichtbare Text der Teamname
        expect(lb.viewTeamOf('Pallet Power', player)).toContain('Pallet Power');
        expect(lb.viewTeamOf('Pallet Power', player)).toContain(player);
      }
    }
    expect(de.viewTeamOf('', 'Brock')).toBe('Team ansehen: Team von Brock');
    expect(en.viewTeamOf('', 'Brock')).toBe('View team by Brock');
  });
});

/** Typisch deutsche Wörter/Zeichen – nichts davon darf im englischen Dialog stehen. */
const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|von|nicht|mit|für|ist|wird|noch|Platz|Bilanz|Punkte|Spieler|Rangliste|Aufstellung|Ersetzt|ansehen|Öffnen|öffnen|Schließen|Lade|Team-Score|Gerät)\b/;

describe('Rangliste: Team ansehen auf Englisch', () => {
  it('Knopf, Dialog und Builder-Link ohne Deutsch', async () => {
    storeSettings('en');
    let resolve!: (r: Response) => void;
    await stubServer(() => new Promise<Response>((r) => (resolve = r)));
    const c = await render(app());
    await settle();
    expect(teamButtons(c).map((b) => b.getAttribute('aria-label'))).toEqual([
      'View team: Pallet Power by Ash',
      'View team by Brock',
      'View team: Cerulean by Misty',
    ]);
    expect(teamButton(c, 'Brock').textContent).toBe('View team');
    for (const b of teamButtons(c)) expect(b.getAttribute('aria-label'), b.textContent).toContain(b.textContent);

    await click(teamButton(c, 'Ash'));
    expect(dialog()!.textContent).toContain('Loading team …');
    await act(async () => resolve(json(200, DETAILS[ID1])));
    await settle();
    const d = dialog()!;
    const text = d.textContent;
    expect(text).toContain('34–0 Challenge · Oct 12, 2026');
    expect(text).toContain('by Ash · Rank 1');
    expect(text).toContain('Record');
    expect(text).toContain('30 wins, 2 draws, 2 defeats');
    expect(text).toContain('Points');
    expect(text).toContain('Team score');
    expect(text).toContain('Formation');
    expect(text).toContain('Lineup');
    expect(text).toContain('Open in builder');
    expect(text).toContain('Replaces your lineup in the builder.');
    expect(text).toContain(mon(143).en);
    expect(d.querySelector('.pitch')?.getAttribute('aria-label')).toBe('Lineup of Pallet Power (4-3-3)');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
    for (const a of attrsOf(d)) expect(a.match(GERMAN)?.[0] ?? null, a).toBeNull();
    for (const a of attrsOf(c)) expect(a.match(GERMAN)?.[0] ?? null, a).toBeNull();
  });

  it('404 und andere Fehler englisch', async () => {
    storeSettings('en');
    let status = 404;
    await stubServer(() =>
      status === 404
        ? json(404, { error: 'not_found', message: 'Dieses Team ist nicht mehr in der Rangliste' })
        : json(429, { error: 'rate_limited', message: 'Zu viele Anfragen in kurzer Zeit' }),
    );
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    await settle();
    let text = dialog()!.textContent;
    expect(text).toContain('This team is no longer on the leaderboard.');
    expect(text).toContain('Reload leaderboard');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
    await press('Escape');

    status = 429;
    await click(teamButton(c, 'Misty'));
    await settle();
    text = dialog()!.textContent;
    expect(text).toContain('Team unavailable: Too many requests in a short time');
    expect(text).toContain('Try again');
    expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
  });

  it('unlesbarer lokaler Run englisch', async () => {
    storeSettings('en');
    storeLocalRuns([localEntry({ lineup: 'kaputt' as never })]);
    await stubOffline();
    const c = await render(app());
    await settle();
    await click(teamButton(c, 'Ash'));
    expect(dialog()!.textContent).toContain('This lineup can’t be displayed.');
  });
});

// ---------------------------------------------------------------- Ende zu Ende

describe('Rangliste: Team ansehen gegen den echten Server (D1-Shim)', () => {
  const DATA = engine.createEngineData(ALL);

  /** Spielt einen Run automatisch: erster wählbarer Kandidat, erster freier Slot (SS zuletzt). */
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

  it('gewerteter Run → Rangliste → Dialog zeigt genau die gespielte Aufstellung; Builder-Link passt', async () => {
    storeSettings('de');
    const db = new D1Shim();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('data/pokemon.json')) return json(200, ALL);
        return handleApi(new Request(`http://localhost${url}`, init), { DB: db });
      }),
    );
    await client.apiHealth(true);
    await client.renamePlayer('Ash');
    const start = await client.startRun('c340');
    const state = autoPlay({ challenge: 'c340', formation: '4-4-2', ssEnabled: true, seed: start.seed });
    const res = await client.finishRun({
      token: start.token,
      formation: '4-4-2',
      ssEnabled: true,
      picks: state.picks,
      teamName: 'Pallet Power',
      player: 'Ash',
    });

    // Client und Server sind sich über das Format einig
    const fetched = await client.fetchEntry(res.entryId);
    expect(fetched).toMatchObject({ entryId: res.entryId, formation: '4-4-2', slots: state.slots, ss: state.ss, ssEnabled: true });
    expect(fetched).not.toHaveProperty('deviceId');

    const c = await render(app());
    await settle();
    const button = teamButton(c, 'Ash');
    expect(button.getAttribute('aria-label')).toBe('Team ansehen: Pallet Power von Ash');
    await click(button);
    await settle();
    const d = dialog()!;
    expect(dialogName(d)).toBe('Pallet Power');
    expect(d.textContent).toContain(`von Ash · Platz 1`);
    expect(d.textContent).toContain(`${res.record.w}–${res.record.d}–${res.record.l}`);
    expect(sheetNames(d)).toEqual([...state.slots, state.ss].map((id) => mon(id!).de));
    expect(decodeHref(builderHref(d)!)).toMatchObject({
      formation: '4-4-2',
      slots: state.slots,
      ss: state.ss,
      ssEnabled: true,
      teamName: 'Pallet Power',
    });

    // Unbekannter Eintrag (z. B. inzwischen ersetzt): 404 not_found
    await expect(client.fetchEntry('44444444-4444-4444-8444-444444444444')).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('Rangliste: stilles Aktualisieren', () => {
  it('lädt jede Minute neu, solange der Tab sichtbar ist – ohne „Lade …“ dazwischen', async () => {
    const ticks: (() => void)[] = [];
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
      if (ms === 60_000) {
        ticks.push(fn);
        return 4242 as unknown as ReturnType<typeof setInterval>;
      }
      return realSetInterval(fn, ms);
    }) as typeof setInterval);
    storeSettings('de');
    const later: LeaderboardResponse = { ...BOARD, rows: [row({ player: 'Gary', teamName: 'Rivalen' }), ...BOARD.rows.slice(1)] };
    const server = await stubServer(undefined, (n) => json(200, n === 1 ? BOARD : later));
    const container = await render(app());
    await settle();
    expect(container.textContent).toContain('Ash');
    const before = server.boardCalls();
    expect(ticks.length).toBeGreaterThan(0);

    // Verborgener Tab: kein Abruf
    doc.visibilityState = 'hidden';
    ticks.at(-1)!();
    await settle();
    expect(server.boardCalls()).toBe(before);

    doc.visibilityState = 'visible';
    ticks.at(-1)!();
    expect(container.textContent).not.toContain('Lade …');
    await settle();
    expect(server.boardCalls()).toBe(before + 1);
    expect(container.textContent).toContain('Gary');
    expect(container.textContent).not.toContain('Ash');
    vi.mocked(globalThis.setInterval).mockRestore();
  });
});
