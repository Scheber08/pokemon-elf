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
