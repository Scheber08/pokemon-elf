/**
 * Übersetzung von Scouting-Guide und Info-Seiten (Über, Datenschutz, 404): Mit Englisch als
 * gespeicherter Sprache darf kein Deutsch mehr auf den Seiten stehen, Deutsch bleibt unverändert.
 * Gerendert wird mit react-dom/server (statisches Markup, kein DOM nötig).
 */
import { createElement as h, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { setCurrentLang } from '../src/i18n/lang';
import { About, NotFound, Privacy } from '../src/pages/InfoPages';
import { Scouting } from '../src/pages/Scouting';
import { SettingsProvider } from '../src/state/Settings';
import { ToastProvider } from '../src/state/Toast';

const PAGES: [string, ComponentType][] = [
  ['Scouting', Scouting],
  ['About', About],
  ['Privacy', Privacy],
  ['NotFound', NotFound],
];

/** Gespeicherte Einstellungen vorgeben, so wie src/state/Settings.tsx sie liest */
function storeLang(lang: 'de' | 'en') {
  const data = new Map([['pokemon-elf:settings', JSON.stringify({ lang })]]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
}

function render(Page: ComponentType): string {
  return renderToStaticMarkup(h(MemoryRouter, null, h(SettingsProvider, null, h(ToastProvider, null, h(Page)))));
}

/** Sichtbarer Text ohne Tags */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

/**
 * Text-Attribute (title, aria-label, alt, placeholder). Die Symbole der LevelIcon-Komponente
 * (svg) gehören nicht zu diesen Seiten und werden hier nicht geprüft.
 */
const attrsOf = (html: string) =>
  [...html.replace(/<svg[^>]*>/g, '').matchAll(/\s(?:title|aria-label|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]);

const GERMAN =
  /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|für|ist|wird|werden|bei|auf|zum|zur|kein|keine|eine|einen|Spieltag|Mannschaft|wählen|Team-Score|Tabelle|Torwart|Stürmer|Abwehr|Angriff|Mittelfeld|Typen|Legende|Speichere|Zurück|Seite|Datenschutz|Kontakt|Rangliste|Ligen|Geräte?)\b/;

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentLang('de');
});

describe('Scouting & Info-Seiten auf Englisch', () => {
  for (const [name, Page] of PAGES) {
    it(`${name}: kein Deutsch im Text und in den Attributen`, () => {
      storeLang('en');
      const html = render(Page);
      const text = textOf(html);
      expect(text.trim().length).toBeGreaterThan(5);
      expect(text.match(GERMAN)?.[0] ?? null, text).toBeNull();
      for (const a of attrsOf(html)) expect(a.match(GERMAN)?.[0] ?? null, a).toBeNull();
    });
  }

  it('Scouting: englische Zahlen, Namen und Kürzel', () => {
    storeLang('en');
    const text = textOf(render(Scouting));
    expect(text).toContain('Scouting guide');
    expect(text).toContain('(0–1,000)');
    expect(text).toContain('goalkeeper 1.6');
    expect(text).toContain('Above 2.2 m');
    expect(text).toContain('Centre-back');
    expect(text).toContain('LB/RB');
    expect(text).toContain('Rock and Steel at the back');
    expect(text).toContain('Charizard');
  });
});

describe('Deutsch bleibt Standard', () => {
  it('Scouting und Datenschutz zeigen die deutschen Texte', () => {
    storeLang('de');
    const scouting = textOf(render(Scouting));
    expect(scouting).toContain('Scouting-Guide');
    expect(scouting).toContain('Der Team-Score (0–1.000)');
    expect(scouting).toContain('Die Gewichte: Torwart 1,6, jeder Innenverteidiger 1,2');
    expect(scouting).toContain('Ab 2,2 m gibt es keinen Bonus mehr');
    expect(scouting).toContain('Gestein und Stahl in der Abwehr');
    expect(scouting).toContain('LV/RV');
    const privacy = textOf(render(Privacy));
    expect(privacy).toContain('„Link kopieren" kodiert Formation');
    expect(textOf(render(NotFound))).toContain('Abseits!');
  });
});

describe('Kataloge', () => {
  /** Form inkl. Listenlängen (TypeScript prüft keine Längen von Arrays) */
  const shape = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(shape)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shape(v)]))
        : typeof x;

  it('scouting und info haben auf Deutsch und Englisch dieselbe Form', () => {
    expect(shape(en.scouting)).toEqual(shape(de.scouting));
    expect(shape(en.info)).toEqual(shape(de.info));
  });
});
