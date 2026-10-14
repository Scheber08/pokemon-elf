/**
 * Erfolge eines Geräts: Kennzahlen aus D1 (Runs, Tageswertung, Allzeit-Plätze, fertige Online-Ligen)
 * für src/lib/achievements.ts – plus die Abschlüsse der Online-Ligen (draft_results), die der
 * Draft-Raum am Ende einer Saison schreibt.
 */
import { isDefaultPlayerName, type MeResponse } from '../src/lib/api/contract';
import { achievementStates, earnedCoins, longestDayStreak, type AchievementStats } from '../src/lib/achievements';
import { dayKey } from '../src/lib/daily';
import type { DraftState } from '../src/lib/draftEngine';
import type { ChallengeKey } from '../src/types';
import { authenticate } from './auth';
import { allTimePlaces, RANK_EXPR } from './db';
import type { Db, Env } from './env';
import { json } from './http';
import { ensureSchema } from './schema';
import { CHALLENGE_KEYS, parseDeviceAuth, readJsonBody } from './validate';

/** Tages-Wertungen ('YYYY-MM-DD') – Wochen o. Ä. zählen nicht als Tagessieg */
const DAY_SCOPE_GLOB = '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

/** Kennzahlen eines Geräts für die Erfolge. today: laufender Tag (zählt noch nicht als Tagessieg). */
export async function achievementStats(db: Db, deviceId: string, today: string): Promise<AchievementStats> {
  const [byChallenge, days, wins, draft] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT challenge, COUNT(*) AS runs, MAX(wins) AS best_wins,
           SUM(CASE WHEN draws = 0 AND losses = 0 AND wins > 0 THEN 1 ELSE 0 END) AS perfect
         FROM entries WHERE device_id = ? GROUP BY challenge`,
      )
      .bind(deviceId),
    db.prepare(`SELECT DISTINCT day FROM entries WHERE device_id = ? AND challenge = 'daily'`).bind(deviceId),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM best_entries b
         WHERE b.challenge = 'daily' AND b.device_id = ? AND b.scope GLOB '${DAY_SCOPE_GLOB}' AND b.scope < ? AND ${RANK_EXPR} = 1`,
      )
      .bind(deviceId, today),
    db
      .prepare(
        `SELECT COUNT(*) AS leagues,
           SUM(CASE WHEN rank = 1 AND format = 'league' THEN 1 ELSE 0 END) AS titles,
           SUM(CASE WHEN rank = 1 AND format = 'cup' THEN 1 ELSE 0 END) AS cups,
           SUM(CASE WHEN rank = 1 AND format = 'manager' THEN 1 ELSE 0 END) AS manager,
           SUM(CASE WHEN rank <= 3 THEN 1 ELSE 0 END) AS podiums
         FROM draft_results WHERE device_id = ?`,
      )
      .bind(deviceId),
  ]);
  const challenges: AchievementStats['challenges'] = {};
  let runs = 0;
  for (const r of byChallenge.results) {
    const c = r.challenge as ChallengeKey;
    if (!CHALLENGE_KEYS.includes(c)) continue;
    const n = Number(r.runs) || 0;
    runs += n;
    challenges[c] = { runs: n, bestWins: Number(r.best_wins) || 0, perfect: Number(r.perfect) || 0 };
  }
  const played = CHALLENGE_KEYS.filter((c) => challenges[c]);
  const places = (await allTimePlaces(db, deviceId, played)).map((p) => p.place).filter((p): p is number => p != null);
  const dailyDays = days.results.map((r) => String(r.day));
  const d = draft.results[0] ?? {};
  const num = (v: unknown) => Number(v) || 0;
  return {
    runs,
    challenges,
    dailyDays: dailyDays.length,
    dailyStreak: longestDayStreak(dailyDays),
    dailyWins: num(wins.results[0]?.n),
    bestPlace: places.length ? Math.min(...places) : null,
    draft: { leagues: num(d.leagues), titles: num(d.titles), cups: num(d.cups), manager: num(d.manager), podiums: num(d.podiums) },
  };
}

/** POST /api/me – Erfolge und Münzen des eigenen Geräts. */
export async function me(request: Request, env: Env): Promise<Response> {
  const auth = parseDeviceAuth(await readJsonBody(request));
  const now = Date.now();
  const device = await authenticate(request, env, auth, now);
  await ensureSchema(env.DB);
  const stats = await achievementStats(env.DB, auth.deviceId, dayKey(new Date(now)));
  const earned = earnedCoins(stats);
  const body: MeResponse = {
    player: isDefaultPlayerName(device.name) ? null : device.name,
    coins: { earned, spent: 0, balance: earned },
    achievements: achievementStates(stats),
  };
  return json(body);
}

/**
 * Am Ende einer Online-Liga: Abschluss jedes menschlichen Teams speichern (einmal je Liga und
 * Gerät – INSERT OR IGNORE). Wirft bei Datenbankfehlern (der Raum versucht es später erneut).
 */
export async function saveDraftResults(db: Db, state: Pick<DraftState, 'code' | 'settings' | 'teams' | 'owners' | 'league'>, now: number): Promise<number> {
  const league = state.league;
  if (!league) return 0;
  const format = state.settings.format ?? 'league';
  const stmts = league.table.flatMap((r, i) => {
    const team = state.teams[r.team];
    const device = team && !team.cpu ? state.owners[team.id] : undefined;
    if (!device) return [];
    return [
      db
        .prepare(
          `INSERT OR IGNORE INTO draft_results (code, device_id, format, rank, teams, wins, draws, losses, points, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(state.code, device, format, i + 1, league.teams.length, r.w, r.d, r.l, r.pts, now),
    ];
  });
  if (!stmts.length) return 0;
  await ensureSchema(db);
  await db.batch(stmts);
  return stmts.length;
}
