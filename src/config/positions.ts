/**
 * Positionen und Bewertungsprofile.
 *
 * Jede Position verweist auf ein Profil. Ein Profil legt fest, wie stark jeder
 * Faktor zählt: KEY (Schlüssel) = 3, HELPS (Hilft) = 2, MINOR (Kleiner Anteil) = 1,
 * NONE (Zählt nicht) = 0. Die Typen-Liste ist nach Bonus sortiert (+3 %, +2 %, +1 %).
 */
import type { FactorKey, Line, PosCode, ProfileKey, TypeKey } from '../types';

export const KEY = 3;
export const HELPS = 2;
export const MINOR = 1;
export const NONE = 0;
export type Level = typeof KEY | typeof HELPS | typeof MINOR | typeof NONE;

export const LEVEL_LABEL: Record<Level, string> = {
  3: 'Schlüssel',
  2: 'Hilft',
  1: 'Kleiner Anteil',
  0: 'Zählt nicht',
};

export const LEVEL_SYMBOL: Record<Level, string> = { 3: '●', 2: '◕', 1: '◔', 0: '○' };

export const FACTORS: FactorKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'height', 'weight'];

export const FACTOR_LABEL: Record<FactorKey, string> = {
  hp: 'KP',
  atk: 'ANG',
  def: 'VERT',
  spa: 'SP.ANG',
  spd: 'SP.VERT',
  spe: 'INIT',
  height: 'GRÖSSE',
  weight: 'GEWICHT',
};

export const FACTOR_LONG: Record<FactorKey, string> = {
  hp: 'KP',
  atk: 'Angriff',
  def: 'Verteidigung',
  spa: 'Sp.-Angriff',
  spd: 'Sp.-Verteidigung',
  spe: 'Initiative',
  height: 'Größe',
  weight: 'Gewicht',
};

export interface Profile {
  key: ProfileKey;
  /** Kurztitel, z. B. „Innenverteidiger" */
  title: string;
  /** Rollenbeschreibung für den Scouting-Guide */
  role: string;
  weights: Record<FactorKey, Level>;
  /** Kurze Anmerkungen pro Faktor (nur Anzeige im Scouting-Guide) */
  notes?: Partial<Record<FactorKey, string>>;
  types: TypeKey[];
}

const w = (
  hp: Level, atk: Level, def: Level, spa: Level, spd: Level, spe: Level, height: Level, weight: Level,
): Record<FactorKey, Level> => ({ hp, atk, def, spa, spd, spe, height, weight });

export const PROFILES: Record<ProfileKey, Profile> = {
  TW: {
    key: 'TW',
    title: 'Torwart',
    role: 'Hält Bälle, organisiert die Abwehr.',
    weights: w(HELPS, NONE, HELPS, NONE, KEY, HELPS, KEY, MINOR),
    notes: { spd: 'Reflexe/Ruhe' },
    types: ['psychic', 'steel', 'ghost'],
  },
  IV: {
    key: 'IV',
    title: 'Innenverteidiger',
    role: 'Zweikämpfe und Kopfbälle.',
    weights: w(HELPS, MINOR, KEY, NONE, MINOR, MINOR, HELPS, HELPS),
    types: ['rock', 'steel', 'ground', 'fighting'],
  },
  AV: {
    key: 'AV',
    title: 'Außenverteidiger',
    role: 'Verteidigen die Flanke und schalten sich ein.',
    weights: w(HELPS, MINOR, HELPS, MINOR, MINOR, KEY, NONE, NONE),
    notes: { hp: 'Ausdauer' },
    types: ['water', 'flying', 'normal'],
  },
  WB: {
    key: 'WB',
    title: 'Schienenspieler',
    role: 'Die ganze Seitenlinie rauf und runter.',
    weights: w(KEY, MINOR, MINOR, HELPS, NONE, KEY, NONE, NONE),
    types: ['flying', 'water', 'electric'],
  },
  DM: {
    key: 'DM',
    title: 'Sechser',
    role: 'Balleroberer vor der Abwehr.',
    weights: w(HELPS, HELPS, KEY, MINOR, HELPS, MINOR, NONE, MINOR),
    types: ['fighting', 'dark', 'ground'],
  },
  ZM: {
    key: 'ZM',
    title: 'Zentrales Mittelfeld',
    role: 'Taktgeber und Box-to-Box.',
    weights: w(HELPS, MINOR, MINOR, KEY, HELPS, HELPS, NONE, NONE),
    notes: { spa: 'Passspiel', spd: 'Spielübersicht' },
    types: ['normal', 'psychic', 'fighting'],
  },
  OM: {
    key: 'OM',
    title: 'Zehner',
    role: 'Kreativspieler hinter den Spitzen.',
    weights: w(NONE, MINOR, NONE, KEY, HELPS, HELPS, NONE, NONE),
    types: ['psychic', 'fairy', 'dragon'],
  },
  FM: {
    key: 'FM',
    title: 'Außenbahn',
    role: 'Flanken und Tempo.',
    weights: w(HELPS, MINOR, NONE, HELPS, MINOR, KEY, NONE, NONE),
    types: ['electric', 'flying', 'normal'],
  },
  FL: {
    key: 'FL',
    title: 'Flügelstürmer',
    role: 'Dribbling und Abschluss von außen.',
    weights: w(NONE, HELPS, NONE, HELPS, NONE, KEY, NONE, NONE),
    types: ['electric', 'flying', 'fairy'],
  },
  ST: {
    key: 'ST',
    title: 'Stürmer',
    role: 'Tore schießen, Bälle festmachen.',
    weights: w(MINOR, KEY, MINOR, HELPS, MINOR, HELPS, MINOR, MINOR),
    notes: { atk: 'Schusskraft', spa: 'Abschluss', height: 'Kopfball' },
    types: ['fire', 'fighting', 'dragon'],
  },
  SS: {
    key: 'SS',
    title: 'Standardschütze',
    role: 'Freistöße und Elfmeter. Optional, zählt nicht zum Team-Score.',
    weights: w(NONE, HELPS, NONE, KEY, NONE, NONE, NONE, NONE),
    notes: { spa: 'Technik', atk: 'Schusskraft' },
    types: [],
  },
};

