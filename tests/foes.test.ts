/** Kleine Saison-Kennzahlen ohne Draft-Code (Challenges). */
import { describe, expect, it } from 'vitest';
import { longestRuns, venueRecords } from '../src/lib/foes';

describe('longestRuns', () => {
  it('längste Siegesserie und längste Serie ohne Niederlage', () => {
    expect(longestRuns(['S', 'S', 'U', 'S', 'S', 'S', 'N', 'U', 'U'])).toEqual({ wins: 3, unbeaten: 6 });
    expect(longestRuns([])).toEqual({ wins: 0, unbeaten: 0 });
    expect(longestRuns(['N', 'N'])).toEqual({ wins: 0, unbeaten: 0 });
  });
});

describe('venueRecords', () => {
  it('Bilanz zu Hause und auswärts', () => {
    const m = (isHome: boolean, outcome: 'S' | 'U' | 'N') => ({ isHome, outcome });
    expect(venueRecords([m(true, 'S'), m(true, 'U'), m(false, 'N'), m(false, 'S'), m(true, 'S')])).toEqual({ home: { w: 2, d: 1, l: 0 }, away: { w: 1, d: 0, l: 1 } });
  });
});
