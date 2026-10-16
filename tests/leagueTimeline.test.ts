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
import { biggestUpset, currentRun, biggestWin, goalFest, fastestPicker, longestWinStreak, recentForm,
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

describe('Höchster Sieg', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('größte Differenz, dann mehr Tore, dann früher; ohne Sieg null', () => {
    expect(biggestWin([m(1, 0, 1, 3, 0), m(2, 1, 0, 4, 1), m(3, 0, 1, 1, 4)])).toEqual(m(2, 1, 0, 4, 1));
    expect(biggestWin([m(1, 0, 1, 1, 1)])).toBeNull();
  });
});

describe('Torreichstes Spiel', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('meiste Tore, dann früher; unter 5 Toren null', () => {
    expect(goalFest([m(1, 0, 1, 3, 2), m(2, 1, 0, 4, 1), m(3, 0, 1, 3, 3)])).toEqual(m(3, 0, 1, 3, 3));
    expect(goalFest([m(2, 0, 1, 3, 2), m(1, 1, 0, 4, 1)])).toEqual(m(1, 1, 0, 4, 1));
    expect(goalFest([m(1, 0, 1, 2, 2)])).toBeNull();
    expect(goalFest([])).toBeNull();
  });
});

describe('Überraschung des Spieltags', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('Außenseitersieg mit dem größten Rückstand, ab der Mindestgrenze', () => {
    const ratings = [900, 500, 800, 650];
    const matches = [m(1, 0, 1, 0, 1), m(1, 2, 3, 1, 2), m(1, 1, 3, 1, 1)];
    expect(biggestUpset(matches, ratings)).toMatchObject({ winner: 1, loser: 0, gap: 400 });
    expect(biggestUpset([m(1, 2, 3, 1, 2)], ratings)).toMatchObject({ winner: 3, gap: 150 });
    expect(biggestUpset([m(1, 2, 3, 1, 2)], ratings, 200)).toBeNull();
    expect(biggestUpset([m(1, 0, 1, 3, 0)], ratings)).toBeNull();
  });
});

describe('Schnellster Picker', () => {
  const p = (pick: number, teamId: string, at: number, auto = false) => ({ pick, teamId, at, auto });
  it('Ø Abstand zum vorigen Pick, ohne automatische Picks, Mindestzahl', async () => {
    const picks = [
      p(0, 'a', 0), p(1, 'b', 10_000), p(2, 'b', 12_000), p(3, 'a', 30_000),
      p(4, 'a', 32_000), p(5, 'b', 40_000), p(6, 'b', 41_000, true), p(7, 'a', 45_000),
    ];
    // a: Picks 3 (18 s), 4 (2 s), 7 (4 s) → Ø 8 s; b: 1 (10 s), 2 (2 s), 5 (8 s) → Ø ≈ 6,7 s
    expect(fastestPicker(picks)).toMatchObject({ teamId: 'b', picks: 3 });
    expect(fastestPicker(picks)!.avgMs).toBeCloseTo(20_000 / 3);
    expect(fastestPicker(picks, 4)).toBeNull();
    expect(fastestPicker([])).toBeNull();
    // Bedenkzeiten je Team (Grundlage für ⌀ in der Statusleiste)
    const { pickTimes } = await import('../src/lib/leagueTimeline');
    expect(pickTimes(picks).get('a')).toEqual({ ms: 24_000, n: 3 });
    expect(pickTimes(picks).get('b')).toEqual({ ms: 20_000, n: 3 });
  });
});

describe('Tabellen-Zonen', () => {
  it('oben Meister bzw. Aufstiegsplätze, unten die letzten drei – erst ab 6 Teams', async () => {
    const { tableZone, tableRowClass } = await import('../src/lib/leagueTimeline');
    expect(tableZone(1, 18)).toBe('top');
    expect(tableZone(2, 18)).toBeNull();
    expect(tableZone(3, 18, 3)).toBe('top');
    expect(tableZone(15, 18)).toBeNull();
    expect(tableZone(16, 18)).toBe('bottom');
    expect(tableZone(18, 18)).toBe('bottom');
    expect(tableZone(1, 4)).toBeNull();
    // Kleine Liga: nur der Meister, unten keine rote Zone
    expect(tableZone(1, 8)).toBe('top');
    expect(tableZone(8, 8)).toBeNull();
    expect(tableZone(10, 10)).toBe('bottom');
    expect(tableRowClass(true, 18, 18)).toBe('is-user is-zone-bottom');
    expect(tableRowClass(false, 9, 18)).toBe('');
  });
});

