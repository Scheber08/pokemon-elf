/**
 * Erfolge eines Geräts: Kennzahlen aus D1 (Runs, Tageswertung, Allzeit-Plätze, fertige Online-Ligen)
 * für src/lib/achievements.ts – plus die Abschlüsse der Online-Ligen (draft_results), die der
 * Draft-Raum am Ende einer Saison schreibt.
 */
import { isDefaultPlayerName, type MeResponse } from '../src/lib/api/contract';
import { achievementStates, earnedCoins, longestDayStreak, type AchievementStats } from '../src/lib/achievements';
import { dayKey } from '../src/lib/daily';
import { itemByKey, itemOnSale, lockedItem, parseLook } from '../src/lib/trainer';
import type { DraftState } from '../src/lib/draftEngine';
import type { ChallengeKey } from '../src/types';
import { authenticate } from './auth';
import { allTimePlaces, RANK_EXPR } from './db';
import type { Db, Env } from './env';
import { ApiError, json } from './http';
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
           SUM(CASE WHEN rank <= 3 THEN 1 ELSE 0 END) AS podiums,
           SUM(CASE WHEN format = 'manager' THEN 1 ELSE 0 END) AS seasons,
           SUM(CASE WHEN format = 'manager' AND rank <= 3 THEN 1 ELSE 0 END) AS manager_podiums,
           SUM(CASE WHEN losses = 0 AND format != 'cup' AND wins + draws > 0 THEN 1 ELSE 0 END) AS unbeaten
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
    draft: {
      leagues: num(d.leagues),
      titles: num(d.titles),
      cups: num(d.cups),
      manager: num(d.manager),
      podiums: num(d.podiums),
      unbeaten: num(d.unbeaten),
      seasons: num(d.seasons),
      managerPodiums: num(d.manager_podiums),
    },
  };
}

/** Antwort von /api/me (auch nach Speichern bzw. Kauf): Erfolge, Münzen, Trainer, Gekauftes. */
async function meBody(db: Db, deviceId: string, name: string, now: number): Promise<MeResponse> {
  const stats = await achievementStats(db, deviceId, dayKey(new Date(now)));
  const earned = earnedCoins(stats);
  const [look, items] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT look_json FROM trainers WHERE device_id = ?').bind(deviceId),
    db.prepare('SELECT item, price FROM trainer_items WHERE device_id = ? ORDER BY bought_at').bind(deviceId),
  ]);
  const spent = items.results.reduce((n, r) => n + (Number(r.price) || 0), 0);
  let raw: unknown = null;
  try {
    raw = look.results[0] ? JSON.parse(String(look.results[0].look_json)) : null;
  } catch {
    raw = null;
  }
  return {
    player: isDefaultPlayerName(name) ? null : name,
    coins: { earned, spent, balance: earned - spent },
    achievements: achievementStates(stats),
    trainer: parseLook(raw),
    owned: items.results.map((r) => String(r.item)),
    stats,
  };
}

/** Gerät anmelden (bzw. registrieren) und Schema sicherstellen */
async function signIn(request: Request, env: Env, body: Record<string, unknown>, now: number) {
  const auth = parseDeviceAuth(body);
  const device = await authenticate(request, env, auth, now);
  await ensureSchema(env.DB);
  return { deviceId: auth.deviceId, name: device.name };
}

/** POST /api/me – Erfolge, Münzen und Trainer des eigenen Geräts. */
export async function me(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const { deviceId, name } = await signIn(request, env, await readJsonBody(request), now);
  return json(await meBody(env.DB, deviceId, name, now));
}

/** POST /api/me/trainer – Aussehen speichern: nur freie und gekaufte Teile (sonst 400 locked_item). */
export async function saveTrainer(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const body = await readJsonBody(request);
  const { deviceId, name } = await signIn(request, env, body, now);
  const look = parseLook(body.look);
  const owned = await env.DB.prepare('SELECT item FROM trainer_items WHERE device_id = ?').bind(deviceId).all<{ item: string }>();
  const locked = lockedItem(look, new Set(owned.results.map((r) => r.item)));
  if (locked) throw new ApiError(400, 'locked_item', 'Das musst du erst im Shop kaufen');
  await env.DB.prepare(
    `INSERT INTO trainers (device_id, look_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (device_id) DO UPDATE SET look_json = excluded.look_json, updated_at = excluded.updated_at`,
  )
    .bind(deviceId, JSON.stringify(look), now)
    .run();
  return json(await meBody(env.DB, deviceId, name, now));
}

/**
 * POST /api/me/buy – ein Cosmetic kaufen. Atomar: eingefügt wird nur, wenn die Münzen nach allen
 * bisherigen Käufen reichen (eine Anweisung – parallele Käufe können nicht überziehen).
 * Schon gekauft: nichts passiert (200). Unbekannt/frei → 400, zu wenig Münzen → 400 not_enough_coins.
 */
export async function buyItem(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const body = await readJsonBody(request);
  const { deviceId, name } = await signIn(request, env, body, now);
  const key = typeof body.item === 'string' ? body.item : '';
  const it = itemByKey(key);
  if (!it || it.price <= 0) throw new ApiError(400, 'bad_request', 'Diesen Artikel gibt es nicht im Shop');
  if (!itemOnSale(it, now)) throw new ApiError(400, 'not_on_sale', 'Diesen Artikel gibt es gerade nicht – nur in seiner Saison');
  const db = env.DB;
  const earned = earnedCoins(await achievementStats(db, deviceId, dayKey(new Date(now))));
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO trainer_items (device_id, item, price, bought_at)
       SELECT ?, ?, ?, ? WHERE (SELECT COALESCE(SUM(price), 0) FROM trainer_items WHERE device_id = ?) + ? <= ?`,
    )
    .bind(deviceId, key, it.price, now, deviceId, it.price, earned)
    .run();
  if (!res.meta.changes) {
    const had = await db.prepare('SELECT 1 AS x FROM trainer_items WHERE device_id = ? AND item = ?').bind(deviceId, key).first();
    if (!had) throw new ApiError(400, 'not_enough_coins', 'Dafür reichen deine Münzen noch nicht');
  }
  return json(await meBody(db, deviceId, name, now));
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
