/**
 * Manager-Saison des Online-Drafts: Nach dem Draft (Elf, Standardschütze, Bank) spielt die Liga
 * eine Hinrunde (17 Spieltage bei 18 Teams) im festen Takt (settings.matchdayMinutes). Vor jedem
 * Spieltag stellt jedes Team seine Elf aus dem Kader auf – Formation, Positionen, Standardschütze.
 *
 * Tagesform: Jedes Pokémon hat je Spieltag eine Form von −2 bis +2 (aus dem geheimen Liga-Seed,
 * vor dem Spieltag sichtbar). Sie verschiebt seinen Positions-Fit um FORM_FIT je Stufe – wer
 * rotiert, holt mehr heraus. Dazu kommt wie in der Liga die Tagesform des Teams (DRAFT_MODEL).
 *
 * Deterministisch: Ergebnis eines Spieltags = f(Liga-Seed, Spieltag, Aufstellungen). Der Server
 * spielt ihn zum Anpfiff (manager.ts wird nur dort aufgerufen, der Client zeigt den Schnappschuss).
 */
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import type { FormationId, Pokemon, PosCode } from '../types';
import { DRAFT_LIMITS, type DraftTeam, type ManagerClaim, type ManagerLineup, type ManagerOffer, type ManagerTransfer } from './api/draftContract';
import { bestEleven } from './bestEleven';
import {
  centerFillRatings,
  DraftError,
  fillTeams,
  leagueRng,
  leagueSeed,
  leagueTeams,
  limitOf,
  LIMIT_KINDS,
  hasKind,
  poolOf,
  draftedIds,
  rosterOf,
  teamOfDevice,
  upgradeSettings,
  type DraftState,
  type FillCandidate,
} from './draftEngine';
import { positionFit, type Scale } from './fit';
import { hashSeed, shuffle } from './rng';
import { CUP_SIZE, playTie, type CupRound, type CupStage, type CupTie } from './cup';
import { buildTable, DRAFT_MODEL, nextForm, playMatch, roundRobin, type LeagueResult, type LeagueTeam, type Match, type SquadPlayer } from './season';
import { captainWeights, teamScoreFromFits } from './teamScore';
import { SHINY_FIT_BONUS, shinyBonus, shinyTeamBoost } from './shiny';

/** Fit-Punkte je Formstufe */
export const FORM_FIT = 5;

/** Formstufen und ihre Häufigkeit (meist 0, selten ±2) */
const FORM_VALUES = [-2, -1, 0, 1, 2] as const;
const FORM_WEIGHTS = [1, 2, 4, 2, 1];

/** Auffüllteam der Manager-Saison mit Kader (bleibt fest, nur im Server-Zustand) */
export interface ManagerFillTeam {
  name: string;
  /** Team-Score ohne Tagesform, schon auf das Niveau der gedrafteten Teams verschoben */
  rating: number;
  player?: string;
  playerEntry?: string;
  squad: { pokemonId: number; pos: PosCode }[];
  ss: number | null;
}

/** Zustand der Manager-Saison (DraftState.manager) */
export interface ManagerState {
  played: number;
  total: number;
  lineups: Record<string, ManagerLineup>;
  /** Tagesform des nächsten Spieltags (Pokémon der gedrafteten Kader; 0 fehlt) */
  form: Record<string, number>;
  fill: ManagerFillTeam[];
  /** Transfer-Wünsche je Team-ID für den nächsten Anpfiff (privat) */
  claims?: Record<string, ManagerClaim>;
  /** Vollzogene Transfers, älteste zuerst */
  transfers?: ManagerTransfer[];
  /** Gespielte Aufstellungen je Spieltag („1", „2", …) und Team-ID – für die 2D-Ansicht */
  playedLineups?: Record<string, Record<string, ManagerPlayedLineup>>;
  /** Offene Tausch-Angebote zwischen gedrafteten Teams */
  offers?: ManagerOffer[];
  /** Nächste Angebots-ID */
  offerSeq?: number;
  /** Ausfälle (Pokémon-ID → bis einschließlich Spieltag `until`): Verletzung oder Rote Karte */
  out?: Record<string, ManagerAbsence>;
  /** Pokal neben der Liga (fehlt bei Saisons von vor dem Pokal) */
  cup?: ManagerCup;
}

/** Pokal der Manager-Saison: 16 Teams, eine KO-Runde an jedem Spieltag aus CUP_MATCHDAYS */
export interface ManagerCup {
  /** Liga-Team-Indizes in Baum-Reihenfolge (Sieger von 2i und 2i+1 treffen sich) */
  bracket: number[];
  /** Gespielte Runden (round = Liga-Spieltag) */
  rounds: CupRound[];
  /** Gespielte Pokalspiele (round = Liga-Spieltag) */
  matches: Match[];
}

/** Karriere: Verschiebung der Auffüllteams je Liga-Stufe (Team-Score-Punkte) */
export const CAREER_TIER_SHIFT: Record<number, number> = { 1: 60, 2: 0, 3: -60 };

/** An diesen Spieltagen (nach dem Ligaspiel) wird eine Pokalrunde gespielt: Achtel-, Viertel-, Halbfinale, Finale */
export const CUP_MATCHDAYS = [4, 8, 12, 16] as const;

/** Ein Ausfall: verletzt (1–3 Spieltage) oder nach Roter Karte gesperrt (1 Spieltag) */
export interface ManagerAbsence {
  kind: 'injury' | 'red';
  /** Fällt bis einschließlich dieses Spieltags aus */
  until: number;
  /** Am Spieltag passiert */
  since: number;
}

/** Chance je eingesetztem Spieler und Spieltag: Verletzung bzw. Rote Karte */
export const INJURY_CHANCE = 0.03;
export const RED_CARD_CHANCE = 0.01;
/** Verletzungsdauer 1, 2 oder 3 Spieltage (Gewichte) */
const INJURY_WEIGHTS = [3, 2, 1];

/** Aufstellung, mit der ein Team an einem Spieltag gespielt hat */
export type ManagerPlayedLineup = Pick<ManagerLineup, 'formation' | 'slots'>;

