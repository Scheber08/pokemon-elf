/**
 * Draft-Engine – reine, deterministische Logik des Online-Fantasy-Drafts.
 *
 * Der Server (Durable Object „DraftRoom") ist die einzige Instanz, die den Zustand
 * ändert; er ruft diese Funktionen auf und verschickt danach Schnappschüsse. Der
 * Browser nutzt dieselben Funktionen nur zum Anzeigen (wer ist dran, freie Slots,
 * Pool) und um ältere Saisons ohne gespeichertes Ergebnis nachzusimulieren. Kein
 * Math.random, keine Uhr: Zeit und IDs kommen von außen, Zufall aus dem Liga-Seed
 * (leagueRng – ein geheimer Text-Seed wird per SHA-256 je Zweck abgeleitet).
 */
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { POSITIONS } from '../config/positions';
import { CLUB_NAMES } from '../config/season';
import type { FormationId, Pokemon, RegionFilter } from '../types';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_LIMITS,
  type DraftPhase,
  type DraftPickLog,
  type DraftSeason,
  type DraftSettings,
  type DraftSnapshot,
  type DraftTeam,
} from './api/draftContract';
import { positionFit, type Scale } from './fit';
import { createRng, hashSeed, shuffle, streamRng } from './rng';
import { simulateLeague, type LeagueResult, type LeagueTeam } from './season';
import { evaluateTeam } from './teamScore';

/** Slot-Index des Standardschützen */
export const DRAFT_SS_SLOT = 11;

/** Interner Zustand (Server). Enthält die Geräte-Zuordnung, die nie verschickt wird. */
export interface DraftState {
  code: string;
  /**
   * Liga-Seed: Reihenfolge, CPU-Zufall und Saison leiten sich davon ab (leagueSeed).
   * Der Server nimmt einen geheimen Text (32 Zufallsbytes hex), ältere Ligen eine Zahl.
   */
  seed: number | string;
  phase: DraftPhase;
  settings: DraftSettings;
  teams: DraftTeam[];
  /** Team-ID → Geräte-ID (nur menschliche Teams) */
  owners: Record<string, string>;
  hostTeamId: string | null;
  pickIndex: number;
  deadline: number | null;
  picks: DraftPickLog[];
  season: DraftSeason | null;
  createdAt: number;
  /** Vom Host entfernte Geräte – dürfen dieser Liga nicht wieder beitreten */
  banned?: string[];
  /** Beginn des aktuellen Zugs (nur während des Drafts) */
  turnStartedAt?: number | null;
  /** Gespeichertes Saisonergebnis (ab „done", kompakt: Teams ohne Kader) */
  league?: LeagueResult | null;
}

/** Lesende Sicht – passt auf den Server-Zustand und auf Client-Schnappschüsse. */
export type DraftView = Pick<DraftState, 'phase' | 'teams' | 'pickIndex' | 'settings'>;

export class DraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

const fail = (code: string, message: string): never => {
  throw new DraftError(code, message);
};

// ---------------------------------------------------------------- Zufall der Liga

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 (synchron, klein) – die acht 32-Bit-Wörter des Hashs. */
export function sha256Words(text: string): Uint32Array {
  const bytes = new TextEncoder().encode(text);
  const blocks = (bytes.length + 9 + 63) >> 6;
  const w = new Uint32Array(blocks * 16);
  bytes.forEach((b, i) => (w[i >> 2] |= b << (24 - (i & 3) * 8)));
  w[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  w[blocks * 16 - 2] = Math.floor((bytes.length * 8) / 2 ** 32);
  w[blocks * 16 - 1] = bytes.length * 8;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const m = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) {
        m[i] = w[b * 16 + i];
      } else {
        const x = m[i - 15];
        const y = m[i - 2];
        m[i] = m[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + m[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10));
      }
    }
    let [a, b1, b2, b3, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + m[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b1) ^ (a & b2) ^ (b1 & b2))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (b3 + t1) | 0;
      b3 = b2;
      b2 = b1;
      b1 = a;
      a = (t1 + t2) | 0;
    }
    [a, b1, b2, b3, e, f, g, hh].forEach((v, i) => (h[i] += v));
  }
  return h;
}

