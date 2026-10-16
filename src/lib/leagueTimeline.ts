/**
 * Spieltag-für-Spieltag-Verlauf einer Liga mit mehreren echten Teams (Online-Draft) –
 * Grundlage für den gemeinsamen Ticker und die Ergebnisansicht. Rein und
 * deterministisch: rechnet nur aus dem LeagueResult nach (keine Zufallszahlen), die
 * Tabelle je Spieltag entsteht mit buildTable. Dazu die Uhr des synchronen Tickers
 * (alle Clients rechnen aus Startzeit + Spieltagsdauer denselben Spieltag aus), die
 * Torjägerliste, das vom Server gespeicherte Ergebnis, die Titelentscheidung bei
 * Punktgleichheit und der Teilen-Text.
 */
import { FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { messages } from '../i18n';
import type { FormationId, Pokemon, PosCode, TypeKey } from '../types';
import { TYPE_KEYS } from '../config/pokemonTypes';
import type { DraftPickLog, DraftTeam } from './api/draftContract';
import { storedCup } from './cup';
import { positionFit, type Scale } from './fit';
import { buildTable, type Goal, type LeagueResult, type LeagueTeam, type Match, type MatchStats, type TableRow } from './season';

export interface Matchday {
  /** Spieltag (1-basiert) */
  round: number;
  /** Alle Spiele dieses Spieltags (Reihenfolge des Spielplans) mit Ergebnis und Torschützen */
  matches: Match[];
  /** Spielfreie Teams (Index in league.teams) – nur bei ungerader Teamzahl */
  byes: number[];
  /** Tabelle nach diesem Spieltag (buildTable über alle Spiele bis einschließlich dieser Runde) */
  table: TableRow[];
  /** Tabellenführer nach diesem Spieltag */
  leader: TableRow;
  /** Platz je Team-Index nach diesem Spieltag (1-basiert) */
  places: number[];
  /** Veränderung je Team-Index gegenüber dem Vorspieltag – positiv = geklettert, am 1. Spieltag 0 */
  delta: number[];
}

/** Wie lange der Abpfiff nach dem letzten Spieltag steht, bevor es zum Ergebnis geht */
export const FINALE_MS = 2500;

/** Anzahl der Spieltage: 2·(n−1) bei gerader, 2·n bei ungerader Teamzahl (spielfrei). */
export function matchdayCount(league: LeagueResult): number {
  let max = 0;
  for (const m of league.matches) if (m.round > max) max = m.round;
  return max;
}

/**
 * Verlauf aller Spieltage (aufsteigend). Der letzte Spieltag zeigt league.table – so
 * stimmt das Saisonende im Ticker immer mit dem (ggf. vom Server gespeicherten) Ergebnis überein.
 */
export function leagueTimeline(league: LeagueResult): Matchday[] {
  const total = matchdayCount(league);
  const n = league.teams.length;
  const byRound: Match[][] = Array.from({ length: total }, () => []);
  for (const m of league.matches) byRound[m.round - 1].push(m);
  const finalTable = league.table.length === n ? league.table : null;

  const played: Match[] = [];
  const out: Matchday[] = [];
  for (let i = 0; i < total; i++) {
    const matches = byRound[i];
    played.push(...matches);
    const table = i === total - 1 && finalTable ? finalTable : buildTable(league.teams, played);
    const places = new Array<number>(n).fill(0);
    table.forEach((row, pos) => (places[row.team] = pos + 1));
    const prev = out[i - 1]?.places;
    const playing = new Set(matches.flatMap((m) => [m.home, m.away]));
    out.push({
      round: i + 1,
      matches,
      byes: places.flatMap((_, t) => (playing.has(t) ? [] : [t])),
      table,
      leader: table[0],
      places,
      delta: places.map((p, t) => (prev ? prev[t] - p : 0)),
    });
  }
  return out;
}

/**
 * Welcher Spieltag gerade läuft – auf jedem Client gleich, solange die Uhr stimmt
 * (serverNow = Date.now() + Uhrenabgleich):
 *   0            noch nicht angepfiffen (Countdown)
 *   k            k-ter Spieltag, ab startsAt + (k − 1) · stepMs
 *   total        letzter Spieltag erreicht = Saison durch
 */
export function currentMatchday(startsAt: number, stepMs: number, serverNow: number, total: number): number {
  const last = Math.max(0, Math.floor(total) || 0);
  // NaN-sicher: unbekannte Zeit gilt als „noch nicht angepfiffen"
  if (!(serverNow >= startsAt) || last === 0) return 0;
  if (!(stepMs > 0)) return last;
  return Math.min(last, Math.floor((serverNow - startsAt) / stepMs) + 1);
}

/** Ganze Sekunden bis zum Anpfiff (aufgerundet, nie negativ) – für „Anpfiff in 3 …". */
export function secondsToKickoff(startsAt: number, serverNow: number): number {
  const ms = startsAt - serverNow;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/**
 * Zeitpunkt, zu dem alle Clients vom Ticker zum Ergebnis wechseln: letzter Spieltag
 * plus Abpfiff. Wer später kommt, kann direkt das Ergebnis zeigen.
 */
export function seasonFinishAt(startsAt: number, stepMs: number, total: number): number {
  if (total <= 0) return startsAt;
  return startsAt + (total - 1) * Math.max(0, stepMs) + FINALE_MS;
}

export interface TopScorer {
  pokemonId: number;
  /** Index in league.teams */
  teamIndex: number;
  goals: number;
  /** Davon als Standardschütze (pos 'SS') */
  setPieceGoals: number;
}

/**
 * Torjägerliste der ganzen Liga (oder nur eines Teams, byTeam = Team-Index), absteigend
 * nach Toren. Treffer des Standardschützen (pos 'SS') zählen mit und stehen zusätzlich
 * in setPieceGoals.
 */
export function topScorers(league: LeagueResult, byTeam?: number | null): TopScorer[] {
  const tally = new Map<string, TopScorer>();
  const add = (teamIndex: number, goals: Goal[]) => {
    if (byTeam != null && teamIndex !== byTeam) return;
    for (const g of goals) {
      const key = `${teamIndex}:${g.pokemonId}`;
      let s = tally.get(key);
      if (!s) {
        s = { pokemonId: g.pokemonId, teamIndex, goals: 0, setPieceGoals: 0 };
        tally.set(key, s);
      }
      s.goals++;
      if (g.pos === 'SS') s.setPieceGoals++;
    }
  };
  for (const m of league.matches) {
    add(m.home, m.homeScorers);
    add(m.away, m.awayScorers);
  }
  return [...tally.values()].sort((a, b) => b.goals - a.goals || a.teamIndex - b.teamIndex || a.pokemonId - b.pokemonId);
}

/** Tore und Vorlagen eines Pokémon (je Team) */
export interface PlayerTally {
  pokemonId: number;
  teamIndex: number;
  goals: number;
  assists: number;
}

/** Tore und Vorlagen aller Pokémon mit mindestens einem davon (unsortiert). */
export function playerTallies(league: Pick<LeagueResult, 'matches'>): PlayerTally[] {
  const tally = new Map<string, PlayerTally>();
  const get = (teamIndex: number, pokemonId: number) => {
    const key = `${teamIndex}:${pokemonId}`;
    let s = tally.get(key);
    if (!s) {
      s = { pokemonId, teamIndex, goals: 0, assists: 0 };
      tally.set(key, s);
    }
    return s;
  };
  for (const m of league.matches) {
    for (const [team, goals] of [
      [m.home, m.homeScorers],
      [m.away, m.awayScorers],
    ] as const) {
      for (const g of goals) {
        get(team, g.pokemonId).goals++;
        if (g.assist != null) get(team, g.assist).assists++;
      }
    }
  }
  return [...tally.values()];
}

/**
 * Spieler des Spieltags (bzw. beliebiger Spiele): die meisten Torbeteiligungen, Tore doppelt gewichtet;
 * bei Gleichstand mehr Tore, dann fest nach Team und Pokémon. null ohne Torbeteiligung.
 */
export function playerOfRound(matches: LeagueResult['matches']): PlayerTally | null {
  const value = (p: PlayerTally) => p.goals * 2 + p.assists;
  const all = playerTallies({ matches }).sort(
    (a, b) => value(b) - value(a) || b.goals - a.goals || a.teamIndex - b.teamIndex || a.pokemonId - b.pokemonId,
  );
  return all[0] ?? null;
}

/**
 * Transfer der Saison (Manager-Saison): der Zugang (Transfermarkt oder Tausch) mit den meisten
 * Torbeteiligungen für sein neues Team ab dem Spieltag des Wechsels – Tore doppelt gewichtet.
 * teamIndex: Index des Teams in der Liga (gedraftete Teams) oder −1. null ohne Torbeteiligung.
 */
export function bestTransfer(
  matches: LeagueResult['matches'],
  transfers: readonly { matchday: number; teamId: string; in: number }[],
  teamIndex: (teamId: string) => number,
): { pokemonId: number; teamIndex: number; matchday: number; goals: number; assists: number } | null {
  let best: { pokemonId: number; teamIndex: number; matchday: number; goals: number; assists: number } | null = null;
  for (const tr of transfers) {
    const team = teamIndex(tr.teamId);
    if (team < 0) continue;
    const since = matches.filter((m) => m.round >= tr.matchday && (m.home === team || m.away === team));
    const tally = playerTallies({ matches: since }).find((p) => p.teamIndex === team && p.pokemonId === tr.in);
    if (!tally || tally.goals + tally.assists === 0) continue;
    const value = tally.goals * 2 + tally.assists;
    if (!best || value > best.goals * 2 + best.assists) best = { pokemonId: tr.in, teamIndex: team, matchday: tr.matchday, goals: tally.goals, assists: tally.assists };
  }
  return best;
}

/** Statistik eines Teams über alle Spiele mit Details (Match.stats) */
export interface TeamTally {
  team: number;
  games: number;
  shots: number;
  onTarget: number;
  /** Erwartete Tore für bzw. gegen (Summe) */
  xg: number;
  xga: number;
  goals: number;
  against: number;
  /** Spiele ohne Gegentor */
  cleanSheets: number;
  /** Ø Ballbesitz in Prozent */
  possession: number;
}

/** Teamstatistik – nur Spiele mit Details zählen; Teams ohne solche Spiele fehlen. */
export function teamTallies(league: Pick<LeagueResult, 'matches'>): TeamTally[] {
  const rows = new Map<number, TeamTally & { poss: number }>();
  const row = (team: number) => {
    let r = rows.get(team);
    if (!r) {
      r = { team, games: 0, shots: 0, onTarget: 0, xg: 0, xga: 0, goals: 0, against: 0, cleanSheets: 0, possession: 0, poss: 0 };
      rows.set(team, r);
    }
    return r;
  };
  for (const m of league.matches) {
    const s = m.stats;
    if (!s) continue;
    for (const [team, i, gf, ga, poss] of [
      [m.home, 0, m.hg, m.ag, s.possession],
      [m.away, 1, m.ag, m.hg, 100 - s.possession],
    ] as const) {
      const r = row(team);
      r.games++;
      r.shots += s.shots[i];
      r.onTarget += s.onTarget[i];
      r.xg += s.xg[i];
      r.xga += s.xg[1 - i];
      r.goals += gf;
      r.against += ga;
      if (ga === 0) r.cleanSheets++;
      r.poss += poss;
    }
  }
  return [...rows.values()].map(({ poss, ...r }) => ({
    ...r,
    xg: Math.round(r.xg * 10) / 10,
    xga: Math.round(r.xga * 10) / 10,
    possession: Math.round(poss / r.games),
  }));
}

/** Ergebnis eines Spiels aus Sicht eines Teams – oder null, wenn es nicht beteiligt ist. */
export function matchFor(
  matches: Match[],
  team: number,
): { match: Match; isHome: boolean; gf: number; ga: number; opponent: number; outcome: 'S' | 'U' | 'N' } | null {
  const match = matches.find((m) => m.home === team || m.away === team);
  if (!match) return null;
  const isHome = match.home === team;
  const gf = isHome ? match.hg : match.ag;
  const ga = isHome ? match.ag : match.hg;
  return { match, isHome, gf, ga, opponent: isHome ? match.away : match.home, outcome: gf > ga ? 'S' : gf < ga ? 'N' : 'U' };
}

// ---------------------------------------------------------------- Gespeichertes Ergebnis

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Ganzzahl ≥ min */
const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;

function goalsOf(v: unknown, goals: number): Goal[] | null {
  if (!Array.isArray(v) || v.length > goals) return null;
  const out: Goal[] = [];
  for (const g of v) {
    if (!isObj(g) || !isInt(g.pokemonId, 1) || typeof g.pos !== 'string') return null;
    const goal: Goal = { pokemonId: g.pokemonId, pos: g.pos as Goal['pos'] };
    if (isInt(g.minute, 1) && g.minute <= 120) goal.minute = g.minute;
    if (isInt(g.assist, 1)) goal.assist = g.assist;
    out.push(goal);
  }
  return out;
}

const pairOf = (v: unknown, ok: (x: unknown) => boolean): number[] | null =>
  Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1]) ? [v[0] as number, v[1] as number] : null;

