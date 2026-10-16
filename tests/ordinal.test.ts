/** Englische Ordinalzahl und Einzahl/Mehrzahl: gemeinsame Helfer (src/i18n/lang.ts) für alle englischen Texte. */
import { describe, expect, it } from 'vitest';
import { ordinal, plural } from '../src/i18n/lang';

describe('ordinal', () => {
  it('st/nd/rd/th inklusive 11.–13. und Hunderter', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 113, 121].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '113th', '121st',
    ]);
  });
});

describe('plural', () => {
  it('Einzahl nur bei genau 1', () => {
    expect([0, 1, 2].map((n) => plural(n, 'goal', 'goals'))).toEqual(['0 goals', '1 goal', '2 goals']);
  });
});
