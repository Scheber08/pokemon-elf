/**
 * CPU-Picks im lokalen Draft (an einem Gerät): je freiem Platz die besten Kandidaten nach Positions-Fit,
 * daraus der beste Wert aus Fit × Positionsgewicht plus Zufall. Die Stärke bestimmt, wie viele Kandidaten
 * in Frage kommen und wie viel Zufall mitspielt. Rein – der Zufall kommt als rng von außen.
 */
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import type { FormationId, Pokemon } from '../types';
import { positionFit, type Scale } from './fit';
import { gaussian } from './rng';

export type CpuLevel = 'easy' | 'normal' | 'hard';

/** Aus wie vielen Top-Kandidaten je Platz gewählt wird und wie viel Zufall (Fit-Punkte) mitspielt */
export const CPU_LEVELS: Record<CpuLevel, { top: number; noise: number }> = {
  easy: { top: 12, noise: 18 },
  normal: { top: 4, noise: 5 },
  hard: { top: 1, noise: 0 },
};

/** Gespeicherten Wert lesen: unbekannte Werte (alter oder kaputter Stand) zählen als „normal“ */
export function cpuLevelOf(value: unknown): CpuLevel {
  return value === 'easy' || value === 'hard' ? value : 'normal';
}

export function cpuPickChoice(
  team: { formation: FormationId; slots: readonly (number | null)[] },
  pool: readonly Pokemon[],
  scale: Scale,
  level: CpuLevel,
  rng: () => number,
): { slot: number; id: number } | null {
  const { top, noise } = CPU_LEVELS[level];
  let best: { score: number; slot: number; id: number } | null = null;
  for (const [slot, d] of FORMATIONS[team.formation].slots.entries()) {
    if (team.slots[slot] != null) continue;
    const candidates = pool
      .map((p) => ({ p, fit: positionFit(p, d.pos, scale) }))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, top);
    for (const { p, fit } of candidates) {
      const score = fit * (0.92 + 0.08 * POSITIONS[d.pos].teamWeight) + (noise ? gaussian(rng) * noise : 0);
      if (!best || score > best.score) best = { score, slot, id: p.id };
    }
  }
  return best && { slot: best.slot, id: best.id };
}