/** Spieldetails eines gespeicherten Spiels – null, wenn sie fehlen oder kaputt sind */
function statsOf(v: unknown): MatchStats | null {
  if (!isObj(v)) return null;
  const shots = pairOf(v.shots, (x) => isInt(x));
  const onTarget = pairOf(v.onTarget, (x) => isInt(x));
  const xg = pairOf(v.xg, (x) => isNum(x) && (x as number) >= 0);
  const possession = v.possession;
  if (!shots || !onTarget || !xg || !isInt(possession) || possession > 100) return null;
  return { shots, onTarget, xg, possession };
}

/** Höchstens so viele Teams in einem gespeicherten Ergebnis (gedraftet + aufgefüllt) */
const STORED_TEAMS_MAX = 64;

/**
 * Das vom Server gespeicherte Saisonergebnis (Schnappschuss) als LeagueResult – oder null,
 * wenn es fehlt (ältere Ligen) oder nicht zur Liga passt. Dann rechnet der Client die
 * Saison wie bisher selbst aus dem Seed nach. Übernimmt nur bekannte Felder.
 */
export function storedLeague(raw: unknown, teamCount: number): LeagueResult | null {
  if (!isObj(raw) || !isInt(teamCount, 1)) return null;
  const { teams: rawTeams, matches: rawMatches, table: rawTable } = raw;
  // Gedraftete Teams zuerst, dahinter ggf. Auffüllteams (DRAFT_LIMITS.leagueSize)
  if (!Array.isArray(rawTeams) || rawTeams.length < teamCount || rawTeams.length > STORED_TEAMS_MAX) return null;
  const n = rawTeams.length;
  if (!Array.isArray(rawMatches) || !Array.isArray(rawTable) || rawTable.length !== n) return null;

  const teams: LeagueTeam[] = [];
  for (const t of rawTeams) {
    if (!isObj(t) || typeof t.name !== 'string' || !isNum(t.rating)) return null;
    const team: LeagueTeam = { name: t.name, rating: t.rating };
    if (t.isUser === true) team.isUser = true;
    if (typeof t.player === 'string' && t.player) team.player = t.player;
    if (typeof t.playerEntry === 'string' && /^[\w-]{1,64}$/.test(t.playerEntry)) team.playerEntry = t.playerEntry;
    teams.push(team);
  }

  // Doppelrunde: höchstens 2·n Spieltage (ungerade Teamzahl mit Spielfrei)
  const maxRound = 2 * n;
  const isTeam = (v: unknown): v is number => isInt(v) && v < n;
  const matches: Match[] = [];
  for (const m of rawMatches) {
    if (!isObj(m)) return null;
    const { round, home, away, hg, ag } = m;
    if (!isInt(round, 1) || round > maxRound) return null;
    if (!isTeam(home) || !isTeam(away) || home === away || !isInt(hg) || !isInt(ag)) return null;
    const homeScorers = goalsOf(m.homeScorers ?? [], hg);
    const awayScorers = goalsOf(m.awayScorers ?? [], ag);
    if (!homeScorers || !awayScorers) return null;
    const match: Match = { round, home, away, hg, ag, homeScorers, awayScorers };
    const stats = statsOf(m.stats);
    if (stats) match.stats = stats;
    matches.push(match);
  }

  const seen = new Set<number>();
  const table: TableRow[] = [];
  for (const r of rawTable) {
    if (!isObj(r)) return null;
    const { team, played, w, d, l, gf, ga, gd, pts } = r;
    if (!isTeam(team) || seen.has(team)) return null;
    if (!isInt(played) || !isInt(w) || !isInt(d) || !isInt(l) || !isInt(gf) || !isInt(ga) || !isInt(pts)) return null;
    if (!Number.isInteger(gd)) return null;
    seen.add(team);
    table.push({
      team,
      name: typeof r.name === 'string' ? r.name : teams[team].name,
      rating: isNum(r.rating) ? r.rating : teams[team].rating,
      isUser: r.isUser === true,
      played,
      w,
      d,
      l,
      gf,
      ga,
      gd: gd as number,
      pts,
    });
  }
  if (raw.cup != null) {
    const cup = storedCup(raw.cup, n);
    if (!cup) return null;
    return { teams, matches, table, cup };
  }
  return { teams, matches, table };
}

