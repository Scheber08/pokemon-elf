import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTips, outcomeFor, saveTip, tipScore } from '../src/lib/managerTips';

function memoryStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}
const match = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });

describe('Manager-Tipps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('speichert je Liga und Spieltag, höchstens 20 Ligen', () => {
    memoryStorage();
    expect(loadTips('AAA')).toEqual({});
    saveTip('AAA', 1, 'w');
    expect(saveTip('AAA', 2, 'd')).toEqual({ 1: 'w', 2: 'd' });
    expect(loadTips('AAA')).toEqual({ 1: 'w', 2: 'd' });
    for (let i = 0; i < 25; i++) saveTip(`L${i}`, 1, 'l');
    expect(loadTips('AAA')).toEqual({});
    expect(loadTips('L24')).toEqual({ 1: 'l' });
    // L5 … L24 bleiben (20 Ligen), L4 und älter fliegen raus
    expect(loadTips('L4')).toEqual({});
    expect(loadTips('L5')).toEqual({ 1: 'l' });
  });

  it('wertet nur gespielte Spieltage aus', () => {
    const matches = [match(1, 0, 1, 2, 0), match(2, 2, 0, 1, 1), match(3, 0, 3, 0, 1)];
    expect(outcomeFor(matches[0], 0)).toBe('w');
    expect(outcomeFor(matches[2], 0)).toBe('l');
    expect(outcomeFor(matches[0], 5)).toBeNull();
    // Spieltag 3 noch nicht gespielt (played = 2)
    expect(tipScore({ 1: 'w', 2: 'l', 3: 'l' }, matches, 0, 2)).toEqual({ hits: 1, total: 2, last: { round: 2, hit: false }, streak: 0 });
    expect(tipScore({}, matches, 0, 3)).toEqual({ hits: 0, total: 0, last: null, streak: 0 });
    // Serie: drei richtige in Folge (Sieg, Remis, Niederlage)
    expect(tipScore({ 1: 'w', 2: 'd', 3: 'l' }, matches, 0, 3)).toEqual({ hits: 3, total: 3, last: { round: 3, hit: true }, streak: 3 });
    // Falscher Tipp am Anfang, danach zwei richtige; ungetippter Spieltag unterbricht nicht
    expect(tipScore({ 1: 'l', 2: 'd', 3: 'l' }, matches, 0, 3).streak).toBe(2);
    expect(tipScore({ 1: 'w', 3: 'l' }, matches, 0, 3).streak).toBe(2);
  });
});
