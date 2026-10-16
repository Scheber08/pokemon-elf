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

describe('Meister rechnerisch fest', () => {
  it('erster Spieltag, ab dem kein Verfolger mehr herankommt', async () => {
    const { titleClinched } = await import('../src/lib/foes');
    // Vier Teams, je Spieltag zwei Spiele
    const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag });
    const matches = [
      m(1, 0, 1, 2, 0), m(1, 2, 3, 1, 1),
      m(2, 0, 2, 1, 0), m(2, 1, 3, 0, 0),
      m(3, 0, 3, 3, 0), m(3, 1, 2, 1, 2),
      m(4, 1, 0, 0, 1), m(4, 3, 2, 0, 0),
    ];
    // Nach Spieltag 3: Team 0 hat 9, Team 2 hat 4 (+3 möglich = 7) → sicher, 1 Spieltag vor Schluss
    expect(titleClinched(matches, 4)).toEqual({ team: 0, round: 3, left: 1 });
    // Erst am letzten Spieltag entschieden → null
    const tight = [m(1, 0, 1, 1, 0), m(2, 1, 0, 1, 0)];
    expect(titleClinched(tight, 2)).toBeNull();
  });
});
