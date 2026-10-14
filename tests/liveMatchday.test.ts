/** Live-Spieltag: Minute aus der Serverzeit, Zwischenstände nur mit Toren bis zur Minute. */
import { describe, expect, it } from 'vitest';
import { liveDuration, liveMinute, partialMatch } from '../src/lib/liveMatchday';
import type { Match } from '../src/lib/season';

const match: Match = {
  round: 3,
  home: 0,
  away: 1,
  hg: 2,
  ag: 1,
  homeScorers: [
    { pokemonId: 6, pos: 'ST', minute: 12 },
    { pokemonId: 25, pos: 'LF', minute: 80 },
  ],
  awayScorers: [{ pokemonId: 150, pos: 'OM', minute: 45 }],
  stats: { shots: [10, 5], onTarget: [4, 2], possession: 55, xg: [1.8, 0.7] },
};

describe('Live-Spieltag', () => {
  it('Dauer höchstens 4 Minuten bzw. 40 % des Takts; Minute 1–90 nur während des Live-Fensters', () => {
    expect(liveDuration(12 * 3_600_000)).toBe(240_000);
    expect(liveDuration(5 * 60_000)).toBe(120_000);
    expect(liveMinute(1000, 999, 240_000)).toBeNull();
    expect(liveMinute(1000, 1000, 240_000)).toBe(1);
    expect(liveMinute(1000, 1000 + 120_000, 240_000)).toBe(46);
    expect(liveMinute(1000, 1000 + 240_000, 240_000)).toBeNull();
  });

  it('Zwischenstand: nur Tore bis zur Minute, keine Statistik', () => {
    expect(partialMatch(match, 10)).toMatchObject({ hg: 0, ag: 0 });
    const half = partialMatch(match, 45);
    expect([half.hg, half.ag]).toEqual([1, 1]);
    expect(half.stats).toBeUndefined();
    expect([partialMatch(match, 90).hg, partialMatch(match, 90).ag]).toEqual([2, 1]);
    // Vereine ohne Torschützen: Tore verteilt über die Spielzeit
    const club: Match = { ...match, homeScorers: [], awayScorers: [], hg: 2, ag: 0 };
    expect(partialMatch(club, 44).hg).toBe(0);
    expect(partialMatch(club, 46).hg).toBe(1);
  });
});
