import { describe, expect, it } from 'vitest';
import { FORMATION_IDS } from '../src/config/formations';
import { TYPE_KEYS } from '../src/config/pokemonTypes';
import { REGIONS } from '../src/config/regions';
import {
  applyReroll,
  canReroll,
  candidates,
  createEngineData,
  isComplete,
  isFreeSlot,
  isLegend,
  legendBlocked,
  legendsUsed,
  MODE_RULES,
  pickError,
  place,
  replayRun,
  REROLL_KINDS,
  rerollsLeft,
  SS_SLOT,
  startRun,
  totalRounds,
  usedIds,
  type PickLog,
  type RerollKind,
  type RunConfig,
  type RunState,
} from '../src/lib/challengeEngine';
import { dailyRunSeed } from '../src/lib/daily';
import { createRng } from '../src/lib/rng';
import type { ChallengeKey, FormationId } from '../src/types';
import { ALL, byName } from './helpers';

const DATA = createEngineData(ALL);
const CHALLENGES: ChallengeKey[] = ['c340', 'daily', 'retro340', 'c151'];
const GENS = REGIONS.map((r) => r.gen);

const cfg = (challenge: ChallengeKey, seed: number, over: Partial<RunConfig> = {}): RunConfig => ({
  challenge,
  formation: '4-3-3',
  ssEnabled: false,
  seed,
  ...over,
});

interface AutoOptions {
  /** Legendäre bevorzugen (reizt das Limit aus) */
  legendGreedy?: boolean;
  /** Zufällig Rerolls einstreuen */
  randomRerolls?: boolean;
  /** Feste Rerolls je Runde (1-basiert) */
  plan?: Record<number, RerollKind[]>;
  /** Wird nach jedem Zustandswechsel aufgerufen */
  check?: (s: RunState) => void;
}

const pickableOf = (s: RunState) => candidates(s, DATA).filter((p) => !legendBlocked(s, p, DATA));

function freeSlots(s: RunState): number[] {
  const free = s.slots.flatMap((v, i) => (v == null ? [i] : []));
  if (s.config.ssEnabled && s.ss == null) free.push(SS_SLOT);
  return free;
}

/** Spielt einen Run automatisch durch – Auswahl deterministisch aus einem eigenen Zufallsstrom. */
function autoPlay(config: RunConfig, o: AutoOptions = {}): RunState {
  const rng = createRng(config.seed ^ 0x5bd1e995);
  let s = startRun(config, DATA);
  o.check?.(s);
  while (!isComplete(s)) {
    for (const kind of o.plan?.[s.round] ?? []) {
      s = applyReroll(s, kind, DATA);
      o.check?.(s);
    }
    if (o.randomRerolls) {
      for (const kind of REROLL_KINDS) {
        if (rng() < 0.3 && canReroll(s, kind, DATA)) {
          s = applyReroll(s, kind, DATA);
          o.check?.(s);
        }
      }
    }
    const pickable = pickableOf(s);
    expect(pickable.length, `Runde ${s.round} ohne wählbares Pokémon`).toBeGreaterThan(0);
    const legends = pickable.filter(isLegend);
    const choice = o.legendGreedy && legends.length ? legends[0] : pickable[Math.floor(rng() * pickable.length)];
    const free = freeSlots(s);
    s = place(s, choice.id, free[Math.floor(rng() * free.length)], DATA);
    o.check?.(s);
  }
  return s;
}

/** Zustand vor dem Festlegen von Zug k (0-basiert) – inkl. der Rerolls dieses Zugs. */
function stateBefore(config: RunConfig, picks: PickLog[], k: number): RunState {
  let s = startRun(config, DATA);
  for (let i = 0; i < k; i++) {
    for (const kind of picks[i].rerolls) s = applyReroll(s, kind, DATA);
    s = place(s, picks[i].pokemonId, picks[i].slot, DATA);
  }
  for (const kind of picks[k].rerolls) s = applyReroll(s, kind, DATA);
  return s;
}

