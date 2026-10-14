import { describe, expect, it, vi } from 'vitest';
import { draftLinkFor } from '../src/lib/api/draftClient';
import type { DraftSnapshot } from '../src/lib/api/draftContract';
import { FORMATIONS } from '../src/config/formations';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  draftSeason,
  snapshotOf,
  startDraft,
  withLeague,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import {
  draftShareText,
  headToHead,
  leagueRatings,
  leagueTimeline,
  resolveLeague,
  storedLeague,
  TIEBREAK_LABEL,
  titleRace,
  titleTieNote,
} from '../src/lib/leagueTimeline';
import { createRng } from '../src/lib/rng';
import { buildTable, simulateLeague, type LeagueResult, type LeagueTeam, type Match, type TableRow } from '../src/lib/season';
import { ALL } from './helpers';

const DEFS = FORMATIONS['4-3-3'].slots;

/** Fertiger Online-Draft (4 Teams, CPU) – wie im Spiel nach dem letzten Pick. */
function finishedDraft() {
  const scale = buildScale(ALL, 'all');
  const host = { teamId: 'h', deviceId: 'dev-h', name: 'Host-Elf', formation: '4-4-2' as const };
  let state = createDraft({ code: 'ABCDEF', seed: 777, settings: { region: 1, setPiece: true, maxTeams: 4 }, host, now: 0, list: ALL });
  for (const id of ['c1', 'c2', 'c3']) state = addCpuTeam(state, 'dev-h', id);
  state = startDraft(state, 'dev-h', 1000, ALL);
  let now = 1000;
  while (state.phase === 'drafting') {
    const team = currentTeam(state)!;
    const choice = autoPickChoice(state, team.id, ALL, scale, team.cpu);
    now += 10;
    state = applyPick(state, team.id, choice.pokemonId, choice.slot, true, now, ALL);
  }
  return { state, scale, byId: new Map(ALL.map((p) => [p.id, p])) };
}

/** Liga mit n Teams und Kadern (Torschützen) aus einem Seed. */
function makeLeague(n: number, seed: number, names?: string[]): LeagueResult {
  const teams: LeagueTeam[] = Array.from({ length: n }, (_, t) => {
    const mons = ALL.slice(t * 11, t * 11 + 11);
    return {
      name: names?.[t] ?? `Team ${String.fromCharCode(65 + t)}`,
      rating: 600 + ((t * 71 + seed * 13) % 120),
      squad: mons.map((p, i) => ({ pokemonId: p.id, pos: DEFS[i].pos, atk: p.atk, spa: p.spa })),
    };
  });
  return simulateLeague(teams, createRng(seed));
}

/** Ergebnis wie vom Server (JSON über die Leitung) */
const wire = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

function match(round: number, home: number, away: number, hg: number, ag: number): Match {
  return { round, home, away, hg, ag, homeScorers: [], awayScorers: [] };
}

function row(team: number, pts: number, gf: number, ga: number, name = `T${team}`): TableRow {
  return { team, name, rating: 600, isUser: false, played: 2, w: 0, d: 0, l: 0, gf, ga, gd: gf - ga, pts };
}

