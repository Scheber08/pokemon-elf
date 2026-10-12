/**
 * Vertrag zwischen App und Cloudflare-Backend (functions/api, server/).
 * Alle Endpunkte sprechen JSON. Fehler: HTTP-Status + ApiErrorBody.
 *
 *   GET  /api/health                         → HealthResponse
 *   POST /api/runs/start    StartRunRequest  → StartRunResponse
 *   POST /api/runs/finish   FinishRunRequest → FinishRunResponse
 *   GET  /api/leaderboard?challenge=…&period=today|all&limit=…&me=<deviceId>
 *                                            → LeaderboardResponse
 *   POST /api/player        RenameRequest    → { ok: true }
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
import type { PickLog } from '../challengeEngine';

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
  /** 0–32 Zeichen */
  teamName: string;
  /**
   * 1–24 Zeichen; wird als aktueller Name des Geräts gespeichert. Ohne Buchstabe,
   * Ziffer oder Emoji (nach dem Säubern) bleibt der gespeicherte Name unverändert.
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

export type Period = 'today' | 'all';

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

export interface RenameRequest extends DeviceAuth {
  /** 1–24 Zeichen, mindestens ein Buchstabe, eine Ziffer oder ein Emoji (sonst 400) */
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
  | 'server_error';

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
