/**
 * Testspiel: die eigene Elf (Builder) gegen ein Team der Rangliste – Hin- und Rückspiel mit
 * derselben Simulation wie die Ligen (Team-Score, Heimvorteil, Standardschütze, Torschützen).
 * Deterministisch aus dem Seed; der Zufall des Seeds kommt von außen.
 */
import { DEFAULT_DRAFT_SETTINGS, type DraftTeam } from './api/draftContract';
import { leagueTeams } from './draftEngine';
import type { Scale } from './fit';
import { createRng } from './rng';
import { simulateLeague, type Match } from './season';
import type { FormationId, Pokemon } from '../types';

export interface FriendlySide {
  name: string;
  formation: FormationId;
  slots: (number | null)[];
  /** Standardschütze (null = keiner) */
  ss: number | null;
}

export interface FriendlyResult {
  /** Team-Score [eigene Elf, Gegner] */
  ratings: [number, number];
  /** Hinspiel (eigene Elf zu Hause) und Rückspiel; Team 0 = eigene Elf */
  matches: Match[];
  /** Tore über beide Spiele [eigene Elf, Gegner] */
  aggregate: [number, number];
}

const asTeam = (s: FriendlySide, id: string): DraftTeam => ({
  id,
  name: s.name,
  formation: s.formation,
  cpu: false,
  online: true,
  slots: s.slots,
  ss: s.ss,
});

export function friendlyMatch(own: FriendlySide, opp: FriendlySide, byId: Map<number, Pokemon>, scale: Scale, seed: number): FriendlyResult {
  const teams = leagueTeams({ teams: [asTeam(own, 'own'), asTeam(opp, 'opp')], settings: DEFAULT_DRAFT_SETTINGS }, byId, scale);
  const league = simulateLeague(teams, createRng(seed));
  // Hinspiel zuerst, mit der eigenen Elf zu Hause
  const matches = [...league.matches].sort((a, b) => Number(b.home === 0) - Number(a.home === 0));
  const goals = (team: 0 | 1) => matches.reduce((n, m) => n + (m.home === team ? m.hg : m.ag), 0);
  return { ratings: [teams[0].rating, teams[1].rating], matches, aggregate: [goals(0), goals(1)] };
}

/** Volle Elf? (alle 11 Plätze besetzt) */
export const fullEleven = (slots: readonly (number | null)[]): boolean => slots.length === 11 && slots.every((id) => id != null);
