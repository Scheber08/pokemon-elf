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
    expect(germanLeft(container)).toEqual([]);
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
    expect(germanLeft(dialog)).toEqual([]);
    expect(germanLeft()).toEqual([]);
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