/**
 * 31-Bit-Seed der Liga für einen Zweck. Zahl (ältere Ligen, Tests): wie hashSeed.
 * Geheimer Text-Seed: SHA-256 – so verrät ein Zweck (sichtbare Reihenfolge, CPU-Picks)
 * nichts über einen anderen (Saison), auch nicht per Durchprobieren.
 */
export function leagueSeed(seed: number | string, ...parts: (string | number)[]): number {
  if (typeof seed === 'number') return hashSeed(seed, ...parts);
  return sha256Words([seed, ...parts].join('|'))[0] & 0x7fffffff;
}

/** Zufallsstrom der Liga für einen Zweck (siehe leagueSeed). */
export const leagueRng = (seed: number | string, ...parts: (string | number)[]) => createRng(leagueSeed(seed, ...parts));

// ---------------------------------------------------------------- Einstellungen & Pool

export function rounds(settings: DraftSettings): number {
  return 11 + (settings.setPiece ? 1 : 0);
}

const poolCache = new WeakMap<Pokemon[], Map<string, Pokemon[]>>();

/** Pool der Liga (nach Nummer sortiert). */
export function poolOf(settings: Pick<DraftSettings, 'region' | 'legends'>, list: Pokemon[]): Pokemon[] {
  let byKey = poolCache.get(list);
  if (!byKey) {
    byKey = new Map();
    poolCache.set(list, byKey);
  }
  const key = `${settings.region}|${settings.legends}`;
  let pool = byKey.get(key);
  if (!pool) {
    pool = list
      .filter((p) => (settings.region === 0 || p.gen === settings.region) && (settings.legends || (!p.leg && !p.myth)))
      .sort((a, b) => a.id - b.id);
    byKey.set(key, pool);
  }
  return pool;
}

/** Wie viele Teams der Pool höchstens trägt. */
export function maxTeamsForPool(settings: DraftSettings, list: Pokemon[]): number {
  return Math.floor(poolOf(settings, list).length / rounds(settings));
}

/** Prüft und vervollständigt Einstellungen (wirft DraftError bei Unsinn). */
export function normalizeSettings(patch: Partial<DraftSettings>, base: DraftSettings, list: Pokemon[]): DraftSettings {
  const s: DraftSettings = { ...base };
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') fail('bad_settings', 'Ungültiger Liganame');
    // Nach Codepoints kürzen – nie mitten in einem Ersatzpaar (Emoji)
    s.name = Array.from(patch.name).slice(0, DRAFT_LIMITS.leagueNameMax).join('');
  }
  if (patch.region !== undefined) {
    if (!Number.isInteger(patch.region) || patch.region < 0 || patch.region > 9) fail('bad_settings', 'Ungültige Region');
    s.region = patch.region as RegionFilter;
  }
  for (const key of ['legends', 'setPiece'] as const) {
    if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'boolean') fail('bad_settings', 'Ungültige Einstellung');
      s[key] = patch[key] as boolean;
    }
  }
  if (patch.maxTeams !== undefined) {
    if (!Number.isInteger(patch.maxTeams) || patch.maxTeams < DRAFT_LIMITS.minTeams || patch.maxTeams > DRAFT_LIMITS.maxTeams) {
      fail('bad_settings', `Zwischen ${DRAFT_LIMITS.minTeams} und ${DRAFT_LIMITS.maxTeams} Teams`);
    }
    s.maxTeams = patch.maxTeams;
  }
  if (patch.pickSeconds !== undefined) {
    if (!(DRAFT_LIMITS.pickSeconds as readonly number[]).includes(patch.pickSeconds)) fail('bad_settings', 'Ungültiger Timer');
    s.pickSeconds = patch.pickSeconds;
  }
  if (patch.order !== undefined) {
    if (patch.order !== 'random' && patch.order !== 'host') fail('bad_settings', 'Ungültige Reihenfolge');
    s.order = patch.order;
  }
  if (patch.visibility !== undefined) {
    if (patch.visibility !== 'private' && patch.visibility !== 'public') fail('bad_settings', 'Ungültige Sichtbarkeit');
    s.visibility = patch.visibility;
  }
  const fits = maxTeamsForPool(s, list);
  if (s.maxTeams > fits) {
    fail('pool_too_small', `Der Pool reicht nur für ${fits} Teams à ${rounds(s)} Pokémon`);
  }
  return s;
}

