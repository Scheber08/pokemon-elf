/**
 * Die Endpunkte der API (Vertrag: src/lib/api/contract.ts).
 */
import {
  API_VERSION,
  isDefaultPlayerName,
  LIMITS,
  type EntryDetail,
  type FinishRunResponse,
  type HealthResponse,
  type LeaderboardResponse,
  type LeaderboardRow,
  type PlayerProfile,
  type PlayerRun,
  type StartRunResponse,
} from '../src/lib/api/contract';
import { FORMATIONS, FORMATION_IDS } from '../src/config/formations';
import { dailyRunSeed, dailySeasonSeed, dayKey, formatDay, weekKey } from '../src/lib/daily';
import type { ChallengeKey, FormationId } from '../src/types';
import { authenticate, HOUR_MS, IP_HASH_TTL_MS, rateLimited } from './auth';
import { newId, randomHex, randomSeed31 } from './crypto';
import {
  ALL_TIME_SCOPE,
  claimToken,
  countFinishes,
  countStarts,
  deleteStaleTokens,
  deviceRanks,
  expireIpHashes,
  getEntry,
  getToken,
  hasEntry,
  insertEntry,
  insertToken,
  isUniqueViolation,
  leaderboardPage,
  playerRows,
  rankedEntry,
  rankedEntryDevice,
  releaseToken,
  setDeviceName,
  type PlayerRunRow,
  type EntryDetailRow,
  type RankedRow,
  type TokenRow,
} from './db';
import type { Db, Env } from './env';
import { ENGINE_DATA, verifyRun } from './game';
import { ApiError, json } from './http';
import {
  CHALLENGE_KEYS,
  parseEntryId,
  parseFinish,
  parseLeaderboardQuery,
  parseRename,
  parseStart,
  readJsonBody,
  teamNameRequired,
} from './validate';

/** Nie abgeschlossene Tokens werden nach dieser Zeit gelöscht … */
export const STALE_TOKEN_MS = 7 * 24 * HOUR_MS;
/** … und zwar bei ca. 1 % der Starts (dabei auch IP-Hashes außerhalb des Limit-Fensters). */
const CLEANUP_CHANCE = 0.01;

const alreadyPlayed = (day: string) =>
  new ApiError(409, 'already_played', `Die Tägliche Elf vom ${formatDay(day)} hast du schon gespielt – morgen gibt's eine neue!`);

const tokenUsed = () => new ApiError(409, 'token_used', 'Dieser Run wurde bereits gewertet');

/** Gewertete Runs nur mit eigenem Namen – „Trainer" (Standardname neuer Geräte) steht in keiner Rangliste. */
const nameRequired = () =>
  new ApiError(400, 'name_required', 'Bitte wähle zuerst deinen Namen für die Rangliste');
/** So lange gilt ein beanspruchter Token ohne Eintrag als „wird gerade gespeichert". */
export const ORPHAN_GRACE_MS = 60_000;

export function health(): Response {
  const body: HealthResponse = { ok: true, version: API_VERSION, day: dayKey() };
  return json(body);
}

export async function startRun(request: Request, env: Env): Promise<Response> {
  const { auth, challenge } = parseStart(await readJsonBody(request));
  const now = Date.now();
  const device = await authenticate(request, env, auth, now);
  // Vor allem anderen: Ohne eigenen Namen gibt es keinen Token (Client: erst POST /api/player).
  if (isDefaultPlayerName(device.name)) throw nameRequired();
  const db = env.DB;

  if ((await countStarts(db, auth.deviceId, now - HOUR_MS)) >= LIMITS.startsPerHour) {
    throw rateLimited('Zu viele Runs in kurzer Zeit – bitte später erneut versuchen');
  }
  const day = dayKey(new Date(now));
  if (challenge === 'daily' && (await hasEntry(db, auth.deviceId, 'daily', day))) throw alreadyPlayed(day);

  const seed = challenge === 'daily' ? dailyRunSeed(day) : randomSeed31();
  const token = randomHex(32);
  await insertToken(db, { token, device_id: auth.deviceId, challenge, seed, day, created_at: now });

  if (Math.random() < CLEANUP_CHANCE) {
    await deleteStaleTokens(db, now - STALE_TOKEN_MS);
    await expireIpHashes(db, now - IP_HASH_TTL_MS);
  }

  const body: StartRunResponse = { token, challenge, seed, day };
  return json(body);
}

