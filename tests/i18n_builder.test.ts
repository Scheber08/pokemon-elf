/**
 * Übersetzung des Builders und der gemeinsamen Bausteine (Spielfeld, Teamblatt, Auswahl-Dialog,
 * Filter, Raster, Werte-/Positions-Tooltip, Export-Bild, Ladebildschirm, Regions-Texte):
 * Mit Englisch als gespeicherter Sprache darf kein Deutsch mehr erscheinen – weder als Text noch in
 * aria-label/title/alt/placeholder. Deutsch bleibt unverändert.
 * Gerendert wird mit react-dom/client auf dem Mini-DOM (tests/miniDom.ts).
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL } from './helpers';
import { installMiniDom, type MiniElement, type MiniNode } from './miniDom';

const doc = installMiniDom();
// React-DOM und alles mit UI erst nach dem Mini-DOM laden
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { Builder } = await import('../src/pages/Builder');
const { Header } = await import('../src/components/Layout');
const { StatTooltip, PositionTooltip, dexNo, fmtNum } = await import('../src/components/StatTooltip');
const { ExportCard } = await import('../src/components/ExportCard');
const { matchesQuery } = await import('../src/components/FilterBar');
const { PokemonDataProvider } = await import('../src/state/PokemonData');
const { SettingsProvider } = await import('../src/state/Settings');
const { ToastProvider } = await import('../src/state/Toast');
const { regionLabel, regionName, regionPhrase } = await import('../src/config/regions');
const { setCurrentLang } = await import('../src/i18n/lang');
const { de } = await import('../src/i18n/de');
const { en } = await import('../src/i18n/en');

const { act, createElement: h } = React;

const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|für|auf|aus|leer|kein|keine|eine|Spieler|Spielfeld|Wähle|wählen|Aufstellung|Einstellungen|Legendäre|Bild|Zufällig|Zurücksetzen|Alles|Alle|Typ|Typen|Treffer|Teamblatt|Teamname|Aktionen|Wichtig|Gewicht|Kader|Torwart|Stürmer|Schlüssel|Hilft|Platz|Pkt|Meine|Einall|Relaxo|Turtok|Glurak|Bisaflor|Nr)\b/;

/** Gespeicherte Einstellungen vorgeben, so wie src/state/Settings.tsx sie liest */
function storeLang(lang: 'de' | 'en') {
  localStorage.clear();
  localStorage.setItem('pokemon-elf:settings', JSON.stringify({ lang }));
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
  return { container, root };
}

/** Promises (fetch der Pokémon-Daten) und React-Updates abarbeiten */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Sichtbarer Text und Text-Attribute aller Elemente unter body (inkl. Portale) */
function texts(root: MiniNode = doc.body): string[] {
  const out: string[] = [];
  const walk = (n: MiniNode) => {
    if (n.nodeType === 3) {
      const t = n.textContent.trim();
      if (t) out.push(t);
    }
    if (n.nodeType === 1) {
      const el = n as MiniElement;
      for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

function germanLeft(root?: MiniNode): string[] {
  return texts(root).filter((t) => GERMAN.test(t));
}

const app = (child: ReactElement) =>
  h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(PokemonDataProvider, null, child))));

const anchor = { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON() {} } as DOMRect;
const byId = new Map(ALL.map((p) => [p.id, p]));
const SNORLAX = byId.get(143)!;
const ZAPDOS = byId.get(145)!;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(ALL), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});

afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  setCurrentLang('de');
});