export interface PositionDef {
  code: PosCode;
  name: string;
  profile: ProfileKey;
  line: Line;
  /** Gewicht im Team-Score */
  teamWeight: number;
}

export const POSITIONS: Record<PosCode, PositionDef> = {
  TW: { code: 'TW', name: 'Torwart', profile: 'TW', line: 'gk', teamWeight: 1.6 },
  IV: { code: 'IV', name: 'Innenverteidiger', profile: 'IV', line: 'def', teamWeight: 1.2 },
  LV: { code: 'LV', name: 'Linker Verteidiger', profile: 'AV', line: 'def', teamWeight: 1.0 },
  RV: { code: 'RV', name: 'Rechter Verteidiger', profile: 'AV', line: 'def', teamWeight: 1.0 },
  LWB: { code: 'LWB', name: 'Linker Schienenspieler', profile: 'WB', line: 'def', teamWeight: 1.0 },
  RWB: { code: 'RWB', name: 'Rechter Schienenspieler', profile: 'WB', line: 'def', teamWeight: 1.0 },
  DM: { code: 'DM', name: 'Defensives Mittelfeld', profile: 'DM', line: 'mid', teamWeight: 1.1 },
  ZM: { code: 'ZM', name: 'Zentrales Mittelfeld', profile: 'ZM', line: 'mid', teamWeight: 1.0 },
  OM: { code: 'OM', name: 'Offensives Mittelfeld', profile: 'OM', line: 'mid', teamWeight: 1.2 },
  LM: { code: 'LM', name: 'Linkes Mittelfeld', profile: 'FM', line: 'mid', teamWeight: 1.0 },
  RM: { code: 'RM', name: 'Rechtes Mittelfeld', profile: 'FM', line: 'mid', teamWeight: 1.0 },
  LF: { code: 'LF', name: 'Linksaußen', profile: 'FL', line: 'att', teamWeight: 1.0 },
  RF: { code: 'RF', name: 'Rechtsaußen', profile: 'FL', line: 'att', teamWeight: 1.0 },
  ST: { code: 'ST', name: 'Stürmer', profile: 'ST', line: 'att', teamWeight: 1.4 },
  SS: { code: 'SS', name: 'Standardschütze', profile: 'SS', line: 'att', teamWeight: 0 },
};

/** Gruppen für den Scouting-Guide. */
export const PROFILE_GROUPS: { title: string; profiles: { key: ProfileKey; codes: string }[] }[] = [
  {
    title: 'Abwehr & Torwart',
    profiles: [
      { key: 'TW', codes: 'TW' },
      { key: 'IV', codes: 'IV' },
      { key: 'AV', codes: 'LV/RV' },
      { key: 'WB', codes: 'LWB/RWB' },
    ],
  },
  {
    title: 'Mittelfeld',
    profiles: [
      { key: 'DM', codes: 'DM' },
      { key: 'ZM', codes: 'ZM' },
      { key: 'OM', codes: 'OM' },
      { key: 'FM', codes: 'LM/RM' },
    ],
  },
  {
    title: 'Angriff',
    profiles: [
      { key: 'FL', codes: 'LF/RF' },
      { key: 'ST', codes: 'ST' },
      { key: 'SS', codes: 'SS' },
    ],
  },
];
