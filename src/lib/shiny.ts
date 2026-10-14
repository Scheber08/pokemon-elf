/**
 * Shinys im Draft: Mit geringer Chance ist ein gepicktes Pokémon schillernd. Es spielt selbst besser
 * (Positionspassung + SHINY_FIT_BONUS) und gibt dem ganzen Team einen Bonus auf den Team-Score –
 * umso größer, je schwächer das Pokémon (Summe der Basiswerte). So bekommen auch Schwache eine Rolle.
 * Ob ein Pick schillert, folgt deterministisch aus einem (geheimen) Seed und der Pokémon-ID.
 */
import type { Pokemon } from '../types';
import { hashSeed } from './rng';

/** Chance je Pick */
export const SHINY_CHANCE = 0.02;
/** Bessere Werte: so viele Punkte mehr Positionspassung (0–100) */
export const SHINY_FIT_BONUS = 10;
/** Team-Bonus (Team-Score-Punkte) eines sehr schwachen Shinys; starke geben weniger (mindestens 10 %) */
export const SHINY_TEAM_MAX = 40;

const statTotal = (p: Pick<Pokemon, 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'>) => p.hp + p.atk + p.def + p.spa + p.spd + p.spe;

/** Ist dieses Pokémon bei diesem Seed ein Shiny? */
export function shinyRoll(seed: number, pokemonId: number): boolean {
  return hashSeed(seed, 'shiny', pokemonId) / 0x80000000 < SHINY_CHANCE;
}

/** Team-Bonus eines Shinys: 200 Basiswerte → voller Bonus, 600+ → 10 % */
export function shinyTeamBoost(p: Pick<Pokemon, 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'>): number {
  const share = Math.max(0.1, Math.min(1, (600 - statTotal(p)) / 400));
  return Math.round(SHINY_TEAM_MAX * share);
}

/** Team-Bonus aller Shinys einer Aufstellung (nur Spieler auf dem Feld) */
export function shinyBonus(players: readonly (Pokemon | null | undefined)[], shinies: ReadonlySet<number> | undefined): number {
  if (!shinies?.size) return 0;
  return players.reduce((n, p) => n + (p && shinies.has(p.id) ? shinyTeamBoost(p) : 0), 0);
}
