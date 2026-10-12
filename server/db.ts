/**
 * Alle Datenbank-Abfragen (D1 = SQLite). Schema: migrations/0001_init.sql.
 * Zeitstempel sind Millisekunden (INTEGER).
 */
import type { ChallengeKey, FormationId } from '../src/types';
import type { Db, DbStatement } from './env';

export interface DeviceRow {
  id: string;
  secret_hash: string;
  name: string;
}

export interface TokenRow {
  token: string;
  device_id: string;
  challenge: ChallengeKey;
  seed: number;
  day: string;
  created_at: number;
  finished_at: number | null;
  /** Eintrag, mit dem der Token gewertet wurde (gesetzt zusammen mit finished_at) */
  entry_id: string | null;
}

export interface NewEntry {
  id: string;
  deviceId: string;
  challenge: ChallengeKey;
  day: string;
  formation: FormationId;
  ssEnabled: boolean;
  picksJson: string;
  lineupJson: string;
  teamName: string;
  score: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  seasonSeed: number;
  createdAt: number;
}

/** Gespeicherter Eintrag – genug, um die Antwort eines Abschlusses zu wiederholen. */
export interface EntryRow {
  id: string;
  device_id: string;
  challenge: ChallengeKey;
  day: string;
  score: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  season_seed: number;
}

/** Zeile einer Wertung – bewusst ohne Geräte-ID. */
export interface RankedRow {
  pos: number;
  id: string;
  player: string;
  team_name: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  score: number;
  formation: FormationId;
  created_at: number;
  day: string;
  me: number;
}

/** Wertung: Allzeit oder ein Tag ('YYYY-MM-DD'). */
export const ALL_TIME_SCOPE = 'all';

// ---------------------------------------------------------------- Geräte

export function getDevice(db: Db, id: string): Promise<DeviceRow | null> {
  return db.prepare('SELECT id, secret_hash, name FROM devices WHERE id = ?').bind(id).first<DeviceRow>();
}

/** Neue Geräte dieser IP seit `since`. */
export async function countDevicesByIp(db: Db, ipHash: string, since: number): Promise<number> {
  const n = await db
    .prepare('SELECT COUNT(*) AS n FROM devices WHERE ip_hash = ? AND created_at >= ?')
    .bind(ipHash, since)
    .first<number>('n');
  return n ?? 0;
}

/** Löscht die IP-Hashes aller Geräte, die vor `before` angelegt wurden (über idx_devices_ip_expiry). */
export async function expireIpHashes(db: Db, before: number): Promise<number> {
  const res = await db
    .prepare('UPDATE devices SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < ?')
    .bind(before)
    .run();
  return res.meta.changes;
}

/** Legt ein Gerät an; false, falls es (parallel) schon angelegt wurde. */
export async function insertDevice(
  db: Db,
  d: { id: string; secretHash: string; name: string; ipHash: string | null; now: number },
): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO devices (id, secret_hash, name, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(d.id, d.secretHash, d.name, d.ipHash, d.now)
    .run();
  return res.meta.changes === 1;
}

const setNameSql = 'UPDATE devices SET name = ? WHERE id = ?';

export async function setDeviceName(db: Db, id: string, name: string): Promise<void> {
  await db.prepare(setNameSql).bind(name, id).run();
}

// ---------------------------------------------------------------- Run-Tokens

