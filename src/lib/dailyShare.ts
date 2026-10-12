/**
 * Tägliche Elf: Texte zum Teilen („Wordle-Stil") und kleine Anzeige-Helfer.
 * Rein – keine Browser-APIs, damit es auch in Tests läuft.
 */
import type { Record3 } from '../types';
import { formatDay } from './daily';

/** Ausgang eines Spiels aus Sicht des eigenen Teams: Sieg, Unentschieden, Niederlage. */
export type MatchOutcome = 'S' | 'U' | 'N';

export const OUTCOME_EMOJI: Record<MatchOutcome, string> = { S: '🟩', U: '🟨', N: '🟥' };

export interface DailyShareInput {
  /** Tag der Tages-Challenge „YYYY-MM-DD" */
  day: string;
  /** Laufende Nummer (dailyNumber) */
  number: number;
  record: Record3;
  points: number;
  score: number;
  /** Platz in der Abschlusstabelle */
  position: number;
  /** Ergebnisse aller Spieltage in Reihenfolge (34) */
  outcomes: readonly MatchOutcome[];
  /** Link zur Tagesseite, z. B. origin + '/taeglich' */
  url: string;
}

/** Ergebnisse als Emoji-Reihe (🟩 Sieg, 🟨 Remis, 🟥 Niederlage). */
export function outcomeEmojis(outcomes: readonly MatchOutcome[]): string {
  return outcomes.map((o) => OUTCOME_EMOJI[o]).join('');
}

/** Perfekte Saison: nur Siege. */
export function isPerfectRecord(r: Record3): boolean {
  return r.w > 0 && r.d === 0 && r.l === 0;
}

/**
 * Teil-Text der Tages-Challenge – fünf Zeilen:
 *   Pokémon Elf · Tägliche Elf #1 (12.10.2026)
 *   30–2–2 · 92 Pkt · Score 812 · Platz 1        (bei 34–0–0 mit „ 🏆")
 *   Hinrunde (Spiele 1–17) als Emojis
 *   Rückrunde (Spiele 18–34) als Emojis
 *   Link
 */
export function buildDailyShareText(i: DailyShareInput): string {
  const { w, d, l } = i.record;
  const half = Math.ceil(i.outcomes.length / 2);
  const trophy = isPerfectRecord(i.record) ? ' 🏆' : '';
  return [
    `Pokémon Elf · Tägliche Elf #${i.number} (${formatDay(i.day)})`,
    `${w}–${d}–${l} · ${i.points} Pkt · Score ${i.score} · Platz ${i.position}${trophy}`,
    outcomeEmojis(i.outcomes.slice(0, half)),
    outcomeEmojis(i.outcomes.slice(half)),
    i.url,
  ].join('\n');
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

/** Deutscher Wochentag eines Tages „YYYY-MM-DD" (unabhängig von der Zeitzone des Geräts). */
export function weekdayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** „Montag, 12.10.2026" */
export function formatDayLong(day: string): string {
  return `${weekdayName(day)}, ${formatDay(day)}`;
}

/** Restzeit als „05:12:33" – aufgerundet auf volle Sekunden, nie negativ. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
