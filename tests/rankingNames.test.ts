/** Ligagegner mit Namen aus den Online-Ranglisten (src/lib/rankingNames.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUB_NAMES } from '../src/config/season';
import type { LeaderboardRow } from '../src/lib/api/contract';
import { namesFromRows, opponentNames, rankingNames, refreshRankingNames } from '../src/lib/rankingNames';

const row = (teamName: string, player = 'Ash', me = false) => ({ teamName, player, me }) as LeaderboardRow;

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('Ranglisten-Namen', () => {
  it('namesFromRows: Teamname, sonst Spieler; ohne eigene Zeilen und Doppelte; gekürzt', () => {
    const long = 'X'.repeat(40);
    expect(namesFromRows([row('Team Rocket'), row('team rocket', 'Jessie'), row('', 'Misty'), row('Mein Team', 'Ich', true), row(long)])).toEqual([
      'Team Rocket',
      'Misty',
      'X'.repeat(28),
    ]);
  });

  it('opponentNames: deterministisch, ohne Ausschlüsse, Rest mit Vereinsnamen', () => {
    const pool = ['A', 'B', 'C', 'Meine Elf'];
    const a = opponentNames(6, 42, pool, ['meine elf']);
    expect(a).toEqual(opponentNames(6, 42, pool, ['meine elf']));
    expect(a).toHaveLength(6);
    expect(new Set(a).size).toBe(6);
    expect(a.slice(0, 3).sort()).toEqual(['A', 'B', 'C']);
    expect(a.slice(3).every((n) => CLUB_NAMES.includes(n))).toBe(true);
    expect(a).not.toContain('Meine Elf');
    // Ohne Pool: nur Vereinsnamen
    expect(opponentNames(17, 1, []).every((n) => CLUB_NAMES.includes(n))).toBe(true);
  });

  it('refreshRankingNames: lädt 34–0 und 151, speichert und nutzt den Cache 6 Stunden lang', async () => {
    expect(rankingNames()).toEqual([]);
    const fetchRows = vi.fn(async (ch: 'c340' | 'c151') => (ch === 'c340' ? [row('Rot'), row('Blau')] : [row('Blau'), row('Gelb')]));
    expect(await refreshRankingNames(fetchRows, 1000)).toEqual(['Rot', 'Blau', 'Gelb']);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(rankingNames()).toEqual(['Rot', 'Blau', 'Gelb']);
    await refreshRankingNames(fetchRows, 1000 + 60_000);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    // Nach 6 Stunden neu; ein Fehler behält den alten Stand
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await refreshRankingNames(failing, 1000 + 7 * 3600_000)).toEqual(['Rot', 'Blau', 'Gelb']);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
