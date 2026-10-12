/**
 * Challenge-Engine – reine, deterministische Spiellogik aller Challenges.
 *
 * Alle Würfe hängen nur vom Run-Seed, der Runde und dem bisherigen Verlauf ab.
 * Dadurch kann der Server einen eingereichten Run Zug für Zug nachspielen
 * (`replayRun`) und prüfen, ob jede Wahl legal war – Client und Server nutzen
 * exakt diesen Code. Keine Browser-APIs, kein Math.random.
 *
 * Zufallsströme (je eigener Seed, siehe streamRng):
 *   [seed, 'base', runde, versuch]          Grundwurf einer Runde (Versuch > 0 = automatisch neu gewürfelt)
 *   [seed, 'reroll', art, runde, n]         n-ter Reroll dieser Art im Run
 *   [seed, 'fallback', runde]               Notfall-Suche, falls 200 Versuche nichts Wählbares liefern
 */
import { FORMATIONS } from '../config/formations';
import { TYPE_KEYS } from '../config/pokemonTypes';
import { REGIONS } from '../config/regions';
import type { ChallengeKey, FormationId, Pokemon, Slots, TypeKey } from '../types';
import { shuffle, streamRng, type Rng } from './rng';

/** Slot-Index des Standardschützen (neben dem Feld). */
export const SS_SLOT = 11;

export type RerollKind = 'type' | 'region' | 'pokemon';
export const REROLL_KINDS: RerollKind[] = ['type', 'region', 'pokemon'];

export interface ModeRules {
  /** Pool: alle 1.025 oder nur die Original-151 */
  pool: 'all' | 'gen1';
  /** Was pro Runde gewürfelt wird */
  roll: 'region+type' | 'type' | 'pokemon';
  /** Rerolls pro Run je Art */
  rerolls: Record<RerollKind, number>;
  /** Maximal erlaubte Legendäre/Mysteriöse (null = unbegrenzt) */
  maxLegends: number | null;
  /** Normalisierung für Fit/Team-Score */
  scale: 'all' | 'gen1';
}

export const MODE_RULES: Record<ChallengeKey, ModeRules> = {
  c340: { pool: 'all', roll: 'region+type', rerolls: { type: 1, region: 1, pokemon: 0 }, maxLegends: 2, scale: 'all' },
  daily: { pool: 'all', roll: 'region+type', rerolls: { type: 1, region: 1, pokemon: 0 }, maxLegends: 2, scale: 'all' },
  retro340: { pool: 'gen1', roll: 'type', rerolls: { type: 1, region: 0, pokemon: 0 }, maxLegends: 2, scale: 'gen1' },
  c151: { pool: 'gen1', roll: 'pokemon', rerolls: { type: 0, region: 0, pokemon: 5 }, maxLegends: null, scale: 'gen1' },
};

export interface RunConfig {
  challenge: ChallengeKey;
  formation: FormationId;
  ssEnabled: boolean;
  seed: number;
}

/** Wurf einer Runde – je nach Modus sind nur einzelne Felder gesetzt. */
export interface Roll {
  region: number | null;
  type: TypeKey | null;
  pokemonId: number | null;
}

/** Protokoll einer Runde: genutzte Rerolls (in Reihenfolge), Wahl und Slot. */
export interface PickLog {
  rerolls: RerollKind[];
  pokemonId: number;
  /** 0–10 Feldslot (Formation), 11 = Standardschütze */
  slot: number;
}

/** Vollständiger, serialisierbarer Zustand eines Runs. */
export interface RunState {
  config: RunConfig;
  slots: Slots;
  ss: number | null;
  /** Aktuelle Runde (1-basiert). Größer als totalRounds, wenn fertig. */
  round: number;
  /** Aktueller Wurf; null, wenn der Run fertig ist. */
  roll: Roll | null;
  rerollsUsed: Record<RerollKind, number>;
  /** Rerolls der laufenden Runde (landen beim Festlegen im PickLog) */
  roundRerolls: RerollKind[];
  picks: PickLog[];
}

