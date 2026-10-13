/**
 * Besondere Kategorien von Pokémon, die es in den Daten (pokemon.json) nicht als eigenes Feld
 * gibt. Ultrabestien: Anego bis Schlingking (793–799) und Venicro bis Kopplosio (803–806) –
 * in der PokeAPI weder legendär noch mysteriös.
 */
import type { Pokemon } from '../types';

export const ULTRA_BEAST_IDS: ReadonlySet<number> = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);

/** Ultrabestie? */
export const isUltraBeast = (p: Pick<Pokemon, 'id'>): boolean => ULTRA_BEAST_IDS.has(p.id);
