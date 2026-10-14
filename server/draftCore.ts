/**
 * Kern eines Draft-Raums (Durable Object „DraftRoom") – ohne Cloudflare-Abhängigkeit:
 * Speicher, Uhr, Alarm und Sockets kommen als Ports von außen. server/draftRoom.ts
 * verbindet ihn mit der echten Laufzeit (WebSocket-Hibernation, Storage, Alarm),
 * tests/draftServer.test.ts mit Fakes.
 *
 * Jede Änderung läuft nacheinander (eine Warteschlange pro Raum): Engine anwenden →
 * speichern → personalisierte Schnappschüsse an alle angemeldeten Sockets → Lobby-Zeile
 * in D1 abgleichen → Alarm neu stellen (CPU-Pick, Ablauf der Bedenkzeit, Gnadenfristen
 * für Host-Wechsel und Auto-Pick, Löschfrist). Die D1-Prüfung des hello läuft außerhalb
 * der Warteschlange – nur das Anmelden selbst reiht sich ein. Gespeicherte Stände älterer
 * Ligen (Einstellungen region/legends) bringt load() mit upgradeState in die aktuelle Form.
 *
 * Verbindungen: Wer sich nicht binnen DRAFT_HELLO_TIMEOUT_MS anmeldet, fliegt raus;
 * unangemeldete Verbindungen sind pro Raum und IP begrenzt (die älteste weicht), angemeldete
 * pro Gerät und Raum – Team-Besitzer verdrängen notfalls Zuschauer, nie umgekehrt.
 * Dazu die D1-Abfragen der Lobby-Tabelle (auch für die HTTP-Endpunkte in server/drafts.ts).
 */
import { TYPE_KEYS } from '../src/config/pokemonTypes';
import type { DeviceAuth } from '../src/lib/api/contract';
import {
  DRAFT_ALL_GENS,
  DRAFT_LIMITS,
  DRAFT_REACTION_RATE,
  DRAFT_REACTIONS,
  DRAFT_REROLL_KINDS,
  type DraftClientMessage,
  type DraftPhase,
  type DraftReaction,
  type DraftRerollKind,
  type DraftServerMessage,
  type DraftSettings,
  type DraftSettingsPatch,
  type DraftSnapshot,
  type LobbyRegion,
  type PickSeconds,
} from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  applyPick,
  applyReroll,
  autoPickChoice,
  autoPickOpensAt,
  createDraft,
  currentTeam,
  DraftError,
  hostTransferAt,
  joinDraft,
  leaveDraft,
  lobbyRegionOf,
  mayAutoPick,
  poolHasLegends,
  rematchTemplate,
  removeTeam,
  setOnline,
  setOrder,
  setQueue,
  snapshotOf,
  startDraft,
  teamOfDevice,
  transferHost,
  updateSettings,
  updateTeam,
  upgradeSettings,
  upgradeState,
  withLeague,
  withTrainer,
  type DraftState,
} from '../src/lib/draftEngine';
import type { Scale } from '../src/lib/fit';
import { lookFromJson, type TrainerLook } from '../src/lib/trainer';
import { nextKickoff, playDueMatchdays, seasonEndsAt, setLineup, startManagerSeason } from '../src/lib/manager';
import type { FormationId, Pokemon, TypeKey } from '../src/types';
import { authenticateDevice, HOUR_MS, normalizeIp } from './auth';
import { randomHex, sha256Hex, timingSafeEqual } from './crypto';
import type { CreateRoomInput, CreateRoomResult, Db, Env, RematchTemplateResult } from './env';
import { ApiError } from './http';
import { saveDraftResults } from './achievements';
import { loadFillCandidates } from './fill';
import { ensureSchema } from './schema';
import { cleanText, hasVisible, parseDeviceAuth } from './validate';

/** Maximale Größe einer Client-Nachricht (Bytes, UTF-8) */
export const DRAFT_MESSAGE_MAX_BYTES = 4096;
/**
 * Nachrichten-Limits als Token-Eimer (burst = Vorrat, perSecond = Nachschub): pro Verbindung,
 * pro Gerät über alle seine Verbindungen und für Lobby-Änderungen pro Gerät. Verworfenes
 * bekommt einmal „rate_limited"; wer trotzdem weiterflutet, fliegt nach closeAfter raus.
 */
export const DRAFT_RATE = {
  socket: { burst: 10, perSecond: 5 },
  device: { burst: 20, perSecond: 10 },
  // Lobby einrichten: schnelle Host-Klicks (Einstellungen, CPU-Teams, Reihenfolge) gehen durch,
  // auf Dauer höchstens eine Änderung alle 2 s (der Eimer steht im Raum-Speicher, s. changeRates)
  changes: { burst: 30, perSecond: 0.5 },
  closeAfter: 50,
} as const;
/** Höchstens so viele angemeldete Verbindungen pro Raum (Spieler + Zuschauer) */
export const DRAFT_MAX_CONNECTIONS = 64;
/** Höchstens so viele noch nicht angemeldete Verbindungen pro Raum … */
export const DRAFT_MAX_PENDING = 16;
/** … und pro IP – darüber weicht jeweils die älteste */
export const DRAFT_MAX_PENDING_PER_IP = 4;
/** Angemeldete Verbindungen (Tabs) pro Gerät und Raum – darüber weicht die älteste (z. B. halb offen nach Netzwechsel) */
export const DRAFT_MAX_SOCKETS_PER_DEVICE = 4;
/** Angemeldete Zuschauer-Verbindungen (ohne Team) pro IP bzw. IPv6-/64 – Team-Mitglieder zählen nicht */
export const DRAFT_MAX_SPECTATORS_PER_IP = 8;
/** So lange hat eine neue Verbindung Zeit für ihr hello */
export const DRAFT_HELLO_TIMEOUT_MS = 10_000;
/** Fehlgeschlagene hello-Versuche pro Verbindung, danach wird sie geschlossen. */
export const DRAFT_MAX_HELLOS = 5;
/**
 * Close-Codes der Draft-Sockets. retry: vorübergehender Serverfehler beim hello – der Client
 * verbindet neu und schickt hello erneut; timeout: kein hello rechtzeitig bzw. verdrängt;
 * full: Raum bzw. Gerät hat zu viele Verbindungen; flood: zu viele Nachrichten; replaced: ein
 * neuerer Tab desselben Geräts hat übernommen (endgültig – kein automatischer Neuversuch).
 */
export const DRAFT_CLOSE = { closed: 4000, unauthorized: 4001, retry: 4002, timeout: 4003, full: 4004, flood: 4005, replaced: 4006 } as const;
/** Lobby-Zeile: Änderungen ohne Eile höchstens so oft schreiben … */
export const LOBBY_SYNC_MS = 10_000;
/** … und fehlgeschlagene Schreibversuche nach dieser Pause wiederholen */
export const LOBBY_RETRY_MS = 30_000;
/** Geschlossene Lobby: Ihre Zeile zählt so lange fürs Limit neuer Ligen, dann löscht der Raum sie. */
export const CLOSED_LOBBY_KEEP_MS = HOUR_MS;
/** Neue Ligen pro IP (gesalzener Hash) und Stunde – zusätzlich zum Limit pro Gerät */
export const DRAFT_CREATES_PER_IP = 10;

const DAY_MS = 86_400_000;
/** Löschen einer geschlossenen Lobby-Zeile fehlgeschlagen: so viel später erneut */
const CLOSED_RETRY_MS = 10 * 60_000;

// ---------------------------------------------------------------- Ports

/** Anhang eines Sockets – überlebt die Hibernation (serializeAttachment). */
export interface ConnAttachment {
  /** Zufällige Verbindungs-ID (unterscheidet mehrere Tabs desselben Geräts) */
  cid: string;
  /** Geräte-ID nach erfolgreichem hello */
  deviceId: string | null;
  authed: boolean;
  /** Client-IP aus dem Upgrade – nur für die Limits, lebt so lange wie die Verbindung */
  ip: string | null;
  /** Fehlgeschlagene hello-Versuche */
  hellos: number;
  /** Angenommen um (ms) – für die Frist des hello (fehlt bei älteren Verbindungen) */
  acceptedAt?: number;
  /** Trainer des Geräts (beim hello aus D1; undefined = unbekannt, z. B. D1-Fehler) – fürs Beitreten */
  trainer?: TrainerLook | null;
}

/** Eine WebSocket-Verbindung, wie der Kern sie sieht. */
export interface DraftConn {
  attachment(): ConnAttachment | null;
  setAttachment(a: ConnAttachment): void;
  send(data: string): void;
  close(code: number, reason: string): void;
  /** Noch offen (readyState OPEN)? Ohne Angabe: ja. */
  isOpen?(): boolean;
}

/** Gespeicherter Raum: Engine-Zustand + Zeitpunkt des nächsten CPU-Picks + Stand der Lobby-Zeile. */
export interface RoomRecord {
  state: DraftState;
  /** Wann die CPU am Zug picken darf (nur, solange eine CPU dran ist) */
  cpuAt: number | null;
  /** Zuletzt erfolgreich in D1 geschriebene Lobby-Felder (null/fehlt = unbekannt) */
  synced?: LobbyFields | null;
  /** Nächster Schreibversuch der Lobby-Zeile (gebündelt bzw. nach einem Fehler) */
  syncAt?: number | null;
  /** Nicht volle Eimer der Lobby-Änderungen je Gerät – überleben so die Hibernation */
  rates?: Record<string, { tokens: number; at: number }>;
  /** Abschlüsse der fertigen Liga (draft_results) noch nicht gespeichert: nächster Versuch */
  resultsAt?: number | null;
}

