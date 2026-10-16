/** Spielbericht: Halbzeitstand aus den Torminuten. */
import { describe, expect, it } from 'vitest';
import { installMiniDom } from './miniDom';

installMiniDom();
const { halfTimeScore } = await import('../src/components/MatchReport');

const g = (minute: number | undefined) => ({ pokemonId: 1, pos: 'ST' as const, ...(minute != null ? { minute } : {}) });

describe('Halbzeitstand', () => {
  it('zählt Tore bis einschließlich der 45. Minute', () => {
    expect(halfTimeScore({ hg: 2, ag: 1, homeScorers: [g(12), g(80)], awayScorers: [g(45)] })).toEqual([1, 1]);
    expect(halfTimeScore({ hg: 1, ag: 0, homeScorers: [g(93)], awayScorers: [] })).toEqual([0, 0]);
  });
  it('null ohne Tore oder ohne Minuten (Vereinstore, ältere Spiele)', () => {
    expect(halfTimeScore({ hg: 0, ag: 0, homeScorers: [], awayScorers: [] })).toBeNull();
    expect(halfTimeScore({ hg: 1, ag: 0, homeScorers: [], awayScorers: [] })).toBeNull();
    expect(halfTimeScore({ hg: 1, ag: 0, homeScorers: [g(undefined)], awayScorers: [] })).toBeNull();
  });
});
