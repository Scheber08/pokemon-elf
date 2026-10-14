/**
 * Live-Verbindung zu einer Online-Liga (/draft/:code): Schnappschüsse vom Server,
 * Verbindungsstatus, Uhren-Offset und Senden der Aktionen. Der Server ist maßgeblich;
 * die Draft-Engine dient hier nur der Anzeige und einer Vorprüfung (Pick am falschen
 * Platz, nicht dran …), damit Fehler sofort und ohne Umweg über den Server erscheinen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '../lib/api/client';
import {
  connectDraft,
  fetchDraftSnapshot,
  isDraftCode,
  type DraftConnection,
} from '../lib/api/draftClient';
import {
  DRAFT_LIMITS,
  type DraftActiveRoll,
  type DraftClientMessage,
  type DraftPickLog,
  type DraftReaction,
  type DraftRerollKind,
  type DraftSettings,
  type DraftSnapshot,
  type DraftTeam,
  type ManagerLineup,
} from '../lib/api/draftContract';
import {
  applyReroll,
  currentTeam,
  DraftError,
  draftedIds,
  maxTeamsForPool,
  pickError,
  poolOf,
  poolPickCapacity,
  rounds,
  sameSettingValue,
  teamIndexForPick,
  type DraftState,
} from '../lib/draftEngine';
import { DEFAULT_FORMATION, FORMATION_IDS } from '../config/formations';
import { currentLang, LANGS, messages, type Lang, type Messages } from '../i18n';
import { load, save } from '../lib/storage';
import type { FormationId, Pokemon, TypeKey } from '../types';
import { usePokemonData } from './PokemonData';
import type { Crest } from '../lib/crest';

export type DraftRoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'not_found';

/** So lange bleibt eine Fehlermeldung des Servers stehen */
export const DRAFT_ERROR_MS = 6000;
/** So lange wartet eine gesendete Aktion höchstens auf die Antwort, dann wird sie wieder frei */
export const DRAFT_ACTION_TIMEOUT_MS = 10_000;
/** Existenzprüfung per HTTP, solange keine angemeldete Verbindung steht: Pausen nach Fehlern … */
export const CHECK_RETRY_BASE_MS = 2000;
export const CHECK_RETRY_MAX_MS = 30_000;
/** … und nach einer erfolgreichen Prüfung (Vorschau auffrischen, gelöschte Liga erkennen) */
export const CHECK_REFRESH_MS = 30_000;

// ---------------------------------------------------------------- reine Helfer (testbar)

export interface DraftRoomView {
  /** Eigenes Team (null = Zuschauer / noch nicht beigetreten) */
  me: DraftTeam | null;
  isHost: boolean;
  /** Team am Zug (nur während des Drafts) */
  current: DraftTeam | null;
  currentIndex: number;
  myTurn: boolean;
  /** Laufende Runde und Pick (1-basiert, auf das Ende begrenzt) */
  round: number;
  rounds: number;
  pickNo: number;
  totalPicks: number;
  lastPick: DraftPickLog | null;
  /** Lobby voll */
  full: boolean;
}

export function draftRoomView(s: DraftSnapshot | null): DraftRoomView {
  if (!s) {
    return {
      me: null,
      isHost: false,
      current: null,
      currentIndex: -1,
      myTurn: false,
      round: 0,
      rounds: 0,
      pickNo: 0,
      totalPicks: 0,
      lastPick: null,
      full: false,
    };
  }
  const me = s.you ? s.teams.find((t) => t.id === s.you) ?? null : null;
  const current = currentTeam(s);
  const n = s.teams.length;
  const r = rounds(s.settings);
  const total = s.totalPicks || n * r;
  const pick = Math.min(s.pickIndex, Math.max(0, total - 1));
  return {
    me,
    isHost: !!me && me.id === s.hostTeamId,
    current,
    currentIndex: current && n ? teamIndexForPick(s.pickIndex, n, s.settings.snake ?? true) : -1,
    myTurn: !!me && !!current && current.id === me.id,
    round: n ? Math.floor(pick / n) + 1 : 0,
    rounds: r,
    pickNo: total ? pick + 1 : 0,
    totalPicks: total,
    lastPick: s.picks.length ? s.picks[s.picks.length - 1] : null,
    full: s.teams.length >= s.settings.maxTeams,
  };
}

/** Warum der Host (noch) nicht starten kann – oder null. */
export function startBlocker(s: DraftSnapshot, list: Pokemon[], t: Messages = messages()): string | null {
  if (s.phase !== 'lobby') return t.online.draftRunning;
  if (s.teams.length < DRAFT_LIMITS.minTeams) return t.online.server.fmt.tooFewTeams(DRAFT_LIMITS.minTeams);
  const needed = s.teams.length * rounds(s.settings);
  const pool = poolOf(s.settings, list).length;
  if (pool < needed) return t.online.server.fmt.poolHas(pool, needed);
  // Wie startDraft: Legendäre zählen nur, soweit das Legendären-Limit sie aufnimmt
  const capacity = poolPickCapacity(s.settings, s.teams.length, list);
  if (capacity < needed) return t.online.server.fmt.poolCapLegends(capacity, needed);
  return null;
}