/**
 * Saison für die Anzeige: das vom Server gespeicherte Ergebnis – nur ältere Ligen ohne
 * (gültiges) gespeichertes Ergebnis werden nachgerechnet (recompute läuft nur dann).
 */
export function resolveLeague(
  stored: unknown,
  teamCount: number,
  recompute: () => LeagueResult | null,
): LeagueResult | null {
  return storedLeague(stored, teamCount) ?? recompute();
}

/** Team-Score je Team: vom Server mitgeschickt (passende Länge), sonst aus dem Ergebnis. */
export function leagueRatings(league: LeagueResult, raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length === league.teams.length && raw.every(isNum)) return raw;
  return league.teams.map((t) => t.rating);
}

// ---------------------------------------------------------------- Titelentscheidung

/**
 * Wodurch der Meister vor dem Zweiten liegt:
 *   'pts'      mehr Punkte (oder nur ein Team) – eindeutig
 *   'gd'       punktgleich, bessere Tordifferenz
 *   'gf'       punktgleich, gleiche Tordifferenz, mehr Tore
 *   'tiebreak' gleichauf in Punkten, Tordifferenz und Toren – Platz 1 nur durch den
 *              letzten Tiebreaker der Tabelle (TIEBREAK_LABEL)
 *   'other'    punktgleich, aber die Tabelle ist anders sortiert (unbekanntes Kriterium)
 */
export type TitleDecider = 'pts' | 'gd' | 'gf' | 'rating' | 'tiebreak' | 'other';

export interface TitleRace {
  /** Platz 1 der Tabelle */
  champion: TableRow;
  /** Platz 2 oder null (nur ein Team) */
  runnerUp: TableRow | null;
  decidedBy: TitleDecider;
  /**
   * Teams (ohne den Meister), die bis zum entscheidenden Kriterium gleichauf sind –
   * bei 'gd' und 'other' alle Punktgleichen, bei 'gf' zusätzlich mit gleicher
   * Tordifferenz, bei 'rating' und 'tiebreak' die in Punkten, Tordifferenz und Toren Gleichen.
   * Leer bei 'pts' (und bei einer nicht nach Punkten sortierten Tabelle).
   */
  level: TableRow[];
}

/**
 * Wie buildTable bei völligem Gleichstand (Punkte, Tordifferenz, Tore und Team-Score) entscheidet –
 * deutsche Fassung; die Hinweise nutzen die der aktiven Sprache (messages().draft.tie.tiebreakLabel).
 */
export const TIEBREAK_LABEL = messages('de').draft.tie.tiebreakLabel;

/**
 * Titelentscheidung aus der Abschlusstabelle (Platz 1 gegen Platz 2). Ändert nichts an
 * der Reihenfolge – beschreibt nur, warum Platz 1 vorn liegt.
 */
export function titleRace(table: readonly TableRow[]): TitleRace | null {
  const champion = table[0];
  if (!champion) return null;
  const runnerUp = table[1] ?? null;
  const samePts = table.slice(1).filter((r) => r.pts === champion.pts);
  const sameGd = samePts.filter((r) => r.gd === champion.gd);
  const sameGf = sameGd.filter((r) => r.gf === champion.gf);
  if (!runnerUp || runnerUp.pts < champion.pts) return { champion, runnerUp, decidedBy: 'pts', level: [] };
  // Nicht nach Punkten sortiert (kaputtes Ergebnis): nichts behaupten
  if (runnerUp.pts > champion.pts) return { champion, runnerUp, decidedBy: 'other', level: [] };
  // Anders sortierte Tabelle (z. B. älteres Ergebnis): nur die Punktgleichheit nennen, nichts Falsches behaupten
  const other: TitleRace = { champion, runnerUp, decidedBy: 'other', level: samePts };
  if (runnerUp.gd !== champion.gd) return runnerUp.gd < champion.gd ? { champion, runnerUp, decidedBy: 'gd', level: samePts } : other;
  if (runnerUp.gf !== champion.gf) return runnerUp.gf < champion.gf ? { champion, runnerUp, decidedBy: 'gf', level: sameGd } : other;
  if (runnerUp.rating < champion.rating) return { champion, runnerUp, decidedBy: 'rating', level: sameGf };
  // Gleicher Team-Score: der Name – nur, wenn er wirklich vorn liegt (gleiche Namen: Reihenfolge der Teams)
  if (runnerUp.rating === champion.rating && champion.name.localeCompare(runnerUp.name, 'de') < 0) {
    return { champion, runnerUp, decidedBy: 'tiebreak', level: sameGf };
  }
  return other;
}

/** Abstand der Tor-Marken (5, 10, 15 …) */
const GOAL_MARK = 5;

