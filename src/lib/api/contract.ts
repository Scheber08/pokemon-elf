/**
 * Vertrag zwischen App und Cloudflare-Backend (functions/api, server/).
 * Alle Endpunkte sprechen JSON. Fehler: HTTP-Status + ApiErrorBody.
 *
 *   GET  /api/health                         → HealthResponse
 *   POST /api/runs/start    StartRunRequest  → StartRunResponse
 *   POST /api/runs/finish   FinishRunRequest → FinishRunResponse
 *   GET  /api/leaderboard?challenge=…&period=today|all&limit=…&me=<deviceId>
 *                                            → LeaderboardResponse
 *   GET  /api/entries/:id                    → EntryDetail (nur Ranglisten-Einträge, sonst 404)
 *   GET  /api/entries/:id/player             → PlayerProfile (Spieler dieses Ranglisten-Eintrags)
 *   POST /api/player        RenameRequest    → { ok: true }
 *   POST /api/me            DeviceAuth       → MeResponse (Erfolge, Münzen, Trainer)
 *   POST /api/me/trainer    SaveTrainerRequest → MeResponse
 *   POST /api/me/buy        BuyItemRequest   → MeResponse
 *
 * Spielername: Ein neues Gerät heißt auf dem Server „Trainer" (DEFAULT_PLAYER_NAME). Mit
 * diesem Standardnamen (oder leerem Namen, siehe isDefaultPlayerName) startet kein
 * gewerteter Run (400 name_required) und das Gerät erscheint in keiner Rangliste; POST
 * /api/player lehnt ihn ab (400 bad_name). Ein Teamname ist beim Abschluss Pflicht
 * (400 team_name_required).
 *
 * Ablauf eines gewerteten Runs:
 *  1. start: Der Server vergibt Seed + Token (Tages-Challenge: Seed des Tages).
 *  2. Der Client spielt mit challengeEngine und protokolliert jeden Zug (PickLog).
 *  3. finish: Der Server spielt das Protokoll mit derselben Engine nach, verwirft
 *     illegale Runs, zieht den Saison-Seed selbst (Tages-Challenge: Seed des Tages),
 *     rechnet Team-Score + Saison und speichert den Eintrag.
 *  4. Der Client simuliert mit seasonSeed lokal dieselbe Saison (deterministisch).
 *
 * finish ist pro Token wiederholbar: Schickt dasselbe Gerät einen schon gewerteten
 * Token erneut (z. B. weil die Antwort verloren ging), kommt 200 mit dem gespeicherten
 * Ergebnis (gleiche entryId und seasonSeed, Plätze aktuell) – egal, was im Body steht.
 * 409 token_used gibt es nur noch, solange eine parallele Anfrage den Run gerade speichert.
 */
import type { ChallengeKey, FormationId, Record3 } from '../../types';
import type { AchievementState, AchievementStats } from '../achievements';
import type { PickLog } from '../challengeEngine';
import type { TrainerLook } from '../trainer';

export const API_VERSION = 1;

export interface DeviceAuth {
  deviceId: string;
  deviceSecret: string;
}

export interface HealthResponse {
  ok: true;
  version: number;
  /** Heutiger Tag (Europe/Berlin) laut Server */
  day: string;
  /** Zusatzfunktionen dieses Servers (fehlt bei älteren Servern = keine) */
  features?: { drafts: boolean };
}

export interface StartRunRequest extends DeviceAuth {
  challenge: ChallengeKey;
}

export interface StartRunResponse {
  token: string;
  challenge: ChallengeKey;
  /** Seed der Würfe (challengeEngine.RunConfig.seed) */
  seed: number;
  /** Tag, dem der Run zugeordnet wird (Europe/Berlin) */
  day: string;
}

export interface FinishRunRequest extends DeviceAuth {
  token: string;
  formation: FormationId;
  ssEnabled: boolean;
  picks: PickLog[];
  /** 1–32 Zeichen mit Buchstabe, Ziffer oder Emoji – leer: 400 team_name_required */
  teamName: string;
  /**
   * 1–24 Zeichen; wird als aktueller Name des Geräts gespeichert. Ohne Buchstabe,
   * Ziffer oder Emoji (nach dem Säubern) oder als Standardname („Trainer") bleibt der
   * gespeicherte Name unverändert.
   */
  player: string;
}

export interface FinishRunResponse {
  entryId: string;
  challenge: ChallengeKey;
  day: string;
  /** Seed, mit dem der Client die Saison lokal nachsimuliert */
  seasonSeed: number;
  score: number;
  record: Record3;
  points: number;
  /** Platz des Geräts in der Tageswertung dieser Challenge (bester Run zählt) */
  rankToday: number | null;
  /** Platz des Geräts in der Allzeit-Wertung */
  rankAllTime: number | null;
}