describe('Builder auf Englisch', () => {
  it('Seite, Spielfeld und Teamblatt ohne deutschen Text', async () => {
    storeLang('en');
    const { container } = await render(app(h(Builder)));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Save image');
    expect(all).toContain('Team sheet');
    expect(all).toContain('Snorlax');
    expect(all).toContain('Lineup from the first 151 Pokémon, no legendaries.');
    expect(all).toContain('Set-piece taker');
    expect(all).toContain('#0143');
    // Tastenkürzel-Zeile (nur Maus/Tastatur per CSS)
    expect(container.querySelector('.builder__keys')!.textContent).toBe('⌨️ Ctrl/Cmd+Z undo · Ctrl+Y redo · in the picker: type to search, ↓ into the grid, Enter picks');
    expect(germanLeft(container)).toEqual([]);
    // Ohne Teamnamen: unsichtbare Hauptüberschrift für Screenreader
    expect(container.querySelectorAll('h1').map((x) => [x.getAttribute('class'), x.textContent])).toEqual([['sr-only', 'Lineup builder']]);
    // Kapitänswahl: jede Option mit Fit auf der eigenen Position
    const capOptions = container.querySelector('.captain-picker select')!.querySelectorAll('option').map((o) => o.textContent);
    expect(capOptions[0]).toBe('No captain');
    expect(capOptions).toHaveLength(12);
    for (const o of capOptions.slice(1)) expect(o).toMatch(/^[A-Z]+ · .+ · Fit \d+$/);
    // Teamblatt: Fit jedes Pokémon auf seiner Position hinter der Nummer (Torwart Relaxo)
    {
      const { buildScale, positionFit } = await import('../src/lib/fit');
      const fits = container.querySelectorAll('.sheet__fit').map((f) => f.textContent);
      expect(fits.length).toBeGreaterThanOrEqual(11);
      for (const f of fits) expect(f).toMatch(/^ · Fit \d+( 🔻)?$/);
      expect(fits[0]).toBe(` · Fit ${Math.round(positionFit(ALL.find((p) => p.id === 143)!, 'TW', buildScale(ALL, 'all')))}`);
      // Ø Fit der Feldspieler im Kopf (ohne Standardschützen)
      const { FORMATIONS } = await import('../src/config/formations');
      const sc = buildScale(ALL, 'all');
      const ids = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];
      const avg = Math.round(ids.reduce((s, id, i) => s + positionFit(ALL.find((p) => p.id === id)!, FORMATIONS['4-3-3'].slots[i].pos, sc), 0) / 11);
      expect(container.querySelector('.sheet__count')!.textContent).toBe(`avg fit ${avg} · 11/11`);
      // 🔻 am eindeutig schwächsten Fit der vollen Elf
      const fitsAll = ids.map((id, i) => Math.round(positionFit(ALL.find((p) => p.id === id)!, FORMATIONS['4-3-3'].slots[i].pos, sc)));
      const min = Math.min(...fitsAll);
      const weak = container.querySelectorAll('.sheet__weakest');
      expect(weak).toHaveLength(fitsAll.filter((f) => f === min).length === 1 ? 1 : 0);
      if (weak.length) {
        expect(weak[0].getAttribute('aria-label')).toBe('Weakest fit in the XI – the best place for a swap');
        expect(weak[0].parentNode!.textContent).toContain(`Fit ${min}`);
      }
    }
    // Typ-Chips wie auf dem Draft-Board (Standard-Elf)
    {
      const { dominantType, typeVariety, RAINBOW_TYPES } = await import('../src/config/pokemonTypes');
      const mons = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135].map((id) => ALL.find((p) => p.id === id)!);
      const dom = dominantType(mons);
      const v = typeVariety(mons);
      const el = container.querySelector('.builder__types');
      if (!dom && v < RAINBOW_TYPES) expect(el).toBeNull();
      else {
        expect(dom || v >= RAINBOW_TYPES).toBeTruthy();
        if (v >= RAINBOW_TYPES) expect(el!.textContent).toContain(`🌈 ${v}`);
        if (dom) expect(el!.textContent).toContain(`×${dom.n}`);
      }
      expect(v).toBeGreaterThanOrEqual(RAINBOW_TYPES);
      // 📏 Ø Größe · ⚖️ Gesamtgewicht der vollen Elf
      const h = mons.reduce((s, p) => s + p.h, 0) / mons.length;
      const w = mons.reduce((s, p) => s + p.w, 0);
      expect(container.querySelector('.builder__size')!.textContent).toBe(
        `📏 avg ${h.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m · ⚖️ ${w.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`,
      );
    }
  });

  it('Meine Teams: Speicherdatum hinter der Formation', async () => {
    storeLang('en');
    const at = new Date(2026, 9, 12, 15, 0).getTime();
    localStorage.setItem('pokemon-elf:saved-teams', JSON.stringify([{ id: '1', name: 'Kanto XI', formation: '4-3-3', at, state: { teamName: 'Kanto XI', formation: '4-3-3', slots: [] } }]));
    const { container } = await render(app(h(Builder)));
    await settle();
    expect(container.querySelector('.saved-teams__at')!.textContent).toBe(' · Oct 12, 2026');
    // Leere Elf: kein Score
    expect(container.querySelector('.saved-teams__score')).toBeNull();
    // Gespeicherte Elf ≠ aktuelle Builder-Elf: kein „✓ current“
    expect(container.querySelector('.saved-teams__current')).toBeNull();
    // Aktuelle Elf speichern: der neue Eintrag ist „✓ current“
    const saveBtn = container.querySelectorAll('button').find((b) => b.textContent === en.builder.saved.save)!;
    await act(async () => saveBtn.click());
    expect(container.querySelectorAll('.saved-teams__current').map((e) => e.textContent)).toEqual([' · ✓ current']);
    // Gespeicherte Standard-Elf: Team-Score wie evaluateTeam (alle 1.025, mit Kapitän)
    const { evaluateTeam } = await import('../src/lib/teamScore');
    const { buildScale } = await import('../src/lib/fit');
    const saved = JSON.parse(localStorage.getItem('pokemon-elf:saved-teams')!)[0];
    const expected = evaluateTeam(saved.formation, saved.state.slots.map((id: number | null) => ALL.find((p) => p.id === id)), buildScale(ALL, 'all'), saved.state.captain ?? null).score;
    expect(container.querySelectorAll('.saved-teams__score')[0].textContent).toBe(` · Score ${expected}`);
  });

  it('Meine Teams: 🏆 an der eindeutig stärksten Elf (ab zwei mit Score)', async () => {
    storeLang('en');
    const strong = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];
    const weak = [129, 129, 129, 129, 129, 65, 112, 3, 25, 6, 135];
    const team = (id: string, name: string, slots: number[]) => ({ id, name, formation: '4-3-3', at: 0, state: { teamName: name, formation: '4-3-3', slots } });
    localStorage.setItem('pokemon-elf:saved-teams', JSON.stringify([team('1', 'Weak XI', weak), team('2', 'Strong XI', strong)]));
    const { container } = await render(app(h(Builder)));
    await settle();
    const best = container.querySelectorAll('.saved-teams__best');
    expect(best).toHaveLength(1);
    expect(best[0].getAttribute('aria-label')).toBe('Your strongest saved XI');
    const item = container.querySelectorAll('.saved-teams__item').find((li) => li.contains(best[0]))!;
    expect(item.querySelector('.saved-teams__name')!.textContent).toContain('Strong XI');
    // Gleichstand: kein 🏆
    localStorage.setItem('pokemon-elf:saved-teams', JSON.stringify([team('1', 'A', strong), team('2', 'B', strong)]));
    const again = await render(app(h(Builder)));
    await settle();
    expect(again.container.querySelectorAll('.saved-teams__best')).toHaveLength(0);
  });

  it('Auswahl-Dialog (Filter, Raster, Hinweise) ohne deutschen Text', async () => {
    storeLang('en');
    const { container } = await render(app(h(Builder)));
    await settle();
    const slot = container.querySelector('button[data-slot-index="0"]')!;
    expect(slot.getAttribute('aria-label')).toBe('Goalkeeper: Snorlax – replace');
    await act(async () => slot.click());
    const dialog = doc.body.querySelector('.picker')!;
    expect(dialog).not.toBeNull();
    const all = texts(dialog).join(' | ');
    expect(all).toContain('Pick a Pokémon');
    expect(all).toContain('Empty slot');
    expect(all).toContain('All types');
    expect(all).toContain('Unova');
    expect(all).toMatch(/on the pitch: (CB|LB|RB|DM|CM)/);
    expect(all).toMatch(/\d+ results/);
    // Wer gerade im Tor steht, mit Fit zum Vergleich
    {
      const { buildScale, positionFit } = await import('../src/lib/fit');
      const fit = Math.round(positionFit(ALL.find((p) => p.id === 143)!, 'TW', buildScale(ALL, 'all')));
      expect(dialog.querySelector('.picker__current')!.textContent).toBe(`Currently here: Snorlax (fit ${fit})`);
    }
    expect(germanLeft(dialog)).toEqual([]);
    expect(germanLeft()).toEqual([]);
    // Sortierung „Best for the position“: Fit-Notiz auf den Karten, absteigend
    const fitRadio = dialog.querySelectorAll('[role="radio"]').find((b) => b.textContent === 'Best for the position')!;
    await act(async () => fitRadio.click());
    const notes = dialog.querySelectorAll('.pcard__note').map((n) => n.textContent!);
    const fits = notes
      .map((n) => /^Fit (\d+)/.exec(n)?.[1])
      .filter((x): x is string => x != null)
      .map(Number);
    expect(fits.length).toBeGreaterThan(5);
    expect(fits).toEqual([...fits].sort((a, b) => b - a));
    // Differenz zum aktuellen Torwart (Relaxo) hinter dem Fit – Vorzeichen passend
    const { buildScale, positionFit } = await import('../src/lib/fit');
    const cur = Math.round(positionFit(ALL.find((p) => p.id === 143)!, 'TW', buildScale(ALL, 'all')));
    for (const n of notes) {
      const m = /^Fit (\d+)(?: · ([+−])(\d+))?$/.exec(n);
      if (!m) continue;
      const f = Number(m[1]);
      if (f === cur) continue;
      expect(m[2] && m[3], n).toBeTruthy();
      expect(Number(m[3]) * (m[2] === '+' ? 1 : -1)).toBe(f - cur);
    }
    expect(notes.some((n) => / · \+\d+$/.test(n))).toBe(true);
  });

  it('Umschalten DE → EN im Kopf übersetzt die Seite sofort (und zurück)', async () => {
    storeLang('de');
    const { container } = await render(app(h('div', null, h(Header), h(Builder))));
    await settle();
    expect(container.textContent).toContain('Bild speichern');
    const toggle = container.querySelector('button.lang-toggle')!;
    await act(async () => toggle.click());
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Save image');
    expect(all).toContain('Lineup from the first 151 Pokémon, no legendaries.');
    expect(all).toContain('Goalkeeper: Snorlax – replace');
    expect(germanLeft(container)).toEqual([]);
    expect(JSON.parse(localStorage.getItem('pokemon-elf:settings')!).lang).toBe('en');
    await act(async () => container.querySelector('button.lang-toggle')!.click());
    await settle();
    expect(container.textContent).toContain('Bild speichern');
    expect(container.textContent).toContain('Relaxo');
  });

  it('Ladebildschirm auf Englisch', async () => {
    storeLang('en');
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { container } = await render(app(h(Builder)));
    expect(container.textContent).toContain('Loading squad');
    expect(germanLeft(container)).toEqual([]);
  });
});

