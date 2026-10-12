import { describe, expect, it } from 'vitest';
import { simulateSeason, type SeasonResult, type SquadPlayer } from '../src/lib/season';
import { scorerGroups, scorerSummary, seasonTimeline, tickerStep, TOP_ROWS, type TickerStep } from '../src/lib/seasonTimeline';

const SQUAD: SquadPlayer[] = [
  { pokemonId: 143, pos: 'TW', atk: 110, spa: 65 },
  { pokemonId: 9, pos: 'LV', atk: 83, spa: 85 },
  { pokemonId: 68, pos: 'IV', atk: 130, spa: 65 },
  { pokemonId: 76, pos: 'IV', atk: 120, spa: 55 },
  { pokemonId: 130, pos: 'RV', atk: 125, spa: 60 },
  { pokemonId: 65, pos: 'ZM', atk: 50, spa: 135 },
  { pokemonId: 112, pos: 'DM', atk: 130, spa: 45 },
  { pokemonId: 3, pos: 'ZM', atk: 82, spa: 100 },
  { pokemonId: 25, pos: 'LF', atk: 55, spa: 50 },
  { pokemonId: 6, pos: 'ST', atk: 84, spa: 109 },
  { pokemonId: 135, pos: 'RF', atk: 65, spa: 110 },
];

const run = (score: number, seed: number): SeasonResult =>
  simulateSeason({
    teamName: 'Test-Elf',
    score,
    squad: SQUAD,
    setPieceTaker: { pokemonId: 59, pos: 'SS', atk: 110, spa: 100 },
    setPieceFit: 70,
    seed,
  });

const CASES: [number, number][] = [
  [350, 1],
  [600, 2],
  [780, 3],
  [880, 4],
  [950, 5],
  [1000, 6],
];