// ---------------------------------------------------------------- Lobby

export interface NewTeam {
  teamId: string;
  deviceId: string;
  name: string;
  formation: FormationId;
}

function assertFormation(f: unknown): asserts f is FormationId {
  if (typeof f !== 'string' || !(FORMATION_IDS as readonly string[]).includes(f)) fail('bad_formation', 'Ungültige Formation');
}

function makeTeam(id: string, name: string, formation: FormationId, cpu: boolean): DraftTeam {
  return { id, name, formation, cpu, online: cpu, slots: FORMATIONS[formation].slots.map(() => null), ss: null };
}

export function createDraft(args: {
  code: string;
  seed: number | string;
  settings: Partial<DraftSettings>;
  host: NewTeam;
  now: number;
  list: Pokemon[];
}): DraftState {
  assertFormation(args.host.formation);
  const settings = normalizeSettings(args.settings, DEFAULT_DRAFT_SETTINGS, args.list);
  // Der Host ist noch nicht verbunden – ab jetzt zählt seine Abwesenheit (Host-Wechsel, Lobby-Liste).
  const host: DraftTeam = { ...makeTeam(args.host.teamId, args.host.name, args.host.formation, false), offlineSince: args.now };
  return {
    code: args.code,
    seed: args.seed,
    phase: 'lobby',
    settings,
    teams: [host],
    owners: { [args.host.teamId]: args.host.deviceId },
    hostTeamId: args.host.teamId,
    pickIndex: 0,
    deadline: null,
    picks: [],
    season: null,
    createdAt: args.now,
  };
}

/** Team des Geräts oder null. */
export function teamOfDevice(state: DraftState, deviceId: string): string | null {
  for (const [teamId, owner] of Object.entries(state.owners)) if (owner === deviceId) return teamId;
  return null;
}

function requireLobby(state: DraftState) {
  if (state.phase !== 'lobby') fail('not_lobby', 'Der Draft hat schon begonnen');
}

function requireHost(state: DraftState, deviceId: string) {
  const team = teamOfDevice(state, deviceId);
  if (!team || team !== state.hostTeamId) fail('not_host', 'Das darf nur der Host');
}

export function joinDraft(state: DraftState, t: NewTeam): DraftState {
  requireLobby(state);
  assertFormation(t.formation);
  if (teamOfDevice(state, t.deviceId)) fail('already_joined', 'Du bist schon in dieser Liga');
  if (state.banned?.includes(t.deviceId)) fail('banned', 'Der Host hat dich aus dieser Liga entfernt');
  if (state.teams.length >= state.settings.maxTeams) fail('league_full', 'Die Liga ist voll');
  return {
    ...state,
    teams: [...state.teams, makeTeam(t.teamId, t.name, t.formation, false)],
    owners: { ...state.owners, [t.teamId]: t.deviceId },
  };
}

/** Verlassen: in der Lobby wird das Team entfernt (Host wandert weiter), später bleibt es stehen. */
export function leaveDraft(state: DraftState, deviceId: string): DraftState {
  const teamId = teamOfDevice(state, deviceId);
  if (!teamId) return state;
  if (state.phase !== 'lobby') return state;
  const owners = { ...state.owners };
  delete owners[teamId];
  const teams = state.teams.filter((t) => t.id !== teamId);
  let hostTeamId = state.hostTeamId;
  if (hostTeamId === teamId) hostTeamId = teams.find((t) => !t.cpu)?.id ?? null;
  return { ...state, teams, owners, hostTeamId };
}

