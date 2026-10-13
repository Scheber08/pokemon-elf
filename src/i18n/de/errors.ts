/**
 * Texte: errors (Deutsch – Quelle). Die englische Fassung in ../en/errors.ts muss dieselben Schlüssel haben.
 *
 * Fehler der Run-/Ranglisten-API (src/lib/api/client.ts). Der Server meldet auf Deutsch –
 * im deutschen Modus wird seine Meldung unverändert gezeigt; `code` & Co. sind dann nur
 * die Gegenstücke zur englischen Übersetzung (Zuordnung über den stabilen Fehlercode).
 */
import type { ApiErrorCode } from '../../lib/api/contract';

const errors = {
  /** fetch gescheitert (kein Netz, kein Server, Zeitüberschreitung) */
  network: 'Server nicht erreichbar',
  /** 429 ohne JSON-Antwort (z. B. vom CDN) */
  rateLimited: 'Zu viele Anfragen in kurzer Zeit – bitte später erneut versuchen',
  /** Antwort war kein JSON */
  unexpected: 'Unerwartete Antwort vom Server',
  /** Fehler ohne Meldung des Servers */
  http: (status: number) => `HTTP ${status}`,
  /** Meldung je Fehlercode, wenn es keine genauere gibt */
  code: {
    bad_request: 'Ungültige Anfrage',
    unauthorized: 'Gerät nicht erkannt – der Geräte-Schlüssel passt nicht zu dieser Geräte-ID',
    not_found: 'Nicht gefunden',
    method_not_allowed: 'Methode nicht erlaubt',
    already_played: "Die Tägliche Elf hast du schon gespielt – morgen gibt's eine neue!",
    invalid_run: 'Ungültiger Run',
    token_used: 'Dieser Run wurde bereits gewertet',
    token_expired: 'Dieser Run ist abgelaufen',
    rate_limited: 'Zu viele Anfragen in kurzer Zeit – bitte später erneut versuchen',
    server_error: 'Interner Serverfehler – bitte später erneut versuchen',
  } as Record<ApiErrorCode, string>,
  /** Genauere Meldungen (aus der Server-Meldung erkannt) */
  runNotFound: 'Run nicht gefunden',
  alreadyPlayedOn: (day: string) => `Die Tägliche Elf vom ${day} hast du schon gespielt – morgen gibt's eine neue!`,
  invalidRunInRound: (round: number) => `Ungültiger Run (Runde ${round})`,
  tokenExpired: (hours: number) => `Dieser Run ist abgelaufen (älter als ${hours} Stunden)`,
  tooManyRuns: 'Zu viele Runs in kurzer Zeit – bitte später erneut versuchen',
  tooManyFinishes: 'Zu viele gewertete Runs in kurzer Zeit – bitte später erneut versuchen',
  tooManyDevices: 'Zu viele neue Geräte von dieser Verbindung – bitte in einer Stunde erneut versuchen',
};

export default errors;