describe('gespeichertes Saisonergebnis (SEASON-1)', () => {
  it('ein gespeichertes Ergebnis wird übernommen – nichts wird nachgerechnet, auch wenn sich die Wertung geändert hat', () => {
    const { state, scale, byId } = finishedDraft();
    const original = draftSeason(state, byId, scale)!;
    const stored = wire(original);
    // „Deploy" mit anderer Wertung: dieselbe Liga ergäbe nachgerechnet etwas anderes
    const otherScale = buildScale(ALL.slice(0, 200), 'all');
    const recomputed = draftSeason(state, byId, otherScale)!;
    expect(recomputed.teams.map((t) => t.rating)).not.toEqual(original.teams.map((t) => t.rating));

    const recompute = vi.fn(() => recomputed);
    const league = resolveLeague(stored, state.teams.length, recompute)!;
    expect(recompute).not.toHaveBeenCalled();
    expect(league.matches).toEqual(original.matches);
    expect(league.table).toEqual(original.table);
    expect(league.teams.map((t) => [t.name, t.rating])).toEqual(original.teams.map((t) => [t.name, t.rating]));
    // Ticker und Ergebnis zeigen dasselbe Saisonende
    const days = leagueTimeline(league);
    expect(days[days.length - 1].table).toEqual(original.table);
    expect(days.map((d) => d.table)).toEqual(leagueTimeline(original).map((d) => d.table));
  });

  it('Schnappschuss vom Server (withLeague → snapshotOf → JSON): wird ohne Nachrechnen angezeigt', () => {
    const { state, scale, byId } = finishedDraft();
    const snap = wire(snapshotOf(withLeague(state, ALL, scale), null, 5000)) as DraftSnapshot;
    expect(snap.league).toBeTruthy();
    const recompute = vi.fn(() => null);
    const league = resolveLeague(snap.league, snap.teams.length, recompute)!;
    expect(recompute).not.toHaveBeenCalled();
    const full = draftSeason(state, byId, scale)!;
    expect(league.matches).toEqual(full.matches);
    expect(league.table).toEqual(full.table);
    expect(leagueRatings(league, snap.ratings)).toEqual(full.teams.map((t) => t.rating));
  });

  it('ältere Ligen ohne gespeichertes Ergebnis rechnen wie bisher nach', () => {
    const { state, scale, byId } = finishedDraft();
    const recompute = vi.fn(() => draftSeason(state, byId, scale));
    for (const raw of [undefined, null]) {
      expect(resolveLeague(raw, state.teams.length, recompute)).toEqual(draftSeason(state, byId, scale));
    }
    expect(recompute).toHaveBeenCalledTimes(2);
  });

  it('kaputte oder unpassende Ergebnisse werden verworfen (dann nachrechnen statt abstürzen)', () => {
    const base = wire(makeLeague(3, 5)) as { teams: unknown[]; matches: Record<string, unknown>[]; table: Record<string, unknown>[] };
    expect(storedLeague(base, 3)).not.toBeNull();
    const bad: [string, (x: typeof base) => unknown][] = [
      ['kein Objekt', () => 'league'],
      ['Array', () => []],
      ['falsche Teamzahl', (x) => x],
      ['Team ohne Namen', (x) => ({ ...x, teams: x.teams.map((t, i) => (i === 0 ? { rating: 600 } : t)) })],
      ['Team-Score NaN', (x) => ({ ...x, teams: x.teams.map((t) => ({ ...(t as object), rating: 'viel' })) })],
      ['Spiel gegen sich selbst', (x) => ({ ...x, matches: [{ ...x.matches[0], away: x.matches[0].home }] })],
      ['Team außerhalb', (x) => ({ ...x, matches: [{ ...x.matches[0], home: 7 }] })],
      ['Spieltag 0', (x) => ({ ...x, matches: [{ ...x.matches[0], round: 0 }] })],
      ['Spieltag zu groß', (x) => ({ ...x, matches: [{ ...x.matches[0], round: 99 }] })],
      ['negative Tore', (x) => ({ ...x, matches: [{ ...x.matches[0], hg: -1 }] })],
      ['mehr Schützen als Tore', (x) => ({ ...x, matches: [{ ...x.matches[0], hg: 0, homeScorers: [{ pokemonId: 1, pos: 'ST' }] }] })],
      ['Tabelle unvollständig', (x) => ({ ...x, table: x.table.slice(1) })],
      ['Team doppelt in der Tabelle', (x) => ({ ...x, table: x.table.map((r) => ({ ...r, team: 0 })) })],
      ['Punkte fehlen', (x) => ({ ...x, table: x.table.map(({ pts: _pts, ...r }) => r) })],
    ];
    for (const [label, make] of bad) {
      const n = label === 'falsche Teamzahl' ? 4 : 3;
      expect(storedLeague(make(base), n), label).toBeNull();
    }
  });

  it('übernimmt nur bekannte Felder, fehlende Torschützen gelten als keine', () => {
    const league = makeLeague(2, 9);
    const raw = wire({
      ...league,
      extra: 'x',
      teams: league.teams.map((t) => ({ ...t, secret: 1 })),
      matches: league.matches.map(({ homeScorers: _h, awayScorers: _a, ...m }) => m),
    });
    const out = storedLeague(raw, 2)!;
    expect(Object.keys(out).sort()).toEqual(['matches', 'table', 'teams']);
    expect(out.teams).toEqual(league.teams.map((t) => ({ name: t.name, rating: t.rating })));
    expect(out.matches.every((m) => m.homeScorers.length === 0 && m.awayScorers.length === 0)).toBe(true);
    expect(out.table).toEqual(league.table);
  });

  it('Team-Scores: mitgeschickte Werte, sonst aus dem Ergebnis', () => {
    const league = makeLeague(3, 2);
    expect(leagueRatings(league, [701, 702, 703])).toEqual([701, 702, 703]);
    const fallback = league.teams.map((t) => t.rating);
    expect(leagueRatings(league, undefined)).toEqual(fallback);
    expect(leagueRatings(league, [701, 702])).toEqual(fallback);
    expect(leagueRatings(league, [701, 'x', 703])).toEqual(fallback);
  });

  it('der Ticker endet mit der gespeicherten Abschlusstabelle, auch wenn sie anders sortiert ist', () => {
    const teams: LeagueTeam[] = [
      { name: 'Abra FC', rating: 650 },
      { name: 'Zapdos United', rating: 650 },
    ];
    const matches = [match(1, 0, 1, 2, 1), match(2, 1, 0, 2, 1)];
    const computed = buildTable(teams, matches);
    // Der Server hat (z. B. mit einem anderen Tiebreaker) andersherum sortiert
    const serverTable = [...computed].reverse();
    const league = storedLeague(wire({ teams, matches, table: serverTable }), 2)!;
    const days = leagueTimeline(league);
    expect(days[0].table).toEqual(buildTable(teams, matches.slice(0, 1)));
    expect(days[1].table).toEqual(serverTable);
    expect(days[1].leader.team).toBe(serverTable[0].team);
    expect(days[1].places[serverTable[0].team]).toBe(1);
  });
});