export function updateTeam(
  state: DraftState,
  deviceId: string,
  patch: { name?: string; formation?: FormationId },
): DraftState {
  requireLobby(state);
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga noch nicht dabei');
  if (patch.formation !== undefined) assertFormation(patch.formation);
  return {
    ...state,
    teams: state.teams.map((t) =>
      t.id === teamId
        ? {
            ...t,
            name: patch.name ?? t.name,
            ...(patch.formation ? { formation: patch.formation, slots: FORMATIONS[patch.formation].slots.map(() => null) } : {}),
          }
        : t,
    ),
  };
}

export function updateSettings(
  state: DraftState,
  deviceId: string,
  patch: Partial<DraftSettings>,
  list: Pokemon[],
): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  const settings = normalizeSettings(patch, state.settings, list);
  if (settings.maxTeams < state.teams.length) fail('too_many_teams', `Es sind schon ${state.teams.length} Teams dabei`);
  return { ...state, settings };
}

/**
 * Fügt ein CPU-Team hinzu. Name und Formation leiten sich aus dem (öffentlichen) Liga-Code
 * ab – nie aus dem geheimen Seed, sonst ließe er sich aus ihnen zurückrechnen.
 */
export function addCpuTeam(state: DraftState, deviceId: string, teamId: string): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (state.teams.length >= state.settings.maxTeams) fail('league_full', 'Die Liga ist voll');
  const taken = new Set(state.teams.map((t) => t.name));
  const name = shuffle(streamRng(state.code, 'cpu-names'), CLUB_NAMES).find((n) => !taken.has(n)) ?? `CPU ${state.teams.length + 1}`;
  const cpuCount = state.teams.filter((t) => t.cpu).length;
  const formation = FORMATION_IDS[hashSeed(state.code, 'cpu-formation', cpuCount) % FORMATION_IDS.length];
  return { ...state, teams: [...state.teams, makeTeam(teamId, name, formation, true)] };
}

/** Höchstens so viele gesperrte Geräte pro Liga (die ältesten fallen heraus) */
const MAX_BANNED = 64;

/** Entfernt ein Team; ein Mensch wird für diese Liga gesperrt (kein erneuter Beitritt). */
export function removeTeam(state: DraftState, deviceId: string, teamId: string): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (teamId === state.hostTeamId) fail('cannot_remove_host', 'Der Host kann sich nicht selbst entfernen');
  if (!state.teams.some((t) => t.id === teamId)) fail('no_team', 'Dieses Team gibt es nicht');
  const owners = { ...state.owners };
  const kicked = owners[teamId];
  delete owners[teamId];
  const next: DraftState = { ...state, teams: state.teams.filter((t) => t.id !== teamId), owners };
  if (kicked) next.banned = [...(state.banned ?? []).filter((d) => d !== kicked), kicked].slice(-MAX_BANNED);
  return next;
}

export function setOrder(state: DraftState, deviceId: string, order: string[]): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  const ids = state.teams.map((t) => t.id);
  if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || !order.every((id) => ids.includes(id))) {
    fail('bad_order', 'Die Reihenfolge muss jedes Team genau einmal enthalten');
  }
  const byId = new Map(state.teams.map((t) => [t.id, t]));
  return { ...state, teams: order.map((id) => byId.get(id)!) };
}

/** Online-Flag eines Menschen; mit `now` wird auch offlineSince gepflegt (seit wann offline). */
export function setOnline(state: DraftState, teamId: string, online: boolean, now?: number): DraftState {
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId || t.cpu) return t;
      if (now === undefined) return { ...t, online };
      if (online) {
        const { offlineSince: _gone, ...rest } = t;
        return { ...rest, online };
      }
      return { ...t, online, offlineSince: t.online || t.offlineSince == null ? now : t.offlineSince };
    }),
  };
}

/** Seit wann ein Mensch offline ist (ältere Stände ohne Zeitpunkt: seit jeher); null = online bzw. CPU. */
function offlineFrom(t: DraftTeam): number | null {
  if (t.cpu || t.online) return null;
  return t.offlineSince ?? -Infinity;
}

