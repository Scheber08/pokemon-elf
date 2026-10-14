/**
 * Positionen und Bewertungsprofile.
 *
 * Jede Position verweist auf ein Profil. Ein Profil legt fest, wie stark jeder
 * Faktor zählt: KEY (Schlüssel) = 3, HELPS (Hilft) = 2, MINOR (Kleiner Anteil) = 1,
 * NONE (Zählt nicht) = 0. Die Typen-Liste ist nach Bonus sortiert (+3 %, +2 %, +1 %, +1 %).
 *
 * Typ-Verteilung ausgeglichen: Jeder der 18 Typen steht bei genau zwei Positionen,
 * zusammen +3 % oder +4 % (tests/fit.test.ts prüft das). Der Standardschütze hat
 * keine Typen, weil er nicht zum Team-Score zählt.
 */
import type { FactorKey, Line, PosCode, ProfileKey, TypeKey } from '../types';

export const KEY = 3;
export const HELPS = 2;
export const MINOR = 1;
export const NONE = 0;
export type Level = typeof KEY | typeof HELPS | typeof MINOR | typeof NONE;

export const LEVEL_SYMBOL: Record<Level, string> = { 3: '●', 2: '◕', 1: '◔', 0: '○' };

export const FACTORS: FactorKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'height', 'weight'];

export interface Profile {
  key: ProfileKey;
  weights: Record<FactorKey, Level>;
  types: TypeKey[];
}

const w = (
  hp: Level, atk: Level, def: Level, spa: Level, spd: Level, spe: Level, height: Level, weight: Level,
): Record<FactorKey, Level> => ({ hp, atk, def, spa, spd, spe, height, weight });

export const PROFILES: Record<ProfileKey, Profile> = {
  TW: {
    key: 'TW',
    weights: w(HELPS, NONE, HELPS, NONE, KEY, HELPS, KEY, MINOR),
    // Psycho: Antizipation · Stahl: Nerven · Geist: „Geisterhände" · Gestein: Fels in der Brandung
    types: ['psychic', 'steel', 'ghost', 'rock'],
  },
  IV: {
    key: 'IV',
    weights: w(HELPS, MINOR, KEY, NONE, MINOR, MINOR, HELPS, HELPS),
    types: ['rock', 'steel', 'ground', 'fighting'],
  },
  AV: {
    key: 'AV',
    weights: w(HELPS, MINOR, HELPS, MINOR, MINOR, KEY, NONE, NONE),
    // Gift: giftig im Zweikampf
    types: ['water', 'poison', 'normal'],
  },
  WB: {
    key: 'WB',
    weights: w(KEY, MINOR, MINOR, HELPS, NONE, KEY, NONE, NONE),
    // Käfer: Laufwunder · Pflanze: zäh und ausdauernd
    types: ['flying', 'bug', 'water', 'grass'],
  },
  DM: {
    key: 'DM',
    weights: w(HELPS, HELPS, KEY, MINOR, HELPS, MINOR, NONE, MINOR),
    types: ['fighting', 'ground', 'dark', 'poison'],
  },
  ZM: {
    key: 'ZM',
    weights: w(HELPS, MINOR, MINOR, KEY, HELPS, HELPS, NONE, NONE),
    // Pflanze: verwurzelt im Zentrum · Eis: kühler Kopf
    types: ['normal', 'grass', 'psychic', 'ice'],
  },
  OM: {
    key: 'OM',
    weights: w(NONE, MINOR, NONE, KEY, HELPS, HELPS, NONE, NONE),
    // Fee: Zauberfuß · Feuer: Leidenschaft
    types: ['fairy', 'dragon', 'fire'],
  },
  FM: {
    key: 'FM',
    weights: w(HELPS, MINOR, NONE, HELPS, MINOR, KEY, NONE, NONE),
    types: ['electric', 'bug', 'flying'],
  },
  FL: {
    key: 'FL',
    weights: w(NONE, HELPS, NONE, HELPS, NONE, KEY, NONE, NONE),
    // Unlicht: Schlitzohr am Flügel · Geist: taucht plötzlich auf
    types: ['dark', 'ghost', 'electric', 'fairy'],
  },
  ST: {
    key: 'ST',
    weights: w(MINOR, KEY, MINOR, HELPS, MINOR, HELPS, MINOR, MINOR),
    // Eis: eiskalt vor dem Tor
    types: ['fire', 'ice', 'dragon'],
  },
  SS: {
    key: 'SS',
    weights: w(NONE, HELPS, NONE, KEY, NONE, NONE, NONE, NONE),
    types: [],
  },
};

export interface PositionDef {
  code: PosCode;
  profile: ProfileKey;
  line: Line;
  /** Gewicht im Team-Score */
  teamWeight: number;
}

export const POSITIONS: Record<PosCode, PositionDef> = {
  TW: { code: 'TW', profile: 'TW', line: 'gk', teamWeight: 1.6 },
  IV: { code: 'IV', profile: 'IV', line: 'def', teamWeight: 1.2 },
  LV: { code: 'LV', profile: 'AV', line: 'def', teamWeight: 1.0 },
  RV: { code: 'RV', profile: 'AV', line: 'def', teamWeight: 1.0 },
  LWB: { code: 'LWB', profile: 'WB', line: 'def', teamWeight: 1.0 },
  RWB: { code: 'RWB', profile: 'WB', line: 'def', teamWeight: 1.0 },
  DM: { code: 'DM', profile: 'DM', line: 'mid', teamWeight: 1.1 },
  ZM: { code: 'ZM', profile: 'ZM', line: 'mid', teamWeight: 1.0 },
  OM: { code: 'OM', profile: 'OM', line: 'mid', teamWeight: 1.2 },
  LM: { code: 'LM', profile: 'FM', line: 'mid', teamWeight: 1.0 },
  RM: { code: 'RM', profile: 'FM', line: 'mid', teamWeight: 1.0 },
  LF: { code: 'LF', profile: 'FL', line: 'att', teamWeight: 1.0 },
  RF: { code: 'RF', profile: 'FL', line: 'att', teamWeight: 1.0 },
  ST: { code: 'ST', profile: 'ST', line: 'att', teamWeight: 1.4 },
  SS: { code: 'SS', profile: 'SS', line: 'att', teamWeight: 0 },
};

export type ProfileGroupKey = 'defense' | 'midfield' | 'attack';

/**
 * Gruppen für den Scouting-Guide. Überschriften und Kürzel kommen aus den Übersetzungen
 * (scouting.groups[key], game.profileCodes[profil]).
 */
export const PROFILE_GROUPS: { key: ProfileGroupKey; profiles: ProfileKey[] }[] = [
  { key: 'defense', profiles: ['TW', 'IV', 'AV', 'WB'] },
  { key: 'midfield', profiles: ['DM', 'ZM', 'OM', 'FM'] },
  { key: 'attack', profiles: ['FL', 'ST', 'SS'] },
];
