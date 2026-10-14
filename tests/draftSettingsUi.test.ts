/**
 * Oberfläche der neuen Online-Draft-Einstellungen (Generationen, Typen, Legendäre/Mysteriöse,
 * Legendären-Limit, Zufallsmodus mit Rerolls, Snake) und des Zufallsmodus im Live-Draft:
 * Einstellungsformular (nie eine leere Auswahl, Rerolls nur mit Zufallsmodus), Kurzfassung,
 * Wurf in der Statusleiste, Reroll-Knöpfe nur am eigenen Zug, ausgegraute Pokémon mit Grund,
 * Reroll über den Raum-Hook (WebSocket-Nachricht, Sperre bis zum neuen Wurf) – auf Deutsch und
 * Englisch. Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSettings, DraftSettingsPatch, DraftSnapshot } from '../src/lib/api/draftContract';
import type { DraftState } from '../src/lib/draftEngine';
import type { DraftRoom } from '../src/state/useDraftRoom';
import { ALL } from './helpers';
import { FakeObserver, installMiniDom, type MiniElement, type MiniNode } from './miniDom';

const doc = installMiniDom();
// React-DOM und alles mit UI erst nach dem Mini-DOM laden
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { DraftSettingsForm, DraftSettingsSummary } = await import('../src/components/DraftSettingsForm');
const { DraftLive } = await import('../src/components/DraftLive');
const { DraftPickFeed } = await import('../src/components/DraftBoard');
const { DraftOnline } = await import('../src/pages/DraftOnline');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const hook = await import('../src/state/useDraftRoom');
const engine = await import('../src/lib/draftEngine');
const contract = await import('../src/lib/api/draftContract');
const { TYPE_KEYS } = await import('../src/config/pokemonTypes');
const { messages, setCurrentLang } = await import('../src/i18n');
const { save, STORAGE_KEYS } = await import('../src/lib/storage');

const { act, createElement: h, useState } = React;
const { DEFAULT_DRAFT_SETTINGS, DRAFT_ALL_GENS } = contract;
const de = messages('de');
const byId = new Map(ALL.map((p) => [p.id, p]));

// ---------------------------------------------------------------- Helfer

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(snapshot?: () => DraftSnapshot) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('data/pokemon.json')) return json(200, ALL);
      if (url.endsWith('data/forms.json')) return json(200, []);
      if (snapshot) return json(200, snapshot());
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
  await settle();
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.parentNode?.removeChild(container);
  });
  return { container, root };
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

/** Englisch wählen – wie der Sprachumschalter (gespeicherte Einstellung) und für Nicht-React-Code */
function english() {
  save(STORAGE_KEYS.settings, { lang: 'en' });
  setCurrentLang('en');
}

/** Ein Feld (.field) über seine Beschriftung (genau dieser Text). */
function field(root: MiniElement, label: string): MiniElement {
  const found = root.querySelectorAll('.field').find((f) => f.querySelector('.field__label')?.textContent === label);
  if (!found) throw new Error(`Feld „${label}" fehlt`);
  return found;
}
const hasField = (root: MiniElement, label: string) =>
  root.querySelectorAll('.field__label').some((l) => l.textContent === label);

function button(root: MiniElement, text: string): MiniElement {
  const found = root.querySelectorAll('button').find((b) => b.textContent === text);
  if (!found) throw new Error(`Knopf „${text}" fehlt`);
  return found;
}

/** Element mit dieser id (der Mini-DOM kennt keine #id-Selektoren) */
const byDomId = (root: MiniElement, id: string | null) =>
  id ? (root.querySelectorAll('[id]').find((e) => e.getAttribute('id') === id) ?? null) : null;

async function click(el: MiniElement) {
  await act(async () => el.click());
}

