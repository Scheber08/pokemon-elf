/**
 * KO-Turnier des Online-Drafts: 16 Teams im Baum (gesetzt nach Team-Score: 1–16, 8–9, …),
 * je Runde ein Spiel, das Endspiel auf neutralem Platz. Unentschieden → Elfmeterschießen.
 * Optional vorher eine Gruppenphase: 4 Gruppen à 4 (Lostöpfe nach Team-Score), Hin- und
 * Rückspiel, die ersten zwei ins Viertelfinale (A1–B2, C1–D2 | B1–A2, D1–C2).
 * Das Ergebnis ist ein LeagueResult (alle Spiele, round = Spieltag) plus cup (Baum) – die
 * „Tabelle" ist das Endklassement: Sieger, Finalist, Halbfinalisten, … (innerhalb einer Runde
 * nach Punkten, Tordifferenz, Toren wie buildTable). Deterministisch aus dem Rng.
 */
import { shuffle, type Rng } from './rng';
import { buildTable, playMatch, roundRobin, type LeagueResult, type LeagueTeam, type Match, type TableRow } from './season';

export type CupStage = 'r16' | 'qf' | 'sf' | 'final';

/** Ein KO-Spiel: Sieger (Index in teams), bei Unentschieden mit Elfmeterschießen */
export interface CupTie {
  home: number;
  away: number;
  winner: number;
  /** Elfmeterschießen (nur nach Unentschieden) */
  pens: { home: number; away: number } | null;
}

export interface CupRound {
  stage: CupStage;
  /** Spieltag (wie Match.round) */
  round: number;
  /** Paarungen in Baum-Reihenfolge: Sieger von 2i und 2i+1 treffen in der nächsten Runde aufeinander */
  ties: CupTie[];
}

export interface CupInfo {
  /** Gruppen (Team-Indizes) – null ohne Gruppenphase */
  groups: number[][] | null;
  rounds: CupRound[];
}

export interface CupResult extends LeagueResult {
  cup: CupInfo;
}

/** Teams im KO-Turnier */
export const CUP_SIZE = 16;

/** Runde nach Zahl der verbliebenen Teams */
const STAGE_BY_TEAMS: Record<number, CupStage> = { 16: 'r16', 8: 'qf', 4: 'sf', 2: 'final' };

/** Setzplätze im Baum (1 = bestes Team): 1–16 und 2–15 treffen frühestens im Finale aufeinander */
const BRACKET_16 = [1, 16, 8, 9, 5, 12, 4, 13, 3, 14, 6, 11, 7, 10, 2, 15];

/** Team-Indizes nach Team-Score absteigend (gleich: kleinerer Index zuerst). */
export function seedOrder(teams: readonly LeagueTeam[]): number[] {
  return teams.map((_, i) => i).sort((a, b) => teams[b].rating - teams[a].rating || a - b);
}

/**
 * Elfmeterschießen: je fünf Schützen, dann Sudden Death. Trefferquote 75 %, das stärkere Team
 * leicht im Vorteil (höchstens ±5 Prozentpunkte). Endet sicher (nach 30 Runden Sudden Death
 * gewinnt das Heimteam).
 */
export function penaltyShootout(rng: Rng, home: LeagueTeam, away: LeagueTeam): { home: number; away: number } {
  const bias = Math.max(-0.05, Math.min(0.05, (home.rating - away.rating) / 2000));
  const pHome = 0.75 + bias;
  const pAway = 0.75 - bias;
  let h = 0;
  let a = 0;
  for (let k = 0; k < 5; k++) {
    if (rng() < pHome) h++;
    // Nicht mehr einzuholen? (Heim hat noch 4 − k Schüsse, Gast noch 5 − k)
    if (h > a + (5 - k) || a > h + (4 - k)) break;
    if (rng() < pAway) a++;
    if (h > a + (4 - k) || a > h + (4 - k)) break;
  }
  for (let k = 0; h === a && k < 30; k++) {
    if (rng() < pHome) h++;
    if (rng() < pAway) a++;
  }
  if (h === a) h++;
  return { home: h, away: a };
}

/** Ein KO-Spiel samt Elfmeterschießen. */
function playTie(rng: Rng, teams: readonly LeagueTeam[], round: number, home: number, away: number, neutral: boolean) {
  const match = playMatch(rng, teams, round, home, away, neutral);
  let pens: CupTie['pens'] = null;
  let winner = match.hg > match.ag ? home : away;
  if (match.hg === match.ag) {
    pens = penaltyShootout(rng, teams[home], teams[away]);
    winner = pens.home > pens.away ? home : away;
  }
  return { match, tie: { home, away, winner, pens } satisfies CupTie };
}