describe('Tooltips und Export-Bild auf Englisch', () => {
  it('Werte-Tooltip mit Position und Positions-Tooltip', async () => {
    storeLang('en');
    await render(
      h(SettingsProvider, null, h(StatTooltip, { pokemon: ZAPDOS, anchor, pos: 'ST' }), h(PositionTooltip, { pos: 'TW', anchor })),
    );
    const all = texts().join(' | ');
    expect(all).toContain('Zapdos');
    expect(all).toContain('Legendary');
    expect(all).toContain('What counts at Striker');
    expect(all).toContain('Height 1.6 m');
    expect(all).toContain('Type bonus');
    expect(all).toContain('Stops shots, organises the defence.');
    expect(all).toContain('Team score weighting: 1.6');
    expect(germanLeft()).toEqual([]);
  });

  it('Export-Bild (eigene Wurzel ohne Provider → aktive Sprache)', async () => {
    setCurrentLang('en');
    await render(
      h(ExportCard, {
        formation: '4-3-3',
        players: [SNORLAX, null],
        ss: null,
        sprite: 'pixel',
        images: new Map(),
        teamName: '',
        subtitle: '4-3-3 · All regions',
        result: { record: '34–0', points: 102, score: 88, position: 1, label: '34–0 Challenge' },
        watermark: 'elf.example',
        shinies: [SNORLAX.id],
      }),
    );
    const all = texts().join(' | ');
    expect(all).toContain('My XI');
    expect(all).toContain('✨');
    expect(all).toContain('102 pts · Score 88 · 1st place');
    expect(all).toContain('Snorlax');
    expect(germanLeft()).toEqual([]);
  });
});