type ServerTexts = Messages['online']['server'];
type FmtKey = keyof ServerTexts['fmt'];
type MsgKey = keyof ServerTexts['msg'];
type ClientKey = keyof Messages['online']['client'];

const fmtPatterns = new Map<FmtKey, RegExp>();

/** Muster einer deutschen Meldung mit Platzhaltern (aus dem deutschen Katalog): Platzhalter → Fanggruppe. */
function fmtPattern(key: FmtKey): RegExp {
  let re = fmtPatterns.get(key);
  if (!re) {
    const fn = messages('de').online.server.fmt[key] as (...args: string[]) => string;
    const marks = Array.from({ length: fn.length }, (_, i) => `\u0000${i}\u0000`);
    let src = fn(...marks).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of marks) src = src.replace(m, '(.+?)');
    re = new RegExp(`^${src}$`);
    fmtPatterns.set(key, re);
  }
  return re;
}

/**
 * Meldung von Server bzw. Draft-Engine in der aktiven Sprache. Sie kommen deutsch mit festem
 * Code: Auf Deutsch bleibt die Meldung unverändert. Sonst wird sie über die bekannten Meldungen,
 * die Muster mit Zahlen/Namen und zuletzt den Code übersetzt – Unbekanntes wird ein allgemeiner
 * Text. list: deutsche Pokémon-Namen in Meldungen („Glurak ist schon vergeben", „… passt nicht
 * zum Wurf") mitübersetzen.
 * Ersatzmeldungen des Draft-Clients (in der Sprache beim Abruf erzeugt) folgen der aktiven Sprache.
 * Leere Meldung ohne Code → '' (die Aufrufer haben eigene Ersatztexte).
 */
export function draftErrorText(
  message: string,
  code?: string,
  list?: readonly Pick<Pokemon, 'de' | 'en'>[],
  lang: Lang = currentLang(),
): string {
  const t = messages(lang);
  for (const l of LANGS) {
    const client = messages(l).online.client;
    const key = (Object.keys(client) as ClientKey[]).find((k) => client[k] === message);
    if (key) return t.online.client[key];
  }
  if (lang === 'de') return message;
  const source = messages('de').online.server;
  const server = t.online.server;
  const known = (Object.keys(source.msg) as MsgKey[]).find((k) => source.msg[k] === message);
  if (known) return server.msg[known];
  for (const key of Object.keys(source.fmt) as FmtKey[]) {
    const m = message ? fmtPattern(key).exec(message) : null;
    if (!m) continue;
    const args: (string | number)[] = m.slice(1).map((a) => (/^\d+$/.test(a) ? Number(a) : a));
    if (key === 'taken' || key === 'notRoll') {
      const p = list?.find((x) => x.de === args[0]);
      if (p) args[0] = t.game.pokemon(p);
    }
    return (server.fmt[key] as (...a: (string | number)[]) => string)(...args);
  }
  if (code && Object.hasOwn(server.code, code)) return server.code[code as keyof ServerTexts['code']];
  return message || code ? server.unknown : '';
}

/**
 * Fehler im Raum – erst beim Rendern Text (folgt so einem Sprachwechsel, während er zu sehen ist):
 * Meldung von Server bzw. Engine mit Code und/oder ein eigener Text (online.<fallback>), der auch
 * gilt, wenn die Meldung leer ist.
 */
interface RoomError {
  message?: string;
  code?: string;
  fallback?: 'noAnswer' | 'noConnection' | 'teamNameMissing' | 'unknownError' | 'authRejected';
}

function roomErrorText(e: RoomError, list?: readonly Pick<Pokemon, 'de' | 'en'>[]): string {
  const text = e.message || e.code ? draftErrorText(e.message ?? '', e.code, list) : '';
  return text || (e.fallback ? messages().online[e.fallback] : '');
}

/** Wie viele Teams der Pool mit diesen Einstellungen trägt (höchstens maxTeams-Grenze). */
export function poolCapacity(settings: DraftSettings, list: Pokemon[]): number {
  return Math.min(DRAFT_LIMITS.maxTeams, maxTeamsForPool(settings, list));
}

/**
 * Änderung der Einstellungen so ergänzen, dass sie passt: Reicht der Pool danach nicht mehr
 * für maxTeams, wird maxTeams mitgesenkt (nie unter minTeams bzw. die Zahl beigetretener
 * Teams). null = geht gar nicht (Pool zu klein für die Teams, die schon da sind).
 */
export function fitSettingsPatch(
  base: DraftSettings,
  patch: Partial<DraftSettings>,
  list: Pokemon[],
  teamsJoined = 0,
): Partial<DraftSettings> | null {
  const next = { ...base, ...patch };
  const floor = Math.max(DRAFT_LIMITS.minTeams, teamsJoined);
  const cap = poolCapacity(next, list);
  if (cap < floor) return null;
  if (next.maxTeams < floor) return null;
  if (next.maxTeams > cap) return { ...patch, maxTeams: cap };
  return patch;
}

export interface FeedItem {
  key: string;
  /** Pick-Nummer (1-basiert) */
  no: number;
  pokemon: string;
  team: string;
  teamId: string;
  auto: boolean;
  /** Wurf, unter dem gewählt wurde (Zufallsmodus) – Regionsname und Typ in der Sprache von t */
  roll?: { region: string; type: TypeKey };
}