describe('Titelentscheidung bei Punktgleichheit (SEASON-2)', () => {
  const nameOf = (t: number) => `T${t}`;

  it('klarer Meister: kein Hinweis', () => {
    const race = titleRace([row(0, 9, 8, 2), row(1, 6, 9, 3)])!;
    expect(race.decidedBy).toBe('pts');
    expect(titleTieNote(race, nameOf)).toBeNull();
    expect(titleTieNote(titleRace([row(0, 0, 0, 0)]), nameOf)).toBeNull();
    expect(titleRace([])).toBeNull();
  });

  it('punktgleich: Tordifferenz, dann Tore', () => {
    const gd = titleRace([row(0, 6, 7, 2), row(1, 6, 9, 6), row(2, 3, 1, 1)])!;
    expect(gd.decidedBy).toBe('gd');
    expect(titleTieNote(gd, nameOf)).toBe('Punktgleich mit T1 – entschieden nach Tordifferenz (+5 zu +3)');

    const gf = titleRace([row(0, 6, 9, 6), row(1, 6, 7, 4)])!;
    expect(gf.decidedBy).toBe('gf');
    expect(titleTieNote(gf, nameOf)).toBe('Punktgleich mit T1 bei gleicher Tordifferenz – entschieden nach Toren (9 zu 7)');

    const negative = titleRace([row(0, 2, 1, 2), row(1, 2, 0, 3)])!;
    expect(titleTieNote(negative, nameOf)).toBe('Punktgleich mit T1 – entschieden nach Tordifferenz (-1 zu -3)');
  });

  it('völliger Gleichstand wird ehrlich benannt – mit allen gleichauf liegenden Teams', () => {
    const two = titleRace([row(0, 3, 3, 3), row(1, 3, 3, 3)])!;
    expect(two.decidedBy).toBe('tiebreak');
    expect(titleTieNote(two, nameOf)).toBe(
      `Punktgleich mit T1, gleiche Tordifferenz und gleich viele Tore – entschieden nach ${TIEBREAK_LABEL}`,
    );
    const three = titleRace([row(0, 4, 5, 5), row(1, 4, 5, 5), row(2, 4, 5, 5), row(3, 4, 2, 3)])!;
    expect(three.decidedBy).toBe('tiebreak');
    expect(three.level.map((r) => r.team)).toEqual([1, 2]);
    expect(titleTieNote(three, nameOf)).toMatch(/^Punktgleich mit T1 und T2, gleiche Tordifferenz/);
    // Liegt der Meister bei völligem Gleichstand NICHT alphabetisch vorn (anders sortierte, ältere
    // Tabelle), wird kein Grund behauptet – nur die Punktgleichheit genannt.
    const unsorted = titleRace([row(2, 4, 5, 5), row(0, 4, 5, 5), row(1, 4, 5, 5)])!;
    expect(unsorted.decidedBy).toBe('other');
    expect(titleTieNote(unsorted, nameOf)).toBe('Punktgleich mit T0 und T1');
    // Bei „Tore" zählen nur die mit gleicher Tordifferenz, bei „Tordifferenz" alle Punktgleichen
    const mixed = titleRace([row(0, 4, 6, 4), row(1, 4, 5, 3), row(2, 4, 4, 3)])!;
    expect(mixed.decidedBy).toBe('gf');
    expect(titleTieNote(mixed, nameOf)).toMatch(/^Punktgleich mit T1 bei gleicher Tordifferenz/);
    const all = titleRace([row(0, 4, 9, 3), row(1, 4, 5, 3), row(2, 4, 4, 3)])!;
    expect(titleTieNote(all, nameOf)).toBe('Punktgleich mit T1 und T2 – entschieden nach Tordifferenz (+6 zu +2)');
  });

  it('anders sortierte Tabelle: nur die Punktgleichheit, keine falsche Begründung', () => {
    const race = titleRace([row(0, 6, 3, 3), row(1, 6, 8, 2)])!;
    expect(race.decidedBy).toBe('other');
    expect(titleTieNote(race, nameOf)).toBe('Punktgleich mit T1');
    // Platz 2 hat sogar mehr Punkte (kaputtes Ergebnis): gar kein Hinweis statt „Punktgleich mit –"
    const broken = titleRace([row(0, 3, 4, 0), row(1, 6, 2, 2)])!;
    expect(broken.decidedBy).toBe('other');
    expect(titleTieNote(broken, nameOf)).toBeNull();
  });

  it('völliger Gleichstand: zuerst der Team-Score, gleiche Namen entscheiden nichts', () => {
    const strong = { ...row(1, 3, 3, 3, 'Zapdos United'), rating: 812.4 };
    const weak = { ...row(0, 3, 3, 3, 'Abra FC'), rating: 790 };
    const race = titleRace([strong, weak])!;
    expect(race.decidedBy).toBe('rating');
    expect(titleTieNote(race, (t) => (t === 0 ? 'Abra FC' : 'Zapdos United'))).toBe(
      'Punktgleich mit Abra FC, gleiche Tordifferenz und gleich viele Tore – entschieden nach Team-Score (812 zu 790)',
    );
    // buildTable sortiert genauso: der stärkere Kader vor dem alphabetisch ersten Namen
    const teams: LeagueTeam[] = [
      { name: 'Abra FC', rating: 600 },
      { name: 'Zapdos United', rating: 700 },
    ];
    expect(buildTable(teams, [match(1, 0, 1, 2, 1), match(2, 1, 0, 2, 1)]).map((r) => r.name)).toEqual(['Zapdos United', 'Abra FC']);
    // Zwei Teams mit gleichem Namen und gleichem Team-Score: kein „nach dem Teamnamen"
    const twins = titleRace([row(0, 3, 3, 3, 'FC Pika'), row(1, 3, 3, 3, 'FC Pika')])!;
    expect(twins.decidedBy).toBe('other');
  });

  it('TIEBREAK_LABEL beschreibt, wie buildTable bei völligem Gleichstand sortiert', () => {
    const teams: LeagueTeam[] = [
      { name: 'Zapdos United', rating: 650 },
      { name: 'Abra FC', rating: 650 },
    ];
    const table = buildTable(teams, [match(1, 0, 1, 2, 1), match(2, 1, 0, 2, 1)]);
    expect(TIEBREAK_LABEL).toBe('dem Teamnamen (alphabetisch)');
    expect(table.map((r) => r.name)).toEqual(['Abra FC', 'Zapdos United']);
  });

  it('Fehlerfall aus dem Review: 2 Teams, je 2:1-Heimsieg → Gleichstand wird angezeigt', () => {
    const teams: LeagueTeam[] = [
      { name: 'Zapdos United', rating: 650 },
      { name: 'Abra FC', rating: 650 },
    ];
    const matches = [match(1, 0, 1, 2, 1), match(2, 1, 0, 2, 1)];
    const league: LeagueResult = { teams, matches, table: buildTable(teams, matches) };
    const days = leagueTimeline(league);
    const finalTable = days[days.length - 1].table;
    const nameOfTeam = (t: number) => teams[t].name;
    const note = titleTieNote(titleRace(finalTable), nameOfTeam)!;
    expect(note).toContain(`Punktgleich mit ${nameOfTeam(finalTable[1].team)}`);
    expect(note).toContain('gleiche Tordifferenz und gleich viele Tore');
  });

  it.each([2, 3, 4])('%i Teams, viele Saisons: Hinweis genau dann, wenn die Spitze punktgleich ist', (n) => {
    let ties = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const table = makeLeague(n, seed).table;
      const note = titleTieNote(titleRace(table), (t) => `Team ${t}`);
      const [a, b] = table;
      expect(note != null).toBe(a.pts === b.pts);
      if (a.pts !== b.pts) continue;
      ties++;
      expect(note).toContain(`Team ${b.team}`);
      if (a.gd !== b.gd) expect(note).toContain('Tordifferenz (');
      else if (a.gf !== b.gf) expect(note).toContain('entschieden nach Toren');
      else if (a.rating !== b.rating) expect(note).toContain('entschieden nach Team-Score');
      else expect(note).toContain(TIEBREAK_LABEL);
    }
    expect(ties).toBeGreaterThan(0);
  });
});

