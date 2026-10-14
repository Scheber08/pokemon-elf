/**
 * Datenbank-Schema. Der Server legt fehlende Tabellen und Indizes beim ersten
 * Zugriff pro Isolate selbst an (CREATE … IF NOT EXISTS) – nach dem Verknüpfen
 * der D1-Datenbank ist also keine Migration nötig. migrations/0001_init.sql
 * enthält dasselbe Schema für `wrangler d1 migrations`; ein Test hält beide gleich.
 * Danach laufen einmalige Daten-Bereinigungen (je einmal pro Datenbank, über meta abgesichert).
 */
import { backfillWeekBests, cleanupDefaultNames, DEFAULT_NAMES_CLEANUP_KEY, WEEK_BACKFILL_KEY } from './db';
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
  `CREATE TABLE IF NOT EXISTS draft_results ( code TEXT NOT NULL, device_id TEXT NOT NULL, format TEXT NOT NULL, rank INTEGER NOT NULL, teams INTEGER NOT NULL, wins INTEGER NOT NULL, draws INTEGER NOT NULL, losses INTEGER NOT NULL, points INTEGER NOT NULL, finished_at INTEGER NOT NULL, PRIMARY KEY (code, device_id) )`,
  `CREATE INDEX IF NOT EXISTS idx_draft_results_device ON draft_results (device_id)`,
];

const ready = new WeakMap<Db, Promise<void>>();
const cleaned = new WeakMap<Db, Promise<void>>();

/**
 * Legt das Schema einmal pro Datenbank-Binding und Isolate an und führt danach die
 * einmaligen Daten-Bereinigungen aus (siehe runCleanups).
 */
export async function ensureSchema(db: Db): Promise<void> {
  await createSchema(db);
  await runCleanups(db);
}

function createSchema(db: Db): Promise<void> {
  let p = ready.get(db);
  if (!p) {
    p = db.batch(SCHEMA_STATEMENTS.map((s) => db.prepare(s))).then(() => undefined);
    // Bei einem Fehler beim nächsten Aufruf erneut versuchen.
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

/**
 * Einmalige Bereinigungen nach einem Deploy – einmal pro Datenbank, abgesichert über einen
 * meta-Schlüssel (cleanupDefaultNames); pro Isolate wird nur bis zum ersten Erfolg nachgesehen.
 * Ein Fehler hält die API nicht auf (die Ranglisten blenden Standardnamen ohnehin aus): Er
 * wird protokolliert, und der nächste Aufruf versucht es erneut.
 */
function runCleanups(db: Db): Promise<void> {
  let p = cleaned.get(db);
  if (!p) {
    p = cleanupDefaultNames(db, Date.now())
      .then((res) => {
        if (res && (res.entries || res.bestEntries || res.tokens)) {
          console.log(
            `Bereinigung ${DEFAULT_NAMES_CLEANUP_KEY}: ${res.entries} Einträge, ${res.bestEntries} Bestwerte und ` +
              `${res.tokens} Run-Tokens von Geräten ohne eigenen Namen gelöscht`,
          );
        }
        // Erst nach der Bereinigung: keine Wochen-Bestwerte für gerade gelöschte Geräte
        return backfillWeekBests(db, Date.now());
      })
      .then(
        (n) => {
          if (n) console.log(`${WEEK_BACKFILL_KEY}: ${n} Wochen-Bestwerte nachgetragen`);
        },
      (err: unknown) => {
        cleaned.delete(db);
        console.error(`Bereinigung ${DEFAULT_NAMES_CLEANUP_KEY} gescheitert – neuer Versuch beim nächsten Aufruf`, err);
      },
    );
    cleaned.set(db, p);
  }
  return p;
}
