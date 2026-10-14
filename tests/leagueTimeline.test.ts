import { describe, expect, it } from 'vitest';
import { DRAFT_LIMITS } from '../src/lib/api/draftContract';
import { FORMATIONS } from '../src/config/formations';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  draftSeason,
  leagueTeams,
  startDraft,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { longestWinStreak, recentForm,
  currentMatchday,
  FINALE_MS,
  leagueTimeline,
  matchdayCount,
  matchFor,
  seasonFinishAt,
  secondsToKickoff,
  topScorers,
} from '../src/lib/leagueTimeline';
import { createRng } from '../src/lib/rng';
import { buildTable, simulateLeague, type LeagueResult, type LeagueTeam } from '../src/lib/season';
import { ALL } from './helpers';

const DEFS = FORMATIONS['4-3-3'].slots;

/**
 * n Teams wie aus dem Draft (siehe leagueTeams): je 11 verschiedene Pokémon, jedes zweite
 * Team mit Standardschütze. Mit `noSquad` bekommt ein Team keinen Kader (keine Torschützen).
 */
function makeLeague(n: number, seed: number, noSquad: number | null = null): LeagueResult {
  const teams: LeagueTeam[] = Array.from({ length: n }, (_, t) => {
    const mons = ALL.slice(t * 12, t * 12 + 12);
    const ss = mons[11];
    return {
      name: `Team ${String.fromCharCode(65 + t)}`,
      rating: 500 + ((t * 137 + seed * 53) % 400),
      squad: t === noSquad ? undefined : mons.slice(0, 11).map((p, i) => ({ pokemonId: p.id, pos: DEFS[i].pos, atk: p.atk, spa: p.spa })),
      setPieceTaker: t % 2 === 0 ? { pokemonId: ss.id, pos: 'SS' as const, atk: ss.atk, spa: ss.spa } : null,
      setPieceFit: t % 2 === 0 ? 80 : undefined,
    };
  });
  return simulateLeague(teams, createRng(seed));
}

const SIZES = [2, 3, 4, 5, 7, 8];