export async function insertToken(db: Db, t: Omit<TokenRow, 'finished_at' | 'entry_id'>): Promise<void> {
  await db
    .prepare('INSERT INTO run_tokens (token, device_id, challenge, seed, day, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(t.token, t.device_id, t.challenge, t.seed, t.day, t.created_at)
    .run();
}

export function getToken(db: Db, token: string): Promise<TokenRow | null> {
  return db
    .prepare(
      'SELECT token, device_id, challenge, seed, day, created_at, finished_at, entry_id FROM run_tokens WHERE token = ?',
    )
    .bind(token)
    .first<TokenRow>();
}

/** Starts eines Geräts seit `since`. */
export async function countStarts(db: Db, deviceId: string, since: number): Promise<number> {
  const n = await db
    .prepare('SELECT COUNT(*) AS n FROM run_tokens WHERE device_id = ? AND created_at >= ?')
    .bind(deviceId, since)
    .first<number>('n');
  return n ?? 0;
}

/** Gewertete Runs eines Geräts seit `since` (Token höchstens `createdSince` alt). */
export async function countFinishes(db: Db, deviceId: string, since: number, createdSince: number): Promise<number> {
  const n = await db
    .prepare('SELECT COUNT(*) AS n FROM run_tokens WHERE device_id = ? AND created_at >= ? AND finished_at >= ?')
    .bind(deviceId, createdSince, since)
    .first<number>('n');
  return n ?? 0;
}

/**
 * Markiert den Token als gewertet und merkt sich die (vorab erzeugte) Eintrags-ID –
 * nur, wenn er noch offen ist. Genau eine geänderte Zeile heißt: Diese Anfrage hat
 * gewonnen (sicher bei Parallelität).
 */
export async function claimToken(db: Db, token: string, entryId: string, now: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE run_tokens SET finished_at = ?, entry_id = ? WHERE token = ? AND finished_at IS NULL')
    .bind(now, entryId, token)
    .run();
  return res.meta.changes === 1;
}

/** Gibt einen Token wieder frei (wenn das Speichern des Eintrags `entryId` scheiterte). */
/**
 * Wert aus der meta-Tabelle; beim ersten Aufruf wird `initial` gespeichert (race-sicher:
 * bei parallelen Aufrufen gewinnt der zuerst geschriebene Wert).
 */
export async function metaValue(db: Db, key: string, initial: string): Promise<string> {
  await db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind(key, initial).run();
  return (await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<string>('value')) ?? initial;
}

export async function releaseToken(db: Db, token: string, entryId: string): Promise<void> {
  await db
    .prepare('UPDATE run_tokens SET finished_at = NULL, entry_id = NULL WHERE token = ? AND entry_id = ?')
    .bind(token, entryId)
    .run();
}

/** Löscht nie abgeschlossene Tokens, die vor `before` gestartet wurden. */
export async function deleteStaleTokens(db: Db, before: number): Promise<number> {
  const res = await db
    .prepare('DELETE FROM run_tokens WHERE finished_at IS NULL AND created_at < ?')
    .bind(before)
    .run();
  return res.meta.changes;
}

// ---------------------------------------------------------------- Einträge

export async function hasEntry(db: Db, deviceId: string, challenge: ChallengeKey, day: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM entries WHERE device_id = ? AND challenge = ? AND day = ? LIMIT 1')
    .bind(deviceId, challenge, day)
    .first();
  return row != null;
}

export function getEntry(db: Db, id: string): Promise<EntryRow | null> {
  return db
    .prepare(
      `SELECT id, device_id, challenge, day, score, wins, draws, losses, points, season_seed
       FROM entries WHERE id = ?`,
    )
    .bind(id)
    .first<EntryRow>();
}

/**
 * Bestwert eines Geräts in einer Wertung setzen – nur, wenn der neue Run besser ist
 * (Punkte, dann Team-Score, dann früher, dann kleinere ID; bei Gleichstand bleibt der alte).
 * Parameter: challenge, scope, device_id, entry_id, points, score, created_at.
 */
export const UPSERT_BEST_SQL = `INSERT INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (challenge, scope, device_id) DO UPDATE SET
    entry_id = excluded.entry_id, points = excluded.points, score = excluded.score, created_at = excluded.created_at
  WHERE excluded.points > best_entries.points
    OR (excluded.points = best_entries.points AND (excluded.score > best_entries.score
      OR (excluded.score = best_entries.score AND (excluded.created_at < best_entries.created_at
        OR (excluded.created_at = best_entries.created_at AND excluded.entry_id < best_entries.entry_id)))))`;

function upsertBest(db: Db, e: NewEntry, scope: string): DbStatement {
  return db.prepare(UPSERT_BEST_SQL).bind(e.challenge, scope, e.deviceId, e.id, e.points, e.score, e.createdAt);
}

/**
 * Speichert den Eintrag, den aktuellen Spielernamen (null = unverändert) und die
 * Bestwerte (Allzeit + Tag des Eintrags) in einer Transaktion.
 */
export async function insertEntry(db: Db, e: NewEntry, player: string | null): Promise<void> {
  const statements: DbStatement[] = [
    db
      .prepare(
        `INSERT INTO entries (id, device_id, challenge, day, formation, ss_enabled, picks_json, lineup_json,
           team_name, score, wins, draws, losses, points, season_seed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        e.id,
        e.deviceId,
        e.challenge,
        e.day,
        e.formation,
        e.ssEnabled ? 1 : 0,
        e.picksJson,
        e.lineupJson,
        e.teamName,
        e.score,
        e.wins,
        e.draws,
        e.losses,
        e.points,
        e.seasonSeed,
        e.createdAt,
      ),
    upsertBest(db, e, ALL_TIME_SCOPE),
    upsertBest(db, e, e.day),
  ];
  if (player != null) statements.push(db.prepare(setNameSql).bind(player, e.deviceId));
  await db.batch(statements);
}

/** Verletzung eines UNIQUE-Index (z. B. zweite Tägliche Elf am selben Tag). */
export function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err));
}

// ---------------------------------------------------------------- Wertungen

/**
 * Platz der Bestwert-Zeile `b`: 1 + Anzahl besserer Zeilen derselben Wertung, in
 * derselben Reihenfolge wie die Liste (Punkte ↓, Score ↓, Zeitpunkt ↑, ID ↑). Jede
 * Teilsumme ist ein Bereich in idx_best_entries_rank – gelesen werden nur bessere Zeilen.
 */
const RANK_EXPR = `(1
  + (SELECT COUNT(*) FROM best_entries o WHERE o.challenge = b.challenge AND o.scope = b.scope
      AND o.points > b.points)
  + (SELECT COUNT(*) FROM best_entries o WHERE o.challenge = b.challenge AND o.scope = b.scope
      AND o.points = b.points AND o.score > b.score)
  + (SELECT COUNT(*) FROM best_entries o WHERE o.challenge = b.challenge AND o.scope = b.scope
      AND o.points = b.points AND o.score = b.score AND o.created_at < b.created_at)
  + (SELECT COUNT(*) FROM best_entries o WHERE o.challenge = b.challenge AND o.scope = b.scope
      AND o.points = b.points AND o.score = b.score AND o.created_at = b.created_at AND o.entry_id < b.entry_id))`;

/** Spalten einer Ranglisten-Zeile (b = best_entries, e = entries, d = devices); Parameter: me. */
const ROW_COLUMNS = `b.entry_id AS id, d.name AS player, e.team_name, e.wins, e.draws, e.losses, b.points, b.score,
  e.formation, b.created_at, e.day, CASE WHEN b.device_id = ? THEN 1 ELSE 0 END AS me`;

const ROW_JOINS = `best_entries b JOIN entries e ON e.id = b.entry_id JOIN devices d ON d.id = b.device_id`;

export interface LeaderboardPage {
  /** Anzahl Geräte in dieser Wertung */
  players: number;
  /** Die ersten `limit` Plätze */
  rows: RankedRow[];
  /** Zeile von `me` (auch außerhalb von `limit`) – null ohne Eintrag */
  mine: RankedRow | null;
}

/** Eine Wertung: die ersten `limit` Plätze, die Spielerzahl und – falls angefragt – die eigene Zeile. */
export async function leaderboardPage(
  db: Db,
  q: { challenge: ChallengeKey; scope: string; limit: number; me: string | null },
): Promise<LeaderboardPage> {
  const statements = [
    db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM ${ROW_JOINS}
         WHERE b.challenge = ? AND b.scope = ?
         ORDER BY b.points DESC, b.score DESC, b.created_at ASC, b.entry_id ASC
         LIMIT ?`,
      )
      .bind(q.me, q.challenge, q.scope, q.limit),
    db.prepare('SELECT COUNT(*) AS n FROM best_entries WHERE challenge = ? AND scope = ?').bind(q.challenge, q.scope),
  ];
  if (q.me != null) {
    statements.push(
      db
        .prepare(`SELECT ${RANK_EXPR} AS pos, ${ROW_COLUMNS} FROM ${ROW_JOINS} WHERE b.challenge = ? AND b.scope = ? AND b.device_id = ?`)
        .bind(q.me, q.challenge, q.scope, q.me),
    );
  }
  // Ein Batch: eine Runde zur Datenbank und ein konsistenter Stand für alle drei Abfragen.
  const [top, count, mine] = await db.batch<Record<string, unknown>>(statements);
  const rows = (top.results as unknown as Omit<RankedRow, 'pos'>[]).map((r, i) => ({ ...r, pos: i + 1 }));
  const mineRow = (mine?.results[0] as unknown as RankedRow | undefined) ?? null;
  return {
    players: Number(count.results[0]?.n ?? 0),
    rows,
    mine: rows.find((r) => r.me === 1) ?? mineRow,
  };
}

/** Plätze eines Geräts in mehreren Wertungen (eine Runde) – null, wo es keinen Eintrag hat. */
export async function deviceRanks(
  db: Db,
  deviceId: string,
  challenge: ChallengeKey,
  scopes: string[],
): Promise<(number | null)[]> {
  const sql = `SELECT ${RANK_EXPR} AS pos FROM best_entries b WHERE b.challenge = ? AND b.scope = ? AND b.device_id = ?`;
  const results = await db.batch<{ pos: number }>(scopes.map((s) => db.prepare(sql).bind(challenge, s, deviceId)));
  return results.map((r) => r.results[0]?.pos ?? null);
}