export async function finishRun(request: Request, env: Env): Promise<Response> {
  const input = parseFinish(await readJsonBody(request));
  const { auth } = input;
  const now = Date.now();
  const device = await authenticate(request, env, auth, now);
  const db = env.DB;
  const ttlMs = LIMITS.tokenTtlHours * HOUR_MS;

  let token = await getToken(db, input.token);
  // Fremde Tokens verhalten sich wie unbekannte – kein Hinweis, dass es sie gibt.
  if (!token || token.device_id !== auth.deviceId) throw new ApiError(404, 'not_found', 'Run nicht gefunden');
  // Schon gewertet (z. B. Antwort verloren und erneut gesendet): dieselbe Antwort noch
  // einmal – unabhängig vom Body und vor dem Limit, es entsteht ja nichts Neues.
  if (token.finished_at != null) {
    const stored = await storedFinish(db, token, now);
    if (stored) return json(stored);
    // Kein Eintrag: Eine parallele Anfrage speichert gerade – oder Speichern UND Freigeben sind
    // gescheitert (z. B. D1-Ausfall). Nach der Schonfrist wird der verwaiste Token freigegeben.
    if (!token.entry_id || now - token.finished_at < ORPHAN_GRACE_MS) throw tokenUsed();
    await releaseToken(db, token.token, token.entry_id);
    token = { ...token, finished_at: null, entry_id: null };
  }
  // Erst nach dem Wiederholungsfall: Ein schon gewerteter Run bekommt sein Ergebnis unabhängig vom
  // Body (auch von älteren Clients ohne Teamnamen). Der Token bleibt offen – mit Namen erneut senden.
  if (!input.teamName) throw teamNameRequired();

  if ((await countFinishes(db, auth.deviceId, now - HOUR_MS, now - ttlMs - HOUR_MS)) >= LIMITS.finishesPerHour) {
    throw rateLimited('Zu viele gewertete Runs in kurzer Zeit – bitte später erneut versuchen');
  }
  if (now - token.created_at > ttlMs) {
    throw new ApiError(410, 'token_expired', `Dieser Run ist abgelaufen (älter als ${LIMITS.tokenTtlHours} Stunden)`);
  }
  const daily = token.challenge === 'daily';
  if (daily && (await hasEntry(db, auth.deviceId, 'daily', token.day))) throw alreadyPlayed(token.day);

  const seasonSeed = daily ? dailySeasonSeed(token.day) : randomSeed31();
  const verified = verifyRun({
    challenge: token.challenge,
    formation: input.formation,
    ssEnabled: input.ssEnabled,
    seed: token.seed,
    picks: input.picks,
    teamName: input.teamName,
    seasonSeed,
  });
  if (!verified.ok) {
    const where = verified.round > 0 ? ` (Runde ${verified.round})` : '';
    throw new ApiError(422, 'invalid_run', `Ungültiger Run${where}: ${verified.error}`);
  }
  const { state, computed } = verified.run;

  const entryId = newId();
  if (!(await claimToken(db, token.token, entryId, now))) {
    // Gegen eine parallele Anfrage verloren: deren Ergebnis liefern, sobald es gespeichert ist.
    const current = await getToken(db, token.token);
    const stored = current?.finished_at != null ? await storedFinish(db, current, now) : null;
    if (stored) return json(stored);
    throw tokenUsed();
  }

  const { record, points } = computed.season;
  const score = computed.evaluation.score;
  try {
    await insertEntry(
      db,
      {
        id: entryId,
        deviceId: auth.deviceId,
        challenge: token.challenge,
        day: token.day,
        formation: input.formation,
        ssEnabled: input.ssEnabled,
        picksJson: JSON.stringify(state.picks),
        lineupJson: JSON.stringify(input.ssEnabled ? [...state.slots, state.ss] : state.slots),
        teamName: input.teamName,
        score,
        wins: record.w,
        draws: record.d,
        losses: record.l,
        points,
        seasonSeed,
        createdAt: now,
      },
      input.player,
      // In die Rangliste (Bestwerte) nur mit eigenem Namen – nach diesem Abschluss. Ohne ihn (alter
      // Token eines unbenannten Geräts) wird der Run gespeichert, steht aber in keiner Wertung.
      !isDefaultPlayerName(input.player ?? device.name),
    );
  } catch (err) {
    await releaseToken(db, token.token, entryId).catch(() => undefined);
    if (daily && isUniqueViolation(err)) throw alreadyPlayed(token.day);
    throw err;
  }

  const body: FinishRunResponse = {
    entryId,
    challenge: token.challenge,
    day: token.day,
    seasonSeed,
    score,
    record: { w: record.w, d: record.d, l: record.l },
    points,
    ...(await ranksAfterFinish(db, auth.deviceId, token.challenge, now)),
  };
  return json(body);
}

