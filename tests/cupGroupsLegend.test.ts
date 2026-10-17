/** KO-Turnier: Gruppentabellen erklären den grünen Strich (Legende) und nennen die Weiterkommen-Plätze für Screenreader. */
import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CupGroups } from '../src/components/CupBracket';
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
});