/**
 * KO-Runden ab den gegebenen Teams (Baum-Reihenfolge, Länge 2^k) bis zum Finale.
 * Liefert Spiele, Runden und je Team die Runde, in der es ausschied (Sieger: 'winner').
 */
function playKnockout(rng: Rng, teams: readonly LeagueTeam[], bracket: number[], firstRound: number) {
  const matches: Match[] = [];
  const rounds: CupRound[] = [];
  const out = new Map<number, CupStage | 'winner'>();
  let alive = bracket;
  let round = firstRound;
  while (alive.length > 1) {
    const stage = STAGE_BY_TEAMS[alive.length] ?? 'r16';
    const ties: CupTie[] = [];
    const next: number[] = [];
    for (let i = 0; i + 1 < alive.length; i += 2) {
      const r = playTie(rng, teams, round, alive[i], alive[i + 1], stage === 'final');
      matches.push(r.match);
      ties.push(r.tie);
      next.push(r.tie.winner);
      out.set(r.tie.winner === r.tie.home ? r.tie.away : r.tie.home, stage);
    }
    rounds.push({ stage, round, ties });
    alive = next;
    round++;
  }
  if (alive.length === 1) out.set(alive[0], 'winner');
  return { matches, rounds, out };
}

/** Rangstufe im Endklassement (kleiner = besser); Gruppendritte 5, Gruppenvierte 6 */
const LEVEL: Record<CupStage | 'winner', number> = { winner: 0, final: 1, sf: 2, qf: 3, r16: 4 };

/** Zahl und Größe der Gruppen */
const GROUPS = 4;
const GROUP_SIZE = 4;

/** Tabelle einer Gruppe (Reihenfolge wie buildTable) aus deren Spielen bis einschließlich upTo. */
export function groupTable(teams: readonly LeagueTeam[], matches: readonly Match[], members: readonly number[], upTo = Infinity): TableRow[] {
  const inGroup = matches.filter((m) => m.round <= upTo && members.includes(m.home) && members.includes(m.away));
  return buildTable([...teams], inGroup).filter((r) => members.includes(r.team));
}

/**
 * Endklassement: nach erreichter Runde, innerhalb einer Stufe wie buildTable (Punkte aus allen
 * Spielen, Tordifferenz, Tore, Team-Score, Name). level: Rangstufe je Team (fehlt = ganz hinten).
 */
export function cupStandings(teams: readonly LeagueTeam[], matches: readonly Match[], level: (team: number) => number) {
  const table = buildTable([...teams], [...matches]);
  return table
    .map((row, i) => ({ row, i, lv: level(row.team) }))
    .sort((a, b) => a.lv - b.lv || a.i - b.i)
    .map((x) => x.row);
}

/** Simuliert das KO-Turnier (genau CUP_SIZE Teams), optional mit Gruppenphase. */
export function simulateCup(teams: LeagueTeam[], rng: Rng, opts: { groups?: boolean } = {}): CupResult {
  if (teams.length !== CUP_SIZE) throw new Error(`KO-Turnier braucht ${CUP_SIZE} Teams`);
  const order = seedOrder(teams);
  if (!opts.groups) {
    const bracket = BRACKET_16.map((seed) => order[seed - 1]);
    const ko = playKnockout(rng, teams, bracket, 1);
    const table = cupStandings(teams, ko.matches, (t) => LEVEL[ko.out.get(t) ?? 'r16']);
    return { teams, matches: ko.matches, table, cup: { groups: null, rounds: ko.rounds } };
  }

  // Lostöpfe: die vier stärksten Teams in Topf 1 usw. – je Gruppe eines aus jedem Topf
  const pots = Array.from({ length: GROUP_SIZE }, (_, k) => shuffle(rng, order.slice(k * GROUPS, (k + 1) * GROUPS)));
  const groups = Array.from({ length: GROUPS }, (_, g) => pots.map((pot) => pot[g]));
  const schedule = roundRobin(GROUP_SIZE);
  const matches: Match[] = [];
  schedule.forEach((pairs, r) => {
    for (const members of groups) {
      for (const [h, a] of pairs) matches.push(playMatch(rng, teams, r + 1, members[h], members[a]));
    }
  });
  const tables = groups.map((members) => groupTable(teams, matches, members));
  const [a, b, c, d] = tables.map((tb) => tb.map((row) => row.team));
  const bracket = [a[0], b[1], c[0], d[1], b[0], a[1], d[0], c[1]];
  const ko = playKnockout(rng, teams, bracket, schedule.length + 1);
  const groupPlace = new Map<number, number>();
  tables.forEach((tb) => tb.forEach((row, i) => groupPlace.set(row.team, i)));
  const all = [...matches, ...ko.matches];
  const table = cupStandings(teams, all, (t) => {
    const stage = ko.out.get(t);
    return stage ? LEVEL[stage] : 3 + (groupPlace.get(t) ?? 3);
  });
  return { teams, matches: all, table, cup: { groups, rounds: ko.rounds } };
}