describe('Tabellenführer seit', () => {
  it('zählt die Spieltage in Folge bis zum gegebenen', async () => {
    const { leaderSince } = await import('../src/lib/leagueTimeline');
    const d = (round: number, team: number) => ({ round, leader: { team } as never });
    const days = [d(1, 0), d(2, 1), d(3, 1), d(4, 1), d(5, 2)];
    expect(leaderSince(days, 4)).toBe(3);
    expect(leaderSince(days, 5)).toBe(1);
    expect(leaderSince(days, 1)).toBe(1);
    expect(leaderSince([], 3)).toBe(0);
  });
});

describe('Last-Minute-Sieg', () => {
  const g = (minute: number) => ({ pokemonId: 1, pos: 'ST' as const, minute });
  const m = (round: number, home: number, away: number, hs: number[], as: number[]) => ({
    round, home, away, hg: hs.length, ag: as.length, homeScorers: hs.map(g), awayScorers: as.map(g),
  });
  it('Siegtor aus dem Gleichstand ab der 85. Minute, das späteste gewinnt', async () => {
    const { lateWinner } = await import('../src/lib/leagueTimeline');
    // 1:1, Heim trifft in der 88. → spät; Gast führt 2:0 früh → nicht spät
    const a = m(1, 0, 1, [10, 88], [50]);
    const b = m(1, 2, 3, [], [5, 89]);
    const c = m(1, 4, 5, [20, 91], [30]);
    expect(lateWinner([a, b])).toEqual({ match: a, winner: 0, loser: 1, minute: 88 });
    expect(lateWinner([a, c])!.minute).toBe(91);
    // Ausgleich und erneute Führung: zählt die letzte Führungsübernahme
    const d = m(1, 6, 7, [80, 86], [83]);
    expect(lateWinner([d])!.minute).toBe(86);
    // Remis oder ohne Minuten: nichts
    expect(lateWinner([m(1, 0, 1, [90], [91])])).toBeNull();
    expect(lateWinner([{ round: 1, home: 0, away: 1, hg: 1, ag: 0, homeScorers: [{ pokemonId: 1, pos: 'ST' as const }], awayScorers: [] }])).toBeNull();
    // Unvollständig erfasst (Gegentor ohne Torschütze): nichts
    expect(lateWinner([{ ...m(1, 0, 1, [10, 88], []), ag: 1 }])).toBeNull();
  });
});

describe('Heim- und Auswärtstabelle', () => {
  it('zählt je Team nur die Heim- bzw. Auswärtsspiele', async () => {
    const { sideTable } = await import('../src/lib/season');
    const teams = [{ name: 'A', rating: 1 }, { name: 'B', rating: 1 }];
    const m = (home: number, away: number, hg: number, ag: number) => ({ round: 1, home, away, hg, ag, homeScorers: [], awayScorers: [] });
    const matches = [m(0, 1, 2, 0), m(1, 0, 1, 1)];
    const home = sideTable(teams, matches, 'home');
    expect(home.map((r) => [r.name, r.played, r.pts, r.gf, r.ga])).toEqual([['A', 1, 3, 2, 0], ['B', 1, 1, 1, 1]]);
    const away = sideTable(teams, matches, 'away');
    expect(away.map((r) => [r.name, r.played, r.pts, r.gf, r.ga])).toEqual([['A', 1, 1, 1, 1], ['B', 1, 0, 0, 2]]);
  });
});

