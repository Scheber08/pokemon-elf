/**
 * Besondere Kategorien von Pokémon. Ultrabestien gibt es in den Daten (pokemon.json) nicht als
 * eigenes Feld: Anego bis Schlingking (793–799) und Venicro bis Kopplosio (803–806) – in der
 * PokeAPI weder legendär noch mysteriös. Formen (forms.json) tragen ihre Art in `form`.
 */
import type { Pokemon } from '../types';

export const ULTRA_BEAST_IDS: ReadonlySet<number> = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);

/** Ultrabestie? */
export const isUltraBeast = (p: Pick<Pokemon, 'id'>): boolean => ULTRA_BEAST_IDS.has(p.id);

/** Mega-Entwicklung (oder Proto-Form)? */
export const isMega = (p: Pick<Pokemon, 'form'>): boolean => p.form === 'mega';

/** Nummer im Pokédex – bei Formen die der Art (Mega-Glurak X → 6). */
export const dexId = (p: Pick<Pokemon, 'id' | 'base'>): number => p.base ?? p.id;

/** Nach Pokédex-Nummer, Formen direkt hinter ihrer Art. */
export const byDex = (a: Pick<Pokemon, 'id' | 'base'>, b: Pick<Pokemon, 'id' | 'base'>): number =>
  dexId(a) - dexId(b) || a.id - b.id;