/** Grabstein einer geschlossenen Lobby: der Zustand ist weg, die D1-Zeile wird zu deleteAt gelöscht. */
export interface ClosedRoom {
  closed: { code: string; deleteAt: number };
}

export type StoredRoom = RoomRecord | ClosedRoom;

const isClosedRoom = (r: StoredRoom): r is ClosedRoom => 'closed' in r;

export interface DraftPorts {
  storage: {
    load(): Promise<StoredRoom | null>;
    save(rec: StoredRoom): Promise<void>;
    /** Löscht alles (Raum abgelaufen bzw. Grabstein erledigt) */
    clear(): Promise<void>;
  };
  /** Uhr (ms) */
  now(): number;
  /** Genau ein Alarm pro Raum */
  alarm: {
    set(at: number): Promise<void>;
    clear(): Promise<void>;
  };
  /** Alle Verbindungen des Raums (auch gerade schließende – der Kern prüft isOpen) */
  sockets(): DraftConn[];
  /** D1 (Geräte + Lobby-Zeile) und IP_SALT */
  env: Pick<Env, 'DB' | 'IP_SALT'>;
  /** Pokémon-Daten und Normalisierung (server/game.ts) */
  list: Pokemon[];
  scale: Scale;
}

// ---------------------------------------------------------------- Eingaben prüfen

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const optString = (v: unknown) => v === undefined || typeof v === 'string';
const isTeamId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;

/**
 * Team- bzw. Liganame säubern (wie Namen der Rangliste: server/validate.ts cleanText).
 * Ohne sichtbaren Inhalt wird er leer – das ist nur bei `allowEmpty` erlaubt.
 */
export function cleanDraftName(v: unknown, max: number, what: string, allowEmpty: boolean): string {
  if (typeof v !== 'string') throw new DraftError('bad_name', `${what} muss ein Text sein`);
  const name = cleanText(v);
  if ([...name].length > max) throw new DraftError('bad_name', `${what} ist zu lang (max. ${max} Zeichen)`);
  const visible = hasVisible(name) ? name : '';
  if (!visible && !allowEmpty) throw new DraftError('bad_name', `${what} darf nicht leer sein`);
  return visible;
}

export const cleanTeamName = (v: unknown) => cleanDraftName(v, DRAFT_LIMITS.teamNameMax, 'Teamname', false);

/**
 * Schlüssel, die ein Einstellungs-Patch haben darf: die aktuellen und die älteren region/legends
 * (zwischengespeicherte Clients schicken sie noch – normalizeSettings rechnet sie um).
 */
export const SETTING_KEYS = [
  'name',
  'gens',
  'types',
  'legendary',
  'mythical',
  'maxLegends',
  'ultraBeasts',
  'maxUltraBeasts',
  'forms',
  'megas',
  'maxMegas',
  'setPiece',
  'maxTeams',
  'pickSeconds',
  'order',
  'snake',
  'roll',
  'rerolls',
  'visibility',
  'format',
  'cupGroups',
  'bench',
  'matchdayMinutes',
  'region',
  'legends',
] as const satisfies readonly (keyof DraftSettingsPatch)[];

const badSettings = (message: string): never => {
  throw new DraftError('bad_settings', message);
};

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Einstellungs-Patch säubern: nur bekannte Felder (auch die älteren region/legends), Liganame
 * gesäubert, Listen und rerolls frisch kopiert (rerolls nur mit type/region). Die Feldtypen
 * werden hier streng geprüft – Wertebereiche, Pool-Größe und Vorrang neuer vor älteren
 * Schlüsseln prüft bzw. regelt normalizeSettings. Fehler: DraftError 'bad_settings' (Meldungen
 * wie die der Engine, damit der Client sie übersetzen kann).
 */
export function cleanSettingsPatch(raw: unknown): DraftSettingsPatch {
  if (!isObject(raw)) throw new DraftError('bad_settings', 'Ungültige Einstellungen');
  const patch: Obj = {};
  for (const key of SETTING_KEYS) if (Object.hasOwn(raw, key) && raw[key] !== undefined) patch[key] = raw[key];
  if (patch.name !== undefined) patch.name = cleanDraftName(patch.name, DRAFT_LIMITS.leagueNameMax, 'Liganame', true);
  if (patch.gens !== undefined) {
    const gens = patch.gens;
    if (!Array.isArray(gens) || gens.length > DRAFT_ALL_GENS.length || !gens.every(isInt)) badSettings('Ungültige Generationen');
    patch.gens = [...(gens as number[])];
  }
  if (patch.types !== undefined) {
    const types = patch.types;
    if (!Array.isArray(types) || types.length > TYPE_KEYS.length || !types.every((t) => typeof t === 'string')) {
      badSettings('Ungültige Typen');
    }
    patch.types = [...(types as string[])];
  }
  for (const key of ['legendary', 'mythical', 'ultraBeasts', 'forms', 'megas', 'setPiece', 'snake', 'cupGroups', 'legends'] as const) {
    if (patch[key] !== undefined && !isBool(patch[key])) badSettings('Ungültige Einstellung');
  }
  if (patch.maxLegends !== undefined && patch.maxLegends !== null && !isInt(patch.maxLegends)) {
    badSettings('Ungültiges Legendären-Limit');
  }
  if (patch.maxUltraBeasts !== undefined && patch.maxUltraBeasts !== null && !isInt(patch.maxUltraBeasts)) {
    badSettings('Ungültiges Ultrabestien-Limit');
  }
  if (patch.maxMegas !== undefined && patch.maxMegas !== null && !isInt(patch.maxMegas)) {
    badSettings('Ungültiges Mega-Limit');
  }
  if (patch.roll !== undefined && typeof patch.roll !== 'string') badSettings('Ungültiger Zufallsmodus');
  if (patch.format !== undefined && typeof patch.format !== 'string') badSettings('Ungültiger Spielmodus');
  if (patch.bench !== undefined && !isInt(patch.bench)) badSettings('Ungültige Bank');
  if (patch.matchdayMinutes !== undefined && !isInt(patch.matchdayMinutes)) badSettings('Ungültiger Spieltag-Takt');
  if (patch.rerolls !== undefined) {
    const r = patch.rerolls;
    if (!isObject(r)) return badSettings('Ungültige Rerolls');
    const rerolls: Obj = {};
    for (const kind of DRAFT_REROLL_KINDS) {
      if (!Object.hasOwn(r, kind) || r[kind] === undefined) continue;
      if (!isInt(r[kind])) badSettings('Ungültige Rerolls');
      rerolls[kind] = r[kind];
    }
    patch.rerolls = rerolls;
  }
  if (patch.region !== undefined && !isInt(patch.region)) badSettings('Ungültige Region');
  return patch as DraftSettingsPatch;
}

const isRerollKind = (v: unknown): v is DraftRerollKind => (DRAFT_REROLL_KINDS as readonly unknown[]).includes(v);

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export type ParsedMessage = { ok: true; msg: DraftClientMessage } | { ok: false; code: string; message: string };

const badMessage = (message = 'Ungültige Nachricht'): ParsedMessage => ({ ok: false, code: 'bad_message', message });

/** Prüft eine Client-Nachricht (JSON, Größe, Typ, Feldtypen) – wirft nie. */
export function parseClientMessage(raw: unknown): ParsedMessage {
  if (typeof raw !== 'string') return badMessage('Nur Text-Nachrichten (JSON)');
  // Zuerst die UTF-16-Länge (≤ Bytes) – so wird eine riesige Nachricht nicht erst kodiert.
  if (raw.length > DRAFT_MESSAGE_MAX_BYTES || byteLength(raw) > DRAFT_MESSAGE_MAX_BYTES) {
    return { ok: false, code: 'too_large', message: 'Nachricht ist zu groß' };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return badMessage('Nachricht ist kein gültiges JSON');
  }
  if (!isObject(data) || typeof data.type !== 'string') return badMessage();
  const d = data;
  const type = data.type;
  const ok = (msg: DraftClientMessage): ParsedMessage => ({ ok: true, msg });
  switch (type) {
    case 'hello':
      return typeof d.deviceId === 'string' && typeof d.deviceSecret === 'string'
        ? ok({ type: 'hello', deviceId: d.deviceId, deviceSecret: d.deviceSecret })
        : badMessage();
    case 'join':
      return typeof d.teamName === 'string' && typeof d.formation === 'string'
        ? ok({ type: 'join', teamName: d.teamName, formation: d.formation as FormationId })
        : badMessage();
    case 'update-team':
      if (!optString(d.teamName) || !optString(d.formation) || (d.teamName === undefined && d.formation === undefined)) {
        return badMessage();
      }
      return ok({
        type: 'update-team',
        ...(d.teamName !== undefined ? { teamName: d.teamName as string } : {}),
        ...(d.formation !== undefined ? { formation: d.formation as FormationId } : {}),
      });
    case 'settings':
      return isObject(d.settings) ? ok({ type: 'settings', settings: d.settings as DraftSettingsPatch }) : badMessage();
    case 'reroll': {
      // Optional der Zug bzw. Wurf, den der Client gesehen hat (sonst „stale")
      const roll = d.roll;
      if (!isRerollKind(d.kind) || (d.pickIndex !== undefined && !isInt(d.pickIndex))) return badMessage();
      if (roll !== undefined && !(isObject(roll) && isInt(roll.gen) && typeof roll.type === 'string' && roll.type.length <= 16)) {
        return badMessage();
      }
      return ok({
        type: 'reroll',
        kind: d.kind,
        ...(d.pickIndex !== undefined ? { pickIndex: d.pickIndex as number } : {}),
        ...(roll !== undefined ? { roll: { gen: roll.gen as number, type: roll.type as TypeKey } } : {}),
      });
    }
    case 'remove-team':
      return isTeamId(d.teamId) ? ok({ type: 'remove-team', teamId: d.teamId }) : badMessage();
    case 'set-order':
      return Array.isArray(d.order) && d.order.length <= DRAFT_LIMITS.maxTeams && d.order.every(isTeamId)
        ? ok({ type: 'set-order', order: d.order as string[] })
        : badMessage();
    case 'pick':
      return isInt(d.pokemonId) && isInt(d.slot) ? ok({ type: 'pick', pokemonId: d.pokemonId, slot: d.slot }) : badMessage();
    case 'auto-pick':
      // Optional das Ziel: Team bzw. Pick, für den der Klick gedacht war (sonst „stale")
      if ((d.teamId !== undefined && !isTeamId(d.teamId)) || (d.pickIndex !== undefined && !isInt(d.pickIndex))) return badMessage();
      return ok({
        type: 'auto-pick',
        ...(d.teamId !== undefined ? { teamId: d.teamId as string } : {}),
        ...(d.pickIndex !== undefined ? { pickIndex: d.pickIndex as number } : {}),
      });
    case 'lineup': {
      const slots = d.slots;
      if (
        typeof d.formation !== 'string' ||
        d.formation.length > 16 ||
        !Array.isArray(slots) ||
        slots.length > 11 ||
        !slots.every(isInt) ||
        !(d.ss === null || isInt(d.ss)) ||
        !isBool(d.auto)
      ) {
        return badMessage();
      }
      return ok({ type: 'lineup', formation: d.formation as FormationId, slots: [...(slots as number[])], ss: d.ss as number | null, auto: d.auto });
    }
    case 'react':
      return (DRAFT_REACTIONS as readonly unknown[]).includes(d.emoji) ? ok({ type: 'react', emoji: d.emoji as DraftReaction }) : badMessage();
    case 'queue':
      return Array.isArray(d.ids) && d.ids.length <= DRAFT_LIMITS.queueMax && d.ids.every(isInt)
        ? ok({ type: 'queue', ids: d.ids as number[] })
        : badMessage();
    case 'leave':
    case 'add-cpu':
    case 'start':
    case 'ping':
      return ok({ type });
    default:
      return badMessage('Unbekannter Nachrichtentyp');
  }
}

