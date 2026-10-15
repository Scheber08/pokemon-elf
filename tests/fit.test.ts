import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/config/positions';
import { TYPE_KEYS, dominantType } from '../src/config/pokemonTypes';
import { SCORING } from '../src/config/scoring';
import { buildScale, cdf, soleTopIndex, roundBestPicks, compositeScore, positionFit, profileFit, typeBonus, weightScore } from '../src/lib/fit';
import type { ProfileKey } from '../src/types';
import { ALL, byName, mon } from './helpers';

const scale = buildScale(ALL, 'all');
const gen1Scale = buildScale(
  ALL.filter((p) => p.gen === 1),
  'gen1',
);
const PROFILE_KEYS = Object.keys(PROFILES) as ProfileKey[];

describe('cdf', () => {
  it('liefert den Anteil der Werte ≤ v', () => {
    const sorted = Float64Array.from([10, 20, 20, 30]);
    expect(cdf(sorted, 5)).toBe(0);
    expect(cdf(sorted, 10)).toBe(0.25);
    expect(cdf(sorted, 20)).toBe(0.75);
    expect(cdf(sorted, 99)).toBe(1);
  });
});

describe('Gewicht (logarithmisch, gedeckelt)', () => {
  it('jede Verdopplung zählt gleich viel', () => {
    const a = weightScore(50) - weightScore(25);
    const b = weightScore(200) - weightScore(100);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeGreaterThan(0);
  });

  it('ist bei der Obergrenze gedeckelt und bleibt in 0–1', () => {
    expect(weightScore(SCORING.weight.capKg)).toBe(1);
    expect(weightScore(999.9)).toBe(1);
    expect(weightScore(0.1)).toBe(0);
  });
});

describe('Positions-Fit', () => {
  it('liegt für alle Pokémon und Profile zwischen 0 und 100', () => {
    for (const p of ALL) {
      for (const k of PROFILE_KEYS) {
        const f = profileFit(p, k, scale);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(100);
      }
    }
  });

  it('Schlüsselwerte heben den Fit (Sp.-Vert. beim TW, Vert. beim IV, Init. beim AV)', () => {
    const base = mon();
    expect(positionFit(mon({ spd: 140 }), 'TW', scale)).toBeGreaterThan(positionFit(base, 'TW', scale));
    expect(positionFit(mon({ def: 140 }), 'IV', scale)).toBeGreaterThan(positionFit(base, 'IV', scale));
    expect(positionFit(mon({ spe: 140 }), 'LV', scale)).toBeGreaterThan(positionFit(base, 'LV', scale));
    expect(positionFit(mon({ atk: 140 }), 'ST', scale)).toBeGreaterThan(positionFit(base, 'ST', scale));
  });

  it('Schlüssel zählt mehr als „Hilft" (Sp.-Ang. vs. Init. beim ZM)', () => {
    const keyBoost = positionFit(mon({ spa: 130 }), 'ZM', scale);
    const helpBoost = positionFit(mon({ spe: 130 }), 'ZM', scale);
    expect(keyBoost).toBeGreaterThan(helpBoost);
  });

  it('Faktoren mit „Zählt nicht" ändern nichts (Angriff beim TW)', () => {
    expect(positionFit(mon({ atk: 10 }), 'TW', scale)).toBe(positionFit(mon({ atk: 200 }), 'TW', scale));
  });

  it('Größe ist bei 2,2 m gedeckelt', () => {
    const tall = positionFit(mon({ h: SCORING.height.cap }), 'TW', scale);
    const giant = positionFit(mon({ h: 14.5 }), 'TW', scale);
    const small = positionFit(mon({ h: 0.4 }), 'TW', scale);
    expect(giant).toBe(tall);
    expect(tall).toBeGreaterThan(small);
  });

  it('Größe zählt nur, wo angegeben (nicht beim Flügelstürmer)', () => {
    expect(positionFit(mon({ h: 0.3 }), 'LF', scale)).toBe(positionFit(mon({ h: 2.0 }), 'LF', scale));
  });

  it('LV und RV teilen sich ein Profil', () => {
    const p = byName('Turtok');
    expect(positionFit(p, 'LV', scale)).toBe(positionFit(p, 'RV', scale));
  });

  it('plausible Rangfolge mit echten Daten', () => {
    // Relaxo (groß, viel KP/Sp.-Vert.) ist ein besserer Torwart als Pichu.
    expect(positionFit(byName('Relaxo'), 'TW', scale)).toBeGreaterThan(positionFit(byName('Pichu'), 'TW', scale));
    // Stahlos (Verteidigung 200) ist ein besserer IV als Simsala.
    expect(positionFit(byName('Stahlos'), 'IV', scale)).toBeGreaterThan(positionFit(byName('Simsala'), 'IV', scale));
    // Simsala ist ein besserer Zehner als Stahlos.
    expect(positionFit(byName('Simsala'), 'OM', scale)).toBeGreaterThan(positionFit(byName('Stahlos'), 'OM', scale));
  });
});