/** Saisontore-Marken (5, 10, 15 …), die Spieler von team am Spieltag round erreicht haben – höchste Marke zuerst */
export function goalMilestones(matches: LeagueResult['matches'], team: number, round: number): { pokemonId: number; mark: number }[] {
  const before = new Map<number, number>();
  const now = new Map<number, number>();
  for (const m of matches) {
    if (m.round > round) continue;
    const own = m.home === team ? m.homeScorers : m.away === team ? m.awayScorers : [];
    for (const g of own) {
      now.set(g.pokemonId, (now.get(g.pokemonId) ?? 0) + 1);
      if (m.round < round) before.set(g.pokemonId, (before.get(g.pokemonId) ?? 0) + 1);
    }
  }
  const out: { pokemonId: number; mark: number }[] = [];
  for (const [pokemonId, n] of now) {
    const mark = Math.floor(n / GOAL_MARK) * GOAL_MARK;
    if (mark > 0 && mark > (before.get(pokemonId) ?? 0)) out.push({ pokemonId, mark });
  }
  return out.sort((a, b) => b.mark - a.mark || a.pokemonId - b.pokemonId);
}

/**
 * Tore der ganzen Liga nach Pokémon-Typ (Doppeltypen zählen für beide Typen), absteigend; bei Gleichstand in der
 * Reihenfolge von TYPE_KEYS. Höchstens n Typen.
 */
export function goalsByType(matches: LeagueResult['matches'], byId: Map<number, Pick<Pokemon, 'types'>>, n = 3): { type: TypeKey; goals: number }[] {
  const count = new Map<TypeKey, number>();
  for (const m of matches)
    for (const g of [...m.homeScorers, ...m.awayScorers]) for (const type of byId.get(g.pokemonId)?.types ?? []) count.set(type, (count.get(type) ?? 0) + 1);
  return [...count]
    .map(([type, goals]) => ({ type, goals }))
    .sort((a, b) => b.goals - a.goals || TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type))
    .slice(0, n);
}

/** Mannschaftsteile für die Torverteilung (Standardschütze zählt zum Angriff, wie in POSITIONS) */
export const GOAL_LINES = ['att', 'mid', 'def', 'gk'] as const;
export type GoalLine = (typeof GOAL_LINES)[number];

/** Tore eines Teams nach Mannschaftsteil (Position des Torschützen im Spiel) */
export function goalsByLine(matches: LeagueResult['matches'], team: number): Record<GoalLine, number> {
  const out: Record<GoalLine, number> = { att: 0, mid: 0, def: 0, gk: 0 };
  for (const m of matches) {
    const own = m.home === team ? m.homeScorers : m.away === team ? m.awayScorers : [];
    for (const g of own) out[POSITIONS[g.pos]?.line ?? 'att']++;
  }
  return out;
}

/** Ab so vielen Spielen in Folge mit Tor gilt eine Torserie */
export const SCORING_RUN_MIN = 3;

/**
 * Torserien der Spieler von team bis Spieltag round: in wie vielen eigenen Spielen in Folge (bis einschließlich
 * des Spiels an round) sie getroffen haben – nur Spieler, die an round trafen, ab SCORING_RUN_MIN; längste zuerst.
 */
export function scoringRuns(matches: LeagueResult['matches'], team: number, round: number): { pokemonId: number; games: number }[] {
  const own = matches
    .filter((m) => m.round <= round && (m.home === team || m.away === team))
    .sort((a, b) => b.round - a.round);
  if (!own.length || own[0].round !== round) return [];
  const scorers = (m: Match) => new Set((m.home === team ? m.homeScorers : m.awayScorers).map((g) => g.pokemonId));
  const out: { pokemonId: number; games: number }[] = [];
  for (const id of scorers(own[0])) {
    let games = 0;
    while (games < own.length && scorers(own[games]).has(id)) games++;
    if (games >= SCORING_RUN_MIN) out.push({ pokemonId: id, games });
  }
  return out.sort((a, b) => b.games - a.games || a.pokemonId - b.pokemonId);
}

/** Rechnerischer Titelkampf eines Teams: schon sicher vorn, noch möglich oder nicht mehr erreichbar */
export type TitleChance = 'clinched' | 'open' | 'out';

/**
 * Rechnerische Titelchance von team bei games Spielen je Team (3 Punkte je Sieg): 'clinched', wenn kein anderes
 * Team mit allen Restspielen gewonnen noch gleichziehen kann; 'out', wenn team selbst mit allen Siegen unter der
 * Spitze bleibt; sonst 'open'. null für ein unbekanntes Team.
 */
export function titleChance(table: readonly TableRow[], team: number, games: number): TitleChance | null {
  const me = table.find((r) => r.team === team);
  if (!me) return null;
  const max = (r: TableRow) => r.pts + 3 * Math.max(0, games - r.played);
  const others = table.filter((r) => r !== me);
  if (others.every((r) => max(r) < me.pts)) return 'clinched';
  if (others.some((r) => r.pts > max(me))) return 'out';
  return 'open';
}

/** „A", „A und B", „A, B und C" (Bindewort in der aktiven Sprache) */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')}${messages().draft.tie.and}${names[names.length - 1]}`;
}

/** „+3", „0", „-2" (wie in den Tabellen) */
function formatGd(gd: number): string {
  return gd > 0 ? `+${gd}` : String(gd);
}

/**
 * Hinweis bei Punktgleichheit an der Spitze – oder null, wenn der Meister mehr Punkte hat:
 *   „Punktgleich mit A – entschieden nach Tordifferenz (+5 zu +3)"
 *   „Punktgleich mit A bei gleicher Tordifferenz – entschieden nach Toren (12 zu 10)"
 *   „Punktgleich mit A, gleiche Tordifferenz und gleich viele Tore – entschieden nach …"
 */
export function titleTieNote(race: TitleRace | null, nameOf: (team: number) => string): string | null {
  if (!race || race.decidedBy === 'pts' || !race.runnerUp || !race.level.length) return null;
  const { champion: c, runnerUp: r, level } = race;
  const names = joinNames(level.map((x) => nameOf(x.team)));
  // Text in der aktiven Sprache (Tests: Deutsch)
  const tx = messages().draft.tie;
  switch (race.decidedBy) {
    case 'gd':
      return tx.gd(names, formatGd(c.gd), formatGd(r.gd));
    case 'gf':
      return tx.gf(names, c.gf, r.gf);
    case 'rating':
      return tx.rating(names, Math.round(c.rating), Math.round(r.rating));
    case 'tiebreak':
      return tx.tiebreak(names, tx.tiebreakLabel);
    default:
      return tx.level(names);
  }
}

// ---------------------------------------------------------------- Teilen

export interface DraftShareInput {
  /** Liga-Code */
  code: string;
  championName: string;
  championPts: number;
  /** Hinweis bei Punktgleichheit an der Spitze (titleTieNote) oder null */
  tieNote: string | null;
  /** Eigenes Team mit Platz (shinies: Shinys im Kader) – null für Zuschauer */
  own: { name: string; place: number; shinies?: number } | null;
  /** Link zur Liga (draftLink) – Tabelle und Aufstellungen ohne Code-Eingabe */
  url: string;
  /** KO-Turnier: Sieger statt Meister; ownStatus = Abschneiden des eigenen Teams als Text */
  cup?: { ownStatus: string | null; final?: string | null };
}

/**
 * Teilen-Text des Online-Drafts – zwei Zeilen:
 *   Pokémon Elf – Online-Draft K7MPQ2: Meister A (12 Pkt). Mein Team B: Platz 2.
 *   Link zur Liga
 * Bei Punktgleichheit an der Spitze folgt der Hinweis nach einem Gedankenstrich.
 */