/**
 * Anzeigename eines Teams: Vereinsnamen der CPU-Teams (intern deutsch gespeichert) in der Sprache
 * von t, selbst gewählte Namen unverändert.
 */
export function teamLabel(team: Pick<DraftTeam, 'name' | 'cpu'>, t: Messages = messages()): string {
  return team.cpu ? t.game.club(team.name) : team.name;
}

/** Die letzten Picks, neuester zuerst (Pokémon- und CPU-Vereinsnamen in der Sprache von t). */
export function pickFeed(s: DraftSnapshot, byId: Map<number, Pokemon>, limit = 8, t: Messages = messages()): FeedItem[] {
  const names = new Map(s.teams.map((tm) => [tm.id, teamLabel(tm, t)]));
  return s.picks
    .slice(-limit)
    .reverse()
    .map((p) => {
      const mon = byId.get(p.pokemonId);
      const item: FeedItem = {
        key: `${p.pick}-${p.pokemonId}`,
        no: p.pick + 1,
        pokemon: mon ? t.game.pokemon(mon) : `#${p.pokemonId}`,
        team: names.get(p.teamId) ?? '?',
        teamId: p.teamId,
        auto: p.auto,
      };
      if (p.roll) item.roll = { region: t.game.region[p.roll.gen] ?? '?', type: p.roll.type };
      return item;
    });
}

/** Pokémon-ID → Team, das es gedraftet hat. */
export function ownerOfPicks(s: Pick<DraftSnapshot, 'teams'>): Map<number, DraftTeam> {
  const out = new Map<number, DraftTeam>();
  for (const t of s.teams) {
    for (const id of t.slots) if (id != null) out.set(id, t);
    if (t.ss != null) out.set(t.ss, t);
    for (const id of t.bench ?? []) if (id != null) out.set(id, t);
  }
  return out;
}

/**
 * Schlüssel der vergebenen Pokémon samt Teamnamen – ändert sich nur bei Picks bzw. Umbenennung,
 * nicht bei jedem Schnappschuss (z. B. Online-Wechsel eines Teams).
 */
export function draftedKey(s: Pick<DraftSnapshot, 'teams'>): string {
  return s.teams.map((t) => `${t.id}:${t.name}:${t.slots.join(',')}:${t.ss ?? ''}:${t.bench?.join(',') ?? ''}`).join('|');
}

/** Teamname säubern: Leerraum zusammenfassen, auf die Höchstlänge kürzen. */
export function cleanTeamName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, DRAFT_LIMITS.teamNameMax);
}

export interface TeamPrefs {
  name: string;
  formation: FormationId;
}

const TEAM_PREFS_KEY = 'draft-online:team';

/** Zuletzt benutzter Teamname und Formation (Vorbelegung beim Erstellen/Beitreten). */
export function loadTeamPrefs(): TeamPrefs {
  const stored = load<Partial<TeamPrefs> | null>(TEAM_PREFS_KEY, null) ?? {};
  return {
    name: typeof stored.name === 'string' ? stored.name.slice(0, DRAFT_LIMITS.teamNameMax) : '',
    formation: FORMATION_IDS.includes(stored.formation as FormationId) ? (stored.formation as FormationId) : DEFAULT_FORMATION,
  };
}

export function saveTeamPrefs(prefs: TeamPrefs): void {
  save(TEAM_PREFS_KEY, { name: cleanTeamName(prefs.name), formation: prefs.formation });
}

export interface RecentLeague {
  code: string;
  /** Liganame (leer = ohne Namen) */
  name: string;
  /** Eigenes Team */
  team: string;
  phase: DraftSnapshot['phase'];
  /** Zuletzt gesehen (ms) */
  at: number;
  /** Spielmodus (fehlt bei älteren Einträgen = Liga) */
  format?: DraftSettings['format'];
}

const RECENT_KEY = 'draft-online:recent';
const RECENT_MAX = 6;

/** Ligen, in denen dieses Gerät mitspielt (nur lokal gemerkt, ältere als die Aufbewahrungszeit fallen weg). */
export function loadRecentLeagues(now = Date.now()): RecentLeague[] {
  const list = load<RecentLeague[] | null>(RECENT_KEY, null);
  if (!Array.isArray(list)) return [];
  const maxAge = DRAFT_LIMITS.retentionDays * 86_400_000;
  return list.filter((l) => l && typeof l.code === 'string' && typeof l.at === 'number' && now - l.at < maxAge).slice(0, RECENT_MAX);
}

export function rememberLeague(snap: DraftSnapshot, now = Date.now()): void {
  const me = snap.you ? snap.teams.find((t) => t.id === snap.you) : undefined;
  if (!me) return;
  const entry: RecentLeague = { code: snap.code, name: snap.settings.name, team: me.name, phase: snap.phase, at: now, format: snap.settings.format };
  const prev = loadRecentLeagues(now);
  const same = prev.find((l) => l.code === entry.code);
  // Nur speichern, wenn sich etwas Sichtbares ändert (nicht bei jedem Pick)
  if (same && same.name === entry.name && same.team === entry.team && same.phase === entry.phase && same.format === entry.format && now - same.at < 3_600_000) return;
  save(RECENT_KEY, [entry, ...prev.filter((l) => l.code !== entry.code)].slice(0, RECENT_MAX));
}