/** Sichtbarer Text und Text-Attribute eines Teilbaums */
function texts(root: MiniNode): string[] {
  const out: string[] = [];
  const walk = (n: MiniNode) => {
    if (n.nodeType === 3) {
      const t = n.textContent.trim();
      if (t) out.push(t);
    }
    if (n.nodeType === 1) {
      const el = n as MiniElement;
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

/** Deutsche Wörter und Umlaute, die in der englischen Oberfläche nicht vorkommen dürfen */
const GERMAN =
  /[äöüÄÖÜß„]|\b(und|der|die|das|den|dem|nicht|mit|ohne|für|pro|bis|Aus|An|Alle|Keine|Wurf|Rundenwurf|eigener|neu|würfeln|Typ|Typen|Generationen|Legendäre|Mysteriöse|Zufallsmodus|Runde|Reihenfolge|passende|Passt|Gesucht|Feuer|Wasser|Pflanze|Einall|Glurak)\b/;
const GERMAN_POKEMON = new Set(ALL.filter((p) => p.de !== p.en).map((p) => p.de));
const germanLeft = (root: MiniNode) =>
  texts(root).filter((t) => GERMAN.test(t) || t.split(/: | – | · | → |, /).some((part) => GERMAN_POKEMON.has(part.trim())));

function lobby(teams = 2, settings: DraftSettingsPatch = { gens: [...DRAFT_ALL_GENS], maxTeams: 4 }): DraftState {
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

/** Zufallsmodus pro Pick, alle Generationen, Host wählt zuerst, ohne Timer */
const RANDOM: DraftSettingsPatch = {
  gens: [...DRAFT_ALL_GENS],
  maxTeams: 4,
  order: 'host',
  pickSeconds: 0,
  roll: 'pick',
  rerolls: { type: 1, region: 2 },
};

const snap = (s: DraftState, you: string | null = 'h'): DraftSnapshot => engine.snapshotOf(s, you, Date.now());

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

// ---------------------------------------------------------------- Einstellungsformular

describe('DraftSettingsForm', () => {
  /** Formular mit eigenem Zustand (wie die Erstellen-Seite) – jede Änderung landet auch in `changes` */
  async function renderForm(initial: Partial<DraftSettings> = {}, props: { teamsJoined?: number; busy?: boolean } = {}) {
    const changes: Partial<DraftSettings>[] = [];
    function Harness() {
      const [value, setValue] = useState<DraftSettings>({ ...DEFAULT_DRAFT_SETTINGS, ...initial });
      return h(DraftSettingsForm, {
        value,
        list: ALL,
        ...props,
        onChange: (patch: Partial<DraftSettings>) => {
          changes.push(patch);
          setValue((v) => ({ ...v, ...patch }));
        },
      });
    }
    const { container } = await render(app(h(Harness)));
    return { container, changes };
  }
  const pressed = (b: MiniElement) => b.getAttribute('aria-pressed') === 'true';

  it('Generationen: Mehrfachauswahl, „Alle", die letzte lässt sich nicht abwählen', async () => {
    const { container, changes } = await renderForm();
    const gens = () => field(container, 'Generationen');
    expect(gens().querySelector('[role="group"]')).not.toBeNull();
    expect(pressed(button(gens(), 'Kanto'))).toBe(true);
    expect(pressed(button(gens(), 'Johto'))).toBe(false);
    expect(button(gens(), 'Johto').getAttribute('title')).toBe('Generation 2');

    await click(button(gens(), 'Johto'));
    expect(changes.at(-1)).toEqual({ gens: [1, 2] });
    expect(pressed(button(gens(), 'Johto'))).toBe(true);
    await click(button(gens(), 'Kanto'));
    expect(changes.at(-1)).toEqual({ gens: [2] });

    // Johto ist die einzige Generation: gesperrt (fokussierbar, mit Grund), Klick ändert nichts
    const johto = button(gens(), 'Johto');
    expect(johto.getAttribute('aria-disabled')).toBe('true');
    expect(johto.hasAttribute('disabled')).toBe(false);
    expect(johto.getAttribute('title')).toBe('Mindestens eine Generation');
    const before = changes.length;
    await click(johto);
    expect(changes).toHaveLength(before);

    await click(button(gens(), 'Alle'));
    expect(changes.at(-1)).toEqual({ gens: [...DRAFT_ALL_GENS] });
    expect(pressed(button(gens(), 'Alle'))).toBe(true);
    for (const c of changes) if (c.gens) expect(c.gens.length).toBeGreaterThan(0);
  });

  it('Generationen: zu kleine Pools sind gesperrt, wenn schon Teams dabei sind', async () => {
    // Kalos allein trägt keine 8 Teams
    const { container, changes } = await renderForm({ gens: [6, 7], maxTeams: 8 }, { teamsJoined: 8 });
    const alola = button(field(container, 'Generationen'), 'Alola');
    expect(alola.getAttribute('aria-disabled')).toBe('true');
    expect(alola.getAttribute('title')).toBe('Pool zu klein für 8 Teams');
    await click(alola);
    expect(changes).toEqual([]);
  });

  /** Bereich der neuen Typ-Auswahl (nach „Keine") mit Stand und Übernehmen */
  const typeDraft = (c: MiniElement) => c.querySelector('.draft-settings__typedraft');

  it('Typen: „Keine" startet eine neue Auswahl – frei umschalten, gesendet wird erst mit „Übernehmen"', async () => {
    const { container, changes } = await renderForm({ gens: [...DRAFT_ALL_GENS] });
    const types = () => field(container, 'Typen');
    const chips = () => TYPE_KEYS.map((k) => button(types(), de.game.type[k]));
    expect(chips().every(pressed)).toBe(true);
    expect(pressed(button(types(), 'Alle'))).toBe(true);
    expect(typeDraft(container)).toBeNull();

    await click(button(types(), 'Keine'));
    expect(changes).toEqual([]);
    expect(chips().some(pressed)).toBe(false);
    expect(typeDraft(container)!.textContent).toContain('Tippe die gewünschten Typen an');
    // Leere Auswahl: Übernehmen nimmt nichts an
    const apply = () => button(typeDraft(container)!, 'Übernehmen');
    expect(apply().getAttribute('aria-disabled')).toBe('true');
    await click(apply());
    expect(changes).toEqual([]);

    // Frei umschalten (auch den einzigen wieder ab) – nichts wird gesendet
    await click(button(types(), 'Feuer'));
    expect(pressed(button(types(), 'Feuer'))).toBe(true);
    expect(button(types(), 'Feuer').getAttribute('aria-disabled')).toBeNull();
    await click(button(types(), 'Feuer'));
    expect(chips().some(pressed)).toBe(false);
    await click(button(types(), 'Wasser'));
    await click(button(types(), 'Feuer'));
    expect(changes).toEqual([]);
    expect(chips().filter(pressed)).toHaveLength(2);
    const size = engine.poolOf({ ...DEFAULT_DRAFT_SETTINGS, gens: [...DRAFT_ALL_GENS], types: ['fire', 'water'] }, ALL).length;
    expect(typeDraft(container)!.textContent).toContain(`Neue Auswahl: ${size} Pokémon, reicht für bis zu 8 Teams`);

    // Übernehmen: genau eine Änderung mit der ganzen Auswahl (Reihenfolge wie TYPE_KEYS)
    expect(apply().getAttribute('aria-disabled')).toBeNull();
    await click(apply());
    expect(changes).toEqual([{ types: ['fire', 'water'] }]);
    expect(typeDraft(container)).toBeNull();
    expect(chips().filter(pressed)).toHaveLength(2);
    expect(types().textContent).toContain('mindestens einen der gewählten Typen');

    // Normale Auswahl: der letzte Typ lässt sich nicht abwählen
    await click(button(types(), 'Feuer'));
    expect(changes.at(-1)).toEqual({ types: ['water'] });
    const water = button(types(), 'Wasser');
    expect(water.getAttribute('aria-disabled')).toBe('true');
    expect(water.getAttribute('title')).toBe('Mindestens ein Typ');
    const before = changes.length;
    await click(water);
    expect(changes).toHaveLength(before);

    // Abbrechen verwirft die neue Auswahl
    await click(button(types(), 'Keine'));
    await click(button(types(), 'Drache'));
    await click(button(typeDraft(container)!, 'Abbrechen'));
    expect(changes).toHaveLength(before);
    expect(pressed(button(types(), 'Wasser'))).toBe(true);
    expect(pressed(button(types(), 'Drache'))).toBe(false);

    await click(button(types(), 'Alle'));
    expect(changes.at(-1)).toMatchObject({ types: [...TYPE_KEYS] });
    for (const c of changes) if (c.types) expect(c.types.length).toBeGreaterThan(0);
  });

  it('Typen: neue Auswahl aus einzeln zu kleinen Typen geht; kein Zwischenstand senkt maxTeams', async () => {
    // Gen 1+2: Feuer bzw. Elektro allein reichen nicht für 2 Teams, zusammen schon
    const base = { gens: [1, 2] };
    const fitBoth = hook.fitSettingsPatch({ ...DEFAULT_DRAFT_SETTINGS, ...base }, { types: ['fire', 'electric'] }, ALL, 2);
    expect(fitBoth).not.toBeNull();
    expect(hook.fitSettingsPatch({ ...DEFAULT_DRAFT_SETTINGS, ...base }, { types: ['fire'] }, ALL, 2)).toBeNull();
    const { container, changes } = await renderForm(base, { teamsJoined: 2 });
    const types = () => field(container, 'Typen');
    await click(button(types(), 'Keine'));
    await click(button(types(), 'Feuer'));
    // Nur Feuer: zu klein – Übernehmen gesperrt, Grund sichtbar
    expect(typeDraft(container)!.textContent).toContain('Pool zu klein für 2 Teams');
    expect(button(typeDraft(container)!, 'Übernehmen').getAttribute('aria-disabled')).toBe('true');
    await click(button(typeDraft(container)!, 'Übernehmen'));
    expect(changes).toEqual([]);
    await click(button(types(), 'Elektro'));
    expect(typeDraft(container)!.textContent).not.toContain('Pool zu klein');
    await click(button(typeDraft(container)!, 'Übernehmen'));
    expect(changes).toEqual([fitBoth]);
    expect(changes[0].types).toEqual(['fire', 'electric']);
  });

  it('Typen: neue Auswahl mit 8 Teams – nur die fertige Auswahl wird gesendet, maxTeams bleibt', async () => {
    const { container, changes } = await renderForm({ gens: [...DRAFT_ALL_GENS], maxTeams: 8 });
    const types = () => field(container, 'Typen');
    await click(button(types(), 'Keine'));
    for (const name of ['Drache', 'Wasser', 'Feuer']) await click(button(types(), name));
    expect(changes).toEqual([]);
    await click(button(typeDraft(container)!, 'Übernehmen'));
    expect(changes).toEqual([{ types: ['fire', 'water', 'dragon'] }]);
  });

  it('Legendäre und Mysteriöse getrennt; das Limit gilt nur mit einem der beiden', async () => {
    const { container, changes } = await renderForm({ gens: [...DRAFT_ALL_GENS] });
    const limit = () => field(container, 'Legendäre pro Team');
    expect(limit().querySelectorAll('button').every((b) => b.hasAttribute('disabled'))).toBe(true);
    expect(limit().textContent).toContain('Nur mit Legendären oder Mysteriösen im Pool.');

    await click(button(field(container, 'Mysteriöse'), 'An'));
    expect(changes.at(-1)).toEqual({ mythical: true });
    expect(limit().querySelectorAll('button').some((b) => b.hasAttribute('disabled'))).toBe(false);
    // ∞ ist gewählt (null) und hat einen lesbaren Namen
    const unlimited = limit().querySelectorAll('button')[0];
    expect(unlimited.getAttribute('aria-checked')).toBe('true');
    expect(unlimited.textContent).toContain('Unbegrenzt');

    await click(button(limit(), '2'));
    expect(changes.at(-1)).toEqual({ maxLegends: 2 });
    await click(unlimited);
    expect(changes.at(-1)).toEqual({ maxLegends: null });
    await click(button(field(container, 'Legendäre'), 'An'));
    expect(changes.at(-1)).toEqual({ legendary: true });
  });

  it('Rerolls nur mit Zufallsmodus und nur mit einer Alternative (mehrere Generationen bzw. Typen); Snake an/aus', async () => {
    const { container, changes } = await renderForm();
    expect(hasField(container, 'Typ-Rerolls')).toBe(false);
    expect(hasField(container, 'Regions-Rerolls')).toBe(false);
    expect(field(container, 'Zufallsmodus').textContent).toContain('Freie Wahl aus dem ganzen Pool.');

    await click(button(field(container, 'Zufallsmodus'), 'Pro Pick'));
    expect(changes.at(-1)).toEqual({ roll: 'pick' });
    expect(hasField(container, 'Typ-Rerolls')).toBe(true);
    // Standard: nur Generation 1 – ein Regions-Reroll ginge nie
    expect(hasField(container, 'Regions-Rerolls')).toBe(false);
    const note = () => container.querySelector('.draft-settings__rerollnote')!.textContent;
    expect(note()).toContain('Regions-Rerolls gibt es nur mit mehreren Generationen.');
    await click(button(field(container, 'Generationen'), 'Johto'));
    expect(hasField(container, 'Regions-Rerolls')).toBe(true);
    expect(note()).not.toContain('nur mit mehreren');
    // Standard: je ein Reroll
    expect(button(field(container, 'Typ-Rerolls'), '1').getAttribute('aria-checked')).toBe('true');
    await click(button(field(container, 'Typ-Rerolls'), '3'));
    expect(changes.at(-1)).toEqual({ rerolls: { type: 3, region: 1 } });
    await click(button(field(container, 'Regions-Rerolls'), '0'));
    expect(changes.at(-1)).toEqual({ rerolls: { type: 3, region: 0 } });

    await click(button(field(container, 'Zufallsmodus'), 'Pro Runde'));
    expect(changes.at(-1)).toEqual({ roll: 'round' });
    expect(field(container, 'Zufallsmodus').textContent).toContain('Ein Wurf pro Runde');
    await click(button(field(container, 'Zufallsmodus'), 'Aus'));
    expect(hasField(container, 'Typ-Rerolls')).toBe(false);

    expect(field(container, 'Snake-Draft').textContent).toContain('Jede zweite Runde rückwärts.');
    await click(button(field(container, 'Snake-Draft'), 'Aus'));
    expect(changes.at(-1)).toEqual({ snake: false });
    expect(field(container, 'Snake-Draft').textContent).toContain('Jede Runde dieselbe Reihenfolge.');
  });

  it('nur ein Typ: keine Typ-Rerolls; ein strengeres Legendären-Limit, für das der Pool nicht reicht, ist gesperrt', async () => {
    const { container: c1 } = await renderForm({ gens: [...DRAFT_ALL_GENS], types: ['water'], roll: 'round' });
    expect(hasField(c1, 'Typ-Rerolls')).toBe(false);
    expect(hasField(c1, 'Regions-Rerolls')).toBe(true);
    expect(c1.querySelector('.draft-settings__rerollnote')!.textContent).toContain('Typ-Rerolls gibt es nur mit mehreren Typen.');

    // Gen 7 mit Legendären: 8 Teams sind dabei – Limit 1 trüge nur 7 (Legendäre zählen nur bis zum Limit)
    const { container: c2, changes } = await renderForm(
      { gens: [7], legendary: true, mythical: true, maxTeams: 8 },
      { teamsJoined: 8 },
    );
    const limit = field(c2, 'Legendäre pro Team');
    const one = button(limit, '1');
    expect(one.hasAttribute('disabled')).toBe(true);
    expect(one.getAttribute('title')).toBe('Pool zu klein für 8 Teams');
    expect(button(limit, '2').hasAttribute('disabled')).toBe(false);
    await click(button(limit, '2'));
    expect(changes).toEqual([{ maxLegends: 2 }]);
  });

  it('Änderung unterwegs: Chips nehmen nichts an', async () => {
    const { container, changes } = await renderForm({}, { busy: true });
    const johto = button(field(container, 'Generationen'), 'Johto');
    expect(johto.getAttribute('aria-disabled')).toBe('true');
    await click(johto);
    await click(button(field(container, 'Typen'), 'Feuer'));
    expect(changes).toEqual([]);
  });

  it('Englisch: alle neuen Bedienelemente ohne Deutsch', async () => {
    english();
    const { container } = await renderForm({ gens: [1, 5], legendary: true, roll: 'round', snake: false });
    for (const label of ['Generations', 'Types', 'Legendaries', 'Mythicals', 'Legendaries per team', 'Random mode', 'Type rerolls', 'Region rerolls', 'Snake draft']) {
      expect(hasField(container, label), label).toBe(true);
    }
    expect(button(field(container, 'Generations'), 'Unova').getAttribute('aria-pressed')).toBe('true');
    expect(button(field(container, 'Random mode'), 'Per round').getAttribute('aria-checked')).toBe('true');
    await click(button(field(container, 'Types'), 'None'));
    expect(container.querySelector('.draft-settings__typedraft')!.textContent).toContain('Tap the types you want');
    await click(button(field(container, 'Types'), 'Fire'));
    expect(container.querySelector('.draft-settings__typedraft')!.textContent).toContain('New selection:');
    expect(button(container.querySelector('.draft-settings__typedraft')!, 'Apply')).toBeTruthy();
    expect(button(container.querySelector('.draft-settings__typedraft')!, 'Cancel')).toBeTruthy();
    expect(germanLeft(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------- /draft: Erstellen und öffentliche Lobbys

describe('/draft (Online-Modus)', () => {
  it('Lobby-Liste zeigt „Mehrere Generationen"; ältere gespeicherte Einstellungen (region/legends) werden übernommen', async () => {
    save('draft-online:settings', { name: '', region: 3, legends: true, maxTeams: 2, pickSeconds: 30 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('data/pokemon.json')) return json(200, ALL);
        if (url.endsWith('data/forms.json')) return json(200, []);
        if (url.endsWith('/drafts/public')) {
          return json(200, {
            lobbies: [
              { code: 'QWE789', name: 'Mix', hostName: 'Mix FC', teams: 1, maxTeams: 2, region: 10, legends: false, pickSeconds: 0, createdAt: Date.now() - 60_000 },
              // Nur Mysteriöse im Pool: Die Spalte legends ist an – das Etikett darf nicht „Legendäre" allein sagen
              { code: 'MYT234', name: 'Myth', hostName: 'Myth FC', teams: 1, maxTeams: 2, region: 1, legends: true, pickSeconds: 30, createdAt: Date.now() - 60_000 },
            ],
          });
        }
        throw new TypeError('Failed to fetch');
      }),
    );
    const { container } = await render(app(h(DraftOnline, { modeSwitch: null, supported: true, onRetry: vi.fn(), onLocal: vi.fn() })));
    expect(container.querySelector('.draft-lobbies')!.textContent).toContain('Mehrere Generationen');
    expect(container.querySelector('.draft-lobbies')!.textContent).toContain('Kanto + Legendäre/Mysteriöse');
    const gens = field(container, 'Generationen');
    expect(button(gens, 'Hoenn').getAttribute('aria-pressed')).toBe('true');
    expect(button(gens, 'Kanto').getAttribute('aria-pressed')).toBe('false');
    expect(button(field(container, 'Legendäre'), 'An').getAttribute('aria-checked')).toBe('true');
    expect(button(field(container, 'Mysteriöse'), 'An').getAttribute('aria-checked')).toBe('true');
    expect(button(field(container, 'Pick-Timer'), '30 s').getAttribute('aria-checked')).toBe('true');
  });
});

// ---------------------------------------------------------------- Kurzfassung

describe('DraftSettingsSummary', () => {
  const custom: DraftSettings = {
    ...DEFAULT_DRAFT_SETTINGS,
    gens: [1, 2],
    types: ['fire', 'water'],
    legendary: true,
    mythical: false,
    maxLegends: 2,
    roll: 'round',
    rerolls: { type: 2, region: 0 },
    snake: false,
    pickSeconds: 60,
  };
  const items = (c: MiniElement) => c.querySelectorAll('.draft-summary li').map((li) => li.textContent);

  it('zeigt Pool, Typen, Legendäre, Limit, Zufallsmodus, Rerolls und Reihenfolge', async () => {
    const { container } = await render(app(h(DraftSettingsSummary, { settings: custom })));
    expect(items(container)).toEqual([
      'Pool: Kanto, Johto',
      'Typen: Feuer, Wasser',
      'mit Legendären, ohne Mysteriöse',
      'höchstens 2 Legendäre pro Team',
      'ohne Standardschütze',
      'Liga mit 18 Teams',
      'bis 4 Teams',
      'Reihenfolge zufällig',
      'jede Runde gleiche Reihenfolge',
      'Zufallsmodus: pro Runde',
      'Rerolls: 2× Typ',
      '60 s pro Pick',
      'privat',
    ]);
  });

  it('Rerolls nur, wenn sie gehen können; Limit 1 in der Einzahl', async () => {
    const random = { ...DEFAULT_DRAFT_SETTINGS, roll: 'pick' as const, rerolls: { type: 1, region: 2 } };
    const { container } = await render(
      app(
        h(
          'div',
          null,
          // Nur Generation 1: kein Regions-Reroll
          h(DraftSettingsSummary, { settings: random }),
          h(DraftSettingsSummary, { settings: { ...random, gens: [1, 2] } }),
          // Nur ein Typ: kein Typ-Reroll
          h(DraftSettingsSummary, { settings: { ...random, gens: [1, 2], types: ['water'] } }),
          h(DraftSettingsSummary, { settings: { ...random, types: ['water'] } }),
          h(DraftSettingsSummary, { settings: { ...DEFAULT_DRAFT_SETTINGS, legendary: true, maxLegends: 1 } }),
        ),
      ),
    );
    const [onlyType, both, onlyRegion, none, limitOne] = container.querySelectorAll('.draft-summary').map(items);
    expect(onlyType).toContain('Rerolls: 1× Typ');
    expect(both).toContain('Rerolls: 1× Typ, 2× Region');
    expect(onlyRegion).toContain('Rerolls: 2× Region');
    expect(none).toContain('ohne Rerolls');
    expect(limitOne).toContain('höchstens ein Legendäres pro Team');
  });

  it('Standard: keine Typen-Zeile, kein Limit, kein Zufallsmodus; viele Generationen als Zahl', async () => {
    const { container } = await render(
      app(
        h(
          'div',
          null,
          h(DraftSettingsSummary, { settings: { ...DEFAULT_DRAFT_SETTINGS, maxLegends: 3 } }),
          h(DraftSettingsSummary, { settings: { ...DEFAULT_DRAFT_SETTINGS, gens: [1, 2, 3, 4, 5], types: TYPE_KEYS.slice(0, 6) } }),
          h(DraftSettingsSummary, { settings: { ...DEFAULT_DRAFT_SETTINGS, gens: [...DRAFT_ALL_GENS], mythical: true } }),
        ),
      ),
    );
    const [plain, many, all] = container.querySelectorAll('.draft-summary').map(items);
    expect(plain).toEqual([
      'Pool: Kanto',
      'ohne Legendäre und Mysteriöse',
      'ohne Standardschütze',
      'Liga mit 18 Teams',
      'bis 4 Teams',
      'Reihenfolge zufällig',
      'Snake-Draft',
      '60 s pro Pick',
      'privat',
    ]);
    expect(many.slice(0, 2)).toEqual(['Pool: 5 Generationen', '6 von 18 Typen']);
    expect(all.slice(0, 2)).toEqual(['Pool: Alle', 'mit Mysteriösen, ohne Legendäre']);
  });

  it('Englisch ohne Deutsch', async () => {
    english();
    const { container } = await render(app(h(DraftSettingsSummary, { settings: { ...custom, roll: 'pick', snake: true } })));
    expect(items(container)).toEqual([
      'Pool: Kanto, Johto',
      'Types: Fire, Water',
      'with legendaries, no mythicals',
      'max. 2 legendaries per team',
      'no set-piece taker',
      'League with 18 teams',
      'up to 4 teams',
      'random order',
      'snake draft',
      'random mode: per pick',
      'rerolls: 2× type',
      '60 s per pick',
      'private',
    ]);
    expect(germanLeft(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------- Live-Draft mit Wurf

describe('DraftLive im Zufallsmodus', () => {
  async function renderLive(room: DraftRoom) {
    return render(app(h(DraftLive, { room })));
  }
  const started = (settings: DraftSettingsPatch = RANDOM) => engine.startDraft(lobby(2, settings), 'dev-h', 0, ALL);
  const cards = (c: MiniElement) => c.querySelectorAll('.pgrid [data-grid-item]');
  const fitToggle = (c: MiniElement) =>
    c.querySelectorAll('.draft-pooltools label').find((l) => l.textContent?.includes('Nur passende'))?.querySelector('input') ?? null;

  it('eigener Zug: Wurf in der Statusleiste, Reroll-Knöpfe mit Zahl, nur passende Pokémon', async () => {
    const s = started();
    const roll = s.roll!;
    expect(roll).not.toBeNull();
    const room = fakeRoom(snap(s, 'h'));
    const { container } = await renderLive(room);
    const bar = container.querySelector('.draft-turnbar .draft-roll')!;
    expect(bar).not.toBeNull();
    const value = bar.querySelector('.draft-roll__value')!;
    // Für Screenreader ein Satz, die sichtbaren Teile sind ausgeblendet
    expect(value.querySelector('.sr-only')!.textContent).toBe(`Wurf: ${de.game.region[roll.gen]}, Typ ${de.game.type[roll.type]}`);
    expect(value.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(value.querySelector('.draft-roll__gen')!.textContent).toBe(de.game.region[roll.gen]);
    expect(value.querySelector('.type-badge')!.textContent).toBe(de.game.type[roll.type]);
    expect(bar.querySelector('.draft-roll__own')).toBeNull();

    // Reroll-Knöpfe mit den übrigen Rerolls; Klick → room.reroll(Art)
    const rerolls = bar.querySelectorAll('.draft-roll__reroll');
    expect(rerolls.map((b) => b.textContent)).toEqual(['Typ neu würfeln (1×)', 'Region neu würfeln (2×)']);
    await click(rerolls[0]);
    expect(room.reroll).toHaveBeenCalledWith('type');
    await click(rerolls[1]);
    expect(room.reroll).toHaveBeenCalledWith('region');

    // „Nur passende" ist an: Jede Karte passt zum Wurf, keine ist ausgegraut
    expect(fitToggle(container)!.checked).toBe(true);
    const allowed = engine.allowedPicks(snap(s, 'h'), 'h', ALL);
    expect(cards(container)).toHaveLength(Math.min(84, allowed.length));
    expect(container.querySelectorAll('.pgrid .pcard__reason')).toHaveLength(0);
    for (const card of cards(container)) {
      const name = card.querySelector('.pcard__name')!.textContent;
      const p = ALL.find((x) => x.de === name)!;
      expect(engine.matchesRoll(p, roll), name).toBe(true);
    }
    expect(container.querySelector('p.hint')!.textContent).toContain(
      `Gesucht: ${de.game.region[roll.gen]} + ${de.game.type[roll.type]}.`,
    );

    // Umschalter aus: alle freien Pokémon, die unpassenden ausgegraut mit Grund
    const toggle = fitToggle(container)!;
    toggle.checked = false;
    await click(toggle);
    const reasons = container.querySelectorAll('.pgrid .pcard__reason').map((r) => r.textContent);
    expect(reasons.length).toBeGreaterThan(0);
    expect(new Set(reasons)).toEqual(new Set(['Passt nicht zum Wurf']));
    const greyed = container.querySelectorAll('.pgrid .pcard.is-disabled')[0];
    expect(greyed.getAttribute('aria-disabled')).toBe('true');
    expect(greyed.getAttribute('title')).toBe('Passt nicht zum Wurf');
  });

  it('fremder Zug: Wurf sichtbar, aber keine Reroll-Knöpfe und nichts ausgegraut', async () => {
    const s = started();
    const { container } = await renderLive(fakeRoom(snap(s, 't1')));
    expect(container.querySelector('.draft-roll__value')).not.toBeNull();
    expect(container.querySelectorAll('.draft-roll__reroll')).toHaveLength(0);
    expect(fitToggle(container)).toBeNull();
    expect(container.querySelectorAll('.pgrid .pcard__reason')).toHaveLength(0);
  });

  it('Reroll läuft: Knopf nimmt nichts an; ohne Rerolls übrig gesperrt mit Grund; nach Reroll „eigener Wurf"', async () => {
    let s = started();
    s = engine.applyReroll(s, 'h', 'type', ALL); // der einzige Typ-Reroll ist weg
    const busy = fakeRoom(snap(s, 'h'), {
      busy: { pick: false, 'auto-pick': false, start: false, join: false, 'add-cpu': false, settings: false, reroll: true },
    });
    const { container } = await renderLive(busy);
    expect(container.querySelector('.draft-roll__own')!.textContent).toBe('eigener Wurf');
    const [type, region] = container.querySelectorAll('.draft-roll__reroll');
    expect(type.textContent).toBe('Typ neu würfeln (0×)');
    // Gesperrt, aber fokussierbar – der Grund steht sichtbar daneben (nicht nur im Tooltip)
    expect(type.hasAttribute('disabled')).toBe(false);
    expect(type.getAttribute('aria-disabled')).toBe('true');
    const why = byDomId(container, type.getAttribute('aria-describedby'))!;
    expect(why.textContent).toBe('Keine Rerolls dieser Art mehr übrig');
    expect(why.className).toBe('draft-roll__why');
    await click(type);
    expect(region.getAttribute('aria-disabled')).toBe('true');
    await click(region);
    expect(busy.reroll).not.toHaveBeenCalled();
  });

  it('kein anderer Wurf möglich: Grund sichtbar; nur eine Generation bzw. ein Typ: kein Knopf dafür', async () => {
    // Gen 1 hat keine Unlicht-Pokémon: aus (Kanto, Normal) gibt es keinen anderen Typ
    const s = started({ ...RANDOM, gens: [1, 2], types: ['normal', 'dark'], maxTeams: 2, rerolls: { type: 1, region: 1 } });
    const fixed: DraftState = { ...s, roll: { gen: 1, type: 'normal', own: false } };
    expect(engine.canReroll(fixed, 'h', 'type', ALL)).toBe(false);
    expect(engine.canReroll(fixed, 'h', 'region', ALL)).toBe(true);
    const room = fakeRoom(snap(fixed, 'h'));
    const { container } = await renderLive(room);
    const [type, region] = container.querySelectorAll('.draft-roll__reroll');
    expect(type.getAttribute('aria-disabled')).toBe('true');
    expect(byDomId(container, type.getAttribute('aria-describedby'))!.textContent).toBe('Kein anderer Wurf möglich');
    await click(type);
    expect(room.reroll).not.toHaveBeenCalled();
    expect(region.getAttribute('aria-disabled')).toBeNull();
    expect(region.getAttribute('aria-describedby')).toBeNull();
    await click(region);
    expect(room.reroll).toHaveBeenCalledWith('region');

    // Nur Generation 1 (Rerolls eingestellt): kein Regions-Knopf, der nie ginge
    const one = started({ ...RANDOM, gens: [1], rerolls: { type: 1, region: 2 } });
    const { container: c2 } = await renderLive(fakeRoom(snap(one, 'h')));
    expect(c2.querySelectorAll('.draft-roll__reroll').map((b) => b.textContent)).toEqual(['Typ neu würfeln (1×)']);
    // Nur ein Typ: kein Typ-Knopf
    const water = started({ ...RANDOM, types: ['water'], rerolls: { type: 3, region: 1 } });
    const { container: c3 } = await renderLive(fakeRoom(snap(water, 'h')));
    expect(c3.querySelectorAll('.draft-roll__reroll').map((b) => b.textContent)).toEqual(['Region neu würfeln (1×)']);
  });

  it('Pick unterwegs: Reroll nimmt nichts an; Reroll unterwegs: kein Platz als Ziel, kein Pick', async () => {
    const s = started();
    const picking = fakeRoom(snap(s, 'h'), {
      pending: true,
      busy: { pick: true, 'auto-pick': false, start: false, join: false, 'add-cpu': false, settings: false, reroll: false },
    });
    const { container } = await renderLive(picking);
    for (const b of container.querySelectorAll('.draft-roll__reroll')) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      await click(b);
    }
    expect(picking.reroll).not.toHaveBeenCalled();

    const rerolling = fakeRoom(snap(s, 'h'), {
      busy: { pick: false, 'auto-pick': false, start: false, join: false, 'add-cpu': false, settings: false, reroll: true },
    });
    const { container: c2 } = await renderLive(rerolling);
    await click(c2.querySelectorAll('button.pcard')[0]);
    expect(c2.querySelectorAll('.slot--target')).toHaveLength(0);
    await click(c2.querySelectorAll('button.slot.slot--empty')[0]);
    expect(rerolling.pick).not.toHaveBeenCalled();

    // Gegenprobe: ohne laufende Aktion sind freie Plätze Ziele, und ein Klick wählt
    const idle = fakeRoom(snap(s, 'h'));
    const { container: c3 } = await renderLive(idle);
    await click(c3.querySelectorAll('button.pcard')[0]);
    expect(c3.querySelectorAll('.slot--target').length).toBeGreaterThan(0);
    await click(c3.querySelectorAll('button.slot.slot--target')[0]);
    expect(idle.pick).toHaveBeenCalled();
  });

  it('Regionsfilter: nur die Generationen des Pools; versteckt (eigener Wurf, „Nur passende") filtert er nicht weiter', async () => {
    const settings: DraftSettingsPatch = { ...RANDOM, gens: [1, 2] };
    const s0 = started(settings);
    // Gast-Sicht: Der Host ist dran
    const { container, root } = await render(app(h(DraftLive, { room: fakeRoom(snap(s0, 't1')) })));
    const regionGroup = () =>
      container.querySelectorAll('.filterbar [role="group"]').find((g) => g.getAttribute('aria-label') === 'Regions-Filter') ?? null;
    expect(regionGroup()!.querySelectorAll('button').map((b) => b.textContent)).toEqual(['Alle Regionen', 'Kanto', 'Johto']);
    await click(button(regionGroup()!, 'Johto'));
    expect(cards(container).length).toBeGreaterThan(0);
    expect(cards(container).every((c) => byId.get(ALL.find((p) => p.de === c.querySelector('.pcard__name')!.textContent)!.id)!.gen === 2)).toBe(true);

    // Der Host wählt – jetzt ist der Gast dran, sein Wurf: Kanto + Wasser
    const c = engine.autoPickChoice(s0, 'h', ALL, (await import('../src/lib/fit')).buildScale(ALL, 'all'), false);
    const picked = engine.applyPick(s0, 'h', c.pokemonId, c.slot, false, 1000, ALL);
    const mine: DraftState = { ...picked, roll: { gen: 1, type: 'water', own: false } };
    const allowed = engine.allowedPicks(mine, 't1', ALL);
    expect(allowed.length).toBeGreaterThan(5);
    await act(async () => root.render(app(h(DraftLive, { room: fakeRoom(snap(mine, 't1')) }))));
    await settle();
    // Regionsfilter ausgeblendet – und das vorher gewählte Johto leert das Raster nicht
    expect(regionGroup()).toBeNull();
    expect(cards(container)).toHaveLength(Math.min(84, allowed.length));
    expect(container.querySelector('.filterbar__count')).toBeNull();

    // „Nur passende" aus: Filter wieder sichtbar, mit der gemerkten Auswahl
    const toggle = fitToggle(container)!;
    toggle.checked = false;
    await click(toggle);
    expect(regionGroup()!.querySelector('[aria-pressed="true"]')!.textContent).toBe('Johto');
    expect(cards(container).length).toBeGreaterThan(0);
  });

  it('Rerolls auf 0: keine Knöpfe; Runden-Modus zeigt den Rundenwurf neben einem eigenen Wurf', async () => {
    const s = started({ ...RANDOM, roll: 'round', rerolls: { type: 0, region: 0 } });
    const { container } = await renderLive(fakeRoom(snap(s, 'h')));
    expect(container.querySelector('.draft-roll__value')).not.toBeNull();
    expect(container.querySelectorAll('.draft-roll__reroll')).toHaveLength(0);
    // Eigener Wurf im Runden-Modus (künstlich): Rundenwurf steht klein daneben
    const own = snap({ ...s, roll: { gen: s.roundRoll!.gen === 1 ? 2 : 1, type: 'water', own: true } }, 'h');
    const { container: c2 } = await renderLive(fakeRoom(own));
    expect(c2.querySelector('.draft-roll__round')!.textContent).toBe(
      `Rundenwurf: ${de.game.region[s.roundRoll!.gen]} + ${de.game.type[s.roundRoll!.type]}`,
    );
  });

  it('Legendären-Limit: Zähler in der Statusleiste, gesperrte Legendäre mit Grund – auch ohne Wurf', async () => {
    let s = started({ gens: [...DRAFT_ALL_GENS], maxTeams: 4, order: 'host', pickSeconds: 0, legendary: true, mythical: true, maxLegends: 1 });
    s = engine.applyPick(s, 'h', 150, 0, false, 1000, ALL); // Mewtu
    const { container } = await renderLive(fakeRoom(snap(s, 'h')));
    expect(container.querySelector('.draft-turnbar__legends')!.textContent).toBe('Legendäre 1/1');
    // Kein Zufallsmodus → kein Wurf
    expect(container.querySelector('.draft-roll')).toBeNull();
    const toggle = fitToggle(container)!;
    expect(toggle.checked).toBe(true);
    const names = () => cards(container).map((c) => c.querySelector('.pcard__name')!.textContent);
    expect(names()).not.toContain(byId.get(151)!.de); // Mew
    toggle.checked = false;
    await click(toggle);
    // Mew (Nr. 151) liegt hinter den ersten 84 Karten: zwei Seiten nachladen
    await act(async () => FakeObserver.fireAll());
    await act(async () => FakeObserver.fireAll());
    const mew = cards(container).find((c) => c.querySelector('.pcard__name')!.textContent === byId.get(151)!.de)!;
    expect(mew.querySelector('.pcard__reason')!.textContent).toBe('Limit: ein Legendäres');
    // Board: ★ 1/1 beim Host
    const board = container.querySelector('.draft-board__legends')!;
    expect(board.querySelector('[aria-hidden="true"]')!.textContent).toBe('★ 1/1');
    expect(board.querySelector('.sr-only')!.textContent).toBe('1 von höchstens einem Legendären/Mysteriösen');
  });

  it('Ansage und Verlauf nennen den Wurf', async () => {
    let s = started();
    const first = s.roll!;
    expect(hook.pickAnnouncement(snap(s, 't1'), byId, de)).toBe(`Wurf: ${de.game.region[first.gen]}, Typ ${de.game.type[first.type]}.`);
    const c = engine.autoPickChoice(s, 'h', ALL, (await import('../src/lib/fit')).buildScale(ALL, 'all'), false);
    s = engine.applyPick(s, 'h', c.pokemonId, c.slot, false, 1000, ALL);
    const next = s.roll!;
    expect(hook.pickAnnouncement(snap(s, 'h'), byId, de)).toBe(
      `Pick 1: ${byId.get(c.pokemonId)!.de} an dich. Am Zug: Team 1. Wurf: ${de.game.region[next.gen]}, Typ ${de.game.type[next.type]}.`,
    );
    const feed = hook.pickFeed(snap(s), byId, 8, de);
    expect(feed[0].roll).toEqual({ region: de.game.region[first.gen], type: first.type });
    const { container } = await render(app(h(DraftPickFeed, { items: feed, you: 'h' })));
    const roll = container.querySelector('.draft-feed__roll')!;
    expect(roll.getAttribute('title')).toBe(`Wurf: ${de.game.region[first.gen]} + ${de.game.type[first.type]}`);
    expect(roll.querySelector('.type-badge')!.textContent).toBe(de.game.type[first.type]);
  });

  it('Englisch: Wurf, Reroll-Knöpfe, Umschalter und Gründe ohne Deutsch', async () => {
    english();
    const s = started();
    const roll = s.roll!;
    const en = messages('en');
    const { container } = await renderLive(fakeRoom(snap(s, 'h')));
    const bar = container.querySelector('.draft-roll')!;
    expect(bar.querySelector('.draft-roll__value .sr-only')!.textContent).toBe(
      `Roll: ${en.game.region[roll.gen]}, type ${en.game.type[roll.type]}`,
    );
    expect(bar.querySelectorAll('.draft-roll__reroll').map((b) => b.textContent)).toEqual(['Reroll type (1×)', 'Reroll region (2×)']);
    const toggle = container
      .querySelectorAll('.draft-pooltools label')
      .find((l) => l.textContent?.includes('Matching only'))!
      .querySelector('input')!;
    toggle.checked = false;
    await click(toggle);
    expect(container.querySelector('.pgrid .pcard__reason')!.textContent).toBe('Doesn’t match the roll');
    expect(germanLeft(bar)).toEqual([]);
    expect(germanLeft(container.querySelector('.draft-pooltools')!)).toEqual([]);
    expect(germanLeft(container.querySelector('p.hint')!)).toEqual([]);
    expect(germanLeft(container.querySelector('.draft-live [aria-live]')!)).toEqual([]);
  });
});

// ---------------------------------------------------------------- Raum-Hook: Reroll über den WebSocket

describe('Reroll über useDraftRoom', () => {
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
    close() {
      this.readyState = 3;
    }
    messages() {
      return this.sent.map((x) => JSON.parse(x) as { type: string } & Record<string, unknown>);
    }
  }

  let room!: DraftRoom;
  /** Raum-Seite im Kleinen: Hook + Live-Draft */
  function Room() {
    room = hook.useDraftRoom('ABC234');
    return room.state ? h(DraftLive, { room }) : null;
  }

  async function connect(first: DraftState, you = 'h') {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubFetch(() => snap(first, null));
    const { container } = await render(app(h(Room)));
    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws.readyState = 1;
      ws.onopen?.();
    });
    const say = (msg: unknown) => act(async () => ws.onmessage?.({ data: JSON.stringify(msg) }));
    await say({ type: 'state', state: snap(first, you) });
    return { container, ws, say };
  }

  it('Klick sendet {type: "reroll", kind}; Sperre bis zum neuen Wurf; Doppelklick sendet einmal', async () => {
    const s = engine.startDraft(lobby(2, RANDOM), 'dev-h', 0, ALL);
    const { container, ws, say } = await connect(s);
    const typeButton = () => container.querySelectorAll('.draft-roll__reroll')[0];
    expect(typeButton().textContent).toBe('Typ neu würfeln (1×)');
    await click(typeButton());
    await click(typeButton());
    // Gezielt: Pick und Wurf, die der Client gesehen hat (sonst lehnt der Server mit „stale" ab)
    expect(ws.messages().filter((m) => m.type === 'reroll')).toEqual([
      { type: 'reroll', kind: 'type', pickIndex: 0, roll: { gen: s.roll!.gen, type: s.roll!.type } },
    ]);
    expect(room.busy.reroll).toBe(true);
    expect(typeButton().getAttribute('aria-disabled')).toBe('true');

    // Fremder Schnappschuss (Online-Wechsel) löst die Sperre nicht …
    await say({ type: 'state', state: snap(engine.setOnline(s, 't1', true), 'h') });
    expect(room.busy.reroll).toBe(true);
    // … erst der neue Wurf
    const rerolled = engine.applyReroll(s, 'h', 'type', ALL);
    await say({ type: 'state', state: snap(rerolled, 'h') });
    expect(room.busy.reroll).toBe(false);
    expect(container.querySelector('.draft-roll__own')).not.toBeNull();
    expect(typeButton().textContent).toBe('Typ neu würfeln (0×)');
    expect(typeButton().getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('.draft-roll__why')!.textContent).toBe('Keine Rerolls dieser Art mehr übrig');
  });

  it('Pick und Reroll sperren sich gegenseitig (Snake-Doppelzug: kein Reroll auf den ungesehenen Wurf)', async () => {
    const s0 = engine.startDraft(lobby(2, RANDOM), 'dev-h', 0, ALL);
    // Pick 0 (Host) – Team 1 ist jetzt für Pick 1 und 2 dran
    const c0 = engine.allowedPicks(s0, 'h', ALL)[0];
    const s1 = engine.applyPick(s0, 'h', c0.id, 0, false, 1000, ALL);
    const { container, ws, say } = await connect(s1, 't1');
    const p1 = engine.allowedPicks(s1, 't1', ALL)[0];
    let ok = false;
    await act(async () => {
      ok = room.pick(p1.id, 0);
    });
    expect(ok).toBe(true);
    expect(room.busy.pick).toBe(true);
    // Reroll-Knöpfe gesperrt, und auch direkt geht nichts raus
    const rerollButtons = container.querySelectorAll('.draft-roll__reroll');
    expect(rerollButtons.length).toBeGreaterThan(0);
    for (const b of rerollButtons) expect(b.getAttribute('aria-disabled')).toBe('true');
    await click(rerollButtons[0]);
    await act(async () => {
      ok = room.reroll('type');
    });
    expect(ok).toBe(false);
    expect(ws.messages().filter((m) => m.type === 'reroll')).toEqual([]);

    // Pick bestätigt (Pick 2, wieder Team 1): Reroll geht wieder – gezielt auf den neuen Wurf
    const s2 = engine.applyPick(s1, 't1', p1.id, 0, false, 2000, ALL);
    await say({ type: 'state', state: snap(s2, 't1') });
    expect(room.busy.pick).toBe(false);
    await act(async () => {
      ok = room.reroll('type');
    });
    expect(ok).toBe(true);
    expect(ws.messages().filter((m) => m.type === 'reroll')).toEqual([
      { type: 'reroll', kind: 'type', pickIndex: 2, roll: { gen: s2.roll!.gen, type: s2.roll!.type } },
    ]);
    // Reroll unterwegs: kein Pick (der Wurf ändert sich gleich)
    const p2 = engine.allowedPicks(s2, 't1', ALL)[0];
    await act(async () => {
      ok = room.pick(p2.id, 1);
    });
    expect(ok).toBe(false);
    expect(ws.messages().filter((m) => m.type === 'pick')).toHaveLength(1);
  });

  it('Fehler zum Reroll gibt die Sperre frei; Vorprüfung: nicht dran → nichts gesendet', async () => {
    const s = engine.startDraft(lobby(2, RANDOM), 'dev-h', 0, ALL);
    const { ws, say } = await connect(s);
    await act(async () => void room.reroll('region'));
    expect(room.busy.reroll).toBe(true);
    // Ein Fehler zu einer anderen Aktion löst sie nicht
    await say({ type: 'error', code: 'rate_limited', message: 'Zu viele Änderungen', for: 'settings' });
    expect(room.busy.reroll).toBe(true);
    await say({ type: 'error', code: 'no_other_roll', message: 'Kein anderer Wurf möglich', for: 'reroll' });
    expect(room.busy.reroll).toBe(false);
    expect(room.error).toBe('Kein anderer Wurf möglich');

    // Team 1 ist nicht dran: Die Engine lehnt schon im Browser ab
    await say({ type: 'state', state: snap(s, 't1') });
    let sent = true;
    await act(async () => {
      sent = room.reroll('type');
    });
    expect(sent).toBe(false);
    expect(room.error).toBe('Du bist nicht dran');
    expect(ws.messages().filter((m) => m.type === 'reroll')).toHaveLength(1);
  });

  it('Deutsch: Legendären-Limit in Einzahl und Mehrzahl; neue Pool-Meldungen auch auf Englisch', () => {
    expect(de.draft.summary.maxLegends(1)).toBe('höchstens ein Legendäres pro Team');
    expect(de.draft.summary.maxLegends(3)).toBe('höchstens 3 Legendäre pro Team');
    expect(de.online.blockedLegends(1)).toBe('Limit: ein Legendäres');
    expect(de.online.blockedLegends(2)).toBe('Limit: 2 Legendäre');
    expect(de.draft.board.legendsTitle(0, 1)).toBe('0 von höchstens einem Legendären/Mysteriösen');
    expect(de.draft.board.legendsTitle(1, 3)).toBe('1 von höchstens 3 Legendären/Mysteriösen');
    expect(hook.draftErrorText('Höchstens ein Legendäres/Mysteriöses pro Team', 'bad_pick', ALL, 'en')).toBe(
      'At most one legendary/mythical per team',
    );
    expect(hook.draftErrorText('Der Pool reicht nur für 7 Teams à 11 Pokémon (Limits)', 'pool_too_small', ALL, 'en')).toBe(
      'The pool is only big enough for 7 teams of 11 Pokémon each (limits)',
    );
    expect(hook.draftErrorText('Höchstens 2 Ultrabestien pro Team', 'bad_pick', ALL, 'en')).toBe('At most 2 Ultra Beasts per team');
    expect(hook.draftErrorText('Höchstens eine Ultrabestie pro Team', 'bad_pick', ALL, 'en')).toBe('At most one Ultra Beast per team');
    expect(hook.draftErrorText('Der Pool reicht nur für 3 Teams à 11 Pokémon', 'pool_too_small', ALL, 'en')).toBe(
      'The pool is only big enough for 3 teams of 11 Pokémon each',
    );
    expect(
      hook.draftErrorText('Mit den Limits reicht der Pool nur für 80 Picks, gebraucht werden 88', 'pool_too_small', ALL, 'en'),
    ).toBe('With the limits the pool only covers 80 picks, 88 are needed');
  });

  it('startBlocker wie startDraft: Legendäre zählen nur, soweit das Limit sie aufnimmt', () => {
    let s = lobby(2, { gens: [7], legendary: true, mythical: true, maxTeams: 8 });
    for (let i = 1; i <= 6; i++) s = engine.addCpuTeam(s, 'dev-h', `cpu${i}`);
    expect(hook.startBlocker(snap(s), ALL, de)).toBeNull();
    const tight: DraftState = { ...s, settings: { ...s.settings, maxLegends: 1 } };
    const cap = engine.poolPickCapacity(tight.settings, 8, ALL);
    expect(cap).toBeLessThan(88);
    expect(hook.startBlocker(snap(tight), ALL, de)).toBe(`Mit den Limits reicht der Pool nur für ${cap} Picks, gebraucht werden 88`);
    expect(() => engine.startDraft(tight, 'dev-h', 0, ALL)).toThrow(hook.startBlocker(snap(tight), ALL, de)!);
  });

  it('Englisch: Meldungen zu Wurf und Limit werden übersetzt (mit Pokémon-Namen)', () => {
    const glurak = ALL.find((p) => p.de === 'Glurak')!;
    expect(hook.draftErrorText(`${glurak.de} passt nicht zum Wurf`, 'bad_pick', ALL, 'en')).toBe(`${glurak.en} doesn’t match the roll`);
    expect(hook.draftErrorText('Höchstens 2 Legendäre/Mysteriöse pro Team', 'bad_pick', ALL, 'en')).toBe(
      'At most 2 legendaries/mythicals per team',
    );
    expect(hook.draftErrorText('Kein Regions-Reroll mehr übrig', 'no_reroll', ALL, 'en')).toBe('No region rerolls left');
    expect(hook.draftErrorText('Etwas Neues', 'no_other_roll', ALL, 'en')).toBe('No other roll possible');
    expect(hook.draftErrorText('Kein anderer Wurf möglich', 'no_other_roll', ALL, 'de')).toBe('Kein anderer Wurf möglich');
  });
});
