/**
 * HTTP-Endpunkte des Online-Drafts (Vertrag: src/lib/api/draftContract.ts).
 * Den Zustand einer Liga hält ihr Durable Object (server/draftRoom.ts); D1 kennt nur
 * die Lobby-Zeile (Liste öffentlicher Lobbys, Limit neuer Ligen pro Gerät) und einen
 * Stundenzähler neuer Ligen pro IP-Hash (Tabelle meta).
 */
import { FORMATION_IDS } from '../src/config/formations';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_LIMITS,
  type CreateDraftResponse,
  type DraftSettings,
  type LobbyRegion,
  type PickSeconds,
  type PublicLobbiesResponse,
} from '../src/lib/api/draftContract';
import { DraftError, normalizeSettings } from '../src/lib/draftEngine';
import type { DeviceAuth } from '../src/lib/api/contract';
import type { FormationId } from '../src/types';
import { authenticate, HOUR_MS, ipHashOf, rateLimited } from './auth';
import { randomHex } from './crypto';
import {
  cleanSettingsPatch,
  cleanTeamName,
  countLobbiesByHost,
  deleteLobby,
  DRAFT_CREATES_PER_IP,
  getLobby,
  insertLobby,
  lobbyFields,
  lobbyPoolFields,
  noteLobbyByIp,
  publicLobbies,
  LOBBY_SHINY_PARTY_BIT,
  purgeClosedLobbies,
  purgeLobbyIpCounters,
  type LobbyFields,
} from './draftCore';
import type { CreateRoomResult, Db, DraftNamespace, DraftRoomStub, Env } from './env';
import { DRAFT_LIST } from './game';
import { ApiError, badRequest, json } from './http';
import { parseDeviceAuth, readJsonBody } from './validate';

/** Öffentliche Lobbys: so lange nach der letzten Änderung gelistet … */
export const PUBLIC_LOBBY_MAX_AGE_MS = 2 * HOUR_MS;
/** … und höchstens so viele. */
export const PUBLIC_LOBBY_LIMIT = 50;
/** Versuche, einen freien Code zu finden (31⁶ Codes – praktisch immer der erste) */
const CODE_ATTEMPTS = 8;
/** Aufräumen beim Abruf der Lobby-Liste höchstens so oft (pro Isolate und Datenbank) */
const PURGE_EVERY_MS = 10 * 60_000;

export const draftsUnavailable = () =>
  new ApiError(501, 'server_error', 'Online-Draft ist auf diesem Server nicht verfügbar');

const notFound = () => new ApiError(404, 'not_found', 'Diese Liga gibt es nicht (mehr)');

const CODE_RE = new RegExp(`^[${DRAFT_LIMITS.codeAlphabet}]{${DRAFT_LIMITS.codeLength}}$`);

/** Liga-Code aus der URL: groß geschrieben, nur Zeichen des Code-Alphabets – sonst 400. */
export function parseCode(raw: string): string {
  const code = raw.toUpperCase();
  if (!CODE_RE.test(code)) throw badRequest('Ungültiger Liga-Code');
  return code;
}

/** Zufälliger Code ohne Modulo-Verzerrung (Bytes ≥ 248 werden verworfen). */
export function randomCode(): string {
  const alphabet = DRAFT_LIMITS.codeAlphabet;
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  while (code.length < DRAFT_LIMITS.codeLength) {
    const buf = new Uint8Array(DRAFT_LIMITS.codeLength * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && code.length < DRAFT_LIMITS.codeLength) code += alphabet[b % alphabet.length];
    }
  }
  return code;
}

interface CreateInput {
  auth: DeviceAuth;
  settings: DraftSettings;
  teamName: string;
  formation: FormationId;
}