// ---------------------------------------------------------------- Zeitplan

/** Ab hier wird die Liga gelöscht – eine Manager-Saison erst so lange nach ihrem letzten Spieltag. */
export const expiresAt = (state: Pick<DraftState, 'createdAt'> & Partial<Pick<DraftState, 'season' | 'manager' | 'settings'>>) => {
  const keep = DRAFT_LIMITS.retentionDays * DAY_MS;
  const end = state.settings ? seasonEndsAt({ season: state.season ?? null, manager: state.manager, settings: state.settings }) : null;
  return Math.max(state.createdAt + keep, end != null ? end + keep : -Infinity);
};

/**
 * Nächster Alarm: CPU-Pick, Ablauf der Bedenkzeit, Lobby-Zeile nachziehen, Gnadenfristen
 * (Host-Wechsel, Auto-Pick durch andere – nur künftige, `now`) – sonst die Löschfrist.
 */
export function nextAlarmAt(rec: RoomRecord, now = -Infinity): number {
  const s = rec.state;
  const expires = expiresAt(s);
  const cur = currentTeam(s);
  const due = [expires];
  if (cur?.cpu && rec.cpuAt != null) due.push(rec.cpuAt);
  else if (cur && !cur.cpu && s.deadline != null) due.push(s.deadline);
  if (rec.syncAt != null) due.push(rec.syncAt);
  if (rec.resultsAt != null) due.push(rec.resultsAt);
  // Manager-Saison: Anpfiff des nächsten Spieltags
  const kickoff = s.phase === 'season' ? nextKickoff(s) : null;
  if (kickoff != null) due.push(kickoff);
  const future = (t: number | null) => {
    if (t != null && t > now) due.push(t);
  };
  // Host offline: Rolle wandert …
  future(hostTransferAt(s));
  // … und eine öffentliche Lobby verschwindet schon vorher aus der Liste (lobbyFields)
  if (s.phase === 'lobby' && s.settings.visibility === 'public') {
    const host = s.teams.find((t) => t.id === s.hostTeamId);
    if (host && !host.cpu && !host.online) future((host.offlineSince ?? -Infinity) + DRAFT_LIMITS.hostGraceMs);
  }
  // Team am Zug abwesend: andere Mitglieder dürfen auto-picken – alle bekommen dann den Stand
  if (cur && !cur.cpu && s.teams.some((t) => t.id !== cur.id && !t.cpu && t.online)) future(autoPickOpensAt(s));
  return Math.min(...due);
}

/** Neue Team-ID: kurz, zufällig, eindeutig in der Liga. */
function newTeamId(state: Pick<DraftState, 'teams'> | null): string {
  for (;;) {
    const id = randomHex(4);
    if (!state?.teams.some((t) => t.id === id)) return id;
  }
}

// ---------------------------------------------------------------- Lobby-Tabelle (D1)

/** Was die Lobby-Liste zeigt – ändert sich davon etwas, wird die Zeile aktualisiert. */
export interface LobbyFields {
  name: string;
  hostName: string;
  /** Pool-Generationen (Spalte region): 0 = alle, 1–9 = genau diese, 10 = mehrere (LOBBY_REGION_MANY) */
  region: LobbyRegion;
  /** Legendäre oder Mysteriöse im Pool */
  legends: boolean;
  pickSeconds: PickSeconds;
  teams: number;
  maxTeams: number;
  /** Gelistet als: 'public' nur, solange die Lobby öffentlich und ihr Host da ist */
  visibility: DraftSettings['visibility'];
  phase: DraftPhase;
}

export interface LobbyRow {
  code: string;
  host_device: string;
  name: string;
  host_name: string;
  region: number;
  legends: number;
  pick_seconds: number;
  teams: number;
  max_teams: number;
  visibility: string;
  /** lobby | drafting | done | closed */
  phase: string;
  created_at: number;
  updated_at: number;
}

/**
 * Pool-Kurzform der Lobby-Zeile – ohne Schema-Änderung in den alten Spalten: region = 0 bei
 * allen 9 Generationen, die Generation bei genau einer, sonst 10 („mehrere"); legends =
 * Legendäre oder Mysteriöse. Ältere Einstellungen (region/legends) werden vorher umgeschrieben.
 */
export function lobbyPoolFields(settings: DraftSettings): Pick<LobbyFields, 'region' | 'legends'> {
  const s = upgradeSettings(settings);
  return { region: lobbyRegionOf(s), legends: poolHasLegends(s) };
}

/**
 * Felder der Lobby-Zeile. Mit `now`: Eine öffentliche Lobby, deren Host seit
 * DRAFT_LIMITS.hostGraceMs fehlt (und die keinen neuen Host fand), wird nicht gelistet.
 */
export function lobbyFields(
  state: Pick<DraftState, 'settings' | 'teams' | 'hostTeamId' | 'phase'>,
  now?: number,
): LobbyFields {
  const s = state.settings;
  const pool = lobbyPoolFields(s);
  const host = state.teams.find((t) => t.id === state.hostTeamId);
  let visibility = s.visibility;
  if (visibility === 'public' && state.phase === 'lobby' && now !== undefined) {
    const away = !host || host.cpu ? -Infinity : host.online ? null : (host.offlineSince ?? -Infinity);
    if (away != null && now - away >= DRAFT_LIMITS.hostGraceMs) visibility = 'private';
  }
  return {
    name: s.name,
    hostName: host?.name ?? '',
    region: pool.region,
    legends: pool.legends,
    pickSeconds: s.pickSeconds,
    teams: state.teams.length,
    maxTeams: s.maxTeams,
    visibility,
    phase: state.phase,
  };
}

const sameFields = (a: LobbyFields, b: LobbyFields) =>
  (Object.keys(a) as (keyof LobbyFields)[]).every((k) => a[k] === b[k]);

/** Legt die Zeile einer neuen Liga an; false, wenn es den Code schon gibt. */
export async function insertLobby(db: Db, code: string, hostDevice: string, f: LobbyFields, now: number): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO draft_lobbies (code, host_device, name, host_name, region, legends, pick_seconds, teams,
         max_teams, visibility, phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(code, hostDevice, f.name, f.hostName, f.region, f.legends ? 1 : 0, f.pickSeconds, f.teams, f.maxTeams, f.visibility, f.phase, now, now)
    .run();
  return res.meta.changes === 1;
}

