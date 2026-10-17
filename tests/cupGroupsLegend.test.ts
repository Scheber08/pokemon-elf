/** KO-Turnier: Gruppentabellen erklären den grünen Strich (Legende) und nennen die Weiterkommen-Plätze für Screenreader; im Turnierbaum steht „weiter“ am Sieger. */
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CupBracket, CupGroups } from '../src/components/CupBracket';
import { simulateCup } from '../src/lib/cup';
import { createRng } from '../src/lib/rng';
import type { LeagueTeam } from '../src/lib/season';

const teams: LeagueTeam[] = Array.from({ length: 16 }, (_, i) => ({ name: `T${i}`, rating: 400 + i * 30 }));

describe('CupGroups', () => {
  it('Legende einmal unter den Gruppen, „Weiterkommen-Platz“ an genau zwei Teams je Gruppe', () => {
    const r = simulateCup(teams, createRng(5), { groups: true });
    const html = renderToStaticMarkup(h(CupGroups, { teams: r.teams, matches: r.matches, groups: r.cup.groups!, you: null, nameOf: (i: number) => `T${i}` }));
    expect(html.match(/Platz 1–2: weiter ins Viertelfinale/g)).toHaveLength(1);
    expect(html.match(/Weiterkommen-Platz/g)).toHaveLength(2 * r.cup.groups!.length);
    expect(html.match(/cup-group__through/g)).toHaveLength(2 * r.cup.groups!.length);
  });

  it('Turnierbaum: „(weiter)“ für Screenreader genau einmal je gespielter Paarung, beim Sieger', () => {
    const r = simulateCup(teams, createRng(9));
    const html = renderToStaticMarkup(h(CupBracket, { cup: r.cup, matches: r.matches, you: null, nameOf: (i: number) => `T${i}` }));
    const ties = r.cup.rounds.reduce((n, x) => n + x.ties.length, 0);
    expect(ties).toBe(15);
    expect(html.match(/\(weiter\)/g)).toHaveLength(ties);
    // Steht im Sieger-Element
    expect(html.match(/is-winner">T\d+<span class="sr-only"> \(weiter\)/g)).toHaveLength(ties);
  });
});

