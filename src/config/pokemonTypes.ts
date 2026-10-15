import type { TypeKey } from '../types';

/**
 * Offizielle Typfarben (Hintergrund, Schrift). Die Reihenfolge bestimmt TYPE_KEYS (Würfe!).
 * Angezeigte Typnamen kommen aus den Übersetzungen: t.game.type[key].
 */
export const TYPES: Record<TypeKey, { color: string; text: string }> = {
  normal: { color: '#A8A77A', text: '#1a1a1a' },
  fire: { color: '#EE8130', text: '#1a1a1a' },
  water: { color: '#6390F0', text: '#0b1020' },
  electric: { color: '#F7D02C', text: '#1a1a1a' },
  grass: { color: '#7AC74C', text: '#1a1a1a' },
  ice: { color: '#96D9D6', text: '#1a1a1a' },
  fighting: { color: '#C22E28', text: '#ffffff' },
  poison: { color: '#A33EA1', text: '#ffffff' },
  ground: { color: '#E2BF65', text: '#1a1a1a' },
  flying: { color: '#A98FF3', text: '#1a1a1a' },
  psychic: { color: '#F95587', text: '#1a1a1a' },
  bug: { color: '#A6B91A', text: '#1a1a1a' },
  rock: { color: '#B6A136', text: '#1a1a1a' },
  ghost: { color: '#735797', text: '#ffffff' },
  dragon: { color: '#6F35FC', text: '#ffffff' },
  dark: { color: '#705746', text: '#ffffff' },
  steel: { color: '#B7B7CE', text: '#1a1a1a' },
  fairy: { color: '#D685AD', text: '#1a1a1a' },
};

export const TYPE_KEYS = Object.keys(TYPES) as TypeKey[];

/** Häufigster Typ einer Elf, wenn ihn mindestens `min` Pokémon tragen und kein anderer Typ gleich oft vorkommt („Typ-Elf“) */
export function dominantType(pokemon: { types: TypeKey[] }[], min = 4): { type: TypeKey; n: number } | null {
  const counts = new Map<TypeKey, number>();
  for (const p of pokemon) for (const ty of new Set(p.types)) counts.set(ty, (counts.get(ty) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [best, next] = ranked;
  if (!best || best[1] < min || (next && next[1] === best[1])) return null;
  return { type: best[0], n: best[1] };
}
