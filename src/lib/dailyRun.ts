/**
 * Tägliche Elf: Welche gespeicherten Runs bleiben stehen, wenn die Seite geöffnet wird oder
 * der Tag (Berlin) wechselt? Rein und ohne Browser-APIs – die Seite ruft nur keepDailyRun auf.
 */

/** Vortag eines Tages „YYYY-MM-DD" (reine Kalenderrechnung, unabhängig von Zeitzone/Sommerzeit). */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export interface DailyRunCheck {
  phase: 'play' | 'result';
  /** Tag des Runs (Server-Tag bzw. dayKey() beim Offline-Start), null bei Altdaten */
  day: string | null;
  /** Heutiger Tag in Berlin */
  today: string;
  /** Erste Prüfung nach dem (Neu-)Laden der Seite – sonst lief die Seite schon */
  initial: boolean;
  /** Ticker/Bilanz des gerade beendeten Runs läuft in dieser Sitzung */
  revealing: boolean;
}

/**
 * true = Run bleibt stehen, false = zurücksetzen (ein Versuch pro Tag).
 *   play    Runs von heute und gestern bleiben – auch nach Reload oder Navigation: Online gilt
 *           das Token 48 h und der Server wertet den Run für seinen Starttag. Ältere Runs werden
 *           beim Öffnen verworfen; läuft die Seite schon, darf ein Run immer zu Ende gespielt werden.
 *   result  Ergebnis von heute bleibt; ältere nur, solange Ticker/Bilanz dieser Sitzung laufen
 *           (dort mit Hinweis auf die neue Elf).
 */
export function keepDailyRun({ phase, day, today, initial, revealing }: DailyRunCheck): boolean {
  if (day === today) return true;
  if (phase === 'play') {
    if (!initial) return true;
    // Auch ein Tag „in der Zukunft" (Geräteuhr geht nach) bleibt – ISO-Tage lassen sich als Text vergleichen.
    return day != null && day >= previousDay(today);
  }
  return revealing;
}
