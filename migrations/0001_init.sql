-- Pokémon Elf – Online-Rangliste (Cloudflare D1)
-- Zeitstempel: INTEGER in Millisekunden seit 1970 (UTC). Tage: 'YYYY-MM-DD' (Europe/Berlin).

-- Geräte statt Accounts: gespeichert wird nur der SHA-256 des Geräte-Schlüssels
-- und ein Hash der IP (für das Limit neuer Geräte), nie die IP selbst. Der IP-Hash
-- wird nach einer Stunde gelöscht (ip_hash = NULL), danach braucht ihn das Limit nicht mehr.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices (ip_hash, created_at);
-- Nur Geräte, deren IP-Hash noch gespeichert ist – das Löschen alter Hashes liest nicht alle Geräte.
CREATE INDEX IF NOT EXISTS idx_devices_ip_expiry ON devices (created_at) WHERE ip_hash IS NOT NULL;

-- Gestartete Runs: Seed + Token vom Server, finished_at + entry_id sobald gewertet
-- (entry_id macht den Abschluss wiederholbar: gleiche Antwort statt Fehler).
CREATE TABLE IF NOT EXISTS run_tokens (
  token TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  seed INTEGER NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  entry_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_tokens_device ON run_tokens (device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_run_tokens_open ON run_tokens (created_at) WHERE finished_at IS NULL;

-- Gewertete Runs (vollständige Historie).
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  day TEXT NOT NULL,
  formation TEXT NOT NULL,
  ss_enabled INTEGER NOT NULL,
  picks_json TEXT NOT NULL,
  lineup_json TEXT NOT NULL,
  team_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  points INTEGER NOT NULL,
  season_seed INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_device ON entries (device_id, challenge, day);
-- Tägliche Elf: höchstens ein gewerteter Run pro Gerät und Tag (auch bei parallelen Anfragen).
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_daily_once ON entries (device_id, day) WHERE challenge = 'daily';

-- Bester Run je Gerät und Wertung (scope = 'all' oder der Tag 'YYYY-MM-DD'). Wird im
-- selben Batch wie der Eintrag aktualisiert – nur, wenn der neue Run besser ist.
CREATE TABLE IF NOT EXISTS best_entries (
  challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (challenge, scope, device_id)
);
-- Sortiert wie die Rangliste: Top-N per LIMIT, Platz = 1 + Anzahl besserer Zeilen.
CREATE INDEX IF NOT EXISTS idx_best_entries_rank ON best_entries (challenge, scope, points DESC, score DESC, created_at, entry_id);

-- Interne Werte, z. B. das zufällige Salz für IP-Hashes (falls IP_SALT nicht gesetzt ist).
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Online-Draft: eine Zeile pro Liga, gepflegt vom Durable Object „DraftRoom" (der Zustand
-- selbst liegt dort). Gebraucht für die Liste öffentlicher Lobbys und das Limit neuer Ligen
-- pro Gerät; phase = 'closed', wenn alle Teams eine Lobby verlassen haben (die Zeile zählt
-- dann noch eine Stunde fürs Limit). Nach DRAFT_LIMITS.retentionDays wird sie gelöscht.
CREATE TABLE IF NOT EXISTS draft_lobbies (
  code TEXT PRIMARY KEY,
  host_device TEXT NOT NULL,
  name TEXT NOT NULL,
  host_name TEXT NOT NULL,
  region INTEGER NOT NULL,
  legends INTEGER NOT NULL,
  pick_seconds INTEGER NOT NULL,
  teams INTEGER NOT NULL,
  max_teams INTEGER NOT NULL,
  visibility TEXT NOT NULL,
  phase TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Öffentliche Lobbys (visibility = 'public', phase = 'lobby'), zuletzt aktive zuerst.
CREATE INDEX IF NOT EXISTS idx_draft_lobbies_public ON draft_lobbies (visibility, phase, updated_at);
-- Limit neuer Ligen pro Gerät und Stunde.
CREATE INDEX IF NOT EXISTS idx_draft_lobbies_host ON draft_lobbies (host_device, created_at);

-- Online-Draft: Abschluss jedes menschlichen Teams einer fertigen Liga (Grundlage der Erfolge).
-- format: league | cup | manager; rank 1 = Meister bzw. Turniersieger; teams = Teams der Saison.
CREATE TABLE IF NOT EXISTS draft_results (
  code TEXT NOT NULL,
  device_id TEXT NOT NULL,
  format TEXT NOT NULL,
  rank INTEGER NOT NULL,
  teams INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  points INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (code, device_id)
);
CREATE INDEX IF NOT EXISTS idx_draft_results_device ON draft_results (device_id);

-- Trainer: Aussehen je Gerät (JSON, src/lib/trainer.ts) und gekaufte Cosmetics (Preis beim Kauf).
CREATE TABLE IF NOT EXISTS trainers (
  device_id TEXT PRIMARY KEY,
  look_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trainer_items (
  device_id TEXT NOT NULL,
  item TEXT NOT NULL,
  price INTEGER NOT NULL,
  bought_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, item)
);