describe('Teilen-Text des Online-Drafts (SEASON-2, SEASON-5)', () => {
  const url = draftLinkFor('https://elf.example', '/', 'K7MPQ2');

  it('enthält den Link zur Liga', () => {
    expect(url).toBe('https://elf.example/draft/K7MPQ2');
    const text = draftShareText({
      code: 'K7MPQ2',
      championName: 'FC Pika',
      championPts: 12,
      tieNote: null,
      own: { name: 'Glumanda 04', place: 2 },
      url,
    });
    expect(text).toBe(
      'Pokémon Elf – Online-Draft K7MPQ2: Meister FC Pika (12 Pkt). Mein Team Glumanda 04: Platz 2.\nhttps://elf.example/draft/K7MPQ2',
    );
  });

  it('Zuschauer: ohne eigenes Team, Link unter Unterpfad', () => {
    const sub = draftLinkFor('https://host.example', '/elf/', 'ABC234');
    const text = draftShareText({ code: 'ABC234', championName: 'FC Pika', championPts: 3, tieNote: null, own: null, url: sub });
    expect(text.split('\n')).toEqual(['Pokémon Elf – Online-Draft ABC234: Meister FC Pika (3 Pkt).', 'https://host.example/elf/draft/ABC234']);
  });

  it('bei Punktgleichheit steht die Titelentscheidung dabei', () => {
    const tieNote = titleTieNote(titleRace([row(1, 3, 3, 3, 'Abra FC'), row(0, 3, 3, 3, 'Zapdos United')]), (t) =>
      t === 0 ? 'Zapdos United' : 'Abra FC',
    );
    const text = draftShareText({ code: 'K7MPQ2', championName: 'Abra FC', championPts: 3, tieNote, own: null, url });
    expect(text).toBe(
      `Pokémon Elf – Online-Draft K7MPQ2: Meister Abra FC (3 Pkt) – punktgleich mit Zapdos United, gleiche Tordifferenz und gleich viele Tore – entschieden nach ${TIEBREAK_LABEL}.\n${url}`,
    );
  });
});

