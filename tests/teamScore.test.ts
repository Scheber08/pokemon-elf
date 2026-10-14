import { describe, expect, it } from 'vitest';
import { FORMATION_IDS, FORMATIONS } from '../src/config/formations';
import { buildScale } from '../src/lib/fit';
import { bestCaptain, evaluateTeam, positionWeights, teamScoreFromFits } from '../src/lib/teamScore';
import { ALL, byName } from './helpers';

const weights433 = positionWeights('4-3-3');
const score = (fits: number[], w = weights433) => teamScoreFromFits(fits, w).exact;

describe('Team-Score – Formel', () => {
  it('gleiche Fits ergeben Fit × 10', () => {
    expect(score(Array(11).fill(70))).toBeCloseTo(700);
    expect(score(Array(11).fill(100))).toBeCloseTo(1000);
    expect(score(Array(11).fill(0))).toBe(0);
  });

  it('bleibt im Bereich 0–1.000', () => {
    for (let i = 0; i < 200; i++) {
      const fits = Array.from({ length: 11 }, () => Math.random() * 100);
      const s = score(fits);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1000);
    }
  });

  it('der Torwart ist die wichtigste Einzelposition', () => {
    const base = Array(11).fill(60);
    const twIndex = FORMATIONS['4-3-3'].slots.findIndex((s) => s.pos === 'TW');
    const zmIndex = FORMATIONS['4-3-3'].slots.findIndex((s) => s.pos === 'ZM');
    const stIndex = FORMATIONS['4-3-3'].slots.findIndex((s) => s.pos === 'ST');
    const up = (i: number) => score(base.map((f, j) => (j === i ? 90 : f)));
    expect(up(twIndex)).toBeGreaterThan(up(stIndex));
    expect(up(stIndex)).toBeGreaterThan(up(zmIndex));
  });

  it('die Abwehrreihe zählt zusammen am meisten', () => {
    const slots = FORMATIONS['4-3-3'].slots;
    const sumLine = (line: string[]) =>
      slots.reduce((acc, s, i) => acc + (line.includes(s.pos) ? weights433[i] : 0), 0);
    const defence = sumLine(['LV', 'IV', 'RV']);
    expect(defence).toBeGreaterThan(sumLine(['ZM', 'DM']));
    expect(defence).toBeGreaterThan(sumLine(['LF', 'ST', 'RF']));
  });

  it('Schwachstellen-Malus: ein Loch zieht stärker runter, als ein Star hebt', () => {
    const base = Array(11).fill(70);
    const baseline = score(base);
    // ZM-Slot (gleiches Gewicht) einmal um 30 schwächer, einmal um 30 stärker
    const hole = score(base.map((f, i) => (i === 5 ? 40 : f)));
    const star = score(base.map((f, i) => (i === 5 ? 100 : f)));
    expect(baseline - hole).toBeGreaterThan(star - baseline);
  });

  it('die drei schwächsten Fits werden als Schwachstellen gemeldet', () => {
    const fits = [90, 90, 10, 90, 90, 20, 90, 90, 30, 90, 90];
    expect(teamScoreFromFits(fits, weights433).weakest.sort()).toEqual([2, 5, 8]);
  });

  it('der Malus ist stärker als ein reiner Durchschnitt', () => {
    const fits = [90, 90, 90, 90, 90, 90, 90, 90, 20, 20, 20];
    const plainAverage = (fits.reduce((a, b, i) => a + b * weights433[i], 0) / weights433.reduce((a, b) => a + b)) * 10;
    expect(score(fits)).toBeLessThan(plainAverage);
  });
});

describe('Team-Score – mit echten Daten', () => {
  const scale = buildScale(ALL, 'all');

  it('liefert für jede Formation 11 Fits und einen ganzzahligen Score', () => {
    for (const f of FORMATION_IDS) {
      const players = FORMATIONS[f].slots.map((_, i) => ALL[i * 37]);
      const ev = evaluateTeam(f, players, scale);
      expect(ev.fits).toHaveLength(11);
      expect(Number.isInteger(ev.score)).toBe(true);
      expect(ev.score).toBeGreaterThanOrEqual(0);
      expect(ev.score).toBeLessThanOrEqual(1000);
    }
  });

  it('leere Slots zählen als Fit 0', () => {
    const ev = evaluateTeam('4-4-2', Array(11).fill(null), scale);
    expect(ev.score).toBe(0);
    expect(ev.fits.every((f) => f === 0)).toBe(true);
  });

  it('eine gut gescoutete Elf schlägt eine zusammengewürfelte', () => {
    const scouted = ['Relaxo', 'Turtok', 'Stahlos', 'Geowaz', 'Garados', 'Simsala', 'Machomei', 'Gengar', 'Zapdos', 'Glurak', 'Blitza'].map(byName);
    const random = ['Rattfratz', 'Raupy', 'Pichu', 'Hornliu', 'Sleima', 'Mauzi', 'Taubsi', 'Knofensa', 'Pummeluff', 'Sandan', 'Zubat'].map(byName);
    expect(evaluateTeam('4-3-3', scouted, scale).score).toBeGreaterThan(evaluateTeam('4-3-3', random, scale).score + 200);
  });

  it('Kapitän: seine Passung zählt doppelt – gut passend hebt, schlecht passend senkt; ohne Kapitän unverändert', () => {
    const team = ['Relaxo', 'Turtok', 'Stahlos', 'Geowaz', 'Garados', 'Simsala', 'Machomei', 'Gengar', 'Zapdos', 'Glurak', 'Blitza'].map(byName);
    const base = evaluateTeam('4-3-3', team, scale);
    expect(evaluateTeam('4-3-3', team, scale, null)).toEqual(base);
    expect(evaluateTeam('4-3-3', team, scale, 99999)).toEqual(base);
    const order = base.fits.map((_, i) => i).sort((a, b) => base.fits[a] - base.fits[b]);
    const best = team[order[order.length - 1]].id;
    const worst = team[order[0]].id;
    expect(evaluateTeam('4-3-3', team, scale, best).exact).toBeGreaterThan(base.exact);
    expect(evaluateTeam('4-3-3', team, scale, worst).exact).toBeLessThan(base.exact);
    expect(evaluateTeam('4-3-3', team, scale, best).fits).toEqual(base.fits);
  });

  it('bestCaptain: kein anderer Kapitän ergibt einen höheren Score', () => {
    const scale = buildScale(ALL, 'all');
    const team = FORMATIONS['4-3-3'].slots.map((_, i) => ALL[i * 53 + 3]);
    const best = bestCaptain('4-3-3', team, scale)!;
    expect(team.map((p) => p.id)).toContain(best);
    const top = evaluateTeam('4-3-3', team, scale, best).exact;
    for (const p of team) expect(evaluateTeam('4-3-3', team, scale, p.id).exact).toBeLessThanOrEqual(top);
    expect(bestCaptain('4-3-3', [], scale)).toBeNull();
  });
});
