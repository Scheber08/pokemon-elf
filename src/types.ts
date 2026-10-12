export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

/** Alle Faktoren, die in die Positions-Bewertung eingehen können. */
export type FactorKey = StatKey | 'height' | 'weight';

export type TypeKey =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy';

/** Ein Eintrag aus public/data/pokemon.json (siehe scripts/build-data.mjs). */
export interface Pokemon {
  id: number;
  /** Deutscher Name */
  de: string;
  /** Englischer Name */
  en: string;
  types: TypeKey[];
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  /** Größe in Metern */
  h: number;
  /** Gewicht in Kilogramm */
  w: number;
  /** Generation 1–9 */
  gen: number;
  leg: 0 | 1;
  myth: 0 | 1;
  /** Bitfeld verfügbarer Sprites (siehe lib/sprites.ts) */
  s: number;
}

/** Positionskürzel auf dem Feld (+ SS für den optionalen Standardschützen). */
export type PosCode =
  | 'TW' | 'IV' | 'LV' | 'RV' | 'LWB' | 'RWB'
  | 'DM' | 'ZM' | 'OM' | 'LM' | 'RM' | 'LF' | 'RF' | 'ST' | 'SS';

/** Bewertungsprofil – mehrere Positionen teilen sich ein Profil (z. B. LV/RV → AV). */
export type ProfileKey = 'TW' | 'IV' | 'AV' | 'WB' | 'DM' | 'ZM' | 'OM' | 'FM' | 'FL' | 'ST' | 'SS';

export type Line = 'gk' | 'def' | 'mid' | 'att';

export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2' | '5-3-2';

export type SpriteStyle = 'pixel' | 'retro' | 'artwork';

/** 0 = alle Regionen, sonst Generation 1–9 */
export type RegionFilter = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 11 Feldspieler-Slots (Reihenfolge = Formation) – null = leer. */
export type Slots = (number | null)[];

export interface Lineup {
  formation: FormationId;
  slots: Slots;
  /** Standardschütze (optional, zählt nicht zum Team-Score) */
  ss: number | null;
}

export type ChallengeKey = 'c340' | 'retro340' | 'c151';

export interface Record3 {
  w: number;
  d: number;
  l: number;
}
