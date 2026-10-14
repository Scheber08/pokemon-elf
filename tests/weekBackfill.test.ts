/** Wochenwertung nachtragen: aus den Tages-Bestwerten der laufenden Woche, einmalig. */
import { describe, expect, it } from 'vitest';
import { dayKey, weekKey } from '../src/lib/daily';
import { backfillWeekBests, mondayOf, WEEK_BACKFILL_KEY } from '../server/db';
import { ensureSchema } from '../server/schema';
import { D1Shim } from './d1shim';

describe('Wochenwertung nachtragen', () => {
  it('Montag einer Woche', () => {
    expect(mondayOf('2026-10-14')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('bester Tageswert je Gerät und Wertung der laufenden Woche – nur einmal', async () => {
    const db = new D1Shim();
    await ensureSchema(db);
    // ensureSchema hat das Nachtragen (für „heute") schon erledigt – für diesen Test zurücksetzen
    db.update('DELETE FROM meta WHERE key = ?', WEEK_BACKFILL_KEY);
    const now = Date.UTC(2026, 9, 14, 10); // Mi 14.10.2026
    const insert = (scope: string, device: string, entry: string, points: number, challenge = 'c340') =>
      db.update(
        'INSERT INTO best_entries (challenge, scope, device_id, entry_id, points, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        challenge, scope, device, entry, points, 700, now,
      );
    insert('2026-10-12', 'a', 'a1', 80);
    insert('2026-10-14', 'a', 'a2', 90);
    insert('2026-10-13', 'b', 'b1', 70, 'daily');
    insert('2026-10-11', 'c', 'c1', 99); // Vorwoche
    insert('all', 'c', 'c1', 99);
    // Schon vorhandener (besserer) Wochenwert bleibt
    insert(weekKey('2026-10-14'), 'd', 'd9', 100);
    insert('2026-10-13', 'd', 'd1', 60);
    // Neu eingetragen: a (bester von zwei Tagen) und b; d behält seinen besseren Wochenwert
    expect(await backfillWeekBests(db, now)).toBe(2);
    const week = db.query<{ challenge: string; device_id: string; entry_id: string }>(
      'SELECT challenge, device_id, entry_id FROM best_entries WHERE scope = ? ORDER BY device_id',
      weekKey(dayKey(new Date(now))),
    );
    expect(week).toEqual([
      { challenge: 'c340', device_id: 'a', entry_id: 'a2' },
      { challenge: 'daily', device_id: 'b', entry_id: 'b1' },
      { challenge: 'c340', device_id: 'd', entry_id: 'd9' },
    ]);
    expect(db.query('SELECT key FROM meta WHERE key = ?', WEEK_BACKFILL_KEY)).toHaveLength(1);
    expect(await backfillWeekBests(db, now)).toBeNull();
  });
});
