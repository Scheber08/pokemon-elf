/**
 * Draft-Engine: neue Liga-Einstellungen des Online-Drafts – Generationen und Typen als Pool,
 * Legendäre/Mysteriöse getrennt, Legendären-Limit pro Team, feste Reihenfolge statt Snake,
 * Zufallsmodus (Wurf pro Pick bzw. pro Runde) mit Rerolls – dazu die Umstellung älterer
 * Ligen (region/legends) und viele komplett simulierte Drafts: Er bleibt nie hängen, und
 * jeder Auto-Pick besteht pickError.
 */
import { describe, expect, it } from 'vitest';
import { TYPE_KEYS } from '../src/config/pokemonTypes';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_ALL_GENS,
  LOBBY_REGION_MANY,
  type DraftRoll,
  type DraftSettings,
  type DraftSettingsPatch,
} from '../src/lib/api/draftContract';
import {
  addCpuTeam,
  allowedPicks,
  applyPick,
  applyReroll,
  autoPickChoice,
  canReroll,
  createDraft,
  currentTeam,
  DRAFT_SS_SLOT,
  DraftError,
  draftedIds,
  effectiveRoll,
  freeSlots,
  isLegend,
  joinDraft,
  legendsOf,
  lobbyRegionOf,
  matchesRoll,
  maxTeamsForPool,
  normalizeSettings,
  pickAllowed,
  pickError,
  poolHasLegends,
  poolOf,
  poolPickCapacity,
  rerollsLeft,
  rerollUsable,
  rounds,
  sameSettingValue,
  setOrder,
  snapshotOf,
  startDraft,
  teamIndexForPick,
  totalPicks,
  updateSettings,
  upgradeSettings,
  upgradeState,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import type { Pokemon, TypeKey } from '../src/types';
import { ALL, byName, mon } from './helpers';

const SCALE = buildScale(ALL, 'all');
const ALL_TYPES = [...TYPE_KEYS];

/** Fehlercode einer Engine-Funktion (null = kein Fehler) */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DraftError) return err.code;
    throw err;
  }
}

function messageOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof DraftError) return err.message;
    throw err;
  }
}

/**
 * Lobby: Host „h" (Mensch), dazu weitere Menschen t1… und CPU-Teams cpu1…; Reihenfolge wie
 * angelegt (order 'host'), wenn nichts anderes gesagt ist.
 */
function lobby(
  settings: DraftSettingsPatch,
  { humans = 1, cpus = 1, seed = 42 as number | string, list = ALL }: { humans?: number; cpus?: number; seed?: number | string; list?: Pokemon[] } = {},
): DraftState {
  let s = createDraft({
    code: 'ABC234',
    seed,
    settings: { order: 'host', ...settings },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host FC', formation: '4-3-3' },
    now: 0,
    list,
  });
  for (let i = 1; i < humans; i++) {
    s = joinDraft(s, { teamId: `t${i}`, deviceId: `dev-${i}`, name: `Team ${i}`, formation: '4-4-2' });
  }
  for (let i = 1; i <= cpus; i++) s = addCpuTeam(s, 'dev-h', `cpu${i}`);
  return s;
}

const start = (s: DraftState, list = ALL) => startDraft(s, 'dev-h', 0, list);

/** Nächster Pick wie auf dem Server (CPU mit Zufall, Menschen ohne). */
function autoStep(s: DraftState, list = ALL): DraftState {
  const cur = currentTeam(s)!;
  const c = autoPickChoice(s, cur.id, list, SCALE, cur.cpu);
  return applyPick(s, cur.id, c.pokemonId, c.slot, true, s.pickIndex, list);
}

