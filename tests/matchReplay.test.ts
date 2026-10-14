/** 2D-Wiedergabe: deterministischer Ablauf aus einem Spiel (Tore zu ihren Minuten, Ball im Tor). */
import { describe, expect, it } from 'vitest';
import { ballAt, buildReplay, lineupNumbers, PITCH_H, PITCH_W, playerAt } from '../src/lib/matchReplay';
import type { Match } from '../src/lib/season';

const match: Match = {
  round: 3,
  home: 0,
  away: 5,
  hg: 2,
  ag: 2,
  homeScorers: [
    { pokemonId: 6, pos: 'ST', minute: 23, assist: 25 },
    { pokemonId: 6, pos: 'ST', minute: 23 },
  ],
  awayScorers: [{ pokemonId: 150, pos: 'OM', minute: 88 }],
  stats: { shots: [12, 7], onTarget: [5, 3], possession: 58, xg: [1.9, 0.8] },
};
const home = { formation: '4-3-3' as const, ids: [1, 2, 3, 4, 5, 7, 8, 9, 25, 6, 10] };

describe('buildReplay', () => {
  it('22 Spieler, alle Tore als Ereignisse (auch ohne Minute bzw. Schütze), Ball zur Torminute im richtigen Tor', () => {
    const r = buildReplay(match, [home, null]);
    expect(r.players).toHaveLength(22);
    const goals = r.events.filter((e) => e.kind === 'goal');
    expect(goals).toHaveLength(4);
    expect(goals.filter((e) => e.side === 0).map((e) => e.t)).toEqual([23, 23]);
    // Schütze aus der Aufstellung; Vorlage bekannt
    const first = goals.find((e) => e.side === 0 && e.assist === 25)!;
    expect(r.players[first.shooter].pokemonId).toBe(6);
    // Ball im Tor: Heim nach rechts, Gast nach links
    for (const e of goals) {
      const key = r.keys.find((k) => k.t >= e.t)!;
      if (e.side === 0) expect(key.x).toBeGreaterThan(PITCH_W - 1);
      else expect(key.x).toBeLessThan(1);
    }
    // Schüsse ohne Tor aus der Statistik
    expect(r.events.filter((e) => e.kind === 'shot' && e.side === 0)).toHaveLength(10);
    expect(r.events.filter((e) => e.kind === 'shot' && e.side === 1)).toHaveLength(5);
    // Zeiten nur vorwärts, Positionen auf dem Feld
    for (let i = 1; i < r.keys.length; i++) expect(r.keys[i].t).toBeGreaterThan(r.keys[i - 1].t);
    for (let t = 0; t <= r.end; t += 3.7) {
      const b = ballAt(r.keys, t);
      for (const p of r.players) {
        const at = playerAt(p, t, b.x);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(PITCH_H);
      }
    }
  });

  it('deterministisch', () => {
    expect(buildReplay(match, [home, null])).toEqual(buildReplay(match, [home, null]));
  });

  it('Trikotnummern der Aufstellung wie in der 2D-Ansicht (eigene vor Vorgabe)', () => {
    const numbers = lineupNumbers({ ...home, jerseys: { '6': 77 } });
    expect(numbers.get(1)).toBe(1);
    expect(numbers.get(6)).toBe(77);
    const players = buildReplay(match, [{ ...home, jerseys: { '6': 77 } }, null]).players;
    expect(players.find((p) => p.pokemonId === 6)?.number).toBe(77);
  });
});
