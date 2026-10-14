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
import { messages } from '../i18n';
import type { Pokemon, PosCode } from '../types';
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
  /** Eigenes Team mit Platz – null für Zuschauer */
  own: { name: string; place: number } | null;
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
  if (i.cup) {
    const c = messages().draft.cup;
    const own = i.own && i.cup.ownStatus ? c.shareOwn(i.own.name, i.cup.ownStatus) : '';
    return [c.shareLine(i.code, i.championName, i.cup.final ?? null) + own, i.url].join('\n');
  }
  const tx = messages().draft.share;
  const tie = i.tieNote ? ` – ${i.tieNote.charAt(0).toLowerCase()}${i.tieNote.slice(1)}` : '';
  return [
    tx.line(i.code, i.championName, i.championPts, tie) + (i.own ? tx.own(i.own.name, i.own.place) : ''),
    i.url,
  ].join('\n');
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

/** Überraschung eines Spieltags: Sieg des Außenseiters mit dem größten Rating-Rückstand. */
export interface Upset {
  match: Match;
  winner: number;
  loser: number;
  /** Rating-Rückstand des Siegers */
  gap: number;
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
