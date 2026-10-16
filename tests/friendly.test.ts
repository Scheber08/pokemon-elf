/** Testspiel: eigene Elf gegen ein Ranglisten-Team – Hin- und Rückspiel, deterministisch aus dem Seed. */
import { describe, expect, it } from 'vitest';
import { buildScale } from '../src/lib/fit';
import { friendlyMatch, friendlyOdds, fullEleven, type FriendlySide } from '../src/lib/friendly';
import { ALL } from './helpers';

const byId = new Map(ALL.map((p) => [p.id, p]));
const scale = buildScale(ALL, 'all');
const side = (name: string, ids: number[]): FriendlySide => ({ name, formation: '4-3-3', slots: ids, ss: null });
const strong = side('Stark', [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135]);
const weak = side('Schwach', [10, 11, 13, 14, 16, 19, 21, 129, 132, 172, 175]);

describe('Testspiel', () => {
  it('zwei Spiele, erst mit Heimrecht für die eigene Elf; Gesamtstand passt', () => {
    const r = friendlyMatch(strong, weak, byId, scale, 42);
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0].home).toBe(0);
    expect(r.matches[1].home).toBe(1);
    const own = r.matches[0].hg + r.matches[1].ag;
    const opp = r.matches[0].ag + r.matches[1].hg;
    expect(r.aggregate).toEqual([own, opp]);
    expect(r.ratings[0]).toBeGreaterThan(r.ratings[1]);
  });

  it('gleicher Seed, gleiches Ergebnis; die stärkere Elf gewinnt meistens', () => {
    expect(friendlyMatch(strong, weak, byId, scale, 7)).toEqual(friendlyMatch(strong, weak, byId, scale, 7));
    let wins = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const [a, b] = friendlyMatch(strong, weak, byId, scale, seed).aggregate;
      if (a > b) wins++;
    }
    expect(wins).toBeGreaterThan(70);
  });

  it('📈 Prognose: deckt sich mit friendlyMatch über die Seeds 1…100, Summe ≈ 100 %', () => {
    const odds = friendlyOdds(strong, weak, byId, scale);
    const n = { win: 0, draw: 0, loss: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const [a, b] = friendlyMatch(strong, weak, byId, scale, seed).aggregate;
      n[a > b ? 'win' : a < b ? 'loss' : 'draw']++;
    }
    expect(odds).toEqual(n);
    expect(odds.win).toBeGreaterThan(odds.loss);
    const back = friendlyOdds(weak, strong, byId, scale, 40);
    expect(Math.abs(back.win + back.draw + back.loss - 100)).toBeLessThanOrEqual(1);
  });

  it('Tore mit Spielminute (Spielmodell des Online-Drafts)', () => {
    const goals = Array.from({ length: 20 }, (_, i) => friendlyMatch(strong, weak, byId, scale, 100 + i)).flatMap((r) =>
      r.matches.flatMap((m) => [...m.homeScorers, ...m.awayScorers]),
    );
    expect(goals.length).toBeGreaterThan(10);
    expect(goals.every((g) => Number.isInteger(g.minute) && g.minute! >= 1 && g.minute! <= 95)).toBe(true);
  });

  it('volle Elf nötig', () => {
    expect(fullEleven(strong.slots)).toBe(true);
    expect(fullEleven([...strong.slots.slice(0, 10), null])).toBe(false);
    expect(fullEleven(strong.slots.slice(0, 10))).toBe(false);
  });

  it('Kapitän verändert das Rating der eigenen Elf; einer außerhalb der Elf zählt nicht', () => {
    const base = friendlyMatch(strong, weak, byId, scale, 42).ratings[0];
    const ratings = strong.slots.map((id) => friendlyMatch({ ...strong, captain: id }, weak, byId, scale, 42).ratings[0]);
    expect(Math.max(...ratings)).toBeGreaterThan(base);
    expect(Math.min(...ratings)).toBeLessThan(base);
    expect(friendlyMatch({ ...strong, captain: 999 }, weak, byId, scale, 42).ratings[0]).toBe(base);
  });
});