/**
 * Host-Rolle weiterreichen: Ist der Host (Lobby oder Draft) seit DRAFT_LIMITS.hostGraceMs
 * offline, wird der erste verbundene Mensch Host. Sonst unverändert.
 */
export function transferHost(state: DraftState, now: number): DraftState {
  const at = hostTransferAt(state);
  if (at == null || now < at) return state;
  const next = state.teams.find((t) => !t.cpu && t.online && t.id !== state.hostTeamId && state.owners[t.id]);
  return next ? { ...state, hostTeamId: next.id } : state;
}

/** Ab wann die Host-Rolle wandern darf (Host offline bzw. weg) – null, solange der Host da ist. */
export function hostTransferAt(state: DraftState): number | null {
  if (state.phase === 'done') return null;
  const host = state.teams.find((t) => t.id === state.hostTeamId);
  const away = host ? offlineFrom(host) : -Infinity;
  const grace = state.phase === 'lobby' ? DRAFT_LIMITS.lobbyHostGraceMs : DRAFT_LIMITS.hostGraceMs;
  return away == null ? null : away + grace;
}

/**
 * Ab wann andere Mitglieder für das Team am Zug auto-picken dürfen: CPU sofort, ein
 * Mensch nach DRAFT_LIMITS.offlineGraceMs offline – ohne Timer auch, wenn sein Zug
 * DRAFT_LIMITS.afkMs alt ist. null = gerade nicht (online mit Timer, oder kein Draft).
 */
export function autoPickOpensAt(state: DraftState): number | null {
  const cur = currentTeam(state);
  if (!cur) return null;
  if (cur.cpu) return -Infinity;
  const away = offlineFrom(cur);
  const times: number[] = [];
  if (away != null) times.push(away + DRAFT_LIMITS.offlineGraceMs);
  if (!state.settings.pickSeconds && state.turnStartedAt != null) times.push(state.turnStartedAt + DRAFT_LIMITS.afkMs);
  return times.length ? Math.min(...times) : null;
}

/** Darf das Team `teamId` (ein Mitglied) jetzt für das Team am Zug auto-picken? */
export function mayAutoPick(state: DraftState, teamId: string | null, now: number): boolean {
  const cur = currentTeam(state);
  if (!cur || !teamId || !state.owners[teamId]) return false;
  if (cur.id === teamId) return true;
  const at = autoPickOpensAt(state);
  return at != null && now >= at;
}

// ---------------------------------------------------------------- Draft

export function totalPicks(state: Pick<DraftState, 'teams' | 'settings'>): number {
  return state.teams.length * rounds(state.settings);
}

/** Team am Zug für einen Pick-Index (Snake: Runde 2 rückwärts). */
export function teamIndexForPick(pick: number, teamCount: number): number {
  const round = Math.floor(pick / teamCount);
  const idx = pick % teamCount;
  return round % 2 === 0 ? idx : teamCount - 1 - idx;
}

export function currentTeam(state: DraftView): DraftTeam | null {
  if (state.phase !== 'drafting') return null;
  return state.teams[teamIndexForPick(state.pickIndex, state.teams.length)] ?? null;
}

export function draftedIds(state: Pick<DraftState, 'teams'>): Set<number> {
  const ids = new Set<number>();
  for (const t of state.teams) {
    for (const id of t.slots) if (id != null) ids.add(id);
    if (t.ss != null) ids.add(t.ss);
  }
  return ids;
}

export function freeSlots(team: DraftTeam, settings: DraftSettings): number[] {
  const out = team.slots.flatMap((id, i) => (id == null ? [i] : []));
  if (settings.setPiece && team.ss == null) out.push(DRAFT_SS_SLOT);
  return out;
}

/** Zeitpunkt, bis zu dem der aktuelle Pick fallen muss (nur menschliche Teams mit Timer). */
function deadlineFor(state: DraftState, now: number): number | null {
  const team = currentTeam(state);
  if (!team || team.cpu || !state.settings.pickSeconds) return null;
  return now + state.settings.pickSeconds * 1000;
}