export function draftShareText(i: DraftShareInput): string {
  const shiny = i.own?.shinies ? messages().shiny.shareOwn(i.own.shinies) : '';
  if (i.cup) {
    const c = messages().draft.cup;
    const own = i.own && i.cup.ownStatus ? c.shareOwn(i.own.name, i.cup.ownStatus) + shiny : '';
    return [c.shareLine(i.code, i.championName, i.cup.final ?? null) + own, i.url].join('\n');
  }
  const tx = messages().draft.share;
  const tie = i.tieNote ? ` – ${i.tieNote.charAt(0).toLowerCase()}${i.tieNote.slice(1)}` : '';
  return [
    tx.line(i.code, i.championName, i.championPts, tie) + (i.own ? tx.own(i.own.name, i.own.place) + shiny : ''),
    i.url,
  ].join('\n');
}

/** Text zum Teilen einer lokalen Liga: Meister, Platz jedes menschlichen Teams, Link (Namen schon in der Anzeigesprache) */
export function localShareText(champion: string, pts: number, humans: readonly { name: string | null; place: number }[], url: string): string {
  const tx = messages().draft.share;
  // name null: Standardname „Mein Team“ – ohne Namen, sonst hieße es „Mein Team Mein Team“
  return [tx.localLine(champion, pts) + humans.map((h) => (h.name == null ? tx.ownPlain(h.place) : tx.own(h.name, h.place))).join(''), url].join('\n');
}

/** Noten des Drafts, beste zuerst */
export const DRAFT_GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'] as const;

/** So viele Team-Score-Punkte trennen A+ und D mindestens – knappe Ligen bekommen knappe Noten */
export const DRAFT_GRADE_SPREAD = 60;

/**
 * Draft-Note je Team (Reihenfolge wie ratings): relativ innerhalb der Liga – der beste Team-Score
 * bekommt A+, dann nach Abstand zu ihm (über die Spanne der Liga, mindestens DRAFT_GRADE_SPREAD).
 * Absolute Werte taugen nicht, weil sie stark vom Pool abhängen (Kanto ≈ 690, alle Regionen ≈ 980).
 */
export function draftGrades(ratings: readonly number[]): string[] {
  if (!ratings.length) return [];
  const max = Math.max(...ratings);
  const spread = Math.max(max - Math.min(...ratings), DRAFT_GRADE_SPREAD);
  const last = DRAFT_GRADES.length - 1;
  return ratings.map((r) => DRAFT_GRADES[Math.round(((max - r) / spread) * last)]);
}

/** Überraschung bzw. Enttäuschung der Saison: Team und wie viele Plätze es über/unter seinem Team-Score-Rang landete */
export interface SeasonSwing {
  team: number;
  delta: number;
}

/**
 * Vergleicht die Abschlussreihenfolge (order: Teamindizes, Erster zuerst) mit der Rangfolge nach Team-Score –
 * nur unter den gedrafteten Teams (Index < ratings.length). Gleich starke Teams dürfen sich untereinander tauschen.
 * up = am weitesten nach oben (delta > 0), down = am weitesten nach unten (delta < 0); bei Gleichstand das
 * besser platzierte Team bzw. das schlechter platzierte. null, wenn niemand abweicht.
 */
export function seasonSwings(order: readonly number[], ratings: readonly number[]): { up: SeasonSwing | null; down: SeasonSwing | null } {
  const drafted = order.filter((i) => i >= 0 && i < ratings.length);
  let up: SeasonSwing | null = null;
  let down: SeasonSwing | null = null;
  drafted.forEach((team, place) => {
    // Gleich starke Teams: erwarteter Platz ist ein Bereich (bester bis schlechtester geteilter Rang)
    const best = ratings.filter((r) => r > ratings[team]).length;
    const worst = best + ratings.filter((r) => r === ratings[team]).length - 1;
    const delta = place < best ? best - place : place > worst ? worst - place : 0;
    if (delta > 0 && (!up || delta > up.delta)) up = { team, delta };
    if (delta < 0 && (!down || delta <= down.delta)) down = { team, delta };
  });
  return { up, down };
}

/**
 * Erwartung gegen Ergebnis eines Teams: erwarteter Platz nach Team-Score (bei Gleichstand ein Bereich, 1-basiert)
 * und tatsächlicher Platz in der (sortierten) Tabelle; delta > 0 = besser als erwartet. null für ein unbekanntes Team.
 */
export function expectationGap(table: readonly Pick<TableRow, 'team' | 'rating'>[], team: number): { from: number; to: number; place: number; delta: number } | null {
  const at = table.findIndex((r) => r.team === team);
  if (at < 0) return null;
  const mine = table[at].rating;
  const best = table.filter((r) => r.rating > mine).length;
  const worst = best + table.filter((r) => r.rating === mine).length - 1;
  const delta = at < best ? best - at : at > worst ? worst - at : 0;
  return { from: best + 1, to: worst + 1, place: at + 1, delta };
}

/** Schnäppchen des Drafts: ein später Pick, der besonders gut auf seine Position passt. */
export interface DraftSteal {
  pick: number;
  teamId: string;
  pokemonId: number;
  pos: PosCode;
}

/**
 * Bester Pick der zweiten Draft-Hälfte nach Positions-Fit (Standardschütze zählt nicht) – bei
 * Gleichstand der spätere. null ohne passende Picks.
 */
export function draftSteal(
  picks: readonly Pick<DraftPickLog, 'pick' | 'teamId' | 'pokemonId' | 'slot'>[],
  teams: readonly Pick<DraftTeam, 'id' | 'formation'>[],
  byId: Map<number, Pokemon>,
  scale: Scale,
): DraftSteal | null {
  const half = Math.floor(picks.length / 2);
  let best: (DraftSteal & { fit: number }) | null = null;
  for (const pk of picks) {
    if (pk.pick < half) continue;
    const team = teams.find((t) => t.id === pk.teamId);
    const p = byId.get(pk.pokemonId);
    const def = team ? FORMATIONS[team.formation].slots[pk.slot] : undefined;
    if (!p || !def) continue;
    const fit = positionFit(p, def.pos, scale);
    if (!best || fit >= best.fit) best = { pick: pk.pick, teamId: pk.teamId, pokemonId: pk.pokemonId, pos: def.pos, fit };
  }
  return best && { pick: best.pick, teamId: best.teamId, pokemonId: best.pokemonId, pos: best.pos };
}

/** Ab so viel Fit-Abstand zur besten freien Alternative gilt ein Pick als verpasste Chance */
export const MISSED_GAP = 10;

export interface MissedChance {
  /** Eigener Pick (0-basiert) und gewähltes Pokémon */
  pick: number;
  pokemonId: number;
  fit: number;
  pos: PosCode;
  /** Beste damals freie Alternative auf derselben Position */
  altId: number;
  altFit: number;
  /** Wer die Alternative später bekam (fehlt: blieb frei) */
  takenBy?: { teamId: string; pick: number };
}

/**
 * „Verpasste Chance“ eines Teams: der eigene Feld-Pick, bei dem die beste damals noch freie Alternative auf
 * derselben Position am meisten besser gepasst hätte (mindestens MISSED_GAP Fit). eligible schränkt die
 * Alternativen ein (z. B. ohne Legendäre/Ultrabestien/Megas, die Limits unterliegen). Bei Gleichstand der frühere Pick.
 */