export interface EngineData {
  list: Pokemon[];
  byId: Map<number, Pokemon>;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export function createEngineData(list: Pokemon[]): EngineData {
  return { list, byId: new Map(list.map((p) => [p.id, p])) };
}

const poolCache = new WeakMap<Pokemon[], { all: Pokemon[]; gen1: Pokemon[] }>();

function poolOf(data: EngineData, which: ModeRules['pool']): Pokemon[] {
  let entry = poolCache.get(data.list);
  if (!entry) {
    const sorted = [...data.list].sort((a, b) => a.id - b.id);
    entry = { all: sorted, gen1: sorted.filter((p) => p.gen === 1) };
    poolCache.set(data.list, entry);
  }
  return entry[which];
}

export const isLegend = (p: Pokemon) => !!(p.leg || p.myth);

export function rulesOf(config: RunConfig): ModeRules {
  const rules = MODE_RULES[config.challenge];
  if (!rules) throw new EngineError(`Unbekannte Challenge: ${config.challenge}`);
  return rules;
}

export function totalRounds(config: RunConfig): number {
  return 11 + (config.ssEnabled ? 1 : 0);
}

export function isComplete(state: RunState): boolean {
  return state.round > totalRounds(state.config);
}

export function usedIds(state: Pick<RunState, 'slots' | 'ss'>): Set<number> {
  return new Set([...state.slots, state.ss].filter((id): id is number => id != null));
}

export function legendsUsed(state: Pick<RunState, 'slots' | 'ss'>, data: EngineData): number {
  let n = 0;
  for (const id of usedIds(state)) {
    const p = data.byId.get(id);
    if (p && isLegend(p)) n++;
  }
  return n;
}

/** Ist dieses Pokémon wegen des Legendären-Limits gesperrt? */
export function legendBlocked(state: RunState, p: Pokemon, data: EngineData): boolean {
  const max = rulesOf(state.config).maxLegends;
  return max != null && isLegend(p) && legendsUsed(state, data) >= max;
}

function matchesRoll(p: Pokemon, roll: Roll, rules: ModeRules): boolean {
  if (rules.roll === 'pokemon') return p.id === roll.pokemonId;
  if (roll.type == null || !p.types.includes(roll.type)) return false;
  return rules.roll === 'type' || p.gen === roll.region;
}

interface Ctx {
  config: RunConfig;
  rules: ModeRules;
  data: EngineData;
  used: Set<number>;
  legends: number;
}

function ctxOf(state: Pick<RunState, 'config' | 'slots' | 'ss'>, data: EngineData): Ctx {
  return {
    config: state.config,
    rules: rulesOf(state.config),
    data,
    used: usedIds(state),
    legends: legendsUsed(state, data),
  };
}

function candidatesFor(roll: Roll, ctx: Ctx): Pokemon[] {
  return poolOf(ctx.data, ctx.rules.pool).filter((p) => !ctx.used.has(p.id) && matchesRoll(p, roll, ctx.rules));
}

function hasPickable(roll: Roll, ctx: Ctx): boolean {
  const max = ctx.rules.maxLegends;
  return candidatesFor(roll, ctx).some((p) => max == null || !isLegend(p) || ctx.legends < max);
}

function available(ctx: Ctx, exclude: number | null = null): Pokemon[] {
  return poolOf(ctx.data, ctx.rules.pool).filter((p) => !ctx.used.has(p.id) && p.id !== exclude);
}

function regionGens(ctx: Ctx): number[] {
  return ctx.rules.pool === 'gen1' ? [1] : REGIONS.map((r) => r.gen);
}

function draw(rng: Rng, ctx: Ctx): Roll | null {
  switch (ctx.rules.roll) {
    case 'region+type': {
      const gens = regionGens(ctx);
      const region = gens[Math.floor(rng() * gens.length)];
      const type = TYPE_KEYS[Math.floor(rng() * TYPE_KEYS.length)];
      return { region, type, pokemonId: null };
    }
    case 'type':
      return { region: null, type: TYPE_KEYS[Math.floor(rng() * TYPE_KEYS.length)], pokemonId: null };
    case 'pokemon': {
      const pool = available(ctx);
      if (!pool.length) return null;
      return { region: null, type: null, pokemonId: pool[Math.floor(rng() * pool.length)].id };
    }
  }
}

/** Grundwurf einer Runde. Ohne wählbaren Treffer wird automatisch neu gewürfelt. */
function baseRoll(round: number, ctx: Ctx): Roll {
  for (let attempt = 0; attempt < 200; attempt++) {
    const roll = draw(streamRng(ctx.config.seed, 'base', round, attempt), ctx);
    if (roll && hasPickable(roll, ctx)) return roll;
  }
  // Notfall: deterministisch alle Kombinationen durchprobieren.
  const rng = streamRng(ctx.config.seed, 'fallback', round);
  const combos: Roll[] =
    ctx.rules.roll === 'pokemon'
      ? available(ctx).map((p) => ({ region: null, type: null, pokemonId: p.id }))
      : regionGens(ctx).flatMap((region) =>
          TYPE_KEYS.map((type) => ({ region: ctx.rules.roll === 'type' ? null : region, type, pokemonId: null })),
        );
  const found = shuffle(rng, combos).find((r) => hasPickable(r, ctx));
  if (!found) throw new EngineError('Kein wählbares Pokémon mehr im Pool');
  return found;
}

/** Ergebnis eines Rerolls – null, wenn es keinen anderen wählbaren Wurf gibt. */
function rerollRoll(state: RunState, kind: RerollKind, ctx: Ctx): Roll | null {
  const roll = state.roll;
  if (!roll) return null;
  const rng = streamRng(ctx.config.seed, 'reroll', kind, state.round, state.rerollsUsed[kind]);
  if (kind === 'pokemon') {
    if (ctx.rules.roll !== 'pokemon') return null;
    const pool = available(ctx, roll.pokemonId);
    return pool.length ? { ...roll, pokemonId: pool[Math.floor(rng() * pool.length)].id } : null;
  }
  if (kind === 'type') {
    if (ctx.rules.roll === 'pokemon') return null;
    const options = shuffle(rng, TYPE_KEYS.filter((t) => t !== roll.type));
    const type = options.find((t) => hasPickable({ ...roll, type: t }, ctx));
    return type ? { ...roll, type } : null;
  }
  if (ctx.rules.roll !== 'region+type') return null;
  const options = shuffle(rng, regionGens(ctx).filter((g) => g !== roll.region));
  const region = options.find((g) => hasPickable({ ...roll, region: g }, ctx));
  return region != null ? { ...roll, region } : null;
}

export function startRun(config: RunConfig, data: EngineData): RunState {
  if (!FORMATIONS[config.formation]) throw new EngineError(`Unbekannte Formation: ${config.formation}`);
  rulesOf(config);
  if (!Number.isInteger(config.seed) || config.seed < 0) throw new EngineError('Ungültiger Seed');
  const base = {
    config: { ...config },
    slots: FORMATIONS[config.formation].slots.map(() => null) as Slots,
    ss: null,
  };
  return {
    ...base,
    round: 1,
    roll: baseRoll(1, ctxOf(base, data)),
    rerollsUsed: { type: 0, region: 0, pokemon: 0 },
    roundRerolls: [],
    picks: [],
  };
}

/** Kandidaten des aktuellen Wurfs (inkl. wegen Legendären-Limit gesperrter). */
export function candidates(state: RunState, data: EngineData): Pokemon[] {
  if (!state.roll) return [];
  return candidatesFor(state.roll, ctxOf(state, data));
}

export function rerollsLeft(state: RunState, kind: RerollKind): number {
  if (!REROLL_KINDS.includes(kind)) return 0;
  return Math.max(0, rulesOf(state.config).rerolls[kind] - (state.rerollsUsed[kind] ?? 0));
}

export function canReroll(state: RunState, kind: RerollKind, data: EngineData): boolean {
  if (isComplete(state) || rerollsLeft(state, kind) <= 0) return false;
  return rerollRoll(state, kind, ctxOf(state, data)) != null;
}

export function applyReroll(state: RunState, kind: RerollKind, data: EngineData): RunState {
  if (isComplete(state)) throw new EngineError('Der Run ist bereits fertig');
  if (rerollsLeft(state, kind) <= 0) throw new EngineError(`Kein ${kind}-Reroll mehr übrig`);
  const roll = rerollRoll(state, kind, ctxOf(state, data));
  if (!roll) throw new EngineError('Kein anderer Wurf möglich');
  return {
    ...state,
    roll,
    rerollsUsed: { ...state.rerollsUsed, [kind]: state.rerollsUsed[kind] + 1 },
    roundRerolls: [...state.roundRerolls, kind],
  };
}

export function isFreeSlot(state: RunState, slot: number): boolean {
  if (slot === SS_SLOT) return state.config.ssEnabled && state.ss == null;
  return Number.isInteger(slot) && slot >= 0 && slot < state.slots.length && state.slots[slot] == null;
}

/** Grund, warum ein Pokémon gerade nicht gewählt werden kann – oder null. */
export function pickError(state: RunState, pokemonId: number, data: EngineData): string | null {
  if (isComplete(state) || !state.roll) return 'Der Run ist bereits fertig';
  const p = data.byId.get(pokemonId);
  if (!p) return `Unbekanntes Pokémon #${pokemonId}`;
  const ctx = ctxOf(state, data);
  if (!poolOf(data, ctx.rules.pool).includes(p)) return `${p.de} ist in dieser Challenge nicht erlaubt`;
  if (ctx.used.has(p.id)) return `${p.de} steht schon im Team`;
  if (!matchesRoll(p, state.roll, ctx.rules)) return `${p.de} passt nicht zum Wurf`;
  if (legendBlocked(state, p, data)) return 'Schon 2 Legendäre im Team';
  return null;
}

/** Legt ein Pokémon auf einen freien Slot und würfelt die nächste Runde. */
export function place(state: RunState, pokemonId: number, slot: number, data: EngineData): RunState {
  const err = pickError(state, pokemonId, data);
  if (err) throw new EngineError(err);
  if (!isFreeSlot(state, slot)) throw new EngineError(`Slot ${slot} ist nicht frei`);
  const slots = slot === SS_SLOT ? state.slots : state.slots.map((v, i) => (i === slot ? pokemonId : v));
  const ss = slot === SS_SLOT ? pokemonId : state.ss;
  const round = state.round + 1;
  const next = { config: state.config, slots, ss };
  return {
    ...next,
    round,
    roll: round > totalRounds(state.config) ? null : baseRoll(round, ctxOf(next, data)),
    rerollsUsed: state.rerollsUsed,
    roundRerolls: [],
    picks: [...state.picks, { rerolls: state.roundRerolls, pokemonId, slot }],
  };
}

export type ReplayResult = { ok: true; state: RunState } | { ok: false; error: string; round: number };

/** Spielt einen Run anhand seines Protokolls nach und prüft jeden Zug. */
export function replayRun(config: RunConfig, picks: PickLog[], data: EngineData): ReplayResult {
  let state: RunState;
  try {
    state = startRun(config, data);
  } catch (e) {
    return { ok: false, error: (e as Error).message, round: 0 };
  }
  if (!Array.isArray(picks) || picks.length !== totalRounds(config)) {
    return { ok: false, error: `Erwartet ${totalRounds(config)} Züge, erhalten ${picks?.length ?? 0}`, round: 0 };
  }
  for (const pick of picks) {
    try {
      if (!pick || !Array.isArray(pick.rerolls) || !pick.rerolls.every((k) => REROLL_KINDS.includes(k))) {
        throw new EngineError('Ungültiges Zug-Protokoll');
      }
      if (!Number.isInteger(pick.pokemonId) || !Number.isInteger(pick.slot)) throw new EngineError('Ungültiger Zug');
      for (const kind of pick.rerolls) state = applyReroll(state, kind, data);
      state = place(state, pick.pokemonId, pick.slot, data);
    } catch (e) {
      return { ok: false, error: (e as Error).message, round: state.round };
    }
  }
  return isComplete(state) ? { ok: true, state } : { ok: false, error: 'Run unvollständig', round: state.round };
}
