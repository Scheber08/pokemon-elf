import { describe, expect, it } from 'vitest';
import { keepDailyRun, previousDay, type DailyRunCheck } from '../src/lib/dailyRun';

const TODAY = '2026-10-13';
const YESTERDAY = '2026-10-12';
const OLDER = '2026-10-11';

const check = (patch: Partial<DailyRunCheck>): boolean =>
  keepDailyRun({ phase: 'play', day: TODAY, today: TODAY, initial: true, revealing: false, ...patch });

describe('previousDay', () => {
  it('rechnet Kalendertage – über Monats-, Jahres- und Schaltjahresgrenzen', () => {
    expect(previousDay('2026-10-13')).toBe('2026-10-12');
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
  });

  it('übersteht die Zeitumstellungen', () => {
    expect(previousDay('2026-03-30')).toBe('2026-03-29');
    expect(previousDay('2026-10-26')).toBe('2026-10-25');
  });
});

describe('keepDailyRun – Runs über Mitternacht', () => {
  it('heutige Runs bleiben immer', () => {
    expect(check({ phase: 'play' })).toBe(true);
    expect(check({ phase: 'result' })).toBe(true);
    expect(check({ phase: 'result', initial: false })).toBe(true);
  });

  it('angefangener Run von gestern bleibt auch nach Reload/Navigation spielbar', () => {
    // Remount nach Mitternacht (z. B. Rangliste und zurück): früher verworfen
    expect(check({ day: YESTERDAY, initial: true })).toBe(true);
    expect(check({ day: YESTERDAY, initial: false })).toBe(true);
  });

  it('ältere Runs werden beim Öffnen verworfen, laufende Seite lässt sie fertig spielen', () => {
    expect(check({ day: OLDER, initial: true })).toBe(false);
    expect(check({ day: '2026-09-30', initial: true })).toBe(false);
    expect(check({ day: OLDER, initial: false })).toBe(true);
  });

  it('Altdaten ohne Tag werden beim Öffnen verworfen', () => {
    expect(check({ day: null, initial: true })).toBe(false);
  });

  it('Server-Tag vor der Geräteuhr (Run „von morgen") bleibt', () => {
    expect(check({ day: '2026-10-14', initial: true })).toBe(true);
  });

  it('Ergebnisse vergangener Tage nur, solange Ticker/Bilanz dieser Sitzung laufen', () => {
    expect(check({ phase: 'result', day: YESTERDAY, revealing: true })).toBe(true);
    expect(check({ phase: 'result', day: YESTERDAY, revealing: false })).toBe(false);
    expect(check({ phase: 'result', day: YESTERDAY, revealing: false, initial: false })).toBe(false);
    expect(check({ phase: 'result', day: OLDER, revealing: false })).toBe(false);
  });

  it('nach dem Abschluss eines Vortags-Runs ist die neue Elf spielbar', () => {
    // Gerade beendet: bleibt mit Banner „Die neue Tägliche Elf ist da – Jetzt spielen" stehen …
    expect(check({ phase: 'result', day: YESTERDAY, revealing: true, initial: false })).toBe(true);
    // … beim nächsten Öffnen wird er zurückgesetzt → Setup für heute
    expect(check({ phase: 'result', day: YESTERDAY, revealing: false, initial: true })).toBe(false);
  });
});
