import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pokemon } from '../src/types';

/** Echte Daten aus public/data/pokemon.json (per `npm run data` erzeugt). */
export const ALL: Pokemon[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/data/pokemon.json', import.meta.url)), 'utf8'),
);

/** Formen aus public/data/forms.json (per `npm run data:forms` erzeugt). */
export const FORMS: Pokemon[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/data/forms.json', import.meta.url)), 'utf8'),
);

export const byName = (de: string): Pokemon => {
  const p = ALL.find((x) => x.de === de);
  if (!p) throw new Error(`Pokémon ${de} nicht gefunden`);
  return p;
};

let nextId = 5000;

/** Künstliches Pokémon mit Durchschnittswerten – Felder gezielt überschreiben. */
export function mon(over: Partial<Pokemon> = {}): Pokemon {
  return {
    id: nextId++,
    de: 'Testmon',
    en: 'Testmon',
    types: ['normal'],
    hp: 70,
    atk: 70,
    def: 70,
    spa: 70,
    spd: 70,
    spe: 70,
    h: 1.0,
    w: 30,
    gen: 1,
    leg: 0,
    myth: 0,
    s: 2,
    ...over,
  };
}