/** So viele vollzogene Transfers bleiben gespeichert */
export const TRANSFERS_KEPT = 60;
/** CPU-Teams holen ein freies Pokémon nur, wenn es ihren schwächsten Spieler um so viele Fit-Punkte übertrifft */
const CPU_TRANSFER_GAIN = 6;

type ById = Map<number, Pokemon>;

const fail = (code: string, message: string): never => {
  throw new DraftError(code, message);
};

export const isManager = (state: Pick<DraftState, 'settings'>): boolean => upgradeSettings(state.settings).format === 'manager';

/** Tagesform eines Pokémon an einem Spieltag (−2 … +2) – unabhängig davon, wer sonst mitspielt. */
export function pokemonForm(seed: number | string, matchday: number, pokemonId: number): number {
  return formsOf(seed, matchday)(pokemonId);
}

/** Tagesform-Funktion eines Spieltags (der Liga-Seed wird nur einmal gehasht). */
export function formsOf(seed: number | string, matchday: number): (pokemonId: number) => number {
  const base = leagueSeed(seed, 'pform', matchday);
  const total = FORM_WEIGHTS.reduce((a, b) => a + b, 0);
  return (pokemonId) => {
    let x = (hashSeed(base, pokemonId) / 0x80000000) * total;
    for (let i = 0; i < FORM_VALUES.length; i++) {
      x -= FORM_WEIGHTS[i];
      if (x < 0) return FORM_VALUES[i];
    }
    return 0;
  };
}

/** Wer fällt am Spieltag k aus? (Pokémon-IDs) */
export function absentAt(m: Pick<ManagerState, 'out'> | null | undefined, matchday: number): Set<number> {
  const out = new Set<number>();
  for (const [id, a] of Object.entries(m?.out ?? {})) if (a.until >= matchday) out.add(Number(id));
  return out;
}

/**
 * Neue Ausfälle nach Spieltag k – deterministisch aus dem Liga-Seed, je eingesetztem Pokémon:
 * Rote Karte (gesperrt für den nächsten Spieltag) oder Verletzung (1–3 Spieltage).
 */
export function rollAbsences(seed: number | string, matchday: number, played: readonly number[]): Record<string, ManagerAbsence> {
  const base = leagueSeed(seed, 'out', matchday);
  const out: Record<string, ManagerAbsence> = {};
  const total = INJURY_WEIGHTS.reduce((a, b) => a + b, 0);
  for (const id of played) {
    const x = hashSeed(base, id) / 0x80000000;
    if (x < RED_CARD_CHANCE) {
      out[id] = { kind: 'red', until: matchday + 1, since: matchday };
    } else if (x < RED_CARD_CHANCE + INJURY_CHANCE) {
      let d = (hashSeed(base + 1, id) / 0x80000000) * total;
      let games = 1;
      for (let i = 0; i < INJURY_WEIGHTS.length; i++) {
        d -= INJURY_WEIGHTS[i];
        if (d < 0) {
          games = i + 1;
          break;
        }
      }
      out[id] = { kind: 'injury', until: matchday + games, since: matchday };
    }
  }
  return out;
}

/** Tagesform aller Kader-Pokémon der gedrafteten Teams für einen Spieltag (nur ≠ 0). */
export function rosterForm(state: Pick<DraftState, 'seed' | 'teams'>, matchday: number): Record<string, number> {
  const formOf = formsOf(state.seed, matchday);
  const out: Record<string, number> = {};
  for (const t of state.teams) {
    for (const id of rosterOf(t)) {
      const f = formOf(id);
      if (f) out[id] = f;
    }
  }
  return out;
}

/** Spielplan: Hinrunde (jeder einmal gegen jeden) */
export function managerSchedule(teams: number): [number, number][][] {
  const all = roundRobin(teams);
  return all.slice(0, all.length / 2);
}

/** Anpfiff eines Spieltags (1-basiert) */
export function kickoffAt(season: { startsAt: number; stepMs: number }, matchday: number): number {
  return season.startsAt + (matchday - 1) * season.stepMs;
}

/** Anpfiff des nächsten Spieltags – null, wenn alle gespielt sind (oder keine Manager-Saison läuft). */
export function nextKickoff(state: Pick<DraftState, 'season' | 'manager'>): number | null {
  const m = state.manager;
  if (!m || !state.season || m.played >= m.total) return null;
  return kickoffAt(state.season, m.played + 1);
}

/** Ende der Saison (letzter Anpfiff) – für die Löschfrist; null ohne Manager-Saison. */
export function seasonEndsAt(state: Pick<DraftState, 'season' | 'manager' | 'settings'>): number | null {
  if (!state.season || upgradeSettings(state.settings).format !== 'manager') return null;
  const total = state.manager?.total ?? DRAFT_LIMITS.leagueSize - 1;
  return kickoffAt(state.season, total);
}

/** Fit eines Pokémon auf einer Position samt Tagesform (0–100). */
export function formFit(p: Pokemon, pos: PosCode, scale: Scale, form: number): number {
  return Math.max(0, Math.min(100, positionFit(p, pos, scale) + form * FORM_FIT));
}

/** Team-Score einer Aufstellung samt Tagesform (wie evaluateTeam, Fits um die Form verschoben). */
export function lineupScore(
  squad: readonly { pos: PosCode; p: Pokemon }[],
  scale: Scale,
  formOf: (id: number) => number,
  /** Kapitän (Pokémon-ID) – zählt doppelt, wenn er in der Aufstellung steht */
  captain?: number | null,
  /** Shinys der Liga – bessere Passung und Team-Bonus */
  shinies?: ReadonlySet<number>,
): number {
  const fits = squad.map(({ p, pos }) => Math.min(100, formFit(p, pos, scale, formOf(p.id)) + (shinies?.has(p.id) ? SHINY_FIT_BONUS : 0)));
  const weights = captainWeights(
    squad.map(({ pos }) => POSITIONS[pos].teamWeight),
    squad.map(({ p }) => p.id),
    captain,
  );
  return Math.min(1000, Math.round(teamScoreFromFits(fits, weights).exact) + shinyBonus(squad.map(({ p }) => p), shinies));
}

