import type { RegionFilter } from '../types';

export interface Region {
  gen: number;
  name: string;
  /** Nationaldex-Bereich der Generation */
  from: number;
  to: number;
}

export const REGIONS: Region[] = [
  { gen: 1, name: 'Kanto', from: 1, to: 151 },
  { gen: 2, name: 'Johto', from: 152, to: 251 },
  { gen: 3, name: 'Hoenn', from: 252, to: 386 },
  { gen: 4, name: 'Sinnoh', from: 387, to: 493 },
  { gen: 5, name: 'Einall', from: 494, to: 649 },
  { gen: 6, name: 'Kalos', from: 650, to: 721 },
  { gen: 7, name: 'Alola', from: 722, to: 809 },
  { gen: 8, name: 'Galar', from: 810, to: 905 },
  { gen: 9, name: 'Paldea', from: 906, to: 1025 },
];

export function regionName(gen: number): string {
  return REGIONS.find((r) => r.gen === gen)?.name ?? '?';
}

export function regionLabel(filter: RegionFilter): string {
  return filter === 0 ? 'Alle' : regionName(filter);
}

/** Satzbaustein für die dynamische Beschreibung im Builder. */
export function regionPhrase(filter: RegionFilter): string {
  if (filter === 0) return 'aus allen 1.025 Pokémon';
  if (filter === 1) return 'aus den ersten 151 Pokémon';
  const r = REGIONS[filter - 1];
  return `aus ${r.name} (Nr. ${r.from}–${r.to})`;
}
