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
import { DRAFT_LIMITS, type DraftTeam, type ManagerClaim, type ManagerLineup, type ManagerTransfer } from './api/draftContract';
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
import { hashSeed } from './rng';
import { buildTable, DRAFT_MODEL, nextForm, playMatch, roundRobin, type LeagueResult, type LeagueTeam, type SquadPlayer } from './season';
import { teamScoreFromFits } from './teamScore';

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
}

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
): number {
  const fits = squad.map(({ p, pos }) => formFit(p, pos, scale, formOf(p.id)));
  const weights = squad.map(({ pos }) => POSITIONS[pos].teamWeight);
  return Math.round(teamScoreFromFits(fits, weights).exact);
}

/** Beste Elf aus dem Kader in einer Formation – mit Tagesform. */
export function bestLineup(
  team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>,
  formation: FormationId,
  byId: ById,
  scale: Scale,
  form: Record<string, number>,
  setPiece: boolean,
): Omit<ManagerLineup, 'auto'> {
  const pool = rosterOf(team).flatMap((id) => byId.get(id) ?? []);
  const best = bestEleven(formation, pool, scale, { setPiece, bonus: (p) => (form[p.id] ?? 0) * FORM_FIT });
  return { formation, slots: best.slots.map((id) => id ?? -1), ss: setPiece ? best.ss : null };
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

/** Aufstellungen fürs nächste Spiel: CPU-Teams und „auto" bekommen die beste Elf zur Tagesform. */
function refreshAuto(state: DraftState, lineups: Record<string, ManagerLineup>, form: Record<string, number>, byId: ById, scale: Scale) {
  const setPiece = upgradeSettings(state.settings).setPiece;
  const out: Record<string, ManagerLineup> = {};
  for (const t of state.teams) {
    const cur = lineups[t.id] ?? { ...draftedLineup(t), auto: true };
    out[t.id] = t.cpu || cur.auto ? { ...bestLineup(t, cur.formation, byId, scale, form, setPiece), auto: cur.auto || t.cpu } : cur;
  }
  return out;
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
  const fill = centerFillRatings(drafted, fillTeams(state, candidates, byId, scale, DRAFT_LIMITS.leagueSize));
  const fillTeamsStored: ManagerFillTeam[] = fill.map((t) => ({
    name: t.name,
    rating: t.rating,
    ...(t.player ? { player: t.player } : {}),
    ...(t.playerEntry ? { playerEntry: t.playerEntry } : {}),
    squad: (t.squad ?? []).map((s) => ({ pokemonId: s.pokemonId, pos: s.pos })),
    ss: t.setPieceTaker?.pokemonId ?? null,
  }));
  const n = state.teams.length + fill.length;
  const form = rosterForm(state, 1);
  const lineups = refreshAuto(state, {}, form, byId, scale);
  const teams = [...drafted, ...fill];
  const manager: ManagerState = { played: 0, total: managerSchedule(n).length, lineups, form, fill: fillTeamsStored };
  const league: LeagueResult = { teams: compactTeams(teams), matches: [], table: buildTable(compactTeams(teams), []) };
  return { ...state, manager, league };
}

const squadPlayer = (p: Pokemon, pos: PosCode): SquadPlayer => ({ pokemonId: p.id, pos, atk: p.atk, spa: p.spa });

/** Liga-Teams eines Spieltags: gedraftete nach Aufstellung, Auffüllteams fest – jeweils mit Tagesform. */
function matchdayTeams(state: DraftState, m: ManagerState, matchday: number, byId: ById, scale: Scale): LeagueTeam[] {
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
      rating: lineupScore(squad, scale, formOf),
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

/** Den nächsten Spieltag spielen (Server, zum Anpfiff). Nach dem letzten: Phase „done". */
export function playMatchday(before: DraftState, list: Pokemon[], scale: Scale): DraftState {
  if (before.phase !== 'season' || !before.manager || !before.league || before.manager.played >= before.manager.total) return before;
  // Zuerst der Transfermarkt (Wünsche in Tabellen-Reihenfolge), dann wird gespielt
  const state = processClaims(before, list, scale);
  const m = state.manager!;
  if (!state.league) return state;
  const byId = new Map(list.map((p) => [p.id, p]));
  const k = m.played + 1;
  // Zum Anpfiff gilt die Form dieses Spieltags (auto-Aufstellungen sind schon darauf gestellt)
  const lineups = refreshAuto(state, m.lineups, rosterForm(state, k), byId, scale);
  const playedNow = Object.fromEntries(Object.entries(lineups).map(([id, l]) => [id, { formation: l.formation, slots: [...l.slots] }]));
  const cur: ManagerState = { ...m, lineups, playedLineups: { ...(m.playedLineups ?? {}), [k]: playedNow } };
  const teams = matchdayTeams(state, cur, k, byId, scale);
  const form = teamForm(state.seed, teams.length, k);
  const rng = leagueRng(state.seed, 'md', k);
  const round = managerSchedule(teams.length)[k - 1] ?? [];
  const played = round.map(([h, a]) => playMatch(rng, teams, k, h, a, false, DRAFT_MODEL, form));
  const matches = [...state.league.matches, ...played];
  const compact = compactTeams(teams);
  const league: LeagueResult = { teams: compact, matches, table: buildTable(compact, matches) };
  if (k >= m.total) {
    return { ...state, phase: 'done', league, manager: { ...cur, played: k, form: {} } };
  }
  const nextForm_ = rosterForm(state, k + 1);
  return {
    ...state,
    league,
    manager: { ...cur, played: k, form: nextForm_, lineups: refreshAuto(state, lineups, nextForm_, byId, scale) },
  };
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
    lineup = { ...bestLineup(team, input.formation, byId, scale, m.form, setPiece), auto: true };
  } else {
    const l = { formation: input.formation, slots: input.slots, ss: setPiece ? input.ss : null };
    const err = lineupError(team, l, setPiece);
    if (err) fail('bad_lineup', err);
    lineup = { ...l, slots: [...l.slots], auto: false };
  }
  return { ...state, manager: { ...m, lineups: { ...m.lineups, [teamId]: lineup } } };
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