/** Prüft CreateDraftRequest streng; Einstellungen schon mit der Engine vervollständigt. */
export function parseCreateDraft(body: Record<string, unknown>): CreateInput {
  const auth = parseDeviceAuth(body);
  const formation = body.formation;
  if (typeof formation !== 'string' || !FORMATION_IDS.includes(formation as FormationId)) {
    throw badRequest('Unbekannte Formation');
  }
  try {
    const teamName = cleanTeamName(body.teamName);
    const settings = normalizeSettings(cleanSettingsPatch(body.settings ?? {}), DEFAULT_DRAFT_SETTINGS, DRAFT_LIST);
    return { auth, settings, teamName, formation: formation as FormationId };
  } catch (err) {
    if (err instanceof DraftError) throw badRequest(err.message);
    throw err;
  }
}

function roomOf(ns: DraftNamespace, code: string): DraftRoomStub {
  return ns.get(ns.idFromName(code));
}

function namespace(env: Env): DraftNamespace {
  if (!env.DRAFTS) throw draftsUnavailable();
  return env.DRAFTS;
}

/** Limits neuer Ligen (pro Gerät und pro IP) – gelten auch für Revanchen. */
async function checkCreateLimits(request: Request, env: Env, deviceId: string, now: number): Promise<void> {
  const db = env.DB;
  // Geschlossene Lobbys zählen nur eine Stunde fürs Limit – danach weg damit (ebenso alte IP-Zähler).
  await purgeClosedLobbies(db, now - HOUR_MS);
  await purgeLobbyIpCounters(db, now);
  if ((await countLobbiesByHost(db, deviceId, now - HOUR_MS)) >= DRAFT_LIMITS.createsPerHour) {
    throw rateLimited('Zu viele neue Ligen in kurzer Zeit – bitte später erneut versuchen');
  }
  // Geräte kosten nichts – daher zusätzlich pro IP (gesalzener Hash, nur für die laufende Stunde).
  // Zuerst zählen, dann prüfen: Auch gleichzeitige Anfragen kommen nicht über das Limit.
  const ipHash = await ipHashOf(request, env);
  if (ipHash && (await noteLobbyByIp(db, ipHash, now)) > DRAFT_CREATES_PER_IP) {
    throw rateLimited('Zu viele neue Ligen von dieser Verbindung – bitte später erneut versuchen');
  }
}

/** Freien Code finden und die Lobby-Zeile anlegen. */
async function reserveCode(db: Db, deviceId: string, fields: LobbyFields, now: number): Promise<string> {
  for (let i = 0; i < CODE_ATTEMPTS; i++) {
    const candidate = randomCode();
    if (await insertLobby(db, candidate, deviceId, fields, now)) return candidate;
  }
  throw new Error('Kein freier Liga-Code gefunden');
}

/** POST /api/drafts – neue Liga (Code + Lobby-Zeile, dann der Raum im Durable Object). */
export async function createDraftEndpoint(request: Request, env: Env): Promise<Response> {
  const ns = namespace(env);
  const input = parseCreateDraft(await readJsonBody(request));
  const now = Date.now();
  await authenticate(request, env, input.auth, now);
  const db = env.DB;
  await checkCreateLimits(request, env, input.auth.deviceId, now);

  const s = input.settings;
  const fields: LobbyFields = {
    name: s.name,
    hostName: input.teamName,
    // region 0 / 1–9 / 10 (mehrere Generationen), legends = Legendäre oder Mysteriöse – wie im Raum
    ...lobbyPoolFields(s),
    shinyParty: s.shinies && s.shinyParty,
    pickSeconds: s.pickSeconds,
    teams: 1,
    maxTeams: s.maxTeams,
    visibility: s.visibility,
    phase: 'lobby',
  };
  const code = await reserveCode(db, input.auth.deviceId, fields, now);

  let result: CreateRoomResult;
  try {
    result = await roomOf(ns, code).create({
      code,
      // Geheim und lang: Reihenfolge, CPU-Zufall und Saison sind so nicht vorhersagbar.
      seed: randomHex(32),
      settings: input.settings,
      deviceId: input.auth.deviceId,
      teamName: input.teamName,
      formation: input.formation,
    });
  } catch (err) {
    await deleteLobby(db, code).catch(() => undefined);
    throw err;
  }
  if (!result.ok) {
    await deleteLobby(db, code).catch(() => undefined);
    if (result.code === 'exists') throw new Error(`Draft-Raum ${code} existiert ohne Lobby-Zeile`);
    throw badRequest(result.message);
  }
  const body: CreateDraftResponse = { code };
  return json(body);
}