describe('Typ-Bonus', () => {
  it('ist ausgeglichen: jeder Typ bei genau zwei Positionen, zusammen +3 % bis +4 %', () => {
    for (const t of TYPE_KEYS) {
      const where = Object.values(PROFILES).filter((p) => p.types.includes(t));
      const total = where.reduce((a, p) => a + SCORING.typeBonus[Math.min(p.types.indexOf(t), SCORING.typeBonus.length - 1)], 0);
      expect(where.length, t).toBe(2);
      expect(total, t).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(total, t).toBeLessThanOrEqual(0.04 + 1e-9);
    }
  });

  it('+3 % für den ersten, +2 %/+1 % für die weiteren gelisteten Typen', () => {
    expect(typeBonus(mon({ types: ['psychic'] }), 'TW')).toBeCloseTo(0.03);
    expect(typeBonus(mon({ types: ['steel'] }), 'TW')).toBeCloseTo(0.02);
    expect(typeBonus(mon({ types: ['ghost'] }), 'TW')).toBeCloseTo(0.01);
    expect(typeBonus(mon({ types: ['psychic', 'steel'] }), 'TW')).toBeCloseTo(0.05);
    expect(typeBonus(mon({ types: ['fire'] }), 'TW')).toBe(0);
  });

  it('ist nur ein Tie-Breaker: gleiche Werte, passender Typ → leicht höherer Fit', () => {
    const plain = positionFit(mon({ types: ['bug'] }), 'IV', scale);
    const rock = positionFit(mon({ types: ['rock'] }), 'IV', scale);
    expect(rock).toBeGreaterThan(plain);
    expect(rock - plain).toBeLessThanOrEqual(plain * 0.03 + 1e-9);
  });

  it('beeinflusst den gewichteten Rohwert nicht', () => {
    expect(compositeScore(mon({ types: ['rock'] }), 'IV', scale)).toBe(compositeScore(mon({ types: ['bug'] }), 'IV', scale));
  });
});

describe('Eigene Gen-1-Skalierung', () => {
  it('normalisiert nur über die Original-151', () => {
    expect(gen1Scale.size).toBe(151);
    expect(scale.size).toBe(ALL.length);
  });

  it('dasselbe Pokémon wird im Gen-1-Pool anders eingeordnet', () => {
    const glurak = byName('Glurak');
    const diffs = PROFILE_KEYS.map((k) => Math.abs(profileFit(glurak, k, gen1Scale) - profileFit(glurak, k, scale)));
    expect(Math.max(...diffs)).toBeGreaterThan(0.5);
  });

  it('auch im Gen-1-Pool gelten die Grenzen 0–100', () => {
    for (const p of ALL.filter((x) => x.gen === 1)) {
      for (const k of PROFILE_KEYS) {
        const f = profileFit(p, k, gen1Scale);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('soleTopIndex (👑 auf dem Draft-Board)', () => {
  it('nur der alleinige Bestwert bei mindestens zwei Werten', () => {
    expect(soleTopIndex([50, null, 72, 60])).toBe(2);
    expect(soleTopIndex([72, 72, 10])).toBeNull();
    expect(soleTopIndex([80, null])).toBeNull();
    expect(soleTopIndex([])).toBeNull();
  });
});

describe('dominantType (Typ-Elf auf dem Draft-Board)', () => {
  const mk = (...types: (typeof TYPE_KEYS)[number][]) => ({ types });
  it('ab vier Pokémon eines Typs, nur ohne Gleichstand', () => {
    expect(dominantType([mk('fire'), mk('fire', 'flying'), mk('fire'), mk('water')])).toBeNull();
    expect(dominantType([mk('fire'), mk('fire', 'flying'), mk('fire'), mk('fire', 'ground'), mk('water')])).toEqual({ type: 'fire', n: 4 });
    expect(dominantType([...Array(4)].flatMap(() => [mk('fire'), mk('water')]))).toBeNull();
    expect(dominantType([])).toBeNull();
  });
});

describe('roundBestPicks', () => {
  it('höchster Fit je Runde, bei Gleichstand der frühere, ohne Fit nichts', () => {
    // Runde 1: 70, 90, 80 → Index 1; Runde 2: 50, 50, null → Index 3; Runde 3: null, null → keiner
    expect([...roundBestPicks([70, 90, 80, 50, 50, null, null, null], 3)]).toEqual([1, 3]);
    expect([...roundBestPicks([], 3)]).toEqual([]);
    expect([...roundBestPicks([10, 20], 0)]).toEqual([]);
    // Unvollständige letzte Runde zählt mit
    expect([...roundBestPicks([1, 2, 3, 4, 5], 2)]).toEqual([1, 3, 4]);
  });
});