/** Beste Elf aus dem Kader in einer Formation – mit Tagesform. */
export function bestLineup(
  team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>,
  formation: FormationId,
  byId: ById,
  scale: Scale,
  form: Record<string, number>,
  setPiece: boolean,
  /** Ausfälle – nicht aufstellen */
  absent: ReadonlySet<number> = new Set(),
  /** Shinys der Liga – spielen besser und heben das Team, also möglichst aufstellen */
  shinies?: ReadonlySet<number>,
  /** Kapitän – zählt in der Startelf doppelt; aufgestellt, wenn die Elf dadurch stärker wird */
  captain?: number | null,
): Omit<ManagerLineup, 'auto'> {
  const pool = rosterOf(team).flatMap((id) => (absent.has(id) ? [] : byId.get(id) ?? []));
  const shinyEdge = (p: Pokemon) => (shinies?.has(p.id) ? SHINY_FIT_BONUS + shinyTeamBoost(p) : 0);
  const edge = (p: Pokemon) => (form[p.id] ?? 0) * FORM_FIT + shinyEdge(p);
  const lineupOf = (b: ReturnType<typeof bestEleven>): Omit<ManagerLineup, 'auto'> => ({ formation, slots: b.slots.map((id) => id ?? -1), ss: setPiece ? b.ss : null });
  const plain = lineupOf(bestEleven(formation, pool, scale, { setPiece, bonus: edge }));
  if (captain == null || plain.slots.includes(captain) || !pool.some((p) => p.id === captain)) return plain;
  // Variante mit Kapitän in der Elf (großer Bonus zwingt ihn auf seine beste Position) – die stärkere gewinnt
  const withCaptain = lineupOf(bestEleven(formation, pool, scale, { setPiece, bonus: (p) => edge(p) + (p.id === captain ? 1000 : 0) }));
  if (!withCaptain.slots.includes(captain)) return plain;
  const strength = (l: Omit<ManagerLineup, 'auto'>) =>
    lineupScore(
      l.slots.flatMap((id, i) => {
        const p = byId.get(id);
        return p ? [{ p, pos: FORMATIONS[formation].slots[i].pos }] : [];
      }),
      scale,
      (id) => form[id] ?? 0,
      captain,
      shinies,
    );
  return strength(withCaptain) > strength(plain) ? withCaptain : plain;
}

/** Aufstellung nach dem Draft: so, wie gedraftet. */
function draftedLineup(team: DraftTeam): Omit<ManagerLineup, 'auto'> {
  return { formation: team.formation, slots: team.slots.map((id) => id ?? -1), ss: team.ss };
}

/** Grund, warum eine Aufstellung nicht geht – oder null. */
export function lineupError(team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>, lineup: Omit<ManagerLineup, 'auto'>, setPiece: boolean): string | null {
  if (!(FORMATION_IDS as readonly string[]).includes(lineup.formation)) return 'Ungültige Formation';
  const size = FORMATIONS[lineup.formation].slots.length;
  const roster = new Set(rosterOf(team));
  if (!Array.isArray(lineup.slots) || lineup.slots.length !== size) return `Die Elf braucht ${size} Spieler`;
  const ids = [...lineup.slots, ...(setPiece ? [lineup.ss] : [])];
  if (!ids.every((id) => Number.isInteger(id) && roster.has(id as number))) return 'Nur Pokémon aus dem eigenen Kader';
  if (new Set(ids).size !== ids.length) return 'Jedes Pokémon nur einmal';
  if (!setPiece && lineup.ss != null) return 'Diese Liga spielt ohne Standardschützen';
  return null;
}

/** Aufstellungen fürs nächste Spiel: CPU-Teams und „auto" bekommen die beste Elf zur Tagesform (ohne Ausfälle). */
function refreshAuto(
  state: DraftState,
  lineups: Record<string, ManagerLineup>,
  form: Record<string, number>,
  byId: ById,
  scale: Scale,
  absent: ReadonlySet<number> = new Set(),
) {
  const shinies = state.shinies?.length ? new Set(state.shinies) : undefined;
  const setPiece = upgradeSettings(state.settings).setPiece;
  const out: Record<string, ManagerLineup> = {};
  for (const t of state.teams) {
    const cur = lineups[t.id] ?? { ...draftedLineup(t), auto: true };
    out[t.id] = t.cpu || cur.auto ? { ...bestLineup(t, cur.formation, byId, scale, form, setPiece, absent, shinies, t.captain), auto: cur.auto || t.cpu } : cur;
  }
  return out;
}

/**
 * Eigene Aufstellung zum Anpfiff: Wer ausfällt, wird durch das am besten passende verfügbare
 * Kader-Pokémon ersetzt (Standardschütze notfalls keiner). Die gespeicherte Aufstellung bleibt.
 */
export function coverAbsences(
  team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>,
  lineup: ManagerLineup,
  absent: ReadonlySet<number>,
  byId: ById,
  scale: Scale,
  form: Record<string, number>,
): ManagerLineup {
  const hit = lineup.slots.some((id) => absent.has(id)) || (lineup.ss != null && absent.has(lineup.ss));
  if (!hit) return lineup;
  const used = new Set([...lineup.slots, ...(lineup.ss != null ? [lineup.ss] : [])]);
  const free = rosterOf(team).filter((id) => !used.has(id) && !absent.has(id));
  const take = (pos: PosCode): number | null => {
    let best: number | null = null;
    let bestFit = -1;
    for (const id of free) {
      const p = byId.get(id);
      if (!p) continue;
      const f = formFit(p, pos, scale, form[id] ?? 0);
      if (f > bestFit) {
        bestFit = f;
        best = id;
      }
    }
    if (best != null) free.splice(free.indexOf(best), 1);
    return best;
  };
  const defs = FORMATIONS[lineup.formation].slots;
  const slots = lineup.slots.map((id, i) => (absent.has(id) ? take(defs[i].pos) ?? id : id));
  const ss = lineup.ss != null && absent.has(lineup.ss) ? take('SS') : lineup.ss;
  return { ...lineup, slots, ss };
}