/**
 * Aktuelle Plätze nach einem Abschluss (heute + allzeit). Der Eintrag ist da schon
 * gespeichert – ein Fehler hier darf den gewerteten Run nicht zum 500 machen.
 */
async function ranksAfterFinish(
  db: Db,
  deviceId: string,
  challenge: ChallengeKey,
  now: number,
): Promise<Pick<FinishRunResponse, 'rankToday' | 'rankAllTime'>> {
  try {
    const [rankToday, rankAllTime] = await deviceRanks(db, deviceId, challenge, [dayKey(new Date(now)), ALL_TIME_SCOPE]);
    return { rankToday, rankAllTime };
  } catch (err) {
    console.error('Platz nach dem Abschluss nicht ermittelbar', err);
    return { rankToday: null, rankAllTime: null };
  }
}

/**
 * Antwort für einen schon gewerteten Token: der gespeicherte Eintrag, Plätze frisch berechnet.
 * null, solange (noch) kein Eintrag sichtbar ist.
 */
async function storedFinish(db: Db, token: TokenRow, now: number): Promise<FinishRunResponse | null> {
  const entry = token.entry_id ? await getEntry(db, token.entry_id) : null;
  if (!entry || entry.device_id !== token.device_id) return null;
  return {
    entryId: entry.id,
    challenge: entry.challenge,
    day: entry.day,
    seasonSeed: entry.season_seed,
    score: entry.score,
    record: { w: entry.wins, d: entry.draws, l: entry.losses },
    points: entry.points,
    ...(await ranksAfterFinish(db, token.device_id, entry.challenge, now)),
  };
}

function toRow(r: RankedRow): LeaderboardRow {
  return {
    rank: r.pos,
    entryId: r.id,
    player: r.player,
    teamName: r.team_name,
    record: { w: r.wins, d: r.draws, l: r.losses },
    points: r.points,
    score: r.score,
    formation: r.formation,
    createdAt: new Date(r.created_at).toISOString(),
    day: r.day,
    me: r.me === 1,
  };
}

export async function leaderboard(url: URL, env: Env): Promise<Response> {
  const q = parseLeaderboardQuery(url.searchParams);
  const day = dayKey();
  const page = await leaderboardPage(env.DB, {
    challenge: q.challenge,
    scope: q.period === 'today' ? day : q.period === 'week' ? weekKey(day) : ALL_TIME_SCOPE,
    limit: q.limit,
    me: q.me,
  });
  const body: LeaderboardResponse = {
    challenge: q.challenge,
    period: q.period,
    day,
    players: page.players,
    rows: page.rows.map(toRow),
    mine: page.mine ? toRow(page.mine) : null,
  };
  return json(body);
}

export async function renamePlayer(request: Request, env: Env): Promise<Response> {
  const { auth, player } = parseRename(await readJsonBody(request));
  await authenticate(request, env, auth, Date.now());
  await setDeviceName(env.DB, auth.deviceId, player);
  return json({ ok: true });
}

// ---------------------------------------------------------------- Team eines Ranglisten-Eintrags

/**
 * Die Team-Ansicht darf kurz zwischengespeichert werden (Browser, Edge). Ein Bestwert kann
 * jederzeit durch einen besseren Run ersetzt werden – deshalb nur eine Minute.
 */
export const ENTRY_CACHE_CONTROL = 'public, max-age=60';

const entryNotFound = () => new ApiError(404, 'not_found', 'Dieses Team ist nicht mehr in der Rangliste');

/** Ein Platz der Aufstellung: leer (null) oder ein bekanntes Pokémon. */
const isLineupValue = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && ENGINE_DATA.byId.has(v));

/**
 * Gespeicherte Aufstellung lesen. finishRun schreibt die Slots in der Reihenfolge der Formation
 * als JSON-Array, mit Standardschütze als ein weiteres Element dahinter. null, wenn das nicht
 * passt – kein JSON, kein Array, falsche Länge oder ein Wert, der weder leer noch ein bekanntes
 * Pokémon ist.
 */
export function parseStoredLineup(
  raw: unknown,
  formation: FormationId,
  ssEnabled: boolean,
): { slots: (number | null)[]; ss: number | null } | null {
  if (typeof raw !== 'string') return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const size = FORMATIONS[formation].slots.length;
  if (!Array.isArray(data) || data.length !== size + (ssEnabled ? 1 : 0) || !data.every(isLineupValue)) return null;
  const values = data as (number | null)[];
  return { slots: values.slice(0, size), ss: ssEnabled ? values[size] : null };
}