const clonePicks = (picks: PickLog[]): PickLog[] => JSON.parse(JSON.stringify(picks));

function expectRejected(config: RunConfig, picks: unknown, error: RegExp, round?: number) {
  const res = replayRun(config, picks as PickLog[], DATA);
  expect(res.ok).toBe(false);
  if (res.ok) return;
  expect(res.error).toMatch(error);
  if (round != null) expect(res.round).toBe(round);
}

describe('Determinismus', () => {
  it('gleicher Seed → identischer erster Wurf (alle Modi)', () => {
    for (const c of CHALLENGES) {
      for (const seed of [0, 1, 42, 123456789, 2 ** 31 - 1]) {
        expect(startRun(cfg(c, seed), DATA).roll).toEqual(startRun(cfg(c, seed), DATA).roll);
      }
    }
  });

  it('verschiedene Seeds → verschiedene Würfe', () => {
    for (const c of CHALLENGES) {
      const rolls = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(startRun(cfg(c, i + 1), DATA).roll)));
      expect(rolls.size).toBeGreaterThan(10);
    }
  });

  it('gleicher Seed → identisch automatisch gespielter Run', () => {
    for (const c of CHALLENGES) {
      for (const seed of [7, 99, 31337]) {
        const config = cfg(c, seed, { ssEnabled: true });
        const a = autoPlay(config, { randomRerolls: true });
        const b = autoPlay(config, { randomRerolls: true });
        expect(a).toEqual(b);
        expect(a.picks).toHaveLength(12);
      }
    }
  });

  it('Würfe hängen nur von Seed, Runde und gewählten Pokémon ab – nicht von Slot oder Formation', () => {
    for (const c of CHALLENGES) {
      const ref = autoPlay(cfg(c, 2024, { formation: '4-3-3' }), { randomRerolls: true });
      const rolls: unknown[] = [];
      let s = startRun(cfg(c, 2024, { formation: '4-3-3' }), DATA);
      for (const p of ref.picks) {
        for (const k of p.rerolls) s = applyReroll(s, k, DATA);
        rolls.push(s.roll);
        s = place(s, p.pokemonId, p.slot, DATA);
      }
      // Gleiche Pokémon, andere Formation, Slots rückwärts belegt
      let t = startRun(cfg(c, 2024, { formation: '5-3-2' }), DATA);
      ref.picks.forEach((p, i) => {
        for (const k of p.rerolls) t = applyReroll(t, k, DATA);
        expect(t.roll).toEqual(rolls[i]);
        t = place(t, p.pokemonId, 10 - i, DATA);
      });
      expect(isComplete(t)).toBe(true);
    }
  });

  it('Engine-Funktionen verändern den Eingangszustand nicht', () => {
    const s = startRun(cfg('c340', 5), DATA);
    const snapshot = JSON.stringify(s);
    if (canReroll(s, 'type', DATA)) applyReroll(s, 'type', DATA);
    place(s, pickableOf(s)[0].id, 0, DATA);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('Tägliche Elf', () => {
  it('gleicher Tag → gleicher erster Wurf für alle – egal welche Formation oder Standardschütze', () => {
    const seed = dailyRunSeed('2026-10-12');
    expect(dailyRunSeed('2026-10-12')).toBe(seed);
    const first = startRun(cfg('daily', seed), DATA).roll;
    for (const formation of FORMATION_IDS) {
      for (const ssEnabled of [false, true]) {
        expect(startRun(cfg('daily', seed, { formation, ssEnabled }), DATA).roll).toEqual(first);
      }
    }
  });

  it('gleiche Züge → gleiche Würfe für alle Spieler', () => {
    const seed = dailyRunSeed('2026-10-13');
    const a = autoPlay(cfg('daily', seed, { formation: '4-4-2' }));
    let b = startRun(cfg('daily', seed, { formation: '3-5-2', ssEnabled: true }), DATA);
    for (const p of a.picks) {
      b = place(b, p.pokemonId, p.slot, DATA);
    }
    expect(b.roll).not.toBeNull();
    expect(b.round).toBe(12);
  });

  it('andere Tage → andere Seeds', () => {
    const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2027-01-01', '2026-12-31'];
    expect(new Set(days.map(dailyRunSeed)).size).toBe(days.length);
  });

  it('gleiche Regeln wie die 34–0 Challenge', () => {
    expect(MODE_RULES.daily).toEqual(MODE_RULES.c340);
  });
});

describe('Würfe', () => {
  it('jeder Wurf hat mindestens ein wählbares Pokémon (alle Modi, viele Seeds)', () => {
    const check = (s: RunState) => {
      if (!isComplete(s)) expect(pickableOf(s).length).toBeGreaterThan(0);
    };
    for (const c of CHALLENGES) {
      for (let seed = 1; seed <= 60; seed++) {
        autoPlay(cfg(c, seed * 7919, { ssEnabled: seed % 2 === 0 }), { randomRerolls: true, check });
        autoPlay(cfg(c, seed * 104729, { ssEnabled: true }), { legendGreedy: true, randomRerolls: seed % 3 === 0, check });
      }
    }
  });

  it('Region + Typ: nur gültige Regionen, alle Kandidaten passen zu beiden', () => {
    for (const c of ['c340', 'daily'] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        autoPlay(cfg(c, seed), {
          randomRerolls: true,
          check: (s) => {
            if (!s.roll) return;
            expect(GENS).toContain(s.roll.region);
            expect(TYPE_KEYS).toContain(s.roll.type);
            expect(s.roll.pokemonId).toBeNull();
            for (const p of candidates(s, DATA)) {
              expect(p.gen).toBe(s.roll.region);
              expect(p.types).toContain(s.roll.type);
              expect(usedIds(s).has(p.id)).toBe(false);
            }
          },
        });
      }
    }
  });

  it('Retro 34–0: nur ein Typ, Kandidaten passen zum Typ', () => {
    for (let seed = 1; seed <= 25; seed++) {
      autoPlay(cfg('retro340', seed), {
        randomRerolls: true,
        check: (s) => {
          if (!s.roll) return;
          expect(s.roll.region).toBeNull();
          expect(s.roll.pokemonId).toBeNull();
          expect(TYPE_KEYS).toContain(s.roll.type);
          for (const p of candidates(s, DATA)) expect(p.types).toContain(s.roll.type);
        },
      });
    }
  });

  it('151 Challenge: genau ein gewürfeltes, noch freies Pokémon', () => {
    for (let seed = 1; seed <= 25; seed++) {
      autoPlay(cfg('c151', seed), {
        randomRerolls: true,
        check: (s) => {
          if (!s.roll) return;
          expect(s.roll.region).toBeNull();
          expect(s.roll.type).toBeNull();
          expect(usedIds(s).has(s.roll.pokemonId!)).toBe(false);
          expect(candidates(s, DATA).map((p) => p.id)).toEqual([s.roll.pokemonId]);
        },
      });
    }
  });

  it('Retro 34–0 und 151 Challenge nutzen nur Gen-1-Pokémon', () => {
    for (const c of ['retro340', 'c151'] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = autoPlay(cfg(c, seed, { ssEnabled: true }), {
          randomRerolls: true,
          check: (st) => {
            if (st.roll?.pokemonId != null) expect(DATA.byId.get(st.roll.pokemonId)!.gen).toBe(1);
            for (const p of candidates(st, DATA)) expect(p.gen).toBe(1);
          },
        });
        for (const id of usedIds(s)) expect(DATA.byId.get(id)!.gen).toBe(1);
      }
    }
  });

  it('nach dem letzten Zug gibt es keinen Wurf mehr', () => {
    const s = autoPlay(cfg('c340', 77));
    expect(s.roll).toBeNull();
    expect(s.round).toBe(totalRounds(s.config) + 1);
    expect(candidates(s, DATA)).toEqual([]);
    expect(pickError(s, 25, DATA)).toMatch(/bereits fertig/);
    expect(() => place(s, 25, 0, DATA)).toThrow(/bereits fertig/);
    for (const k of REROLL_KINDS) expect(canReroll(s, k, DATA)).toBe(false);
  });
});