/** Kompakte Liga-Teams (ohne Kader) für Zustand und Schnappschuss */
function compactTeams(teams: readonly LeagueTeam[]): LeagueTeam[] {
  return teams.map((t) =>
    t.player
      ? { name: t.name, rating: t.rating, player: t.player, ...(t.playerEntry ? { playerEntry: t.playerEntry } : {}) }
      : { name: t.name, rating: t.rating },
  );
}

/**
 * Ende des Drafts (Phase „season"): Auffüllteams (mit Kader) festlegen, erste Aufstellungen
 * (wie gedraftet; CPU-Teams und alle Menschen zunächst automatisch), leere Tabelle.
 */
export function startManagerSeason(
  state: DraftState,
  list: Pokemon[],
  scale: Scale,
  candidates: readonly FillCandidate[] = [],
): DraftState {
  if (state.phase !== 'season' || state.manager) return state;
  const byId = new Map(list.map((p) => [p.id, p]));
  const drafted = leagueTeams(state, byId, scale);
  // Karriere: Die Liga-Stufe verschiebt das Niveau der Auffüllteams (1. Liga stärker, 3. Liga schwächer)
  const tierShift = CAREER_TIER_SHIFT[state.career?.tier ?? 2] ?? 0;
  const fill = centerFillRatings(drafted, fillTeams(state, candidates, byId, scale, DRAFT_LIMITS.leagueSize)).map((t) =>
    tierShift ? { ...t, rating: Math.min(1000, Math.max(0, t.rating + tierShift)) } : t,
  );
  const fillTeamsStored: ManagerFillTeam[] = fill.map((t) => ({
    name: t.name,
    rating: t.rating,
    ...(t.player ? { player: t.player } : {}),
    ...(t.playerEntry ? { playerEntry: t.playerEntry } : {}),
    squad: (t.squad ?? []).map((s) => ({ pokemonId: s.pokemonId, pos: s.pos })),
    ss: t.setPieceTaker?.pokemonId ?? null,
  }));
  const n = state.teams.length + fill.length;
  // Pokal: alle gedrafteten Teams, aufgefüllt mit den stärksten Auffüllteams; Auslosung aus dem Liga-Seed
  const fillByRating = fill.map((t, i) => ({ i: state.teams.length + i, r: t.rating })).sort((a, b) => b.r - a.r || a.i - b.i);
  const cupTeams = [...state.teams.map((_, i) => i), ...fillByRating.map((x) => x.i)].slice(0, CUP_SIZE);
  const cup: ManagerCup | undefined = cupTeams.length === CUP_SIZE ? { bracket: shuffle(leagueRng(state.seed, 'cup-draw'), cupTeams), rounds: [], matches: [] } : undefined;
  const form = rosterForm(state, 1);
  const lineups = refreshAuto(state, {}, form, byId, scale);
  const teams = [...drafted, ...fill];
  const manager: ManagerState = { played: 0, total: managerSchedule(n).length, lineups, form, fill: fillTeamsStored, ...(cup ? { cup } : {}) };
  const league: LeagueResult = { teams: compactTeams(teams), matches: [], table: buildTable(compactTeams(teams), []) };
  return { ...state, manager, league };
}

const squadPlayer = (p: Pokemon, pos: PosCode): SquadPlayer => ({ pokemonId: p.id, pos, atk: p.atk, spa: p.spa });

/** Liga-Teams eines Spieltags: gedraftete nach Aufstellung, Auffüllteams fest – jeweils mit Tagesform. */
function matchdayTeams(state: DraftState, m: ManagerState, matchday: number, byId: ById, scale: Scale): LeagueTeam[] {
  const shinySet = state.shinies?.length ? new Set(state.shinies) : undefined;
  const formOf = formsOf(state.seed, matchday);
  const setPiece = upgradeSettings(state.settings).setPiece;
  const drafted = state.teams.map((t): LeagueTeam => {
    const l = m.lineups[t.id];
    const defs = FORMATIONS[l.formation].slots;
    const squad = l.slots.flatMap((id, i) => {
      const p = byId.get(id);
      return p ? [{ p, pos: defs[i].pos }] : [];
    });
    const ss = setPiece && l.ss != null ? byId.get(l.ss) : undefined;
    return {
      name: t.name,
      rating: lineupScore(squad, scale, formOf, t.captain, shinySet),
      squad: squad.map(({ p, pos }) => squadPlayer(p, pos)),
      setPieceTaker: ss ? squadPlayer(ss, 'SS') : null,
      setPieceFit: ss ? formFit(ss, 'SS', scale, formOf(ss.id)) : undefined,
    };
  });
  const fill = m.fill.map((f): LeagueTeam => {
    const squad = f.squad.flatMap((s) => {
      const p = byId.get(s.pokemonId);
      return p ? [{ p, pos: s.pos }] : [];
    });
    // Form als Abstand zum Score ohne Form – so bleibt die Verschiebung aufs Liga-Niveau erhalten
    const delta = squad.length ? lineupScore(squad, scale, formOf) - lineupScore(squad, scale, () => 0) : 0;
    const ss = f.ss != null ? byId.get(f.ss) : undefined;
    return {
      name: f.name,
      rating: Math.max(0, f.rating + delta),
      ...(f.player ? { player: f.player } : {}),
      ...(f.playerEntry ? { playerEntry: f.playerEntry } : {}),
      squad: squad.map(({ p, pos }) => squadPlayer(p, pos)),
      setPieceTaker: ss ? squadPlayer(ss, 'SS') : null,
      setPieceFit: ss ? formFit(ss, 'SS', scale, formOf(ss.id)) : undefined,
    };
  });
  return [...drafted, ...fill];
}

/** Tagesform der Teams am Spieltag k (DRAFT_MODEL) – eigener Strom, unabhängig von den Aufstellungen. */
function teamForm(seed: number | string, teams: number, matchday: number): number[] {
  const rng = leagueRng(seed, 'tform');
  let form = Array.from({ length: teams }, () => 0);
  for (let k = 1; k <= matchday; k++) form = nextForm(rng, form, DRAFT_MODEL);
  return form;
}

