/** Datenschutz: DE/EN gleich viele Punkte zur Online-Rangliste; Trainer/Shop und neuere lokale Daten genannt. */
import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de/info';
import en from '../src/i18n/en/info';

describe('Datenschutz-Text', () => {
  it('gleich viele Punkte, Trainer und Shop-Käufe beim Server, neuere lokale Daten', () => {
    expect(en.privacy.leaderboardItems).toHaveLength(de.privacy.leaderboardItems.length);
    expect(de.privacy.leaderboardItems.some((x) => x.includes('Trainer') && x.includes('Shop'))).toBe(true);
    expect(en.privacy.leaderboardItems.some((x) => x.includes('trainer') && x.includes('shop'))).toBe(true);
    for (const s of ['Meine Teams', 'Täglichen Elf', 'Manager-Saison', 'Online-Rangliste']) expect(de.privacy.local).toContain(s);
    for (const s of ['My teams', 'Daily XI', 'manager-season', 'online leaderboard']) expect(en.privacy.local).toContain(s);
  });
});
