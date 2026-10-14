/**
 * Saison-Simulation: 18 Teams, jeder gegen jeden mit Hin- und Rückrunde (34 Spieltage).
 * Tore pro Spiel sind Poisson-verteilt:
 *   λ_eigen  = 1,4 · exp((Score − Gegner) / 250) + Heimvorteil 0,15
 *   λ_gegner = 1,4 · exp((Gegner − Score) / 250) (+ Heimvorteil, wenn der Gegner zu Hause spielt)
 */
import { CLUB_NAMES, GOAL_THREAT, SEASON } from '../config/season';
import type { PosCode, Record3 } from '../types';
import type { CupInfo } from './cup';
import { createRng, gaussian, poisson, shuffle, weightedIndex, type Rng } from './rng';

export interface SquadPlayer {
  pokemonId: number;
  pos: PosCode;
  atk: number;
  spa: number;
}

export interface LeagueTeam {
  name: string;
  rating: number;
  /** Online-Draft: aufgefülltes Team eines echten Spielers aus der Rangliste (Spielername) */
  player?: string;
  isUser?: boolean;
  /** Spieler für die Torschützenliste (optional) */
  squad?: SquadPlayer[];
  /** Standardschütze (optional) */
  setPieceTaker?: SquadPlayer | null;
  /** Fit des Standardschützen 0–100 (optional) */
  setPieceFit?: number;
}

export interface Goal {
  pokemonId: number;
  pos: PosCode;
  /** Spielminute (1–90, 91–95 = Nachspielzeit 90+1 … 90+5) – nur im Online-Draft (DRAFT_MODEL) */
  minute?: number;
}

export interface Match {
  round: number;
  home: number;
  away: number;
  hg: number;
  ag: number;
  homeScorers: Goal[];
  awayScorers: Goal[];
}