/** Noch im Pokal: Sieger der letzten Runde bzw. alle aus der Auslosung */
export function cupAlive(cup: ManagerCup): number[] {
  const last = cup.rounds[cup.rounds.length - 1];
  return last ? last.ties.map((t) => t.winner) : cup.bracket;
}

/** Pokalsieger (Liga-Team-Index) – null, solange das Finale fehlt */
export function managerCupWinner(cup: ManagerCup | undefined): number | null {
  const last = cup?.rounds[cup.rounds.length - 1];
  return last?.stage === 'final' ? last.ties[0].winner : null;
}

const CUP_STAGES: Record<number, CupStage> = { 16: 'r16', 8: 'qf', 4: 'sf', 2: 'final' };

/** Eine Pokalrunde spielen (Finale auf neutralem Platz, Remis → Elfmeterschießen). */
function playCupRound(cup: ManagerCup, teams: readonly LeagueTeam[], matchday: number, seed: number | string, form: readonly number[]): ManagerCup {
  const alive = cupAlive(cup);
  if (alive.length < 2) return cup;
  const stage = CUP_STAGES[alive.length] ?? 'r16';
  const rng = leagueRng(seed, 'cup', matchday);
  const ties: CupTie[] = [];
  const matches: Match[] = [];
  for (let i = 0; i + 1 < alive.length; i += 2) {
    const r = playTie(rng, teams, matchday, alive[i], alive[i + 1], stage === 'final', DRAFT_MODEL, form);
    ties.push(r.tie);
    matches.push(r.match);
  }
  return { ...cup, rounds: [...cup.rounds, { stage, round: matchday, ties }], matches: [...cup.matches, ...matches] };
}

/** Den nächsten Spieltag spielen (Server, zum Anpfiff). Nach dem letzten: Phase „done". */
export function playMatchday(before: DraftState, list: Pokemon[], scale: Scale): DraftState {
  if (before.phase !== 'season' || !before.manager || !before.league || before.manager.played >= before.manager.total) return before;
  // Zuerst der Transfermarkt (Wünsche in Tabellen-Reihenfolge), dann wird gespielt
  const state = pruneOffers(processClaims(before, list, scale), list);
  const m = state.manager!;
  if (!state.league) return state;
  const byId = new Map(list.map((p) => [p.id, p]));
  const k = m.played + 1;
  // Zum Anpfiff gilt die Form dieses Spieltags (auto-Aufstellungen sind schon darauf gestellt);
  // wer ausfällt, spielt nicht – eigene Aufstellungen bekommen dafür einen Ersatz
  const absent = absentAt(m, k);
  const formNow = rosterForm(state, k);
  const lineups = Object.fromEntries(
    Object.entries(refreshAuto(state, m.lineups, formNow, byId, scale, absent)).map(([id, l]) => {
      const team = state.teams.find((t) => t.id === id);
      return [id, team ? coverAbsences(team, l, absent, byId, scale, formNow) : l];
    }),
  );
  const playedNow = Object.fromEntries(Object.entries(lineups).map(([id, l]) => [id, { formation: l.formation, slots: [...l.slots] }]));
  const cur: ManagerState = { ...m, lineups, playedLineups: { ...(m.playedLineups ?? {}), [k]: playedNow } };
  const teams = matchdayTeams(state, cur, k, byId, scale);
  const form = teamForm(state.seed, teams.length, k);
  const rng = leagueRng(state.seed, 'md', k);
  const round = managerSchedule(teams.length)[k - 1] ?? [];
  const played = round.map(([h, a]) => playMatch(rng, teams, k, h, a, false, DRAFT_MODEL, form));
  const matches = [...state.league.matches, ...played];
  // Pokalrunde nach dem Ligaspiel – gleiche Aufstellungen und Tagesform, eigener Zufallsstrom
  const cupNow = cur.cup && (CUP_MATCHDAYS as readonly number[]).includes(k) ? playCupRound(cur.cup, teams, k, state.seed, form) : cur.cup;
  if (cupNow) cur.cup = cupNow;
  const compact = compactTeams(teams);
  const league: LeagueResult = { teams: compact, matches, table: buildTable(compact, matches) };
  if (k >= m.total) {
    return { ...state, phase: 'done', league, manager: { ...cur, played: k, form: {} } };
  }
  // Neue Ausfälle (eingesetzte Pokémon der gedrafteten Teams), abgelaufene fallen weg
  const fielded = Object.values(lineups).flatMap((l) => [...l.slots, ...(l.ss != null ? [l.ss] : [])]);
  const out: Record<string, ManagerAbsence> = {};
  for (const [id, a] of Object.entries(m.out ?? {})) if (a.until > k) out[id] = a;
  Object.assign(out, rollAbsences(state.seed, k, fielded));
  const nextForm_ = rosterForm(state, k + 1);
  const nextAbsent = absentAt({ out }, k + 1);
  // Gespeicherte eigene Aufstellungen bleiben, wie sie sind (Ersatz erst zum Anpfiff)
  const keep = Object.fromEntries(Object.entries(lineups).map(([id, l]) => [id, l.auto ? l : (m.lineups[id] ?? l)]));
  const { out: _old, ...rest } = cur;
  return cpuOffers(
    {
      ...state,
      league,
      manager: {
        ...rest,
        played: k,
        form: nextForm_,
        lineups: refreshAuto(state, keep, nextForm_, byId, scale, nextAbsent),
        ...(Object.keys(out).length ? { out } : {}),
      },
    },
    list,
    scale,
  );
}

/** Alle fälligen Spieltage spielen (z. B. nach einer Pause des Servers). */
export function playDueMatchdays(state: DraftState, now: number, list: Pokemon[], scale: Scale): DraftState {
  let next = state;
  for (;;) {
    const at = nextKickoff(next);
    if (at == null || now < at) return next;
    const played = playMatchday(next, list, scale);
    if (played === next) return next;
    next = played;
  }
}

/**
 * Eigene Aufstellung setzen (gilt ab dem nächsten Spieltag). auto: in dieser Formation stellt der
 * Server die beste Elf zur Tagesform auf. Fehler: not_joined, not_season, bad_lineup.
 */
