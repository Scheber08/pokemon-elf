/**
 * Datenbank-Schema. Der Server legt fehlende Tabellen und Indizes beim ersten
 * Zugriff pro Isolate selbst an (CREATE … IF NOT EXISTS) – nach dem Verknüpfen
 * der D1-Datenbank ist also keine Migration nötig. migrations/0001_init.sql
 * enthält dasselbe Schema für `wrangler d1 migrations`; ein Test hält beide gleich.
 */
import type { Db } from './env';

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS devices ( id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, name TEXT NOT NULL, ip_hash TEXT, created_at INTEGER NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices (ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_ip_expiry ON devices (created_at) WHERE ip_hash IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS run_tokens ( token TEXT PRIMARY KEY, device_id TEXT NOT NULL, challenge TEXT NOT NULL, seed INTEGER NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER, entry_id TEXT )`,
  `CREATE INDEX IF NOT EXISTS idx_run_tokens_device ON run_tokens (device_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_run_tokens_open ON run_tokens (created_at) WHERE finished_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS entries ( id TEXT PRIMARY KEY, device_id TEXT NOT NULL, challenge TEXT NOT NULL, day TEXT NOT NULL, formation TEXT NOT NULL, ss_enabled INTEGER NOT NULL, picks_json TEXT NOT NULL, lineup_json TEXT NOT NULL, team_name TEXT NOT NULL, score INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL, points INTEGER NOT NULL, season_seed INTEGER NOT NULL, created_at INTEGER NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_device ON entries (device_id, challenge, day)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_daily_once ON entries (device_id, day) WHERE challenge = 'daily'`,
  `CREATE TABLE IF NOT EXISTS best_entries ( challenge TEXT NOT NULL, scope TEXT NOT NULL, device_id TEXT NOT NULL, entry_id TEXT NOT NULL, points INTEGER NOT NULL, score INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (challenge, scope, device_id) )`,
  `CREATE INDEX IF NOT EXISTS idx_best_entries_rank ON best_entries (challenge, scope, points DESC, score DESC, created_at, entry_id)`,
  `CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL )`,
  `CREATE TABLE IF NOT EXISTS draft_lobbies ( code TEXT PRIMARY KEY, host_device TEXT NOT NULL, name TEXT NOT NULL, host_name TEXT NOT NULL, region INTEGER NOT NULL, legends INTEGER NOT NULL, pick_seconds INTEGER NOT NULL, teams INTEGER NOT NULL, max_teams INTEGER NOT NULL, visibility TEXT NOT NULL, phase TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS idx_draft_lobbies_public ON draft_lobbies (visibility, phase, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_draft_lobbies_host ON draft_lobbies (host_device, created_at)`,
];

const ready = new WeakMap<Db, Promise<void>>();

/** Legt das Schema einmal pro Datenbank-Binding und Isolate an. */
export function ensureSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s))).then(() => undefined);
    // Bei einem Fehler beim nächsten Aufruf erneut versuchen.
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}