export function forgetLeague(code: string): void {
  save(
    RECENT_KEY,
    loadRecentLeagues().filter((l) => l.code !== code),
  );
}

/**
 * Darf die Raum-Seite den Stand schon zeigen? Den eigenen Schnappschuss (WebSocket) immer; die
 * öffentliche HTTP-Vorschau (ohne „du") erst, wenn der erste Aufbau nicht gleich klappt
 * (Neuversuch, abgelehnte Anmeldung, getrennt) – vorher kurz warten statt Zuschauer-Ansicht.
 */
export function draftRoomReady(room: Pick<DraftRoom, 'state' | 'live' | 'status' | 'authError'>): boolean {
  if (!room.state) return false;
  return room.live || room.status !== 'connecting' || room.authError != null;
}

/** Restzeit (ms) bis zur Deadline nach Serveruhr – null ohne Timer. */
export function remainingMs(deadline: number | null, clockOffset: number, now = Date.now()): number | null {
  if (deadline == null) return null;
  return Math.max(0, deadline - (now + clockOffset));
}

/**
 * Eine kurze Ansage pro Pick für Screenreader (einzige Live-Region des Drafts):
 * „Pick 3: Glurak an FC Blitz (automatisch). Am Zug: FC Donner." – „Am Zug" entfällt, wenn
 * man selbst dran ist (das meldet „Du bist dran!"). Im Zufallsmodus folgt der Wurf des neuen
 * Picks („Wurf: Kanto, Typ Feuer.") – so wird auch ein Reroll angesagt, und vor dem ersten Pick
 * steht nur der Wurf.
 */
export function pickAnnouncement(s: DraftSnapshot, byId: Map<number, Pokemon>, t: Messages = messages()): string {
  const last = s.picks.length ? s.picks[s.picks.length - 1] : null;
  const roll = s.phase === 'drafting' && s.roll ? `${t.online.rollAria(t.game.region[s.roll.gen] ?? '?', t.game.type[s.roll.type])}.` : '';
  if (!last) return roll;
  const owner = s.teams.find((x) => x.id === last.teamId);
  const team = last.teamId === s.you ? t.online.announceYou : owner ? teamLabel(owner, t) : '?';
  const mon = byId.get(last.pokemonId);
  const name = mon ? t.game.pokemon(mon) : `#${last.pokemonId}`;
  let text = t.online.announcePick(last.pick + 1, name, team, last.auto);
  const cur = currentTeam(s);
  if (cur && cur.id !== s.you) text += t.online.announceNext(teamLabel(cur, t));
  if (roll) text += ` ${roll}`;
  return text;
}

/**
 * Engine-Zustand aus einem Schnappschuss – nur zum Anzeigen und Vorprüfen (Vorschlag, Reroll).
 * Ohne Seed: Würfe und CPU-Zufall entscheidet allein der Server.
 */
export function snapshotState(s: DraftSnapshot): DraftState {
  // Manager-Saison: nur der Schnappschuss (ohne Auffüllteams) – die Engine braucht ihn hier nicht
  const { manager: _manager, ...rest } = s;
  return { ...rest, seed: 0, owners: {} };
}

// ---------------------------------------------------------------- laufende Aktionen

const NO_FLIGHT: InFlightMap = {};

/** Aktionen mit eigener Sperre – frei erst, wenn der Server sie bestätigt oder ablehnt. */
export type DraftAction = 'pick' | 'auto-pick' | 'start' | 'join' | 'add-cpu' | 'settings' | 'reroll';

/** Stand beim Senden einer Aktion – daran wird die Bestätigung erkannt. */
export interface InFlight {
  /** Gesendet (Date.now) */
  at: number;
  phase: DraftSnapshot['phase'];
  pickIndex: number;
  cpuTeams: number;
  settings: DraftSettings;
  /** Wurf des aktuellen Picks beim Senden ('reroll': bestätigt, sobald er wechselt) */
  roll: DraftActiveRoll | null;
  /** Nur 'settings': die gesendete Änderung (ohne Liganamen) */
  patch?: Partial<DraftSettings>;
}

export type InFlightMap = Partial<Record<DraftAction, InFlight>>;

export function inFlightOf(s: DraftSnapshot, at: number, patch?: Partial<DraftSettings>): InFlight {
  return {
    at,
    phase: s.phase,
    pickIndex: s.pickIndex,
    cpuTeams: s.teams.filter((t) => t.cpu).length,
    settings: s.settings,
    roll: s.roll ?? null,
    ...(patch ? { patch } : {}),
  };
}

/**
 * Bestätigt dieser Schnappschuss die Aktion? Fremde Schnappschüsse (Online-Status, andere
 * Teams …) lösen die Sperre nicht – nur die passende Änderung (oder ein Phasenwechsel).
 */