export function missedChance(
  picks: readonly Pick<DraftPickLog, 'pick' | 'teamId' | 'pokemonId' | 'slot'>[],
  teams: readonly Pick<DraftTeam, 'id' | 'formation'>[],
  teamId: string,
  pool: readonly Pokemon[],
  scale: Scale,
  eligible: (p: Pokemon) => boolean = () => true,
): MissedChance | null {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;
  const byPick = [...picks].sort((a, b) => a.pick - b.pick);
  const takenAt = new Map(byPick.map((pk) => [pk.pokemonId, pk]));
  const byId = new Map(pool.map((p) => [p.id, p]));
  let best: (MissedChance & { gap: number }) | null = null;
  for (const pk of byPick) {
    if (pk.teamId !== teamId) continue;
    const def = FORMATIONS[team.formation].slots[pk.slot];
    const mon = byId.get(pk.pokemonId);
    if (!def || !mon) continue;
    const fit = positionFit(mon, def.pos, scale);
    let alt: { id: number; fit: number } | null = null;
    for (const p of pool) {
      if (p.id === pk.pokemonId || !eligible(p)) continue;
      const at = takenAt.get(p.id);
      if (at && at.pick < pk.pick) continue;
      const f = positionFit(p, def.pos, scale);
      if (!alt || f > alt.fit || (f === alt.fit && p.id < alt.id)) alt = { id: p.id, fit: f };
    }
    if (!alt) continue;
    const gap = alt.fit - fit;
    if (gap < MISSED_GAP || (best && gap <= best.gap)) continue;
    const later = takenAt.get(alt.id);
    best = {
      pick: pk.pick,
      pokemonId: pk.pokemonId,
      fit: Math.round(fit),
      pos: def.pos,
      altId: alt.id,
      altFit: Math.round(alt.fit),
      ...(later ? { takenBy: { teamId: later.teamId, pick: later.pick } } : {}),
      gap,
    };
  }
  if (!best) return null;
  const { gap: _gap, ...out } = best;
  return out;
}

/** Ab so vielen Saisontoren ist ein später Pick ein „Joker des Drafts“ */
export const JOKER_MIN_GOALS = 3;

/**
 * Joker des Drafts: der Pick aus dem letzten Drittel des Drafts, der in der Saison die meisten Tore für sein Team
 * schoss (ab JOKER_MIN_GOALS; bei Gleichstand der spätere Pick). team = Index in league.teams.
 */
export function draftJoker(
  picks: readonly { pick: number; team: number; pokemonId: number }[],
  matches: LeagueResult['matches'],
): { pick: number; team: number; pokemonId: number; goals: number } | null {
  if (!picks.length) return null;
  const goals = new Map<string, number>();
  for (const m of matches)
    for (const [team, list] of [[m.home, m.homeScorers], [m.away, m.awayScorers]] as const)
      for (const g of list) goals.set(`${team}:${g.pokemonId}`, (goals.get(`${team}:${g.pokemonId}`) ?? 0) + 1);
  const from = Math.ceil((picks.length * 2) / 3);
  let best: { pick: number; team: number; pokemonId: number; goals: number } | null = null;
  for (const pk of picks) {
    if (pk.pick < from) continue;
    const n = goals.get(`${pk.team}:${pk.pokemonId}`) ?? 0;
    if (n >= JOKER_MIN_GOALS && (!best || n > best.goals || (n === best.goals && pk.pick > best.pick))) best = { ...pk, goals: n };
  }
  return best;
}

/** Seit wie vielen Spieltagen (bis einschließlich `round`) der aktuelle Tabellenführer ununterbrochen vorn steht. */
export function leaderSince(days: readonly Pick<Matchday, 'round' | 'leader'>[], round: number): number {
  const upTo = days.filter((d) => d.round <= round);
  const team = upTo.at(-1)?.leader.team;
  if (team == null) return 0;
  let n = 0;
  for (let k = upTo.length - 1; k >= 0 && upTo[k].leader.team === team; k--) n++;
  return n;
}

/** Unten wird es eng: so viele Plätze bilden die rote Zone (wie das Saisonziel „nicht auf den letzten 3 Plätzen“) */
export const TABLE_BOTTOM_ZONE = 3;

/**
 * Tabellen-Zone eines Platzes (1-basiert) für die farbige Markierung: 'top' für die ersten `top` Plätze (Meister,
 * in der Karriere die Aufstiegsplätze), 'bottom' für die letzten TABLE_BOTTOM_ZONE – erst ab 6 bzw. TABLE_BOTTOM_MIN Teams.
 */
export function tableZone(place: number, total: number, top = 1): 'top' | 'bottom' | null {
  if (total < 6) return null;
  if (place <= top) return 'top';
  // In kleinen Ligen wären die letzten drei fast die halbe Tabelle – rot erst ab TABLE_BOTTOM_MIN Teams
  if (total >= TABLE_BOTTOM_MIN && place > total - TABLE_BOTTOM_ZONE) return 'bottom';
  return null;
}

/** Ab so vielen Teams gibt es die rote Zone unten */
export const TABLE_BOTTOM_MIN = 10;

/** CSS-Klassen einer Tabellenzeile: eigenes Team und Zone */
export function tableRowClass(isUser: boolean, place: number, total: number, top = 1): string {
  const zone = tableZone(place, total, top);
  return [isUser ? 'is-user' : '', zone ? `is-zone-${zone}` : ''].filter(Boolean).join(' ');
}

/** Elf der Saison: Formation, Pokémon je Slot und das Team (Index) jedes Spielers */
export interface SeasonEleven {
  formation: FormationId;
  slots: number[];
  teamOf: number[];
}

/**
 * Elf der Saison aus allen gedrafteten Teams: in der häufigsten Formation der Liga (bei Gleichstand die
 * zuerst vorkommende) bekommt jeder Slot den Spieler, der bei seinem Team auf genau dieser Position stand
 * und die meisten Scorerpunkte (Tore + Vorlagen) holte – dann nach Positions-Fit, dann kleinere ID.
 * null, wenn ein Slot leer bliebe.
 */
export function seasonEleven(
  league: Pick<LeagueResult, 'matches'>,
  teams: readonly Pick<DraftTeam, 'formation' | 'slots'>[],
  byId: Map<number, Pokemon>,
  scale: Scale,
): SeasonEleven | null {
  if (!teams.length) return null;
  const counts = new Map<FormationId, number>();
  for (const t of teams) counts.set(t.formation, (counts.get(t.formation) ?? 0) + 1);
  const formation = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  // Scorerpunkte je Team und Pokémon
  const points = teams.map(() => new Map<number, number>());
  const add = (team: number, id: number | undefined) => {
    if (id == null || !points[team]) return;
    points[team].set(id, (points[team].get(id) ?? 0) + 1);
  };
  for (const m of league.matches) {
    for (const [team, goals] of [[m.home, m.homeScorers], [m.away, m.awayScorers]] as const) {
      for (const g of goals) {
        add(team, g.pokemonId);
        add(team, g.assist);
      }
    }
  }
  const candidates = teams.flatMap((t, ti) =>
    FORMATIONS[t.formation].slots.flatMap((d, j) => {
      const id = t.slots[j];
      const p = id != null ? byId.get(id) : undefined;
      return p ? [{ id: p.id, team: ti, pos: d.pos, pts: points[ti].get(p.id) ?? 0, fit: positionFit(p, d.pos, scale) }] : [];
    }),
  );
  candidates.sort((a, b) => b.pts - a.pts || b.fit - a.fit || a.id - b.id);
  const used = new Set<number>();
  const slots: number[] = [];
  const teamOf: number[] = [];
  for (const d of FORMATIONS[formation].slots) {
    const c = candidates.find((x) => x.pos === d.pos && !used.has(x.id));
    if (!c) return null;
    used.add(c.id);
    slots.push(c.id);
    teamOf.push(c.team);
  }
  return { formation, slots, teamOf };
}

