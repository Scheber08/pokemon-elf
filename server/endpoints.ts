/**
 * Die Endpunkte der API (Vertrag: src/lib/api/contract.ts).
 */
import {
  API_VERSION,
  LIMITS,
  type FinishRunResponse,
  type HealthResponse,
  type LeaderboardResponse,
  type LeaderboardRow,
  type StartRunResponse,
} from '../src/lib/api/contract';
import { dailyRunSeed, dailySeasonSeed, dayKey, formatDay } from '../src/lib/daily';
import type { ChallengeKey } from '../src/types';
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
  releaseToken,
  setDeviceName,
  type RankedRow,
  type TokenRow,
} from './db';
import type { Db, Env } from './env';
import { verifyRun } from './game';
import { ApiError, json } from './http';
import { parseFinish, parseLeaderboardQuery, parseRename, parseStart, readJsonBody } from './validate';

/** Nie abgeschlossene Tokens werden nach dieser Zeit gelöscht … */
export const STALE_TOKEN_MS = 7 * 24 * HOUR_MS;
/** … und zwar bei ca. 1 % der Starts (dabei auch IP-Hashes außerhalb des Limit-Fensters). */
const CLEANUP_CHANCE = 0.01;

const alreadyPlayed = (day: string) =>
  new ApiError(409, 'already_played', `Die Tägliche Elf vom ${formatDay(day)} hast du schon gespielt – morgen gibt's eine neue!`);

const tokenUsed = () => new ApiError(409, 'token_used', 'Dieser Run wurde bereits gewertet');
/** So lange gilt ein beanspruchter Token ohne Eintrag als „wird gerade gespeichert". */
export const ORPHAN_GRACE_MS = 60_000;

export function health(): Response {
  const body: HealthResponse = { ok: true, version: API_VERSION, day: dayKey() };
  return json(body);
}

export async function startRun(request: Request, env: Env): Promise<Response> {
  const { auth, challenge } = parseStart(await readJsonBody(request));
  const now = Date.now();
  await authenticate(request, env, auth, now);
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
  await authenticate(request, env, auth, now);
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
    scope: q.period === 'today' ? day : ALL_TIME_SCOPE,
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