export interface TableRow {
  team: number;
  name: string;
  rating: number;
  isUser: boolean;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

export interface LeagueResult {
  teams: LeagueTeam[];
  matches: Match[];
  /** Liga: Tabelle; KO-Turnier: Endklassement (Sieger zuerst) */
  table: TableRow[];
  /** Nur KO-Turnier (Online-Draft): Gruppen und KO-Baum – siehe src/lib/cup.ts */
  cup?: CupInfo;
}

export interface Scorer {
  pokemonId: number;
  pos: PosCode;
  goals: number;
}

export interface UserMatch {
  round: number;
  opponent: string;
  opponentRating: number;
  isHome: boolean;
  gf: number;
  ga: number;
  outcome: 'S' | 'U' | 'N';
  scorers: Goal[];
}

export interface SeasonResult {
  seed: number;
  userScore: number;
  league: LeagueResult;
  userMatches: UserMatch[];
  record: Record3;
  points: number;
  position: number;
  goalsFor: number;
  goalsAgainst: number;
  scorers: Scorer[];
  perfect: boolean;
}

/** Erwartete Tore einer Mannschaft gegen einen Gegner (ohne Zufallsstreuung). */
export function expectedGoals(own: number, opp: number, home: boolean): number {
  const lambda = SEASON.baseGoals * Math.exp((own - opp) / SEASON.divisor) + (home ? SEASON.homeAdvantage : 0);
  return Math.min(SEASON.maxLambda, Math.max(SEASON.minLambda, lambda));
}

/**
 * Spielmodell: wie aus Ratings erwartete Tore werden. CLASSIC_MODEL ist das der Challenges (der
 * Server rechnet gewertete Runs damit nach – nie ändern); DRAFT_MODEL nutzt der Online-Draft.
 */
export interface MatchModel {
  /** λ = base · exp(Unterschied / divisor) */
  divisor: number;
  /** Weiche Deckelung des Rating-Unterschieds: cap · tanh(Unterschied / cap) – null = keine */
  softCap: number | null;
  maxLambda: number;
  /** Zufallsstreuung je Spiel: λ · exp(N(0, jitter)) */
  jitter: number;
  /**
   * Tagesform je Team (in Rating-Punkten), von Spieltag zu Spieltag: f = keep · f + Rauschen –
   * auf Dauer mit Standardabweichung sd, dazwischen Serien. null = keine.
   */
  form: { sd: number; keep: number } | null;
  /** Jedes Tor bekommt eine Spielminute (Goal.minute) */
  minutes: boolean;
}

export const CLASSIC_MODEL: MatchModel = {
  divisor: SEASON.divisor,
  softCap: null,
  maxLambda: SEASON.maxLambda,
  jitter: SEASON.jitter,
  form: null,
  minutes: false,
};

/**
 * Online-Draft: große Unterschiede weich gedeckelt (eher 3:0 als 8:0), etwas mehr Streuung und
 * eine Tagesform, die über mehrere Spieltage trägt (Serien, Formkrisen).
 */
export const DRAFT_MODEL: MatchModel = {
  divisor: 330,
  softCap: 320,
  maxLambda: 4.2,
  jitter: 0.15,
  form: { sd: 35, keep: 0.8 },
  minutes: true,
};

/**
 * Spielminuten für die Tore eines Teams (aufsteigend): gleichmäßig über 90 Minuten, ein kleiner
 * Teil in der Nachspielzeit (91–95 = 90+1 … 90+5).
 */
export function goalMinutes(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(rng() < 0.06 ? 91 + Math.floor(rng() * 5) : 1 + Math.floor(rng() * 90));
  return out.sort((a, b) => a - b);
}

/** Minute als Text: „23'", „90+2'" */
export function formatMinute(minute: number): string {
  return minute > 90 ? `90+${minute - 90}'` : `${minute}'`;
}

function lambdaWithJitter(rng: Rng, own: number, opp: number, home: boolean, bonus = 0, model: MatchModel = CLASSIC_MODEL): number {
  const jitter = Math.exp(gaussian(rng) * model.jitter);
  const raw = own - opp;
  const diff = model.softCap ? model.softCap * Math.tanh(raw / model.softCap) : raw;
  const lambda = SEASON.baseGoals * Math.exp(diff / model.divisor) * jitter + (home ? SEASON.homeAdvantage : 0) + bonus;
  return Math.min(model.maxLambda, Math.max(SEASON.minLambda, lambda));
}

/** Tagesform aller Teams für den nächsten Spieltag (neues Array) – ohne Modell-Form unverändert. */
export function nextForm(rng: Rng, form: readonly number[], model: MatchModel): number[] {
  if (!model.form) return [...form];
  const { sd, keep } = model.form;
  const noise = sd * Math.sqrt(1 - keep * keep);
  return form.map((f) => keep * f + gaussian(rng) * noise);
}

/** Gleichmäßig verteilte Gegner-Ratings von min bis max. */
export function opponentRatings(count = SEASON.opponents, min = SEASON.minRating, max = SEASON.maxRating): number[] {
  if (count === 1) return [Math.round((min + max) / 2)];
  return Array.from({ length: count }, (_, i) => Math.round(min + ((max - min) * i) / (count - 1)));
}

/**
 * Spielplan nach dem Rundenturnier-(Kreis-)Verfahren.
 * Liefert 2·(n−1) Spieltage; die Rückrunde spiegelt die Hinrunde mit getauschtem Heimrecht.
 * Team 0 spielt abwechselnd zu Hause und auswärts.
 */
export function roundRobin(n: number): [number, number][][] {
  const ids = Array.from({ length: n }, (_, i) => i);
  if (n % 2 === 1) ids.push(-1); // spielfrei
  const m = ids.length;
  const first: [number, number][][] = [];
  let arr = ids.slice();
  for (let r = 0; r < m - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a < 0 || b < 0) continue;
      const swap = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      round.push(swap ? [b, a] : [a, b]);
    }
    first.push(round);
    arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
  }
  const second = first.map((round) => round.map(([h, a]) => [a, h] as [number, number]));
  return [...first, ...second];
}