/** Bilanz eines Teams gegen einen Gegner (aus Sicht des Teams). */
export interface HeadToHead {
  opponent: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  /** Ergebnisse in Spielreihenfolge, eigene Tore zuerst */
  scores: { gf: number; ga: number; home: boolean }[];
}

/** Direkte Duelle eines Teams gegen alle Gegner – in der Reihenfolge der Abschlusstabelle. */
export function headToHead(league: Pick<LeagueResult, 'matches' | 'table'>, team: number): HeadToHead[] {
  const byOpp = new Map<number, HeadToHead>();
  const sorted = [...league.matches].sort((a, b) => a.round - b.round);
  for (const m of sorted) {
    if (m.home !== team && m.away !== team) continue;
    const home = m.home === team;
    const opponent = home ? m.away : m.home;
    const gf = home ? m.hg : m.ag;
    const ga = home ? m.ag : m.hg;
    const h = byOpp.get(opponent) ?? { opponent, w: 0, d: 0, l: 0, gf: 0, ga: 0, scores: [] };
    if (gf > ga) h.w++;
    else if (gf === ga) h.d++;
    else h.l++;
    h.gf += gf;
    h.ga += ga;
    h.scores.push({ gf, ga, home });
    byOpp.set(opponent, h);
  }
  return league.table.flatMap((r) => byOpp.get(r.team) ?? []);
}

/**
 * Aktuelle Serie eines Teams (vom letzten Spiel rückwärts): Spiele ohne Niederlage bzw. ohne Sieg.
 * Liefert die Serie ab `min` Spielen – ungeschlagen hat Vorrang – sonst null.
 */
export function currentRun(matches: readonly Match[], team: number, min = 3): { kind: 'unbeaten' | 'winless'; length: number } | null {
  const res = matches
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => b.round - a.round)
    .map((m) => Math.sign(m.home === team ? m.hg - m.ag : m.ag - m.hg));
  const run = (ok: (r: number) => boolean) => {
    let n = 0;
    while (n < res.length && ok(res[n])) n++;
    return n;
  };
  const unbeaten = run((r) => r >= 0);
  if (unbeaten >= min) return { kind: 'unbeaten', length: unbeaten };
  const winless = run((r) => r <= 0);
  return winless >= min ? { kind: 'winless', length: winless } : null;
}

/**
 * Formkurve: die letzten n Ergebnisse eines Teams bis einschließlich Spieltag upTo, ältestes zuerst
 * ('S' Sieg, 'U' Unentschieden, 'N' Niederlage).
 */
export function recentForm(matches: readonly Match[], team: number, upTo: number, n = 5): ('S' | 'U' | 'N')[] {
  const own = matches
    .filter((m) => m.round <= upTo && (m.home === team || m.away === team))
    .sort((a, b) => a.round - b.round);
  return own.slice(-n).map((m) => {
    const gf = m.home === team ? m.hg : m.ag;
    const ga = m.home === team ? m.ag : m.hg;
    return gf > ga ? 'S' : gf < ga ? 'N' : 'U';
  });
}

/** Längste Siegesserie der Saison: Team (Index), Länge und Spieltage – null ohne Sieg. */
export interface WinStreak {
  team: number;
  length: number;
  from: number;
  to: number;
}

/** Längste Serie aufeinanderfolgender Siege eines Teams (bei Gleichstand die zuerst erreichte). */
export function longestWinStreak(league: Pick<LeagueResult, 'matches' | 'teams'>): WinStreak | null {
  let best: WinStreak | null = null;
  for (let team = 0; team < league.teams.length; team++) {
    const own = league.matches.filter((m) => m.home === team || m.away === team).sort((a, b) => a.round - b.round);
    let run = 0;
    let from = 0;
    for (const m of own) {
      const gf = m.home === team ? m.hg : m.ag;
      const ga = m.home === team ? m.ag : m.hg;
      if (gf > ga) {
        if (run === 0) from = m.round;
        run++;
        if (!best || run > best.length || (run === best.length && m.round < best.to)) best = { team, length: run, from, to: m.round };
      } else run = 0;
    }
  }
  return best;
}

/** Ab so vielen Spielen ohne Gegentor gibt es den Saisonrekord „Weiße Weste“ */
export const CLEAN_SHEET_RECORD_MIN = 3;

/**
 * Meiste Spiele ohne Gegentor (Saisonrekord „Weiße Weste“): `order` = Teams in Tabellenreihenfolge
 * (bei Gleichstand gewinnt das besser platzierte). null unter CLEAN_SHEET_RECORD_MIN.
 */
export function mostCleanSheets(matches: readonly Pick<Match, 'home' | 'away' | 'hg' | 'ag'>[], order: readonly number[]): { team: number; n: number } | null {
  const count = new Map<number, number>();
  for (const m of matches) {
    if (m.ag === 0) count.set(m.home, (count.get(m.home) ?? 0) + 1);
    if (m.hg === 0) count.set(m.away, (count.get(m.away) ?? 0) + 1);
  }
  let best: { team: number; n: number } | null = null;
  for (const team of order) {
    const n = count.get(team) ?? 0;
    if (!best || n > best.n) best = { team, n };
  }
  return best && best.n >= CLEAN_SHEET_RECORD_MIN ? best : null;
}

/** Höchster Sieg der Saison (größte Tordifferenz, dann mehr Tore, dann früherer Spieltag) – null ohne Sieg. */
export function biggestWin(matches: readonly Match[]): Match | null {
  let best: Match | null = null;
  for (const m of matches) {
    const diff = Math.abs(m.hg - m.ag);
    if (!diff) continue;
    const bd = best ? Math.abs(best.hg - best.ag) : -1;
    if (!best || diff > bd || (diff === bd && (m.hg + m.ag > best.hg + best.ag || (m.hg + m.ag === best.hg + best.ag && m.round < best.round)))) {
      best = m;
    }
  }
  return best;
}

/** Ein Hattrick: mindestens drei Tore desselben Pokémon in einem Spiel */
export interface HatTrick {
  round: number;
  team: number;
  pokemonId: number;
  goals: number;
}

/** Alle Hattricks der Saison, nach Spieltag (dann Heim vor Gast) – Grundlage des Saisonrekords „Hattricks“. */
export function hatTricks(matches: readonly Pick<Match, 'round' | 'home' | 'away' | 'homeScorers' | 'awayScorers'>[]): HatTrick[] {
  const out: HatTrick[] = [];
  for (const m of [...matches].sort((a, b) => a.round - b.round)) {
    for (const [team, scorers] of [[m.home, m.homeScorers], [m.away, m.awayScorers]] as const) {
      const count = new Map<number, number>();
      for (const g of scorers ?? []) count.set(g.pokemonId, (count.get(g.pokemonId) ?? 0) + 1);
      for (const [pokemonId, goals] of count) if (goals >= 3) out.push({ round: m.round, team, pokemonId, goals });
    }
  }
  return out;
}

