/**
 * Team-Score (0–1.000): gewichteter Durchschnitt der 11 Fits × 10.
 * Die drei schwächsten Fits gehen zusätzlich mit doppeltem Gewicht ein –
 * ein Loch zieht stärker runter, als ein Star hebt.
 * Der Kapitän (optional) zählt mit doppeltem Positionsgewicht – ohne Kapitän ändert sich nichts.
 */
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { SCORING } from '../config/scoring';
import type { FormationId, PosCode, Pokemon } from '../types';
import { positionFit, type Scale } from './fit';

export interface TeamEvaluation {
  /** 0–1.000, gerundet */
  score: number;
  /** ungerundeter Score */
  exact: number;
  /** Fit je Slot (0–100), leere Slots = 0 */
  fits: number[];
  /** Indizes der schwächsten Slots */
  weakest: number[];
}

/** Kernformel – arbeitet nur auf Zahlen und ist dadurch leicht testbar. */
export function teamScoreFromFits(fits: number[], weights: number[]): { exact: number; weakest: number[] } {
  if (!fits.length) return { exact: 0, weakest: [] };
  const { weakestCount, weakestExtra, factor } = SCORING.team;
  const order = fits.map((_, i) => i).sort((a, b) => fits[a] - fits[b] || weights[b] - weights[a]);
  const weakest = order.slice(0, Math.min(weakestCount, fits.length));
  let sum = 0;
  let total = 0;
  fits.forEach((f, i) => {
    const w = weights[i] * (weakest.includes(i) ? 1 + weakestExtra : 1);
    sum += w * f;
    total += w;
  });
  return { exact: total ? (sum / total) * factor : 0, weakest };
}

/** Positionsgewichte mit Kapitän: dessen Slot zählt captainWeight-fach (unbekannter Kapitän = keiner). */
export function captainWeights(weights: number[], ids: readonly (number | null | undefined)[], captain: number | null | undefined): number[] {
  if (captain == null) return weights;
  const i = ids.findIndex((id) => id === captain);
  return i < 0 ? weights : weights.map((w, j) => (j === i ? w * SCORING.team.captainWeight : w));
}

export function evaluateTeam(
  formation: FormationId,
  players: (Pokemon | null | undefined)[],
  scale: Scale,
  /** Pokémon-ID des Kapitäns (null/undefined = keiner) */
  captain?: number | null,
  /** Zusätzliche Passung je Pokémon (z. B. Shinys) – Ergebnis auf 0–100 begrenzt */
  fitBonus?: (pokemonId: number) => number,
): TeamEvaluation {
  const slots = FORMATIONS[formation].slots;
  const fits = slots.map((s, i) => {
    const p = players[i];
    if (!p) return 0;
    const f = positionFit(p, s.pos, scale);
    return fitBonus ? Math.min(100, f + fitBonus(p.id)) : f;
  });
  const weights = captainWeights(
    slots.map((s) => POSITIONS[s.pos].teamWeight),
    slots.map((_, i) => players[i]?.id),
    captain,
  );
  const { exact, weakest } = teamScoreFromFits(fits, weights);
  return { score: Math.round(exact), exact, fits, weakest };
}

export function positionWeights(formation: FormationId): number[] {
  return FORMATIONS[formation].slots.map((s) => POSITIONS[s.pos].teamWeight);
}

export function slotPositions(formation: FormationId): PosCode[] {
  return FORMATIONS[formation].slots.map((s) => s.pos);
}
