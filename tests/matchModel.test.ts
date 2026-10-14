/**
 * Spielmodelle: Die Challenges rechnen unverändert (CLASSIC_MODEL – der Server prüft gewertete Runs
 * damit nach), der Online-Draft realistischer (DRAFT_MODEL: weich gedeckelte Unterschiede, Tagesform).
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/lib/rng';
import { CLASSIC_MODEL, DRAFT_MODEL, nextForm, simulateLeague, simulateSeason, type LeagueTeam } from '../src/lib/season';

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