export function setLineup(
  state: DraftState,
  deviceId: string,
  input: { formation: FormationId; slots: number[]; ss: number | null; auto: boolean },
  list: Pokemon[],
  scale: Scale,
): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const m = state.manager;
  if (state.phase !== 'season' || !m) return fail('not_season', 'Gerade läuft keine Manager-Saison');
  const team = state.teams.find((t) => t.id === teamId)!;
  const setPiece = upgradeSettings(state.settings).setPiece;
  if (!(FORMATION_IDS as readonly string[]).includes(input.formation)) fail('bad_lineup', 'Ungültige Formation');
  let lineup: ManagerLineup;
  if (input.auto) {
    const byId = new Map(list.map((p) => [p.id, p]));
    lineup = {
      ...bestLineup(team, input.formation, byId, scale, m.form, setPiece, absentAt(m, m.played + 1), state.shinies?.length ? new Set(state.shinies) : undefined, team.captain),
      auto: true,
    };
  } else {
    const l = { formation: input.formation, slots: input.slots, ss: setPiece ? input.ss : null };
    const err = lineupError(team, l, setPiece);
    if (err) fail('bad_lineup', err);
    lineup = { ...l, slots: [...l.slots], auto: false };
  }
  return { ...state, manager: { ...m, lineups: { ...m.lineups, [teamId]: lineup } } };
}

/** Kapitän in der Manager-Saison: Steht die eigene Aufstellung auf „auto“, gleich neu aufstellen (mit Kapitän). */
export function refreshAutoLineup(state: DraftState, deviceId: string, list: Pokemon[], scale: Scale): DraftState {
  const teamId = teamOfDevice(state, deviceId);
  const cur = teamId != null ? state.manager?.lineups[teamId] : undefined;
  if (state.phase !== 'season' || !cur?.auto) return state;
  return setLineup(state, deviceId, { formation: cur.formation, slots: [], ss: null, auto: true }, list, scale);
}

// ---------------------------------------------------------------- Transfermarkt

/** Freie Pokémon: im Pool der Liga und von keinem gedrafteten Team besetzt. */
export function freeAgents(state: Pick<DraftState, 'settings' | 'teams'>, list: Pokemon[]): Pokemon[] {
  const taken = draftedIds(state);
  return poolOf(upgradeSettings(state.settings), list).filter((p) => !taken.has(p.id));
}

/** Kader nach dem Tausch out → in (Platz bleibt: Feld, Standardschütze oder Bank). */
function swapRoster<T extends Pick<DraftTeam, 'slots' | 'ss' | 'bench'>>(team: T, out: number, inn: number): T {
  return {
    ...team,
    slots: team.slots.map((id) => (id === out ? inn : id)),
    ss: team.ss === out ? inn : team.ss,
    ...(team.bench ? { bench: team.bench.map((id) => (id === out ? inn : id)) } : {}),
  };
}

/** Grund, warum dieser Transfer (gerade) nicht geht – oder null. */
export function claimError(state: Pick<DraftState, 'settings' | 'teams'>, teamId: string, claim: ManagerClaim, list: Pokemon[]): string | null {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return 'Dieses Team gibt es nicht';
  if (!rosterOf(team).includes(claim.out)) return 'Abgeben kannst du nur Pokémon aus deinem Kader';
  const byId = new Map(list.map((p) => [p.id, p]));
  const p = byId.get(claim.in);
  if (!p || !freeAgents(state, list).some((x) => x.id === claim.in)) return 'Dieses Pokémon ist nicht (mehr) frei';
  // Limits (Legendäre, Ultrabestien, Megas) gelten für den Kader nach dem Tausch
  const settings = upgradeSettings(state.settings);
  const after = rosterOf(swapRoster(team, claim.out, claim.in)).flatMap((id) => byId.get(id) ?? []);
  for (const kind of LIMIT_KINDS) {
    const max = limitOf(settings, kind);
    if (max != null && after.filter((x) => hasKind(x, kind)).length > max) return 'Damit wäre ein Limit pro Team überschritten';
  }
  return null;
}

/**
 * Eigenen Transfer-Wunsch setzen (in = null: zurückziehen). Geprüft wird jetzt und zum Anpfiff
 * noch einmal. Fehler: not_joined, not_season, bad_transfer.
 */
export function setClaim(state: DraftState, deviceId: string, input: { in: number | null; out: number | null }, list: Pokemon[]): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const m = state.manager;
  if (state.phase !== 'season' || !m) return fail('not_season', 'Gerade läuft keine Manager-Saison');
  const claims = { ...(m.claims ?? {}) };
  if (input.in == null) {
    if (!claims[teamId]) return state;
    delete claims[teamId];
    return { ...state, manager: { ...m, claims } };
  }
  if (input.out == null) return fail('bad_transfer', 'Wähle, wen du abgibst');
  const claim = { in: input.in, out: input.out };
  const err = claimError(state, teamId, claim, list);
  if (err) fail('bad_transfer', err);
  claims[teamId] = claim;
  return { ...state, manager: { ...m, claims } };
}

/** Bester Fit eines Pokémon über die Positionen einer Formation */
function bestFit(p: Pokemon, formation: FormationId, scale: Scale): number {
  return Math.max(...FORMATIONS[formation].slots.map((s) => positionFit(p, s.pos, scale)));
}

/** CPU: das beste freie Pokémon für den schwächsten Spieler – nur bei klarem Gewinn (deterministisch). */
function cpuClaim(state: DraftState, team: DraftTeam, list: Pokemon[], scale: Scale): ManagerClaim | null {
  const byId = new Map(list.map((p) => [p.id, p]));
  const roster = rosterOf(team).flatMap((id) => byId.get(id) ?? []);
  if (!roster.length) return null;
  const weakest = roster.reduce((a, b) => (bestFit(b, team.formation, scale) < bestFit(a, team.formation, scale) ? b : a));
  const floor = bestFit(weakest, team.formation, scale);
  let best: { p: Pokemon; fit: number } | null = null;
  for (const p of freeAgents(state, list)) {
    const fit = bestFit(p, team.formation, scale);
    if (fit >= floor + CPU_TRANSFER_GAIN && (!best || fit > best.fit || (fit === best.fit && p.id < best.p.id))) best = { p, fit };
  }
  if (!best) return null;
  const claim = { in: best.p.id, out: weakest.id };
  return claimError(state, team.id, claim, list) ? null : claim;
}

