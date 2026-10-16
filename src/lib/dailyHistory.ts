/**
 * Tägliche Elf auf diesem Gerät: ein Eintrag pro gespieltem Tag (Bilanz, Punkte, Score, Platz)
 * – daraus die Serie (Tage am Stück) und das Archiv. Nur lokal; die Rangliste bleibt online.
 */
import type { Record3 } from '../types';
import { isDayKey } from './daily';
import { previousDay } from './dailyRun';
import { load, save } from './storage';

const KEY = 'daily:history';
/** So viele Tage bleiben gespeichert */
export const DAILY_HISTORY_MAX = 400;

export interface DailyDay {
  /** Tag „YYYY-MM-DD" (Berlin) */
  day: string;
  record: Record3;
  points: number;
  score: number;
  /** Platz in der Saison-Tabelle */
  position: number;
}

const isRecord = (r: unknown): r is Record3 =>
  !!r && typeof r === 'object' && ['w', 'd', 'l'].every((k) => Number.isInteger((r as Record<string, unknown>)[k]));

/** Gespielte Tage, neuester zuerst (Unlesbares fällt weg). */
export function loadDailyHistory(): DailyDay[] {
  const raw = load<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is DailyDay =>
        !!d && typeof d === 'object' && isDayKey((d as DailyDay).day) && isRecord((d as DailyDay).record) &&
        Number.isFinite((d as DailyDay).points) && Number.isFinite((d as DailyDay).score) && Number.isFinite((d as DailyDay).position),
    )
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** Tag eintragen (ein Tag zählt nur einmal – der erste Eintrag bleibt). */
export function recordDailyDay(entry: DailyDay): DailyDay[] {
  const prev = loadDailyHistory();
  if (prev.some((d) => d.day === entry.day)) return prev;
  const next = [entry, ...prev].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, DAILY_HISTORY_MAX);
  save(KEY, next);
  return next;
}

export interface DailyStreak {
  /** Tage am Stück bis heute – bzw. bis gestern, solange heute noch gespielt werden kann */
  current: number;
  /** Längste Serie */
  best: number;
}

/** Serie aus den gespielten Tagen (beliebige Reihenfolge). */
export function dailyStreak(days: readonly string[], today: string): DailyStreak {
  const set = new Set(days);
  let current = 0;
  let d = set.has(today) ? today : previousDay(today);
  while (set.has(d)) {
    current++;
    d = previousDay(d);
  }
  let best = 0;
  for (const day of set) {
    if (set.has(previousDay(day))) continue; // nicht der Anfang einer Serie
    let n = 0;
    let x = day;
    while (set.has(x)) {
      n++;
      x = new Date(Date.parse(`${x}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    best = Math.max(best, n);
  }
  return { current, best };
}

export interface BestWeekday {
  /** 0 = Sonntag … 6 = Samstag */
  weekday: number;
  avg: number;
  count: number;
}

/**
 * Wochentag mit dem höchsten Punkteschnitt – nur Wochentage mit mindestens zwei Spielen zählen,
 * und erst wenn es mindestens zwei solche gibt (sonst gibt es nichts zu vergleichen).
 * Gleichstand: der früher in der Woche (Montag zuerst).
 */
export function bestWeekday(history: readonly DailyDay[]): BestWeekday | null {
  const sums = new Map<number, { pts: number; n: number }>();
  for (const d of history) {
    const [y, m, dd] = d.day.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    const s = sums.get(wd) ?? { pts: 0, n: 0 };
    s.pts += d.points;
    s.n++;
    sums.set(wd, s);
  }
  const rows = [...sums].filter(([, s]) => s.n >= 2).map(([weekday, s]) => ({ weekday, avg: s.pts / s.n, count: s.n }));
  if (rows.length < 2) return null;
  const order = (w: number) => (w + 6) % 7;
  rows.sort((a, b) => b.avg - a.avg || order(a.weekday) - order(b.weekday));
  return { ...rows[0], avg: Math.round(rows[0].avg) };
}
