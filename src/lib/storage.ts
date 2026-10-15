/** Kleine, fehlertolerante Hülle um localStorage (privater Modus, volle Quota …). */
const PREFIX = 'pokemon-elf:';

export const STORAGE_KEYS = {
  lineup: 'lineup',
  settings: 'settings',
  stats: (challenge: string) => `stats:${challenge}`,
  run: (challenge: string) => `run:${challenge}`,
  leaderboard: 'leaderboard',
  playerName: 'player-name',
  draft: 'draft',
  /** Lokaler Draft: bisherige Meister (Seed → Meister), für die Titelsammlung */
  draftChampions: 'draft-champions',
  /** Builder: gespeicherte Elfen (Meine Teams) */
  savedTeams: 'saved-teams',
  /** Trainer: schon gesehene Erfolge (für „Neu") */
  seenAchievements: 'achievements-seen',
  /** Neue Erfolge seit dem letzten Besuch der Trainer-Seite (Punkt im Menü) */
  newAchievements: 'achievements-new',
  /** Eigene Trikotnummern je Modus (z. B. „c340"), Pokémon-ID → Nummer */
  jerseys: (scope: string) => `jerseys:${scope}`,
  kit: (scope: string) => `kit:${scope}`,
  cheer: (scope: string) => `cheer:${scope}`,
  crest: (scope: string) => `crest:${scope}`,
  /** Teamnamen aus den Online-Ranglisten für Ligagegner (src/lib/rankingNames.ts) */
  rankingNames: 'ranking-names',
} as const;

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar – App funktioniert trotzdem. */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignorieren */
  }
}
