/** Tabellen-Zonen auch für Screenreader: Meister-/Aufstiegsplatz oben, letzte Plätze unten – ohne Zone nichts. */
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ZoneSr } from '../src/components/LeagueTicker';

const html = (place: number, total: number, top?: number) => renderToStaticMarkup(h(ZoneSr, { place, total, top }));

describe('ZoneSr', () => {
  it('nennt die Zone wie die Legende, nur wo die Tabelle Zonen hat', () => {
    expect(html(1, 18)).toBe('<span class="sr-only"> – Meisterplatz</span>');
    expect(html(2, 18, 2)).toBe('<span class="sr-only"> – Aufstiegsplatz</span>');
    expect(html(18, 18)).toBe('<span class="sr-only"> – letzte 3 Plätze</span>');
    expect(html(9, 18)).toBe('');
    // Kleine Ligen: keine Zonen (unter 6 Teams), unten erst ab 10 Teams
    expect(html(1, 4)).toBe('');
    expect(html(8, 8)).toBe('');
  });
});