export function actionSettled(action: DraftAction, f: InFlight, s: DraftSnapshot): boolean {
  if (s.phase !== f.phase) return true;
  switch (action) {
    case 'pick':
    case 'auto-pick':
      return s.pickIndex > f.pickIndex;
    case 'start':
      return false;
    case 'join':
      return s.you != null;
    case 'add-cpu':
      return s.teams.filter((t) => t.cpu).length > f.cpuTeams;
    case 'settings': {
      const keys = Object.keys(f.patch ?? {}) as (keyof DraftSettings)[];
      // Übernommen – oder vom Server anders angepasst (Listen und Rerolls tief verglichen)
      return (
        keys.every((k) => sameSettingValue(s.settings[k], f.patch![k])) ||
        keys.some((k) => !sameSettingValue(s.settings[k], f.settings[k]))
      );
    }
    case 'reroll':
      // Neuer Wurf – oder der Zug ist ohnehin vorbei
      return s.pickIndex !== f.pickIndex || !sameSettingValue(s.roll ?? null, f.roll);
  }
}

/** Bestätigte Aktionen austragen – dasselbe Objekt, wenn sich nichts ändert. */
export function settleInFlight(map: InFlightMap, s: DraftSnapshot): InFlightMap {
  let out = map;
  for (const action of Object.keys(map) as DraftAction[]) {
    const f = map[action];
    if (!f || !actionSettled(action, f, s)) continue;
    if (out === map) out = { ...map };
    delete out[action];
  }
  return out;
}

/** Aktionen, die seit DRAFT_ACTION_TIMEOUT_MS ohne Antwort sind, austragen. */
export function expireInFlight(map: InFlightMap, now: number): { map: InFlightMap; expired: DraftAction[] } {
  const expired = (Object.keys(map) as DraftAction[]).filter((a) => now - map[a]!.at >= DRAFT_ACTION_TIMEOUT_MS);
  if (!expired.length) return { map, expired };
  const out = { ...map };
  for (const a of expired) delete out[a];
  return { map: out, expired };
}

/**
 * Fehler vom Server: Sperre der abgelehnten Aktion lösen. Ohne Zuordnung (for fehlt, z. B. beim
 * Nachrichtenlimit) alle – sonst nur die passende, damit ein fremder Fehler keinen laufenden Pick freigibt.
 */
export function releaseInFlight(map: InFlightMap, forType?: string): InFlightMap {
  if (forType == null) return Object.keys(map).length ? NO_FLIGHT : map;
  if (!Object.hasOwn(map, forType)) return map;
  const out = { ...map };
  delete out[forType as DraftAction];
  return out;
}

/** Wartezeit vor der n-ten erneuten Existenzprüfung nach einem Fehler: 2 s, 4 s, 8 s … 30 s */
export function checkRetryDelay(failures: number): number {
  return Math.min(CHECK_RETRY_MAX_MS, CHECK_RETRY_BASE_MS * 2 ** Math.max(0, Math.floor(failures)));
}

// ---------------------------------------------------------------- Hook

type AutoPickMessage = Extract<DraftClientMessage, { type: 'auto-pick' }>;
type RerollMessage = Extract<DraftClientMessage, { type: 'reroll' }>;

export interface DraftRoom extends DraftRoomView {
  status: DraftRoomStatus;
  state: DraftSnapshot | null;
  /** Schnappschuss kommt über den WebSocket (mit you) – nicht nur die HTTP-Vorschau */
  live: boolean;
  /** Letzte Fehlermeldung (verschwindet nach DRAFT_ERROR_MS) */
  error: string | null;
  clearError(): void;
  /**
   * Der Server hat die Anmeldung (hello) abgelehnt – seine Meldung. Bleibt stehen, bis eine
   * Anmeldung klappt; bis dahin gibt es nur die öffentliche Ansicht.
   */
  authError: string | null;
  /** Serverzeit − Date.now() */
  clockOffset: number;
  /** Ein eigener Pick ist unterwegs */
  pending: boolean;
  /** Gesendete Aktionen, auf deren Bestätigung noch gewartet wird (Knöpfe gesperrt) */
  busy: Record<DraftAction, boolean>;
  /** Bereits vergebene Pokémon */
  drafted: Set<number>;
  join(name: string, formation: FormationId): boolean;
  leave(): boolean;
  updateTeam(patch: { name?: string; formation?: FormationId }): boolean;
  updateSettings(patch: Partial<DraftSettings>): boolean;
  addCpu(): boolean;
  removeTeam(teamId: string): boolean;
  setOrder(teamIds: string[]): boolean;
  start(): boolean;
  pick(pokemonId: number, slot: number): boolean;
  /** Automatisch wählen – teamId: das Team, das gerade dran sein soll (sonst das aktuelle) */
  autoPick(teamId?: string): boolean;
  /** Wurf des eigenen Picks neu würfeln (Typ bzw. Region) – nur am Zug, im Zufallsmodus, mit Rerolls übrig */
  reroll(kind: DraftRerollKind): boolean;
  /** Wunschliste des eigenen Teams ersetzen (Reihenfolge = Vorrang) */
  setQueue(ids: number[]): boolean;
  /** Manager-Saison: eigene Aufstellung für den nächsten Spieltag (auto: Server stellt die beste Elf) */
  setLineup(lineup: ManagerLineup): boolean;
  /** Manager-Saison: Transfer-Wunsch (in = null: zurückziehen) */
  setTransfer(inId: number | null, outId: number | null): boolean;
  /** Eigene Trikotnummern setzen (leer = Vorgabe) */
  setJerseys(jerseys: Record<string, number>): boolean;
  /** Kapitän setzen (null = keiner) */
  setCaptain(pokemonId: number | null): boolean;
  /** Trikotfarben setzen (null = Standard) */
  setKit(kit: { home: string; away: string } | null): boolean;
  /** Torjubel setzen ('' = keiner) */
  setCheer(text: string): boolean;
  /** Wappen setzen (null = keins) */
  setCrest(crest: Crest | null): boolean;
  /** Manager-Saison: Tausch anbieten (eigenes give gegen get von Team to) */
  offerTrade(to: string, give: number, get: number): boolean;
  /** Manager-Saison: Angebot annehmen bzw. ablehnen / zurückziehen */
  answerOffer(id: number, accept: boolean): boolean;
  /** Emoji-Reaktion an alle (nur Mitglieder) */
  react(emoji: DraftReaction): boolean;
  /** Reaktionen der letzten Sekunden, älteste zuerst */
  reactions: RoomReaction[];
  reconnect(): void;
}