/**
 * Zum Anpfiff: Transfer-Wünsche vergeben – Tabellenletzter zuerst (vor dem 1. Spieltag: schwächster
 * Kader zuerst). Ein Wunsch, dessen Pokémon inzwischen weg ist, verfällt. Danach sind alle Wünsche leer.
 */
export function processClaims(state: DraftState, list: Pokemon[], scale: Scale): DraftState {
  const m = state.manager;
  if (!m || !state.league) return state;
  const k = m.played + 1;
  const table = state.league.table;
  // Platz in der Tabelle (gedraftete Teams haben die Indizes 0 … n−1)
  const place = (i: number) => {
    const at = table.findIndex((r) => r.team === i);
    return at < 0 ? Infinity : at;
  };
  const order = state.teams.map((_, i) => i).sort((a, b) => place(b) - place(a) || a - b);
  let next = state;
  const transfers = [...(m.transfers ?? [])];
  for (const i of order) {
    const team = next.teams[i];
    const claim = m.claims?.[team.id] ?? (team.cpu ? cpuClaim(next, team, list, scale) : null);
    if (!claim || claimError(next, team.id, claim, list)) continue;
    const lineups = { ...next.manager!.lineups };
    const l = lineups[team.id];
    if (l) lineups[team.id] = { ...l, slots: l.slots.map((id) => (id === claim.out ? claim.in : id)), ss: l.ss === claim.out ? claim.in : l.ss };
    next = {
      ...next,
      teams: next.teams.map((t, j) => (j === i ? swapRoster(t, claim.out, claim.in) : t)),
      manager: { ...next.manager!, lineups },
    };
    transfers.push({ matchday: k, teamId: team.id, in: claim.in, out: claim.out });
  }
  const { claims: _done, ...rest } = next.manager!;
  return { ...next, manager: { ...rest, transfers: transfers.slice(-TRANSFERS_KEPT) } };
}

// ---------------------------------------------------------------- Tausch zwischen Teams

/** So viele offene Angebote darf ein Team gleichzeitig haben */
export const OFFERS_PER_TEAM = 3;
/** CPU-Teams nehmen einen Tausch an, wenn ihre beste Elf damit um so viel stärker wird (gewichtete Fit-Punkte) */
const CPU_TRADE_GAIN = 0.5;

/** Stärke eines Kaders: gewichteter Fit seiner besten Elf in der eigenen Formation (ohne Tagesform). */
export function squadStrength(team: Pick<DraftTeam, 'slots' | 'ss' | 'bench' | 'formation'>, byId: ById, scale: Scale): number {
  const pool = rosterOf(team).flatMap((id) => byId.get(id) ?? []);
  const defs = FORMATIONS[team.formation].slots;
  const best = bestEleven(team.formation, pool, scale);
  return defs.reduce((n, d, i) => {
    const p = best.slots[i] != null ? byId.get(best.slots[i]!) : undefined;
    return n + (p ? positionFit(p, d.pos, scale) * POSITIONS[d.pos].teamWeight : 0);
  }, 0);
}

/** Stärkegewinn eines Teams durch den Tausch out → in */
function tradeGain(team: DraftTeam, out: number, inn: number, byId: ById, scale: Scale, base = squadStrength(team, byId, scale)): number {
  return squadStrength(swapRoster(team, out, inn), byId, scale) - base;
}

/** Grund, warum dieser Tausch (gerade) nicht geht – oder null. */
export function tradeError(state: Pick<DraftState, 'settings' | 'teams'>, offer: Omit<ManagerOffer, 'id'>, list: Pokemon[]): string | null {
  const from = state.teams.find((t) => t.id === offer.from);
  const to = state.teams.find((t) => t.id === offer.to);
  if (!from || !to || from.id === to.id) return 'Dieses Team gibt es nicht';
  if (!rosterOf(from).includes(offer.give)) return 'Abgeben kannst du nur Pokémon aus deinem Kader';
  if (!rosterOf(to).includes(offer.get)) return 'Dieses Pokémon ist nicht (mehr) in diesem Kader';
  const settings = upgradeSettings(state.settings);
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const after of [swapRoster(from, offer.give, offer.get), swapRoster(to, offer.get, offer.give)]) {
    const roster = rosterOf(after).flatMap((id) => byId.get(id) ?? []);
    for (const kind of LIMIT_KINDS) {
      const max = limitOf(settings, kind);
      if (max != null && roster.filter((x) => hasKind(x, kind)).length > max) return 'Damit wäre ein Limit pro Team überschritten';
    }
  }
  return null;
}

/** Tausch vollziehen: Kader und Aufstellungen beider Teams, Transfer-Liste; Angebote mit den beiden Pokémon verfallen. */
function executeTrade(state: DraftState, offer: Omit<ManagerOffer, 'id'>): DraftState {
  const m = state.manager!;
  const k = m.played + 1;
  const swapLineup = (l: ManagerLineup | undefined, out: number, inn: number) =>
    l && { ...l, slots: l.slots.map((id) => (id === out ? inn : id)), ss: l.ss === out ? inn : l.ss };
  const lineups = { ...m.lineups };
  const lf = swapLineup(lineups[offer.from], offer.give, offer.get);
  const lt = swapLineup(lineups[offer.to], offer.get, offer.give);
  if (lf) lineups[offer.from] = lf;
  if (lt) lineups[offer.to] = lt;
  const touched = new Set([offer.give, offer.get]);
  const transfers = [
    ...(m.transfers ?? []),
    { matchday: k, teamId: offer.from, in: offer.get, out: offer.give, with: offer.to },
    { matchday: k, teamId: offer.to, in: offer.give, out: offer.get, with: offer.from },
  ];
  return {
    ...state,
    teams: state.teams.map((t) =>
      t.id === offer.from ? swapRoster(t, offer.give, offer.get) : t.id === offer.to ? swapRoster(t, offer.get, offer.give) : t,
    ),
    manager: {
      ...m,
      lineups,
      offers: (m.offers ?? []).filter((o) => !touched.has(o.give) && !touched.has(o.get)),
      transfers: transfers.slice(-TRANSFERS_KEPT),
    },
  };
}

