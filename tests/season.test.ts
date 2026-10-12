import { describe, expect, it } from 'vitest';
import { SEASON } from '../src/config/season';
import { createRng, poisson } from '../src/lib/rng';
import {
  compareRecords,
  expectedGoals,
  formatRecord,
  opponentRatings,
  roundRobin,
  simulateLeague,
  simulateSeason,
  type SquadPlayer,
} from '../src/lib/season';

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

const run = (score: number, seed: number) => simulateSeason({ teamName: 'Test-Elf', score, squad: SQUAD, seed });

describe('Spielplan', () => {
  const schedule = roundRobin(18);

  it('18 Teams → 34 Spieltage mit je 9 Spielen', () => {
    expect(schedule).toHaveLength(34);
    for (const round of schedule) expect(round).toHaveLength(9);
  });

  it('jedes Team spielt pro Spieltag genau einmal', () => {
    for (const round of schedule) {
      const teams = round.flat();
      expect(new Set(teams).size).toBe(18);
    }
  });

  it('jede Paarung gibt es genau zweimal – einmal zu Hause, einmal auswärts', () => {
    const seen = new Map<string, number>();
    for (const round of schedule) for (const [h, a] of round) seen.set(`${h}-${a}`, (seen.get(`${h}-${a}`) ?? 0) + 1);
    for (let a = 0; a < 18; a++) {
      for (let b = 0; b < 18; b++) {
        if (a === b) continue;
        expect(seen.get(`${a}-${b}`)).toBe(1);
      }
    }
  });

  it('jedes Team hat 17 Heim- und 17 Auswärtsspiele', () => {
    for (let t = 0; t < 18; t++) {
      const home = schedule.flat().filter(([h]) => h === t).length;
      const away = schedule.flat().filter(([, a]) => a === t).length;
      expect(home).toBe(17);
      expect(away).toBe(17);
    }
  });

  it('funktioniert auch mit ungerader Teamzahl (Draft)', () => {
    const s = roundRobin(5);
    const games = s.flat();
    expect(games).toHaveLength(5 * 4);
  });
});

describe('Gegner', () => {
  it('17 Ratings gleichmäßig von 350 bis 910', () => {
    const r = opponentRatings();
    expect(r).toHaveLength(17);
    expect(Math.min(...r)).toBe(SEASON.minRating);
    expect(Math.max(...r)).toBe(SEASON.maxRating);
    const steps = r.slice(1).map((v, i) => v - r[i]);
    expect(new Set(steps).size).toBe(1);
  });
});

describe('Tor-Erwartung (Poisson-λ)', () => {
  it('λ = 1,4 · exp(Δ/250) + 0,15 Heimvorteil', () => {
    expect(expectedGoals(700, 700, false)).toBeCloseTo(1.4);
    expect(expectedGoals(700, 700, true)).toBeCloseTo(1.55);
    expect(expectedGoals(800, 550, false)).toBeCloseTo(1.4 * Math.E);
  });

  it('steigt mit dem eigenen Rating und ist begrenzt', () => {
    expect(expectedGoals(900, 500, false)).toBeGreaterThan(expectedGoals(600, 500, false));
    expect(expectedGoals(1000, 0, true)).toBe(SEASON.maxLambda);
    expect(expectedGoals(0, 1000, false)).toBe(SEASON.minLambda);
  });

  it('Poisson-Zufallszahlen haben den richtigen Mittelwert', () => {
    const rng = createRng(42);
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += poisson(rng, 1.7);
    expect(sum / n).toBeCloseTo(1.7, 1);
  });
});

