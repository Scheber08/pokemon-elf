/** Trikotfarben: Palette, Prüfen, Farben im Spiel (Gast weicht bei gleicher Farbe aus). */
import { describe, expect, it } from 'vitest';
import { cleanCheer, CHEER_MAX } from '../src/lib/cheer';
import { cleanKit, DEFAULT_KIT, KIT_COLORS, matchKits } from '../src/lib/kits';

describe('Trikotfarben', () => {
  it('Palette ohne doppelte IDs, Standard ist Gelb/Weiß', () => {
    expect(new Set(KIT_COLORS.map((c) => c.id)).size).toBe(KIT_COLORS.length);
    expect(DEFAULT_KIT).toEqual({ home: 'yellow', away: 'white' });
  });

  it('cleanKit: nur bekannte Farben', () => {
    expect(cleanKit({ home: 'red', away: 'blue' })).toEqual({ home: 'red', away: 'blue' });
    expect(cleanKit({ home: 'red', away: 'gold' })).toBeNull();
    expect(cleanKit(null)).toBeNull();
    expect(cleanKit(['red', 'blue'])).toBeNull();
  });

  it('ohne Wahl wie bisher Gelb gegen Weiß; Gast in Heimfarbe, bei gleicher Farbe in Auswärtsfarbe', () => {
    expect(matchKits(null, null).map((c) => c.id)).toEqual(['yellow', 'white']);
    expect(matchKits({ home: 'red', away: 'white' }, { home: 'blue', away: 'white' }).map((c) => c.id)).toEqual(['red', 'blue']);
    expect(matchKits({ home: 'red', away: 'white' }, { home: 'red', away: 'black' }).map((c) => c.id)).toEqual(['red', 'black']);
    // Auswärtsfarbe gleich der Heimfarbe des Gegners: Ausweichfarbe, nie zweimal dieselbe
    const [h, a] = matchKits({ home: 'white', away: 'red' }, { home: 'white', away: 'white' });
    expect(h.id).toBe('white');
    expect(a.id).not.toBe('white');
  });
});

describe('Torjubel', () => {
  it('säubert: nur Text, Leerraum zusammengefasst, höchstens CHEER_MAX Zeichen', () => {
    expect(cleanCheer('  Wir  sind\n die Elf!  ')).toBe('Wir sind die Elf!');
    expect(cleanCheer(42)).toBe('');
    expect([...cleanCheer('⚽'.repeat(60))]).toHaveLength(CHEER_MAX);
  });
});