describe('Draft-Noten', () => {
  it('relativ in der Liga: bester A+, nach Abstand (mindestens 60 Punkte Spanne)', async () => {
    const { draftGrades } = await import('../src/lib/leagueTimeline');
    // Weit auseinander: volle Skala
    expect(draftGrades([800, 750, 700, 600])).toEqual(['A+', 'B+', 'B', 'D']);
    // Knapp beieinander: knappe Noten
    expect(draftGrades([910, 908])).toEqual(['A+', 'A+']);
    expect(draftGrades([700, 690, 680])).toEqual(['A+', 'A', 'B+']);
    expect(draftGrades([800, 800])).toEqual(['A+', 'A+']);
    expect(draftGrades([])).toEqual([]);
  });
});

describe('Schnäppchen des Drafts', () => {
  it('bester Fit der zweiten Draft-Hälfte, ohne Standardschütze', async () => {
    const { draftSteal } = await import('../src/lib/leagueTimeline');
    const { state, scale, byId } = finishedDraft();
    const steal = draftSteal(state.picks, state.teams, byId, scale)!;
    expect(steal.pick).toBeGreaterThanOrEqual(Math.floor(state.picks.length / 2));
    expect(steal.pos).not.toBe('SS');
    const own = state.picks.find((p) => p.pick === steal.pick)!;
    expect(own.pokemonId).toBe(steal.pokemonId);
    expect(draftSteal([], state.teams, byId, scale)).toBeNull();
  });
});

describe('Deine Duelle (direkter Vergleich)', () => {
  const m = (round: number, home: number, away: number, hg: number, ag: number): Match => ({
    round, home, away, hg, ag, homeScorers: [], awayScorers: [],
  });
  it('sammelt Bilanz und Ergebnisse aus eigener Sicht, Gegner in Tabellenreihenfolge', () => {
    const matches = [m(3, 2, 0, 1, 1), m(1, 0, 1, 2, 0), m(2, 0, 2, 0, 3), m(4, 1, 0, 2, 2), m(2, 1, 2, 5, 5)];
    const table = [{ team: 2 }, { team: 0 }, { team: 1 }] as TableRow[];
    const h = headToHead({ matches, table }, 0);
    expect(h.map((x) => x.opponent)).toEqual([2, 1]);
    expect(h[0]).toMatchObject({ w: 0, d: 1, l: 1, gf: 1, ga: 4 });
    expect(h[0].scores).toEqual([
      { gf: 0, ga: 3, home: true },
      { gf: 1, ga: 1, home: false },
    ]);
    expect(h[1]).toMatchObject({ w: 1, d: 1, l: 0, gf: 4, ga: 2 });
    expect(headToHead({ matches, table }, 9)).toEqual([]);
  });
});