/** Wertung: heute (Tag in Berlin), diese Woche (ISO-Woche, Berlin) oder allzeit */
export type Period = 'today' | 'week' | 'all';

export interface LeaderboardRow {
  rank: number;
  entryId: string;
  player: string;
  teamName: string;
  record: Record3;
  points: number;
  score: number;
  formation: FormationId;
  /** ISO-Zeitstempel */
  createdAt: string;
  day: string;
  /** true, wenn die Zeile zum anfragenden Gerät gehört (?me=) */
  me: boolean;
  /** Trainer des Spielers (fehlt bzw. null: keiner gestaltet) */
  trainer?: TrainerLook | null;
}

export interface LeaderboardResponse {
  challenge: ChallengeKey;
  period: Period;
  day: string;
  /** Anzahl Spieler (Geräte) in dieser Wertung */
  players: number;
  rows: LeaderboardRow[];
  /** Eigene Zeile, auch wenn sie außerhalb von `limit` liegt */
  mine: LeaderboardRow | null;
}

/**
 * GET /api/entries/:id – das Team eines Ranglisten-Eintrags.
 * Nur Einträge, die gerade in einer abrufbaren Rangliste stehen (Bestwert allzeit oder heute –
 * kurz nach Mitternacht auch noch von gestern) und deren Gerät einen eigenen Namen hat; sonst
 * 404 not_found, auch für den Bestwert eines vergangenen Tages. Ungültige ID → 400 bad_request.
 * Antwort mit Cache-Control: public, max-age=60 – `player` kann daher bis zu einer Minute alt
 * sein; den aktuellen Namen liefert die Zeile aus GET /api/leaderboard (no-store).
 */
export interface EntryDetail {
  entryId: string;
  challenge: ChallengeKey;
  day: string;
  /** Name des Geräts beim Abruf (siehe Cache-Hinweis oben) */
  player: string;
  teamName: string;
  formation: FormationId;
  /** Spieler-IDs in Slot-Reihenfolge der Formation (11 Einträge, null = leer) */
  slots: (number | null)[];
  /**
   * Standardschütze (Spieler-ID, zählt nicht zum Team-Score) – null ohne Standardschütze
   * (ssEnabled false) oder wenn sein Platz leer ist
   */
  ss: number | null;
  ssEnabled: boolean;
  record: Record3;
  points: number;
  score: number;
  /** ISO-Zeitstempel */
  createdAt: string;
}

/** Bestwert (allzeit) eines Spielers in einer Wertung – steht in der Rangliste, also verlinkbar */
export interface PlayerBest {
  entryId: string;
  teamName: string;
  formation: FormationId;
  day: string;
  record: Record3;
  points: number;
  score: number;
}

export interface PlayerChallengeStats {
  challenge: ChallengeKey;
  /** Gewertete Runs */
  runs: number;
  /** Davon perfekte Saisons (nur Siege, z. B. 34–0) */
  perfect: number;
  /** Aktueller Platz in der Allzeit-Rangliste (null = nicht gelistet; fehlt bei älteren Antworten) */
  place?: number | null;
  /** Spieler in der Allzeit-Rangliste dieser Wertung */
  players?: number;
  best: PlayerBest | null;
}

/** Ein gewerteter Run (Verlauf – nicht verlinkbar, nur Bestwerte stehen in der Rangliste) */
export interface PlayerRun {
  challenge: ChallengeKey;
  day: string;
  teamName: string;
  record: Record3;
  points: number;
  score: number;
  /** ISO-Zeitstempel */
  createdAt: string;
}

/**
 * GET /api/entries/:id/player – Profil des Spielers hinter einem Ranglisten-Eintrag (gleiche
 * Sichtbarkeit wie GET /api/entries/:id, sonst 404). Keine Geräte-IDs. Cache: max-age=60.
 */
export interface PlayerProfile {
  player: string;
  /** Trainer des Spielers (fehlt bzw. null: keiner gestaltet) */
  trainer?: TrainerLook | null;
  /** Erster gewerteter Run (ISO) */
  since: string;
  runs: number;
  /** Je Wertung (Reihenfolge wie CHALLENGE_KEYS, nur gespielte) */
  challenges: PlayerChallengeStats[];
  /** Die letzten gewerteten Runs, neuester zuerst (höchstens 20) */
  recent: PlayerRun[];
  /** Erreichte Erfolge von allen (fehlt bei älteren Antworten) */
  achievements?: { done: number; total: number };
  /** Fertige Online-Ligen und Titel darin (Liga, Pokal, Manager-Saison; fehlt bei älteren Antworten) */
  online?: { leagues: number; titles: number };
}

