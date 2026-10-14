/** Vereinswappen: Prüfen gespeicherter bzw. gesendeter Wappen, Wappentier. */
import { describe, expect, it } from 'vitest';
import { cleanCrest, crestPokemon, DEFAULT_CREST } from '../src/lib/crest';

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
});
