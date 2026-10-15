import { describe, expect, it } from 'vitest';
import { FORMATIONS } from '../src/config/formations';
import { POSITIONS } from '../src/config/positions';
import { buildScale, positionFit } from '../src/lib/fit';
import { CPU_LEVELS, cpuLevelOf, cpuPickChoice } from '../src/lib/localCpu';
import { createRng } from '../src/lib/rng';
import { ALL } from './helpers';

const SCALE = buildScale(ALL, 'all');
const POOL = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
const TEAM = { formation: '4-3-3' as const, slots: FORMATIONS['4-3-3'].slots.map(() => null) };
const value = (c: { slot: number; id: number }) => {
  const pos = FORMATIONS['4-3-3'].slots[c.slot].pos;
  return positionFit(POOL.find((p) => p.id === c.id)!, pos, SCALE) * (0.92 + 0.08 * POSITIONS[pos].teamWeight);
};

describe('CPU-Stärke im lokalen Draft', () => {
  it('Stark: immer der beste Pick (ohne Zufall)', () => {
    const a = cpuPickChoice(TEAM, POOL, SCALE, 'hard', createRng(1))!;
    const b = cpuPickChoice(TEAM, POOL, SCALE, 'hard', createRng(999))!;
    expect(a).toEqual(b);
    // Kein anderer Kandidat ist besser
    const best = Math.max(
      ...FORMATIONS['4-3-3'].slots.flatMap((_, slot) => POOL.map((p) => value({ slot, id: p.id }))),
    );
    expect(value(a)).toBeCloseTo(best, 6);
  });

  it('Leicht greift im Schnitt deutlich schwächer zu als Normal, Normal schwächer als Stark', () => {
    const avg = (level: 'easy' | 'normal' | 'hard') => {
      let sum = 0;
      for (let i = 0; i < 200; i++) sum += value(cpuPickChoice(TEAM, POOL, SCALE, level, createRng(i + 1))!);
      return sum / 200;
    };
    const easy = avg('easy');
    const normal = avg('normal');
    const hard = avg('hard');
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThanOrEqual(hard);
    expect(hard - easy).toBeGreaterThan(2);
  });

  it('Gespeicherter Wert: unbekannt zählt als normal; voller Kader ⇒ kein Pick', () => {
    expect(cpuLevelOf('hard')).toBe('hard');
    expect(cpuLevelOf(undefined)).toBe('normal');
    expect(cpuLevelOf('quatsch')).toBe('normal');
    expect(Object.keys(CPU_LEVELS)).toEqual(['easy', 'normal', 'hard']);
    const full = { formation: TEAM.formation, slots: POOL.slice(0, 11).map((p) => p.id) };
    expect(cpuPickChoice(full, POOL, SCALE, 'normal', createRng(1))).toBeNull();
  });
});