/** Freie, für das Team nicht gesperrte Pool-Pokémon je Kombination – unabhängig von der Engine gezählt. */
function pickableCombos(s: DraftState, teamId: string, list = ALL): DraftRoll[] {
  const team = s.teams.find((t) => t.id === teamId)!;
  const taken = draftedIds(s);
  const max = s.settings.maxLegends;
  const atLimit = max != null && legendsOf(team, list) >= max;
  const out: DraftRoll[] = [];
  for (const gen of s.settings.gens) {
    for (const type of s.settings.types) {
      const ok = poolOf(s.settings, list).some(
        (p) => !taken.has(p.id) && p.gen === gen && p.types.includes(type) && !(atLimit && isLegend(p)),
      );
      if (ok) out.push({ gen, type });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Einstellungen

describe('Einstellungen: neue Felder', () => {
  it('Standard = bisheriges Verhalten: Gen 1, alle Typen, ohne Legendäre, Snake, ohne Zufall', () => {
    expect(DEFAULT_DRAFT_SETTINGS).toMatchObject({
      gens: [1],
      types: ALL_TYPES,
      legendary: false,
      mythical: false,
      maxLegends: null,
      roll: 'off',
      rerolls: { type: 1, region: 1 },
      snake: true,
    });
    expect(DEFAULT_DRAFT_SETTINGS).not.toHaveProperty('region');
    expect(DEFAULT_DRAFT_SETTINGS).not.toHaveProperty('legends');
    const legacyPool = ALL.filter((p) => p.gen === 1 && !p.leg && !p.myth);
    expect(poolOf(DEFAULT_DRAFT_SETTINGS, ALL)).toEqual(legacyPool.sort((a, b) => a.id - b.id));
  });

  it('prüft und vereinheitlicht jedes neue Feld', () => {
    const base = DEFAULT_DRAFT_SETTINGS;
    const norm = (p: DraftSettingsPatch) => normalizeSettings({ maxTeams: 2, ...p }, base, ALL);
    expect(norm({ gens: [3, 1, 1, 2] }).gens).toEqual([1, 2, 3]);
    expect(norm({ types: ['water', 'fire', 'water'] }).types).toEqual(['fire', 'water']);
    expect(norm({ legendary: true, mythical: false })).toMatchObject({ legendary: true, mythical: false });
    for (const maxLegends of [null, 1, 2, 3]) expect(norm({ maxLegends }).maxLegends).toBe(maxLegends);
    for (const roll of ['off', 'pick', 'round'] as const) expect(norm({ roll }).roll).toBe(roll);
    expect(norm({ rerolls: { type: 3, region: 0 } }).rerolls).toEqual({ type: 3, region: 0 });
    // Teilweise: die andere Art bleibt
    expect(norm({ rerolls: { type: 2 } as DraftSettings['rerolls'] }).rerolls).toEqual({ type: 2, region: 1 });
    expect(norm({ snake: false }).snake).toBe(false);

    const bad: [DraftSettingsPatch, RegExp][] = [
      [{ gens: [] }, /Mindestens eine Generation/],
      [{ gens: [0] }, /Ungültige Generationen/],
      [{ gens: [10] }, /Ungültige Generationen/],
      [{ gens: ['1'] as never }, /Ungültige Generationen/],
      [{ gens: 1 as never }, /Ungültige Generationen/],
      [{ gens: [1.5] }, /Ungültige Generationen/],
      [{ types: [] }, /Mindestens ein Typ/],
      [{ types: ['laser'] as never }, /Ungültige Typen/],
      [{ types: 'fire' as never }, /Ungültige Typen/],
      [{ maxLegends: 0 }, /Legendären-Limit/],
      [{ maxLegends: 4 }, /Legendären-Limit/],
      [{ maxLegends: '1' as never }, /Legendären-Limit/],
      [{ roll: 'always' as never }, /Zufallsmodus/],
      [{ rerolls: { type: 4, region: 0 } }, /Rerolls/],
      [{ rerolls: { type: 1, region: -1 } }, /Rerolls/],
      [{ rerolls: { type: 1.5, region: 0 } }, /Rerolls/],
      [{ rerolls: 2 as never }, /Rerolls/],
      [{ legendary: 'ja' as never }, /Ungültige Einstellung/],
      [{ snake: 1 as never }, /Ungültige Einstellung/],
    ];
    for (const [patch, msg] of bad) {
      let err: unknown = null;
      try {
        norm(patch);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(patch)).toBeInstanceOf(DraftError);
      expect((err as DraftError).code).toBe('bad_settings');
      expect((err as DraftError).message).toMatch(msg);
    }
    // Die Basis bleibt unberührt
    expect(base.gens).toEqual([1]);
    expect(base.types).toEqual(ALL_TYPES);
  });

  it('Pool zu klein (Gen 1 hat keine Unlicht-Pokémon) → pool_too_small', () => {
    expect(codeOf(() => normalizeSettings({ types: ['dark'] }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe('pool_too_small');
    expect(messageOf(() => normalizeSettings({ types: ['dark'] }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe(
      'Der Pool reicht nur für 0 Teams à 11 Pokémon',
    );
    // Auch über updateSettings in der Lobby
    const s = lobby({});
    expect(codeOf(() => updateSettings(s, 'dev-h', { gens: [6], types: ['ice'] }, ALL))).toBe('pool_too_small');
    expect(updateSettings(s, 'dev-h', { gens: [1, 2], types: ['water'], maxTeams: 4 }, ALL).settings).toMatchObject({
      gens: [1, 2],
      types: ['water'],
    });
  });

  it('Legendären-Limit zählt bei der Poolgröße mit: Legendäre nur, soweit das Limit sie aufnimmt', () => {
    // Gen 7 mit Legendären und Mysteriösen: viele Legendäre – mit Limit 1 tragen sie nicht 8 Teams
    const gen7 = { ...DEFAULT_DRAFT_SETTINGS, gens: [7], legendary: true, mythical: true };
    const pool = poolOf(gen7, ALL);
    const legends = pool.filter(isLegend).length;
    const plain = Math.floor(pool.length / 11);
    expect(plain).toBe(8);
    expect(maxTeamsForPool(gen7, ALL)).toBe(8);
    expect(poolPickCapacity(gen7, 8, ALL)).toBe(pool.length);
    // Mit Limit 1: nur 8 der Legendären zählen für 8 Teams – das reicht nicht für 88 Picks
    const limited = { ...gen7, maxLegends: 1 };
    expect(poolPickCapacity(limited, 8, ALL)).toBe(pool.length - legends + 8);
    expect(poolPickCapacity(limited, 8, ALL)).toBeLessThan(8 * 11);
    expect(poolPickCapacity(limited, 7, ALL)).toBeGreaterThanOrEqual(7 * 11);
    expect(maxTeamsForPool(limited, ALL)).toBe(7);
    expect(maxTeamsForPool({ ...gen7, maxLegends: 3 }, ALL)).toBe(8);
    expect(codeOf(() => normalizeSettings({ ...limited, maxTeams: 8 }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe('pool_too_small');
    expect(messageOf(() => normalizeSettings({ ...limited, maxTeams: 8 }, DEFAULT_DRAFT_SETTINGS, ALL))).toBe(
      'Der Pool reicht nur für 7 Teams à 11 Pokémon (Legendären-Limit)',
    );
    expect(normalizeSettings({ ...limited, maxTeams: 7 }, DEFAULT_DRAFT_SETTINGS, ALL).maxTeams).toBe(7);
    // In der Lobby: Limit einschalten geht erst, wenn die Teamzahl passt
    const s = lobby({ gens: [7], legendary: true, mythical: true, maxTeams: 8 });
    expect(codeOf(() => updateSettings(s, 'dev-h', { maxLegends: 1 }, ALL))).toBe('pool_too_small');
    expect(updateSettings(s, 'dev-h', { maxLegends: 1, maxTeams: 7 }, ALL).settings).toMatchObject({ maxLegends: 1, maxTeams: 7 });
    // Ohne Legendäre im Pool ändert das Limit nichts
    expect(maxTeamsForPool({ ...DEFAULT_DRAFT_SETTINGS, gens: [7], maxLegends: 1 }, ALL)).toBe(
      maxTeamsForPool({ ...DEFAULT_DRAFT_SETTINGS, gens: [7] }, ALL),
    );
  });

  it('startDraft prüft die Kapazität mit Legendären-Limit (Stand, der an normalizeSettings vorbeikam)', () => {
    const s = lobby({ gens: [7], legendary: true, mythical: true, maxTeams: 8 }, { cpus: 7 });
    expect(s.teams).toHaveLength(8);
    // z. B. ein älterer bzw. von Hand geänderter Stand – die Lobby-Prüfung lässt das nicht zu
    const tight: DraftState = { ...s, settings: { ...s.settings, maxLegends: 1 } };
    const cap = poolPickCapacity(tight.settings, 8, ALL);
    expect(codeOf(() => start(tight))).toBe('pool_too_small');
    expect(messageOf(() => start(tight))).toBe(`Mit dem Legendären-Limit reicht der Pool nur für ${cap} Picks, gebraucht werden 88`);
    expect(start(s).phase).toBe('drafting');
  });

  it('rerollUsable: nur mit Rerolls und einer Alternative (mehrere Generationen bzw. Typen)', () => {
    const s = { ...DEFAULT_DRAFT_SETTINGS, rerolls: { type: 1, region: 1 } };
    expect(rerollUsable(s, 'type')).toBe(true);
    expect(rerollUsable(s, 'region')).toBe(false); // nur Generation 1
    expect(rerollUsable({ ...s, gens: [1, 2] }, 'region')).toBe(true);
    expect(rerollUsable({ ...s, types: ['water'] }, 'type')).toBe(false);
    expect(rerollUsable({ ...s, gens: [1, 2], rerolls: { type: 1, region: 0 } }, 'region')).toBe(false);
    // Passt zur Engine: Mit nur einer Generation geht ein Regions-Reroll nie
    let st = start(lobby({ roll: 'pick', gens: [1], rerolls: { type: 1, region: 3 }, maxTeams: 2 }, { cpus: 0, humans: 2 }));
    for (let i = 0; i < 6; i++) {
      const cur = currentTeam(st)!;
      expect(canReroll(st, cur.id, 'region', ALL)).toBe(false);
      expect(canReroll(st, cur.id, 'type', ALL)).toBe(true);
      st = autoStep(st);
    }
  });

  it('gleiche Werte: tief für Listen und Objekte', () => {
    expect(sameSettingValue([1, 2], [1, 2])).toBe(true);
    expect(sameSettingValue([1, 2], [2, 1])).toBe(false);
    expect(sameSettingValue({ type: 1, region: 1 }, { type: 1, region: 1 })).toBe(true);
    expect(sameSettingValue({ type: 1, region: 1 }, { type: 1, region: 2 })).toBe(false);
    expect(sameSettingValue(null, null)).toBe(true);
    expect(sameSettingValue(null, 1)).toBe(false);
    expect(sameSettingValue('pick', 'pick')).toBe(true);
  });

  it('Lobby-Kurzform: alle = 0, eine = ihre Nummer, mehrere = 10', () => {
    expect(lobbyRegionOf({ gens: [...DRAFT_ALL_GENS] })).toBe(0);
    expect(lobbyRegionOf({ gens: [4] })).toBe(4);
    expect(lobbyRegionOf({ gens: [1, 2] })).toBe(LOBBY_REGION_MANY);
    expect(LOBBY_REGION_MANY).toBe(10);
    expect(poolHasLegends({ legendary: false, mythical: false })).toBe(false);
    expect(poolHasLegends({ legendary: false, mythical: true })).toBe(true);
  });
});

// ---------------------------------------------------------------- Ältere Ligen

describe('Ältere Ligen und Clients (region / legends)', () => {
  const legacy = {
    name: 'Alt',
    region: 0,
    legends: true,
    setPiece: true,
    maxTeams: 6,
    pickSeconds: 30,
    order: 'host',
    visibility: 'public',
  };

  it('upgradeSettings: region 0 → alle Generationen, legends → beide Schalter, neue Felder mit Standard', () => {
    const up = upgradeSettings(legacy);
    expect(up).toEqual({
      name: 'Alt',
      gens: [...DRAFT_ALL_GENS],
      types: ALL_TYPES,
      legendary: true,
      mythical: true,
      maxLegends: null,
      setPiece: true,
      maxTeams: 6,
      pickSeconds: 30,
      order: 'host',
      snake: true,
      roll: 'off',
      rerolls: { type: 1, region: 1 },
      visibility: 'public',
    });
    expect(up).not.toHaveProperty('region');
    expect(up).not.toHaveProperty('legends');
    expect(upgradeSettings({ ...legacy, region: 5, legends: false })).toMatchObject({ gens: [5], legendary: false, mythical: false });
    // Aktuelle Einstellungen: dasselbe Objekt
    expect(upgradeSettings(up)).toBe(up);
    expect(upgradeSettings(DEFAULT_DRAFT_SETTINGS)).toBe(DEFAULT_DRAFT_SETTINGS);
    // Unsinn: Standard, nie ein Fehler
    expect(upgradeSettings(null)).toEqual(DEFAULT_DRAFT_SETTINGS);
    expect(upgradeSettings({ region: 42, legends: 'ja', gens: [], types: ['x'], maxLegends: 9, roll: 'x', rerolls: { type: 9 } })).toEqual(
      DEFAULT_DRAFT_SETTINGS,
    );
    // Gleicher Pool wie früher: Gen 3 ohne Legendäre
    const old = ALL.filter((p) => p.gen === 3 && !p.leg && !p.myth).map((p) => p.id);
    expect(poolOf(upgradeSettings({ ...legacy, region: 3, legends: false }), ALL).map((p) => p.id).sort((a, b) => a - b)).toEqual(
      old.sort((a, b) => a - b),
    );
    // poolOf verträgt auch noch alte Einstellungen
    expect(poolOf({ region: 3, legends: false } as never, ALL).map((p) => p.id)).toEqual(old);
  });

  it('upgradeState: laufender Draft einer älteren Liga spielt weiter (ohne Wurf)', () => {
    let s = start(lobby({ gens: [1], maxTeams: 4 }, { humans: 2, cpus: 1 }));
    for (let i = 0; i < 5; i++) s = autoStep(s);
    // So lag eine Liga vor dem Update im Durable Object
    const { gens: _g, types: _t, legendary: _l, mythical: _m, maxLegends: _x, snake: _s, roll: _r, rerolls: _rr, ...rest } = s.settings;
    const { roll: _roll, rerollsUsed: _used, ...old } = s;
    const stored = { ...old, settings: { ...rest, region: 1, legends: false } } as unknown as DraftState;

    const up = upgradeState(stored);
    expect(up).not.toBe(stored);
    expect(up.settings).toEqual({ ...DEFAULT_DRAFT_SETTINGS, order: 'host', maxTeams: 4 });
    expect(upgradeState(up)).toBe(up);
    expect(currentTeam(up)?.id).toBe(currentTeam(s)?.id);
    const snap = snapshotOf(stored, null, 0);
    // Dazu die gespiegelten älteren Schlüssel (für Tabs mit altem Bundle) – genau die gespeicherten
    expect(snap.settings).toEqual({ ...up.settings, region: 1, legends: false });
    expect(snap.roll).toBeNull();
    expect(snap.rerollsUsed).toEqual({});
    let next = up;
    while (next.phase === 'drafting') next = autoStep(next);
    expect(next.phase).toBe('done');
    expect(next.picks.every((p) => p.roll === undefined)).toBe(true);
  });

  it('normalizeSettings nimmt region/legends älterer Clients an – neue Schlüssel haben Vorrang', () => {
    const n = (p: DraftSettingsPatch) => normalizeSettings({ maxTeams: 2, ...p }, DEFAULT_DRAFT_SETTINGS, ALL);
    expect(n({ region: 0 }).gens).toEqual([...DRAFT_ALL_GENS]);
    expect(n({ region: 3 }).gens).toEqual([3]);
    expect(n({ legends: true })).toMatchObject({ legendary: true, mythical: true });
    expect(n({ legends: true, mythical: false })).toMatchObject({ legendary: true, mythical: false });
    expect(n({ region: 2, gens: [4, 5] }).gens).toEqual([4, 5]);
    const out = n({ region: 1, legends: false });
    expect(out).not.toHaveProperty('region');
    expect(out).not.toHaveProperty('legends');
    expect(messageOf(() => n({ region: 12 as never }))).toBe('Ungültige Region');
    expect(messageOf(() => n({ legends: 'ja' as never }))).toBe('Ungültige Einstellung');
    // createDraft mit alten Schlüsseln
    expect(lobby({ region: 2, legends: true, maxTeams: 2 }).settings).toMatchObject({ gens: [2], legendary: true, mythical: true });
    // Basis in alter Form wird mit umgestellt
    const fromOld = normalizeSettings({ name: 'x' }, { ...legacy, maxTeams: 2 } as unknown as DraftSettings, ALL);
    expect(fromOld).toMatchObject({ name: 'x', gens: [...DRAFT_ALL_GENS], legendary: true });
    expect(fromOld).not.toHaveProperty('region');
  });

  /** Pool, wie ihn ein Client von vor dem Update aus snapshot.settings berechnet (alter poolOf) */
  const oldClientPool = (s: { region?: number; legends?: boolean }) =>
    ALL.filter((p) => (s.region === 0 || p.gen === s.region) && (s.legends || (!p.leg && !p.myth)));

  it('Schnappschuss spiegelt region/legends für Tabs mit altem Bundle – nie ein leerer Pool, höchstens eine Obermenge', () => {
    const cases: DraftSettingsPatch[] = [
      {},
      { gens: [4] },
      { gens: [1, 2], types: ['fire', 'water'] },
      { gens: [...DRAFT_ALL_GENS], legendary: true },
      { gens: [3, 5], mythical: true },
      { gens: [2], legendary: true, mythical: false, maxLegends: 1 },
      { gens: [7, 8], types: ['dragon', 'psychic', 'steel'], legendary: true, mythical: true, maxLegends: 2, roll: 'pick' },
      { region: 6, legends: true },
    ];
    for (const patch of cases) {
      const s = lobby({ maxTeams: 2, ...patch });
      for (const state of [s, start(s)]) {
        const snap = snapshotOf(state, 'h', 0);
        const pool = poolOf(snap.settings, ALL);
        const old = oldClientPool(snap.settings);
        const oldIds = new Set(old.map((p) => p.id));
        expect(old.length, JSON.stringify(patch)).toBeGreaterThan(0);
        expect(pool.every((p) => oldIds.has(p.id)), JSON.stringify(patch)).toBe(true);
        // Gespeichert bleibt nur die neue Form; neue Clients lesen die Spiegel nicht
        expect(state.settings).not.toHaveProperty('region');
        expect(state.settings).not.toHaveProperty('legends');
        expect(upgradeSettings(snap.settings)).toBe(snap.settings);
        const again = normalizeSettings({}, snap.settings, ALL);
        expect(again).not.toHaveProperty('region');
        expect(again).not.toHaveProperty('legends');
        expect(again).toEqual(state.settings);
      }
    }
    // Mehrere Generationen → 0 (alle), Mysteriöse allein → legends: die Obermenge
    expect(snapshotOf(lobby({ gens: [1, 2], maxTeams: 2 }), null, 0).settings).toMatchObject({ region: 0, legends: false });
    expect(snapshotOf(lobby({ gens: [5], mythical: true, maxTeams: 2 }), null, 0).settings).toMatchObject({ region: 5, legends: true });
  });

  it('ältere Ligen (region 0–9, legends an/aus): gespiegelt genau der alte Pool – alte Tabs rechnen richtig', () => {
    for (let region = 0; region <= 9; region++) {
      for (const legends of [false, true]) {
        const s = lobby({ region: region as never, legends, maxTeams: 2 });
        const snap = snapshotOf(s, 'h', 0);
        expect(snap.settings).toMatchObject({ region, legends });
        expect(oldClientPool(snap.settings).map((p) => p.id)).toEqual(poolOf(snap.settings, ALL).map((p) => p.id));
      }
    }
  });
});

// ---------------------------------------------------------------- Pool

describe('Pool: Generationen, Typen, Legendäre und Mysteriöse', () => {
  it('mehrere Generationen', () => {
    const pool = poolOf({ ...DEFAULT_DRAFT_SETTINGS, gens: [1, 3] }, ALL);
    expect(new Set(pool.map((p) => p.gen))).toEqual(new Set([1, 3]));
    expect(pool).toHaveLength(ALL.filter((p) => (p.gen === 1 || p.gen === 3) && !isLegend(p)).length);
    expect(pool.map((p) => p.id)).toEqual([...pool.map((p) => p.id)].sort((a, b) => a - b));
  });

  it('Typen: mindestens einer muss passen (Zweittyp zählt)', () => {
    const flying = poolOf({ ...DEFAULT_DRAFT_SETTINGS, types: ['flying'] }, ALL);
    expect(flying.every((p) => p.types.includes('flying'))).toBe(true);
    expect(flying).toContainEqual(byName('Glurak')); // Feuer/Flug
    const fireOrWater = poolOf({ ...DEFAULT_DRAFT_SETTINGS, types: ['fire', 'water'] }, ALL);
    expect(fireOrWater.every((p) => p.types.includes('fire') || p.types.includes('water'))).toBe(true);
    expect(fireOrWater.map((p) => p.de)).toEqual(expect.arrayContaining(['Glurak', 'Garados']));
    expect(fireOrWater.map((p) => p.de)).not.toContain('Pikachu');
  });

  it('Legendäre und Mysteriöse getrennt', () => {
    const base = { ...DEFAULT_DRAFT_SETTINGS, gens: [1] };
    const names = (s: Partial<DraftSettings>) => poolOf({ ...base, ...s }, ALL).map((p) => p.de);
    expect(names({})).not.toContain('Mewtu');
    expect(names({})).not.toContain('Mew');
    expect(names({ legendary: true })).toContain('Mewtu');
    expect(names({ legendary: true })).not.toContain('Mew');
    expect(names({ mythical: true })).toContain('Mew');
    expect(names({ mythical: true })).not.toContain('Mewtu');
    expect(names({ legendary: true, mythical: true })).toEqual(expect.arrayContaining(['Mew', 'Mewtu']));
  });

  it('zwischengespeichert je Pool-Einstellung', () => {
    const a = poolOf({ ...DEFAULT_DRAFT_SETTINGS, gens: [2], types: ['water'] }, ALL);
    expect(poolOf({ ...DEFAULT_DRAFT_SETTINGS, gens: [2], types: ['water'] }, ALL)).toBe(a);
    expect(poolOf({ ...DEFAULT_DRAFT_SETTINGS, gens: [2], types: ['fire'] }, ALL)).not.toBe(a);
    expect(maxTeamsForPool({ ...DEFAULT_DRAFT_SETTINGS, gens: [2], types: ['water'] }, ALL)).toBe(Math.floor(a.length / 11));
  });
});

// ---------------------------------------------------------------- Reihenfolge

describe('Reihenfolge: Snake oder jede Runde gleich', () => {
  it('teamIndexForPick', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((p) => teamIndexForPick(p, 3))).toEqual([0, 1, 2, 2, 1, 0, 0]);
    expect([0, 1, 2, 3, 4, 5, 6].map((p) => teamIndexForPick(p, 3, true))).toEqual([0, 1, 2, 2, 1, 0, 0]);
    expect([0, 1, 2, 3, 4, 5, 6].map((p) => teamIndexForPick(p, 3, false))).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('currentTeam folgt settings.snake', () => {
    for (const snake of [true, false]) {
      let s = start(lobby({ snake, maxTeams: 3 }, { humans: 1, cpus: 2 }));
      const order: string[] = [];
      for (let i = 0; i < 6; i++) {
        order.push(currentTeam(s)!.id);
        s = autoStep(s);
      }
      expect(order).toEqual(snake ? ['h', 'cpu1', 'cpu2', 'cpu2', 'cpu1', 'h'] : ['h', 'cpu1', 'cpu2', 'h', 'cpu1', 'cpu2']);
    }
  });
});

// ---------------------------------------------------------------- Legendären-Limit

describe('Legendären-Limit pro Team', () => {
  const settings: DraftSettingsPatch = { gens: [1, 2], legendary: true, mythical: true, maxLegends: 1, setPiece: true, maxTeams: 4, roll: 'off' };
  const mewtu = byName('Mewtu');
  const mew = byName('Mew');
  const lugia = byName('Lugia');

  it('Pick abgelehnt, sobald das Limit erreicht ist (Standardschütze zählt mit)', () => {
    let s = start(lobby(settings, { humans: 2, cpus: 0 }));
    expect(currentTeam(s)!.id).toBe('h');
    // Legendärer als Standardschütze
    s = applyPick(s, 'h', mewtu.id, DRAFT_SS_SLOT, false, 1, ALL);
    expect(legendsOf(s.teams.find((t) => t.id === 'h')!, ALL)).toBe(1);
    s = applyPick(s, 't1', byName('Pikachu').id, 0, false, 2, ALL);
    s = applyPick(s, 't1', byName('Glurak').id, 1, false, 3, ALL);
    expect(currentTeam(s)!.id).toBe('h');
    expect(pickAllowed(s, 'h', mew, ALL)).toBe('legend_limit');
    expect(pickAllowed(s, 'h', mew.id, ALL)).toBe('legend_limit');
    expect(pickError(s, 'h', mew.id, 0, ALL)).toBe('Höchstens ein Legendäres/Mysteriöses pro Team');
    expect(codeOf(() => applyPick(s, 'h', mew.id, 0, false, 4, ALL))).toBe('bad_pick');
    // Andere Teams dürfen noch
    expect(pickAllowed(s, 't1', lugia, ALL)).toBeNull();
    expect(pickAllowed(s, 'h', byName('Bisasam'), ALL)).toBeNull();
    // Auto-Pick wählt keinen weiteren Legendären
    const c = autoPickChoice(s, 'h', ALL, SCALE, false);
    expect(isLegend(ALL.find((p) => p.id === c.pokemonId)!)).toBe(false);
    expect(allowedPicks(s, 'h', ALL).some(isLegend)).toBe(false);
    expect(allowedPicks(s, 't1', ALL).some(isLegend)).toBe(true);
  });

  it('ohne Limit (null) beliebig viele', () => {
    let s = start(lobby({ ...settings, maxLegends: null }, { humans: 2, cpus: 0 }));
    s = applyPick(s, 'h', mewtu.id, 0, false, 1, ALL);
    s = applyPick(s, 't1', byName('Pikachu').id, 0, false, 2, ALL);
    s = applyPick(s, 't1', byName('Glurak').id, 1, false, 3, ALL);
    expect(pickAllowed(s, 'h', mew, ALL)).toBeNull();
    s = applyPick(s, 'h', mew.id, 1, false, 4, ALL);
    expect(legendsOf(s.teams[0], ALL)).toBe(2);
  });

  it('Pool reicht nur mit Aussetzen des Limits → schon die Einstellung wird abgelehnt', () => {
    // 19 normale + 3 legendäre Pokémon: 2 Teams à 11 bräuchten 3 Legendäre, das Limit erlaubt 2
    const list: Pokemon[] = [
      ...Array.from({ length: 19 }, (_, i) => mon({ gen: 1, types: ['normal'], atk: 40 + i, spe: 40 + i })),
      ...Array.from({ length: 3 }, (_, i) => mon({ gen: 1, types: ['psychic'], leg: 1, atk: 150 + i, spa: 150, spe: 150 })),
    ];
    const settings = { ...DEFAULT_DRAFT_SETTINGS, legendary: true, maxLegends: 1 };
    expect(poolPickCapacity(settings, 2, list)).toBe(21);
    expect(maxTeamsForPool(settings, list)).toBe(1);
    expect(messageOf(() => lobby({ legendary: true, maxLegends: 1, maxTeams: 2 }, { list }))).toBe(
      'Der Pool reicht nur für 1 Teams à 11 Pokémon (Legendären-Limit)',
    );
    // Ohne Limit bzw. mit Limit 2 geht es
    expect(maxTeamsForPool({ ...settings, maxLegends: null }, list)).toBe(2);
    expect(maxTeamsForPool({ ...settings, maxLegends: 2 }, list)).toBe(2);
  });

  it('nur noch Legendäre übrig (unglückliche Reihenfolge): das Limit setzt aus, der Draft bleibt nie hängen', () => {
    // 20 normale + 3 legendäre: reicht mit Limit 1 für 2 Teams (20 + 2 ≥ 22) – aber nicht in jeder Reihenfolge
    const list: Pokemon[] = [
      ...Array.from({ length: 20 }, (_, i) => mon({ gen: 1, types: ['normal'], atk: 40 + i, spe: 40 + i })),
      ...Array.from({ length: 3 }, (_, i) => mon({ gen: 1, types: ['psychic'], leg: 1, atk: 150 + i, spa: 150, spe: 150 })),
    ];
    expect(maxTeamsForPool({ ...DEFAULT_DRAFT_SETTINGS, legendary: true, maxLegends: 1 }, list)).toBe(2);
    for (const roll of ['off', 'pick', 'round'] as const) {
      for (const seed of [1, 2, 3, 'f00d']) {
        // Ohne Snake, die CPU zuerst: Der Host wählt zuletzt
        let s = lobby({ legendary: true, maxLegends: 1, maxTeams: 2, roll, snake: false }, { humans: 1, cpus: 1, seed, list });
        s = start(setOrder(s, 'dev-h', ['cpu1', 'h']), list);
        let waived = 0;
        while (s.phase === 'drafting') {
          const cur = currentTeam(s)!;
          const allowed = allowedPicks(s, cur.id, list);
          expect(allowed.length).toBeGreaterThan(0);
          // Host: zuerst ein Legendärer, sonst Normale; CPU nimmt Normale, solange es geht
          const wantLegend = cur.id === 'h' && legendsOf(cur, list) === 0;
          const p = allowed.find((x) => isLegend(x) === wantLegend) ?? allowed[0];
          const slot = freeSlots(cur, s.settings)[0];
          expect(pickError(s, cur.id, p.id, slot, list)).toBeNull();
          const taken = draftedIds(s);
          const before = legendsOf(cur, list);
          const next = applyPick(s, cur.id, p.id, slot, false, s.pickIndex, list);
          const after = legendsOf(next.teams.find((t) => t.id === cur.id)!, list);
          if (after > 1 && after > before) {
            waived++;
            // nur weil im Pool nichts anderes mehr war – und ohne Wurf
            expect(list.filter((x) => !taken.has(x.id) && !isLegend(x))).toEqual([]);
            if (roll !== 'off') expect(s.roll).toBeNull();
            expect(next.picks[next.picks.length - 1].roll).toBeUndefined();
          }
          s = next;
        }
        expect(s.phase).toBe('done');
        expect(draftedIds(s).size).toBe(22);
        // Ohne Wurf ergibt sich genau diese Reihenfolge: Die CPU nimmt alle Normalen, die sie braucht
        if (roll === 'off') expect(waived).toBe(1);
      }
    }
  });
});

// ---------------------------------------------------------------- Zufallsmodus

describe('Zufallsmodus: Wurf pro Pick', () => {
  const settings: DraftSettingsPatch = { gens: [1, 2, 3], roll: 'pick', maxTeams: 4 };

  it('Wurf nach dem Start und nach jedem Pick – immer wählbar, Picks nur passend', () => {
    let s = start(lobby(settings, { humans: 2, cpus: 1 }));
    for (let i = 0; i < 12; i++) {
      const cur = currentTeam(s)!;
      const roll = s.roll!;
      expect(roll).toBeTruthy();
      expect(roll.own).toBe(false);
      expect(s.settings.gens).toContain(roll.gen);
      expect(s.settings.types).toContain(roll.type);
      const allowed = allowedPicks(s, cur.id, ALL);
      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed.every((p) => matchesRoll(p, roll))).toBe(true);
      expect(effectiveRoll(s, cur.id, ALL)).toEqual({ gen: roll.gen, type: roll.type });
      // Unpassendes wird abgelehnt
      const wrong = poolOf(s.settings, ALL).find((p) => !matchesRoll(p, roll) && !draftedIds(s).has(p.id))!;
      expect(pickAllowed(s, cur.id, wrong, ALL)).toBe('roll');
      expect(pickError(s, cur.id, wrong.id, freeSlots(cur, s.settings)[0], ALL)).toBe(`${wrong.de} passt nicht zum Wurf`);
      // Der Wurf gilt nur für das Team am Zug
      const other = s.teams.find((t) => t.id !== cur.id)!;
      expect(pickAllowed(s, other.id, wrong, ALL)).toBeNull();
      expect(effectiveRoll(s, other.id, ALL)).toBeNull();
      const next = autoStep(s);
      const log = next.picks[next.picks.length - 1];
      expect(log.roll).toEqual({ gen: roll.gen, type: roll.type });
      expect(matchesRoll(ALL.find((p) => p.id === log.pokemonId)!, log.roll!)).toBe(true);
      s = next;
    }
  });

  it('deterministisch für einen Seed, verschieden für verschiedene Seeds', () => {
    const run = (seed: number | string) => {
      let s = start(lobby(settings, { cpus: 2, seed }));
      const rolls: string[] = [];
      for (let i = 0; i < 9; i++) {
        rolls.push(`${s.roll!.gen}${s.roll!.type}`);
        s = autoStep(s);
      }
      return rolls.join(',');
    };
    expect(run(7)).toBe(run(7));
    expect(run('ab12')).toBe(run('ab12'));
    const firsts = new Set(Array.from({ length: 12 }, (_, i) => run(100 + i)));
    expect(firsts.size).toBeGreaterThan(6);
  });

  it('Schnappschuss: Wurf, Rerolls und Einstellungen – kein Seed', () => {
    const s = start(lobby({ ...settings, roll: 'pick' }, { seed: 'geheim-1234' }));
    const snap = snapshotOf(s, 'h', 5);
    expect(snap.roll).toEqual(s.roll);
    expect(snap.rerollsUsed).toEqual({});
    expect(snap).not.toHaveProperty('roundRoll');
    expect(snap.settings).toMatchObject({ gens: [1, 2, 3], roll: 'pick', rerolls: { type: 1, region: 1 } });
    expect(JSON.stringify(snap)).not.toContain('geheim-1234');
    // Lobby: kein Wurf
    expect(snapshotOf(lobby(settings), null, 0).roll).toBeNull();
    // Snapshot-Sicht reicht für die Regeln (Client)
    const cur = currentTeam(snap)!;
    expect(allowedPicks(snap, cur.id, ALL)).toEqual(allowedPicks(s, cur.id, ALL));
  });

  it('ohne Zufallsmodus: kein Wurf, freie Wahl', () => {
    const s = start(lobby({ gens: [1, 2, 3], maxTeams: 4 }));
    expect(s.roll).toBeNull();
    expect(snapshotOf(s, null, 0).roll).toBeNull();
    expect(allowedPicks(s, 'h', ALL)).toHaveLength(poolOf(s.settings, ALL).length);
    const next = autoStep(s);
    expect(next.picks[0]).not.toHaveProperty('roll');
    // Ein (unerwarteter) Wurf im Zustand gilt ohne Zufallsmodus nicht
    expect(allowedPicks({ ...s, roll: { gen: 1, type: 'fire', own: false } }, 'h', ALL)).toHaveLength(poolOf(s.settings, ALL).length);
  });

  it('kein wählbarer Wurf mehr → roll = null, freie Wahl', () => {
    // Nur Gen 1, nur Wasser – ein Wurf mit einer Kombination, die leer ist, darf nicht hängen bleiben
    let s = start(lobby({ gens: [1], types: ['water'], roll: 'pick', maxTeams: 2 }));
    expect(s.roll).toEqual({ gen: 1, type: 'water', own: false });
    // Ein Wurf ohne Wählbares (z. B. geänderte Daten) gilt nicht – freie Wahl statt Stillstand
    const stuck: DraftState = { ...s, roll: { gen: 1, type: 'dark', own: false } };
    expect(effectiveRoll(stuck, 'h', ALL)).toBeNull();
    expect(allowedPicks(stuck, 'h', ALL)).toHaveLength(poolOf(s.settings, ALL).length);
    const c = autoPickChoice(stuck, 'h', ALL, SCALE, false);
    expect(pickError(stuck, 'h', c.pokemonId, c.slot, ALL)).toBeNull();
    while (s.phase === 'drafting') s = autoStep(s);
    expect(s.phase).toBe('done');
  });
});

describe('Zufallsmodus: Wurf pro Runde', () => {
  it('alle Teams einer Runde teilen sich den Rundenwurf; eigener Wurf nur, wenn er für das Team leer ist', () => {
    let sawOwn = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 'c0ffee']) {
      // Gen 6 ist klein: 6 Teams à 12 leeren den Pool komplett
      let s = start(lobby({ gens: [6], legendary: true, mythical: true, setPiece: true, roll: 'round', maxTeams: 6 }, { cpus: 5, seed }));
      const n = s.teams.length;
      expect(s.roundRoll).toBeTruthy();
      while (s.phase === 'drafting') {
        const cur = currentTeam(s)!;
        if (s.pickIndex % n === 0) expect(s.roundRoll).toBeTruthy();
        if (s.roll && !s.roll.own) {
          expect({ gen: s.roll.gen, type: s.roll.type }).toEqual(s.roundRoll);
        } else {
          // eigener Wurf bzw. keiner: Der Rundenwurf hat für dieses Team nichts Wählbares mehr
          sawOwn++;
          const rr = s.roundRoll;
          if (rr) expect(pickableCombos(s, cur.id).some((c) => c.gen === rr.gen && c.type === rr.type)).toBe(false);
          if (!s.roll) expect(pickableCombos(s, cur.id)).toEqual([]);
        }
        const prevRound = s.roundRoll;
        const next = autoStep(s);
        // Innerhalb der Runde bleibt der Rundenwurf
        if (next.phase === 'drafting' && next.pickIndex % n !== 0) expect(next.roundRoll).toEqual(prevRound);
        s = next;
      }
      expect(s.phase).toBe('done');
      expect(s.roundRoll).toBeNull();
    }
    expect(sawOwn).toBeGreaterThan(0);
  });

  it('Rundenwurf bevorzugt Kombinationen mit mindestens so vielen Pokémon wie Teams', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const s = start(lobby({ gens: [1, 2], roll: 'round', maxTeams: 4 }, { cpus: 3, seed }));
      const rr = s.roundRoll!;
      const n = poolOf(s.settings, ALL).filter((p) => matchesRoll(p, rr)).length;
      expect(n).toBeGreaterThanOrEqual(s.teams.length);
      expect(snapshotOf(s, null, 0).roundRoll).toEqual(rr);
    }
  });

  it('deterministisch für einen Seed', () => {
    const run = () => {
      let s = start(lobby({ gens: [1, 2], roll: 'round', maxTeams: 4 }, { cpus: 3, seed: 'abc' }));
      for (let i = 0; i < 20; i++) s = autoStep(s);
      return JSON.stringify(s.picks);
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------- Rerolls

describe('Rerolls', () => {
  const settings: DraftSettingsPatch = { gens: [1, 2, 3], roll: 'pick', rerolls: { type: 2, region: 1 }, maxTeams: 4 };

  it('nur das Team am Zug, je Art gezählt, ändert nur den Wurf dieses Picks', () => {
    let s = start(lobby(settings, { humans: 2, cpus: 1 }));
    expect(currentTeam(s)!.id).toBe('h');
    const first = s.roll!;
    expect(codeOf(() => applyReroll(s, 't1', 'type', ALL))).toBe('not_your_turn');
    expect(canReroll(s, 't1', 'type', ALL)).toBe(false);
    expect(canReroll(s, 'h', 'type', ALL)).toBe(true);
    expect(rerollsLeft(s, 'h', 'type')).toBe(2);
    expect(rerollsLeft(s, 'h', 'region')).toBe(1);

    const a = applyReroll(s, 'h', 'type', ALL);
    expect(a.roll!.gen).toBe(first.gen);
    expect(a.roll!.type).not.toBe(first.type);
    expect(a.roll!.own).toBe(true);
    expect(pickableCombos(a, 'h')).toContainEqual({ gen: a.roll!.gen, type: a.roll!.type });
    expect(a.rerollsUsed).toEqual({ h: { type: 1, region: 0 } });
    expect(rerollsLeft(a, 'h', 'type')).toBe(1);
    expect(rerollsLeft(a, 't1', 'type')).toBe(2);
    expect(a.pickIndex).toBe(s.pickIndex);
    expect(a.deadline).toBe(s.deadline);
    expect(a.teams).toBe(s.teams);
    // deterministisch
    expect(applyReroll(s, 'h', 'type', ALL)).toEqual(a);

    const b = applyReroll(a, 'h', 'region', ALL);
    expect(b.roll!.type).toBe(a.roll!.type);
    expect(b.roll!.gen).not.toBe(a.roll!.gen);
    expect(b.rerollsUsed!.h).toEqual({ type: 1, region: 1 });
    expect(codeOf(() => applyReroll(b, 'h', 'region', ALL))).toBe('no_reroll');
    expect(messageOf(() => applyReroll(b, 'h', 'region', ALL))).toBe('Kein Regions-Reroll mehr übrig');
    expect(canReroll(b, 'h', 'region', ALL)).toBe(false);
    const c = applyReroll(b, 'h', 'type', ALL);
    expect(codeOf(() => applyReroll(c, 'h', 'type', ALL))).toBe('no_reroll');
    expect(messageOf(() => applyReroll(c, 'h', 'type', ALL))).toBe('Kein Typ-Reroll mehr übrig');

    // Gewählt werden muss nach dem neuen Wurf
    const roll = c.roll!;
    expect(allowedPicks(c, 'h', ALL).every((p) => matchesRoll(p, roll))).toBe(true);
    const next = autoStep(c);
    expect(next.picks[0].roll).toEqual({ gen: roll.gen, type: roll.type });
    // Nächster Pick: frischer Wurf, die Rerolls von h bleiben verbraucht
    expect(currentTeam(next)!.id).toBe('t1');
    expect(next.roll!.own).toBe(false);
    expect(next.rerollsUsed).toEqual({ h: { type: 2, region: 1 } });
    expect(rerollsLeft(next, 't1', 'region')).toBe(1);
    expect(snapshotOf(next, null, 0).rerollsUsed).toEqual({ h: { type: 2, region: 1 } });
  });

  it('CPU-Teams würfeln nie neu; ohne Wurf, ohne Zufallsmodus und außerhalb des Drafts geht es nicht', () => {
    let s = start(lobby(settings, { humans: 1, cpus: 1 }));
    s = autoStep(s);
    expect(currentTeam(s)!.id).toBe('cpu1');
    expect(codeOf(() => applyReroll(s, 'cpu1', 'type', ALL))).toBe('not_your_turn');
    expect(canReroll(s, 'cpu1', 'type', ALL)).toBe(false);
    while (s.phase === 'drafting') s = autoStep(s);
    expect(s.rerollsUsed).toEqual({});
    expect(codeOf(() => applyReroll(s, 'h', 'type', ALL))).toBe('not_drafting');

    const off = start(lobby({ ...settings, roll: 'off' }));
    expect(codeOf(() => applyReroll(off, 'h', 'type', ALL))).toBe('no_roll');
    expect(rerollsLeft(off, 'h', 'type')).toBe(0);
    expect(canReroll(off, 'h', 'type', ALL)).toBe(false);

    const rolled = start(lobby(settings));
    expect(codeOf(() => applyReroll({ ...rolled, roll: null }, 'h', 'type', ALL))).toBe('no_roll');
    expect(codeOf(() => applyReroll(lobby(settings), 'h', 'type', ALL))).toBe('not_drafting');
    const none = start(lobby({ ...settings, rerolls: { type: 0, region: 0 } }));
    expect(codeOf(() => applyReroll(none, 'h', 'type', ALL))).toBe('no_reroll');
  });

  it('keine andere wählbare Möglichkeit → no_other_roll', () => {
    // Nur eine Generation: kein anderer Regions-Wurf
    const one = start(lobby({ gens: [1], roll: 'pick', maxTeams: 2 }));
    expect(canReroll(one, 'h', 'region', ALL)).toBe(false);
    expect(codeOf(() => applyReroll(one, 'h', 'region', ALL))).toBe('no_other_roll');
    expect(canReroll(one, 'h', 'type', ALL)).toBe(true);
    // Nur ein Typ: kein anderer Typ-Wurf
    const water = start(lobby({ gens: [1, 2], types: ['water'], roll: 'pick', maxTeams: 2 }));
    expect(codeOf(() => applyReroll(water, 'h', 'type', ALL))).toBe('no_other_roll');
    expect(applyReroll(water, 'h', 'region', ALL).roll).toMatchObject({ type: 'water', own: true });
    // Kein Reroll verbraucht
    expect(rerollsLeft(one, 'h', 'region')).toBe(1);
  });

  it('im Runden-Modus bleibt der Rundenwurf – der nächste Pick bekommt ihn wieder', () => {
    const s = start(lobby({ gens: [1, 2, 3], roll: 'round', maxTeams: 4 }, { humans: 2, cpus: 1, seed: 5 }));
    const rr = s.roundRoll!;
    expect(s.roll).toEqual({ ...rr, own: false });
    const a = applyReroll(s, 'h', 'type', ALL);
    expect(a.roundRoll).toEqual(rr);
    expect(a.roll).toMatchObject({ gen: rr.gen, own: true });
    expect(a.roll!.type).not.toBe(rr.type);
    const next = autoStep(a);
    expect(currentTeam(next)!.id).toBe('t1');
    expect(next.roundRoll).toEqual(rr);
    expect(next.roll).toEqual({ ...rr, own: false });
  });

  it('canReroll stimmt mit applyReroll überein', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let s = start(lobby({ gens: [2, 6], types: ['fire', 'water', 'grass', 'dragon'], roll: 'pick', maxTeams: 2, rerolls: { type: 3, region: 3 } }, { humans: 2, cpus: 0, seed }));
      for (let i = 0; i < 10 && s.phase === 'drafting'; i++) {
        const cur = currentTeam(s)!;
        for (const kind of ['type', 'region'] as const) {
          const can = canReroll(s, cur.id, kind, ALL);
          const code = codeOf(() => applyReroll(s, cur.id, kind, ALL));
          expect(can, `${seed}/${i}/${kind}: ${code}`).toBe(code === null);
          if (can && i % 2 === 0) s = applyReroll(s, cur.id, kind, ALL);
        }
        s = autoStep(s);
      }
    }
  });
});

// ---------------------------------------------------------------- komplette Drafts

describe('Komplette Drafts mit seltsamen Einstellungen: nie hängen, jeder Auto-Pick ist legal', () => {
  /**
   * [Name, Einstellungen, Teams] – jeweils so viele Teams, wie die Kapazität (mit Legendären-Limit)
   * gerade noch erlaubt. Dann muss das Limit in keinem dieser Drafts aussetzen.
   */
  const configs: [string, DraftSettingsPatch, number][] = [
    // Pool genau so groß wie gebraucht (48), 5 Legendäre für 4 Teams mit Limit 2 (mit Limit 1 nur 3 Teams)
    ['Gen 3, Wasser/Psycho, Limit 2, exakt voll', { gens: [3], types: ['water', 'psychic'], legendary: true, mythical: true, maxLegends: 2, setPiece: true }, 4],
    ['Gen 3, Wasser/Psycho, Limit 1', { gens: [3], types: ['water', 'psychic'], legendary: true, mythical: true, maxLegends: 1, setPiece: true }, 3],
    ['Gen 1, Wasser/Gift, Standardschütze', { gens: [1], types: ['water', 'poison'], setPiece: true }, 5],
    ['Gen 6 komplett, Limit 2', { gens: [6], legendary: true, mythical: true, maxLegends: 2, setPiece: true }, 6],
    ['8 Teams, Gen 1+2, Limit 1, ohne Snake', { gens: [1, 2], legendary: true, mythical: true, maxLegends: 1, setPiece: true, snake: false }, 8],
    // 83 Pokémon, davon 21 Legendäre: 7 Teams à 11 bräuchten mehr als 7 Legendäre → höchstens 6 Teams
    ['6 Teams, Gen 7+8, Drache/Psycho/Fee/Stahl/Geist/Unlicht, Limit 1', { gens: [7, 8], types: ['dragon', 'psychic', 'fairy', 'steel', 'ghost', 'dark'], legendary: true, mythical: true, maxLegends: 1 }, 6],
    ['Gen 7, Limit 1, 7 Teams (8 nur mit Aussetzen)', { gens: [7], legendary: true, mythical: true, maxLegends: 1 }, 7],
  ];

  for (const [name, settings, teams] of configs) {
    for (const roll of ['pick', 'round', 'off'] as const) {
      it(`${name} – ${roll}`, () => {
        const seeds: (number | string)[] = roll === 'off' ? [1, 'x9'] : [1, 2, 3, 4, 5, 6, 7, 8, 'a1b2', 'ffee'];
        for (const seed of seeds) {
          const fits = maxTeamsForPool(normalizeSettings({ ...settings, maxTeams: 2 }, DEFAULT_DRAFT_SETTINGS, ALL), ALL);
          expect(fits).toBeGreaterThanOrEqual(teams);
          // Ein Team mehr als die Kapazität erlaubt: abgelehnt (statt das Limit für alle auszusetzen)
          if (teams + 1 <= 8 && fits === teams) {
            expect(codeOf(() => lobby({ ...settings, roll, maxTeams: teams + 1 }))).toBe('pool_too_small');
          }
          let s = start(lobby({ ...settings, roll, maxTeams: teams }, { humans: 1, cpus: teams - 1, seed }));
          const max = s.settings.maxLegends;
          let steps = 0;
          let waived = 0;
          while (s.phase === 'drafting') {
            expect(steps++).toBeLessThan(totalPicks(s));
            const cur = currentTeam(s)!;
            const allowed = allowedPicks(s, cur.id, ALL);
            expect(allowed.length).toBeGreaterThan(0);
            if (roll !== 'off') {
              if (s.roll) {
                // Wurf ist wählbar und passt zu den Einstellungen
                expect(s.settings.gens).toContain(s.roll.gen);
                expect(s.settings.types).toContain(s.roll.type);
                expect(allowed.every((p) => matchesRoll(p, s.roll!))).toBe(true);
              } else {
                // kein Wurf nur, wenn wirklich keine Kombination mehr etwas Wählbares hat
                expect(pickableCombos(s, cur.id)).toEqual([]);
              }
            } else {
              expect(s.roll).toBeNull();
            }
            const c = autoPickChoice(s, cur.id, ALL, SCALE, cur.cpu);
            expect(pickError(s, cur.id, c.pokemonId, c.slot, ALL)).toBeNull();
            expect(pickAllowed(s, cur.id, c.pokemonId, ALL)).toBeNull();
            const before = legendsOf(cur, ALL);
            const taken = draftedIds(s);
            const next = applyPick(s, cur.id, c.pokemonId, c.slot, true, steps, ALL);
            const after = legendsOf(next.teams.find((t) => t.id === cur.id)!, ALL);
            if (max != null && after > max && after > before) {
              // über dem Limit nur, wenn nichts anderes mehr übrig war – dann auch ohne Wurf
              expect(poolOf(s.settings, ALL).filter((p) => !taken.has(p.id) && !isLegend(p))).toEqual([]);
              expect(s.roll).toBeNull();
              waived++;
            }
            s = next;
          }
          expect(s.phase).toBe('done');
          // Die Kapazitätsprüfung lässt nur Ligen zu, in denen das Limit reicht – hier setzt es nie aus
          expect(waived).toBe(0);
          if (max != null) for (const t of s.teams) expect(legendsOf(t, ALL), t.name).toBeLessThanOrEqual(max);
          expect(s.roll).toBeNull();
          expect(s.picks).toHaveLength(teams * rounds(s.settings));
          expect(draftedIds(s).size).toBe(teams * rounds(s.settings));
          for (const t of s.teams) {
            expect(t.slots.every((id) => id != null)).toBe(true);
            if (s.settings.setPiece) expect(t.ss).not.toBeNull();
          }
          for (const p of s.picks) {
            const mon = ALL.find((x) => x.id === p.pokemonId)!;
            expect(poolOf(s.settings, ALL)).toContain(mon);
            if (p.roll) expect(matchesRoll(mon, p.roll)).toBe(true);
          }
        }
      });
    }
  }

  it('gleicher Seed → gleicher Draft (auch mit Rerolls zwischendurch)', () => {
    const run = () => {
      let s = start(lobby({ gens: [1, 4], roll: 'round', maxLegends: 1, legendary: true, maxTeams: 4, rerolls: { type: 3, region: 3 } }, { humans: 1, cpus: 3, seed: 'deadbeef' }));
      while (s.phase === 'drafting') {
        const cur = currentTeam(s)!;
        if (!cur.cpu && canReroll(s, cur.id, 'region', ALL)) s = applyReroll(s, cur.id, 'region', ALL);
        s = autoStep(s);
      }
      return JSON.stringify({ picks: s.picks, used: s.rerollsUsed, season: s.season });
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------- Lobby-Rest

describe('Lobby mit neuen Einstellungen', () => {
  it('Host stellt um, Teams und Reihenfolge bleiben', () => {
    let s = lobby({}, { humans: 2, cpus: 1 });
    s = setOrder(s, 'dev-h', ['cpu1', 't1', 'h']);
    s = updateSettings(s, 'dev-h', { gens: [1, 2], types: ['fire', 'water', 'grass'] as TypeKey[], roll: 'round', snake: false, maxLegends: 2, legendary: true }, ALL);
    expect(s.settings).toMatchObject({ gens: [1, 2], types: ['fire', 'water', 'grass'], roll: 'round', snake: false, maxLegends: 2 });
    expect(s.teams.map((t) => t.id)).toEqual(['cpu1', 't1', 'h']);
    expect(codeOf(() => updateSettings(s, 'dev-1', { roll: 'pick' }, ALL))).toBe('not_host');
  });
});