describe('Deutsch bleibt unverändert', () => {
  it('Builder, Tooltip und Export auf Deutsch', async () => {
    storeLang('de');
    const { container } = await render(app(h(Builder)));
    await settle();
    const all = texts(container).join(' | ');
    expect(all).toContain('Bild speichern');
    expect(all).toContain('Teamblatt');
    expect(all).toContain('Relaxo');
    expect(all).toContain('Aufstellung aus den ersten 151 Pokémon, ohne Legendäre.');
    expect(all).toContain('Nr. 0143');
    expect(container.querySelector('button[data-slot-index="0"]')!.getAttribute('aria-label')).toBe(
      'Torwart: Relaxo – austauschen',
    );
  });

  it('„Als Text kopieren“: Kopfzeile, je Position ein Spieler, Link am Ende', async () => {
    storeLang('de');
    const writes: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (x: string) => void writes.push(x) }, configurable: true });
    const loc = (window as unknown as { location?: unknown }).location;
    (window as unknown as { location: unknown }).location = { href: 'https://elf.example/' };
    const { container } = await render(app(h(Builder)));
    await settle();
    const btn = container.querySelectorAll('button').find((b) => b.textContent === 'Als Text kopieren')!;
    await act(async () => btn.click());
    await settle();
    expect(writes).toHaveLength(1);
    const lines = writes[0].split('\n');
    expect(lines[0]).toMatch(/^⚽ .+ \(4-3-3\)$/);
    expect(lines[1]).toBe('TW Relaxo');
    expect(lines).toHaveLength(1 + 11 + 1);
    expect(lines.at(-1)).toMatch(/^https:\/\/elf\.example\/\?/);
    (window as unknown as { location: unknown }).location = loc;
  });

  it('Rückgängig/Wiederholen: deaktiviert sich der bediente Knopf, wandert der Fokus zum Gegenstück', async () => {
    storeLang('de');
    const { container } = await render(app(h(Builder)));
    await settle();
    const btn = (name: string) => container.querySelectorAll('button').find((b) => b.textContent === name)!;
    await act(async () => btn('Alles leeren').click());
    await act(async () => btn('Rückgängig').click());
    await settle();
    expect(doc.activeElement).toBe(btn('Wiederholen'));
    await act(async () => btn('Wiederholen').click());
    await settle();
    expect(doc.activeElement).toBe(btn('Rückgängig'));
  });

  it('Werte-Tooltip auf Deutsch', async () => {
    storeLang('de');
    await render(h(SettingsProvider, null, h(StatTooltip, { pokemon: ZAPDOS, anchor, pos: 'ST' })));
    const all = texts().join(' | ');
    expect(all).toContain('Wichtig als Stürmer');
    expect(all).toContain('Größe 1,6 m');
    expect(all).toContain('● Schlüssel · ◕ Hilft · ◔ Kleiner Anteil · ○ Zählt nicht');
  });
});