describe('currentRun', () => {
  const g = (round: number, home: number, away: number, hg: number, ag: number) => ({ round, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('zählt vom letzten Spiel rückwärts – ungeschlagen hat Vorrang, unter 3 Spielen null', () => {
    // Team 0: N, S, U, S (ungeschlagen seit 3), Reihenfolge der Liste egal
    const ms = [g(4, 1, 0, 0, 2), g(1, 0, 1, 0, 1), g(3, 2, 0, 1, 1), g(2, 0, 2, 3, 0)];
    expect(currentRun(ms, 0)).toEqual({ kind: 'unbeaten', length: 3 });
    // Team 1: zuletzt N, davor S → keine Serie
    expect(currentRun(ms, 1)).toBeNull();
    // Team 2: N (Runde 2), U (Runde 3) – nur zwei Spiele, mit min 2 sieglos
    expect(currentRun(ms, 2)).toBeNull();
    expect(currentRun(ms, 2, 2)).toEqual({ kind: 'winless', length: 2 });
  });
  it('sieglos: Remis und Niederlagen ohne Sieg', () => {
    const ms = [g(1, 0, 1, 2, 0), g(2, 1, 0, 1, 1), g(3, 0, 2, 0, 1), g(4, 3, 0, 2, 2)];
    expect(currentRun(ms, 0)).toEqual({ kind: 'winless', length: 3 });
    // nur Remis: ungeschlagen und sieglos zugleich – ungeschlagen gewinnt
    expect(currentRun([g(1, 0, 1, 1, 1), g(2, 0, 1, 0, 0), g(3, 1, 0, 2, 2)], 0)).toEqual({ kind: 'unbeaten', length: 3 });
  });
});

describe('Kantersieg', () => {
  const m = (home: number, away: number, hg: number, ag: number) => ({ round: 1, home, away, hg, ag, homeScorers: [], awayScorers: [] });
  it('höchster Sieg ab vier Toren Abstand, bei Gleichstand mehr Tore des Siegers', async () => {
    const { routOf } = await import('../src/lib/leagueTimeline');
    expect(routOf([m(0, 1, 3, 0), m(2, 3, 4, 2)])).toBeNull();
    const a = m(0, 1, 4, 0);
    const b = m(2, 3, 1, 5);
    expect(routOf([a, b])).toEqual({ match: b, winner: 3, loser: 2 });
    expect(routOf([a, m(4, 5, 0, 6), b])!.winner).toBe(5);
    expect(routOf([a])).toEqual({ match: a, winner: 0, loser: 1 });
  });
});

describe('Comeback', () => {
  const g = (minute: number) => ({ pokemonId: 1, pos: 'ST' as const, minute });
  const m = (home: number, away: number, hs: number[], as: number[]) => ({
    round: 1, home, away, hg: hs.length, ag: as.length, homeScorers: hs.map(g), awayScorers: as.map(g),
  });
  it('Sieg nach mindestens zwei Toren Rückstand, der größte Rückstand gewinnt', async () => {
    const { comebackOf } = await import('../src/lib/leagueTimeline');
    // 1:0 → 1:1 → 2:1: nur ein Tor Rückstand nie → nichts
    expect(comebackOf([m(0, 1, [10, 80], [50])])).toBeNull();
    // Gast liegt 0:2 zurück und gewinnt 3:2
    const a = m(0, 1, [5, 20], [50, 60, 70]);
    expect(comebackOf([a])).toEqual({ match: a, winner: 1, loser: 0, behind: [0, 2] });
    // Heim liegt 0:3 zurück (erster Moment des größten Rückstands) und gewinnt 5:4 → größerer Rückstand gewinnt
    const b = m(2, 3, [10, 60, 70, 80, 89], [1, 2, 3, 40]);
    expect(comebackOf([a, b])!.behind).toEqual([0, 3]);
    // 0:2 und Remis bzw. Niederlage: nichts; ohne Minuten: nichts
    expect(comebackOf([m(0, 1, [50, 60], [5, 20])])).toBeNull();
    expect(comebackOf([m(0, 1, [], [5, 20])])).toBeNull();
    expect(comebackOf([{ ...a, awayScorers: a.awayScorers.map((x) => ({ pokemonId: x.pokemonId, pos: x.pos })) }])).toBeNull();
  });
});

describe('Lokale Liga teilen', () => {
  it('Meister, Platz jedes menschlichen Teams (Standardname ohne Doppelung) und Link', async () => {
    const { localShareText } = await import('../src/lib/leagueTimeline');
    expect(localShareText('FC Glurak', 18, [{ name: null, place: 2 }, { name: 'Team Blau', place: 5 }], 'https://x/draft')).toBe(
      'Pokémon Elf – Fantasy-Draft an einem Gerät: Meister FC Glurak (18 Pkt). Mein Team: Platz 2. Mein Team Team Blau: Platz 5.\nhttps://x/draft',
    );
  });
});

describe('Titelkampf (rechnerisch)', () => {
  const row = (team: number, pts: number, played: number) =>
    ({ team, name: `T${team}`, rating: 0, isUser: false, played, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts });
  it('sicher, noch möglich oder nicht mehr erreichbar', async () => {
    const { titleChance } = await import('../src/lib/leagueTimeline');
    // 10 Spiele, 8 gespielt: 2 Restspiele = 6 Punkte
    const t = [row(0, 20, 8), row(1, 14, 8), row(2, 13, 8)];
    expect(titleChance(t, 0, 10)).toBe('open'); // Team 1 kann noch auf 20 kommen
    expect(titleChance(t, 1, 10)).toBe('open'); // genau gleichziehen
    expect(titleChance(t, 2, 10)).toBe('out'); // 19 < 20
    expect(titleChance([row(0, 21, 8), row(1, 14, 8)], 0, 10)).toBe('clinched');
    // Mit Spielen im Rückstand zählt jedes Restspiel
    expect(titleChance([row(0, 21, 8), row(1, 11, 7)], 0, 10)).toBe('clinched');
    expect(titleChance([row(0, 21, 8), row(1, 12, 7)], 0, 10)).toBe('open');
    expect(titleChance(t, 9, 10)).toBeNull();
  });
});

describe('Tor-Marken', () => {
  const g = (pokemonId: number) => ({ pokemonId, pos: 'ST' as const, minute: 10 });
  const m = (round: number, home: number, away: number, hs: number[], as: number[]) => ({
    round, home, away, hg: hs.length, ag: as.length, homeScorers: hs.map(g), awayScorers: as.map(g),
  });
  it('nur Marken, die am Spieltag erreicht wurden, nur eigene Spieler, höchste zuerst', async () => {
    const { goalMilestones } = await import('../src/lib/leagueTimeline');
    const matches = [
      m(1, 0, 1, [7, 7, 7, 7, 8, 8, 8, 8, 8], [9, 9, 9, 9, 9]),
      m(2, 1, 0, [9], [7, 8, 6, 6, 6, 6, 6]),
      m(3, 0, 1, [7, 7, 7, 7, 7], []),
    ];
    // Spieltag 1: 8 trifft fünfmal → 5er-Marke; 7 (4) noch nicht; 9 spielt für Team 1
    expect(goalMilestones(matches, 0, 1)).toEqual([{ pokemonId: 8, mark: 5 }]);
    // Spieltag 2: 7 erreicht 5, 6 auch; 8 (6) hat die Marke schon
    expect(goalMilestones(matches, 0, 2)).toEqual([{ pokemonId: 6, mark: 5 }, { pokemonId: 7, mark: 5 }]);
    // Spieltag 3: 7 springt von 5 auf 10
    expect(goalMilestones(matches, 0, 3)).toEqual([{ pokemonId: 7, mark: 10 }]);
    expect(goalMilestones(matches, 1, 2)).toEqual([]);
  });
});

describe('Torserien', () => {
  const g = (pokemonId: number) => ({ pokemonId, pos: 'ST' as const, minute: 10 });
  const m = (round: number, home: number, away: number, hs: number[], as: number[]) => ({
    round, home, away, hg: hs.length, ag: as.length, homeScorers: hs.map(g), awayScorers: as.map(g),
  });
  it('Spiele in Folge mit Tor bis zum Spieltag, ab drei, nur Torschützen dieses Spieltags', async () => {
    const { scoringRuns } = await import('../src/lib/leagueTimeline');
    const matches = [
      m(1, 0, 1, [7, 8], [9]),
      m(2, 2, 0, [9], [7, 8]),
      m(3, 0, 3, [7], []),
      m(4, 4, 0, [], [7, 8, 8]),
      m(4, 1, 2, [9, 9], []),
    ];
    expect(scoringRuns(matches, 0, 2)).toEqual([]);
    expect(scoringRuns(matches, 0, 3)).toEqual([{ pokemonId: 7, games: 3 }]);
    // 8 traf an 3 nicht → Serie 1; 7 jetzt 4
    expect(scoringRuns(matches, 0, 4)).toEqual([{ pokemonId: 7, games: 4 }]);
    // Team 1 spielt an Spieltag 3 nicht → kein Eintrag für Spieltag 3
    expect(scoringRuns(matches, 1, 3)).toEqual([]);
  });
});

describe('Tore nach Mannschaftsteil', () => {
  it('zählt die Tore eines Teams nach Linie des Torschützen (SS = Angriff)', async () => {
    const { goalsByLine } = await import('../src/lib/leagueTimeline');
    const g = (pos: 'ST' | 'ZM' | 'IV' | 'TW' | 'SS' | 'LF') => ({ pokemonId: 1, pos });
    const matches = [
      { round: 1, home: 0, away: 1, hg: 4, ag: 1, homeScorers: [g('ST'), g('LF'), g('ZM'), g('SS')], awayScorers: [g('IV')] },
      { round: 2, home: 2, away: 0, hg: 0, ag: 2, homeScorers: [], awayScorers: [g('IV'), g('TW')] },
    ];
    expect(goalsByLine(matches, 0)).toEqual({ att: 3, mid: 1, def: 1, gk: 1 });
    expect(goalsByLine(matches, 1)).toEqual({ att: 0, mid: 0, def: 1, gk: 0 });
  });
});

describe('Verschiedene Torschützen', () => {
  it('zählt jeden Torschützen je Team einmal', async () => {
    const { distinctScorers } = await import('../src/lib/leagueTimeline');
    const g = (pokemonId: number) => ({ pokemonId, pos: 'ST' as const });
    const matches = [
      { round: 1, home: 0, away: 1, hg: 3, ag: 1, homeScorers: [g(1), g(1), g(2)], awayScorers: [g(5)] },
      { round: 2, home: 1, away: 0, hg: 0, ag: 2, homeScorers: [], awayScorers: [g(2), g(3)] },
    ];
    expect(distinctScorers(matches, 3)).toEqual([3, 1, 0]);
  });
});

describe('Stärkste Torphase', () => {
  it('Viertelstunde mit den meisten Toren, Nachspielzeit zur letzten, Gleichstand → null', async () => {
    const { bestGoalPhase } = await import('../src/lib/leagueTimeline');
    const g = (minute?: number) => ({ pokemonId: 1, pos: 'ST' as const, minute });
    const matches = [
      { round: 1, home: 0, away: 1, hg: 3, ag: 1, homeScorers: [g(80), g(93), g(5)], awayScorers: [g(78)] },
      { round: 2, home: 1, away: 0, hg: 0, ag: 2, homeScorers: [], awayScorers: [g(90), g()] },
    ];
    expect(bestGoalPhase(matches, 0)).toEqual({ from: 76, to: 90, goals: 3 });
    expect(bestGoalPhase(matches, 1)).toBeNull();
    expect(bestGoalPhase(matches.slice(0, 1).map((m) => ({ ...m, homeScorers: [g(5), g(80), g(20)] })), 0)).toBeNull();
  });
});

describe('Angriff und Abwehr mit Rang', () => {
  it('geteilte Ränge bei Gleichstand', async () => {
    const { attackDefenseRanks } = await import('../src/lib/leagueTimeline');
    const table = [{ team: 0, gf: 30, ga: 10 }, { team: 1, gf: 30, ga: 12 }, { team: 2, gf: 20, ga: 10 }];
    expect(attackDefenseRanks(table, 1)).toEqual({ gf: 30, gfRank: 1, ga: 12, gaRank: 3 });
    expect(attackDefenseRanks(table, 2)).toEqual({ gf: 20, gfRank: 3, ga: 10, gaRank: 1 });
    expect(attackDefenseRanks(table, 9)).toBeNull();
  });
});

describe('Traumduo', () => {
  it('häufigstes Vorlage → Tor-Paar eines Teams, ab 2, bei Gleichstand das zuerst erfolgreiche', async () => {
    const { dreamDuo } = await import('../src/lib/leagueTimeline');
    const g = (pokemonId: number, assist?: number) => ({ pokemonId, pos: 'ST' as const, assist });
    const matches = [
      { home: 0, away: 1, homeScorers: [g(7, 4), g(7, 4), g(9, 7)], awayScorers: [g(5, 6)] },
      { home: 1, away: 0, homeScorers: [g(5, 6), g(5, 6)], awayScorers: [g(7, 4), g(8)] },
    ];
    // 7←4 (Team 0) und 5←6 (Team 1) je 3 → Gleichstand: 7←4 traf zuerst
    expect(dreamDuo(matches)).toEqual({ team: 0, assist: 4, scorer: 7, goals: 3 });
    expect(dreamDuo(matches.slice(0, 1).map((m) => ({ ...m, homeScorers: [g(7, 4)] })))).toBeNull();
    const more = [...matches, { home: 0, away: 1, homeScorers: [g(7, 4)], awayScorers: [] }];
    expect(dreamDuo(more)).toEqual({ team: 0, assist: 4, scorer: 7, goals: 4 });
    expect(dreamDuo(more, 5)).toBeNull();
  });
});

describe('Liga in Zahlen', () => {
  it('zählt Spiele, Tore, Remis und Zu-null-Spiele', async () => {
    const { leagueNumbers } = await import('../src/lib/leagueTimeline');
    expect(leagueNumbers([{ hg: 2, ag: 0 }, { hg: 1, ag: 1 }, { hg: 0, ag: 0 }, { hg: 3, ag: 2 }])).toEqual({ games: 4, goals: 9, draws: 2, cleanSheets: 3 });
    expect(leagueNumbers([])).toEqual({ games: 0, goals: 0, draws: 0, cleanSheets: 0 });
  });
});

describe('Siege in Folge', () => {
  it('zählt vom letzten Spiel rückwärts', async () => {
    const { winRun } = await import('../src/lib/leagueTimeline');
    const m = (round: number, hg: number, ag: number) => ({ round, home: 0, away: 1, hg, ag });
    expect(winRun([m(1, 0, 1), m(2, 2, 0), m(3, 1, 0), m(4, 3, 1)], 0)).toBe(3);
    expect(winRun([m(1, 2, 0), m(2, 1, 1)], 0)).toBe(0);
    expect(winRun([m(1, 0, 2), m(2, 0, 1)], 1)).toBe(2);
  });
});

describe('Fan-Stimmung', () => {
  it('Punkte je Spiel der letzten Spiele, erst ab drei Spielen', async () => {
    const { fanMood } = await import('../src/lib/leagueTimeline');
    expect(fanMood(['S', 'S'])).toBeNull();
    expect(fanMood(['S', 'S', 'S', 'U', 'S'])).toBe('euphoria');
    expect(fanMood(['S', 'U', 'N', 'S'])).toBe('happy');
    expect(fanMood(['U', 'N', 'S', 'N'])).toBe('calm');
    expect(fanMood(['N', 'N', 'U'])).toBe('angry');
  });
});

describe('Tore nach Typ', () => {
  it('Doppeltypen zählen für beide, absteigend, höchstens drei', async () => {
    const { goalsByType } = await import('../src/lib/leagueTimeline');
    const byId = new Map([
      [1, { types: ['fire', 'flying'] as const }],
      [2, { types: ['water'] as const }],
      [3, { types: ['fire'] as const }],
      [4, { types: ['grass'] as const }],
    ].map(([id, p]) => [id as number, { types: [...(p as { types: readonly string[] }).types] }])) as never;
    const g = (pokemonId: number) => ({ pokemonId, pos: 'ST' as const });
    const matches = [
      { round: 1, home: 0, away: 1, hg: 3, ag: 2, homeScorers: [g(1), g(3), g(3)], awayScorers: [g(2), g(2)] },
      { round: 2, home: 1, away: 0, hg: 1, ag: 1, homeScorers: [g(4)], awayScorers: [g(1)] },
    ];
    const { TYPE_KEYS } = await import('../src/config/pokemonTypes');
    const tied = (['flying', 'water'] as const).slice().sort((a, b) => TYPE_KEYS.indexOf(a) - TYPE_KEYS.indexOf(b));
    expect(goalsByType(matches, byId)).toEqual([{ type: 'fire', goals: 4 }, ...tied.map((type) => ({ type, goals: 2 }))]);
    expect(goalsByType([], byId)).toEqual([]);
  });
});
