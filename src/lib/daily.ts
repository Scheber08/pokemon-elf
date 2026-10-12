/**
 * Tägliche Challenge: ein Seed pro Kalendertag (Europe/Berlin) – für alle gleich.
 * Wird von Client und Server benutzt (nur Intl, keine Browser-APIs).
 */
import { hashSeed } from './rng';

export const DAILY_TIMEZONE = 'Europe/Berlin';
/** Tag der ersten Tages-Challenge (Nr. 1). */
export const DAILY_EPOCH = '2026-10-12';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DAILY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kalendertag „YYYY-MM-DD" in Berlin. */
export function dayKey(date: Date = new Date()): string {
  return dayFormatter.format(date);
}

export function isDayKey(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00Z`);
  // Rundreise verwirft Kalender-Unsinn wie 2026-02-30 (Date.parse rollt sonst über).
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

/** Seed der Würfe dieses Tages. */
export function dailyRunSeed(day: string): number {
  return hashSeed('pokemon-elf', 'daily', day);
}

/** Seed der Saison dieses Tages – gleiche Elf → gleiches Ergebnis für alle. */
export function dailySeasonSeed(day: string): number {
  return hashSeed('pokemon-elf', 'daily-season', day);
}

/** Laufende Nummer der Tages-Challenge (DAILY_EPOCH = Nr. 1). */
export function dailyNumber(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DAILY_EPOCH}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** „12.10.2026" */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/** Millisekunden bis Mitternacht in Berlin (nächste Tages-Challenge). */
export function msUntilNextDay(now: Date = new Date()): number {
  const today = dayKey(now);
  // In 1-Minuten-Schritten wäre zu langsam – binär zwischen jetzt und +26 h suchen.
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return Math.max(0, hi - now.getTime());
}
