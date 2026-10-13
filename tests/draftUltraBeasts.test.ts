/**
 * Draft-Engine: Ultrabestien als eigene Kategorie – im Pool an/aus und mit eigenem Limit pro
 * Team (unabhängig vom Legendären-Limit). Ältere Ligen ohne die Felder behalten sie im Pool.
 */
import { describe, expect, it } from 'vitest';
import { isUltraBeast, ULTRA_BEAST_IDS } from '../src/config/categories';
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
  kindOf,
  limitKindOf,
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
import { ALL, byName } from './helpers';

const SCALE = buildScale(ALL, 'all');

function lobby(settings: DraftSettingsPatch, cpus = 1, seed: number | string = 42): DraftState {
  let s = createDraft({
    code: 'ABC234',
    seed,
    settings: { order: 'host', ...settings },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  for (let i = 1; i <= cpus; i++) s = addCpuTeam(s, 'dev-h', `cpu${i}`);
  return s;
}

const start = (s: DraftState) => startDraft(s, 'dev-h', 0, ALL);

function messageOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DraftError) return err.message;
    throw err;
  }
}

describe('Ultrabestien', () => {
  it('elf Ultrabestien, keine davon legendär – eigene Kategorie', () => {
    const ubs = ALL.filter(isUltraBeast);
    expect(ubs).toHaveLength(11);
    expect(ubs.map((p) => p.id)).toEqual([...ULTRA_BEAST_IDS]);
    expect(ubs.every((p) => !p.leg && !p.myth && limitKindOf(p) === 'ub')).toBe(true);
    expect(limitKindOf(byName('Necrozma'))).toBe('legend');
    expect(limitKindOf(byName('Pikachu'))).toBeNull();
  });

  it('im Pool an/aus – Standard und ältere Ligen: an', () => {
    expect(DEFAULT_DRAFT_SETTINGS.ultraBeasts).toBe(true);
    const gen7 = { ...DEFAULT_DRAFT_SETTINGS, gens: [7] };
    expect(poolOf(gen7, ALL).filter(isUltraBeast)).toHaveLength(11);
    expect(poolOf({ ...gen7, ultraBeasts: false }, ALL).some(isUltraBeast)).toBe(false);
    const { ultraBeasts: _u, maxUltraBeasts: _m, ...old } = gen7;
    expect(upgradeSettings(old)).toMatchObject({ ultraBeasts: true, maxUltraBeasts: null });
    expect(poolOf(old as never, ALL).filter(isUltraBeast)).toHaveLength(11);
  });

  it('Limit prüfen: 1–3 oder unbegrenzt', () => {
    expect(normalizeSettings({ maxUltraBeasts: 2 }, DEFAULT_DRAFT_SETTINGS, ALL).maxUltraBeasts).toBe(2);
    expect(normalizeSettings({ maxUltraBeasts: null }, DEFAULT_DRAFT_SETTINGS, ALL).maxUltraBeasts).toBeNull();
    for (const bad of [0, 4, '1']) {
      expect(messageOf(() => normalizeSettings({ maxUltraBeasts: bad as never }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe(
        'Ungültiges Ultrabestien-Limit',
      );
    }
    expect(messageOf(() => normalizeSettings({ ultraBeasts: 'ja' as never }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe('Ungültige Einstellung');
  });

  it('Kapazität: Ultrabestien zählen nur, soweit das Limit sie aufnimmt', () => {
    const s = { ...DEFAULT_DRAFT_SETTINGS, gens: [7], maxUltraBeasts: 1 };
    const pool = poolOf(s, ALL).length;
    expect(poolPickCapacity(s, 2, ALL)).toBe(pool - 9);
    expect(poolPickCapacity({ ...s, maxUltraBeasts: null }, 2, ALL)).toBe(pool);
    // Beide Limits zusammen
    const both = { ...s, legendary: true, mythical: true, maxLegends: 1 };
    const legends = poolOf(both, ALL).filter((p) => p.leg || p.myth).length;
    expect(poolPickCapacity(both, 2, ALL)).toBe(poolOf(both, ALL).length - 9 - (legends - 2));
  });

  it('Pick abgelehnt, sobald das Limit erreicht ist – unabhängig vom Legendären-Limit', () => {
    let s = start(lobby({ gens: [7], legendary: true, maxLegends: 1, maxUltraBeasts: 1, roll: 'off' }));
    expect(currentTeam(s)!.id).toBe('h');
    s = applyPick(s, 'h', byName('Anego').id, 0, false, 1, ALL);
    expect(kindOf(s.teams[0], 'ub', ALL)).toBe(1);
    const cpu = currentTeam(s)!;
    s = applyPick(s, cpu.id, byName('Masskito').id, 0, false, 2, ALL);
    s = applyPick(s, cpu.id, byName('Bauz').id, 1, false, 3, ALL);
    expect(currentTeam(s)!.id).toBe('h');
    const schabelle = byName('Schabelle');
    expect(pickAllowed(s, 'h', schabelle, ALL)).toBe('ub_limit');
    expect(pickError(s, 'h', schabelle.id, 1, ALL)).toBe('Höchstens eine Ultrabestie pro Team');
    // Ein Legendäres geht noch
    expect(pickAllowed(s, 'h', byName('Solgaleo'), ALL)).toBeNull();
    expect(allowedPicks(s, 'h', ALL).some(isUltraBeast)).toBe(false);
    const c = autoPickChoice(s, 'h', ALL, SCALE, false);
    expect(isUltraBeast(ALL.find((p) => p.id === c.pokemonId)!)).toBe(false);
  });

  it('Mehrzahl in der Meldung', () => {
    let s = start(lobby({ gens: [7], maxUltraBeasts: 2, roll: 'off' }));
    s = applyPick(s, 'h', byName('Anego').id, 0, false, 1, ALL);
    s = applyPick(s, 'cpu1', byName('Bauz').id, 0, false, 2, ALL);
    s = applyPick(s, 'cpu1', byName('Arboretoss').id, 1, false, 3, ALL);
    s = applyPick(s, 'h', byName('Masskito').id, 1, false, 4, ALL);
    // Snake: h ist gleich wieder dran
    expect(pickError(s, 'h', byName('Kaguron').id, 2, ALL)).toBe('Höchstens 2 Ultrabestien pro Team');
  });

  it('komplette Drafts in allen Zufallsmodi: kein Team über dem Limit', () => {
    for (const roll of ['off', 'pick', 'round'] as const) {
      for (const seed of [1, 'beef']) {
        let s = start(lobby({ gens: [7], maxUltraBeasts: 1, maxTeams: 4, roll }, 3, seed));
        while (s.phase === 'drafting') {
          const cur = currentTeam(s)!;
          const allowed = allowedPicks(s, cur.id, ALL);
          // Ultrabestien zuerst, wenn möglich – das Limit muss greifen
          const p = allowed.find(isUltraBeast) ?? autoPickChoice(s, cur.id, ALL, SCALE, false);
          const id = 'pokemonId' in p ? p.pokemonId : p.id;
          const slot = freeSlots(cur, s.settings)[0];
          expect(pickError(s, cur.id, id, slot, ALL)).toBeNull();
          s = applyPick(s, cur.id, id, slot, false, s.pickIndex, ALL);
        }
        for (const t of s.teams) expect(kindOf(t, 'ub', ALL)).toBe(1);
      }
    }
  });
});