export async function updateLobby(db: Db, code: string, f: LobbyFields, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE draft_lobbies SET name = ?, host_name = ?, region = ?, legends = ?, pick_seconds = ?, teams = ?,
         max_teams = ?, visibility = ?, phase = ?, updated_at = ? WHERE code = ?`,
    )
    .bind(f.name, f.hostName, f.region, f.legends ? 1 : 0, f.pickSeconds, f.teams, f.maxTeams, f.visibility, f.phase, now, code)
    .run();
}

/** Lobby ohne Teams: Zeile bleibt noch fürs Limit neuer Ligen stehen (phase = 'closed'). */
export async function closeLobby(db: Db, code: string, now: number): Promise<void> {
  await db.prepare(`UPDATE draft_lobbies SET phase = 'closed', updated_at = ? WHERE code = ?`).bind(now, code).run();
}

export async function deleteLobby(db: Db, code: string): Promise<void> {
  await db.prepare('DELETE FROM draft_lobbies WHERE code = ?').bind(code).run();
}

export function getLobby(db: Db, code: string): Promise<Pick<LobbyRow, 'code' | 'phase'> | null> {
  return db.prepare('SELECT code, phase FROM draft_lobbies WHERE code = ?').bind(code).first<Pick<LobbyRow, 'code' | 'phase'>>();
}

/** Ligen, die ein Gerät seit `since` angelegt hat (über idx_draft_lobbies_host). */
export async function countLobbiesByHost(db: Db, hostDevice: string, since: number): Promise<number> {
  const n = await db
    .prepare('SELECT COUNT(*) AS n FROM draft_lobbies WHERE host_device = ? AND created_at >= ?')
    .bind(hostDevice, since)
    .first<number>('n');
  return n ?? 0;
}

/** Geschlossene Lobbys, die fürs Limit nicht mehr zählen, löschen (über idx_draft_lobbies_public). */
export async function purgeClosedLobbies(db: Db, before: number): Promise<number> {
  const res = await db
    .prepare(
      `DELETE FROM draft_lobbies WHERE visibility IN ('private', 'public') AND phase = 'closed' AND updated_at < ?`,
    )
    .bind(before)
    .run();
  return res.meta.changes;
}

/**
 * Öffentliche Lobbys, seit `since` aktiv – neueste zuerst nach Anlage (Änderungen schieben
 * eine Lobby nicht nach oben), pro anlegendem Gerät nur die neueste.
 */
export async function publicLobbies(db: Db, since: number, limit: number): Promise<LobbyRow[]> {
  const res = await db
    .prepare(
      `SELECT code, host_device, name, host_name, region, legends, pick_seconds, teams, max_teams, visibility, phase,
         created_at, updated_at
       FROM draft_lobbies AS l
       WHERE visibility = 'public' AND phase = 'lobby' AND updated_at >= ?
         AND NOT EXISTS (
           SELECT 1 FROM draft_lobbies AS o
           WHERE o.host_device = l.host_device AND o.visibility = 'public' AND o.phase = 'lobby' AND o.updated_at >= ?
             AND (o.created_at > l.created_at OR (o.created_at = l.created_at AND o.code > l.code))
         )
       ORDER BY created_at DESC, code
       LIMIT ?`,
    )
    .bind(since, since, limit)
    .all<LobbyRow>();
  return res.results;
}

// ---------------------------------------------------------------- Limit neuer Ligen pro IP (Tabelle meta)

const IP_COUNTER = 'draft-ip|';

/** Zähler der laufenden Stunde: „draft-ip|<Stunde>|<IP-Hash>" (Stunden sortierbar, für das Löschen). */
const ipCounterKey = (ipHash: string, now: number) =>
  `${IP_COUNTER}${String(Math.floor(now / HOUR_MS)).padStart(9, '0')}|${ipHash}`;

/** Neue Ligen dieser IP (gesalzener Hash) in der laufenden Stunde. */
/**
 * Zählt eine neue Liga dieser IP in der laufenden Stunde und liefert den neuen Stand – in einem
 * Schritt (erst zählen, dann prüfen), damit gleichzeitige Anfragen das Limit nicht überholen.
 */
export async function noteLobbyByIp(db: Db, ipHash: string, now: number): Promise<number> {
  const v = await db
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
       RETURNING value`,
    )
    .bind(ipCounterKey(ipHash, now))
    .first<string>('value');
  return Number(v) || 0;
}

/** Zähler vergangener Stunden löschen (Bereich im Primärschlüssel) – IP-Hashes bleiben nicht liegen. */
export async function purgeLobbyIpCounters(db: Db, now: number): Promise<number> {
  const res = await db.prepare('DELETE FROM meta WHERE key >= ? AND key < ?').bind(IP_COUNTER, ipCounterKey('', now)).run();
  return res.meta.changes;
}

// ---------------------------------------------------------------- Geräte-Cache

/** Erfolgreich geprüfte Geräte pro Isolate: Geräte-ID → SHA-256 des Schlüssels (spart D1 beim Wiederverbinden). */
const deviceCache = new WeakMap<Db, Map<string, string>>();
const DEVICE_CACHE_MAX = 2000;

function knownDevices(db: Db): Map<string, string> {
  let m = deviceCache.get(db);
  if (!m) {
    m = new Map();
    deviceCache.set(db, m);
  }
  return m;
}

// ---------------------------------------------------------------- Raum

function attachmentOf(conn: DraftConn): ConnAttachment | null {
  try {
    return conn.attachment();
  } catch {
    return null;
  }
}

function safeSend(conn: DraftConn, data: string): void {
  try {
    conn.send(data);
  } catch {
    // Socket schon zu – sein Close-Ereignis räumt auf.
  }
}

function safeClose(conn: DraftConn, code: number, reason: string): void {
  try {
    conn.close(code, reason);
  } catch {
    // schon geschlossen
  }
}

function isOpen(conn: DraftConn): boolean {
  try {
    return conn.isOpen ? conn.isOpen() : true;
  } catch {
    return false;
  }
}

const fail = (code: string, message: string): never => {
  throw new DraftError(code, message);
};

/** Gleicher Zustand (z. B. Einstellung auf denselben Wert)? Dann wird nichts gespeichert oder verschickt. */
const sameState = (a: DraftState, b: DraftState) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Lobby-Änderungen – zusätzlich pro Gerät gedrosselt (jede kostet Speichern und ggf. D1). Züge im
 * Draft (pick, auto-pick, reroll) nicht: Sie begrenzt schon die Engine (nur am Zug, Rerolls je Team).
 */
const LOBBY_CHANGES = new Set<DraftClientMessage['type']>(['join', 'leave', 'update-team', 'settings', 'add-cpu', 'remove-team', 'set-order', 'queue']);

interface Bucket {
  tokens: number;
  at: number;
  /** Verworfene Nachrichten am Stück */
  dropped: number;
}

export class DraftRoomCore {
  private rec: RoomRecord | null = null;
  private tomb: ClosedRoom | null = null;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  /** Zuletzt gestellter Alarm (null = unbekannt bzw. keiner) */
  private alarmAt: number | null = null;
  /** Letzter erfolgreicher Schreibvorgang der Lobby-Zeile (nur im Speicher – fürs Bündeln) */
  private lastSyncAt: number | null = null;
  /** Token-Eimer: c:<cid>, d:<Gerät>, x:<Gerät> (nur im Speicher – leichtes Limit) */
  private readonly buckets = new Map<string, Bucket>();
  /** Nachrichten einer Verbindung der Reihe nach (ein hello wartet ggf. auf D1) */
  private readonly chains = new Map<string, Promise<void>>();
  /** Verbindungen, deren hello gerade geprüft wird */
  private readonly authing = new Set<string>();

  constructor(private readonly ports: DraftPorts) {}

  /** Anhang einer frisch angenommenen Verbindung. */
  static newAttachment(ip: string | null, now: number): ConnAttachment {
    return { cid: randomHex(8), deviceId: null, authed: false, ip: ip?.trim() || null, hellos: 0, acceptedAt: now };
  }

  // ------------------------------------------------ öffentliche Einstiege (Adapter / RPC)

  /** Gibt es diese Liga (noch)? */
  exists(): Promise<boolean> {
    return this.exclusive(async () => (await this.load()) != null);
  }

  /**
   * Neue Verbindung annehmen (vor acceptWebSocket): räumt hängende Anmeldungen ab, lässt
   * bei zu vielen unangemeldeten Verbindungen (Raum bzw. IP) die älteste weichen und liefert
   * den Anhang – null nur, wenn der Raum hart voll ist.
   */
  admit(rawIp: string | null): ConnAttachment | null {
    const now = this.ports.now();
    const ip = rawIp?.trim() || null;
    const pending = this.sweepPending(now);
    const evict = (c: DraftConn) => {
      safeClose(c, DRAFT_CLOSE.timeout, 'evicted');
      pending.splice(pending.indexOf(c), 1);
    };
    if (ip) {
      const key = normalizeIp(ip);
      const same = pending.filter((c) => {
        const a = attachmentOf(c);
        return a?.ip != null && normalizeIp(a.ip) === key;
      });
      if (same.length >= DRAFT_MAX_PENDING_PER_IP) evict(same[0]);
    }
    if (pending.length >= DRAFT_MAX_PENDING) evict(pending[0]);
    const authed = this.openConns().filter((c) => attachmentOf(c)?.authed).length;
    if (authed + pending.length >= DRAFT_MAX_CONNECTIONS + DRAFT_MAX_PENDING) return null;
    return DraftRoomCore.newAttachment(ip, now);
  }

  /** Legt die Liga an (RPC von POST /api/drafts). */
  create(input: CreateRoomInput): Promise<CreateRoomResult> {
    return this.exclusive(async () => {
      if (await this.load()) return { ok: false, code: 'exists', message: 'Diese Liga gibt es schon' };
      const now = this.ports.now();
      try {
        const state = createDraft({
          code: input.code,
          seed: input.seed,
          settings: input.settings,
          host: { teamId: newTeamId(null), deviceId: input.deviceId, name: cleanTeamName(input.teamName), formation: input.formation },
          now,
          list: this.ports.list,
        });
        await this.commit(null, state, now);
        return { ok: true };
      } catch (err) {
        if (err instanceof DraftError) return { ok: false, code: err.code, message: err.message };
        throw err;
      }
    });
  }

