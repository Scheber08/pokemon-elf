/** „Beste Elf": stark, regelkonform (Mega-Limit, keine Doppelten), besser als Zufall. */
import { describe, expect, it } from 'vitest';
import { bestEleven } from '../src/lib/bestEleven';
import { buildScale } from '../src/lib/fit';
import { createRng, shuffle } from '../src/lib/rng';
import { evaluateTeam } from '../src/lib/teamScore';
import { ALL, FORMS } from './helpers';

const scale = buildScale(ALL, 'all');
const byId = new Map([...ALL, ...FORMS].map((p) => [p.id, p]));
const kanto = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);

describe('Beste Elf', () => {
  it('elf verschiedene Pokémon, klar besser als zufällige Elfen', () => {
    const { slots } = bestEleven('4-3-3', kanto, scale);
    expect(new Set(slots).size).toBe(11);
    const best = evaluateTeam('4-3-3', slots.map((id) => byId.get(id!)!), scale).score;
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      const random = shuffle(rng, kanto).slice(0, 11);
      expect(best).toBeGreaterThan(evaluateTeam('4-3-3', random, scale).score);
    }
  });

  it('Mega-Limit und Standardschütze', () => {
    const pool = [...kanto, ...FORMS.filter((p) => p.gen === 1 && !p.leg)];
    const one = bestEleven('4-4-2', pool, scale, { megaMax: 1, setPiece: true });
    const megas = [...one.slots, one.ss].filter((id) => byId.get(id!)?.form === 'mega');
    expect(megas.length).toBeLessThanOrEqual(1);
    expect(one.ss).not.toBeNull();
    expect(one.slots).not.toContain(one.ss);
    const none = bestEleven('4-4-2', pool, scale, { megaMax: 0 });
    expect(none.slots.some((id) => byId.get(id!)?.form === 'mega')).toBe(false);
  });

  it('kleiner Pool: leere Plätze statt Fehler', () => {
    expect(bestEleven('4-3-3', kanto.slice(0, 5), scale).slots.filter((x) => x == null)).toHaveLength(6);
  });
});
