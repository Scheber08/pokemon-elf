/** Tägliche Elf: Serie (Tage am Stück) und lokales Archiv. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dailyStreak, loadDailyHistory, recordDailyDay, type DailyDay } from '../src/lib/dailyHistory';

const day = (d: string, w = 30): DailyDay => ({ day: d, record: { w, d: 2, l: 2 }, points: w * 3 + 2, score: 700, position: 1 });

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe('Serie', () => {
  it('zählt Tage am Stück bis heute – oder bis gestern, solange heute noch offen ist', () => {
    const days = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
    expect(dailyStreak(days, '2026-10-13')).toEqual({ current: 4, best: 4 });
    expect(dailyStreak(days, '2026-10-14')).toEqual({ current: 4, best: 4 });
    expect(dailyStreak(days, '2026-10-15')).toEqual({ current: 0, best: 4 });
  });

  it('beste Serie über Lücken und Monatswechsel', () => {
    const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06'];
    expect(dailyStreak(days, '2026-10-06')).toEqual({ current: 2, best: 3 });
    expect(dailyStreak([], '2026-10-06')).toEqual({ current: 0, best: 0 });
  });
});

describe('Archiv', () => {
  it('ein Eintrag pro Tag, neuester zuerst; Unlesbares fällt weg', () => {
    recordDailyDay(day('2026-10-12'));
    recordDailyDay(day('2026-10-14'));
    recordDailyDay(day('2026-10-13'));
    recordDailyDay(day('2026-10-14', 0));
    const h = loadDailyHistory();
    expect(h.map((d) => d.day)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(h[0].record.w).toBe(30);
    localStorage.setItem('pokemon-elf:daily:history', JSON.stringify([{ day: 'x' }, day('2026-10-01'), 5]));
    expect(loadDailyHistory().map((d) => d.day)).toEqual(['2026-10-01']);
    localStorage.setItem('pokemon-elf:daily:history', '"kaputt"');
    expect(loadDailyHistory()).toEqual([]);
  });
});

describe('Bester Wochentag', () => {
  it('höchster Schnitt unter Wochentagen mit mindestens zwei Spielen', async () => {
    const { bestWeekday } = await import('../src/lib/dailyHistory');
    // 2026-10-12 und 2026-10-19 sind Montage, 2026-10-13 und 2026-10-20 Dienstage, 2026-10-14 ein Mittwoch
    const h = [day('2026-10-12', 20), day('2026-10-19', 22), day('2026-10-13', 30), day('2026-10-20', 31), day('2026-10-14', 34)];
    expect(bestWeekday(h)).toEqual({ weekday: 2, avg: Math.round((92 + 95) / 2), count: 2 });
    // Nur ein Wochentag mit zwei Spielen: nichts zu vergleichen
    expect(bestWeekday(h.slice(0, 3))).toBeNull();
    // Gleichstand: Montag vor Dienstag
    expect(bestWeekday([day('2026-10-12'), day('2026-10-19'), day('2026-10-13'), day('2026-10-20')])!.weekday).toBe(1);
  });
});
