/**
 * Draft-Engine: Formen und Megas im Online-Draft – im Pool an/aus, Mega-Limit pro Team,
 * legendäre Megas zählen für beide Limits. Ältere Ligen (ohne die Felder) bleiben ohne Formen.
 */
import { describe, expect, it } from 'vitest';
import { isMega } from '../src/config/categories';
import { DEFAULT_DRAFT_SETTINGS, type DraftSettingsPatch } from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  allowedPicks,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  DraftError,
  freeSlots,
  hasKind,
  kindOf,
  limitKindsOf,
  normalizeSettings,
  pickAllowed,
  pickError,
  poolOf,
  poolPickCapacity,
  startDraft,
  upgradeSettings,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { ALL, FORMS } from './helpers';

const LIST = [...ALL, ...FORMS];
const SCALE = buildScale(ALL, 'all');
const form = (en: string) => FORMS.find((p) => p.en === en)!;
const mon = (en: string) => ALL.find((p) => p.en === en)!;

function lobby(settings: DraftSettingsPatch, cpus = 1, seed: number | string = 42): DraftState {
  let s = createDraft({
    code: 'ABC234',
    seed,
    settings: { order: 'host', ...settings },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list: LIST,
  });
  for (let i = 1; i <= cpus; i++) s = addCpuTeam(s, 'dev-h', `cpu${i}`);
  return s;
}

const start = (s: DraftState) => startDraft(s, 'dev-h', 0, LIST);

function messageOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DraftError) return err.message;
    throw err;
  }
}

describe('Formen und Megas im Online-Draft', () => {
  const gen1 = { ...DEFAULT_DRAFT_SETTINGS, gens: [1] };

  it('Standard und ältere Ligen: ohne Formen – der Pool ist genau der bisherige', () => {
    expect(poolOf(gen1, LIST)).toEqual(poolOf(gen1, ALL));
    const { forms: _f, megas: _m, maxMegas: _x, ...old } = gen1;
    expect(upgradeSettings(old)).toMatchObject({ forms: false, megas: false });
    expect(poolOf(old as never, LIST).some((p) => p.form)).toBe(false);
  });

  it('Formen bzw. Megas einzeln zuschaltbar, nach Pokédex-Nummer sortiert', () => {
    // Regionalformen haben die Generation ihrer Region (Alola-Raichu: 7)
    const withForms = poolOf({ ...gen1, gens: [1, 7], forms: true }, LIST);
    expect(withForms.some((p) => p.en === 'Alolan Raichu')).toBe(true);
    expect(withForms.some((p) => p.form === 'other' || p.form === 'regional')).toBe(true);
    expect(withForms.some(isMega)).toBe(false);
    const withMegas = poolOf({ ...gen1, megas: true }, LIST);
    expect(withMegas.some(isMega)).toBe(true);
    expect(withMegas.some((p) => p.form && !isMega(p))).toBe(false);
    // Glurak, dann seine Megas
    const i = withMegas.findIndex((p) => p.id === 6);
    expect(withMegas.slice(i, i + 3).map((p) => p.en)).toEqual(['Charizard', 'Mega Charizard X', 'Mega Charizard Y']);
    // Legendäre Megas nur mit Legendären
    expect(withMegas.some((p) => p.en === 'Mega Mewtwo X')).toBe(false);
    expect(poolOf({ ...gen1, megas: true, legendary: true }, LIST).some((p) => p.en === 'Mega Mewtwo X')).toBe(true);
  });

  it('legendäres Mega gehört zu beiden Kategorien', () => {
    expect(limitKindsOf(form('Mega Mewtwo X'))).toEqual(['legend', 'mega']);
    expect(limitKindsOf(form('Mega Charizard X'))).toEqual(['mega']);
    expect(limitKindsOf(form('Alolan Raichu'))).toEqual([]);
    expect(hasKind(form('Primal Kyogre'), 'mega')).toBe(true);
  });

  it('Mega-Limit prüfen: 1–3 oder unbegrenzt', () => {
    expect(normalizeSettings({ megas: true, maxMegas: 3 }, gen1, LIST)).toMatchObject({ megas: true, maxMegas: 3 });
    expect(normalizeSettings({ maxMegas: null }, gen1, LIST).maxMegas).toBeNull();
    expect(messageOf(() => normalizeSettings({ maxMegas: 5 }, gen1, LIST))).toBe('Ungültiges Mega-Limit');
    expect(messageOf(() => normalizeSettings({ forms: 1 as never }, gen1, LIST))).toBe('Ungültige Einstellung');
  });

  it('Kapazität: Megas zählen nur, soweit das Limit sie aufnimmt', () => {
    const s = { ...gen1, megas: true, maxMegas: 1 };
    const pool = poolOf(s, LIST);
    const megas = pool.filter(isMega).length;
    expect(poolPickCapacity(s, 2, LIST)).toBe(pool.length - (megas - 2));
    expect(poolPickCapacity({ ...s, maxMegas: null }, 2, LIST)).toBe(pool.length);
  });

  it('Pick abgelehnt, sobald das Mega-Limit erreicht ist', () => {
    let s = start(lobby({ gens: [1], megas: true, maxMegas: 1, roll: 'off' }));
    s = applyPick(s, 'h', form('Mega Charizard X').id, 0, false, 1, LIST);
    expect(kindOf(s.teams[0], 'mega', LIST)).toBe(1);
    s = applyPick(s, 'cpu1', form('Mega Venusaur').id, 0, false, 2, LIST);
    s = applyPick(s, 'cpu1', mon('Pikachu').id, 1, false, 3, LIST);
    const y = form('Mega Charizard Y');
    expect(pickAllowed(s, 'h', y, LIST)).toBe('mega_limit');
    expect(pickError(s, 'h', y.id, 1, LIST)).toBe('Höchstens ein Mega pro Team');
    expect(pickAllowed(s, 'h', mon('Charizard'), LIST)).toBeNull();
    expect(allowedPicks(s, 'h', LIST).some(isMega)).toBe(false);
    const c = autoPickChoice(s, 'h', LIST, SCALE, false);
    expect(isMega(LIST.find((p) => p.id === c.pokemonId)!)).toBe(false);
  });

  it('komplette Drafts mit Formen und Megas in allen Zufallsmodi: kein Team über dem Limit', () => {
    for (const roll of ['off', 'pick', 'round'] as const) {
      let s = start(lobby({ gens: [1, 3], forms: true, megas: true, maxMegas: 2, legendary: true, maxLegends: 1, maxTeams: 4, roll }, 3, roll));
      while (s.phase === 'drafting') {
        const cur = currentTeam(s)!;
        const allowed = allowedPicks(s, cur.id, LIST);
        const p = allowed.find(isMega) ?? LIST.find((x) => x.id === autoPickChoice(s, cur.id, LIST, SCALE, cur.cpu).pokemonId)!;
        const slot = freeSlots(cur, s.settings)[0];
        expect(pickError(s, cur.id, p.id, slot, LIST)).toBeNull();
        s = applyPick(s, cur.id, p.id, slot, false, s.pickIndex, LIST);
      }
      for (const t of s.teams) {
        expect(kindOf(t, 'mega', LIST)).toBe(2);
        expect(kindOf(t, 'legend', LIST)).toBeLessThanOrEqual(1);
      }
    }
  });
});
