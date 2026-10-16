/**
 * Testspiel: die eigene Elf (Builder) gegen ein Team der Rangliste – Hin- und Rückspiel mit
 * derselben Simulation wie die Ligen (Team-Score, Heimvorteil, Standardschütze, Torschützen).
 * Deterministisch aus dem Seed; der Zufall des Seeds kommt von außen.
 */
import { DEFAULT_DRAFT_SETTINGS, type DraftTeam } from './api/draftContract';
import { leagueTeams } from './draftEngine';
import type { Scale } from './fit';
import { createRng } from './rng';
import { DRAFT_MODEL, simulateLeague, type Match } from './season';
import type { FormationId, Pokemon } from '../types';

export interface FriendlySide {
  name: string;
  formation: FormationId;
  slots: (number | null)[];
  /** Standardschütze (null = keiner) */
  ss: number | null;
  /** Kapitän (Pokémon-ID aus der Elf) – zählt doppelt */
  captain?: number | null;
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
  ...(s.captain != null && s.slots.includes(s.captain) ? { captain: s.captain } : {}),
});

export function friendlyMatch(own: FriendlySide, opp: FriendlySide, byId: Map<number, Pokemon>, scale: Scale, seed: number): FriendlyResult {
  const teams = leagueTeams({ teams: [asTeam(own, 'own'), asTeam(opp, 'opp')], settings: DEFAULT_DRAFT_SETTINGS }, byId, scale);
  // Wie der Online-Draft: realistischere Ergebnisse, Tagesform, Torminuten (zählt für keine Rangliste)
  const league = simulateLeague(teams, createRng(seed), DRAFT_MODEL);
  // Hinspiel zuerst, mit der eigenen Elf zu Hause
  const matches = [...league.matches].sort((a, b) => Number(b.home === 0) - Number(a.home === 0));
  const goals = (team: 0 | 1) => matches.reduce((n, m) => n + (m.home === team ? m.hg : m.ag), 0);
  return { ratings: [teams[0].rating, teams[1].rating], matches, aggregate: [goals(0), goals(1)] };
}

/** Volle Elf? (alle 11 Plätze besetzt) */
export const fullEleven = (slots: readonly (number | null)[]): boolean => slots.length === 11 && slots.every((id) => id != null);

/**
 * ⭐ Mann des Spiels über Hin- und Rückspiel: meiste Tore (ab 2), bei Gleichstand mehr Vorlagen; sonst
 * eindeutig niemand (null). team: 0 = eigene Elf, 1 = Gegner.
 */
export function friendlyStar(matches: readonly Match[]): { pokemonId: number; team: 0 | 1; goals: number } | null {
  const tally = new Map<string, { pokemonId: number; team: 0 | 1; goals: number; assists: number }>();
  const add = (team: 0 | 1, id: number, kind: 'goals' | 'assists') => {
    const key = `${team}:${id}`;
    const cur = tally.get(key) ?? { pokemonId: id, team, goals: 0, assists: 0 };
    cur[kind]++;
    tally.set(key, cur);
  };
  for (const m of matches)
    for (const [team, goals] of [
      [m.home as 0 | 1, m.homeScorers],
      [m.away as 0 | 1, m.awayScorers],
    ] as const)
      for (const g of goals) {
        add(team, g.pokemonId, 'goals');
        if (g.assist != null) add(team, g.assist, 'assists');
      }
  const ranked = [...tally.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists);
  const [top, next] = ranked;
  if (!top || top.goals < 2 || (next && next.goals === top.goals && next.assists === top.assists)) return null;
  return { pokemonId: top.pokemonId, team: top.team, goals: top.goals };
}