  /** Revanche: Vorlage aus dieser fertigen Liga (RPC von POST /api/drafts/:code/rematch) – oder die schon angelegte. */
  rematchTemplate(deviceId: string, dead: string | null = null): Promise<RematchTemplateResult> {
    return this.exclusive(async () => {
      const rec = await this.load();
      if (!rec) return { ok: false, code: 'not_found', message: 'Diese Liga gibt es nicht (mehr)' };
      // Die bisherige Revanche gibt es nicht mehr (alle haben sie verlassen) → neue Vorlage
      if (rec.state.rematch && rec.state.rematch !== dead) return { ok: true, existing: rec.state.rematch };
      try {
        return { ok: true, template: rematchTemplate(rec.state, deviceId, this.ports.now()) };
      } catch (err) {
        if (err instanceof DraftError) return { ok: false, code: err.code, message: err.message };
        throw err;
      }
    });
  }

  /** Revanche: legt die Liga aus der Vorlage an (RPC – Code und Seed hat der Server vergeben). */
  createFrom(state: DraftState): Promise<CreateRoomResult> {
    return this.exclusive(async () => {
      if (await this.load()) return { ok: false, code: 'exists', message: 'Diese Liga gibt es schon' };
      await this.commit(null, state, this.ports.now());
      return { ok: true };
    });
  }

  /**
   * Revanche, die gegen eine gleichzeitige Anfrage verloren hat: Speicher und Alarm löschen (die
   * Lobby-Zeile löscht der Endpunkt). Niemand ist verbunden – den Code kennt nur der Server.
   */
  discard(): Promise<void> {
    return this.exclusive(async () => {
      await this.ports.alarm.clear();
      this.alarmAt = null;
      await this.ports.storage.clear();
      this.rec = null;
      this.tomb = null;
      this.loaded = true;
      this.closeAll('Diese Liga gibt es nicht');
    });
  }

  /** Revanche merken und verteilen – der erste Code gilt (gleichzeitige Anfragen). null ohne Liga. */
  setRematch(code: string, dead: string | null = null): Promise<string | null> {
    return this.exclusive(async () => {
      const rec = await this.load();
      if (!rec) return null;
      if (rec.state.rematch && rec.state.rematch !== dead) return rec.state.rematch;
      await this.commit(rec.state, { ...rec.state, rematch: code }, this.ports.now());
      return code;
    });
  }

  /** Schnappschuss für Zuschauer (GET /api/drafts/:code) – null, wenn es die Liga nicht gibt. */
  snapshot(): Promise<DraftSnapshot | null> {
    return this.exclusive(async () => {
      const rec = await this.load();
      return rec ? snapshotOf(rec.state, null, this.ports.now()) : null;
    });
  }

  /** Eingehende WebSocket-Nachricht. Wirft nie wegen schlechter Eingaben. */
  message(conn: DraftConn, raw: unknown): Promise<void> {
    const att = attachmentOf(conn);
    if (!att) {
      safeClose(conn, DRAFT_CLOSE.unauthorized, 'unknown');
      return Promise.resolve();
    }
    if (!this.allow(conn, att, this.ports.now())) return Promise.resolve();
    const cid = att.cid;
    const run = (this.chains.get(cid) ?? Promise.resolve()).then(() => this.process(conn, raw));
    const tail = run.catch(() => undefined);
    this.chains.set(cid, tail);
    void tail.then(() => {
      if (this.chains.get(cid) === tail) this.chains.delete(cid);
    });
    return run;
  }

  /**
   * Verbindung geschlossen bzw. abgebrochen: In der Warteschlange (mit frischem Anhang)
   * alle Online-Flags mit den wirklich offenen, angemeldeten Verbindungen abgleichen.
   */
  disconnect(conn: DraftConn): Promise<void> {
    const gone = attachmentOf(conn);
    if (gone) this.buckets.delete(`c:${gone.cid}`);
    return this.exclusive(async () => {
      const rec = await this.load();
      if (!rec) return;
      const cid = attachmentOf(conn)?.cid ?? gone?.cid ?? null;
      const now = this.ports.now();
      const next = this.reconcile(rec.state, now, cid);
      if (next !== rec.state) await this.commit(rec.state, next, now);
    });
  }

  /**
   * Alarm: CPU-Pick, Timer-Auto-Pick, Host-Wechsel, Gnadenfristen, Lobby-Zeile, Löschfrist
   * bzw. Grabstein – jeweils mit aktuellem Stand neu geprüft. Hängende Anmeldungen fliegen raus.
   */
  alarm(): Promise<void> {
    return this.exclusive(async () => {
      this.alarmAt = null;
      const now = this.ports.now();
      this.sweepPending(now);
      const rec = await this.load();
      if (this.tomb) return this.tombAlarm(now);
      if (!rec) return;
      const s = rec.state;
      if (now >= expiresAt(s)) return this.expire(now);
      const cur = currentTeam(s);
      let next = s;
      try {
        if (cur?.cpu && rec.cpuAt != null && now >= rec.cpuAt) {
          const c = autoPickChoice(s, cur.id, this.ports.list, this.ports.scale, true);
          next = applyPick(s, cur.id, c.pokemonId, c.slot, true, now, this.ports.list);
        } else if (cur && !cur.cpu && s.deadline != null && now >= s.deadline) {
          const c = autoPickChoice(s, cur.id, this.ports.list, this.ports.scale, false);
          next = applyPick(s, cur.id, c.pokemonId, c.slot, true, now, this.ports.list);
        }
      } catch (err) {
        if (!(err instanceof DraftError)) throw err;
        console.error('Draft-Raum: Auto-Pick unmöglich', err);
      }
      // Manager-Saison: fällige Spieltage spielen
      if (next.phase === 'season') next = playDueMatchdays(next, now, this.ports.list, this.ports.scale);
      next = transferHost(next, now);
      if (next !== s) return this.commit(s, next, now);
      // Gnadenfrist vorbei: Alle bekommen den Stand (Auto-Pick für andere ist jetzt erlaubt).
      const opens = autoPickOpensAt(s);
      if (cur && !cur.cpu && opens != null && opens <= now) this.broadcast(s, now);
      // Sonst (veralteter Alarm): Abschlüsse bzw. Lobby-Zeile nachziehen, richtigen Alarm wieder stellen.
      if (rec.resultsAt != null && now >= rec.resultsAt) await this.saveResults(now);
      await this.syncLobby(now);
      await this.schedule(now);
    });
  }

  // ------------------------------------------------ intern

  /** Führt fn exklusiv aus – Nachrichten, Alarme und RPCs eines Raums nacheinander. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Lädt den Raum; beim ersten Laden wird der Zustand einer älteren Liga (Einstellungen mit
   * region/legends, ohne die neuen Felder) in die aktuelle Form gebracht und so gespeichert,
   * dann werden die Online-Flags mit den offenen Verbindungen abgeglichen.
   */
  private async load(): Promise<RoomRecord | null> {
    if (!this.loaded) {
      const stored = await this.ports.storage.load();
      this.loaded = true;
      this.tomb = stored && isClosedRoom(stored) ? stored : null;
      this.rec = null;
      if (stored && !isClosedRoom(stored)) {
        const state = upgradeState(stored.state);
        this.rec = state === stored.state ? stored : { ...stored, state };
        if (this.rec !== stored) {
          try {
            await this.ports.storage.save(this.rec);
          } catch (err) {
            // Nicht schlimm: Umschreiben geht jederzeit wieder, der nächste commit speichert ohnehin.
            console.error('Draft-Raum: umgeschriebener Zustand nicht gespeichert', err);
          }
        }
      }
      if (this.rec) {
        // z. B. nach einem Neustart (Deploy): Verbindungen sind weg, ohne dass webSocketClose kam
        const now = this.ports.now();
        const fixed = this.reconcile(this.rec.state, now);
        if (fixed !== this.rec.state) await this.commit(this.rec.state, fixed, now);
      }
    }
    return this.rec;
  }

  private openConns(): DraftConn[] {
    return this.ports.sockets().filter(isOpen);
  }

  /** Online-Flag jedes Menschen = hat sein Gerät eine offene, angemeldete Verbindung (außer `exceptCid`). */
  private reconcile(state: DraftState, now: number, exceptCid: string | null = null): DraftState {
    const live = new Set<string>();
    for (const c of this.openConns()) {
      const a = attachmentOf(c);
      if (a?.authed && a.deviceId && a.cid !== exceptCid) live.add(a.deviceId);
    }
    let next = state;
    for (const t of state.teams) {
      if (t.cpu) continue;
      const owner = state.owners[t.id];
      const online = owner != null && live.has(owner);
      if (t.online !== online) next = setOnline(next, t.id, online, now);
    }
    return next;
  }

  /**
   * Schließt unangemeldete Verbindungen, deren hello-Frist abgelaufen ist; liefert die übrigen
   * unangemeldeten – älteste zuerst, solche mit laufender Prüfung zuletzt (sie weichen zuletzt).
   */
  private sweepPending(now: number): DraftConn[] {
    const pending: { conn: DraftConn; at: number; busy: boolean }[] = [];
    for (const c of this.openConns()) {
      const a = attachmentOf(c);
      if (!a || a.authed) continue;
      const busy = this.authing.has(a.cid);
      const at = a.acceptedAt ?? 0;
      if (!busy && now - at >= DRAFT_HELLO_TIMEOUT_MS) {
        safeClose(c, DRAFT_CLOSE.timeout, 'hello timeout');
        continue;
      }
      pending.push({ conn: c, at, busy });
    }
    pending.sort((x, y) => Number(x.busy) - Number(y.busy) || x.at - y.at);
    return pending.map((p) => p.conn);
  }

  private send(conn: DraftConn, msg: DraftServerMessage): void {
    safeSend(conn, JSON.stringify(msg));
  }