function threat(p: SquadPlayer): number {
  return GOAL_THREAT[p.pos] * (0.4 + p.atk / 255 + (0.6 * p.spa) / 255);
}

function pickScorers(rng: Rng, team: LeagueTeam, goals: number): Goal[] {
  const squad = team.squad;
  if (!squad?.length || goals <= 0) return [];
  const weights = squad.map(threat);
  const out: Goal[] = [];
  for (let g = 0; g < goals; g++) {
    if (team.setPieceTaker && rng() < SEASON.setPieceShare) {
      out.push({ pokemonId: team.setPieceTaker.pokemonId, pos: 'SS' });
      continue;
    }
    const p = squad[weightedIndex(rng, weights)];
    out.push({ pokemonId: p.pokemonId, pos: p.pos });
  }
  return out;
}

function setPieceBonus(team: LeagueTeam): number {
  if (!team.setPieceTaker || team.setPieceFit == null) return 0;
  return SEASON.setPieceBonus * (team.setPieceFit / 50 - 1);
}

/**
 * Ein Spiel: Tore Poisson-verteilt (mit Streuung), dann die Torschützen. neutral = ohne
 * Heimvorteil (z. B. ein Endspiel).
 */
export function playMatch(
  rng: Rng,
  teams: readonly LeagueTeam[],
  round: number,
  home: number,
  away: number,
  neutral = false,
  model: MatchModel = CLASSIC_MODEL,
  form?: readonly number[],
): Match {
  const th = teams[home];
  const ta = teams[away];
  const rh = th.rating + (form?.[home] ?? 0);
  const ra = ta.rating + (form?.[away] ?? 0);
  const hg = poisson(rng, lambdaWithJitter(rng, rh, ra, !neutral, setPieceBonus(th), model));
  const ag = poisson(rng, lambdaWithJitter(rng, ra, rh, false, setPieceBonus(ta), model));
  const match: Match = {
    round,
    home,
    away,
    hg,
    ag,
    homeScorers: pickScorers(rng, th, hg),
    awayScorers: pickScorers(rng, ta, ag),
  };
  if (model.minutes) {
    // Nur Tore mit Schützen (Teams ohne Kader haben keine) bekommen eine Minute
    const withMinutes = (goals: Goal[]) => {
      const minutes = goalMinutes(rng, goals.length);
      return goals.map((g, i) => ({ ...g, minute: minutes[i] }));
    };
    match.homeScorers = withMinutes(match.homeScorers);
    match.awayScorers = withMinutes(match.awayScorers);
  }
  return match;
}

/** Simuliert eine komplette Liga (jeder gegen jeden, Hin- und Rückrunde). */
export function simulateLeague(teams: LeagueTeam[], rng: Rng, model: MatchModel = CLASSIC_MODEL): LeagueResult {
  const schedule = roundRobin(teams.length);
  const matches: Match[] = [];
  let form: number[] = teams.map(() => 0);
  schedule.forEach((round, r) => {
    form = nextForm(rng, form, model);
    for (const [home, away] of round) matches.push(playMatch(rng, teams, r + 1, home, away, false, model, form));
  });
  return { teams, matches, table: buildTable(teams, matches) };
}

