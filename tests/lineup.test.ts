import { describe, expect, it } from 'vitest';
import { FORMATION_IDS, FORMATIONS } from '../src/config/formations';
import { remapFormation } from '../src/lib/formation';
import { decodeLineup, encodeLineup, type SharedLineup } from '../src/lib/urlState';

const DEFAULT: SharedLineup = {
  formation: '4-2-3-1',
  slots: [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135],
  ss: 59,
  region: 1,
  legends: true,
  ssEnabled: true,
  sprite: 'retro',
  teamName: 'Rot-Weiß Alabastia ⚽',
};

describe('URL-Kodierung', () => {
  it('Roundtrip: Formation, 11 IDs, SS, Einstellungen und Teamname', () => {
    const code = encodeLineup(DEFAULT);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLineup(code)).toEqual(DEFAULT);
  });

  it('ist kurz', () => {
    expect(encodeLineup({ ...DEFAULT, teamName: '' }).length).toBeLessThanOrEqual(36);
  });

  it('leere Slots und hohe Nummern (bis 1025) überleben', () => {
    const state: SharedLineup = { ...DEFAULT, slots: [1025, null, 1, null, 999, null, null, null, null, null, 151], ss: null };
    expect(decodeLineup(encodeLineup(state))).toEqual(state);
  });

  it('kaputte Codes liefern null', () => {
    expect(decodeLineup('###')).toBeNull();
    expect(decodeLineup('AAAA')).toBeNull();
  });
});

describe('Formationswechsel', () => {
  const slots = [143, 9, 68, 76, 130, 65, 112, 3, 25, 6, 135];

  it('verliert keine Spieler und erzeugt keine Duplikate', () => {
    for (const from of FORMATION_IDS) {
      for (const to of FORMATION_IDS) {
        const next = remapFormation(from, to, slots);
        expect(next).toHaveLength(FORMATIONS[to].slots.length);
        expect([...next].sort()).toEqual([...slots].sort());
      }
    }
  });

  it('gleiche Positionen bleiben besetzt (TW bleibt TW)', () => {
    const next = remapFormation('4-3-3', '3-5-2', slots);
    expect(next[0]).toBe(143);
  });

  it('Außenverteidiger rücken auf die Schienen', () => {
    const next = remapFormation('4-3-3', '5-3-2', slots);
    const lwb = FORMATIONS['5-3-2'].slots.findIndex((s) => s.pos === 'LWB');
    const rwb = FORMATIONS['5-3-2'].slots.findIndex((s) => s.pos === 'RWB');
    expect(next[lwb]).toBe(9);
    expect(next[rwb]).toBe(130);
  });
});