/**
 * Tausch anbieten (eigenes `give` gegen `get` von Team `to`). Ein CPU-Team antwortet sofort: Es
 * nimmt an, wenn es damit klar gewinnt, sonst Fehler trade_declined. Fehler: not_joined, not_season,
 * bad_trade, too_many_offers.
 */
export function makeOffer(
  state: DraftState,
  deviceId: string,
  input: { to: string; give: number; get: number },
  list: Pokemon[],
  scale: Scale,
): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const m = state.manager;
  if (state.phase !== 'season' || !m || m.played >= m.total) return fail('not_season', 'Gerade läuft keine Manager-Saison');
  const offer = { from: teamId, to: input.to, give: input.give, get: input.get };
  const err = tradeError(state, offer, list);
  if (err) fail('bad_trade', err);
  const offers = m.offers ?? [];
  if (offers.some((o) => o.from === offer.from && o.to === offer.to && o.give === offer.give && o.get === offer.get)) return state;
  const to = state.teams.find((t) => t.id === offer.to)!;
  if (to.cpu) {
    // Das CPU-Team nimmt an, wenn seine beste Elf damit klar stärker wird
    const byId = new Map(list.map((p) => [p.id, p]));
    if (tradeGain(to, offer.get, offer.give, byId, scale) < CPU_TRADE_GAIN) fail('trade_declined', 'Das CPU-Team lehnt den Tausch ab');
    return executeTrade(state, offer);
  }
  if (offers.filter((o) => o.from === teamId).length >= OFFERS_PER_TEAM) {
    fail('too_many_offers', `Höchstens ${OFFERS_PER_TEAM} offene Angebote – ziehe erst eins zurück`);
  }
  const id = (m.offerSeq ?? 0) + 1;
  return { ...state, manager: { ...m, offers: [...offers, { id, ...offer }], offerSeq: id } };
}

/**
 * Auf ein Angebot antworten: das angefragte Team nimmt an oder lehnt ab, der Anbieter kann es
 * zurückziehen (accept = false). Fehler: not_joined, not_season, no_offer, bad_trade.
 */
export function answerOffer(state: DraftState, deviceId: string, input: { id: number; accept: boolean }, list: Pokemon[]): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const m = state.manager;
  if (state.phase !== 'season' || !m) return fail('not_season', 'Gerade läuft keine Manager-Saison');
  const offer = (m.offers ?? []).find((o) => o.id === input.id && (o.to === teamId || o.from === teamId));
  if (!offer) return fail('no_offer', 'Dieses Angebot gibt es nicht mehr');
  const rest = (m.offers ?? []).filter((o) => o.id !== offer.id);
  if (!input.accept || offer.to !== teamId) return { ...state, manager: { ...m, offers: rest } };
  const err = tradeError(state, offer, list);
  if (err) {
    // Hinfällig (z. B. ein Pokémon ist inzwischen weg): Angebot verfällt
    fail('bad_trade', err);
  }
  return executeTrade({ ...state, manager: { ...m, offers: rest } }, offer);
}

/** Nach Transfers zum Anpfiff: hinfällige Angebote verfallen. */
export function pruneOffers(state: DraftState, list: Pokemon[]): DraftState {
  const m = state.manager;
  if (!m?.offers?.length) return state;
  const offers = m.offers.filter((o) => !tradeError(state, o, list));
  return offers.length === m.offers.length ? state : { ...state, manager: { ...m, offers } };
}

/** Chance je menschlichem Team, nach einem Spieltag ein Angebot eines CPU-Teams zu bekommen */
const CPU_OFFER_CHANCE = 0.5;

/**
 * Nach einem Spieltag: CPU-Teams bieten menschlichen Teams einen Tausch an, der beiden hilft (das
 * CPU-Team gewinnt klar, das andere verliert nichts). Alte CPU-Angebote verfallen dabei. Deterministisch
 * (Liga-Seed, Spieltag).
 */
export function cpuOffers(state: DraftState, list: Pokemon[], scale: Scale): DraftState {
  const m = state.manager;
  if (!m || state.phase !== 'season') return state;
  const cpuIds = new Set(state.teams.filter((t) => t.cpu).map((t) => t.id));
  let offers = (m.offers ?? []).filter((o) => !cpuIds.has(o.from));
  let seq = m.offerSeq ?? 0;
  const cpus = state.teams.filter((t) => t.cpu);
  if (cpus.length) {
    const byId = new Map(list.map((p) => [p.id, p]));
    const rng = leagueRng(state.seed, 'offers', m.played);
    for (const human of state.teams.filter((t) => !t.cpu)) {
      const roll = rng();
      const cpu = cpus[Math.floor(rng() * cpus.length)];
      if (roll >= CPU_OFFER_CHANCE) continue;
      const baseCpu = squadStrength(cpu, byId, scale);
      const baseHuman = squadStrength(human, byId, scale);
      let best: { give: number; get: number; score: number } | null = null;
      for (const give of rosterOf(cpu)) {
        for (const get of rosterOf(human)) {
          // Beide Elfen werden stärker: das CPU-Team klar, das menschliche Team überhaupt
          const gainCpu = tradeGain(cpu, give, get, byId, scale, baseCpu);
          if (gainCpu < CPU_TRADE_GAIN) continue;
          const gainHuman = tradeGain(human, get, give, byId, scale, baseHuman);
          if (gainHuman <= 0) continue;
          const score = gainCpu + gainHuman;
          if (!best || score > best.score || (score === best.score && (give < best.give || (give === best.give && get < best.get)))) {
            best = { give, get, score };
          }
        }
      }
      if (!best) continue;
      const offer = { from: cpu.id, to: human.id, give: best.give, get: best.get };
      if (tradeError(state, offer, list)) continue;
      seq += 1;
      offers = [...offers, { id: seq, ...offer }];
    }
  }
  return { ...state, manager: { ...m, offers, offerSeq: seq } };
}

