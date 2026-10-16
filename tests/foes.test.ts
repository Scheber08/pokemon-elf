/** Kleine Saison-Kennzahlen ohne Draft-Code (Challenges). */
import { describe, expect, it } from 'vitest';
import { longestRuns } from '../src/lib/foes';

describe('longestRuns', () => {
  it('längste Siegesserie und längste Serie ohne Niederlage', () => {
    expect(longestRuns(['S', 'S', 'U', 'S', 'S', 'S', 'N', 'U', 'U'])).toEqual({ wins: 3, unbeaten: 6 });
    expect(longestRuns([])).toEqual({ wins: 0, unbeaten: 0 });
    expect(longestRuns(['N', 'N'])).toEqual({ wins: 0, unbeaten: 0 });
  });
});