export function startDraft(state: DraftState, deviceId: string, now: number, list: Pokemon[]): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (state.teams.length < DRAFT_LIMITS.minTeams) fail('too_few_teams', `Mindestens ${DRAFT_LIMITS.minTeams} Teams – lade Leute ein oder füge CPU-Teams hinzu`);
  const needed = state.teams.length * rounds(state.settings);
  const pool = poolOf(state.settings, list).length;
  if (pool < needed) fail('pool_too_small', `Der Pool hat nur ${pool} Pokémon, gebraucht werden ${needed}`);
  const teams = state.settings.order === 'random' ? shuffle(leagueRng(state.seed, 'order'), state.teams) : state.teams;
  const next: DraftState = {
    ...state,
    phase: 'drafting',
    teams: teams.map((t) => ({ ...t, slots: FORMATIONS[t.formation].slots.map(() => null), ss: null })),
    pickIndex: 0,
    picks: [],
    turnStartedAt: now,
  };
  return { ...next, deadline: deadlineFor(next, now) };
}

/** Grund, warum dieser Pick nicht geht – oder null. */
export function pickError(state: DraftView, teamId: string, pokemonId: number, slot: number, list: Pokemon[]): string | null {
  if (state.phase !== 'drafting') return 'Gerade wird nicht gedraftet';
  const team = currentTeam(state);
  if (!team || team.id !== teamId) return 'Du bist nicht dran';
  if (!Number.isInteger(pokemonId) || !Number.isInteger(slot)) return 'Ungültiger Pick';
  const p = poolOf(state.settings, list).find((x) => x.id === pokemonId);
  if (!p) return 'Dieses Pokémon ist nicht im Pool';
  if (draftedIds(state).has(pokemonId)) return `${p.de} ist schon vergeben`;
  if (!freeSlots(team, state.settings).includes(slot)) return 'Dieser Platz ist nicht frei';
  return null;
}

export function applyPick(
  state: DraftState,
  teamId: string,
  pokemonId: number,
  slot: number,
  auto: boolean,
  now: number,
  list: Pokemon[],
): DraftState {
  const err = pickError(state, teamId, pokemonId, slot, list);
  if (err) fail('bad_pick', err);
  const teams = state.teams.map((t) =>
    t.id !== teamId
      ? t
      : slot === DRAFT_SS_SLOT
        ? { ...t, ss: pokemonId }
        : { ...t, slots: t.slots.map((v, i) => (i === slot ? pokemonId : v)) },
  );
  const picks = [...state.picks, { pick: state.pickIndex, teamId, pokemonId, slot, auto, at: now }];
  const pickIndex = state.pickIndex + 1;
  const next: DraftState = { ...state, teams, picks, pickIndex, turnStartedAt: now };
  if (pickIndex >= totalPicks(next)) {
    return {
      ...next,
      phase: 'done',
      deadline: null,
      turnStartedAt: null,
      season: {
        seed: leagueSeed(state.seed, 'season'),
        startsAt: now + DRAFT_LIMITS.seasonLeadMs,
        stepMs: DRAFT_LIMITS.seasonStepMs,
      },
    };
  }
  return { ...next, deadline: deadlineFor(next, now) };
}

/**
 * Automatische Wahl: bestes Pokémon für den Slot, der es am meisten braucht –
 * bewertet wie der Team-Score (Fit × Positionsgewicht). CPU-Teams bekommen etwas
 * Zufall aus dem Liga-Seed, Auto-Picks für Menschen (Timer) nicht.
 */