describe('Saisonverlauf (Live-Ticker)', () => {
  it.each(CASES)('Score %i, Seed %i: 34 Spieltage in Reihenfolge, Endstand = Saisonbilanz', (score, seed) => {
    const season = run(score, seed);
    const days = seasonTimeline(season);
    expect(days).toHaveLength(34);
    days.forEach((d, i) => {
      expect(d.round).toBe(i + 1);
      expect(d.match).toBe(season.userMatches.find((m) => m.round === d.round));
    });

    const last = days[days.length - 1];
    expect(last.record).toEqual(season.record);
    expect(last.points).toBe(season.points);
    expect(last.position).toBe(season.position);
    expect(last.goalsFor).toBe(season.goalsFor);
    expect(last.goalsAgainst).toBe(season.goalsAgainst);
    expect(last.userRow).toEqual(season.league.table[season.position - 1]);
    expect(last.top).toEqual(season.league.table.slice(0, TOP_ROWS));
    expect(last.perfectAlive).toBe(season.perfect);
  });

  it.each(CASES)('Score %i, Seed %i: Bilanz und Punkte wachsen monoton', (score, seed) => {
    const days = seasonTimeline(run(score, seed));
    let prev = { w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0 };
    days.forEach((d, i) => {
      const { w, d: dr, l } = d.record;
      expect(w + dr + l).toBe(i + 1);
      expect(w).toBeGreaterThanOrEqual(prev.w);
      expect(dr).toBeGreaterThanOrEqual(prev.d);
      expect(l).toBeGreaterThanOrEqual(prev.l);
      // Genau ein Feld der Bilanz wächst – passend zum Ergebnis des Spiels
      const grew = d.match.outcome === 'S' ? w - prev.w : d.match.outcome === 'U' ? dr - prev.d : l - prev.l;
      expect(grew).toBe(1);
      expect(d.points).toBe(w * 3 + dr);
      expect(d.points).toBeGreaterThanOrEqual(prev.pts);
      expect(d.goalsFor).toBe(prev.gf + d.match.gf);
      expect(d.goalsAgainst).toBe(prev.ga + d.match.ga);
      // Tabellenzeile des eigenen Teams passt zur laufenden Bilanz
      expect(d.userRow.isUser).toBe(true);
      expect(d.userRow.played).toBe(i + 1);
      expect(d.userRow.pts).toBe(d.points);
      expect(d.userRow.gf).toBe(d.goalsFor);
      expect(d.userRow.ga).toBe(d.goalsAgainst);
      prev = { w, d: dr, l, pts: d.points, gf: d.goalsFor, ga: d.goalsAgainst };
    });
  });

  it.each(CASES)('Score %i, Seed %i: Platz und Trend sind konsistent', (score, seed) => {
    const days = seasonTimeline(run(score, seed));
    days.forEach((d, i) => {
      expect(d.position).toBeGreaterThanOrEqual(1);
      expect(d.position).toBeLessThanOrEqual(18);
      expect(d.positionDelta).toBe(i === 0 ? 0 : days[i - 1].position - d.position);
      if (d.position <= TOP_ROWS) expect(d.top[d.position - 1]).toEqual(d.userRow);
      else expect(d.top.some((r) => r.isUser)).toBe(false);
    });
  });

  it.each(CASES)('Score %i, Seed %i: Top 4 nach Punkten sortiert', (score, seed) => {
    for (const d of seasonTimeline(run(score, seed))) {
      expect(d.top).toHaveLength(TOP_ROWS);
      for (let i = 1; i < d.top.length; i++) expect(d.top[i - 1].pts).toBeGreaterThanOrEqual(d.top[i].pts);
      for (const r of d.top) expect(r.played).toBe(d.round);
    }
  });

  it.each(CASES)('Score %i, Seed %i: Serien zählen richtig', (score, seed) => {
    const days = seasonTimeline(run(score, seed));
    days.forEach((d, i) => {
      const before = i > 0 ? days[i - 1] : null;
      const o = d.match.outcome;
      expect(d.winStreak).toBe(o === 'S' ? (before?.winStreak ?? 0) + 1 : 0);
      expect(d.unbeatenRun).toBe(o === 'N' ? 0 : (before?.unbeatenRun ?? 0) + 1);
      expect(d.winStreak).toBeLessThanOrEqual(d.unbeatenRun);
    });
  });

  it('perfekte Saison: 34–0 bleibt bis zum Schluss am Leben', () => {
    let season: SeasonResult | null = null;
    for (let seed = 0; seed < 400 && !season; seed++) {
      const s = run(1000, seed);
      if (s.perfect) season = s;
    }
    expect(season).not.toBeNull();
    const days = seasonTimeline(season!);
    for (const d of days) {
      expect(d.perfectAlive).toBe(true);
      expect(d.perfectBrokenAt).toBeNull();
      expect(d.winStreak).toBe(d.round);
      expect(d.unbeatenRun).toBe(d.round);
    }
    expect(days[33].record).toEqual({ w: 34, d: 0, l: 0 });
    expect(days[33].points).toBe(102);
    expect(days[33].position).toBe(1);
  });

  it('34–0 platzt beim ersten Nicht-Sieg und bleibt geplatzt', () => {
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const season = run(820, seed);
      if (season.perfect) continue;
      const days = seasonTimeline(season);
      const firstMiss = season.userMatches.find((m) => m.outcome !== 'S')!.round;
      for (const d of days) {
        if (d.round < firstMiss) {
          expect(d.perfectAlive).toBe(true);
          expect(d.perfectBrokenAt).toBeNull();
          expect(d.record).toEqual({ w: d.round, d: 0, l: 0 });
        } else {
          expect(d.perfectAlive).toBe(false);
          expect(d.perfectBrokenAt).toBe(firstMiss);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('ist deterministisch', () => {
    const s = run(812, 99);
    expect(seasonTimeline(s)).toEqual(seasonTimeline(run(812, 99)));
  });
});

describe('Torschützen pro Spiel', () => {
  const names: Record<number, string> = { 6: 'Glurak', 25: 'Pikachu', 59: 'Arkani' };
  const nameOf = (id: number) => names[id] ?? '?';

  it('fasst mehrfache Torschützen zusammen und markiert Standards', () => {
    const goals = [
      { pokemonId: 6, pos: 'ST' as const },
      { pokemonId: 25, pos: 'LF' as const },
      { pokemonId: 6, pos: 'ST' as const },
      { pokemonId: 59, pos: 'SS' as const },
    ];
    expect(scorerSummary(goals, nameOf)).toBe('Glurak 2×, Pikachu, Arkani (Standard)');
    expect(scorerGroups(goals, nameOf).map((g) => [g.label, g.goals, g.setPiece])).toEqual([
      ['Glurak', 2, false],
      ['Pikachu', 1, false],
      ['Arkani (Standard)', 1, true],
    ]);
  });

  it('dasselbe Pokémon als Feldspieler und Standardschütze zählt getrennt', () => {
    const goals = [
      { pokemonId: 6, pos: 'ST' as const },
      { pokemonId: 6, pos: 'SS' as const },
    ];
    expect(scorerSummary(goals, nameOf)).toBe('Glurak, Glurak (Standard)');
    expect(scorerSummary([], nameOf)).toBe('');
  });
});

describe('Ablauf des Live-Tickers', () => {
  /** Spielt den Ticker von Schritt 0 bis zum Ende durch. */
  const playThrough = (total: number) => {
    const steps: ({ step: number } & TickerStep)[] = [];
    let step: number | 'done' = 0;
    for (let guard = 0; step !== 'done' && guard < 1000; guard++) {
      const s = tickerStep(step, total);
      steps.push({ step, ...s });
      step = s.next;
    }
    return steps;
  };

  it('zeigt die Anzeigetafel jedes Spieltags – auch des 34. – vor dem Abpfiff', () => {
    const steps = playThrough(34);
    const boards = steps.filter((s) => !s.finale).map((s) => s.played);
    // 0 = Anpfiff, dann jeder Spieltag genau einmal
    expect(boards).toEqual(Array.from({ length: 35 }, (_, i) => i));
    expect(tickerStep(34, 34)).toEqual({ played: 34, finale: false, next: 35 });
  });

  it('Abpfiff genau einmal, ganz am Ende, danach nur noch „fertig"', () => {
    const steps = playThrough(34);
    expect(steps.filter((s) => s.finale)).toHaveLength(1);
    const last = steps[steps.length - 1];
    expect(last).toEqual({ step: 35, played: 34, finale: true, next: 'done' });
    expect(steps.filter((s) => s.next === 'done')).toHaveLength(1);
  });

  it('Fortschritt bleibt in 0…total', () => {
    expect(tickerStep(0, 34)).toEqual({ played: 0, finale: false, next: 1 });
    expect(tickerStep(33, 34).played).toBe(33);
    expect(tickerStep(99, 34)).toEqual({ played: 34, finale: true, next: 'done' });
    expect(tickerStep(-1, 34).played).toBe(0);
  });

  it('passt zur echten Saison: der letzte Schritt vor dem Abpfiff ist der 34. Spieltag', () => {
    const days = seasonTimeline(run(812, 7));
    const beforeFinale = playThrough(days.length).filter((s) => !s.finale).pop()!;
    expect(days[beforeFinale.played - 1].round).toBe(34);
  });
});
