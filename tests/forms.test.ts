/**
 * Formen (public/data/forms.json, per `npm run data:forms`): Megas, Regional- und Sonderformen.
 * Sie stehen neben den 1.025 Pokémon – pokemon.json bleibt unverändert.
 */
import { describe, expect, it } from 'vitest';
import { byDex, dexId, isMega } from '../src/config/categories';
import { buildScale, positionFit } from '../src/lib/fit';
import { decodeLineup, encodeLineup } from '../src/lib/urlState';
import { ALL, FORMS } from './helpers';

describe('Formen', () => {
  const byId = new Map(ALL.map((p) => [p.id, p]));

  it('eigene Nummern ab 10001, jede gehört zu einer Art, keine doppelt', () => {
    expect(FORMS.length).toBeGreaterThan(150);
    expect(new Set(FORMS.map((p) => p.id)).size).toBe(FORMS.length);
    for (const f of FORMS) {
      expect(f.id).toBeGreaterThan(10000);
      expect(byId.has(f.base!)).toBe(true);
      expect(['mega', 'regional', 'other']).toContain(f.form);
      expect(f.de && f.en).toBeTruthy();
      expect(f.s).toBeGreaterThan(0);
      expect(f.gen).toBeGreaterThanOrEqual(1);
      expect(f.gen).toBeLessThanOrEqual(9);
    }
  });

  it('bekannte Formen mit Art, Werten und Namen', () => {
    const glurakX = FORMS.find((p) => p.en === 'Mega Charizard X')!;
    expect(glurakX).toMatchObject({ de: 'Mega-Glurak X', base: 6, form: 'mega', gen: 1, types: ['fire', 'dragon'] });
    expect(dexId(glurakX)).toBe(6);
    expect(isMega(glurakX)).toBe(true);
    // Proto-Formen zählen als Mega
    expect(FORMS.find((p) => p.en === 'Primal Kyogre')).toMatchObject({ form: 'mega', leg: 1 });
    // Regionalform: Generation der Region
    expect(FORMS.find((p) => p.en === 'Alolan Raichu')).toMatchObject({ form: 'regional', gen: 7, base: 26 });
    expect(FORMS.find((p) => p.en === 'Heat Rotom')).toMatchObject({ form: 'other', base: 479 });
    // Reine Optik (Kappen-Pikachu, Gigadynamax) ist nicht dabei
    expect(FORMS.some((p) => /cap|Gigantamax/i.test(p.en))).toBe(false);
  });

  it('Sortierung: Formen direkt hinter ihrer Art', () => {
    const sorted = [...ALL, ...FORMS].sort(byDex);
    const i = sorted.findIndex((p) => p.id === 6);
    expect(sorted.slice(i, i + 3).map((p) => p.en)).toEqual(['Charizard', 'Mega Charizard X', 'Mega Charizard Y']);
  });

  it('Bewertung gegen die Skala der 1.025 Pokémon (die Skala selbst bleibt gleich)', () => {
    const scale = buildScale(ALL, 'all');
    const mewtuY = FORMS.find((p) => p.en === 'Mega Mewtwo Y')!;
    const mewtu = byId.get(150)!;
    expect(positionFit(mewtuY, 'OM', scale)).toBeGreaterThanOrEqual(positionFit(mewtu, 'OM', scale));
  });

  it('Teilen-Link: Formen bleiben erhalten, wenn die Prüfung sie kennt', () => {
    const all = new Map([...ALL, ...FORMS].map((p) => [p.id, p]));
    const mega = FORMS.find(isMega)!.id;
    const code = encodeLineup({
      formation: '4-3-3',
      slots: [mega, 25, null, null, null, null, null, null, null, null, null],
      ss: null,
      region: 0,
      legends: false,
      ssEnabled: false,
      sprite: 'pixel',
      teamName: '',
    });
    expect(decodeLineup(code, (id) => all.has(id))!.slots.slice(0, 2)).toEqual([mega, 25]);
    // Alte Prüfung (bis 1025): die Form wird ein leerer Platz
    expect(decodeLineup(code)!.slots.slice(0, 2)).toEqual([null, 25]);
  });
});