/**
 * POST /api/drafts/:code/rematch – Revanche einer fertigen Liga: gleiche Einstellungen und Teams,
 * neuer Code und Seed. Gibt es schon eine, kommt deren Code (auch bei gleichzeitigen Anfragen
 * gilt nur die erste). Nur Mitglieder; zählt wie eine neue Liga zum Limit.
 */
export async function rematchEndpoint(request: Request, env: Env, rawCode: string): Promise<Response> {
  const ns = namespace(env);
  const code = parseCode(rawCode);
  const body = await readJsonBody(request);
  const auth = parseDeviceAuth(body);
  // Karriere: nächste Saison mit den Kadern der Vorsaison (nur nach einer Manager-Saison)
  const career = body.career === true;
  const now = Date.now();
  await authenticate(request, env, auth, now);
  await requireLobby(env, code);
  const old = roomOf(ns, code);
  let tpl = await old.rematchTemplate(auth.deviceId, null, career);
  let dead: string | null = null;
  if (tpl.ok && 'existing' in tpl) {
    // Lebt die Revanche noch? Haben alle sie verlassen, ist ihre Lobby-Zeile weg bzw. geschlossen.
    const lobby = await getLobby(env.DB, tpl.existing);
    if (lobby && lobby.phase !== 'closed') return json({ code: tpl.existing } satisfies CreateDraftResponse);
    dead = tpl.existing;
    tpl = await old.rematchTemplate(auth.deviceId, dead, career);
  }
  if (!tpl.ok) {
    if (tpl.code === 'not_found') throw notFound();
    throw new ApiError(409, 'bad_request', tpl.message);
  }
  if ('existing' in tpl) return json({ code: tpl.existing } satisfies CreateDraftResponse);

  await checkCreateLimits(request, env, auth.deviceId, now);
  const db = env.DB;
  const next = await reserveCode(db, auth.deviceId, lobbyFields(tpl.template), now);
  let result: CreateRoomResult;
  try {
    result = await roomOf(ns, next).createFrom({ ...tpl.template, code: next, seed: randomHex(32) });
  } catch (err) {
    await deleteLobby(db, next).catch(() => undefined);
    throw err;
  }
  if (!result.ok) {
    await deleteLobby(db, next).catch(() => undefined);
    throw new Error(`Revanche ${next}: ${result.message}`);
  }
  const winner = await old.setRematch(next, dead);
  // Eine gleichzeitige Anfrage war schneller: deren Liga gilt, unsere verschwindet wieder ganz
  if (winner !== next) {
    await deleteLobby(db, next).catch(() => undefined);
    await roomOf(ns, next)
      .discard()
      .catch((err: unknown) => console.error(`Revanche ${next}: verwaister Raum nicht gelöscht`, err));
  }
  return json({ code: winner ?? next } satisfies CreateDraftResponse);
}

const lastPurge = new WeakMap<Db, number>();

/** Gelegentlich aufräumen (geschlossene Lobby-Zeilen, alte IP-Zähler) – auch wenn niemand neue Ligen anlegt. */
async function purgeOccasionally(db: Db, now: number): Promise<void> {
  const last = lastPurge.get(db);
  if (last != null && now - last < PURGE_EVERY_MS) return;
  lastPurge.set(db, now);
  try {
    await purgeClosedLobbies(db, now - HOUR_MS);
    await purgeLobbyIpCounters(db, now);
  } catch (err) {
    console.error('Draft: Aufräumen fehlgeschlagen', err);
  }
}

