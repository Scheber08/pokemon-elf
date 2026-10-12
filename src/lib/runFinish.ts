import { FORMATIONS } from '../config/formations';
import type { ChallengeKey, FormationId, Pokemon, Slots } from '../types';
import { recordRun as recordStats, type ChallengeStats } from './challengeStats';
import { positionFit, type Scale } from './fit';
import { leaderboard } from './leaderboard';
import { simulateSeason, type SeasonResult, type SquadPlayer } from './season';
import { load, STORAGE_KEYS } from './storage';
import { evaluateTeam, type TeamEvaluation } from './teamScore';

export interface FinishedRunInput {
  formation: FormationId;
  slots: Slots;
  /** undefined = ohne Standardschützen */
  ss?: number | null;
  teamName: string;
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
  const evaluation = evaluateTeam(input.formation, players, scale);
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

export function playerName(): string {
  return load<string>(STORAGE_KEYS.playerName, '') || 'Trainer';
}

/** Statistik aktualisieren und den Run auf die Rangliste posten. */
export async function recordFinishedRun(
  challenge: ChallengeKey,
  input: FinishedRunInput,
  run: ComputedRun,
): Promise<{ stats: ChallengeStats; entryId: string | null }> {
  const stats = recordStats(challenge, run.evaluation.score, run.season.record);
  let entryId: string | null = null;
  try {
    if (!leaderboard.requiresLogin || leaderboard.isLoggedIn()) {
      const entry = await leaderboard.submit({
        challenge,
        player: playerName(),
        record: run.season.record,
        points: run.season.points,
        score: run.evaluation.score,
        formation: input.formation,
        lineup: [...input.slots, ...(input.ss !== undefined ? [input.ss] : [])],
        teamName: input.teamName,
      });
      entryId = entry.id;
    }
  } catch (e) {
    console.warn('Rangliste nicht erreichbar', e);
  }
  return { stats, entryId };
}
