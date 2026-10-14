/** Trikotnummern: Vorgabe nach Position, eigene Nummern, Bereinigen und Tauschen. */
import { describe, expect, it } from 'vitest';
import { cleanJerseys, dexJerseys, jerseyNumbers, setJersey } from '../src/lib/jerseys';
import type { PosCode } from '../src/types';

const team = (...pos: (PosCode | null)[]) => pos.map((p, i) => ({ pokemonId: 100 + i, pos: p }));

describe('Trikotnummern', () => {
  it('Vorgabe nach Position: Torwart 1, Abwehr 2–5, Zehner 10, Stürmer 9; Doppelte bekommen Ausweichnummern', () => {
    const n = jerseyNumbers(team('TW', 'RV', 'IV', 'IV', 'LV', 'DM', 'ZM', 'OM', 'RF', 'LF', 'ST', null, null));
    expect([...n.values()].slice(0, 11)).toEqual([1, 2, 4, 5, 3, 6, 8, 10, 7, 11, 9]);
    // Bank: kleinste freie Nummern
    expect(n.get(111)).toBe(12);
    expect(n.get(112)).toBe(13);
    expect(new Set(n.values()).size).toBe(13);
    // Drei Stürmer: 9, 19, 21
    expect([...jerseyNumbers(team('ST', 'ST', 'ST')).values()]).toEqual([9, 19, 21]);
  });

  it('eigene Nummern gehen vor, Vorgaben weichen aus; ungültige und doppelte werden ignoriert', () => {
    const n = jerseyNumbers(team('TW', 'ST', 'ST'), { '101': 1, '102': 1, '100': 150 });
    expect(n.get(101)).toBe(1);
    // Torwart weicht auf 12 aus (1 ist vergeben), zweiter Stürmer bekommt die Vorgabe 9
    expect(n.get(100)).toBe(12);
    expect(n.get(102)).toBe(9);
  });

  it('bereinigen: nur 1–99, je Nummer einmal, nur erlaubte Pokémon', () => {
    expect(cleanJerseys({ '6': 9, '25': 9, '7': 0, '8': 100, x: 5, '150': 10 }, new Set([6, 25, 7, 8]))).toEqual({ '6': 9 });
    expect(cleanJerseys(null)).toEqual({});
    expect(cleanJerseys([1, 2])).toEqual({});
  });

  it('setzen: freie Nummer übernehmen, belegte tauschen, null = zurück zur Vorgabe', () => {
    const players = team('TW', 'ST', 'OM');
    let custom = {};
    let cur = jerseyNumbers(players, custom);
    custom = setJersey(custom, 101, 23, cur);
    cur = jerseyNumbers(players, custom);
    expect(cur.get(101)).toBe(23);
    // 10 hat der Zehner – Stürmer nimmt sie, der Zehner bekommt die 23
    custom = setJersey(custom, 101, 10, cur);
    cur = jerseyNumbers(players, custom);
    expect([cur.get(101), cur.get(102)]).toEqual([10, 23]);
    custom = setJersey(custom, 101, null, cur);
    expect(jerseyNumbers(players, custom).get(101)).toBe(9);
    expect(setJersey(custom, 101, 0, cur)).toBe(custom);
    // Gespeicherte Nummer eines Pokémon außerhalb des Kaders wird frei
    expect(setJersey({ '999': 5 }, 101, 5, cur)).toEqual({ '101': 5 });
  });

  it('Pokédex-Nummern: letzte zwei Ziffern, Formen nach Art, Doppelte und 00 ohne eigene Nummer', () => {
    expect(
      dexJerseys([
        { pokemonId: 25, dex: 25 },
        { pokemonId: 150, dex: 150 },
        { pokemonId: 125, dex: 125 },
        { pokemonId: 100, dex: 100 },
        { pokemonId: 10034, dex: 6 },
      ]),
    ).toEqual({ '25': 25, '150': 50, '10034': 6 });
  });
});