/**
 * Antwort aus der gespeicherten Zeile – nur die Felder des Vertrags (keine Geräte-ID, Züge oder
 * Seeds). null bei beschädigten Daten (unbekannte Challenge/Formation, kaputte Aufstellung,
 * ungültiger Zeitstempel) und bei einem Standardnamen, den nur isDefaultPlayerName erkennt.
 */
export function toEntryDetail(row: EntryDetailRow): EntryDetail | null {
  const challenge = row.challenge as ChallengeKey;
  const formation = row.formation as FormationId;
  if (!CHALLENGE_KEYS.includes(challenge) || !FORMATION_IDS.includes(formation)) return null;
  if (row.ss_enabled !== 0 && row.ss_enabled !== 1) return null;
  if (typeof row.player !== 'string' || isDefaultPlayerName(row.player)) return null;
  const ssEnabled = row.ss_enabled === 1;
  const lineup = parseStoredLineup(row.lineup_json, formation, ssEnabled);
  if (!lineup) return null;
  const createdAt = typeof row.created_at === 'number' ? new Date(row.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  return {
    entryId: row.id,
    challenge,
    day: row.day,
    player: row.player,
    teamName: row.team_name,
    formation,
    slots: lineup.slots,
    ss: lineup.ss,
    ssEnabled,
    record: { w: row.wins, d: row.draws, l: row.losses },
    points: row.points,
    score: row.score,
    createdAt: createdAt.toISOString(),
  };
}

/**
 * GET /api/entries/:id – das Team eines Eintrags, der gerade in einer abrufbaren Rangliste steht
 * (allzeit oder heute, siehe entryScopes). Ungültige ID → 400; unbekannt, ersetzt, nur noch
 * Bestwert eines vergangenen Tages, Gerät ohne eigenen Namen oder beschädigt → 404.
 */
export async function entryDetail(rawId: string, env: Env): Promise<Response> {
  const id = parseEntryId(rawId);
  const row = await rankedEntry(env.DB, id, Date.now());
  if (!row) throw entryNotFound();
  const body = toEntryDetail(row);
  if (!body) {
    console.warn(`Eintrag ${id}: Daten unlesbar oder Standardname – Team-Ansicht als 404`);
    throw entryNotFound();
  }
  return json(body, 200, { 'Cache-Control': ENTRY_CACHE_CONTROL });
}

// ---------------------------------------------------------------- Spielerprofil

/** So viele Runs zeigt das Profil im Verlauf */
export const PROFILE_RECENT = 20;

function toPlayerRun(r: PlayerRunRow): PlayerRun | null {
  const challenge = r.challenge as ChallengeKey;
  if (!CHALLENGE_KEYS.includes(challenge) || typeof r.created_at !== 'number') return null;
  return {
    challenge,
    day: r.day,
    teamName: r.team_name,
    record: { w: r.wins, d: r.draws, l: r.losses },
    points: r.points,
    score: r.score,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * GET /api/entries/:id/player – Profil des Spielers hinter einem Ranglisten-Eintrag: Runs und
 * Bestwert je Wertung, die letzten Runs. Gleiche Sichtbarkeit wie GET /api/entries/:id (sonst
 * 404); Geräte-IDs verlassen den Server nicht.
 */
export async function playerProfile(rawId: string, env: Env): Promise<Response> {
  const id = parseEntryId(rawId);
  const device = await rankedEntryDevice(env.DB, id, Date.now());
  if (!device || isDefaultPlayerName(device.player)) throw entryNotFound();
  const rows = await playerRows(env.DB, device.device_id, PROFILE_RECENT);
  const challenges = CHALLENGE_KEYS.flatMap((challenge) => {
    const count = rows.counts.find((c) => c.challenge === challenge);
    if (!count) return [];
    const best = rows.bests.find((b) => b.challenge === challenge);
    const run = best ? toPlayerRun(best) : null;
    const formation = best?.formation as FormationId | undefined;
    return [
      {
        challenge,
        runs: count.runs,
        best:
          best && run && formation && FORMATION_IDS.includes(formation)
            ? { entryId: best.id, teamName: run.teamName, formation, day: run.day, record: run.record, points: run.points, score: run.score }
            : null,
      },
    ];
  });
  const first = Math.min(...rows.counts.map((c) => c.first));
  const body: PlayerProfile = {
    player: device.player,
    since: new Date(Number.isFinite(first) ? first : Date.now()).toISOString(),
    runs: rows.counts.reduce((n, c) => n + c.runs, 0),
    challenges,
    recent: rows.recent.map(toPlayerRun).filter((r): r is PlayerRun => r != null),
  };
  return json(body, 200, { 'Cache-Control': ENTRY_CACHE_CONTROL });
}
