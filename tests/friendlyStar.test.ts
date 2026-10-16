/** Testspiel: ⭐ Mann des Spiels über beide Spiele. */
import { describe, expect, it } from 'vitest';
import { friendlyStar } from '../src/lib/friendly';

const g = (pokemonId: number, assist?: number) => ({ pokemonId, pos: 'ST' as const, ...(assist != null ? { assist } : {}) });
const m = (home: number, away: number, hs: ReturnType<typeof g>[], as: ReturnType<typeof g>[]) => ({ round: 1, home, away, hg: hs.length, ag: as.length, homeScorers: hs, awayScorers: as });

describe('Mann des Spiels', () => {
  it('meiste Tore über Hin- und Rückspiel (ab 2), Team richtig zugeordnet', () => {
    expect(friendlyStar([m(0, 1, [g(6), g(25)], [g(9)]), m(1, 0, [g(9)], [g(6)])])).toBeNull(); // 6 und 9 je 2, keine Vorlagen → Gleichstand
    expect(friendlyStar([m(0, 1, [g(6), g(6, 25)], [g(9)]), m(1, 0, [g(9, 1)], [g(6)])])).toEqual({ pokemonId: 6, team: 0, goals: 3 });
    expect(friendlyStar([m(0, 1, [g(6)], [g(9, 3)]), m(1, 0, [g(9)], [])])).toEqual({ pokemonId: 9, team: 1, goals: 2 });
  });
  it('Gleichstand bei Toren: mehr Vorlagen entscheidet; nur ein Tor → niemand', () => {
    expect(friendlyStar([m(0, 1, [g(6), g(6), g(25, 6)], [g(9), g(9)])])).toEqual({ pokemonId: 6, team: 0, goals: 2 });
    expect(friendlyStar([m(0, 1, [g(6)], [g(9)])])).toBeNull();
  });
});