/** POST /api/me (Body: DeviceAuth) – Erfolge und Münzen des eigenen Geräts */
export interface MeResponse {
  /** Eigener Spielername – null mit Standardnamen */
  player: string | null;
  coins: { earned: number; spent: number; balance: number };
  /** Alle Erfolge (Reihenfolge wie ACHIEVEMENTS) */
  achievements: AchievementState[];
  /** Aussehen des Trainers (ohne gespeicherten: DEFAULT_LOOK) */
  trainer: TrainerLook;
  /** Gekaufte Cosmetics (itemKey: „hat:crown") */
  owned: string[];
  /** Kennzahlen hinter den Erfolgen (fehlt bei älteren Antworten) */
  stats?: AchievementStats;
}

/** POST /api/me/trainer – Aussehen speichern (nur Freies und Gekauftes, sonst 400 locked_item) → MeResponse */
export interface SaveTrainerRequest extends DeviceAuth {
  look: TrainerLook;
}

/** POST /api/me/buy – Cosmetic kaufen (itemKey; zu wenig Münzen → 400 not_enough_coins, Saisonartikel außerhalb der Saison → 400 not_on_sale) → MeResponse */
export interface BuyItemRequest extends DeviceAuth {
  item: string;
}

export interface RenameRequest extends DeviceAuth {
  /**
   * 1–24 Zeichen, mindestens ein Buchstabe, eine Ziffer oder ein Emoji (sonst 400 bad_request);
   * leer oder der Standardname „Trainer" → 400 bad_name
   */
  player: string;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'already_played'
  | 'invalid_run'
  | 'token_used'
  | 'token_expired'
  | 'rate_limited'
  | 'server_error'
  /** POST /api/player: leerer Name oder Standardname („Trainer") */
  | 'bad_name'
  /** POST /api/runs/start: Das Gerät hat noch keinen eigenen Namen (erst POST /api/player) */
  | 'name_required'
  /** POST /api/runs/finish: Teamname fehlt (leer oder nichts Sichtbares) */
  | 'team_name_required'
  /** POST /api/me/trainer: Der Look enthält etwas, das noch nicht gekauft ist */
  | 'locked_item'
  /** POST /api/me/buy: Zu wenige Münzen */
  | 'not_enough_coins'
  | 'not_on_sale';

export interface ApiErrorBody {
  error: ApiErrorCode;
  /** Deutsche, anzeigbare Fehlermeldung */
  message: string;
}

export const LIMITS = {
  playerMax: 24,
  teamNameMax: 32,
  leaderboardMax: 100,
  /** Gültigkeit eines Run-Tokens */
  tokenTtlHours: 48,
  /** Starts bzw. Abschlüsse pro Gerät und Stunde */
  startsPerHour: 60,
  finishesPerHour: 60,
  /** Neue Geräte pro IP und Stunde */
  devicesPerIpPerHour: 20,
} as const;

/** Höchstlänge eines Spielernamens (Zeichen) */
export const PLAYER_NAME_MAX = LIMITS.playerMax;

/** Name eines Geräts, das noch keinen eigenen Namen gewählt hat */
export const DEFAULT_PLAYER_NAME = 'Trainer';

/** Leerraum zusammenfassen und an den Rändern entfernen. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Leer aussehende Füllzeichen (Hangul-Filler, leere Braille-Zelle) – zählen wie Leerzeichen (wie server/validate.ts). */
const BLANK_LIKE_RE = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;
/**
 * Unsichtbares, das einen Namen nur scheinbar ändert: Steuer- und Formatzeichen (ZWSP, Bidi …),
 * Kombinationszeichen (auch Variantenwähler, Grapheme Joiner, Khmer-Vokale) und alle übrigen
 * „Default Ignorable" Codepoints.
 */
const INVISIBLE_RE = /[\p{Cc}\p{Cs}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Standardname statt eines eigenen Namens? true für leer und für „Trainer" – in beliebiger
 * Groß-/Kleinschreibung, mit Leerraum drumherum und auch mit unsichtbaren Zusätzen: verglichen
 * wird nach NFKC (Vollbreite, mathematische Buchstaben …) ohne Steuer-, Format- und
 * Kombinationszeichen. Damit startet kein gewerteter Run und das Gerät steht in keiner Rangliste.
 */
export function isDefaultPlayerName(name: string | null | undefined): boolean {
  if (name == null) return true;
  const plain = String(name).normalize('NFKC').toLowerCase().replace(BLANK_LIKE_RE, ' ').replace(INVISIBLE_RE, '');
  const clean = squash(plain);
  return clean === '' || clean === DEFAULT_PLAYER_NAME.toLowerCase();
}

/** Spielername für die Eingabe: Leerraum zusammengefasst, getrimmt, höchstens PLAYER_NAME_MAX Zeichen. */
export function cleanPlayerName(raw: string): string {
  return squash([...squash(raw)].slice(0, PLAYER_NAME_MAX).join(''));
}
