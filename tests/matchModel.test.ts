/**
 * Spielmodelle: Die Challenges rechnen unverändert (CLASSIC_MODEL – der Server prüft gewertete Runs
 * damit nach), der Online-Draft realistischer (DRAFT_MODEL: weich gedeckelte Unterschiede, Tagesform).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/lib/rng';
import { storedLeague } from '../src/lib/leagueTimeline';
import {
  CLASSIC_MODEL,
  DRAFT_MODEL,
  formatMinute,
  goalMinutes,
  nextForm,
  simulateLeague,
  simulateSeason,
  type LeagueTeam,
} from '../src/lib/season';
import { scorerSummary } from '../src/lib/seasonTimeline';

const teams = (): LeagueTeam[] => [
  { name: 'Riese', rating: 950 },
  { name: 'Zwerg', rating: 350 },
  ...Array.from({ length: 16 }, (_, i) => ({ name: `M${i}`, rating: 550 + i * 10 })),
];

describe('Spielmodelle', () => {
  it('ohne Modell = CLASSIC_MODEL: gleiche Saison wie bisher (Challenges unverändert)', () => {
    const a = simulateLeague(teams(), createRng(4));
    const b = simulateLeague(teams(), createRng(4), CLASSIC_MODEL);
    expect(b).toEqual(a);
    // Challenge-Saison: fester Fingerabdruck – ändert er sich, ändern sich gewertete Runs
    const s = simulateSeason({ teamName: 'X', score: 800, squad: [], seed: 123 });
    expect([s.record, s.points, s.position, s.goalsFor, s.goalsAgainst]).toMatchSnapshot();
  });

  it('Draft: große Unterschiede ergeben realistischere Ergebnisse (weniger Kantersiege)', () => {
    let classicBig = 0;
    let draftBig = 0;
    let classicGoals = 0;
    let draftGoals = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const [model, add] of [
        [CLASSIC_MODEL, (big: number, goals: number) => ((classicBig += big), (classicGoals += goals))],
        [DRAFT_MODEL, (big: number, goals: number) => ((draftBig += big), (draftGoals += goals))],
      ] as const) {
        const league = simulateLeague(teams(), createRng(seed), model);
        const riese = league.matches.filter((m) => m.home === 0 || m.away === 0);
        add(
          riese.filter((m) => Math.abs(m.hg - m.ag) >= 5).length,
          league.matches.reduce((n, m) => n + m.hg + m.ag, 0),
        );
      }
    }
    expect(draftBig).toBeLessThan(classicBig / 2);
    // Tore pro Spiel im Draft in einem fußballüblichen Rahmen (2–4)
    const perMatch = draftGoals / (20 * 306);
    expect(perMatch).toBeGreaterThan(2);
    expect(perMatch).toBeLessThan(4);
    // Der Stärkste bleibt Favorit
    const wins = Array.from({ length: 20 }, (_, i) => simulateLeague(teams(), createRng(100 + i), DRAFT_MODEL).table[0].team === 0);
    expect(wins.filter(Boolean).length).toBeGreaterThan(12);
  });

  it('Tagesform: schwankt um 0 mit der gewählten Streuung, ohne Form bleibt alles 0', () => {
    const rng = createRng(7);
    let form = [0, 0, 0];
    const seen: number[] = [];
    for (let i = 0; i < 4000; i++) {
      form = nextForm(rng, form, DRAFT_MODEL);
      seen.push(form[0]);
    }
    const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
    const sd = Math.sqrt(seen.reduce((a, b) => a + (b - mean) ** 2, 0) / seen.length);
    expect(Math.abs(mean)).toBeLessThan(8);
    expect(sd).toBeGreaterThan(25);
    expect(sd).toBeLessThan(45);
    expect(nextForm(createRng(1), [0, 0], CLASSIC_MODEL)).toEqual([0, 0]);
  });
});

describe('Torminuten (Online-Draft)', () => {
  const squad = [
    { pokemonId: 6, pos: 'ST' as const, atk: 84, spa: 109 },
    { pokemonId: 25, pos: 'LF' as const, atk: 55, spa: 50 },
  ];
  const withSquads = () => teams().map((t) => ({ ...t, squad }));

  it('jedes Tor mit Minute (aufsteigend je Team), Challenges ohne', () => {
    const league = simulateLeague(withSquads(), createRng(3), DRAFT_MODEL);
    const goals = league.matches.flatMap((m) => [m.homeScorers, m.awayScorers]);
    expect(goals.flat().length).toBeGreaterThan(100);
    for (const g of goals) {
      expect(g.every((x) => Number.isInteger(x.minute) && x.minute! >= 1 && x.minute! <= 95)).toBe(true);
      expect(g.map((x) => x.minute)).toEqual([...g.map((x) => x.minute!)].sort((a, b) => a - b));
    }
    const classic = simulateLeague(withSquads(), createRng(3));
    expect(classic.matches.flatMap((m) => m.homeScorers).some((x) => x.minute != null)).toBe(false);
    // bleibt im gespeicherten Ergebnis erhalten
    const back = storedLeague(JSON.parse(JSON.stringify(league)), 18)!;
    expect(back.matches).toEqual(league.matches);
  });

  it('Minuten: Nachspielzeit selten, Anzeige mit Apostroph und 90+x', () => {
    const all = goalMinutes(createRng(1), 5000);
    const extra = all.filter((m) => m > 90).length / all.length;
    expect(extra).toBeGreaterThan(0.03);
    expect(extra).toBeLessThan(0.09);
    expect(formatMinute(23)).toBe("23'");
    expect(formatMinute(92)).toBe("90+2'");
  });

  it('Torschützen-Zeile mit Minuten, ohne Minuten wie bisher', () => {
    const name = (id: number) => (id === 6 ? 'Glurak' : 'Pikachu');
    expect(
      scorerSummary(
        [
          { pokemonId: 6, pos: 'ST', minute: 23 },
          { pokemonId: 25, pos: 'LF', minute: 40 },
          { pokemonId: 6, pos: 'ST', minute: 92 },
        ],
        name,
      ),
    ).toBe("Glurak 23', 90+2', Pikachu 40'");
    expect(scorerSummary([{ pokemonId: 6, pos: 'ST' }, { pokemonId: 6, pos: 'ST' }], name)).toBe('Glurak 2×');
  });
});

describe('Spieldetails (DRAFT_MODEL)', () => {
  const squad = (base: number): LeagueTeam['squad'] =>
    (['TW', 'IV', 'IV', 'LV', 'RV', 'DM', 'ZM', 'OM', 'LF', 'RF', 'ST'] as const).map((pos, i) => ({ pokemonId: base + i, pos, atk: 100, spa: 90 }));
  const withSquads = (): LeagueTeam[] => teams().map((t, i) => ({ ...t, squad: squad(100 * (i + 1)) }));

  it('Schüsse, aufs Tor, Ballbesitz und xG passen zum Ergebnis; Vorlagen kommen von Mitspielern', () => {
    const league = simulateLeague(withSquads(), createRng(9), DRAFT_MODEL);
    let assists = 0;
    for (const m of league.matches) {
      const s = m.stats!;
      expect(s.shots[0]).toBeGreaterThanOrEqual(m.hg);
      expect(s.shots[1]).toBeGreaterThanOrEqual(m.ag);
      expect(s.onTarget[0]).toBeGreaterThanOrEqual(m.hg);
      expect(s.onTarget[0]).toBeLessThanOrEqual(s.shots[0]);
      expect(s.onTarget[1]).toBeLessThanOrEqual(s.shots[1]);
      expect(s.possession).toBeGreaterThanOrEqual(28);
      expect(s.possession).toBeLessThanOrEqual(72);
      for (const [goals, team] of [[m.homeScorers, m.home], [m.awayScorers, m.away]] as const) {
        const ids = league.teams[team].squad!.map((p) => p.pokemonId);
        for (const g of goals) {
          if (g.assist == null) continue;
          assists++;
          expect(g.assist).not.toBe(g.pokemonId);
          expect(ids).toContain(g.assist);
        }
      }
    }
    expect(assists).toBeGreaterThan(50);
    // Klassisches Modell: keine Details
    expect(simulateLeague(withSquads(), createRng(9), CLASSIC_MODEL).matches.every((m) => !m.stats)).toBe(true);
  });

  it('gespeichertes Ergebnis behält Details; kaputte Details fallen weg', () => {
    const league = simulateLeague(withSquads(), createRng(5), DRAFT_MODEL);
    const compact = { ...league, teams: league.teams.map((t) => ({ name: t.name, rating: t.rating })) };
    const stored = storedLeague(JSON.parse(JSON.stringify(compact)), 18)!;
    expect(stored.matches[0].stats).toEqual(league.matches[0].stats);
    expect(stored.matches.flatMap((m) => m.homeScorers).some((g) => g.assist != null)).toBe(true);
    const broken = JSON.parse(JSON.stringify(compact));
    broken.matches[0].stats = { shots: [1], possession: 50 };
    expect(storedLeague(broken, 18)!.matches[0].stats).toBeUndefined();
  });
});

describe('Saison-Statistik', () => {
  it('Tore und Vorlagen je Pokémon, Teamwerte nur aus Spielen mit Details', async () => {
    const { playerTallies, teamTallies } = await import('../src/lib/leagueTimeline');
    const m = (home: number, away: number, hg: number, ag: number, extra = {}) => ({
      round: 1, home, away, hg, ag,
      homeScorers: Array.from({ length: hg }, () => ({ pokemonId: 10, pos: 'ST' as const, assist: 11 })),
      awayScorers: Array.from({ length: ag }, () => ({ pokemonId: 20, pos: 'ST' as const })),
      ...extra,
    });
    const league = {
      matches: [
        m(0, 1, 2, 1, { stats: { shots: [10, 6], onTarget: [5, 2], possession: 60, xg: [1.8, 0.7] } }),
        m(1, 0, 0, 1, { stats: { shots: [8, 12], onTarget: [3, 4], possession: 40, xg: [0.9, 1.5] } }),
        m(0, 1, 1, 0),
      ],
    };
    const players = playerTallies(league);
    expect(players.find((p) => p.pokemonId === 10 && p.teamIndex === 0)).toMatchObject({ goals: 2 + 1, assists: 0 });
    expect(players.find((p) => p.pokemonId === 11)).toMatchObject({ goals: 0, assists: 3 });
    // Spiel 2: Team 0 ist Gast, Team 1 trifft nicht – die Gast-Tore (pokemonId 20) zählen für Team 0
    expect(players.find((p) => p.pokemonId === 20 && p.teamIndex === 0)).toMatchObject({ goals: 1 });
    const t0 = teamTallies(league).find((r) => r.team === 0)!;
    expect(t0).toMatchObject({ games: 2, shots: 22, onTarget: 9, xg: 3.3, xga: 1.6, goals: 3, against: 1, cleanSheets: 1, possession: 60 });
    expect(teamTallies(league).find((r) => r.team === 1)!.cleanSheets).toBe(0);
  });
});

describe('Spieler des Spieltags', () => {
  it('Tore zählen doppelt, bei Gleichstand mehr Tore, ohne Tore null', async () => {
    const { playerOfRound } = await import('../src/lib/leagueTimeline');
    const goal = (pokemonId: number, assist?: number) => ({ pokemonId, pos: 'ST' as const, ...(assist != null ? { assist } : {}) });
    const m = (homeScorers: ReturnType<typeof goal>[], awayScorers: ReturnType<typeof goal>[]) => ({
      round: 1, home: 0, away: 1, hg: homeScorers.length, ag: awayScorers.length, homeScorers, awayScorers,
    });
    // 7: 1 Tor + 1 Vorlage = 3; 9: 3 Vorlagen = 3 → 7 (mehr Tore); 5: 1 Tor = 2
    expect(playerOfRound([m([goal(7, 9), goal(5, 9)], [goal(8)]), m([goal(4, 7)], [goal(6, 9)])])).toMatchObject({ pokemonId: 7, goals: 1, assists: 1 });
    // Doppelpack schlägt zwei Vorlagen und eine Vorlage + Tor
    expect(playerOfRound([m([goal(3), goal(3)], [goal(2, 1), goal(1, 2)])])).toMatchObject({ pokemonId: 3, goals: 2 });
    expect(playerOfRound([m([], [])])).toBeNull();
  });
});

describe('Transfer der Saison', () => {
  it('Zugang mit den meisten Torbeteiligungen ab dem Wechsel, fürs neue Team', async () => {
    const { bestTransfer } = await import('../src/lib/leagueTimeline');
    const goal = (pokemonId: number, assist?: number) => ({ pokemonId, pos: 'ST' as const, ...(assist != null ? { assist } : {}) });
    const m = (round: number, home: number, away: number, hs: ReturnType<typeof goal>[], as: ReturnType<typeof goal>[] = []) => ({
      round, home, away, hg: hs.length, ag: as.length, homeScorers: hs, awayScorers: as,
    });
    const matches = [
      m(1, 0, 1, [goal(50), goal(50)]), // vor dem Wechsel: zählt nicht
      m(2, 0, 1, [goal(50, 7)]),
      m(3, 1, 0, [goal(60)], [goal(50)]),
    ];
    const idx = (id: string) => ['a', 'b'].indexOf(id);
    const best = bestTransfer(matches, [
      { matchday: 2, teamId: 'a', in: 50 },
      { matchday: 3, teamId: 'b', in: 60 },
      { matchday: 2, teamId: 'x', in: 70 },
    ], idx);
    expect(best).toEqual({ pokemonId: 50, teamIndex: 0, matchday: 2, goals: 2, assists: 0 });
    expect(bestTransfer(matches, [{ matchday: 2, teamId: 'b', in: 99 }], idx)).toBeNull();
  });
});


describe('Saisonrekord Weiße Weste', () => {
  it('meiste Spiele ohne Gegentor, Gleichstand: besser platziert, erst ab 3', async () => {
    const { mostCleanSheets } = await import('../src/lib/leagueTimeline');
    const m = (home: number, away: number, hg: number, ag: number) => ({ home, away, hg, ag });
    const matches = [m(0, 1, 1, 0), m(2, 0, 0, 0), m(1, 2, 0, 0), m(0, 2, 2, 0), m(1, 0, 3, 1), m(2, 1, 1, 0)];
    // Team 0: 3 (1:0, 0:0, 2:0), Team 2: 3 (0:0, 0:0, 1:0), Team 1: 1 (0:0)
    expect(mostCleanSheets(matches, [2, 0, 1])).toEqual({ team: 2, n: 3 });
    expect(mostCleanSheets(matches, [0, 2, 1])).toEqual({ team: 0, n: 3 });
    expect(mostCleanSheets(matches.slice(0, 3), [0, 1, 2])).toBeNull();
  });
});

describe('Saisonrekord Hattricks', () => {
  it('drei Tore desselben Pokémon in einem Spiel, nach Spieltag', async () => {
    const { hatTricks } = await import('../src/lib/leagueTimeline');
    const g = (pokemonId: number) => ({ pokemonId, pos: 'ST' as const });
    const matches = [
      { round: 3, home: 0, away: 1, homeScorers: [g(6), g(6), g(6), g(9)], awayScorers: [g(25), g(25)] },
      { round: 1, home: 2, away: 0, homeScorers: [g(1)], awayScorers: [g(150), g(150), g(150), g(150)] },
      { round: 2, home: 1, away: 2, homeScorers: [g(25), g(26), g(25)], awayScorers: [] },
    ];
    expect(hatTricks(matches)).toEqual([
      { round: 1, team: 0, pokemonId: 150, goals: 4 },
      { round: 3, team: 0, pokemonId: 6, goals: 3 },
    ]);
    expect(hatTricks([])).toEqual([]);
  });
});