describe('Legendäre', () => {
  const mewtwo = byName('Mewtu');
  const mew = byName('Mew');
  const articuno = byName('Arktos');

  it('Testdaten: Mewtu, Mew und Arktos sind Legendäre/Mysteriöse aus Gen 1', () => {
    for (const p of [mewtwo, mew, articuno]) {
      expect(isLegend(p)).toBe(true);
      expect(p.gen).toBe(1);
    }
    expect(articuno.types).toContain('ice');
  });

  it('pickError sperrt ein drittes Legendäres (34–0, Tages-Elf, Retro)', () => {
    for (const c of ['c340', 'daily', 'retro340'] as const) {
      const base = startRun(cfg(c, 1), DATA);
      const slots = base.slots.map((_, i) => (i === 0 ? mewtwo.id : i === 1 ? mew.id : null));
      const s: RunState = {
        ...base,
        slots,
        roll: { region: c === 'retro340' ? null : 1, type: 'ice', pokemonId: null },
      };
      expect(legendsUsed(s, DATA)).toBe(2);
      expect(candidates(s, DATA).map((p) => p.id)).toContain(articuno.id);
      expect(legendBlocked(s, articuno, DATA)).toBe(true);
      expect(pickError(s, articuno.id, DATA)).toBe('Schon 2 Legendäre im Team');
      expect(() => place(s, articuno.id, 2, DATA)).toThrow('Schon 2 Legendäre im Team');
      // Ein Nicht-Legendäres desselben Wurfs bleibt wählbar
      const other = candidates(s, DATA).find((p) => !isLegend(p))!;
      expect(pickError(s, other.id, DATA)).toBeNull();
    }
  });

  it('Standardschütze zählt zum Legendären-Limit', () => {
    const base = startRun(cfg('c340', 1, { ssEnabled: true }), DATA);
    const s: RunState = {
      ...base,
      slots: base.slots.map((_, i) => (i === 0 ? mewtwo.id : null)),
      ss: mew.id,
      roll: { region: 1, type: 'ice', pokemonId: null },
    };
    expect(legendBlocked(s, articuno, DATA)).toBe(true);
  });

  it('151 Challenge kennt kein Limit', () => {
    const base = startRun(cfg('c151', 1), DATA);
    const s: RunState = {
      ...base,
      slots: base.slots.map((_, i) => (i === 0 ? mewtwo.id : i === 1 ? mew.id : i === 2 ? byName('Zapdos').id : null)),
      roll: { region: null, type: null, pokemonId: articuno.id },
    };
    expect(legendBlocked(s, articuno, DATA)).toBe(false);
    expect(pickError(s, articuno.id, DATA)).toBeNull();
    expect(legendsUsed(place(s, articuno.id, 3, DATA), DATA)).toBe(4);
  });

  it('auch bei gieriger Wahl nie mehr als 2 Legendäre', () => {
    for (const c of ['c340', 'daily', 'retro340'] as const) {
      for (let seed = 1; seed <= 30; seed++) {
        const s = autoPlay(cfg(c, seed, { ssEnabled: true }), { legendGreedy: true });
        expect(legendsUsed(s, DATA)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('replayRun lehnt ein drittes Legendäres ab', () => {
    for (const c of ['c340', 'daily', 'retro340'] as const) {
      let found = false;
      for (let seed = 1; seed <= 400 && !found; seed++) {
        const config = cfg(c, seed, { ssEnabled: true });
        let s = startRun(config, DATA);
        const rng = createRng(seed);
        while (!isComplete(s)) {
          const blocked = candidates(s, DATA).find((p) => legendBlocked(s, p, DATA));
          if (blocked) {
            const total = totalRounds(config);
            const free = freeSlots(s);
            const picks: PickLog[] = [...s.picks, { rerolls: [...s.roundRerolls], pokemonId: blocked.id, slot: free[0] }];
            while (picks.length < total) picks.push({ rerolls: [], pokemonId: 1, slot: 0 });
            expectRejected(config, picks, /Schon 2 Legendäre im Team/, s.round);
            found = true;
            break;
          }
          const pickable = pickableOf(s);
          const legend = pickable.find(isLegend);
          const choice = legend ?? pickable[Math.floor(rng() * pickable.length)];
          const free = freeSlots(s);
          s = place(s, choice.id, free[Math.floor(rng() * free.length)], DATA);
        }
      }
      expect(found, `${c}: kein Run mit drittem Legendären gefunden`).toBe(true);
    }
  });
});

describe('Rerolls', () => {
  it('Limits je Modus', () => {
    expect(MODE_RULES.c340.rerolls).toEqual({ type: 1, region: 1, pokemon: 0 });
    expect(MODE_RULES.daily.rerolls).toEqual({ type: 1, region: 1, pokemon: 0 });
    expect(MODE_RULES.retro340.rerolls).toEqual({ type: 1, region: 0, pokemon: 0 });
    expect(MODE_RULES.c151.rerolls).toEqual({ type: 0, region: 0, pokemon: 5 });
  });

  it('34–0 / Tages-Elf: je 1× Typ und Region, Pokémon nie', () => {
    for (const c of ['c340', 'daily'] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        let s = startRun(cfg(c, seed), DATA);
        const before = s.roll!;
        expect(canReroll(s, 'pokemon', DATA)).toBe(false);
        expect(() => applyReroll(s, 'pokemon', DATA)).toThrow();

        expect(rerollsLeft(s, 'type')).toBe(1);
        expect(canReroll(s, 'type', DATA)).toBe(true);
        s = applyReroll(s, 'type', DATA);
        expect(s.roll!.type).not.toBe(before.type);
        expect(s.roll!.region).toBe(before.region);
        expect(pickableOf(s).length).toBeGreaterThan(0);
        expect(rerollsLeft(s, 'type')).toBe(0);
        expect(canReroll(s, 'type', DATA)).toBe(false);
        expect(() => applyReroll(s, 'type', DATA)).toThrow(/Kein type-Reroll mehr übrig/);

        const mid = s.roll!;
        expect(canReroll(s, 'region', DATA)).toBe(true);
        s = applyReroll(s, 'region', DATA);
        expect(s.roll!.region).not.toBe(mid.region);
        expect(s.roll!.type).toBe(mid.type);
        expect(pickableOf(s).length).toBeGreaterThan(0);
        expect(canReroll(s, 'region', DATA)).toBe(false);
        expect(() => applyReroll(s, 'region', DATA)).toThrow(/Kein region-Reroll mehr übrig/);

        expect(s.roundRerolls).toEqual(['type', 'region']);
        s = place(s, pickableOf(s)[0].id, 0, DATA);
        expect(s.picks[0].rerolls).toEqual(['type', 'region']);
        expect(s.roundRerolls).toEqual([]);
        // Rerolls gelten pro Run, nicht pro Runde
        expect(rerollsLeft(s, 'type')).toBe(0);
        expect(rerollsLeft(s, 'region')).toBe(0);
        expect(canReroll(s, 'type', DATA)).toBe(false);
      }
    }
  });

  it('Retro 34–0: 1× Typ, sonst nichts', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = startRun(cfg('retro340', seed), DATA);
      expect(canReroll(s, 'region', DATA)).toBe(false);
      expect(canReroll(s, 'pokemon', DATA)).toBe(false);
      expect(() => applyReroll(s, 'region', DATA)).toThrow();
      const before = s.roll!.type;
      s = applyReroll(s, 'type', DATA);
      expect(s.roll!.type).not.toBe(before);
      expect(pickableOf(s).length).toBeGreaterThan(0);
      expect(canReroll(s, 'type', DATA)).toBe(false);
      expect(() => applyReroll(s, 'type', DATA)).toThrow();
    }
  });

  it('151 Challenge: 5× Pokémon, nie Typ oder Region', () => {
    for (let seed = 1; seed <= 20; seed++) {
      let s = startRun(cfg('c151', seed), DATA);
      expect(canReroll(s, 'type', DATA)).toBe(false);
      expect(canReroll(s, 'region', DATA)).toBe(false);
      for (let i = 0; i < 5; i++) {
        expect(rerollsLeft(s, 'pokemon')).toBe(5 - i);
        expect(canReroll(s, 'pokemon', DATA)).toBe(true);
        const before = s.roll!.pokemonId;
        s = applyReroll(s, 'pokemon', DATA);
        expect(s.roll!.pokemonId).not.toBe(before);
        expect(DATA.byId.get(s.roll!.pokemonId!)!.gen).toBe(1);
        // Zwischendurch festlegen: Rerolls zählen über den ganzen Run
        if (i % 2 === 1) s = place(s, s.roll!.pokemonId!, freeSlots(s)[0], DATA);
      }
      expect(rerollsLeft(s, 'pokemon')).toBe(0);
      expect(canReroll(s, 'pokemon', DATA)).toBe(false);
      expect(() => applyReroll(s, 'pokemon', DATA)).toThrow(/Kein pokemon-Reroll mehr übrig/);
    }
  });

  it('Reroll ist deterministisch', () => {
    for (const c of CHALLENGES) {
      const kind = c === 'c151' ? 'pokemon' : 'type';
      const a = applyReroll(startRun(cfg(c, 555), DATA), kind, DATA);
      const b = applyReroll(startRun(cfg(c, 555), DATA), kind, DATA);
      expect(a.roll).toEqual(b.roll);
    }
  });
});

describe('replayRun', () => {
  it('akzeptiert automatisch gespielte Runs: alle Modi × alle Formationen × SS an/aus', () => {
    for (const c of CHALLENGES) {
      for (const formation of FORMATION_IDS) {
        for (const ssEnabled of [false, true]) {
          for (const seed of [11, 4242]) {
            const config = cfg(c, seed, { formation, ssEnabled });
            const played = autoPlay(config, { randomRerolls: true });
            expect(played.picks).toHaveLength(totalRounds(config));
            // Wie beim Server: Protokoll kommt als JSON an
            const res = replayRun(JSON.parse(JSON.stringify(config)), clonePicks(played.picks), DATA);
            expect(res.ok, res.ok ? '' : `${c} ${formation} ${ssEnabled}: ${res.error}`).toBe(true);
            if (res.ok) expect(res.state).toEqual(played);
          }
        }
      }
    }
  });

  it('akzeptiert Runs mit ausgeschöpften Rerolls', () => {
    const plans: [ChallengeKey, Record<number, RerollKind[]>][] = [
      ['c340', { 1: ['type'], 4: ['region'] }],
      ['daily', { 2: ['region', 'type'] }],
      ['retro340', { 3: ['type'] }],
      ['c151', { 1: ['pokemon', 'pokemon'], 5: ['pokemon'], 9: ['pokemon', 'pokemon'] }],
    ];
    for (const [c, plan] of plans) {
      const config = cfg(c, 8080, { ssEnabled: true });
      const played = autoPlay(config, { plan });
      const res = replayRun(config, played.picks, DATA);
      expect(res.ok).toBe(true);
    }
  });

  describe('lehnt ab', () => {
    const config = cfg('c340', 31415, { formation: '4-4-2', ssEnabled: false });
    const played = autoPlay(config);
    const K = 4; // geprüfter Zug (0-basiert) → Runde 5

    it('Basis-Run ist gültig', () => {
      expect(replayRun(config, played.picks, DATA).ok).toBe(true);
    });

    it('falsches Pokémon für den Wurf', () => {
      for (const c of CHALLENGES) {
        const conf = cfg(c, 2718);
        const run = autoPlay(conf);
        const s = stateBefore(conf, run.picks, K);
        const used = usedIds(s);
        const pool = MODE_RULES[c].pool === 'gen1' ? ALL.filter((p) => p.gen === 1) : ALL;
        const wrong = pool.find((p) => !used.has(p.id) && !candidates(s, DATA).includes(p))!;
        const picks = clonePicks(run.picks);
        picks[K].pokemonId = wrong.id;
        expectRejected(conf, picks, /passt nicht zum Wurf/, K + 1);
      }
    });

    it('Pokémon außerhalb des Pools (Retro/151 nur Gen 1)', () => {
      for (const c of ['retro340', 'c151'] as const) {
        const conf = cfg(c, 2718);
        const run = autoPlay(conf);
        const picks = clonePicks(run.picks);
        picks[K].pokemonId = byName('Endivie').id;
        expectRejected(conf, picks, /nicht erlaubt/, K + 1);
      }
    });

    it('unbekanntes Pokémon', () => {
      const picks = clonePicks(played.picks);
      picks[K].pokemonId = 99999;
      expectRejected(config, picks, /Unbekanntes Pokémon/, K + 1);
    });

    it('bereits genutztes Pokémon', () => {
      const picks = clonePicks(played.picks);
      picks[K].pokemonId = picks[0].pokemonId;
      expectRejected(config, picks, /steht schon im Team/, K + 1);
    });

    it('besetzter Slot', () => {
      const picks = clonePicks(played.picks);
      picks[K].slot = picks[1].slot;
      expectRejected(config, picks, /nicht frei/, K + 1);
    });

    it('SS-Slot ohne Standardschützen', () => {
      const picks = clonePicks(played.picks);
      picks[K].slot = SS_SLOT;
      expectRejected(config, picks, /nicht frei/, K + 1);
      expect(isFreeSlot(startRun(config, DATA), SS_SLOT)).toBe(false);
    });

    it('SS-Slot doppelt belegt', () => {
      const conf = cfg('c340', 31415, { ssEnabled: true });
      const run = autoPlay(conf);
      const ssIndex = run.picks.findIndex((p) => p.slot === SS_SLOT);
      const later = ssIndex === run.picks.length - 1 ? ssIndex - 1 : run.picks.length - 1;
      const picks = clonePicks(run.picks);
      const first = Math.min(ssIndex, later);
      const second = Math.max(ssIndex, later);
      picks[first].slot = SS_SLOT;
      picks[second].slot = SS_SLOT;
      expectRejected(conf, picks, /nicht frei/, second + 1);
    });

    it('Slot außerhalb des Felds', () => {
      for (const slot of [12, -1, 99, 1e9]) {
        const picks = clonePicks(played.picks);
        picks[K].slot = slot;
        expectRejected(config, picks, /nicht frei/, K + 1);
      }
    });

    it('Reroll über dem Limit', () => {
      const conf = cfg('c340', 1618, { ssEnabled: true });
      const run = autoPlay(conf, { plan: { 2: ['type'] } });
      expect(replayRun(conf, run.picks, DATA).ok).toBe(true);
      const picks = clonePicks(run.picks);
      picks[6].rerolls.push('type');
      expectRejected(conf, picks, /Kein type-Reroll mehr übrig/, 7);

      const same = clonePicks(run.picks);
      same[1].rerolls.push('type');
      expectRejected(conf, same, /Kein type-Reroll mehr übrig/, 2);

      const c151 = cfg('c151', 1618);
      const run151 = autoPlay(c151, { plan: { 1: ['pokemon', 'pokemon', 'pokemon'], 3: ['pokemon', 'pokemon'] } });
      expect(replayRun(c151, run151.picks, DATA).ok).toBe(true);
      const p151 = clonePicks(run151.picks);
      p151[7].rerolls.push('pokemon');
      expectRejected(c151, p151, /Kein pokemon-Reroll mehr übrig/, 8);
    });

    it('Reroll-Art, die der Modus nicht erlaubt', () => {
      const cases: [ChallengeKey, RerollKind][] = [
        ['c340', 'pokemon'],
        ['daily', 'pokemon'],
        ['retro340', 'region'],
        ['retro340', 'pokemon'],
        ['c151', 'type'],
        ['c151', 'region'],
      ];
      for (const [c, kind] of cases) {
        const conf = cfg(c, 99);
        const picks = clonePicks(autoPlay(conf).picks);
        picks[0].rerolls = [kind];
        expectRejected(conf, picks, new RegExp(`Kein ${kind}-Reroll`), 1);
      }
    });

    it('unbekannte Reroll-Art bzw. kaputtes Protokoll', () => {
      for (const rerolls of [['swap'], ['type', 'TYPE'], 'type', null, [1]]) {
        const picks = clonePicks(played.picks) as unknown as Record<string, unknown>[];
        picks[K].rerolls = rerolls;
        expectRejected(config, picks, /Ungültiges Zug-Protokoll/, K + 1);
      }
      const holes = clonePicks(played.picks) as unknown[];
      holes[K] = null;
      expectRejected(config, holes, /Ungültiges Zug-Protokoll/, K + 1);
    });

    it('falsche Anzahl Züge', () => {
      expectRejected(config, played.picks.slice(0, -1), /Erwartet 11 Züge, erhalten 10/, 0);
      expectRejected(config, [...played.picks, played.picks[0]], /Erwartet 11 Züge, erhalten 12/, 0);
      expectRejected(config, [], /Erwartet 11 Züge/, 0);
      expectRejected(config, null, /Erwartet 11 Züge, erhalten 0/, 0);
      expectRejected(config, { length: 11 }, /Erwartet 11 Züge/, 0);
      // 11 Züge reichen nicht, wenn der Standardschütze an ist
      expectRejected({ ...config, ssEnabled: true }, played.picks, /Erwartet 12 Züge, erhalten 11/, 0);
    });

    it('keine ganzzahligen IDs oder Slots', () => {
      const bad: [keyof PickLog, unknown][] = [
        ['pokemonId', 25.5],
        ['pokemonId', '25'],
        ['pokemonId', null],
        ['pokemonId', Number.NaN],
        ['pokemonId', Infinity],
        ['slot', 1.5],
        ['slot', '1'],
        ['slot', undefined],
      ];
      for (const [field, value] of bad) {
        const picks = clonePicks(played.picks) as unknown as Record<string, unknown>[];
        picks[K][field] = value;
        expectRejected(config, picks, /Ungültiger Zug/, K + 1);
      }
    });

    it('unbekannte Challenge, Formation oder ungültiger Seed', () => {
      expectRejected({ ...config, challenge: 'c999' as ChallengeKey }, played.picks, /Unbekannte Challenge/, 0);
      expectRejected({ ...config, formation: '2-3-5' as FormationId }, played.picks, /Unbekannte Formation/, 0);
      for (const seed of [-1, 1.5, Number.NaN]) {
        expectRejected({ ...config, seed }, played.picks, /Ungültiger Seed/, 0);
      }
    });

    it('anderer Seed → Protokoll passt nicht mehr', () => {
      const res = replayRun({ ...config, seed: config.seed + 1 }, played.picks, DATA);
      expect(res.ok).toBe(false);
    });
  });
});

describe('isFreeSlot', () => {
  it('nur freie Feldslots und – falls aktiv – der freie SS-Slot', () => {
    const off = startRun(cfg('c340', 3), DATA);
    const on = startRun(cfg('c340', 3, { ssEnabled: true }), DATA);
    for (let i = 0; i < 11; i++) expect(isFreeSlot(off, i)).toBe(true);
    expect(isFreeSlot(off, SS_SLOT)).toBe(false);
    expect(isFreeSlot(on, SS_SLOT)).toBe(true);
    for (const slot of [-1, 12, 0.5, Number.NaN]) expect(isFreeSlot(on, slot)).toBe(false);
    const id = pickableOf(on)[0].id;
    expect(isFreeSlot(place(on, id, SS_SLOT, DATA), SS_SLOT)).toBe(false);
    expect(isFreeSlot(place(on, id, 3, DATA), 3)).toBe(false);
  });
});