export function autoPickChoice(
  state: DraftState,
  teamId: string,
  list: Pokemon[],
  scale: Scale,
  withNoise: boolean,
): { pokemonId: number; slot: number } {
  const team = state.teams.find((t) => t.id === teamId) ?? fail('no_team', 'Dieses Team gibt es nicht');
  const taken = draftedIds(state);
  const pool = poolOf(state.settings, list).filter((p) => !taken.has(p.id));
  if (!pool.length) fail('pool_empty', 'Keine Pokémon mehr im Pool');
  const rng = withNoise ? leagueRng(state.seed, 'cpu', state.pickIndex) : null;
  const defs = FORMATIONS[team.formation].slots;
  let best: { score: number; pokemonId: number; slot: number } | null = null;
  for (const slot of freeSlots(team, state.settings)) {
    const pos = slot === DRAFT_SS_SLOT ? 'SS' : defs[slot].pos;
    // Standardschütze zählt nicht zum Team-Score → erst ganz am Ende besetzen
    const weight = pos === 'SS' ? 0.5 : 0.92 + 0.08 * POSITIONS[pos].teamWeight;
    for (const p of pool) {
      const noise = rng ? (rng() - 0.5) * 8 : 0;
      const score = positionFit(p, pos, scale) * weight + noise;
      if (!best || score > best.score || (score === best.score && p.id < best.pokemonId)) {
        best = { score, pokemonId: p.id, slot };
      }
    }
  }
  return { pokemonId: best!.pokemonId, slot: best!.slot };
}

// ---------------------------------------------------------------- Saison & Ausgabe

/** Liga-Teams mit Rating (Team-Score) und Kader für die Saison-Simulation. */
export function leagueTeams(state: Pick<DraftState, 'teams' | 'settings'>, byId: Map<number, Pokemon>, scale: Scale): LeagueTeam[] {
  return state.teams.map((t) => {
    const players = t.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
    const ev = evaluateTeam(t.formation, players, scale);
    const defs = FORMATIONS[t.formation].slots;
    const ss = t.ss != null ? byId.get(t.ss) : undefined;
    return {
      name: t.name,
      rating: ev.score,
      squad: players.flatMap((p, i) => (p ? [{ pokemonId: p.id, pos: defs[i].pos, atk: p.atk, spa: p.spa }] : [])),
      setPieceTaker: ss ? { pokemonId: ss.id, pos: 'SS' as const, atk: ss.atk, spa: ss.spa } : null,
      setPieceFit: ss ? positionFit(ss, 'SS', scale) : undefined,
    };
  });
}

/** Die gemeinsame Saison – auf jedem Client identisch (gleicher Seed, gleiche Daten). */
export function draftSeason(
  state: Pick<DraftState, 'teams' | 'settings'> & { season: DraftSeason | null },
  byId: Map<number, Pokemon>,
  scale: Scale,
): LeagueResult | null {
  if (!state.season) return null;
  return simulateLeague(leagueTeams(state, byId, scale), createRng(state.season.seed));
}

const byIdCache = new WeakMap<Pokemon[], Map<number, Pokemon>>();

/**
 * Am Ende des Drafts: Saison einmal berechnen und kompakt speichern (Teams ohne Kader –
 * Tabelle, Spiele und Torschützen bleiben). So ändert ein späterer Deploy das Ergebnis nicht.
 */
export function withLeague(state: DraftState, list: Pokemon[], scale: Scale): DraftState {
  if (state.phase !== 'done' || !state.season || state.league) return state;
  let byId = byIdCache.get(list);
  if (!byId) {
    byId = new Map(list.map((p) => [p.id, p]));
    byIdCache.set(list, byId);
  }
  const full = draftSeason(state, byId, scale);
  if (!full) return state;
  return { ...state, league: { ...full, teams: full.teams.map((t) => ({ name: t.name, rating: t.rating })) } };
}

/** Schnappschuss für einen Client – ohne Geräte-IDs (und ohne Sperrliste). */
export function snapshotOf(state: DraftState, you: string | null, now: number): DraftSnapshot {
  return {
    code: state.code,
    phase: state.phase,
    settings: state.settings,
    teams: state.teams,
    hostTeamId: state.hostTeamId,
    pickIndex: state.pickIndex,
    totalPicks: state.phase === 'lobby' ? 0 : totalPicks(state),
    deadline: state.deadline,
    picks: state.picks,
    season: state.season,
    createdAt: state.createdAt,
    serverNow: now,
    you,
    ...(state.phase === 'drafting' ? { turnStartedAt: state.turnStartedAt ?? null } : {}),
    ...(state.league ? { league: state.league, ratings: state.league.teams.map((t) => t.rating) } : {}),
  };
}
