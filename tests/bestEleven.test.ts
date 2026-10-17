/** „Beste Elf": stark, regelkonform (Mega-Limit, keine Doppelten), besser als Zufall. */
import { describe, expect, it } from 'vitest';
import { bestEleven, fillGaps } from '../src/lib/bestEleven';
import { FORMATIONS } from '../src/config/formations';
import { buildScale, positionFit } from '../src/lib/fit';
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

  it('Lücken füllen: gesetzte Spieler bleiben, nur leere Plätze werden besetzt', () => {
    const slots: (number | null)[] = Array(11).fill(null);
    slots[0] = kanto[0].id;
    slots[5] = kanto[1].id;
    const res = fillGaps('4-3-3', slots, null, kanto, scale, { setPiece: true });
    expect(res.slots[0]).toBe(kanto[0].id);
    expect(res.slots[5]).toBe(kanto[1].id);
    expect(res.slots.every((id) => id != null)).toBe(true);
    expect(new Set([...res.slots, res.ss]).size).toBe(12);
    // Jeder neue Platz bekommt den bestpassenden noch freien (wichtigste Positionen zuerst) – mindestens so gut wie der Rest
    const defs = FORMATIONS['4-3-3'].slots;
    for (let i = 1; i < 11; i++) {
      if (i === 5) continue;
      const fit = positionFit(byId.get(res.slots[i]!)!, defs[i].pos, scale);
      const freeAfter = kanto.filter((p) => !res.slots.includes(p.id) && p.id !== res.ss);
      expect(freeAfter.every((p) => positionFit(p, defs[i].pos, scale) <= fit + 1e-9)).toBe(true);
    }
    // Volle Elf mit Schütze: nichts ändert sich
    expect(fillGaps('4-3-3', res.slots, res.ss, kanto, scale, { setPiece: true })).toEqual(res);
  });

  it('Lücken füllen: aufgestellte Megas zählen aufs Limit', () => {
    const mega = FORMS.find((p) => p.form === 'mega')!;
    const pool = [...kanto, ...FORMS.filter((p) => p.gen === 1 && p.form === 'mega')];
    const slots: (number | null)[] = Array(11).fill(null);
    slots[10] = mega.id;
    const res = fillGaps('4-3-3', slots, null, pool, scale, { megaMax: 1, lookup: byId });
    expect(res.slots.filter((id) => byId.get(id!)?.form === 'mega')).toEqual([mega.id]);
  });
});