/** Eine empfangene Reaktion (id nur lokal, für die Anzeige) */
export interface RoomReaction {
  id: number;
  teamId: string;
  emoji: string;
  at: number;
}

/** So lange bleibt eine Reaktion zu sehen (ms) … */
export const REACTION_MS = 4000;
/** … und höchstens so viele gleichzeitig */
const REACTIONS_SHOWN = 6;

export function useDraftRoom(code: string): DraftRoom {
  const { all: list } = usePokemonData();
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const reactionSeq = useRef(0);
  const valid = isDraftCode(code);
  const [status, setStatus] = useState<DraftRoomStatus>(valid ? 'connecting' : 'not_found');
  const [state, setState] = useState<DraftSnapshot | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [authError, setAuthError] = useState<RoomError | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [live, setLive] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [flight, setFlightState] = useState<InFlightMap>(NO_FLIGHT);
  const conn = useRef<DraftConnection | null>(null);
  /** Neuester Stand und laufende Aktionen – synchron lesbar (Doppelklick vor dem nächsten Rendern) */
  const stateRef = useRef<DraftSnapshot | null>(null);
  const flightRef = useRef<InFlightMap>(NO_FLIGHT);
  /** Für diesen Code kam schon ein Schnappschuss über den WebSocket (mit eigener Rolle) */
  const liveRef = useRef(false);
  const codeRef = useRef<string | null>(null);

  const setFlight = useCallback((next: InFlightMap) => {
    if (next === flightRef.current) return;
    flightRef.current = next;
    setFlightState(next);
  }, []);

  useEffect(() => {
    // Neuer Code → alles zurück. Ein neuer Anlauf für dieselbe Liga (generation) behält den
    // letzten Stand samt eigener Rolle – sonst blitzt die Zuschauer-Vorschau auf.
    if (codeRef.current !== code) {
      codeRef.current = code;
      stateRef.current = null;
      liveRef.current = false;
      setState(null);
      setLive(false);
      setAuthError(null);
      setClockOffset(0);
    }
    setError(null);
    setFlight(NO_FLIGHT);
    if (!valid) {
      setStatus('not_found');
      return;
    }
    setStatus(liveRef.current ? 'reconnecting' : 'connecting');
    let alive = true;
    let gone = false;
    let checking = false;
    let checkFailures = 0;
    let checkTimer: number | undefined;
    let connection: DraftConnection | null = null;

    const markGone = () => {
      if (!alive || gone) return;
      gone = true;
      window.clearTimeout(checkTimer);
      connection?.close();
      forgetLeague(code);
      setStatus('not_found');
    };

    /** Nächste Prüfung – nur, solange keine angemeldete Verbindung steht. */
    const scheduleCheck = (ms: number) => {
      window.clearTimeout(checkTimer);
      checkTimer = undefined;
      if (!alive || gone || connection?.status === 'open') return;
      checkTimer = window.setTimeout(check, ms);
    };

    /**
     * Gibt es die Liga noch? (Ein 404 beim WebSocket-Aufbau ist im Browser nicht lesbar.)
     * Wiederholt sich mit Pause, bis eine eindeutige Antwort kommt, und danach in größerem
     * Abstand, solange die Live-Verbindung fehlt – das frischt auch die öffentliche Vorschau auf.
     */
    function check() {
      if (!alive || gone || checking) return;
      window.clearTimeout(checkTimer);
      checkTimer = undefined;
      checking = true;
      fetchDraftSnapshot(code)
        .then((snap) => {
          if (!alive || gone) return;
          checkFailures = 0;
          if (!liveRef.current) {
            // Vorschau, bis der WebSocket den eigenen Schnappschuss (mit you) liefert
            stateRef.current = snap;
            setState(snap);
            setClockOffset((o) => (o === 0 ? snap.serverNow - Date.now() : o));
          }
          scheduleCheck(CHECK_REFRESH_MS);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          if (e instanceof ApiRequestError && e.status === 404) {
            markGone();
            return;
          }
          scheduleCheck(checkRetryDelay(checkFailures++));
        })
        .finally(() => {
          checking = false;
        });
    }

    connection = connectDraft(code, {
      onState(snap) {
        if (!alive) return;
        liveRef.current = true;
        stateRef.current = snap;
        setState(snap);
        setLive(true);
        setAuthError(null);
        rememberLeague(snap);
        setFlight(settleInFlight(flightRef.current, snap));
      },
      onError(err) {
        if (!alive) return;
        if (err.code === 'not_found') {
          markGone();
          return;
        }
        // Antwort auf eine eigene Aktion → deren Sperre lösen
        setFlight(releaseInFlight(flightRef.current, err.for));
        const raw = { message: err.message, code: err.code };
        if (err.hello) {
          setAuthError({ ...raw, fallback: 'authRejected' });
          return;
        }
        setError({ ...raw, fallback: 'unknownError' });
      },
      onStatus(next) {
        if (!alive || gone) return;
        setStatus(next);
        if (next === 'open') {
          window.clearTimeout(checkTimer);
          checkTimer = undefined;
        } else if (next === 'reconnecting' || next === 'closed') {
          setFlight(NO_FLIGHT);
          check();
        }
      },
      onClockOffset(offset) {
        if (alive) setClockOffset(offset);
      },
      onReaction(r) {
        if (!alive) return;
        const id = ++reactionSeq.current;
        setReactions((list) => [...list.slice(-(REACTIONS_SHOWN - 1)), { id, ...r }]);
        window.setTimeout(() => setReactions((list) => list.filter((x) => x.id !== id)), REACTION_MS);
      },
    });
    conn.current = connection;
    check();

    // Zurück im Tab: Verbindung prüfen (tote bzw. hängende sofort ersetzen); wieder online:
    // sofort neu verbinden – der alte Socket hängt meist noch am alten Netz.
    const wake = () => {
      if (document.visibilityState !== 'visible' || !connection) return;
      connection.checkAlive();
      if (connection.status !== 'open') check();
    };
    const online = () => {
      if (!connection) return;
      connection.reconnectNow();
      check();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', online);
    return () => {
      alive = false;
      window.clearTimeout(checkTimer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', online);
      connection?.close();
      if (conn.current === connection) conn.current = null;
    };
  }, [code, valid, generation, setFlight]);

  // Fehlermeldungen verschwinden von selbst
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), DRAFT_ERROR_MS);
    return () => window.clearTimeout(id);
  }, [error]);

  // Aktion ohne Antwort: wieder freigeben und die Verbindung prüfen (tote wird ersetzt)
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    const started = Object.values(flight).map((f) => f!.at);
    if (!started.length) return;
    const wait = Math.max(0, Math.min(...started) + DRAFT_ACTION_TIMEOUT_MS - Date.now());
    const id = window.setTimeout(() => {
      const { map, expired } = expireInFlight(flightRef.current, Date.now());
      // Zu früh (Uhr nachgestellt, ungenaue Timer): mit der Restzeit neu stellen
      if (!expired.length) {
        setRearm((n) => n + 1);
        return;
      }
      setFlight(map);
      // Einstellungen ohne Änderung bekommen evtl. keine eigene Bestätigung – dann still freigeben
      if (expired.some((a) => a !== 'settings')) setError({ fallback: 'noAnswer' });
      conn.current?.checkAlive();
    }, wait);
    return () => window.clearTimeout(id);
  }, [flight, setFlight, rearm]);

  const view = useMemo(() => draftRoomView(state), [state]);
  const drafted = useMemo(() => (state ? draftedIds(state) : new Set<number>()), [state]);
  const busy = useMemo(
    () => ({
      pick: !!flight.pick,
      'auto-pick': !!flight['auto-pick'],
      start: !!flight.start,
      join: !!flight.join,
      'add-cpu': !!flight['add-cpu'],
      settings: !!flight.settings,
      reroll: !!flight.reroll,
    }),
    [flight],
  );

  const send = useCallback((msg: DraftClientMessage): boolean => {
    const ok = conn.current?.send(msg) ?? false;
    if (!ok) setError({ fallback: 'noConnection' });
    return ok;
  }, []);

  /** Aktion mit Sperre senden: Läuft dieselbe Aktion noch, passiert nichts (Doppelklick). */
  const sendOnce = useCallback(
    (action: DraftAction, msg: DraftClientMessage, patch?: Partial<DraftSettings>): boolean => {
      const s = stateRef.current;
      if (!s || flightRef.current[action]) return false;
      if (!send(msg)) return false;
      setFlight({ ...flightRef.current, [action]: inFlightOf(s, Date.now(), patch) });
      return true;
    },
    [send, setFlight],
  );

  const join = useCallback(
    (name: string, formation: FormationId) => {
      const teamName = cleanTeamName(name);
      if (!teamName) {
        setError({ fallback: 'teamNameMissing' });
        return false;
      }
      return sendOnce('join', { type: 'join', teamName, formation });
    },
    [sendOnce],
  );

  const updateTeam = useCallback(
    (patch: { name?: string; formation?: FormationId }) => {
      const msg: Extract<DraftClientMessage, { type: 'update-team' }> = { type: 'update-team' };
      if (patch.name !== undefined) {
        const teamName = cleanTeamName(patch.name);
        if (!teamName) {
          setError({ fallback: 'teamNameMissing' });
          return false;
        }
        msg.teamName = teamName;
      }
      if (patch.formation) msg.formation = patch.formation;
      return send(msg);
    },
    [send],
  );

  const updateSettings = useCallback(
    (patch: Partial<DraftSettings>) => {
      const { name, ...rest } = patch;
      const keys = Object.keys(rest) as Exclude<keyof DraftSettings, 'name'>[];
      // Nur der Liganame: überschreibt einfach (getippt, entprellt) – ohne Sperre
      if (!keys.length) return send({ type: 'settings', settings: patch });
      const s = stateRef.current;
      if (s && keys.every((k) => sameSettingValue(s.settings[k], rest[k])) && (name === undefined || name === s.settings.name)) {
        return true;
      }
      return sendOnce('settings', { type: 'settings', settings: patch }, rest);
    },
    [send, sendOnce],
  );

  const pick = useCallback(
    (pokemonId: number, slot: number) => {
      const s = stateRef.current;
      // Ein Reroll unterwegs: Der Wurf ändert sich gleich – der Pick passte dann womöglich nicht mehr
      if (!s || !s.you || flightRef.current.pick || flightRef.current.reroll) return false;
      const err = pickError(s, s.you, pokemonId, slot, list);
      if (err) {
        setError({ message: err, code: 'bad_pick' });
        return false;
      }
      return sendOnce('pick', { type: 'pick', pokemonId, slot });
    },
    [list, sendOnce],
  );

  const autoPick = useCallback(
    (teamId?: string) => {
      const s = stateRef.current;
      const cur = s ? currentTeam(s) : null;
      // Anzeige veraltet (der Zug ist schon weiter) → nichts senden
      if (!cur || (teamId != null && teamId !== cur.id)) return false;
      // Ziel ist genau dieser Zug: Ist er schon vorbei, lehnt der Server ab („stale") statt den nächsten zu nehmen
      const msg: AutoPickMessage = { type: 'auto-pick', teamId: cur.id, pickIndex: s!.pickIndex };
      return sendOnce('auto-pick', msg);
    },
    [sendOnce],
  );

  const reroll = useCallback(
    (kind: DraftRerollKind) => {
      const s = stateRef.current;
      // Ein Pick unterwegs: Bei einem Doppelzug (Snake) träfe der Reroll sonst schon den nächsten,
      // noch ungesehenen Wurf
      if (!s || !s.you || flightRef.current.reroll || flightRef.current.pick) return false;
      // Vorprüfung mit der Engine (nicht dran, kein Wurf, keine Rerolls, nichts anderes möglich) –
      // dieselben Meldungen wie vom Server, ohne Umweg. Der neue Wurf selbst kommt vom Server.
      try {
        applyReroll(snapshotState(s), s.you, kind, list);
      } catch (e) {
        if (e instanceof DraftError) {
          setError({ message: e.message, code: e.code });
          return false;
        }
        throw e;
      }
      // Gezielt: nur dieser Pick mit diesem Wurf – ist er schon weiter, lehnt der Server ab („stale")
      const msg: RerollMessage = { type: 'reroll', kind, pickIndex: s.pickIndex };
      if (s.roll) msg.roll = { gen: s.roll.gen, type: s.roll.type };
      return sendOnce('reroll', msg);
    },
    [list, sendOnce],
  );

  return {
    ...view,
    status,
    state,
    live,
    error: error && roomErrorText(error, list),
    clearError: useCallback(() => setError(null), []),
    authError: authError && roomErrorText(authError, list),
    clockOffset,
    pending: busy.pick,
    busy,
    drafted,
    join,
    leave: useCallback(() => send({ type: 'leave' }), [send]),
    updateTeam,
    updateSettings,
    addCpu: useCallback(() => sendOnce('add-cpu', { type: 'add-cpu' }), [sendOnce]),
    removeTeam: useCallback((teamId: string) => send({ type: 'remove-team', teamId }), [send]),
    setOrder: useCallback((order: string[]) => send({ type: 'set-order', order }), [send]),
    start: useCallback(() => sendOnce('start', { type: 'start' }), [sendOnce]),
    pick,
    autoPick,
    reroll,
    setQueue: useCallback((ids: number[]) => send({ type: 'queue', ids }), [send]),
    setTransfer: useCallback((inId: number | null, outId: number | null) => send({ type: 'transfer', in: inId, out: outId }), [send]),
    setJerseys: useCallback((jerseys: Record<string, number>) => send({ type: 'jerseys', jerseys }), [send]),
    setCaptain: useCallback((pokemonId: number | null) => send({ type: 'captain', pokemonId }), [send]),
    setKit: useCallback((kit: { home: string; away: string } | null) => send({ type: 'kit', kit }), [send]),
    setCheer: useCallback((text: string) => send({ type: 'cheer', text }), [send]),
    setCrest: useCallback((crest: Crest | null) => send({ type: 'crest', crest: crest as unknown as Record<string, unknown> | null }), [send]),
    offerTrade: useCallback((to: string, give: number, get: number) => send({ type: 'offer', to, give, get }), [send]),
    answerOffer: useCallback((id: number, accept: boolean) => send({ type: 'offer-reply', id, accept }), [send]),
    setLineup: useCallback((l: ManagerLineup) => send({ type: 'lineup', formation: l.formation, slots: l.slots, ss: l.ss, auto: l.auto }), [send]),
    react: useCallback((emoji: DraftReaction) => send({ type: 'react', emoji }), [send]),
    reactions,
    reconnect: useCallback(() => {
      if (!conn.current?.reconnectNow()) setGeneration((g) => g + 1);
    }, []),
  };
}