export function buildTable(teams: LeagueTeam[], matches: Match[]): TableRow[] {
  const rows: TableRow[] = teams.map((t, i) => ({
    team: i,
    name: t.name,
    rating: t.rating,
    isUser: !!t.isUser,
    played: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
  }));
  const { win, draw, loss } = SEASON.points;
  for (const m of matches) {
    const h = rows[m.home];
    const a = rows[m.away];
    h.played++;
    a.played++;
    h.gf += m.hg;
    h.ga += m.ag;
    a.gf += m.ag;
    a.ga += m.hg;
    if (m.hg > m.ag) {
      h.w++;
      a.l++;
      h.pts += win;
      a.pts += loss;
    } else if (m.hg < m.ag) {
      a.w++;
      h.l++;
      a.pts += win;
      h.pts += loss;
    } else {
      h.d++;
      a.d++;
      h.pts += draw;
      a.pts += draw;
    }
  }
  for (const r of rows) r.gd = r.gf - r.ga;
  // Völliger Gleichstand: der stärkere Kader (Team-Score) vorn, erst danach der Name
  return rows.sort(
    (x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.rating - x.rating || x.name.localeCompare(y.name, 'de'),
  );
}

export interface SeasonInput {
  teamName: string;
  score: number;
  squad: SquadPlayer[];
  setPieceTaker?: SquadPlayer | null;
  setPieceFit?: number;
  seed: number;
}

/** Simuliert eine 34-Spiele-Saison des eigenen Teams gegen 17 generierte Gegner. */
export function simulateSeason(input: SeasonInput): SeasonResult {
  const rng = createRng(input.seed);
  const names = shuffle(rng, CLUB_NAMES).slice(0, SEASON.opponents);
  const ratings = shuffle(rng, opponentRatings());
  const teams: LeagueTeam[] = [
    {
      name: input.teamName || 'Meine Elf',
      rating: input.score,
      isUser: true,
      squad: input.squad,
      setPieceTaker: input.setPieceTaker ?? null,
      setPieceFit: input.setPieceFit,
    },
    ...names.map((name, i) => ({ name, rating: ratings[i] })),
  ];
  const league = simulateLeague(teams, rng);

  const userMatches: UserMatch[] = league.matches
    .filter((m) => m.home === 0 || m.away === 0)
    .map((m) => {
      const isHome = m.home === 0;
      const opp = teams[isHome ? m.away : m.home];
      const gf = isHome ? m.hg : m.ag;
      const ga = isHome ? m.ag : m.hg;
      return {
        round: m.round,
        opponent: opp.name,
        opponentRating: opp.rating,
        isHome,
        gf,
        ga,
        outcome: gf > ga ? 'S' : gf < ga ? 'N' : 'U',
        scorers: isHome ? m.homeScorers : m.awayScorers,
      };
    });

  const record: Record3 = { w: 0, d: 0, l: 0 };
  let goalsFor = 0;
  let goalsAgainst = 0;
  const tally = new Map<string, Scorer>();
  for (const m of userMatches) {
    if (m.outcome === 'S') record.w++;
    else if (m.outcome === 'U') record.d++;
    else record.l++;
    goalsFor += m.gf;
    goalsAgainst += m.ga;
    for (const g of m.scorers) {
      const key = `${g.pokemonId}:${g.pos}`;
      const s = tally.get(key) ?? { pokemonId: g.pokemonId, pos: g.pos, goals: 0 };
      s.goals++;
      tally.set(key, s);
    }
  }
  const points = record.w * SEASON.points.win + record.d * SEASON.points.draw;
  const position = league.table.findIndex((r) => r.isUser) + 1;
  return {
    seed: input.seed,
    userScore: input.score,
    league,
    userMatches,
    record,
    points,
    position,
    goalsFor,
    goalsAgainst,
    scorers: [...tally.values()].sort((a, b) => b.goals - a.goals),
    perfect: record.w === userMatches.length,
  };
}

/** „31–2–1" */
export function formatRecord(r: Record3): string {
  return `${r.w}–${r.d}–${r.l}`;
}

/** Vergleich zweier Bilanzen: mehr Punkte, dann mehr Siege, dann weniger Niederlagen. */
export function compareRecords(a: Record3, b: Record3): number {
  const pa = a.w * 3 + a.d;
  const pb = b.w * 3 + b.d;
  return pb - pa || b.w - a.w || a.l - b.l;
}
