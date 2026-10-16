/**
 * Sehr schmale Handys (320 px): Spalten, deren Inhalt lange Texte enthalten kann (Kapitän-Auswahl mit Fit,
 * Ranglisten-Zeilen, Meine Teams), dürfen nicht über ihre Breite hinauswachsen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
/** Erste Regel für genau diesen Selektor */
const rule = (sel: string) => {
  const i = css.indexOf(`\n${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
};

describe('Layout auf schmalen Handys', () => {
  it('Grid-Spalten schrumpfen mit (minmax(0, 1fr))', () => {
    for (const sel of ['.builder__side', '.leaderboard']) expect(rule(sel)).toContain('grid-template-columns: minmax(0, 1fr);');
  });

  it('„Meine Teams“: Knöpfe brechen um statt seitlich hinaus', () => {
    expect(rule('.saved-teams__item')).toContain('flex-wrap: wrap;');
  });
});