/** Sieger des Turniers (Finale) – null ohne Finale. */
export function cupWinner(cup: CupInfo): number | null {
  const final = cup.rounds.find((r) => r.stage === 'final');
  return final?.ties[0]?.winner ?? null;
}

/** Runde eines Spieltags ('group' in der Gruppenphase) – null, wenn es den Spieltag nicht gibt. */
export function cupStageOf(cup: CupInfo, round: number): CupStage | 'group' | null {
  const ko = cup.rounds.find((r) => r.round === round);
  if (ko) return ko.stage;
  const first = cup.rounds[0]?.round ?? 1;
  return cup.groups && round >= 1 && round < first ? 'group' : null;
}

/** Elfmeterschießen eines Spiels (über die Paarung) – null ohne. */
export function cupPens(cup: CupInfo, m: Pick<Match, 'round' | 'home' | 'away'>): CupTie['pens'] {
  const r = cup.rounds.find((x) => x.round === m.round);
  return r?.ties.find((x) => x.home === m.home && x.away === m.away)?.pens ?? null;
}

/**
 * Wo ein Team im Turnier steht bzw. ausschied: 'winner', die Runde seines Ausscheidens –
 * oder null (gar nicht dabei). upTo: nur Spieltage bis einschließlich dieses zählen
 * (für den Ticker); 'alive' = noch im Rennen.
 */
export function cupStatus(cup: CupInfo, team: number, upTo = Infinity): CupStage | 'group' | 'winner' | 'alive' | null {
  const inCup = cup.groups ? cup.groups.some((g) => g.includes(team)) : !!cup.rounds[0]?.ties.some((x) => x.home === team || x.away === team);
  if (!inCup) return null;
  // Gruppenphase vorbei und nicht im KO-Baum → in der Gruppe ausgeschieden
  const firstKo = cup.rounds[0];
  if (cup.groups && firstKo && upTo >= firstKo.round - 1 && !firstKo.ties.some((x) => x.home === team || x.away === team)) {
    return 'group';
  }
  for (const r of cup.rounds) {
    if (r.round > upTo) break;
    const tie = r.ties.find((x) => x.home === team || x.away === team);
    if (!tie) continue;
    if (tie.winner !== team) return r.stage;
    if (r.stage === 'final') return 'winner';
  }
  return 'alive';
}

const STAGES: readonly CupStage[] = ['r16', 'qf', 'sf', 'final'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIdx = (v: unknown, n: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
const isGoals = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Gespeicherter Turnierbaum (Schnappschuss) – null, wenn er nicht passt (n = Zahl der Teams). */
export function storedCup(raw: unknown, n: number): CupInfo | null {
  if (!isObj(raw) || !Array.isArray(raw.rounds)) return null;
  let groups: number[][] | null = null;
  if (raw.groups != null) {
    if (!Array.isArray(raw.groups)) return null;
    groups = [];
    for (const g of raw.groups) {
      if (!Array.isArray(g) || !g.every((t) => isIdx(t, n))) return null;
      groups.push([...g]);
    }
  }
  const rounds: CupRound[] = [];
  for (const r of raw.rounds) {
    if (!isObj(r) || !STAGES.includes(r.stage as CupStage) || !Number.isInteger(r.round) || !Array.isArray(r.ties)) return null;
    const ties: CupTie[] = [];
    for (const x of r.ties) {
      if (!isObj(x) || !isIdx(x.home, n) || !isIdx(x.away, n) || (x.winner !== x.home && x.winner !== x.away)) return null;
      let pens: CupTie['pens'] = null;
      if (x.pens != null) {
        if (!isObj(x.pens) || !isGoals(x.pens.home) || !isGoals(x.pens.away)) return null;
        pens = { home: x.pens.home, away: x.pens.away };
      }
      ties.push({ home: x.home, away: x.away, winner: x.winner as number, pens });
    }
    rounds.push({ stage: r.stage as CupStage, round: r.round as number, ties });
  }
  return { groups, rounds };
}