/** Torreichstes Spiel der Saison (meiste Tore, dann früherer Spieltag) – null unter 5 Toren. */
export function goalFest(matches: readonly Match[]): Match | null {
  let best: Match | null = null;
  for (const m of matches) if (!best || m.hg + m.ag > best.hg + best.ag || (m.hg + m.ag === best.hg + best.ag && m.round < best.round)) best = m;
  return best && best.hg + best.ag >= 5 ? best : null;
}

/** Überraschung eines Spieltags: Sieg des Außenseiters mit dem größten Rating-Rückstand. */
export interface Upset {
  match: Match;
  winner: number;
  loser: number;
  /** Rating-Rückstand des Siegers */
  gap: number;
}

/** Last-Minute-Sieg: Spiel, in dem der Sieger erst spät (ab LATE_WINNER_MINUTE) beim Gleichstand das Siegtor schoss. */
export interface LateWinner {
  match: Match;
  winner: number;
  loser: number;
  minute: number;
}

/** Ab dieser Minute zählt ein Siegtor als „Last Minute“ */
export const LATE_WINNER_MINUTE = 85;

/**
 * Spätestes Siegtor unter den Spielen: Tor des späteren Siegers aus einem Unentschieden heraus, nach dem er nicht
 * mehr eingeholt wurde, ab LATE_WINNER_MINUTE. Bei Gleichstand der Minute das erste Spiel. Nur Spiele, deren Tore
 * alle mit Minute erfasst sind.
 */
export function lateWinner(matches: readonly Match[]): LateWinner | null {
  let best: LateWinner | null = null;
  for (const m of matches) {
    if (m.hg === m.ag) continue;
    const homeWon = m.hg > m.ag;
    const goals = [
      ...m.homeScorers.map((g) => ({ home: true, minute: g.minute })),
      ...m.awayScorers.map((g) => ({ home: false, minute: g.minute })),
    ];
    // Nur vollständig erfasste Spiele (Auffüllteams haben keine Torschützen – die Reihenfolge wäre unklar)
    if (goals.length !== m.hg + m.ag || goals.some((g) => g.minute == null)) continue;
    goals.sort((a, b) => a.minute! - b.minute!);
    // Letzte Führungsübernahme des Siegers aus dem Gleichstand
    let h = 0;
    let a = 0;
    let decisive: number | null = null;
    for (const g of goals) {
      const level = h === a;
      if (g.home) h++;
      else a++;
      if (level && g.home === homeWon) decisive = g.minute!;
    }
    if (decisive == null || decisive < LATE_WINNER_MINUTE) continue;
    if (!best || decisive > best.minute) {
      best = { match: m, winner: homeWon ? m.home : m.away, loser: homeWon ? m.away : m.home, minute: decisive };
    }
  }
  return best;
}

/** Mindestrückstand für ein Comeback */
export const COMEBACK_DEFICIT = 2;

export interface Comeback {
  match: Match;
  winner: number;
  loser: number;
  /** Größter Rückstand des Siegers: Tore des Siegers und des Gegners in diesem Moment */
  behind: [number, number];
}

/**
 * Comeback unter den Spielen: Sieg nach mindestens COMEBACK_DEFICIT Toren Rückstand – der größte Rückstand,
 * bei Gleichstand das erste Spiel. Nur vollständig erfasste Spiele (Tore mit Minuten); null ohne.
 */
export function comebackOf(matches: readonly Match[]): Comeback | null {
  let best: Comeback | null = null;
  for (const m of matches) {
    if (m.hg === m.ag) continue;
    const homeWon = m.hg > m.ag;
    const goals = [
      ...m.homeScorers.map((g) => ({ home: true, minute: g.minute })),
      ...m.awayScorers.map((g) => ({ home: false, minute: g.minute })),
    ];
    if (goals.length !== m.hg + m.ag || goals.some((g) => g.minute == null)) continue;
    goals.sort((a, b) => a.minute! - b.minute!);
    let w = 0;
    let l = 0;
    let behind: [number, number] = [0, 0];
    for (const g of goals) {
      if (g.home === homeWon) w++;
      else l++;
      if (l - w > behind[1] - behind[0]) behind = [w, l];
    }
    const deficit = behind[1] - behind[0];
    if (deficit < COMEBACK_DEFICIT) continue;
    if (!best || deficit > best.behind[1] - best.behind[0]) {
      best = { match: m, winner: homeWon ? m.home : m.away, loser: homeWon ? m.away : m.home, behind };
    }
  }
  return best;
}

/** Mindestabstand für einen Kantersieg */
export const ROUT_MARGIN = 4;

/** Höchster Sieg unter den Spielen (mindestens ROUT_MARGIN Tore Abstand, bei Gleichstand mehr Tore des Siegers, dann das erste) – null ohne. */
export function routOf(matches: readonly Match[]): { match: Match; winner: number; loser: number } | null {
  let best: { match: Match; winner: number; loser: number } | null = null;
  let bestMargin = 0;
  let bestGoals = 0;
  for (const m of matches) {
    const margin = Math.abs(m.hg - m.ag);
    if (margin < ROUT_MARGIN) continue;
    const goals = Math.max(m.hg, m.ag);
    if (margin > bestMargin || (margin === bestMargin && goals > bestGoals)) {
      const homeWon = m.hg > m.ag;
      best = { match: m, winner: homeWon ? m.home : m.away, loser: homeWon ? m.away : m.home };
      bestMargin = margin;
      bestGoals = goals;
    }
  }
  return best;
}

/** Größte Überraschung unter den Spielen (Rückstand mindestens minGap) – null ohne. */
export function biggestUpset(matches: readonly Match[], ratings: readonly number[], minGap = 100): Upset | null {
  let best: Upset | null = null;
  for (const m of matches) {
    if (m.hg === m.ag) continue;
    const winner = m.hg > m.ag ? m.home : m.away;
    const loser = winner === m.home ? m.away : m.home;
    const gap = (ratings[loser] ?? 0) - (ratings[winner] ?? 0);
    if (gap >= minGap && (!best || gap > best.gap)) best = { match: m, winner, loser, gap };
  }
  return best;
}

/** Schnellster Picker: Team mit der kürzesten durchschnittlichen Bedenkzeit (ms) seiner eigenen Picks. */
export interface FastestPicker {
  teamId: string;
  avgMs: number;
  picks: number;
}

/**
 * Bedenkzeit = Abstand zum vorigen Pick (der erste Pick zählt nicht). Automatische Picks
 * (CPU, Timer, Auto-Pick) bleiben draußen; ein Team braucht mindestens minPicks eigene Picks.
 */
export function fastestPicker(
  picks: readonly Pick<DraftPickLog, 'pick' | 'teamId' | 'auto' | 'at'>[],
  minPicks = 3,
): FastestPicker | null {
  const sorted = [...picks].sort((a, b) => a.pick - b.pick);
  const sum = new Map<string, { ms: number; n: number }>();
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.auto) continue;
    const ms = p.at - sorted[i - 1].at;
    if (!(ms >= 0)) continue;
    const cur = sum.get(p.teamId) ?? { ms: 0, n: 0 };
    cur.ms += ms;
    cur.n++;
    sum.set(p.teamId, cur);
  }
  let best: FastestPicker | null = null;
  for (const [teamId, { ms, n }] of sum) {
    if (n < minPicks) continue;
    const avgMs = ms / n;
    if (!best || avgMs < best.avgMs) best = { teamId, avgMs, picks: n };
  }
  return best;
}
