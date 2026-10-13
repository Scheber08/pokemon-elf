// Ohne Laufzeit-Import der Übersetzungen: Engine und Server laden diese Datei mit und bleiben
// sprachneutral. Texte bekommen die Helfer als Katalog (t) übergeben.
import type { Messages } from '../i18n/de';
import type { RegionFilter } from '../types';

export interface Region {
  gen: number;
  /** Deutscher Name (Daten) – angezeigt wird t.game.region[gen] bzw. regionName(gen, t) */
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

/** Die Texte, die die Regions-Helfer brauchen (Teil des Katalogs, z. B. useT() oder messages()). */
export interface RegionTexts {
  game: Pick<Messages['game'], 'region' | 'allRegions'>;
  common: Pick<Messages['common'], 'regionPhrase'>;
}

/** Regionsname in der Sprache von t. */
export function regionName(gen: number, t: RegionTexts): string {
  return REGIONS.some((r) => r.gen === gen) ? t.game.region[gen] : '?';
}

/** „Alle" bzw. Regionsname in der Sprache von t. */
export function regionLabel(filter: RegionFilter, t: RegionTexts): string {
  return filter === 0 ? t.game.allRegions : regionName(filter, t);
}

/** Satzbaustein für die dynamische Beschreibung im Builder („aus Kanto (Nr. 1–151)"). */
export function regionPhrase(filter: RegionFilter, t: RegionTexts): string {
  const rp = t.common.regionPhrase;
  if (filter === 0) return rp.all;
  if (filter === 1) return rp.first151;
  const r = REGIONS[filter - 1];
  return rp.range(regionName(r.gen, t), r.from, r.to);
}