describe('Texte außerhalb von React', () => {
  it('Regionen folgen dem übergebenen Katalog; Nummern und Zahlen der aktiven Sprache', () => {
    expect(regionPhrase(5, de)).toBe('aus Einall (Nr. 494–649)');
    expect(regionPhrase(1, de)).toBe('aus den ersten 151 Pokémon');
    expect(regionPhrase(0, de)).toBe('aus allen 1.025 Pokémon');
    expect(regionLabel(0, de)).toBe('Alle');
    expect(regionName(5, de)).toBe('Einall');
    expect(regionName(0, de)).toBe('?');
    expect(dexNo(25)).toBe('Nr. 0025');
    expect(fmtNum(1.5)).toBe('1,5');
    setCurrentLang('en');
    expect(regionPhrase(5, en)).toBe('from Unova (#494–649)');
    expect(regionPhrase(1, en)).toBe('from the first 151 Pokémon');
    expect(regionPhrase(0, en)).toBe('from all 1,025 Pokémon');
    expect(regionLabel(0, en)).toBe('All');
    expect(regionLabel(5, en)).toBe('Unova');
    expect(dexNo(25)).toBe('#0025');
    expect(fmtNum(1.5)).toBe('1.5');
  });

  it('Suche findet deutsche und englische Namen und Nummern', () => {
    expect(matchesQuery(SNORLAX, 'relaxo')).toBe(true);
    expect(matchesQuery(SNORLAX, 'Snorlax')).toBe(true);
    expect(matchesQuery(SNORLAX, '#143')).toBe(true);
    expect(matchesQuery(SNORLAX, 'Nr. 143')).toBe(true);
    expect(matchesQuery(SNORLAX, 'No. 143')).toBe(true);
    expect(matchesQuery(byId.get(299)!, 'nose')).toBe(true); // Nosepass
  });
});
