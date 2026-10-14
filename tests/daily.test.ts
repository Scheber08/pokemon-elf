import { describe, expect, it } from 'vitest';
import {
  DAILY_EPOCH,
  dailyNumber,
  dailyRunSeed,
  dailySeasonSeed,
  dayKey,
  formatDay,
  isDayKey,
  msUntilNextDay,
} from '../src/lib/daily';
import {
  buildDailyShareText,
  formatCountdown,
  formatDayLong,
  outcomeEmojis,
  weekdayName,
  type DailyShareInput,
  type MatchOutcome,
} from '../src/lib/dailyShare';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Uhrzeit in Berlin „HH:MM:SS" – zum Prüfen, dass Mitternacht getroffen wird. */
const berlinTime = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Tag „YYYY-MM-DD" plus n Kalendertage. */
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

describe('dayKey (Europe/Berlin)', () => {
  it('nutzt die Berliner Zeit, nicht UTC', () => {
    // Sommerzeit (UTC+2): 22:30 UTC ist schon 00:30 am nächsten Tag
    expect(dayKey(new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12');
    expect(dayKey(new Date('2026-10-11T21:59:59Z'))).toBe('2026-10-11');
    expect(dayKey(new Date('2026-10-11T22:00:00Z'))).toBe('2026-10-12');
    // Winterzeit (UTC+1): Jahreswechsel
    expect(dayKey(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(dayKey(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
  });

  it('übersteht die Zeitumstellungen', () => {
    // Umstellung auf Sommerzeit am 29.03.2026 um 01:00 UTC (02:00 → 03:00 Ortszeit)
    expect(dayKey(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
    expect(dayKey(new Date('2026-03-28T22:59:59Z'))).toBe('2026-03-28');
    expect(dayKey(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(dayKey(new Date('2026-03-29T21:59:59Z'))).toBe('2026-03-29');
    expect(dayKey(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    // Umstellung auf Winterzeit am 25.10.2026 um 01:00 UTC (03:00 → 02:00 Ortszeit)
    expect(dayKey(new Date('2026-10-24T21:59:59Z'))).toBe('2026-10-24');
    expect(dayKey(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(dayKey(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25');
    expect(dayKey(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('liefert immer das Format YYYY-MM-DD', () => {
    expect(dayKey(new Date('2027-02-03T10:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isDayKey(dayKey())).toBe(true);
  });
});

describe('isDayKey', () => {
  it('erkennt gültige Tage', () => {
    for (const d of ['2026-10-12', '2027-01-01', '2028-02-29', '2026-03-29']) expect(isDayKey(d)).toBe(true);
  });

  it('lehnt alles andere ab', () => {
    for (const d of ['', '2026-1-1', '12.10.2026', '2026/10/12', '2026-10-12T00:00', ' 2026-10-12', '2026-13-01', 'abcd-ef-gh']) {
      expect(isDayKey(d)).toBe(false);
    }
  });
});

describe('dailyNumber', () => {
  it('startet am 12.10.2026 mit Nr. 1', () => {
    expect(DAILY_EPOCH).toBe('2026-10-12');
    expect(dailyNumber('2026-10-12')).toBe(1);
    expect(dailyNumber('2026-10-13')).toBe(2);
    expect(dailyNumber('2026-10-11')).toBe(0);
  });

  it('zählt pro Kalendertag genau +1 – auch über Zeitumstellung und Schaltjahr', () => {
    let day = '2026-10-12';
    for (let n = 1; n <= 800; n++) {
      expect(dailyNumber(day)).toBe(n);
      day = addDays(day, 1);
    }
    expect(dailyNumber('2026-10-26')).toBe(15);
    expect(dailyNumber('2027-01-01')).toBe(82);
    expect(dailyNumber('2028-03-01')).toBe(507);
  });
});

describe('msUntilNextDay', () => {
  /** Zeitpunkte über ein Jahr verteilt, inkl. der Tage mit Zeitumstellung (nicht exakt auf Mitternacht). */
  const instants: Date[] = [
    new Date('2026-10-12T09:15:00Z'),
    new Date('2026-10-11T22:00:01Z'),
    new Date('2026-10-12T21:59:30Z'),
    new Date('2026-12-31T23:30:00Z'),
    new Date('2026-03-28T23:00:30Z'), // 29.03. (23 h) kurz nach Mitternacht
    new Date('2026-03-29T00:59:59Z'),
    new Date('2026-03-29T01:00:00Z'),
    new Date('2026-10-24T22:00:30Z'), // 25.10. (25 h) kurz nach Mitternacht
    new Date('2026-10-25T00:30:00Z'),
    new Date('2026-10-25T01:30:00Z'),
    new Date('2026-10-25T22:59:00Z'),
  ];
  for (let t = Date.parse('2026-10-01T00:00:17Z'); t < Date.parse('2027-10-31T00:00:00Z'); t += 19 * HOUR + 7 * 60_000 + 13_000) {
    instants.push(new Date(t));
  }

  it('liegt immer in (0, 25 h]', () => {
    for (const now of instants) {
      const ms = msUntilNextDay(now);
      expect(ms, now.toISOString()).toBeGreaterThan(0);
      expect(ms, now.toISOString()).toBeLessThanOrEqual(25 * HOUR);
    }
  });

  it('zeigt genau auf die nächste Mitternacht in Berlin', () => {
    for (const now of instants) {
      const ms = msUntilNextDay(now);
      const at = now.getTime() + ms;
      const today = dayKey(now);
      // Der Tageswechsel liegt in der letzten Sekunde vor `at`
      expect(dayKey(new Date(at)), now.toISOString()).not.toBe(dayKey(new Date(at - 1000)));
      expect(dayKey(new Date(at - 1000)), now.toISOString()).toBe(today);
      expect(dayKey(new Date(at)), now.toISOString()).toBe(addDays(today, 1));
      expect(berlinTime.format(new Date(at)), now.toISOString()).toBe('00:00:00');
    }
  });

  it('kennt kurze und lange Tage', () => {
    // 29.03.2026 hat 23 Stunden, 25.10.2026 hat 25 Stunden
    const spring = msUntilNextDay(new Date('2026-03-28T23:00:30Z'));
    expect(spring).toBeGreaterThan(23 * HOUR - 31_000);
    expect(spring).toBeLessThan(23 * HOUR - 29_000);
    const autumn = msUntilNextDay(new Date('2026-10-24T22:00:30Z'));
    expect(autumn).toBeGreaterThan(25 * HOUR - 31_000);
    expect(autumn).toBeLessThan(25 * HOUR - 29_000);
  });
});

describe('Seeds der Tages-Challenge', () => {
  const days = Array.from({ length: 400 }, (_, i) => addDays('2026-10-12', i));

  it('sind deterministisch', () => {
    for (const d of days.slice(0, 20)) {
      expect(dailyRunSeed(d)).toBe(dailyRunSeed(d));
      expect(dailySeasonSeed(d)).toBe(dailySeasonSeed(d));
    }
  });

  it('sind gültige, nichtnegative Ganzzahlen', () => {
    for (const d of days) {
      for (const s of [dailyRunSeed(d), dailySeasonSeed(d)]) {
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0x7fffffff);
      }
    }
  });

  it('unterscheiden sich von Tag zu Tag – und Würfe ≠ Saison', () => {
    expect(new Set(days.map(dailyRunSeed)).size).toBe(days.length);
    expect(new Set(days.map(dailySeasonSeed)).size).toBe(days.length);
    for (const d of days) expect(dailyRunSeed(d)).not.toBe(dailySeasonSeed(d));
  });
});

describe('Anzeige-Helfer', () => {
  it('formatDay / formatDayLong / weekdayName', () => {
    expect(formatDay('2026-10-12')).toBe('12.10.2026');
    expect(weekdayName('2026-10-12')).toBe('Montag');
    expect(weekdayName('2026-10-18')).toBe('Sonntag');
    expect(weekdayName('2027-01-01')).toBe('Freitag');
    expect(formatDayLong('2026-10-12')).toBe('Montag, 12.10.2026');
    expect(formatDayLong('2026-10-17')).toBe('Samstag, 17.10.2026');
  });

  it('formatCountdown', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5000)).toBe('00:00:00');
    expect(formatCountdown(1)).toBe('00:00:01');
    expect(formatCountdown(999)).toBe('00:00:01');
    expect(formatCountdown(1000)).toBe('00:00:01');
    expect(formatCountdown(5 * HOUR + 12 * 60_000 + 33_000)).toBe('05:12:33');
    expect(formatCountdown(25 * HOUR)).toBe('25:00:00');
  });
});

describe('buildDailyShareText', () => {
  const outcomes = (pattern: string): MatchOutcome[] => [...pattern] as MatchOutcome[];
  // 17 + 17 Spiele: 30 Siege, 2 Remis, 2 Niederlagen
  const hin = 'SSSSSUSSSSSSSNSSS';
  const rueck = 'SSSSSSSSUSSSSSSSN';

  const base: DailyShareInput = {
    day: '2026-10-12',
    number: 1,
    record: { w: 30, d: 2, l: 2 },
    points: 92,
    score: 812,
    position: 1,
    outcomes: outcomes(hin + rueck),
    url: 'https://pokemon-elf.example/taeglich',
  };

  it('hat genau das vereinbarte Format', () => {
    expect(buildDailyShareText(base)).toBe(
      [
        'Pokémon Elf · Tägliche Elf #1 (12.10.2026)',
        '30–2–2 · 92 Pkt · Score 812 · Platz 1',
        '🟩🟩🟩🟩🟩🟨🟩🟩🟩🟩🟩🟩🟩🟥🟩🟩🟩',
        '🟩🟩🟩🟩🟩🟩🟩🟩🟨🟩🟩🟩🟩🟩🟩🟩🟥',
        'https://pokemon-elf.example/taeglich',
      ].join('\n'),
    );
  });

  it('zwei Reihen mit je 17 Emojis in Spielreihenfolge', () => {
    const lines = buildDailyShareText(base).split('\n');
    expect(lines).toHaveLength(5);
    const rows = [lines[2], lines[3]].map((l) => Array.from(l));
    expect(rows[0]).toHaveLength(17);
    expect(rows[1]).toHaveLength(17);
    const back = { '🟩': 'S', '🟨': 'U', '🟥': 'N' } as Record<string, string>;
    expect(rows.flat().map((e) => back[e]).join('')).toBe(hin + rueck);
  });

  it('perfekte Saison bekommt den Pokal', () => {
    const text = buildDailyShareText({
      ...base,
      number: 15,
      day: '2026-10-26',
      record: { w: 34, d: 0, l: 0 },
      points: 102,
      score: 905,
      outcomes: outcomes('S'.repeat(34)),
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Pokémon Elf · Tägliche Elf #15 (26.10.2026)');
    expect(lines[1]).toBe('34–0–0 · 102 Pkt · Score 905 · Platz 1 🏆');
    expect(lines[2]).toBe('🟩'.repeat(17));
    expect(lines[3]).toBe('🟩'.repeat(17));
  });

  it('kein Pokal ohne perfekte Saison', () => {
    const text = buildDailyShareText({ ...base, record: { w: 33, d: 1, l: 0 }, position: 1 });
    expect(text.split('\n')[1]).toBe('33–1–0 · 92 Pkt · Score 812 · Platz 1');
    expect(text).not.toContain('🏆');
  });

  it('outcomeEmojis', () => {
    expect(outcomeEmojis(['S', 'U', 'N'])).toBe('🟩🟨🟥');
    expect(outcomeEmojis([])).toBe('');
  });
});

describe('Kalenderwoche (ISO 8601)', () => {
  it('Montag bis Sonntag, Jahreswechsel nach dem Donnerstag', async () => {
    const { weekKey } = await import('../src/lib/daily');
    expect(weekKey('2026-10-12')).toBe('W2026-42'); // Montag
    expect(weekKey('2026-10-18')).toBe('W2026-42'); // Sonntag
    expect(weekKey('2026-10-19')).toBe('W2026-43');
    expect(weekKey('2026-01-01')).toBe('W2026-01'); // Donnerstag → KW 1
    expect(weekKey('2027-01-01')).toBe('W2026-53'); // Freitag → letzte KW des Vorjahrs
    expect(weekKey('2024-12-30')).toBe('W2025-01'); // Montag → KW 1 des Folgejahrs
  });
});
