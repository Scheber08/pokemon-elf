/** Vereinswappen: Prüfen gespeicherter bzw. gesendeter Wappen, Wappentier. */
import { describe, expect, it } from 'vitest';
import { cleanCrest, crestPokemon, DEFAULT_CREST, randomCrest } from '../src/lib/crest';

describe('Wappen', () => {
  it('cleanCrest: nur bekannte Formen, Muster, Farben und Symbole', () => {
    expect(cleanCrest(DEFAULT_CREST)).toEqual(DEFAULT_CREST);
    expect(cleanCrest({ ...DEFAULT_CREST, symbol: 'p:25' })).toEqual({ ...DEFAULT_CREST, symbol: 'p:25' });
    expect(cleanCrest({ ...DEFAULT_CREST, shape: 'star' })).toBeNull();
    expect(cleanCrest({ ...DEFAULT_CREST, primary: 'gold' })).toBeNull();
    expect(cleanCrest({ ...DEFAULT_CREST, symbol: 'p:abc' })).toBeNull();
    expect(cleanCrest({ ...DEFAULT_CREST, symbol: 'skull' })).toBeNull();
    expect(cleanCrest('shield')).toBeNull();
  });

  it('Wappentier aus „p:<id>“', () => {
    expect(crestPokemon('p:25')).toBe(25);
    expect(crestPokemon('p:0')).toBeNull();
    expect(crestPokemon('ball')).toBeNull();
  });

  it('Zufallswappen: immer gültig, zwei verschiedene Farben', () => {
    let x = 0.13;
    const rnd = () => (x = (x * 9301 + 0.49297) % 1);
    for (let i = 0; i < 50; i++) {
      const c = randomCrest(rnd, [25, 6]);
      expect(cleanCrest(c)).toEqual(c);
      expect(c.primary).not.toBe(c.secondary);
    }
  });
});
