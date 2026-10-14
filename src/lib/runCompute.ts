/**
 * Reine Auswertung eines fertigen Runs: Team-Score + Saison.
 * Läuft identisch im Browser und im Cloudflare-Backend (keine Browser-APIs).
 */
import { FORMATIONS } from '../config/formations';
import type { FormationId, Pokemon, Slots } from '../types';
import { positionFit, type Scale } from './fit';
import { simulateSeason, type SeasonResult, type SquadPlayer } from './season';
import { evaluateTeam, type TeamEvaluation } from './teamScore';

export interface FinishedRunInput {
  formation: FormationId;
  slots: Slots;
  /** undefined = ohne Standardschützen */
  ss?: number | null;
  teamName: string;
  /** Pokémon-ID des Kapitäns (fehlt/null = keiner) – seine Passung zählt doppelt */
  captain?: number | null;
  /** Seed der Saison-Simulation */
  seed: number;
}

export interface ComputedRun {
  evaluation: TeamEvaluation;
  season: SeasonResult;
}

/** Team-Score + deterministische Saison aus Aufstellung und Seed. */
export function computeRun(input: FinishedRunInput, byId: Map<number, Pokemon>, scale: Scale): ComputedRun {
  const defs = FORMATIONS[input.formation].slots;
  const players = input.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
  const evaluation = evaluateTeam(input.formation, players, scale, input.captain);
  const squad: SquadPlayer[] = players.flatMap((p, i) =>
    p ? [{ pokemonId: p.id, pos: defs[i].pos, atk: p.atk, spa: p.spa }] : [],
  );
  const ssPokemon = input.ss != null ? byId.get(input.ss) : undefined;
  const season = simulateSeason({
    teamName: input.teamName,
    score: evaluation.score,
    squad,
    setPieceTaker: ssPokemon ? { pokemonId: ssPokemon.id, pos: 'SS', atk: ssPokemon.atk, spa: ssPokemon.spa } : null,
    setPieceFit: ssPokemon ? positionFit(ssPokemon, 'SS', scale) : undefined,
    seed: input.seed,
  });
  return { evaluation, season };
}