describe('Saison-Simulation', () => {
  it('34 Spiele: 17 Heim, 17 Auswärts, 3/1/0 Punkte', () => {
    const s = run(780, 1);
    expect(s.userMatches).toHaveLength(34);
    expect(s.userMatches.filter((m) => m.isHome)).toHaveLength(17);
    expect(s.record.w + s.record.d + s.record.l).toBe(34);
    expect(s.points).toBe(s.record.w * 3 + s.record.d);
    expect(s.goalsFor).toBe(s.userMatches.reduce((a, m) => a + m.gf, 0));
  });

  it('Tabelle mit 18 Teams, sortiert, eigenes Team markiert', () => {
    const s = run(780, 2);
    const t = s.league.table;
    expect(t).toHaveLength(18);
    expect(t.filter((r) => r.isUser)).toHaveLength(1);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].pts).toBeGreaterThanOrEqual(t[i].pts);
    for (const r of t) expect(r.played).toBe(34);
    expect(t[s.position - 1].isUser).toBe(true);
    // Tore gesamt = Gegentore gesamt
    expect(t.reduce((a, r) => a + r.gf, 0)).toBe(t.reduce((a, r) => a + r.ga, 0));
  });

  it('Gegner-Namen sind eindeutig und Ratings liegen in 350–910', () => {
    const s = run(700, 3);
    const opp = s.league.teams.slice(1);
    expect(new Set(opp.map((t) => t.name)).size).toBe(17);
    for (const t of opp) {
      expect(t.rating).toBeGreaterThanOrEqual(350);
      expect(t.rating).toBeLessThanOrEqual(910);
    }
  });

  it('ist mit gleichem Seed reproduzierbar', () => {
    expect(run(812, 99)).toEqual(run(812, 99));
    expect(formatRecord(run(812, 99).record)).not.toBe('');
  });

  it('ein stärkeres Team holt im Schnitt mehr Punkte', () => {
    const avg = (score: number) => {
      let pts = 0;
      for (let seed = 0; seed < 40; seed++) pts += run(score, seed).points;
      return pts / 40;
    };
    const strong = avg(950);
    const mid = avg(650);
    const weak = avg(350);
    expect(strong).toBeGreaterThan(mid + 10);
    expect(mid).toBeGreaterThan(weak + 10);
  });

  it('Torschützen: Summe der Tore = eigene Tore, Stürmer treffen am häufigsten', () => {
    let st = 0;
    let tw = 0;
    for (let seed = 0; seed < 10; seed++) {
      const s = run(800, seed);
      expect(s.scorers.reduce((a, x) => a + x.goals, 0)).toBe(s.goalsFor);
      st += s.scorers.filter((x) => x.pos === 'ST').reduce((a, x) => a + x.goals, 0);
      tw += s.scorers.filter((x) => x.pos === 'TW').reduce((a, x) => a + x.goals, 0);
    }
    expect(st).toBeGreaterThan(tw);
  });

  it('Standardschütze erzielt Tore aus Standards', () => {
    const s = simulateSeason({
      teamName: 'SS-Test',
      score: 850,
      squad: SQUAD,
      setPieceTaker: { pokemonId: 59, pos: 'SS', atk: 110, spa: 100 },
      setPieceFit: 90,
      seed: 5,
    });
    expect(s.scorers.some((x) => x.pos === 'SS' && x.goals > 0)).toBe(true);
  });

  it('34–0 wird als perfekte Saison erkannt', () => {
    let found = false;
    for (let seed = 0; seed < 400 && !found; seed++) {
      const s = run(1000, seed);
      if (s.perfect) {
        expect(s.record).toEqual({ w: 34, d: 0, l: 0 });
        expect(s.points).toBe(102);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('Liga (Draft)', () => {
  it('jeder gegen jeden, Hin- und Rückrunde', () => {
    const teams = [600, 700, 800, 900].map((rating, i) => ({ name: `T${i}`, rating }));
    const res = simulateLeague(teams, createRng(7));
    expect(res.matches).toHaveLength(4 * 3);
    expect(res.table.every((r) => r.played === 6)).toBe(true);
  });
});

describe('Bilanzen vergleichen', () => {
  it('mehr Punkte zuerst, dann mehr Siege', () => {
    expect(compareRecords({ w: 30, d: 2, l: 2 }, { w: 29, d: 4, l: 1 })).toBeLessThan(0);
    expect(compareRecords({ w: 20, d: 0, l: 14 }, { w: 18, d: 6, l: 10 })).toBeLessThan(0);
  });
});