describe('leagueTimeline', () => {
  it.each(SIZES)('%i Teams: Spieltagszahl = 2·(n−1) (gerade) bzw. 2·n (ungerade)', (n) => {
    for (const seed of [1, 2, 3]) {
      const league = makeLeague(n, seed);
      const expected = n % 2 === 0 ? 2 * (n - 1) : 2 * n;
      expect(matchdayCount(league)).toBe(expected);
      const days = leagueTimeline(league);
      expect(days).toHaveLength(expected);
      days.forEach((d, i) => expect(d.round).toBe(i + 1));
    }
  });

  it.each(SIZES)('%i Teams: jedes Spiel genau einmal, jedes Team höchstens einmal pro Spieltag', (n) => {
    const league = makeLeague(n, 11);
    const days = leagueTimeline(league);
    const seen = days.flatMap((d) => d.matches);
    expect(seen).toHaveLength(league.matches.length);
    expect(new Set(seen).size).toBe(seen.length);
    for (const m of league.matches) expect(seen.filter((x) => x === m)).toHaveLength(1);
    // Jeder gegen jeden, Hin- und Rückrunde
    expect(league.matches).toHaveLength(n * (n - 1));
    for (const d of days) {
      const playing = d.matches.flatMap((m) => [m.home, m.away]);
      expect(new Set(playing).size).toBe(playing.length);
      for (const m of d.matches) expect(m.round).toBe(d.round);
      // spielfrei: nur bei ungerader Teamzahl, dann genau ein Team
      expect(d.byes).toHaveLength(n % 2);
      expect([...playing, ...d.byes].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it.each(SIZES)('%i Teams: Tabelle je Spieltag, Endtabelle = league.table', (n) => {
    const league = makeLeague(n, 21);
    const days = leagueTimeline(league);
    days.forEach((d, i) => {
      expect(d.table).toEqual(
        buildTable(
          league.teams,
          league.matches.filter((m) => m.round <= d.round),
        ),
      );
      expect(d.leader).toBe(d.table[0]);
      d.table.forEach((row, pos) => expect(d.places[row.team]).toBe(pos + 1));
      const prev = days[i - 1];
      d.delta.forEach((delta, t) => expect(delta).toBe(prev ? prev.places[t] - d.places[t] : 0));
      // Jeder hat so viele Spiele wie Spieltage ohne Spielfrei
      for (const row of d.table) {
        const games = days.slice(0, i + 1).filter((x) => !x.byes.includes(row.team)).length;
        expect(row.played).toBe(games);
      }
    });
    expect(days[days.length - 1].table).toEqual(league.table);
  });

  it('ohne Spiele (1 Team) gibt es keine Spieltage', () => {
    const league = makeLeague(1, 1);
    expect(matchdayCount(league)).toBe(0);
    expect(leagueTimeline(league)).toEqual([]);
  });

  it('matchFor liefert das Spiel aus Sicht eines Teams', () => {
    const league = makeLeague(3, 5);
    for (const d of leagueTimeline(league)) {
      for (let t = 0; t < 3; t++) {
        const r = matchFor(d.matches, t);
        if (d.byes.includes(t)) {
          expect(r).toBeNull();
          continue;
        }
        expect(r).not.toBeNull();
        const { match, isHome, gf, ga, opponent, outcome } = r!;
        expect(isHome ? match.home : match.away).toBe(t);
        expect(opponent).toBe(isHome ? match.away : match.home);
        expect([gf, ga]).toEqual(isHome ? [match.hg, match.ag] : [match.ag, match.hg]);
        expect(outcome).toBe(gf > ga ? 'S' : gf < ga ? 'N' : 'U');
      }
    }
  });
});

describe('currentMatchday (synchroner Ticker)', () => {
  const START = 1_760_000_000_000;
  const STEP = DRAFT_LIMITS.seasonStepMs;
  const TOTAL = 14;

  it('vor dem Anpfiff 0, ab startsAt der 1. Spieltag', () => {
    expect(currentMatchday(START, STEP, START - DRAFT_LIMITS.seasonLeadMs, TOTAL)).toBe(0);
    expect(currentMatchday(START, STEP, START - 1, TOTAL)).toBe(0);
    expect(currentMatchday(START, STEP, START, TOTAL)).toBe(1);
  });

  it('exakte Grenzen zwischen den Spieltagen', () => {
    for (let k = 1; k <= TOTAL; k++) {
      const begin = START + (k - 1) * STEP;
      expect(currentMatchday(START, STEP, begin, TOTAL)).toBe(k);
      expect(currentMatchday(START, STEP, begin + STEP - 1, TOTAL)).toBe(Math.min(k, TOTAL));
      if (k > 1) expect(currentMatchday(START, STEP, begin - 1, TOTAL)).toBe(k - 1);
    }
  });

  it('nach dem Ende bleibt es beim letzten Spieltag', () => {
    expect(currentMatchday(START, STEP, START + (TOTAL - 1) * STEP, TOTAL)).toBe(TOTAL);
    expect(currentMatchday(START, STEP, START + TOTAL * STEP, TOTAL)).toBe(TOTAL);
    expect(currentMatchday(START, STEP, START + 10 * 24 * 3600 * 1000, TOTAL)).toBe(TOTAL);
  });

  it('robust gegen große/negative Uhrenabweichung und kaputte Werte', () => {
    const now = START + 5 * STEP + 100;
    expect(currentMatchday(START, STEP, now, TOTAL)).toBe(6);
    // Gerät geht eine Stunde vor/nach – der Uhrenabgleich korrigiert das
    const offset = -3_600_000;
    const deviceNow = now - offset;
    expect(currentMatchday(START, STEP, deviceNow + offset, TOTAL)).toBe(6);
    expect(currentMatchday(START, STEP, now + 1e12, TOTAL)).toBe(TOTAL);
    expect(currentMatchday(START, STEP, now - 1e12, TOTAL)).toBe(0);
    expect(currentMatchday(START, STEP, Number.POSITIVE_INFINITY, TOTAL)).toBe(TOTAL);
    expect(currentMatchday(START, STEP, Number.NEGATIVE_INFINITY, TOTAL)).toBe(0);
    expect(currentMatchday(START, STEP, Number.NaN, TOTAL)).toBe(0);
    expect(currentMatchday(Number.NaN, STEP, now, TOTAL)).toBe(0);
    // ohne Spieltagsdauer: direkt am Ende; ohne Spieltage: immer 0
    expect(currentMatchday(START, 0, START, TOTAL)).toBe(TOTAL);
    expect(currentMatchday(START, STEP, now, 0)).toBe(0);
    expect(currentMatchday(START, STEP, now, -3)).toBe(0);
  });

  it('Countdown bis zum Anpfiff in ganzen Sekunden', () => {
    expect(secondsToKickoff(START, START - DRAFT_LIMITS.seasonLeadMs)).toBe(DRAFT_LIMITS.seasonLeadMs / 1000);
    expect(secondsToKickoff(START, START - 3001)).toBe(4);
    expect(secondsToKickoff(START, START - 3000)).toBe(3);
    expect(secondsToKickoff(START, START - 1)).toBe(1);
    expect(secondsToKickoff(START, START)).toBe(0);
    expect(secondsToKickoff(START, START + 5000)).toBe(0);
  });

  it('Wechsel zum Ergebnis: letzter Spieltag + Abpfiff', () => {
    const finish = seasonFinishAt(START, STEP, TOTAL);
    expect(finish).toBe(START + (TOTAL - 1) * STEP + FINALE_MS);
    expect(currentMatchday(START, STEP, finish, TOTAL)).toBe(TOTAL);
    expect(seasonFinishAt(START, STEP, 0)).toBe(START);
  });
});

describe('topScorers', () => {
  it.each(SIZES)('%i Teams: Summe = alle Tore der Teams mit Kader, absteigend sortiert', (n) => {
    // Team 1 ohne Kader – seine Tore haben keine Schützen
    const noSquad = n > 1 ? 1 : null;
    const league = makeLeague(n, 31, noSquad);
    const list = topScorers(league);
    let expected = 0;
    let setPiece = 0;
    for (const m of league.matches) {
      if (m.home !== noSquad) expected += m.hg;
      if (m.away !== noSquad) expected += m.ag;
      setPiece += [...m.homeScorers, ...m.awayScorers].filter((g) => g.pos === 'SS').length;
    }
    expect(list.reduce((s, x) => s + x.goals, 0)).toBe(expected);
    expect(list.reduce((s, x) => s + x.setPieceGoals, 0)).toBe(setPiece);
    expect(list.every((x) => x.teamIndex !== noSquad && x.goals > 0 && x.setPieceGoals <= x.goals)).toBe(true);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].goals).toBeGreaterThanOrEqual(list[i].goals);
    // keine doppelten Einträge
    expect(new Set(list.map((x) => `${x.teamIndex}:${x.pokemonId}`)).size).toBe(list.length);
    // Standardtore nur vom Standardschützen des Teams
    for (const x of list.filter((s) => s.setPieceGoals > 0)) {
      expect(league.teams[x.teamIndex].setPieceTaker?.pokemonId).toBe(x.pokemonId);
    }
  });

  it('byTeam filtert auf ein Team', () => {
    const league = makeLeague(4, 41);
    for (let t = 0; t < 4; t++) {
      const own = topScorers(league, t);
      const goals = league.matches.reduce((s, m) => s + (m.home === t ? m.hg : 0) + (m.away === t ? m.ag : 0), 0);
      expect(own.every((x) => x.teamIndex === t)).toBe(true);
      expect(own.reduce((s, x) => s + x.goals, 0)).toBe(goals);
    }
    expect(topScorers(league, null)).toEqual(topScorers(league));
  });
});

describe('Online-Draft → gemeinsame Saison', () => {
  it('kompletter Draft (4 Teams, mit Standardschütze): Verlauf passt zur Engine-Saison', () => {
    const scale = buildScale(ALL, 'all');
    const byId = new Map(ALL.map((p) => [p.id, p]));
    const host = { teamId: 'h', deviceId: 'dev-h', name: 'Host-Elf', formation: '4-4-2' as const };
    let state = createDraft({ code: 'ABCDEF', seed: 4242, settings: { region: 1, setPiece: true, maxTeams: 4 }, host, now: 0, list: ALL });
    for (const id of ['c1', 'c2', 'c3']) state = addCpuTeam(state, 'dev-h', id);
    state = startDraft(state, 'dev-h', 1000, ALL);
    let now = 1000;
    while (state.phase === 'drafting') {
      const team = currentTeam(state)!;
      const choice = autoPickChoice(state, team.id, ALL, scale, team.cpu);
      now += 10;
      state = applyPick(state, team.id, choice.pokemonId, choice.slot, true, now, ALL);
    }
    expect(state.season).not.toBeNull();
    const league = draftSeason(state, byId, scale)!;
    expect(league.teams.map((t) => t.name)).toEqual(state.teams.map((t) => t.name));
    expect(league.teams.map((t) => t.rating)).toEqual(leagueTeams(state, byId, scale).map((t) => t.rating));

    const days = leagueTimeline(league);
    expect(days).toHaveLength(6);
    expect(days[days.length - 1].table).toEqual(league.table);
    // Alle Teams haben Kader → jede Torsumme hat Schützen
    const goals = league.matches.reduce((s, m) => s + m.hg + m.ag, 0);
    expect(topScorers(league).reduce((s, x) => s + x.goals, 0)).toBe(goals);

    const { startsAt, stepMs } = state.season!;
    expect(startsAt).toBe(now + DRAFT_LIMITS.seasonLeadMs);
    expect(currentMatchday(startsAt, stepMs, now, days.length)).toBe(0);
    expect(secondsToKickoff(startsAt, now)).toBe(DRAFT_LIMITS.seasonLeadMs / 1000);
    expect(currentMatchday(startsAt, stepMs, startsAt + 2 * stepMs, days.length)).toBe(3);
    expect(currentMatchday(startsAt, stepMs, seasonFinishAt(startsAt, stepMs, days.length), days.length)).toBe(6);

    // Zweiter Client simuliert dieselbe Saison
    expect(draftSeason(state, byId, scale)).toEqual(league);
  });
});

describe('Formkurve', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('letzte Ergebnisse bis zum Spieltag, ältestes zuerst, höchstens n', () => {
    const matches = [m(2, 1, 0, 2, 2), m(1, 0, 1, 3, 0), m(3, 0, 2, 0, 1), m(4, 2, 0, 0, 4), m(5, 0, 1, 1, 0), m(6, 1, 0, 1, 0)];
    expect(recentForm(matches, 0, 3)).toEqual(['S', 'U', 'N']);
    expect(recentForm(matches, 0, 6)).toEqual(['U', 'N', 'S', 'S', 'N']);
    expect(recentForm(matches, 0, 6, 2)).toEqual(['S', 'N']);
    expect(recentForm(matches, 0, 0)).toEqual([]);
  });
});

describe('Längste Siegesserie', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('findet die längste Serie mit Spieltagen, Remis unterbricht', () => {
    const teams = [{ name: 'A', rating: 1 }, { name: 'B', rating: 1 }];
    const matches = [m(1, 0, 1, 1, 0), m(2, 1, 0, 0, 2), m(3, 0, 1, 1, 1), m(4, 1, 0, 2, 0), m(5, 0, 1, 0, 3), m(6, 1, 0, 1, 0)];
    expect(longestWinStreak({ teams, matches })).toEqual({ team: 1, length: 3, from: 4, to: 6 });
    expect(longestWinStreak({ teams, matches: [m(1, 0, 1, 0, 0)] })).toBeNull();
  });
});