/**
 * GET /api/drafts/public – offene, öffentliche Lobbys der letzten zwei Stunden, neueste zuerst,
 * pro Gerät nur eine; Lobbys, deren Host länger fehlt, listet der Raum gar nicht erst.
 */
export async function publicDraftsEndpoint(env: Env): Promise<Response> {
  namespace(env);
  const now = Date.now();
  await purgeOccasionally(env.DB, now);
  const rows = await publicLobbies(env.DB, now - PUBLIC_LOBBY_MAX_AGE_MS, PUBLIC_LOBBY_LIMIT);
  const body: PublicLobbiesResponse = {
    lobbies: rows.map((r) => ({
      code: r.code,
      name: r.name,
      hostName: r.host_name,
      teams: r.teams,
      maxTeams: r.max_teams,
      // 0 = alle, 1–9 = eine Generation, 10 = mehrere (LOBBY_REGION_MANY)
      region: r.region as LobbyRegion,
      legends: (r.legends & 1) === 1,
      ...((r.legends & LOBBY_SHINY_PARTY_BIT) !== 0 ? { shinyParty: true as const } : {}),
      pickSeconds: r.pick_seconds as PickSeconds,
      createdAt: r.created_at,
    })),
  };
  return json(body);
}

/** Gibt es die Liga laut D1? (Spart das Wecken eines Durable Objects für Tippfehler.) */
async function requireLobby(env: Env, code: string): Promise<void> {
  const lobby = await getLobby(env.DB, code);
  if (!lobby || lobby.phase === 'closed') throw notFound();
}

/** GET /api/drafts/:code – Schnappschuss für Zuschauer (you = null). */
export async function draftSnapshotEndpoint(env: Env, rawCode: string): Promise<Response> {
  const ns = namespace(env);
  const code = parseCode(rawCode);
  await requireLobby(env, code);
  const snapshot = await roomOf(ns, code).snapshot();
  if (!snapshot) throw notFound();
  return json(snapshot);
}

/** GET /api/drafts/:code/ws – WebSocket-Upgrade, weitergereicht an den Raum. */
export async function draftSocketEndpoint(request: Request, env: Env, rawCode: string): Promise<Response> {
  const ns = namespace(env);
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(426, 'bad_request', 'Hier geht es nur per WebSocket weiter', { Upgrade: 'websocket' });
  }
  const code = parseCode(rawCode);
  await requireLobby(env, code);
  return roomOf(ns, code).fetch(request);
}

export interface DraftRoute {
  method: 'GET' | 'POST';
  run: (request: Request, env: Env) => Promise<Response>;
}

const SOCKET_PATH_RE = /^\/api\/drafts\/([^/]+)\/ws$/;
const REMATCH_PATH_RE = /^\/api\/drafts\/([^/]+)\/rematch$/;
const CODE_PATH_RE = /^\/api\/drafts\/([^/]+)$/;

/** Route unter /api/drafts (Pfad ohne abschließenden Slash) – oder null. */
export function draftRoute(path: string): DraftRoute | null {
  if (path === '/api/drafts') return { method: 'POST', run: createDraftEndpoint };
  if (path === '/api/drafts/public') return { method: 'GET', run: (_req, env) => publicDraftsEndpoint(env) };
  const rematch = REMATCH_PATH_RE.exec(path);
  if (rematch) return { method: 'POST', run: (req, env) => rematchEndpoint(req, env, rematch[1]) };
  const ws = SOCKET_PATH_RE.exec(path);
  if (ws) return { method: 'GET', run: (req, env) => draftSocketEndpoint(req, env, ws[1]) };
  const snap = CODE_PATH_RE.exec(path);
  if (snap) return { method: 'GET', run: (_req, env) => draftSnapshotEndpoint(env, snap[1]) };
  return null;
}