  private sendError(conn: DraftConn, code: string, message: string, forType?: DraftClientMessage['type']): void {
    this.send(conn, forType ? { type: 'error', code, message, for: forType } : { type: 'error', code, message });
  }

  /** Token-Eimer `key` (nachgefüllt bis jetzt). */
  private bucket(key: string, cfg: { burst: number; perSecond: number }, now: number): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size > 4096) this.pruneBuckets(now);
      b = { tokens: cfg.burst, at: now, dropped: 0 };
      this.buckets.set(key, b);
    } else if (now > b.at) {
      b.tokens = Math.min(cfg.burst, b.tokens + ((now - b.at) * cfg.perSecond) / 1000);
      b.at = now;
    }
    return b;
  }

  /** Volle bzw. lange unbenutzte Eimer vergessen (Speicher). */
  private pruneBuckets(now: number): void {
    for (const [key, b] of this.buckets) if (now - b.at > 120_000) this.buckets.delete(key);
  }

  /**
   * Limit pro Verbindung und pro Gerät (über alle seine Verbindungen). Die erste verworfene
   * Nachricht bekommt einen Fehler; wer danach weiterflutet, wird getrennt.
   */
  private allow(conn: DraftConn, att: ConnAttachment, now: number): boolean {
    const own = this.bucket(`c:${att.cid}`, DRAFT_RATE.socket, now);
    const dev = att.authed && att.deviceId ? this.bucket(`d:${att.deviceId}`, DRAFT_RATE.device, now) : null;
    if (own.tokens >= 1 && (!dev || dev.tokens >= 1)) {
      own.tokens -= 1;
      if (dev) dev.tokens -= 1;
      own.dropped = 0;
      return true;
    }
    own.dropped++;
    if (own.dropped === 1) this.sendError(conn, 'rate_limited', 'Zu viele Nachrichten – bitte kurz warten');
    if (own.dropped >= DRAFT_RATE.closeAfter) safeClose(conn, DRAFT_CLOSE.flood, 'rate limited');
    return false;
  }

  /** Lobby-Änderungen pro Gerät (Speichern, Verteilen, ggf. D1) */
  private allowChange(deviceId: string, now: number): boolean {
    const key = `x:${deviceId}`;
    // Nach dem Aufwachen: Stand aus dem Raum-Speicher – sonst wäre der Eimer nach jeder Hibernation voll
    const saved = this.rec?.rates?.[deviceId];
    if (saved && !this.buckets.has(key)) this.buckets.set(key, { tokens: saved.tokens, at: saved.at, dropped: 0 });
    const b = this.bucket(key, DRAFT_RATE.changes, now);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Nicht volle Änderungs-Eimer (im Speicher und gespeicherte) – kommen mit jedem commit in den Raum. */
  private changeRates(now: number): RoomRecord['rates'] {
    const { burst, perSecond } = DRAFT_RATE.changes;
    const out: NonNullable<RoomRecord['rates']> = {};
    let n = 0;
    const add = (deviceId: string, b: { tokens: number; at: number }) => {
      if (n >= 2 * DRAFT_MAX_CONNECTIONS || Object.hasOwn(out, deviceId)) return;
      if (b.tokens + (Math.max(0, now - b.at) * perSecond) / 1000 >= burst) return;
      out[deviceId] = { tokens: b.tokens, at: b.at };
      n++;
    };
    for (const [key, b] of this.buckets) if (key.startsWith('x:')) add(key.slice(2), b);
    for (const [deviceId, b] of Object.entries(this.rec?.rates ?? {})) add(deviceId, b);
    return n ? out : undefined;
  }

  private snapshotFor(state: DraftState, deviceId: string | null, now: number): DraftSnapshot {
    return snapshotOf(state, deviceId ? teamOfDevice(state, deviceId) : null, now);
  }

  private sendState(conn: DraftConn, state: DraftState, deviceId: string | null, now: number): void {
    this.send(conn, { type: 'state', state: this.snapshotFor(state, deviceId, now) });
  }

  /** Personalisierte Schnappschüsse an alle angemeldeten Verbindungen (je Team nur einmal serialisiert). */
  private broadcast(state: DraftState, now: number): void {
    const cache = new Map<string | null, string>();
    for (const conn of this.openConns()) {
      const a = attachmentOf(conn);
      if (!a?.authed) continue;
      const you = a.deviceId ? teamOfDevice(state, a.deviceId) : null;
      let data = cache.get(you);
      if (data === undefined) {
        const msg: DraftServerMessage = { type: 'state', state: snapshotOf(state, you, now) };
        data = JSON.stringify(msg);
        cache.set(you, data);
      }
      safeSend(conn, data);
    }
  }

  private async schedule(now: number): Promise<void> {
    if (!this.rec) return;
    const at = nextAlarmAt(this.rec, now);
    if (at === this.alarmAt) return;
    await this.ports.alarm.set(at);
    this.alarmAt = at;
  }

  private async persist(rec: RoomRecord): Promise<void> {
    await this.ports.storage.save(rec);
    this.rec = rec;
  }

  /**
   * Neuer Zustand: fälligen Host-Wechsel und (am Ende) das Saisonergebnis einrechnen,
   * speichern, verteilen, Lobby-Zeile abgleichen, Alarm stellen.
   */
  private async commit(prev: DraftState | null, input: DraftState, now: number): Promise<void> {
    const hosted = transferHost(input, now);
    // Saisonende: Teams echter Spieler aus der Rangliste zum Auffüllen laden (nur einmal)
    const needsFill = (hosted.phase === 'done' && hosted.season && !hosted.league) || (hosted.phase === 'season' && !hosted.manager);
    const candidates = needsFill ? await loadFillCandidates(this.ports.env.DB) : [];
    // Manager-Saison: Auffüllteams und erste Aufstellungen beim Ende des Drafts
    const started = startManagerSeason(hosted, this.ports.list, this.ports.scale, candidates);
    const next = withLeague(started, this.ports.list, this.ports.scale, candidates);
    const cur = currentTeam(next);
    const moved = !prev || prev.phase !== next.phase || prev.pickIndex !== next.pickIndex;
    const cpuAt = cur?.cpu ? (moved || this.rec?.cpuAt == null ? now + DRAFT_LIMITS.cpuPickMs : this.rec.cpuAt) : null;
    const rec: RoomRecord = {
      state: next,
      cpuAt,
      // Neue Liga: Die Zeile hat POST /api/drafts gerade mit genau diesen Feldern angelegt.
      synced: prev ? (this.rec?.synced ?? null) : lobbyFields(next, now),
      syncAt: prev ? (this.rec?.syncAt ?? null) : null,
    };
    const rates = this.changeRates(now);
    if (rates) rec.rates = rates;
    // Liga gerade fertig geworden: Abschlüsse für die Erfolge speichern (sonst später erneut)
    const finished = next.phase === 'done' && !!next.league && !!prev && prev.phase !== 'done';
    if (finished) rec.resultsAt = now;
    else if (this.rec?.resultsAt != null) rec.resultsAt = this.rec.resultsAt;
    await this.persist(rec);
    this.tomb = null;
    this.loaded = true;
    this.broadcast(next, now);
    if (finished) await this.saveResults(now);
    await this.syncLobby(now);
    await this.schedule(now);
  }

  /** Abschlüsse der fertigen Liga in D1 – bei einem Fehler nach LOBBY_RETRY_MS erneut (Alarm). */
  private async saveResults(now: number): Promise<void> {
    const rec = this.rec;
    if (!rec || rec.resultsAt == null) return;
    try {
      await saveDraftResults(this.ports.env.DB, rec.state, now);
      await this.persist({ ...rec, resultsAt: null });
    } catch (err) {
      console.error('Draft-Raum: Abschlüsse nicht gespeichert – neuer Versuch folgt', err);
      await this.persist({ ...rec, resultsAt: now + LOBBY_RETRY_MS });
    }
  }

  /**
   * Lobby-Zeile nachziehen, wenn sich Gelistetes geändert hat (oder ein Versuch scheiterte).
   * Die Phase sofort, alles andere (auch Sichtbarkeit und „voll") höchstens alle LOBBY_SYNC_MS. Fehler stoppen
   * den Draft nicht – der Alarm versucht es nach LOBBY_RETRY_MS erneut.
   */
  private async syncLobby(now: number): Promise<void> {
    const rec = this.rec;
    if (!rec) return;
    const want = lobbyFields(rec.state, now);
    const have = rec.synced ?? null;
    if (have && sameFields(have, want)) {
      if (rec.syncAt != null) await this.persist({ ...rec, syncAt: null });
      return;
    }
    const urgent = !have || have.phase !== want.phase;
    if (!urgent) {
      const earliest = Math.max(rec.syncAt ?? -Infinity, this.lastSyncAt != null ? this.lastSyncAt + LOBBY_SYNC_MS : -Infinity);
      if (now < earliest) {
        if (rec.syncAt !== earliest) await this.persist({ ...rec, syncAt: earliest });
        return;
      }
    }
    try {
      const db = this.ports.env.DB;
      await ensureSchema(db);
      await updateLobby(db, rec.state.code, want, now);
    } catch (err) {
      console.error('Draft-Raum: Lobby-Zeile nicht aktualisiert – neuer Versuch folgt', err);
      await this.persist({ ...rec, syncAt: now + LOBBY_RETRY_MS });
      return;
    }
    this.lastSyncAt = now;
    await this.persist({ ...rec, synced: want, syncAt: null });
  }

  /** Alle Verbindungen benachrichtigen und schließen (Liga zu). */
  private closeAll(message: string): void {
    const data = JSON.stringify({ type: 'error', code: 'closed', message } satisfies DraftServerMessage);
    for (const conn of this.ports.sockets()) {
      if (attachmentOf(conn)?.authed) safeSend(conn, data);
      safeClose(conn, DRAFT_CLOSE.closed, 'closed');
    }
  }

  /**
   * Lobby ohne Menschen: Zeile in D1 auf 'closed', Zustand weg (nur ein Grabstein bleibt),
   * nach CLOSED_LOBBY_KEEP_MS löscht der Alarm die Zeile. Scheitert schon das Schließen,
   * löscht er sie nach LOBBY_RETRY_MS ganz (sonst bliebe eine Geister-Lobby gelistet).
   */
  private async closeEmpty(now: number): Promise<void> {
    const code = this.rec?.state.code;
    if (!code) return;
    let deleteAt = now + CLOSED_LOBBY_KEEP_MS;
    try {
      const db = this.ports.env.DB;
      await ensureSchema(db);
      await closeLobby(db, code, now);
    } catch (err) {
      console.error('Draft-Raum: Lobby-Zeile nicht geschlossen – wird gleich gelöscht', err);
      deleteAt = now + LOBBY_RETRY_MS;
    }
    const tomb: ClosedRoom = { closed: { code, deleteAt } };
    await this.ports.storage.save(tomb);
    await this.ports.alarm.set(deleteAt);
    this.alarmAt = deleteAt;
    this.rec = null;
    this.tomb = tomb;
    this.loaded = true;
    this.closeAll('Die Liga wurde geschlossen – es ist niemand mehr dabei');
  }

  /** Grabstein fällig: D1-Zeile löschen, dann ist der Raum ganz leer. */
  private async tombAlarm(now: number): Promise<void> {
    const t = this.tomb!.closed;
    let retryAt = t.deleteAt;
    if (now >= t.deleteAt) {
      try {
        const db = this.ports.env.DB;
        await ensureSchema(db);
        await deleteLobby(db, t.code);
        await this.ports.alarm.clear();
        this.alarmAt = null;
        await this.ports.storage.clear();
        this.tomb = null;
        return;
      } catch (err) {
        console.error('Draft-Raum: geschlossene Lobby-Zeile nicht gelöscht – neuer Versuch folgt', err);
        retryAt = now + CLOSED_RETRY_MS;
        this.tomb = { closed: { ...t, deleteAt: retryAt } };
        await this.ports.storage.save(this.tomb);
      }
    }
    await this.ports.alarm.set(retryAt);
    this.alarmAt = retryAt;
  }

  /** Löschfrist erreicht: Zeile, Speicher und Alarm weg, alle Verbindungen zu. */
  private async expire(now: number): Promise<void> {
    const code = this.rec?.state.code;
    if (code) {
      try {
        const db = this.ports.env.DB;
        await ensureSchema(db);
        await deleteLobby(db, code);
      } catch (err) {
        // In einer Stunde erneut versuchen, sonst bliebe die Zeile für immer.
        console.error('Draft-Raum: Lobby-Zeile nicht gelöscht', err);
        await this.ports.alarm.set(now + HOUR_MS);
        this.alarmAt = now + HOUR_MS;
        return;
      }
    }
    await this.ports.alarm.clear();
    this.alarmAt = null;
    await this.ports.storage.clear();
    this.rec = null;
    this.tomb = null;
    this.loaded = true;
    this.closeAll('Diese Liga ist abgelaufen');
  }

  /** Eine Nachricht verarbeiten (in der Reihenfolge ihrer Verbindung). */
  private async process(conn: DraftConn, raw: unknown): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return this.sendError(conn, parsed.code, parsed.message);
    const msg = parsed.msg;
    if (msg.type === 'hello') return this.hello(conn, msg);
    await this.exclusive(() => this.guarded(conn, msg.type, () => this.handle(conn, msg)));
  }

  /** Fehler einer Nachricht: Regelverstöße an den Absender, alles andere als server_error. */
  private async guarded(conn: DraftConn, type: DraftClientMessage['type'], fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof DraftError || err instanceof ApiError) return this.sendError(conn, err.code, err.message, type);
      console.error('Draft-Raum: Fehler bei', type, err);
      this.sendError(conn, 'server_error', 'Interner Serverfehler – bitte erneut versuchen', type);
    }
  }

  private async handle(conn: DraftConn, msg: Exclude<DraftClientMessage, { type: 'hello' }>): Promise<void> {
    const att = attachmentOf(conn);
    if (!att) return;
    if (!att.authed || !att.deviceId) return this.sendError(conn, 'unauthorized', 'Bitte zuerst anmelden (hello)', msg.type);
    if (msg.type === 'ping') return this.send(conn, { type: 'pong', serverNow: this.ports.now() });
    const rec = await this.load();
    if (!rec) return this.sendError(conn, 'not_found', 'Diese Liga gibt es nicht (mehr)', msg.type);
    const now = this.ports.now();
    if (msg.type === 'react') return this.react(conn, rec.state, att.deviceId, msg.emoji, now);
    if (LOBBY_CHANGES.has(msg.type) && !this.allowChange(att.deviceId, now)) {
      return this.sendError(conn, 'rate_limited', 'Zu viele Änderungen – bitte kurz warten', msg.type);
    }
    const applied = this.apply(rec.state, att.deviceId, msg, now);
    // Neu beigetreten: Trainer vom Anmelden mitnehmen
    const next = msg.type === 'join' && att.trainer !== undefined ? withTrainer(applied, att.deviceId, att.trainer) : applied;
    // Nichts geändert (z. B. „leave" ohne Team, gleiche Einstellung): nur den aktuellen Stand zurück.
    if (sameState(next, rec.state)) return this.sendState(conn, rec.state, att.deviceId, now);
    if (msg.type === 'leave' && next.phase === 'lobby' && !next.teams.some((t) => !t.cpu)) return this.closeEmpty(now);
    await this.commit(rec.state, next, now);
  }

  /** Reaktion eines Mitglieds an alle angemeldeten Verbindungen – ohne Speichern, mit eigenem Limit. */
  private react(conn: DraftConn, state: DraftState, deviceId: string, emoji: DraftReaction, now: number): void {
    const teamId = teamOfDevice(state, deviceId);
    if (!teamId) return this.sendError(conn, 'not_joined', 'Du bist in dieser Liga nicht dabei', 'react');
    const b = this.bucket(`r:${deviceId}`, DRAFT_REACTION_RATE, now);
    if (b.tokens < 1) return;
    b.tokens -= 1;
    const data = JSON.stringify({ type: 'reaction', teamId, emoji, at: now } satisfies DraftServerMessage);
    for (const c of this.openConns()) if (attachmentOf(c)?.authed) safeSend(c, data);
  }

  /**
   * hello: Gerät außerhalb der Warteschlange prüfen (D1, mit Cache), dann in der Warteschlange
   * anmelden. Ein vorübergehender Serverfehler schließt die Verbindung (DRAFT_CLOSE.retry) –
   * der Client verbindet neu und schickt hello erneut; er zählt nicht als Fehlversuch.
   */
  private async hello(conn: DraftConn, msg: DeviceAuth): Promise<void> {
    const att = attachmentOf(conn);
    if (!att) return;
    if (att.authed) return this.exclusive(() => this.guarded(conn, 'hello', () => this.helloAgain(conn, att, msg)));
    if (att.hellos >= DRAFT_MAX_HELLOS) {
      this.sendError(conn, 'unauthorized', 'Zu viele fehlgeschlagene Anmeldungen');
      return safeClose(conn, DRAFT_CLOSE.unauthorized, 'unauthorized');
    }
    // Liga schon weg: ohne D1 antworten
    if (this.loaded && !this.rec) return this.sendError(conn, 'not_found', 'Diese Liga gibt es nicht (mehr)');
    let auth: DeviceAuth;
    let trainer: TrainerLook | null | undefined;
    this.authing.add(att.cid);
    try {
      auth = parseDeviceAuth({ ...msg });
      await this.verifyDevice(auth, this.ports.now(), att.ip);
      trainer = await this.loadTrainer(auth.deviceId);
    } catch (err) {
      if (err instanceof DraftError || err instanceof ApiError) {
        try {
          conn.setAttachment({ ...att, hellos: att.hellos + 1 });
        } catch {
          // Verbindung schon zu
        }
        return this.sendError(conn, err.code, err.message);
      }
      console.error('Draft-Raum: Anmeldung fehlgeschlagen (Server)', err);
      return safeClose(conn, DRAFT_CLOSE.retry, 'retry');
    } finally {
      this.authing.delete(att.cid);
    }
    await this.exclusive(() => this.guarded(conn, 'hello', () => this.finishHello(conn, auth.deviceId, trainer)));
  }

  /** Trainer des Geräts aus D1 – undefined bei einem Fehler (dann bleibt alles, wie es ist). */
  private async loadTrainer(deviceId: string): Promise<TrainerLook | null | undefined> {
    try {
      const db = this.ports.env.DB;
      await ensureSchema(db);
      const row = await db.prepare('SELECT look_json FROM trainers WHERE device_id = ?').bind(deviceId).first<{ look_json: string }>();
      return lookFromJson(row?.look_json);
    } catch (err) {
      console.error('Draft-Raum: Trainer nicht geladen', err);
      return undefined;
    }
  }

  /** Gerät prüfen: zuerst der Cache dieses Isolates, sonst D1 (registriert auch neue Geräte). */
  private async verifyDevice(auth: DeviceAuth, now: number, ip: string | null): Promise<void> {
    const db = this.ports.env.DB;
    const hash = await sha256Hex(auth.deviceSecret);
    const known = knownDevices(db);
    const cached = known.get(auth.deviceId);
    if (cached != null && timingSafeEqual(cached, hash)) return;
    await ensureSchema(db);
    await authenticateDevice(this.ports.env, auth, now, ip);
    known.delete(auth.deviceId);
    known.set(auth.deviceId, hash);
    if (known.size > DEVICE_CACHE_MAX) known.delete(known.keys().next().value!);
  }

  /** Wiederholtes hello einer angemeldeten Verbindung: gleiches Gerät → nur den Stand schicken. */
  private async helloAgain(conn: DraftConn, att: ConnAttachment, msg: DeviceAuth): Promise<void> {
    let same = false;
    try {
      same = parseDeviceAuth({ ...msg }).deviceId === att.deviceId;
    } catch {
      // fällt unten in den Fehler
    }
    if (!same) return this.sendError(conn, 'bad_message', 'Diese Verbindung ist schon mit einem anderen Gerät angemeldet');
    const rec = await this.load();
    if (!rec) return this.sendError(conn, 'not_found', 'Diese Liga gibt es nicht (mehr)');
    this.sendState(conn, rec.state, att.deviceId, this.ports.now());
  }

  /**
   * Geprüftes Gerät anmelden – nur, wenn die Verbindung noch offen ist. Pro Gerät höchstens
   * DRAFT_MAX_SOCKETS_PER_DEVICE Verbindungen (der älteste Tab weicht), pro IP höchstens
   * DRAFT_MAX_SPECTATORS_PER_IP Zuschauer; ist der Raum voll, verdrängt ein Team-Besitzer
   * den ältesten Zuschauer, ein Zuschauer bekommt keinen Platz.
   */
  private async finishHello(conn: DraftConn, deviceId: string, trainer?: TrainerLook | null): Promise<void> {
    if (!isOpen(conn)) return;
    const att = attachmentOf(conn);
    if (!att) return;
    const rec = await this.load();
    if (att.authed) {
      // Schon angemeldet (paralleles hello): wie ein wiederholtes hello behandeln
      if (att.deviceId !== deviceId) return this.sendError(conn, 'bad_message', 'Diese Verbindung ist schon mit einem anderen Gerät angemeldet');
      return rec ? this.sendState(conn, rec.state, deviceId, this.ports.now()) : this.sendError(conn, 'not_found', 'Diese Liga gibt es nicht (mehr)');
    }
    if (!rec) return this.sendError(conn, 'not_found', 'Diese Liga gibt es nicht (mehr)');
    const now = this.ports.now();
    const byAge = (x: { att: ConnAttachment }, y: { att: ConnAttachment }) => (x.att.acceptedAt ?? 0) - (y.att.acceptedAt ?? 0);
    let others = this.openConns().flatMap((c) => {
      const a = c === conn ? null : attachmentOf(c);
      return a?.authed && a.deviceId ? [{ conn: c, att: a }] : [];
    });
    // Pro Gerät: Der älteste Tab weicht dem neuen (oft halb offen nach einem Netzwechsel). Auslösen
    // kann das nur das geprüfte Gerät selbst; der verdrängte Tab verbindet nicht von selbst neu.
    const sameDevice = others.filter((o) => o.att.deviceId === deviceId).sort(byAge);
    while (sameDevice.length >= DRAFT_MAX_SOCKETS_PER_DEVICE) {
      const old = sameDevice.shift()!;
      this.sendError(old.conn, 'replaced', 'Diese Liga ist jetzt in einem anderen Tab geöffnet');
      safeClose(old.conn, DRAFT_CLOSE.replaced, 'replaced');
      others = others.filter((o) => o !== old);
    }
    const owner = teamOfDevice(rec.state, deviceId) != null;
    // Zuschauer pro IP begrenzt – sonst füllen wenige Geräte einer IP den Raum und niemand kann mehr beitreten
    if (!owner && att.ip) {
      const key = normalizeIp(att.ip);
      const sameIp = others.filter(
        (o) => o.att.ip != null && normalizeIp(o.att.ip) === key && !teamOfDevice(rec.state, o.att.deviceId!),
      );
      if (sameIp.length >= DRAFT_MAX_SPECTATORS_PER_IP) {
        this.sendError(conn, 'too_many_connections', 'Zu viele Zuschauer aus deinem Netz in dieser Liga – bitte später erneut versuchen');
        return safeClose(conn, DRAFT_CLOSE.full, 'too many spectators');
      }
    }
    if (others.length >= DRAFT_MAX_CONNECTIONS) {
      if (!owner) {
        this.sendError(conn, 'room_full', 'Zu viele Zuschauer in dieser Liga – bitte später erneut versuchen');
        return safeClose(conn, DRAFT_CLOSE.full, 'room full');
      }
      const spectator = others
        .filter((o) => !teamOfDevice(rec.state, o.att.deviceId!))
        .sort(byAge)[0];
      if (spectator) {
        this.sendError(spectator.conn, 'room_full', 'Platz für ein Team der Liga gemacht – bitte später erneut verbinden');
        safeClose(spectator.conn, DRAFT_CLOSE.full, 'room full');
      }
    }
    conn.setAttachment({ ...att, deviceId, authed: true, ...(trainer !== undefined ? { trainer } : {}) });
    this.sweepPending(now);
    // Wieder da: Team online (alle sehen es), Trainer aktuell – sonst bekommt nur diese Verbindung den Stand.
    const dressed = trainer !== undefined ? withTrainer(rec.state, deviceId, trainer) : rec.state;
    const next = this.reconcile(dressed, now);
    if (next !== rec.state) return this.commit(rec.state, next, now);
    this.sendState(conn, rec.state, deviceId, now);
  }

  /** Wendet eine Nachricht mit der Engine an (wirft DraftError bei Unerlaubtem). */
  private apply(state: DraftState, deviceId: string, msg: Exclude<DraftClientMessage, { type: 'hello' | 'ping' | 'react' }>, now: number): DraftState {
    const { list, scale } = this.ports;
    switch (msg.type) {
      case 'join': {
        const teamId = newTeamId(state);
        const joined = joinDraft(state, { teamId, deviceId, name: cleanTeamName(msg.teamName), formation: msg.formation });
        return setOnline(joined, teamId, true, now);
      }
      case 'leave':
        return leaveDraft(state, deviceId);
      case 'update-team':
        return updateTeam(state, deviceId, {
          ...(msg.teamName !== undefined ? { name: cleanTeamName(msg.teamName) } : {}),
          ...(msg.formation !== undefined ? { formation: msg.formation } : {}),
        });
      case 'settings':
        return updateSettings(state, deviceId, cleanSettingsPatch(msg.settings), list);
      case 'add-cpu':
        return addCpuTeam(state, deviceId, newTeamId(state));
      case 'remove-team':
        return removeTeam(state, deviceId, msg.teamId);
      case 'set-order': {
        const next = setOrder(state, deviceId, msg.order);
        if (state.settings.order !== 'host') {
          fail('order_random', 'Die Reihenfolge wird ausgelost – stelle zuerst „Reihenfolge: Host" ein');
        }
        return next;
      }
      case 'start':
        return startDraft(state, deviceId, now, list);
      case 'queue':
        return setQueue(state, deviceId, msg.ids, list);
      case 'lineup':
        // Ein überfälliger Spieltag (Alarm noch nicht gelaufen) wird erst gespielt – die Aufstellung gilt für den nächsten
        return setLineup(playDueMatchdays(state, now, list, scale), deviceId, msg, list, scale);
      case 'pick': {
        const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
        return applyPick(state, teamId, msg.pokemonId, msg.slot, false, now, list);
      }
      case 'reroll': {
        // Nur das Team am Zug (sein Mensch), nie für andere – die Engine prüft Zug, Wurf und Vorrat.
        const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
        // Gezielt (Pick bzw. Wurf, den der Client gesehen hat), aber der Zug ist schon weiter oder
        // der Wurf schon neu (Timer, zweiter Tab, Snake-Doppelzug) → nicht den ungesehenen Wurf rerollen
        const seen = msg.roll;
        if (
          (msg.pickIndex !== undefined && msg.pickIndex !== state.pickIndex) ||
          (seen && (!state.roll || state.roll.gen !== seen.gen || state.roll.type !== seen.type))
        ) {
          fail('stale', 'Dieser Zug ist schon vorbei');
        }
        return applyReroll(state, teamId, msg.kind, list);
      }
      case 'auto-pick': {
        const cur = currentTeam(state) ?? fail('not_drafting', 'Gerade wird nicht gedraftet');
        // Gezielter Klick, aber der Zug ist schon weiter (Doppelklick, Timer, Wiederkehr)
        if ((msg.teamId !== undefined && msg.teamId !== cur.id) || (msg.pickIndex !== undefined && msg.pickIndex !== state.pickIndex)) {
          fail('stale', 'Dieser Zug ist schon vorbei');
        }
        const mine = teamOfDevice(state, deviceId);
        // Für andere: jedes Mitglied – CPU sofort, Abwesende nach der Gnadenfrist, ohne Timer auch nach langer Bedenkzeit.
        if (!mayAutoPick(state, mine, now)) {
          fail(
            'not_allowed',
            mine && !cur.online
              ? `Auto-Pick für „${cur.name}" geht erst, wenn das Team ${DRAFT_LIMITS.offlineGraceMs / 1000} s offline ist`
              : 'Du bist nicht dran',
          );
        }
        const c = autoPickChoice(state, cur.id, list, scale, cur.cpu);
        return applyPick(state, cur.id, c.pokemonId, c.slot, true, now, list);
      }
    }
  }
}
