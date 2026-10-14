/**
 * Draft-Engine – reine, deterministische Logik des Online-Fantasy-Drafts.
 *
 * Der Server (Durable Object „DraftRoom") ist die einzige Instanz, die den Zustand
 * ändert; er ruft diese Funktionen auf und verschickt danach Schnappschüsse. Der
 * Browser nutzt dieselben Funktionen nur zum Anzeigen (wer ist dran, freie Slots,
 * Pool) und um ältere Saisons ohne gespeichertes Ergebnis nachzusimulieren. Kein
 * Math.random, keine Uhr: Zeit und IDs kommen von außen, Zufall aus dem Liga-Seed
 * (leagueRng – ein geheimer Text-Seed wird per SHA-256 je Zweck abgeleitet).
 *
 * Zufallsmodus (settings.roll, Idee der 34–0-Challenge): Jeder Pick hat einen Wurf aus
 * Generation + Typ; gewählt werden darf nur ein noch freies Pool-Pokémon dieser Generation
 * mit diesem Typ. Zufallsströme (alle geheim, weil aus dem Liga-Seed):
 *   [seed, 'roll', 'pick', pickIndex]               Wurf eines Picks (Modus 'pick')
 *   [seed, 'roll', 'round', runde]                  Rundenwurf (Modus 'round')
 *   [seed, 'roll', 'own', pickIndex]                eigener Wurf, wenn der Rundenwurf leer ist
 *   [seed, 'roll', 'reroll', art, pickIndex, n]     n-ter Reroll dieser Art des Teams
 * Gewürfelt wird, bis die Kombination für das Team am Zug etwas Wählbares hat (sonst
 * deterministisch über alle Kombinationen). Gibt es gar keine, ist roll = null: freie Wahl
 * aus dem Rest des Pools – der Draft bleibt nie hängen.
 */
import { cleanJerseys } from './jerseys';
import { FORMATION_IDS, FORMATIONS } from '../config/formations';
import { TYPE_KEYS } from '../config/pokemonTypes';
import { POSITIONS } from '../config/positions';
import { byDex, isMega, isUltraBeast } from '../config/categories';
import { CLUB_NAMES } from '../config/season';
import type { FormationId, Pokemon, RegionFilter, TypeKey } from '../types';
import {
  DEFAULT_DRAFT_SETTINGS,
  DRAFT_ALL_GENS,
  DRAFT_BENCH_SLOT,
  DRAFT_FORMATS,
  DRAFT_LIMITS,
  DRAFT_REROLL_KINDS,
  DRAFT_ROLL_MODES,
  LOBBY_REGION_MANY,
  type DraftActiveRoll,
  type DraftCareer,
  type DraftHistoryEntry,
  type DraftHistoryRow,
  type DraftPhase,
  type DraftPickLog,
  type DraftRerollCount,
  type DraftRerollKind,
  type DraftRoll,
  type DraftSeason,
  type DraftSettings,
  type DraftSettingsPatch,
  type DraftSnapshot,
  type DraftTeam,
  type LegacySettingsPatch,
  type LobbyRegion,
} from './api/draftContract';
import { buildScale, positionFit, type Scale } from './fit';
import { createRng, hashSeed, shuffle, streamRng, type Rng } from './rng';
import { CUP_SIZE, simulateCup } from './cup';
import type { ManagerState } from './manager';
import type { TrainerLook } from './trainer';
import { DRAFT_MODEL, opponentRatings, simulateLeague, type LeagueResult, type LeagueTeam } from './season';
import { evaluateTeam } from './teamScore';
import { cleanKit } from './kits';
import { cleanCheer } from './cheer';
import { cleanCrest } from './crest';
import { bestEleven } from './bestEleven';
import { SHINY_FIT_BONUS, shinyBonus, shinyRoll } from './shiny';

/** Slot-Index des Standardschützen */
export const DRAFT_SS_SLOT = 11;

/** Interner Zustand (Server). Enthält die Geräte-Zuordnung, die nie verschickt wird. */
export interface DraftState {
  code: string;
  /**
   * Liga-Seed: Reihenfolge, CPU-Zufall und Saison leiten sich davon ab (leagueSeed).
   * Der Server nimmt einen geheimen Text (32 Zufallsbytes hex), ältere Ligen eine Zahl.
   */
  seed: number | string;
  phase: DraftPhase;
  settings: DraftSettings;
  teams: DraftTeam[];
  /** Team-ID → Geräte-ID (nur menschliche Teams) */
  owners: Record<string, string>;
  hostTeamId: string | null;
  pickIndex: number;
  deadline: number | null;
  picks: DraftPickLog[];
  season: DraftSeason | null;
  createdAt: number;
  /** Vom Host entfernte Geräte – dürfen dieser Liga nicht wieder beitreten */
  banned?: string[];
  /** Beginn des aktuellen Zugs (nur während des Drafts) */
  turnStartedAt?: number | null;
  /** Gespeichertes Saisonergebnis (ab „done", kompakt: Teams ohne Kader) */
  league?: LeagueResult | null;
  /**
   * Wurf des aktuellen Picks (Zufallsmodus, nur während des Drafts). null bzw. fehlt
   * (ältere Stände): freie Wahl aus dem Pool.
   */
  roll?: DraftActiveRoll | null;
  /** Rundenwurf (nur settings.roll = 'round') */
  roundRoll?: DraftRoll | null;
  /** Genutzte Rerolls je Team-ID (fehlt ein Team: noch keine) */
  rerollsUsed?: Record<string, DraftRerollCount>;
  /** Frühere Ligen der Gruppe (Revanche-Kette), älteste zuerst */
  history?: DraftHistoryEntry[];
  /** Code der Revanche, sobald es eine gibt */
  rematch?: string | null;
  /** Wunschlisten je Team-ID (privat – nur das eigene Team sieht seine) */
  queues?: Record<string, number[]>;
  /** Manager-Saison (src/lib/manager.ts) – ab dem Ende des Drafts */
  manager?: ManagerState;
  /** Karriere: nächste Saison mit den Kadern der Vorsaison (ohne Draft) – fehlt sonst */
  career?: DraftCareer;
  /** Shinys der Liga (Pokémon-IDs, beim Pick ausgelost) – fehlt bei Ligen davor */
  shinies?: number[];
}

/** Lesende Sicht – passt auf den Server-Zustand und auf Client-Schnappschüsse. */
export type DraftView = Pick<DraftState, 'phase' | 'teams' | 'pickIndex' | 'settings' | 'roll'>;

/** Lesende Sicht mit Rerolls (rerollsLeft, canReroll) – auch für Schnappschüsse. */
export type DraftRollView = DraftView & Pick<DraftState, 'rerollsUsed'>;

export class DraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

const fail = (code: string, message: string): never => {
  throw new DraftError(code, message);
};

// ---------------------------------------------------------------- Zufall der Liga

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 (synchron, klein) – die acht 32-Bit-Wörter des Hashs. */
export function sha256Words(text: string): Uint32Array {
  const bytes = new TextEncoder().encode(text);
  const blocks = (bytes.length + 9 + 63) >> 6;
  const w = new Uint32Array(blocks * 16);
  bytes.forEach((b, i) => (w[i >> 2] |= b << (24 - (i & 3) * 8)));
  w[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  w[blocks * 16 - 2] = Math.floor((bytes.length * 8) / 2 ** 32);
  w[blocks * 16 - 1] = bytes.length * 8;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const m = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) {
        m[i] = w[b * 16 + i];
      } else {
        const x = m[i - 15];
        const y = m[i - 2];
        m[i] = m[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + m[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10));
      }
    }
    let [a, b1, b2, b3, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + m[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b1) ^ (a & b2) ^ (b1 & b2))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (b3 + t1) | 0;
      b3 = b2;
      b2 = b1;
      b1 = a;
      a = (t1 + t2) | 0;
    }
    [a, b1, b2, b3, e, f, g, hh].forEach((v, i) => (h[i] += v));
  }
  return h;
}

/**
 * 31-Bit-Seed der Liga für einen Zweck. Zahl (ältere Ligen, Tests): wie hashSeed.
 * Geheimer Text-Seed: SHA-256 – so verrät ein Zweck (sichtbare Reihenfolge, CPU-Picks)
 * nichts über einen anderen (Saison), auch nicht per Durchprobieren.
 */
export function leagueSeed(seed: number | string, ...parts: (string | number)[]): number {
  if (typeof seed === 'number') return hashSeed(seed, ...parts);
  return sha256Words([seed, ...parts].join('|'))[0] & 0x7fffffff;
}

/** Zufallsstrom der Liga für einen Zweck (siehe leagueSeed). */
export const leagueRng = (seed: number | string, ...parts: (string | number)[]) => createRng(leagueSeed(seed, ...parts));

// ---------------------------------------------------------------- Einstellungen & Pool

/** Picks pro Team: 11 + Standardschütze + (nur Manager-Saison) Bank */
export function rounds(settings: Pick<DraftSettings, 'setPiece'> & Partial<Pick<DraftSettings, 'format' | 'bench'>>): number {
  return 11 + (settings.setPiece ? 1 : 0) + benchSize(settings);
}

/** Bankplätze pro Team – nur in der Manager-Saison, sonst 0 */
export function benchSize(settings: Partial<Pick<DraftSettings, 'format' | 'bench'>>): number {
  return settings.format === 'manager' ? (settings.bench ?? DEFAULT_DRAFT_SETTINGS.bench) : 0;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Gleicher Einstellungswert? Tief für Listen und Objekte (gens, types, rerolls) – sonst ===. */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameSettingValue(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameSettingValue(a[k], b[k]));
  }
  return false;
}

/** Generationen aus einer Eingabe: aufsteigend, ohne Doppelte (evtl. leer) – undefined = ungültig. */
function gensOf(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length > 64) return undefined;
  if (!v.every((g) => Number.isInteger(g) && g >= 1 && g <= 9)) return undefined;
  return DRAFT_ALL_GENS.filter((g) => v.includes(g));
}

/** Typen aus einer Eingabe: Reihenfolge wie TYPE_KEYS, ohne Doppelte (evtl. leer) – undefined = ungültig. */
function typesOf(v: unknown): TypeKey[] | undefined {
  if (!Array.isArray(v) || v.length > 64) return undefined;
  if (!v.every((t) => typeof t === 'string' && (TYPE_KEYS as string[]).includes(t))) return undefined;
  return TYPE_KEYS.filter((t) => v.includes(t));
}

const nonEmpty = <T>(v: T[] | undefined): T[] | undefined => (v && v.length ? v : undefined);

const isMaxLegends = (v: unknown): v is number | null =>
  v === null || (DRAFT_LIMITS.maxLegends as readonly unknown[]).includes(v);

const isMaxUltraBeasts = (v: unknown): v is number | null =>
  v === null || (DRAFT_LIMITS.maxUltraBeasts as readonly unknown[]).includes(v);

const isMaxMegas = (v: unknown): v is number | null => v === null || (DRAFT_LIMITS.maxMegas as readonly unknown[]).includes(v);

const isRerollCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DRAFT_LIMITS.rerollsMax;

/** Rerolls aus einer (auch teilweisen) Eingabe, fehlende Arten aus base – undefined = ungültig. */
function rerollsOf(v: unknown, base: DraftRerollCount): DraftRerollCount | undefined {
  if (!isObj(v)) return undefined;
  const out: DraftRerollCount = { type: base.type, region: base.region };
  for (const kind of DRAFT_REROLL_KINDS) {
    if (v[kind] === undefined) continue;
    if (!isRerollCount(v[kind])) return undefined;
    out[kind] = v[kind];
  }
  return out;
}

const isRollMode = (v: unknown): v is DraftSettings['roll'] => (DRAFT_ROLL_MODES as readonly unknown[]).includes(v);

/** Ältere Region (0 = alle, sonst genau diese Generation) → Generationen; undefined = ungültig. */
function gensOfRegion(v: unknown): number[] | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 9) return undefined;
  return v === 0 ? [...DRAFT_ALL_GENS] : [v];
}

/** Ältere Einstellungs-Schlüssel (nur noch beim Einlesen bzw. als Spiegel im Schnappschuss) */
const LEGACY_SETTING_KEYS: readonly string[] = ['region', 'legends'] satisfies (keyof LegacySettingsPatch)[];

/** Einstellungen ohne die älteren Schlüssel region/legends (neues Objekt). */
function withoutLegacy(settings: DraftSettings): DraftSettings {
  const { region: _region, legends: _legends, ...rest } = settings as DraftSettings & LegacySettingsPatch;
  return rest;
}

/**
 * Einstellungen in der aktuellen Form: Gespeicherte Stände älterer Ligen (region/legends,
 * ohne die neuen Felder) werden umgeschrieben – region 0 → alle Generationen, n → [n];
 * legends → Legendäre und Mysteriöse. Fehlende bzw. ungültige Felder kommen aus
 * DEFAULT_DRAFT_SETTINGS. Wirft nie. Schon aktuelle Einstellungen kommen unverändert
 * (dasselbe Objekt) zurück.
 */
export function upgradeSettings(raw: unknown): DraftSettings {
  const r: Obj = isObj(raw) ? raw : {};
  const d = DEFAULT_DRAFT_SETTINGS;
  const legends = isBool(r.legends) ? r.legends : undefined;
  const next: DraftSettings = {
    name: typeof r.name === 'string' ? r.name : d.name,
    gens: nonEmpty(gensOf(r.gens)) ?? gensOfRegion(r.region) ?? [...d.gens],
    types: nonEmpty(typesOf(r.types)) ?? [...d.types],
    legendary: isBool(r.legendary) ? r.legendary : (legends ?? d.legendary),
    mythical: isBool(r.mythical) ? r.mythical : (legends ?? d.mythical),
    maxLegends: isMaxLegends(r.maxLegends) ? r.maxLegends : d.maxLegends,
    ultraBeasts: isBool(r.ultraBeasts) ? r.ultraBeasts : d.ultraBeasts,
    maxUltraBeasts: isMaxUltraBeasts(r.maxUltraBeasts) ? r.maxUltraBeasts : d.maxUltraBeasts,
    forms: isBool(r.forms) ? r.forms : d.forms,
    megas: isBool(r.megas) ? r.megas : d.megas,
    maxMegas: isMaxMegas(r.maxMegas) ? r.maxMegas : d.maxMegas,
    setPiece: isBool(r.setPiece) ? r.setPiece : d.setPiece,
    shinies: isBool(r.shinies) ? r.shinies : d.shinies,
    maxTeams:
      typeof r.maxTeams === 'number' && Number.isInteger(r.maxTeams) && r.maxTeams >= DRAFT_LIMITS.minTeams && r.maxTeams <= DRAFT_LIMITS.maxTeams
        ? r.maxTeams
        : d.maxTeams,
    pickSeconds: (DRAFT_LIMITS.pickSeconds as readonly unknown[]).includes(r.pickSeconds)
      ? (r.pickSeconds as DraftSettings['pickSeconds'])
      : d.pickSeconds,
    order: r.order === 'random' || r.order === 'host' ? r.order : d.order,
    snake: isBool(r.snake) ? r.snake : d.snake,
    roll: isRollMode(r.roll) ? r.roll : d.roll,
    rerolls: rerollsOf(r.rerolls, d.rerolls) ?? { ...d.rerolls },
    visibility: r.visibility === 'private' || r.visibility === 'public' ? r.visibility : d.visibility,
    format: (DRAFT_FORMATS as readonly unknown[]).includes(r.format) ? (r.format as DraftSettings['format']) : d.format,
    cupGroups: isBool(r.cupGroups) ? r.cupGroups : d.cupGroups,
    bench: (DRAFT_LIMITS.benchSizes as readonly unknown[]).includes(r.bench) ? (r.bench as DraftSettings['bench']) : d.bench,
    matchdayMinutes: (DRAFT_LIMITS.matchdayMinutes as readonly unknown[]).includes(r.matchdayMinutes)
      ? (r.matchdayMinutes as DraftSettings['matchdayMinutes'])
      : d.matchdayMinutes,
  };
  const keys = Object.keys(next) as (keyof DraftSettings)[];
  // Die älteren Schlüssel region/legends dürfen zusätzlich dastehen (Schnappschüsse spiegeln sie
  // für Clients von vor dem Update – siehe snapshotOf); die neuen Schlüssel haben ohnehin Vorrang.
  const current =
    Object.keys(r).every((k) => Object.hasOwn(next, k) || LEGACY_SETTING_KEYS.includes(k)) &&
    keys.every((k) => Object.hasOwn(r, k) && sameSettingValue(r[k], next[k]));
  return current ? (raw as DraftSettings) : next;
}

/**
 * Zustand einer älteren Liga (z. B. ein laufender Durable Object) in die aktuelle Form – der
 * Server ruft das beim Laden auf. Schon aktuelle Stände kommen unverändert (dasselbe Objekt)
 * zurück. Ältere Ligen haben keinen Zufallsmodus: roll fehlt = freie Wahl.
 */
export function upgradeState(state: DraftState): DraftState {
  const settings = upgradeSettings(state.settings);
  return settings === state.settings ? state : { ...state, settings };
}

/** Pool-relevanter Teil der Einstellungen */
export type DraftPoolSettings = Pick<DraftSettings, 'gens' | 'types' | 'legendary' | 'mythical'> &
  Partial<Pick<DraftSettings, 'ultraBeasts' | 'forms' | 'megas'>>;

/** Legendär oder mysteriös? (zählt fürs Legendären-Limit) */
export const isLegend = (p: Pick<Pokemon, 'leg' | 'myth'>): boolean => !!(p.leg || p.myth);

/**
 * Begrenzte Kategorien – je Team höchstens settings[LIMIT_SETTING[kind]] davon (null = unbegrenzt):
 * 'legend' (Legendäre + Mysteriöse), 'ub' (Ultrabestien), 'mega' (Megas inkl. Proto-Formen).
 * Ein legendäres Mega (Mega-Mewtu X) gehört zu zwei Kategorien und zählt für beide Limits.
 */
export type LimitKind = 'legend' | 'ub' | 'mega';
export const LIMIT_KINDS: readonly LimitKind[] = ['legend', 'ub', 'mega'];

/** Einstellung mit dem Limit der Kategorie */
export const LIMIT_SETTING = { legend: 'maxLegends', ub: 'maxUltraBeasts', mega: 'maxMegas' } as const satisfies Record<
  LimitKind,
  keyof DraftSettings
>;

/** Limits der Einstellungen (fehlen sie – ältere Stände –, gilt: unbegrenzt) */
export type DraftLimitSettings = Partial<Pick<DraftSettings, 'maxLegends' | 'maxUltraBeasts' | 'maxMegas'>>;

const NO_KINDS: readonly LimitKind[] = [];
const kindsCache = new WeakMap<Pick<Pokemon, 'id'>, readonly LimitKind[]>();

/** Begrenzte Kategorien des Pokémon (meist keine oder eine). */
export function limitKindsOf(p: Pick<Pokemon, 'id' | 'leg' | 'myth' | 'form'>): readonly LimitKind[] {
  let kinds = kindsCache.get(p);
  if (!kinds) {
    const k: LimitKind[] = [];
    if (isLegend(p)) k.push('legend');
    if (isUltraBeast(p)) k.push('ub');
    if (isMega(p)) k.push('mega');
    kinds = k.length ? k : NO_KINDS;
    kindsCache.set(p, kinds);
  }
  return kinds;
}

/** Erste begrenzte Kategorie des Pokémon (oder null) – Anzeige. */
export const limitKindOf = (p: Pick<Pokemon, 'id' | 'leg' | 'myth' | 'form'>): LimitKind | null => limitKindsOf(p)[0] ?? null;

/** Gehört das Pokémon zur Kategorie? */
export const hasKind = (p: Pick<Pokemon, 'id' | 'leg' | 'myth' | 'form'>, kind: LimitKind): boolean => limitKindsOf(p).includes(kind);

/** Limit der Kategorie pro Team – null = unbegrenzt. */
export const limitOf = (settings: DraftLimitSettings, kind: LimitKind): number | null => settings[LIMIT_SETTING[kind]] ?? null;

const poolCache = new WeakMap<Pokemon[], Map<string, Pokemon[]>>();

/**
 * Pool der Liga (nach Nummer sortiert): Generation in gens, mindestens ein Typ in types,
 * Legendäre nur mit legendary, Mysteriöse nur mit mythical. Ältere Einstellungen
 * (region/legends) werden vorher umgeschrieben.
 */
export function poolOf(settings: DraftPoolSettings, list: Pokemon[]): Pokemon[] {
  const s: DraftPoolSettings = Array.isArray(settings.gens) && Array.isArray(settings.types) ? settings : upgradeSettings(settings);
  let byKey = poolCache.get(list);
  if (!byKey) {
    byKey = new Map();
    poolCache.set(list, byKey);
  }
  const ultra = s.ultraBeasts ?? true;
  const forms = !!s.forms;
  const megas = !!s.megas;
  const key = `${s.gens.join(',')}|${s.types.join(',')}|${s.legendary ? 1 : 0}${s.mythical ? 1 : 0}${ultra ? 1 : 0}${forms ? 1 : 0}${megas ? 1 : 0}`;
  let pool = byKey.get(key);
  if (!pool) {
    const gens = new Set(s.gens);
    const types = new Set<string>(s.types);
    pool = list
      .filter(
        (p) =>
          gens.has(p.gen) &&
          p.types.some((t) => types.has(t)) &&
          (!p.leg || s.legendary) &&
          (!p.myth || s.mythical) &&
          (ultra || !isUltraBeast(p)) &&
          (!p.form || (isMega(p) ? megas : forms)),
      )
      // Nach Pokédex-Nummer, Formen hinter ihrer Art (ohne Formen: nach Nummer wie bisher)
      .sort(byDex);
    byKey.set(key, pool);
  }
  return pool;
}

const kindCountCache = new WeakMap<Pokemon[], Record<LimitKind, number>>();

/** Pokémon je begrenzter Kategorie in einem (zwischengespeicherten) Pool. */
function kindCounts(pool: Pokemon[]): Record<LimitKind, number> {
  let n = kindCountCache.get(pool);
  if (!n) {
    n = { legend: 0, ub: 0, mega: 0 };
    for (const p of pool) for (const kind of limitKindsOf(p)) n[kind]++;
    kindCountCache.set(pool, n);
  }
  return n;
}

/** Pool-Einstellungen samt Limits (fehlen sie – ältere Stände –, gilt: unbegrenzt) */
export type DraftCapacitySettings = DraftPoolSettings & DraftLimitSettings;

/**
 * Wie viele Picks der Pool für `teams` Teams hergibt: alle unbegrenzten Pokémon, von jeder
 * begrenzten Kategorie (Legendäre, Ultrabestien, Megas) aber nur so viele, wie ihr Limit aufnimmt
 * (teams × Limit). Gehört ein Pokémon zu zwei Kategorien, zählt es bei beiden – die Zahl ist dann
 * eher zu klein als zu groß (der Draft bleibt so nie hängen).
 */
export function poolPickCapacity(settings: DraftCapacitySettings, teams: number, list: Pokemon[]): number {
  const pool = poolOf(settings, list);
  const counts = kindCounts(pool);
  let capacity = pool.length;
  for (const kind of LIMIT_KINDS) {
    const max = limitOf(settings, kind);
    if (max != null) capacity -= Math.max(0, counts[kind] - Math.max(0, teams) * max);
  }
  return capacity;
}

/**
 * Wie viele Teams der Pool höchstens trägt: Poolgröße / Runden – mit Legendären-Limit nur so
 * viele, dass die Pokémon, die das Limit erlaubt, für alle Runden reichen (poolPickCapacity).
 */
export function maxTeamsForPool(
  settings: DraftCapacitySettings & Pick<DraftSettings, 'setPiece'> & Partial<Pick<DraftSettings, 'format' | 'bench'>>,
  list: Pokemon[],
): number {
  const r = rounds(settings);
  let teams = Math.floor(poolOf(settings, list).length / r);
  // Jedes weitere Team braucht r Picks, die Limits geben höchstens je 3 dazu → monoton
  while (teams > 0 && poolPickCapacity(settings, teams, list) < teams * r) teams--;
  return teams;
}

/**
 * Kurzform der Generationen für die Lobby-Zeile (D1-Spalte region): 0 = alle 9,
 * 1–9 = genau diese eine, sonst LOBBY_REGION_MANY (10 = mehrere).
 */
export function lobbyRegionOf(settings: Pick<DraftSettings, 'gens'>): LobbyRegion {
  const gens = settings.gens;
  if (DRAFT_ALL_GENS.every((g) => gens.includes(g))) return 0;
  if (gens.length === 1) return gens[0] as RegionFilter;
  return LOBBY_REGION_MANY;
}

/** Legendäre oder Mysteriöse im Pool? (Lobby-Spalte legends; das Limit wirkt nur dann) */
export const poolHasLegends = (settings: Pick<DraftSettings, 'legendary' | 'mythical'>): boolean =>
  !!(settings.legendary || settings.mythical);

/** Ultrabestien im Pool? (das Ultrabestien-Limit wirkt nur dann; ältere Stände ohne das Feld: ja) */
export const poolHasUltraBeasts = (settings: Partial<Pick<DraftSettings, 'ultraBeasts'>>): boolean => settings.ultraBeasts ?? true;

/** Megas im Pool? (das Mega-Limit wirkt nur dann) */
export const poolHasMegas = (settings: Partial<Pick<DraftSettings, 'megas'>>): boolean => !!settings.megas;

/** Ist die Kategorie im Pool (und ihr Limit damit wirksam)? */
export const poolHasKind = (
  settings: Pick<DraftSettings, 'legendary' | 'mythical'> & Partial<Pick<DraftSettings, 'ultraBeasts' | 'megas'>>,
  kind: LimitKind,
) => (kind === 'legend' ? poolHasLegends(settings) : kind === 'ub' ? poolHasUltraBeasts(settings) : poolHasMegas(settings));

/**
 * Prüft und vervollständigt Einstellungen (wirft DraftError bei Unsinn). Nimmt auch die
 * älteren Schlüssel region/legends an (neue Schlüssel im selben Patch haben Vorrang).
 */
export function normalizeSettings(patch: DraftSettingsPatch, base: DraftSettings, list: Pokemon[]): DraftSettings {
  const p: DraftSettingsPatch = isObj(patch) ? patch : {};
  // Neues Objekt ohne evtl. gespiegelte ältere Schlüssel (Basis aus einem Schnappschuss)
  const s: DraftSettings = withoutLegacy(upgradeSettings(base));
  if (p.name !== undefined) {
    if (typeof p.name !== 'string') fail('bad_settings', 'Ungültiger Liganame');
    // Nach Codepoints kürzen – nie mitten in einem Ersatzpaar (Emoji)
    s.name = Array.from(p.name).slice(0, DRAFT_LIMITS.leagueNameMax).join('');
  }
  // Ältere Clients: region / legends
  if (p.region !== undefined) s.gens = gensOfRegion(p.region) ?? fail('bad_settings', 'Ungültige Region');
  if (p.legends !== undefined) {
    if (!isBool(p.legends)) fail('bad_settings', 'Ungültige Einstellung');
    s.legendary = p.legends;
    s.mythical = p.legends;
  }
  if (p.gens !== undefined) {
    const gens = gensOf(p.gens) ?? fail('bad_settings', 'Ungültige Generationen');
    if (!gens.length) fail('bad_settings', 'Mindestens eine Generation');
    s.gens = gens;
  }
  if (p.types !== undefined) {
    const types = typesOf(p.types) ?? fail('bad_settings', 'Ungültige Typen');
    if (!types.length) fail('bad_settings', 'Mindestens ein Typ');
    s.types = types;
  }
  for (const key of ['legendary', 'mythical', 'ultraBeasts', 'forms', 'megas', 'setPiece', 'shinies', 'snake', 'cupGroups'] as const) {
    if (p[key] !== undefined) {
      if (!isBool(p[key])) fail('bad_settings', 'Ungültige Einstellung');
      s[key] = p[key] as boolean;
    }
  }
  if (p.maxLegends !== undefined) {
    if (!isMaxLegends(p.maxLegends)) fail('bad_settings', 'Ungültiges Legendären-Limit');
    s.maxLegends = p.maxLegends;
  }
  if (p.maxUltraBeasts !== undefined) {
    if (!isMaxUltraBeasts(p.maxUltraBeasts)) fail('bad_settings', 'Ungültiges Ultrabestien-Limit');
    s.maxUltraBeasts = p.maxUltraBeasts;
  }
  if (p.maxMegas !== undefined) {
    if (!isMaxMegas(p.maxMegas)) fail('bad_settings', 'Ungültiges Mega-Limit');
    s.maxMegas = p.maxMegas;
  }
  if (p.maxTeams !== undefined) {
    if (!Number.isInteger(p.maxTeams) || p.maxTeams < DRAFT_LIMITS.minTeams || p.maxTeams > DRAFT_LIMITS.maxTeams) {
      fail('bad_settings', `Zwischen ${DRAFT_LIMITS.minTeams} und ${DRAFT_LIMITS.maxTeams} Teams`);
    }
    s.maxTeams = p.maxTeams;
  }
  if (p.format !== undefined) {
    if (!(DRAFT_FORMATS as readonly unknown[]).includes(p.format)) fail('bad_settings', 'Ungültiger Spielmodus');
    s.format = p.format;
  }
  if (p.bench !== undefined) {
    if (!(DRAFT_LIMITS.benchSizes as readonly unknown[]).includes(p.bench)) fail('bad_settings', 'Ungültige Bank');
    s.bench = p.bench;
  }
  if (p.matchdayMinutes !== undefined) {
    if (!(DRAFT_LIMITS.matchdayMinutes as readonly unknown[]).includes(p.matchdayMinutes)) fail('bad_settings', 'Ungültiger Spieltag-Takt');
    s.matchdayMinutes = p.matchdayMinutes;
  }
  if (p.pickSeconds !== undefined) {
    if (!(DRAFT_LIMITS.pickSeconds as readonly number[]).includes(p.pickSeconds)) fail('bad_settings', 'Ungültiger Timer');
    s.pickSeconds = p.pickSeconds;
  }
  if (p.order !== undefined) {
    if (p.order !== 'random' && p.order !== 'host') fail('bad_settings', 'Ungültige Reihenfolge');
    s.order = p.order;
  }
  if (p.roll !== undefined) {
    if (!isRollMode(p.roll)) fail('bad_settings', 'Ungültiger Zufallsmodus');
    s.roll = p.roll;
  }
  if (p.rerolls !== undefined) s.rerolls = rerollsOf(p.rerolls, s.rerolls) ?? fail('bad_settings', 'Ungültige Rerolls');
  if (p.visibility !== undefined) {
    if (p.visibility !== 'private' && p.visibility !== 'public') fail('bad_settings', 'Ungültige Sichtbarkeit');
    s.visibility = p.visibility;
  }
  const fits = maxTeamsForPool(s, list);
  if (s.maxTeams > fits) {
    // Liegt es an den Limits (ohne sie reichte der Pool für mehr Teams), steht das dabei
    const byLimit = fits < Math.floor(poolOf(s, list).length / rounds(s));
    fail('pool_too_small', `Der Pool reicht nur für ${fits} Teams à ${rounds(s)} Pokémon${byLimit ? ' (Limits)' : ''}`);
  }
  return s;
}

// ---------------------------------------------------------------- Lobby

export interface NewTeam {
  teamId: string;
  deviceId: string;
  name: string;
  formation: FormationId;
}

function assertFormation(f: unknown): asserts f is FormationId {
  if (typeof f !== 'string' || !(FORMATION_IDS as readonly string[]).includes(f)) fail('bad_formation', 'Ungültige Formation');
}

function makeTeam(id: string, name: string, formation: FormationId, cpu: boolean): DraftTeam {
  return { id, name, formation, cpu, online: cpu, slots: FORMATIONS[formation].slots.map(() => null), ss: null };
}

export function createDraft(args: {
  code: string;
  seed: number | string;
  settings: DraftSettingsPatch;
  host: NewTeam;
  now: number;
  list: Pokemon[];
}): DraftState {
  assertFormation(args.host.formation);
  const settings = normalizeSettings(args.settings, DEFAULT_DRAFT_SETTINGS, args.list);
  // Der Host ist noch nicht verbunden – ab jetzt zählt seine Abwesenheit (Host-Wechsel, Lobby-Liste).
  const host: DraftTeam = { ...makeTeam(args.host.teamId, args.host.name, args.host.formation, false), offlineSince: args.now };
  return {
    code: args.code,
    seed: args.seed,
    phase: 'lobby',
    settings,
    teams: [host],
    owners: { [args.host.teamId]: args.host.deviceId },
    hostTeamId: args.host.teamId,
    pickIndex: 0,
    deadline: null,
    picks: [],
    season: null,
    createdAt: args.now,
  };
}

/**
 * Trainer des Geräts an sein Team hängen (null: entfernen). Gleicher Stand → dasselbe Objekt.
 * Ohne Team (Zuschauer) passiert nichts.
 */
export function withTrainer(state: DraftState, deviceId: string, look: TrainerLook | null): DraftState {
  const teamId = teamOfDevice(state, deviceId);
  if (!teamId) return state;
  const team = state.teams.find((t) => t.id === teamId)!;
  if (JSON.stringify(team.trainer ?? null) === JSON.stringify(look)) return state;
  const { trainer: _old, ...rest } = team;
  return { ...state, teams: state.teams.map((t) => (t.id === teamId ? (look ? { ...rest, trainer: look } : rest) : t)) };
}

/** Team des Geräts oder null. */
export function teamOfDevice(state: DraftState, deviceId: string): string | null {
  for (const [teamId, owner] of Object.entries(state.owners)) if (owner === deviceId) return teamId;
  return null;
}

function requireLobby(state: DraftState) {
  if (state.phase !== 'lobby') fail('not_lobby', 'Der Draft hat schon begonnen');
}

function requireHost(state: DraftState, deviceId: string) {
  const team = teamOfDevice(state, deviceId);
  if (!team || team !== state.hostTeamId) fail('not_host', 'Das darf nur der Host');
}

export function joinDraft(state: DraftState, t: NewTeam): DraftState {
  requireLobby(state);
  if (state.career) fail('career', 'Karriere-Saison: Es spielen nur die Teams der Vorsaison');
  assertFormation(t.formation);
  if (teamOfDevice(state, t.deviceId)) fail('already_joined', 'Du bist schon in dieser Liga');
  if (state.banned?.includes(t.deviceId)) fail('banned', 'Der Host hat dich aus dieser Liga entfernt');
  if (state.teams.length >= state.settings.maxTeams) fail('league_full', 'Die Liga ist voll');
  return {
    ...state,
    teams: [...state.teams, makeTeam(t.teamId, t.name, t.formation, false)],
    owners: { ...state.owners, [t.teamId]: t.deviceId },
  };
}

/** Verlassen: in der Lobby wird das Team entfernt (Host wandert weiter), später bleibt es stehen. */
export function leaveDraft(state: DraftState, deviceId: string): DraftState {
  const teamId = teamOfDevice(state, deviceId);
  if (!teamId) return state;
  if (state.phase !== 'lobby') return state;
  const owners = { ...state.owners };
  delete owners[teamId];
  const teams = state.teams.filter((t) => t.id !== teamId);
  let hostTeamId = state.hostTeamId;
  if (hostTeamId === teamId) hostTeamId = teams.find((t) => !t.cpu)?.id ?? null;
  return { ...state, teams, owners, hostTeamId };
}

/**
 * Eigene Trikotnummern setzen (ab dem Draft, auch in Saison und Ergebnis). Bereinigt: 1–99, je Nummer
 * ein Pokémon, nur Pokémon aus dem eigenen Kader; leer = zurück zur Vorgabe. Fehler: not_joined, not_allowed.
 */
export function setTeamJerseys(state: DraftState, deviceId: string, raw: unknown): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  if (state.phase === 'lobby') fail('not_allowed', 'Trikotnummern gibt es ab dem Draft');
  const team = state.teams.find((t) => t.id === teamId)!;
  const jerseys = cleanJerseys(raw, new Set(rosterOf(team)));
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId) return t;
      if (!Object.keys(jerseys).length) {
        const { jerseys: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, jerseys };
    }),
  };
}

/** Wappen des eigenen Teams (null = keins) – jederzeit, reine Optik. */
export function setTeamCrest(state: DraftState, deviceId: string, raw: unknown): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const crest = raw == null ? null : cleanCrest(raw) ?? fail('not_allowed', 'Ungültiges Wappen');
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId) return t;
      if (!crest) {
        const { crest: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, crest };
    }),
  };
}

/** Torjubel des eigenen Teams ('' = keiner) – jederzeit, reine Optik. */
export function setTeamCheer(state: DraftState, deviceId: string, raw: unknown): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const cheer = cleanCheer(raw);
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId) return t;
      if (!cheer) {
        const { cheer: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, cheer };
    }),
  };
}

/** Trikotfarben des eigenen Teams (null = Standard) – jederzeit, reine Optik. */
export function setTeamKit(state: DraftState, deviceId: string, raw: unknown): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const kit = raw == null ? null : cleanKit(raw) ?? fail('not_allowed', 'Unbekannte Trikotfarbe');
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId) return t;
      if (!kit) {
        const { kit: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, kit };
    }),
  };
}

/**
 * Kapitän des eigenen Teams setzen (null = keiner). Im Draft einer aus der Elf – mit dem Ende des
 * Drafts steht das Ergebnis fest, danach nicht mehr; in der Manager-Saison jeder aus dem Kader
 * (zählt an Spieltagen, an denen er in der Aufstellung steht).
 */
export function setTeamCaptain(state: DraftState, deviceId: string, pokemonId: number | null, now = Number.POSITIVE_INFINITY): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const manager = state.phase === 'season' && !!state.manager;
  // Nach dem letzten Pick bleibt bis zum Anpfiff Zeit (Saison-Vorlauf) – das Ergebnis wird dann neu berechnet
  const window_ = captainWindowOpen(state, now);
  if (state.phase !== 'drafting' && !manager && !window_) fail('not_allowed', 'Den Kapitän wählst du im Draft – jetzt steht das Ergebnis fest');
  const team = state.teams.find((t) => t.id === teamId)!;
  const allowed = manager ? rosterOf(team) : team.slots.filter((id): id is number => id != null);
  if (pokemonId != null && !allowed.includes(pokemonId)) fail('not_allowed', 'Der Kapitän muss in deinem Team stehen');
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId) return t;
      if (pokemonId == null) {
        const { captain: _drop, ...rest } = t;
        return rest;
      }
      return { ...t, captain: pokemonId };
    }),
    // Ergebnis mit dem neuen Kapitän neu berechnen (gleicher Saison-Seed; withLeague beim Speichern)
    ...(window_ ? { league: null } : {}),
  };
}

/** Kapitän nach dem letzten Pick noch wählbar? (Liga/Turnier, bis zum Anpfiff) */
export function captainWindowOpen(state: Pick<DraftState, 'phase' | 'season' | 'settings'>, now: number): boolean {
  return state.phase === 'done' && !!state.season && now < state.season.startsAt && upgradeSettings(state.settings).format !== 'manager';
}

export function updateTeam(
  state: DraftState,
  deviceId: string,
  patch: { name?: string; formation?: FormationId },
): DraftState {
  requireLobby(state);
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga noch nicht dabei');
  if (patch.formation !== undefined) assertFormation(patch.formation);
  return {
    ...state,
    teams: state.teams.map((t) =>
      t.id === teamId
        ? {
            ...t,
            name: patch.name ?? t.name,
            ...(patch.formation ? { formation: patch.formation, slots: FORMATIONS[patch.formation].slots.map(() => null) } : {}),
          }
        : t,
    ),
  };
}

export function updateSettings(
  state: DraftState,
  deviceId: string,
  patch: DraftSettingsPatch,
  list: Pokemon[],
): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  // Karriere: Kader stehen schon – nur Name, Sichtbarkeit und Takt lassen sich ändern
  if (state.career && Object.keys(patch).some((k) => !CAREER_SETTINGS.has(k))) {
    fail('career', 'Karriere-Saison: Nur Name, Sichtbarkeit und Takt lassen sich ändern');
  }
  const settings = normalizeSettings(patch, state.settings, list);
  if (settings.maxTeams < state.teams.length) fail('too_many_teams', `Es sind schon ${state.teams.length} Teams dabei`);
  return { ...state, settings };
}

/**
 * Fügt ein CPU-Team hinzu. Name und Formation leiten sich aus dem (öffentlichen) Liga-Code
 * ab – nie aus dem geheimen Seed, sonst ließe er sich aus ihnen zurückrechnen.
 */
export function addCpuTeam(state: DraftState, deviceId: string, teamId: string): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (state.career) fail('career', 'Karriere-Saison: Es spielen nur die Teams der Vorsaison');
  if (state.teams.length >= state.settings.maxTeams) fail('league_full', 'Die Liga ist voll');
  const taken = new Set(state.teams.map((t) => t.name));
  const name = shuffle(streamRng(state.code, 'cpu-names'), CLUB_NAMES).find((n) => !taken.has(n)) ?? `CPU ${state.teams.length + 1}`;
  const cpuCount = state.teams.filter((t) => t.cpu).length;
  const formation = FORMATION_IDS[hashSeed(state.code, 'cpu-formation', cpuCount) % FORMATION_IDS.length];
  return { ...state, teams: [...state.teams, makeTeam(teamId, name, formation, true)] };
}

/** Höchstens so viele gesperrte Geräte pro Liga (die ältesten fallen heraus) */
const MAX_BANNED = 64;

/** Entfernt ein Team; ein Mensch wird für diese Liga gesperrt (kein erneuter Beitritt). */
export function removeTeam(state: DraftState, deviceId: string, teamId: string): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (teamId === state.hostTeamId) fail('cannot_remove_host', 'Der Host kann sich nicht selbst entfernen');
  if (!state.teams.some((t) => t.id === teamId)) fail('no_team', 'Dieses Team gibt es nicht');
  const owners = { ...state.owners };
  const kicked = owners[teamId];
  delete owners[teamId];
  const next: DraftState = { ...state, teams: state.teams.filter((t) => t.id !== teamId), owners };
  if (kicked) next.banned = [...(state.banned ?? []).filter((d) => d !== kicked), kicked].slice(-MAX_BANNED);
  return next;
}

export function setOrder(state: DraftState, deviceId: string, order: string[]): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  const ids = state.teams.map((t) => t.id);
  if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || !order.every((id) => ids.includes(id))) {
    fail('bad_order', 'Die Reihenfolge muss jedes Team genau einmal enthalten');
  }
  const byId = new Map(state.teams.map((t) => [t.id, t]));
  return { ...state, teams: order.map((id) => byId.get(id)!) };
}

/** Online-Flag eines Menschen; mit `now` wird auch offlineSince gepflegt (seit wann offline). */
export function setOnline(state: DraftState, teamId: string, online: boolean, now?: number): DraftState {
  return {
    ...state,
    teams: state.teams.map((t) => {
      if (t.id !== teamId || t.cpu) return t;
      if (now === undefined) return { ...t, online };
      if (online) {
        const { offlineSince: _gone, ...rest } = t;
        return { ...rest, online };
      }
      return { ...t, online, offlineSince: t.online || t.offlineSince == null ? now : t.offlineSince };
    }),
  };
}

/** Seit wann ein Mensch offline ist (ältere Stände ohne Zeitpunkt: seit jeher); null = online bzw. CPU. */
function offlineFrom(t: DraftTeam): number | null {
  if (t.cpu || t.online) return null;
  return t.offlineSince ?? -Infinity;
}

/**
 * Host-Rolle weiterreichen: Ist der Host (Lobby oder Draft) seit DRAFT_LIMITS.hostGraceMs
 * offline, wird der erste verbundene Mensch Host. Sonst unverändert.
 */
export function transferHost(state: DraftState, now: number): DraftState {
  const at = hostTransferAt(state);
  if (at == null || now < at) return state;
  const next = state.teams.find((t) => !t.cpu && t.online && t.id !== state.hostTeamId && state.owners[t.id]);
  return next ? { ...state, hostTeamId: next.id } : state;
}

/** Ab wann die Host-Rolle wandern darf (Host offline bzw. weg) – null, solange der Host da ist. */
export function hostTransferAt(state: DraftState): number | null {
  if (state.phase === 'done') return null;
  const host = state.teams.find((t) => t.id === state.hostTeamId);
  const away = host ? offlineFrom(host) : -Infinity;
  const grace = state.phase === 'lobby' ? DRAFT_LIMITS.lobbyHostGraceMs : DRAFT_LIMITS.hostGraceMs;
  return away == null ? null : away + grace;
}

/**
 * Ab wann andere Mitglieder für das Team am Zug auto-picken dürfen: CPU sofort, ein
 * Mensch nach DRAFT_LIMITS.offlineGraceMs offline – ohne Timer auch, wenn sein Zug
 * DRAFT_LIMITS.afkMs alt ist. null = gerade nicht (online mit Timer, oder kein Draft).
 */
export function autoPickOpensAt(state: DraftState): number | null {
  const cur = currentTeam(state);
  if (!cur) return null;
  if (cur.cpu) return -Infinity;
  const away = offlineFrom(cur);
  const times: number[] = [];
  if (away != null) times.push(away + DRAFT_LIMITS.offlineGraceMs);
  if (!state.settings.pickSeconds && state.turnStartedAt != null) times.push(state.turnStartedAt + DRAFT_LIMITS.afkMs);
  return times.length ? Math.min(...times) : null;
}

/** Darf das Team `teamId` (ein Mitglied) jetzt für das Team am Zug auto-picken? */
export function mayAutoPick(state: DraftState, teamId: string | null, now: number): boolean {
  const cur = currentTeam(state);
  if (!cur || !teamId || !state.owners[teamId]) return false;
  if (cur.id === teamId) return true;
  const at = autoPickOpensAt(state);
  return at != null && now >= at;
}

// ---------------------------------------------------------------- Draft

export function totalPicks(state: Pick<DraftState, 'teams' | 'settings'>): number {
  return state.teams.length * rounds(state.settings);
}

/**
 * Team am Zug für einen Pick-Index. Snake (Standard): jede zweite Runde rückwärts;
 * snake = false: jede Runde dieselbe Reihenfolge (settings.snake).
 */
export function teamIndexForPick(pick: number, teamCount: number, snake = true): number {
  const round = Math.floor(pick / teamCount);
  const idx = pick % teamCount;
  return !snake || round % 2 === 0 ? idx : teamCount - 1 - idx;
}

export function currentTeam(state: DraftView): DraftTeam | null {
  if (state.phase !== 'drafting') return null;
  return state.teams[teamIndexForPick(state.pickIndex, state.teams.length, state.settings.snake ?? true)] ?? null;
}

/**
 * Wie viele Picks vor dem nächsten eigenen liegen (0 = man ist dran) – null, wenn das Team im
 * Draft nicht mehr wählt (oder gar nicht dabei ist).
 */
export function picksUntilTurn(state: DraftView, teamId: string): number | null {
  if (state.phase !== 'drafting') return null;
  const idx = state.teams.findIndex((t) => t.id === teamId);
  if (idx < 0) return null;
  const total = state.teams.length * rounds(state.settings);
  for (let p = state.pickIndex; p < total; p++) {
    if (teamIndexForPick(p, state.teams.length, state.settings.snake ?? true) === idx) return p - state.pickIndex;
  }
  return null;
}

export function draftedIds(state: Pick<DraftState, 'teams'>): Set<number> {
  const ids = new Set<number>();
  for (const t of state.teams) for (const id of rosterOf(t)) ids.add(id);
  return ids;
}

/** Alle Pokémon eines Teams: Elf, Standardschütze, Bank (Manager-Saison) */
export function rosterOf(team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>): number[] {
  const out: number[] = [];
  for (const id of team.slots) if (id != null) out.push(id);
  if (team.ss != null) out.push(team.ss);
  for (const id of team.bench ?? []) if (id != null) out.push(id);
  return out;
}

/** Freie Draft-Slots: Feld (0–10), Standardschütze (DRAFT_SS_SLOT), Bank (DRAFT_BENCH_SLOT + i). */
export function freeSlots(team: DraftTeam, settings: Pick<DraftSettings, 'setPiece'>): number[] {
  const out = team.slots.flatMap((id, i) => (id == null ? [i] : []));
  if (settings.setPiece && team.ss == null) out.push(DRAFT_SS_SLOT);
  (team.bench ?? []).forEach((id, i) => {
    if (id == null) out.push(DRAFT_BENCH_SLOT + i);
  });
  return out;
}

/** Zeitpunkt, bis zu dem der aktuelle Pick fallen muss (nur menschliche Teams mit Timer). */
function deadlineFor(state: DraftState, now: number): number | null {
  const team = currentTeam(state);
  if (!team || team.cpu || !state.settings.pickSeconds) return null;
  return now + state.settings.pickSeconds * 1000;
}

// ---------------------------------------------------------------- Regeln eines Picks (Wurf, Legendären-Limit)

const byIdCache = new WeakMap<Pokemon[], Map<number, Pokemon>>();

function byIdOf(list: Pokemon[]): Map<number, Pokemon> {
  let byId = byIdCache.get(list);
  if (!byId) {
    byId = new Map(list.map((p) => [p.id, p]));
    byIdCache.set(list, byId);
  }
  return byId;
}

const poolIdCache = new WeakMap<Pokemon[], Set<number>>();

function poolIdsOf(pool: Pokemon[]): Set<number> {
  let ids = poolIdCache.get(pool);
  if (!ids) {
    ids = new Set(pool.map((p) => p.id));
    poolIdCache.set(pool, ids);
  }
  return ids;
}

/** Pokémon der begrenzten Kategorie im Team (der Standardschütze zählt mit). */
export function kindOf(team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>, kind: LimitKind, list: Pokemon[]): number {
  const byId = byIdOf(list);
  let n = 0;
  for (const id of rosterOf(team)) {
    const p = id != null ? byId.get(id) : undefined;
    if (p && hasKind(p, kind)) n++;
  }
  return n;
}

/** Legendäre + Mysteriöse im Team (der Standardschütze zählt mit). */
export const legendsOf = (team: Pick<DraftTeam, 'slots' | 'ss' | 'bench'>, list: Pokemon[]): number => kindOf(team, 'legend', list);

/** Kategorien, deren Limit das Team erreicht hat (ohne Limit: nie). */
function limitsHit(settings: DraftLimitSettings, team: DraftTeam, list: Pokemon[]): Set<LimitKind> {
  const hit = new Set<LimitKind>();
  for (const kind of LIMIT_KINDS) {
    const max = limitOf(settings, kind);
    if (max != null && kindOf(team, kind, list) >= max) hit.add(kind);
  }
  return hit;
}

/** Sperrt eines der erreichten Limits das Pokémon? */
const blockedBy = (hit: Set<LimitKind>, p: Pokemon): LimitKind | null => {
  if (!hit.size) return null;
  return limitKindsOf(p).find((kind) => hit.has(kind)) ?? null;
};

/** Passt das Pokémon zum Wurf (diese Generation und einer seiner Typen)? */
export const matchesRoll = (p: Pick<Pokemon, 'gen' | 'types'>, roll: DraftRoll): boolean =>
  p.gen === roll.gen && p.types.includes(roll.type);

/**
 * Warum ein Pokémon gerade nicht wählbar ist: 'pool' (nicht im Pool), 'taken' (schon
 * vergeben), 'roll' (passt nicht zum Wurf), 'legend_limit' (Legendären-Limit erreicht),
 * 'ub_limit' (Ultrabestien-Limit erreicht), 'mega_limit' (Mega-Limit erreicht).
 */
export type PickBlock = 'pool' | 'taken' | 'roll' | 'legend_limit' | 'ub_limit' | 'mega_limit';

const LIMIT_BLOCK = { legend: 'legend_limit', ub: 'ub_limit', mega: 'mega_limit' } as const satisfies Record<LimitKind, PickBlock>;

/** Noch freie Pool-Pokémon (nach Nummer sortiert). */
function remainingPool(state: Pick<DraftState, 'teams' | 'settings'>, list: Pokemon[]): Pokemon[] {
  const taken = draftedIds(state);
  return poolOf(state.settings, list).filter((p) => !taken.has(p.id));
}

/** Wurf des aktuellen Picks – nur, wenn der Zufallsmodus an ist. */
function stateRollOf(state: DraftView): DraftActiveRoll | null {
  return state.roll && state.settings.roll !== 'off' ? state.roll : null;
}

interface PickRules {
  // Fingerabdruck des Zustands, für den die Regeln gelten (Cache)
  list: Pokemon[];
  phase: DraftPhase;
  pickIndex: number;
  teams: DraftTeam[];
  settings: DraftSettings;
  stateRoll: DraftActiveRoll | null | undefined;
  // Regeln
  poolIds: Set<number>;
  taken: Set<number>;
  /** Wurf, der für dieses Team gerade gilt (null = freie Wahl) */
  roll: DraftRoll | null;
  /** Kategorien, deren Limit das Team erreicht hat … */
  limitHit: Set<LimitKind>;
  /** … aber im Rest des Pools gibt es nur noch gesperrte: Limits ausgesetzt (der Draft bleibt nie hängen) */
  waived: boolean;
  /** Beim Aussetzen: so viele erreichte Limits darf ein Pokémon brechen (die wenigsten im Rest) */
  waiveUpTo: number;
  /** Erlaubte Pokémon (nach Nummer sortiert) */
  allowed: Pokemon[];
}

function computeRules(state: DraftView, teamId: string, list: Pokemon[]): PickRules {
  const pool = poolOf(state.settings, list);
  const taken = draftedIds(state);
  const remaining = pool.filter((p) => !taken.has(p.id));
  const team = state.teams.find((t) => t.id === teamId);
  const limitHit = team ? limitsHit(state.settings, team, list) : new Set<LimitKind>();
  const blocked = (p: Pokemon) => blockedBy(limitHit, p) != null;
  const cur = currentTeam(state);
  const raw = cur && cur.id === teamId ? stateRollOf(state) : null;
  // Ein Wurf ohne Wählbares (sollte nie vorkommen, z. B. nach geänderten Daten) gilt nicht: freie Wahl
  const roll = raw && remaining.some((p) => matchesRoll(p, raw) && !blocked(p)) ? { gen: raw.gen, type: raw.type } : null;
  const waived = limitHit.size > 0 && !roll && remaining.every(blocked);
  // Ausgesetzt wird nur so weit wie nötig: Bricht ein Rest-Pokémon nur ein Limit (Mewtu), ist ein
  // legendäres Mega (beide Limits) weiter gesperrt
  const hits = (p: Pokemon) => limitKindsOf(p).filter((k) => limitHit.has(k)).length;
  const waiveUpTo = waived ? Math.min(...remaining.map(hits)) : 0;
  const allowed = remaining.filter((p) => (!roll || matchesRoll(p, roll)) && (waived ? hits(p) <= waiveUpTo : !blocked(p)));
  return {
    list,
    phase: state.phase,
    pickIndex: state.pickIndex,
    teams: state.teams,
    settings: state.settings,
    stateRoll: state.roll,
    poolIds: poolIdsOf(pool),
    taken,
    roll,
    limitHit,
    waived,
    waiveUpTo,
    allowed,
  };
}

/** Regeln je Zustand (Objekt) und Team – das Pool-Raster fragt sie für jede Karte ab. */
const rulesCache = new WeakMap<object, Map<string, PickRules>>();

function rulesFor(state: DraftView, teamId: string, list: Pokemon[]): PickRules {
  let byTeam = rulesCache.get(state);
  if (!byTeam) {
    byTeam = new Map();
    rulesCache.set(state, byTeam);
  }
  const hit = byTeam.get(teamId);
  if (
    hit &&
    hit.list === list &&
    hit.phase === state.phase &&
    hit.pickIndex === state.pickIndex &&
    hit.teams === state.teams &&
    hit.settings === state.settings &&
    hit.stateRoll === state.roll
  ) {
    return hit;
  }
  const rules = computeRules(state, teamId, list);
  byTeam.set(teamId, rules);
  return rules;
}

function blockOf(rules: PickRules, p: Pokemon): PickBlock | null {
  if (!rules.poolIds.has(p.id)) return 'pool';
  if (rules.taken.has(p.id)) return 'taken';
  if (rules.roll && !matchesRoll(p, rules.roll)) return 'roll';
  if (rules.waived && limitKindsOf(p).filter((k) => rules.limitHit.has(k)).length <= rules.waiveUpTo) return null;
  const kind = blockedBy(rules.limitHit, p);
  return kind ? LIMIT_BLOCK[kind] : null;
}

/**
 * Darf das Team dieses Pokémon gerade wählen? null = ja, sonst der Grund (PickBlock). Der Wurf
 * gilt nur für das Team am Zug, das Legendären-Limit immer (ausgesetzt nur, wenn im Rest des
 * Pools nur noch Legendäre sind). Ob das Team dran ist und der Slot frei, prüft pickError.
 * Schnell genug für jede Karte im Pool-Raster (Regeln je Zustand und Team zwischengespeichert).
 */
export function pickAllowed(state: DraftView, teamId: string, pokemon: Pokemon | number, list: Pokemon[]): PickBlock | null {
  const p = typeof pokemon === 'number' ? byIdOf(list).get(pokemon) : pokemon;
  if (!p) return 'pool';
  return blockOf(rulesFor(state, teamId, list), p);
}

/** Alle Pokémon, die das Team gerade wählen darf (nach Nummer sortiert) – wie pickAllowed. */
export function allowedPicks(state: DraftView, teamId: string, list: Pokemon[]): Pokemon[] {
  return rulesFor(state, teamId, list).allowed.slice();
}

/**
 * Wurf, der für das Team gerade gilt (null = freie Wahl): der Wurf des Zustands, wenn das Team
 * am Zug ist und er etwas Wählbares hat.
 */
export function effectiveRoll(state: DraftView, teamId: string, list: Pokemon[]): DraftRoll | null {
  return rulesFor(state, teamId, list).roll;
}

// ---------------------------------------------------------------- Würfe (Zufallsmodus)

/** So oft wird frei gewürfelt, bevor alle Kombinationen der Reihe nach probiert werden */
const ROLL_ATTEMPTS = 40;

const comboKey = (gen: number, type: TypeKey) => `${gen}|${type}`;

/** Je Kombination (Generation|Typ) die Zahl der Pokémon aus `pokemon`, die `ok` erfüllen. */
function comboCounts(settings: Pick<DraftSettings, 'types'>, pokemon: Pokemon[], ok: (p: Pokemon) => boolean): Map<string, number> {
  const types = new Set<TypeKey>(settings.types);
  const counts = new Map<string, number>();
  for (const p of pokemon) {
    if (!ok(p)) continue;
    for (const t of p.types) {
      if (!types.has(t)) continue;
      const key = comboKey(p.gen, t);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Für das Team wählbare Kombinationen: frei und nicht durch seine Limits gesperrt. */
function pickableFor(state: Pick<DraftState, 'teams' | 'settings'>, team: DraftTeam, list: Pokemon[], remaining = remainingPool(state, list)) {
  const hit = limitsHit(state.settings, team, list);
  const counts = comboCounts(state.settings, remaining, (p) => blockedBy(hit, p) == null);
  return (c: DraftRoll) => (counts.get(comboKey(c.gen, c.type)) ?? 0) > 0;
}

/**
 * Zufälliger Wurf (Generation aus gens, Typ aus types), bis accept[0] passt; danach alle
 * Kombinationen in zufälliger Reihenfolge – erst nach accept[0], dann accept[1] … null = keine.
 */
function drawRoll(rng: Rng, settings: Pick<DraftSettings, 'gens' | 'types'>, accept: ((c: DraftRoll) => boolean)[]): DraftRoll | null {
  const { gens, types } = settings;
  if (!gens.length || !types.length) return null;
  for (let i = 0; i < ROLL_ATTEMPTS; i++) {
    const c: DraftRoll = { gen: gens[Math.floor(rng() * gens.length)], type: types[Math.floor(rng() * types.length)] };
    if (accept[0](c)) return c;
  }
  const combos = shuffle(
    rng,
    gens.flatMap((gen) => types.map((type): DraftRoll => ({ gen, type }))),
  );
  for (const ok of accept) {
    const c = combos.find(ok);
    if (c) return c;
  }
  return null;
}

/**
 * Wurf für den aktuellen Pick (nach dem Start und nach jedem Pick). 'pick': eigener Wurf je
 * Pick. 'round': zu Rundenbeginn ein Rundenwurf (möglichst mit so vielen freien Pokémon wie
 * Teams); hat er für das Team am Zug nichts Wählbares, bekommt es einen eigenen Wurf. Ohne
 * wählbare Kombination: roll = null (freie Wahl).
 */
function rollsFor(state: DraftState, list: Pokemon[]): Pick<DraftState, 'roll' | 'roundRoll'> {
  const mode = state.settings.roll;
  const team = currentTeam(state);
  if (mode !== 'pick' && mode !== 'round') return { roll: null };
  if (!team) return mode === 'round' ? { roll: null, roundRoll: null } : { roll: null };
  const remaining = remainingPool(state, list);
  const pickable = pickableFor(state, team, list, remaining);
  if (mode === 'pick') {
    const r = drawRoll(leagueRng(state.seed, 'roll', 'pick', state.pickIndex), state.settings, [pickable]);
    return { roll: r && { ...r, own: false } };
  }
  const n = state.teams.length;
  let roundRoll = state.roundRoll ?? null;
  if (state.pickIndex % n === 0 || state.roundRoll === undefined) {
    // Möglichst ein Wurf, der für alle Teams der Runde reicht (begrenzte zählen, solange noch ein Team darf)
    const full = new Set(
      LIMIT_KINDS.filter((kind) => {
        const max = limitOf(state.settings, kind);
        return max != null && state.teams.every((t) => kindOf(t, kind, list) >= max);
      }),
    );
    const shared = comboCounts(state.settings, remaining, (p) => blockedBy(full, p) == null);
    const enough = (c: DraftRoll) => pickable(c) && (shared.get(comboKey(c.gen, c.type)) ?? 0) >= n;
    const round = Math.floor(state.pickIndex / n);
    roundRoll = drawRoll(leagueRng(state.seed, 'roll', 'round', round), state.settings, [enough, pickable]);
  }
  if (roundRoll && pickable(roundRoll)) return { roll: { ...roundRoll, own: false }, roundRoll };
  const own = drawRoll(leagueRng(state.seed, 'roll', 'own', state.pickIndex), state.settings, [pickable]);
  return { roll: own && { ...own, own: true }, roundRoll };
}

const NO_REROLLS: DraftRerollCount = { type: 0, region: 0 };

/** Genutzte Rerolls des Teams. */
export function rerollsUsedOf(state: Pick<DraftState, 'rerollsUsed'>, teamId: string): DraftRerollCount {
  return state.rerollsUsed?.[teamId] ?? NO_REROLLS;
}

/** Übrige Rerolls dieser Art für das Team (0 ohne Zufallsmodus). */
export function rerollsLeft(state: Pick<DraftState, 'settings' | 'rerollsUsed'>, teamId: string, kind: DraftRerollKind): number {
  const mode = state.settings.roll;
  if ((mode !== 'pick' && mode !== 'round') || !DRAFT_REROLL_KINDS.includes(kind)) return 0;
  return Math.max(0, (state.settings.rerolls?.[kind] ?? 0) - (rerollsUsedOf(state, teamId)[kind] ?? 0));
}

/**
 * Kann es für diese Reroll-Art überhaupt eine Alternative geben? Rerolls eingestellt und mehr als
 * eine Generation (Region) bzw. ein Typ im Pool – sonst ginge der Reroll nie (Formular, Kurzfassung
 * und Live-Ansicht bieten ihn dann nicht an).
 */
export function rerollUsable(settings: Pick<DraftSettings, 'rerolls' | 'gens' | 'types'>, kind: DraftRerollKind): boolean {
  return (settings.rerolls?.[kind] ?? 0) > 0 && (kind === 'region' ? settings.gens.length > 1 : settings.types.length > 1);
}

/** Andere wählbare Würfe für einen Reroll: 'type' = gleiche Generation, anderer Typ; 'region' umgekehrt. */
function rerollOptions(state: DraftView, team: DraftTeam, kind: DraftRerollKind, list: Pokemon[]): DraftRoll[] {
  const roll = stateRollOf(state);
  if (!roll) return [];
  const pickable = pickableFor(state, team, list);
  const options: DraftRoll[] =
    kind === 'type'
      ? state.settings.types.filter((t) => t !== roll.type).map((type) => ({ gen: roll.gen, type }))
      : state.settings.gens.filter((g) => g !== roll.gen).map((gen) => ({ gen, type: roll.type }));
  return options.filter(pickable);
}

/** Kann das Team jetzt neu würfeln (am Zug, kein CPU-Team, Wurf da, Reroll übrig, andere Möglichkeit)? */
export function canReroll(state: DraftRollView, teamId: string, kind: DraftRerollKind, list: Pokemon[]): boolean {
  const team = currentTeam(state);
  if (!team || team.id !== teamId || team.cpu || !stateRollOf(state)) return false;
  if (rerollsLeft(state, teamId, kind) <= 0) return false;
  return rerollOptions(state, team, kind, list).length > 0;
}

/**
 * Reroll des Teams am Zug: Ändert nur den Wurf seines aktuellen Picks (auch im Runden-Modus –
 * der Rundenwurf bleibt) – 'type': neuer Typ, gleiche Generation; 'region': neue Generation,
 * gleicher Typ – gleichverteilt unter den wählbaren Alternativen. Danach gilt er als eigener
 * Wurf (own). Fehler: not_drafting, not_your_turn, no_roll, no_reroll, no_other_roll.
 */
export function applyReroll(state: DraftState, teamId: string, kind: DraftRerollKind, list: Pokemon[]): DraftState {
  if (state.phase !== 'drafting') return fail('not_drafting', 'Gerade wird nicht gedraftet');
  const team = currentTeam(state);
  if (!team || team.id !== teamId || team.cpu) return fail('not_your_turn', 'Du bist nicht dran');
  if (!stateRollOf(state)) return fail('no_roll', 'Gerade gibt es keinen Wurf');
  if (rerollsLeft(state, teamId, kind) <= 0) {
    return fail('no_reroll', kind === 'region' ? 'Kein Regions-Reroll mehr übrig' : 'Kein Typ-Reroll mehr übrig');
  }
  const options = rerollOptions(state, team, kind, list);
  if (!options.length) return fail('no_other_roll', 'Kein anderer Wurf möglich');
  const used = rerollsUsedOf(state, teamId);
  const rng = leagueRng(state.seed, 'roll', 'reroll', kind, state.pickIndex, used[kind]);
  const next = options[Math.floor(rng() * options.length)];
  return {
    ...state,
    roll: { gen: next.gen, type: next.type, own: true },
    rerollsUsed: { ...state.rerollsUsed, [teamId]: { ...used, [kind]: used[kind] + 1 } },
  };
}

// ---------------------------------------------------------------- Picks

export function startDraft(state: DraftState, deviceId: string, now: number, list: Pokemon[], scale?: Scale): DraftState {
  requireLobby(state);
  requireHost(state, deviceId);
  if (state.career) return startCareerSeason(state, now, list, scale ?? draftScaleOf(list));
  if (state.teams.length < DRAFT_LIMITS.minTeams) fail('too_few_teams', `Mindestens ${DRAFT_LIMITS.minTeams} Teams – lade Leute ein oder füge CPU-Teams hinzu`);
  const needed = state.teams.length * rounds(state.settings);
  const pool = poolOf(state.settings, list).length;
  if (pool < needed) fail('pool_too_small', `Der Pool hat nur ${pool} Pokémon, gebraucht werden ${needed}`);
  // Begrenzte zählen nur, soweit die Limits sie aufnehmen (sonst müssten sie für alle ausgesetzt werden)
  const capacity = poolPickCapacity(state.settings, state.teams.length, list);
  if (capacity < needed) {
    fail('pool_too_small', `Mit den Limits reicht der Pool nur für ${capacity} Picks, gebraucht werden ${needed}`);
  }
  const teams =state.settings.order === 'random' ? shuffle(leagueRng(state.seed, 'order'), state.teams) : state.teams;
  const next: DraftState = {
    ...state,
    phase: 'drafting',
    teams: teams.map((t) => {
      const { bench: _old, ...rest } = t;
      const bench = benchSize(state.settings);
      return { ...rest, slots: FORMATIONS[t.formation].slots.map(() => null), ss: null, ...(bench ? { bench: Array<null>(bench).fill(null) } : {}) };
    }),
    pickIndex: 0,
    picks: [],
    turnStartedAt: now,
    rerollsUsed: {},
  };
  const rolled: DraftState = { ...next, ...rollsFor(next, list) };
  return { ...rolled, deadline: deadlineFor(rolled, now) };
}

/** Kapitän eines CPU-Teams: der Spieler der Elf mit der besten Positionspassung (keiner ohne Spieler). */
export function cpuCaptain(t: Pick<DraftTeam, 'formation' | 'slots'>, byId: Map<number, Pokemon>, scale: Scale): number | null {
  const defs = FORMATIONS[t.formation].slots;
  let best: number | null = null;
  let bestFit = -1;
  t.slots.forEach((id, i) => {
    const p = id != null ? byId.get(id) : undefined;
    if (!p || !defs[i]) return;
    const f = positionFit(p, defs[i].pos, scale);
    if (f > bestFit) {
      bestFit = f;
      best = p.id;
    }
  });
  return best;
}

function withCpuCaptain(t: DraftTeam, byId: Map<number, Pokemon>, scale: Scale): DraftTeam {
  const captain = cpuCaptain(t, byId, scale);
  return captain != null ? { ...t, captain } : t;
}

/** Diese Einstellungen darf der Host in einer Karriere-Lobby noch ändern */
const CAREER_SETTINGS = new Set(['name', 'visibility', 'matchdayMinutes']);

let scaleCache: { list: Pokemon[]; scale: Scale } | null = null;
/** Skala aller Pokémon (wie der Server) – für Aufrufe ohne mitgegebene Skala */
function draftScaleOf(list: Pokemon[]): Scale {
  if (scaleCache?.list !== list) scaleCache = { list, scale: buildScale(list, 'all') };
  return scaleCache.scale;
}

/**
 * Karriere-Saison starten (statt Draft): Jedes Team behält seinen Kader der Vorsaison und stellt
 * ihn in seiner Formation auf (beste Elf, Rest auf die Bank). Danach wie am Ende eines Drafts.
 */
function startCareerSeason(state: DraftState, now: number, list: Pokemon[], scale: Scale): DraftState {
  if (state.teams.length < DRAFT_LIMITS.minTeams) fail('too_few_teams', `Mindestens ${DRAFT_LIMITS.minTeams} Teams`);
  const settings = upgradeSettings(state.settings);
  const byId = byIdOf(list);
  const benchSize_ = benchSize(state.settings);
  const teams = state.teams.map((t) => {
    const roster = rosterOf(t).flatMap((id) => byId.get(id) ?? []);
    const best = bestEleven(t.formation, roster, scale, { setPiece: settings.setPiece });
    const used = new Set([...best.slots, best.ss].filter((x): x is number => x != null));
    const rest = roster.map((p) => p.id).filter((id) => !used.has(id));
    const bench = Array.from({ length: benchSize_ }, (_, i) => rest[i] ?? null);
    return { ...t, slots: best.slots, ss: settings.setPiece ? best.ss : null, ...(benchSize_ ? { bench } : {}) };
  });
  const stepMs = settings.matchdayMinutes * 60_000;
  return {
    ...state,
    teams,
    phase: 'season',
    deadline: null,
    turnStartedAt: null,
    pickIndex: 0,
    picks: [],
    season: { seed: leagueSeed(state.seed, 'season'), startsAt: now + Math.min(stepMs, DRAFT_LIMITS.managerLeadMs), stepMs },
  };
}

/** Grund, warum dieser Pick nicht geht – oder null. */
export function pickError(state: DraftView, teamId: string, pokemonId: number, slot: number, list: Pokemon[]): string | null {
  if (state.phase !== 'drafting') return 'Gerade wird nicht gedraftet';
  const team = currentTeam(state);
  if (!team || team.id !== teamId) return 'Du bist nicht dran';
  if (!Number.isInteger(pokemonId) || !Number.isInteger(slot)) return 'Ungültiger Pick';
  const p = byIdOf(list).get(pokemonId);
  const block = p ? pickAllowed(state, teamId, p, list) : 'pool';
  if (!p || block === 'pool') return 'Dieses Pokémon ist nicht im Pool';
  if (block === 'taken') return `${p.de} ist schon vergeben`;
  if (block === 'roll') return `${p.de} passt nicht zum Wurf`;
  if (block === 'legend_limit') {
    const max = state.settings.maxLegends;
    return max === 1 ? 'Höchstens ein Legendäres/Mysteriöses pro Team' : `Höchstens ${max} Legendäre/Mysteriöse pro Team`;
  }
  if (block === 'ub_limit') {
    const max = state.settings.maxUltraBeasts;
    return max === 1 ? 'Höchstens eine Ultrabestie pro Team' : `Höchstens ${max} Ultrabestien pro Team`;
  }
  if (block === 'mega_limit') {
    const max = state.settings.maxMegas;
    return max === 1 ? 'Höchstens ein Mega pro Team' : `Höchstens ${max} Megas pro Team`;
  }
  if (!freeSlots(team, state.settings).includes(slot)) return 'Dieser Platz ist nicht frei';
  return null;
}

export function applyPick(
  state: DraftState,
  teamId: string,
  pokemonId: number,
  slot: number,
  auto: boolean,
  now: number,
  list: Pokemon[],
): DraftState {
  const err = pickError(state, teamId, pokemonId, slot, list);
  if (err) fail('bad_pick', err);
  const roll = rulesFor(state, teamId, list).roll;
  const teams = state.teams.map((t) =>
    t.id !== teamId
      ? t
      : slot === DRAFT_SS_SLOT
        ? { ...t, ss: pokemonId }
        : slot >= DRAFT_BENCH_SLOT
          ? { ...t, bench: (t.bench ?? []).map((v, i) => (i === slot - DRAFT_BENCH_SLOT ? pokemonId : v)) }
          : { ...t, slots: t.slots.map((v, i) => (i === slot ? pokemonId : v)) },
  );
  const log: DraftPickLog = { pick: state.pickIndex, teamId, pokemonId, slot, auto, at: now };
  // Shiny? Aus dem geheimen Liga-Seed – erst beim Pick bekannt
  const shiny = upgradeSettings(state.settings).shinies && shinyRoll(leagueSeed(state.seed, 'shiny'), pokemonId);
  if (shiny) log.shiny = true;
  // Vergeben → von allen Wunschlisten streichen
  const queues = state.queues && withoutQueued(state.queues, pokemonId);
  if (roll) log.roll = { gen: roll.gen, type: roll.type };
  const picks = [...state.picks, log];
  const pickIndex = state.pickIndex + 1;
  const next: DraftState = {
    ...state,
    teams,
    picks,
    pickIndex,
    turnStartedAt: now,
    ...(queues ? { queues } : {}),
    ...(shiny ? { shinies: [...(state.shinies ?? []), pokemonId] } : {}),
  };
  if (pickIndex >= totalPicks(next)) {
    // Manager-Saison: Spieltage im eingestellten Takt, der erste nach höchstens managerLeadMs
    const settings = upgradeSettings(state.settings);
    const manager = settings.format === 'manager';
    const stepMs = manager ? settings.matchdayMinutes * 60_000 : DRAFT_LIMITS.seasonStepMs;
    // CPU-Teams bestimmen ihren Kapitän: den Spieler, der am besten auf seine Position passt
    const sc = draftScaleOf(list);
    const byId = byIdOf(list);
    return {
      ...next,
      teams: next.teams.map((t) => (t.cpu && t.captain == null ? withCpuCaptain(t, byId, sc) : t)),
      phase: manager ? 'season' : 'done',
      deadline: null,
      turnStartedAt: null,
      roll: null,
      ...(state.roundRoll !== undefined ? { roundRoll: null } : {}),
      season: {
        seed: leagueSeed(state.seed, 'season'),
        startsAt: now + (manager ? Math.min(stepMs, DRAFT_LIMITS.managerLeadMs) : DRAFT_LIMITS.seasonLeadMs),
        stepMs,
      },
    };
  }
  const rolled: DraftState = { ...next, ...rollsFor(next, list) };
  return { ...rolled, deadline: deadlineFor(rolled, now) };
}

/**
 * Automatische Wahl: Hat das Team (ein Mensch) eine Wunschliste, das erste erlaubte Pokémon
 * davon auf seinen besten freien Platz. Sonst bestes Pokémon für den Slot, der es am meisten braucht –
 * bewertet wie der Team-Score (Fit × Positionsgewicht). CPU-Teams bekommen etwas
 * Zufall aus dem Liga-Seed, Auto-Picks für Menschen (Timer) nicht. Gewählt wird nur,
 * was die Regeln erlauben (Wurf, Legendären-Limit – siehe pickAllowed); CPU-Teams würfeln nie neu.
 */
export function autoPickChoice(
  state: DraftState,
  teamId: string,
  list: Pokemon[],
  scale: Scale,
  withNoise: boolean,
): { pokemonId: number; slot: number } {
  const team = state.teams.find((t) => t.id === teamId) ?? fail('no_team', 'Dieses Team gibt es nicht');
  const rules = rulesFor(state, teamId, list);
  if (!rules.allowed.length) fail('pool_empty', 'Keine Pokémon mehr im Pool');
  // Wunschliste (nur Menschen, ohne Zufall): das erste erlaubte Pokémon – auf seinen besten Platz
  const byId = byIdOf(list);
  const wished = withNoise
    ? undefined
    : state.queues?.[teamId]?.map((id) => byId.get(id)).find((p): p is Pokemon => !!p && blockOf(rules, p) == null);
  const pool = wished ? [wished] : rules.allowed;
  const rng = withNoise ? leagueRng(state.seed, 'cpu', state.pickIndex) : null;
  const defs = FORMATIONS[team.formation].slots;
  let best: { score: number; pokemonId: number; slot: number } | null = null;
  // Bank (Manager-Saison): bester Fit über die Positionen der eigenen Formation – nach Elf und Standardschütze
  const benchPositions = [...new Set(defs.map((d) => d.pos))];
  for (const slot of freeSlots(team, state.settings)) {
    const bench = slot >= DRAFT_BENCH_SLOT;
    const pos = slot === DRAFT_SS_SLOT ? 'SS' : bench ? null : defs[slot].pos;
    // Standardschütze zählt nicht zum Team-Score → erst am Ende besetzen, die Bank noch danach
    const weight = bench ? 0.4 : pos === 'SS' ? 0.5 : 0.92 + 0.08 * POSITIONS[pos!].teamWeight;
    for (const p of pool) {
      const noise = rng ? (rng() - 0.5) * 8 : 0;
      const fit = pos ? positionFit(p, pos, scale) : Math.max(...benchPositions.map((bp) => positionFit(p, bp, scale)));
      const score = fit * weight + noise;
      if (!best || score > best.score || (score === best.score && p.id < best.pokemonId)) {
        best = { score, pokemonId: p.id, slot };
      }
    }
  }
  if (!best) return fail('no_slot', 'Kein Platz mehr frei');
  return { pokemonId: best.pokemonId, slot: best.slot };
}

// ---------------------------------------------------------------- Saison & Ausgabe

/** Liga-Teams mit Rating (Team-Score) und Kader für die Saison-Simulation. */
export function leagueTeams(
  state: Pick<DraftState, 'teams' | 'settings'> & { shinies?: readonly number[] },
  byId: Map<number, Pokemon>,
  scale: Scale,
): LeagueTeam[] {
  const shinies = state.shinies?.length ? new Set(state.shinies) : undefined;
  const fitBonus = shinies ? (id: number) => (shinies.has(id) ? SHINY_FIT_BONUS : 0) : undefined;
  return state.teams.map((t) => {
    const players = t.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
    const evBase = evaluateTeam(t.formation, players, scale, t.captain, fitBonus);
    // Shinys heben das ganze Team (je schwächer das Pokémon, desto mehr)
    const ev = shinies ? { ...evBase, score: Math.min(1000, evBase.score + shinyBonus(players, shinies)) } : evBase;
    const defs = FORMATIONS[t.formation].slots;
    const ss = t.ss != null ? byId.get(t.ss) : undefined;
    return {
      name: t.name,
      rating: ev.score,
      squad: players.flatMap((p, i) => (p ? [{ pokemonId: p.id, pos: defs[i].pos, atk: p.atk, spa: p.spa }] : [])),
      setPieceTaker: ss ? { pokemonId: ss.id, pos: 'SS' as const, atk: ss.atk, spa: ss.spa } : null,
      setPieceFit: ss ? positionFit(ss, 'SS', scale) : undefined,
    };
  });
}

/** Kandidat zum Auffüllen der Liga: Bestwert eines echten Spielers aus der Allzeit-Rangliste */
export interface FillCandidate {
  player: string;
  /** Ranglisten-Eintrag (Profil-Link) */
  entryId?: string;
  teamName: string;
  formation: FormationId;
  /** Elf in der Reihenfolge der Formation */
  slots: (number | null)[];
  ss: number | null;
}

/**
 * Auffüllteams bis DRAFT_LIMITS.leagueSize: zuerst Teams echter Spieler (zufällig aus den
 * Kandidaten, Liga-Seed; nur vollständige, bekannte Elfen; Namen nicht doppelt), Rating = Team-Score
 * ihrer Elf; reichen sie nicht, Vereine mit Ratings wie die Challenge-Gegner (ohne Kader).
 */
export function fillTeams(
  state: Pick<DraftState, 'seed' | 'teams'> & Partial<Pick<DraftState, 'settings'>>,
  candidates: readonly FillCandidate[],
  byId: Map<number, Pokemon>,
  scale: Scale,
  size: number = DRAFT_LIMITS.leagueSize,
): LeagueTeam[] {
  const need = Math.max(0, size - state.teams.length);
  if (!need) return [];
  const rng = leagueRng(state.seed, 'fill');
  const taken = new Set(state.teams.map((t) => t.name.trim().toLowerCase()));
  const out: LeagueTeam[] = [];
  for (const c of shuffle(rng, candidates)) {
    if (out.length >= need) break;
    const name = (c.teamName.trim() || c.player.trim()).slice(0, DRAFT_LIMITS.teamNameMax);
    const def = FORMATIONS[c.formation];
    if (!name || !def || taken.has(name.toLowerCase()) || c.slots.length !== def.slots.length) continue;
    const players = c.slots.map((id) => (id != null ? byId.get(id) ?? null : null));
    if (players.some((p) => !p)) continue;
    taken.add(name.toLowerCase());
    const ev = evaluateTeam(c.formation, players, scale);
    // Ohne Standardschützen in der Liga spielen auch die Auffüllteams ohne (gleiche Regeln für alle)
    const setPiece = state.settings ? upgradeSettings(state.settings).setPiece : true;
    const ss = setPiece && c.ss != null ? byId.get(c.ss) : undefined;
    out.push({
      name,
      player: c.player.trim(),
      ...(c.entryId ? { playerEntry: c.entryId } : {}),
      rating: ev.score,
      squad: players.map((p, i) => ({ pokemonId: p!.id, pos: def.slots[i].pos, atk: p!.atk, spa: p!.spa })),
      setPieceTaker: ss ? { pokemonId: ss.id, pos: 'SS' as const, atk: ss.atk, spa: ss.spa } : null,
      setPieceFit: ss ? positionFit(ss, 'SS', scale) : undefined,
    });
  }
  const rest = need - out.length;
  if (rest > 0) {
    const clubs = shuffle(rng, CLUB_NAMES.filter((n) => !taken.has(n.toLowerCase()))).slice(0, rest);
    const ratings = shuffle(rng, opponentRatings(clubs.length));
    clubs.forEach((name, i) => out.push({ name, rating: ratings[i] }));
  }
  return out;
}

/** Alle Teams der Saison einer neuen Liga: gedraftete Teams, dahinter die Auffüllteams. */
export function seasonTeams(
  state: Pick<DraftState, 'seed' | 'teams' | 'settings'>,
  byId: Map<number, Pokemon>,
  scale: Scale,
  candidates: readonly FillCandidate[] = [],
): LeagueTeam[] {
  const size = upgradeSettings(state.settings).format === 'cup' ? CUP_SIZE : DRAFT_LIMITS.leagueSize;
  const drafted = leagueTeams(state, byId, scale);
  const fill = fillTeams(state, candidates, byId, scale, size);
  return [...drafted, ...centerFillRatings(drafted, fill)];
}

/**
 * Auffüllteams auf das Niveau der gedrafteten Teams verschieben: Ranglisten-Elfen stammen aus allen
 * Pokémon, gedraftete oft aus kleinen Pools (z. B. nur Kanto) – ohne Ausgleich lägen sie
 * 200–300 Punkte darüber. Der Durchschnitt wird angeglichen, die Abstände untereinander bleiben.
 */
export function centerFillRatings(drafted: readonly LeagueTeam[], fill: LeagueTeam[]): LeagueTeam[] {
  if (!drafted.length || !fill.length) return fill;
  const mean = (xs: readonly LeagueTeam[]) => xs.reduce((n, t) => n + t.rating, 0) / xs.length;
  const shift = mean(drafted) - mean(fill);
  // Auf der Team-Score-Skala bleiben (0–1.000) – starke Auffüllteams sonst über 1.000
  return fill.map((t) => ({ ...t, rating: Math.min(1000, Math.max(0, Math.round(t.rating + shift))) }));
}

/**
 * Saison aus dem Seed nachrechnen – nur für ältere Ligen ohne gespeichertes Ergebnis (damals
 * ohne Auffüllteams); neue Ligen speichert der Server (withLeague).
 */
export function draftSeason(
  state: Pick<DraftState, 'teams' | 'settings'> & { season: DraftSeason | null },
  byId: Map<number, Pokemon>,
  scale: Scale,
): LeagueResult | null {
  if (!state.season) return null;
  return simulateLeague(leagueTeams(state, byId, scale), createRng(state.season.seed));
}

/**
 * Am Ende des Drafts: Saison einmal berechnen und kompakt speichern (Teams ohne Kader –
 * Tabelle, Spiele und Torschützen bleiben). So ändert ein späterer Deploy das Ergebnis nicht.
 * Die gedrafteten Teams behalten ihre Indizes; die Auffüllteams (fillTeams, Kandidaten vom Server
 * aus der Rangliste) folgen dahinter.
 */
export function withLeague(state: DraftState, list: Pokemon[], scale: Scale, candidates: readonly FillCandidate[] = []): DraftState {
  if (state.phase !== 'done' || !state.season || state.league) return state;
  const teams = seasonTeams(state, byIdOf(list), scale, candidates);
  const rng = createRng(state.season.seed);
  const settings = upgradeSettings(state.settings);
  const full: LeagueResult =
    settings.format === 'cup'
      ? simulateCup(teams, rng, { groups: settings.cupGroups, model: DRAFT_MODEL })
      : simulateLeague(teams, rng, DRAFT_MODEL);
  return {
    ...state,
    league: {
      ...full,
      teams: full.teams.map((t) =>
        t.player
          ? { name: t.name, rating: t.rating, player: t.player, ...(t.playerEntry ? { playerEntry: t.playerEntry } : {}) }
          : { name: t.name, rating: t.rating },
      ),
    },
  };
}

/**
 * Nur lesbare Spiegel der älteren Schlüssel für Clients von vor dem Update (offene Tabs mit
 * altem Bundle verbinden sich nach einem Deploy neu und lesen region/legends): region 0 bei
 * allen bzw. mehreren Generationen (eine Obermenge – falsche Picks lehnt der Server ab), sonst
 * die eine Generation; legends = Legendäre oder Mysteriöse im Pool (ebenfalls Obermenge).
 * Für Ligen von vor dem Update (ein region, legends für beide) ist das genau der alte Pool.
 */
export function legacySettingsMirror(settings: DraftSettings): Required<LegacySettingsPatch> {
  const region = lobbyRegionOf(settings);
  return { region: region === LOBBY_REGION_MANY ? 0 : region, legends: poolHasLegends(settings) };
}

/**
 * Schnappschuss für einen Client – ohne Geräte-IDs, Sperrliste und Seed. Einstellungen immer
 * in der aktuellen Form (plus die gespiegelten älteren region/legends – legacySettingsMirror);
 * roll (null außerhalb des Drafts bzw. ohne Zufallsmodus) und rerollsUsed immer, roundRoll nur
 * im Runden-Modus.
 */
export function snapshotOf(state: DraftState, you: string | null, now: number): DraftSnapshot {
  const settings = upgradeSettings(state.settings);
  const drafting = state.phase === 'drafting';
  return {
    code: state.code,
    phase: state.phase,
    settings: { ...withoutLegacy(settings), ...legacySettingsMirror(settings) },
    teams: state.teams,
    hostTeamId: state.hostTeamId,
    pickIndex: state.pickIndex,
    totalPicks: state.phase === 'lobby' ? 0 : totalPicks(state),
    deadline: state.deadline,
    picks: state.picks,
    season: state.season,
    createdAt: state.createdAt,
    serverNow: now,
    you,
    ...(drafting ? { turnStartedAt: state.turnStartedAt ?? null } : {}),
    ...(state.league ? { league: state.league, ratings: state.league.teams.map((t) => t.rating) } : {}),
    roll: drafting && settings.roll !== 'off' ? (state.roll ?? null) : null,
    ...(settings.roll === 'round' ? { roundRoll: drafting ? (state.roundRoll ?? null) : null } : {}),
    rerollsUsed: state.rerollsUsed ?? {},
    ...(state.history?.length ? { history: state.history } : {}),
    ...(state.rematch ? { rematch: state.rematch } : {}),
    ...(state.career ? { career: state.career } : {}),
    ...(state.shinies?.length ? { shinies: state.shinies } : {}),
    ...(you && state.queues?.[you]?.length ? { queue: state.queues[you] } : {}),
    ...(state.manager ? { manager: managerView(state.manager, state.season, you) } : {}),
  };
}

/** Manager-Saison im Schnappschuss – ohne die Kader der Auffüllteams (siehe manager.ts). */
function managerView(m: ManagerState, season: DraftSeason | null, you: string | null): NonNullable<DraftSnapshot['manager']> {
  const nextAt = season && m.played < m.total ? season.startsAt + m.played * season.stepMs : null;
  return {
    played: m.played,
    total: m.total,
    nextAt,
    lineups: m.lineups,
    form: m.form,
    // Transfer-Wünsche sind privat: nur der eigene
    ...(you ? { claim: m.claims?.[you] ?? null } : {}),
    transfers: m.transfers ?? [],
    // Tausch-Angebote nur für die beiden beteiligten Teams
    ...(you ? { offers: (m.offers ?? []).filter((o) => o.from === you || o.to === you) } : {}),
    ...(m.playedLineups ? { playedLineups: m.playedLineups } : {}),
    ...(m.out ? { out: m.out } : {}),
    ...(m.cup ? { cup: m.cup } : {}),
  };
}

// ---------------------------------------------------------------- Revanche & ewige Tabelle

/** Abschluss einer fertigen Liga für den Verlauf der Gruppe – null ohne gespeichertes Ergebnis. */
export function historyEntryOf(
  state: Pick<DraftState, 'code' | 'phase' | 'settings' | 'teams' | 'league' | 'picks' | 'createdAt'>,
): DraftHistoryEntry | null {
  if (state.phase !== 'done' || !state.league) return null;
  const rows = state.league.table.flatMap((r, i): DraftHistoryRow[] => {
    const team = state.teams[r.team];
    if (!team) return [];
    return [{ teamId: team.id, name: team.name, cpu: team.cpu, rank: i + 1, played: r.played, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts }];
  });
  const last = state.picks[state.picks.length - 1];
  return { code: state.code, name: state.settings.name, finishedAt: last?.at ?? state.createdAt, rows };
}

/**
 * Revanche einer fertigen Liga (ohne Code und Seed – die vergibt der Server): gleiche
 * Einstellungen, gleiche Teams mit gleichen IDs (die Menschen sind sofort wieder Mitglied, der
 * Host bleibt Host), leere Kader, Lobby. Der Verlauf bekommt diese Liga dazu. Nur Mitglieder
 * dürfen sie anlegen. Fehler: not_done, not_joined.
 */
export function rematchTemplate(
  state: DraftState,
  deviceId: string,
  now: number,
  opts: { career?: boolean } = {},
): Omit<DraftState, 'code' | 'seed'> {
  if (state.phase !== 'done') fail('not_done', 'Die Liga ist noch nicht fertig');
  if (!teamOfDevice(state, deviceId)) fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  const entry = historyEntryOf(state) ?? fail('not_done', 'Die Liga ist noch nicht fertig');
  const career = opts.career ? nextCareer(state) : null;
  return {
    phase: 'lobby',
    settings: withoutLegacy(upgradeSettings(state.settings)),
    // Menschen gelten als offline, bis sie die neue Liga öffnen; in der Karriere behalten alle ihren Kader samt Optik
    teams: state.teams.map((t) => ({
      ...(career ? carryTeam(t) : makeTeam(t.id, t.name, t.formation, t.cpu)),
      ...(t.cpu ? {} : { offlineSince: now }),
    })),
    ...(career ? { career, ...(state.shinies?.length ? { shinies: [...state.shinies] } : {}) } : {}),
    owners: { ...state.owners },
    hostTeamId: state.hostTeamId,
    pickIndex: 0,
    deadline: null,
    picks: [],
    season: null,
    createdAt: now,
    ...(state.banned?.length ? { banned: [...state.banned] } : {}),
    history: [...(state.history ?? []), entry].slice(-DRAFT_LIMITS.historyMax),
  };
}

/** Team in die nächste Karriere-Saison: Kader (Elf, Standardschütze, Bank) und eigene Optik bleiben. */
function carryTeam(t: DraftTeam): DraftTeam {
  const base = makeTeam(t.id, t.name, t.formation, t.cpu);
  return {
    ...base,
    slots: [...t.slots],
    ss: t.ss,
    ...(t.bench ? { bench: [...t.bench] } : {}),
    ...(t.jerseys ? { jerseys: t.jerseys } : {}),
    ...(t.captain != null ? { captain: t.captain } : {}),
    ...(t.kit ? { kit: t.kit } : {}),
    ...(t.cheer ? { cheer: t.cheer } : {}),
    ...(t.crest ? { crest: t.crest } : {}),
  };
}

/**
 * Nächste Karriere-Saison: nur nach einer Manager-Saison. Liga-Stufe: Steht ein menschliches Team
 * unter den ersten drei, steigt die Liga auf; stehen alle Menschen auf den letzten drei Plätzen, ab.
 */
export function nextCareer(state: Pick<DraftState, 'settings' | 'league' | 'teams' | 'career'>): DraftCareer {
  if (upgradeSettings(state.settings).format !== 'manager' || !state.league) fail('not_manager', 'Karriere gibt es nur nach einer Manager-Saison');
  const table = state.league!.table;
  const ranks = state.teams.flatMap((t, i) => (t.cpu ? [] : [table.findIndex((r) => r.team === i) + 1])).filter((r) => r > 0);
  const tier = state.career?.tier ?? 2;
  const up = ranks.some((r) => r <= 3);
  const down = !up && ranks.length > 0 && ranks.every((r) => r > table.length - 3);
  const next = (up ? Math.max(1, tier - 1) : down ? Math.min(3, tier + 1) : tier) as 1 | 2 | 3;
  return { season: (state.career?.season ?? 1) + 1, tier: next, ...(next < tier ? { move: 'up' as const } : next > tier ? { move: 'down' as const } : {}) };
}

/** Zeile der ewigen Tabelle (je Team-ID über alle Ligen der Gruppe) */
export interface EternalRow {
  teamId: string;
  /** Zuletzt verwendeter Name */
  name: string;
  cpu: boolean;
  leagues: number;
  titles: number;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  /** Summe der Plätze (Ø Platz = rankSum / leagues) */
  rankSum: number;
}

/**
 * Ewige Tabelle: alle Ligen des Verlaufs (plus optional die aktuelle, wenn sie fertig ist)
 * zusammengezählt – nach Punkten, Tordifferenz, Toren, Titeln.
 */
export function eternalTable(entries: readonly DraftHistoryEntry[]): EternalRow[] {
  const rows = new Map<string, EternalRow>();
  for (const entry of entries) {
    for (const r of entry.rows) {
      const row = rows.get(r.teamId) ?? {
        teamId: r.teamId, name: r.name, cpu: r.cpu, leagues: 0, titles: 0, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, rankSum: 0,
      };
      row.name = r.name;
      row.cpu = r.cpu;
      row.leagues++;
      if (r.rank === 1) row.titles++;
      row.rankSum += r.rank;
      row.played += r.played;
      row.w += r.w;
      row.d += r.d;
      row.l += r.l;
      row.gf += r.gf;
      row.ga += r.ga;
      row.pts += r.pts;
      rows.set(r.teamId, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || b.titles - a.titles || a.name.localeCompare(b.name),
  );
}

/** Verlauf samt der aktuellen Liga, wenn sie fertig ist (Grundlage der ewigen Tabelle). */
export function groupEntries(
  state: Pick<DraftState, 'code' | 'phase' | 'settings' | 'teams' | 'league' | 'picks' | 'createdAt' | 'history'>,
): DraftHistoryEntry[] {
  const current = historyEntryOf(state);
  return [...(state.history ?? []), ...(current ? [current] : [])];
}

// ---------------------------------------------------------------- Wunschliste

/** Ein Pokémon von allen Wunschlisten streichen (gleiches Objekt, wenn es auf keiner steht). */
function withoutQueued(queues: Record<string, number[]>, pokemonId: number): Record<string, number[]> {
  if (!Object.values(queues).some((q) => q.includes(pokemonId))) return queues;
  return Object.fromEntries(Object.entries(queues).map(([id, q]) => [id, q.filter((x) => x !== pokemonId)]));
}

/**
 * Wunschliste des eigenen Teams ersetzen: nur noch freie Pokémon des Pools, ohne Doppelte, höchstens
 * DRAFT_LIMITS.queueMax (Reihenfolge = Vorrang). In Lobby und Draft. Fehler: not_joined, done, bad_queue.
 */
export function setQueue(state: DraftState, deviceId: string, ids: unknown, list: Pokemon[]): DraftState {
  const teamId = teamOfDevice(state, deviceId) ?? fail('not_joined', 'Du bist in dieser Liga nicht dabei');
  if (state.phase === 'done') fail('done', 'Der Draft ist schon vorbei');
  if (!Array.isArray(ids) || ids.length > DRAFT_LIMITS.queueMax || !ids.every((id) => Number.isInteger(id))) {
    fail('bad_queue', `Höchstens ${DRAFT_LIMITS.queueMax} Pokémon auf der Wunschliste`);
  }
  // Nur Pool-Pokémon (ändert der Host den Pool später, überspringt der Auto-Pick die übrigen)
  const pool = poolIdsOf(poolOf(state.settings, list));
  const taken = draftedIds(state);
  const queue = [...new Set(ids as number[])].filter((id) => pool.has(id) && !taken.has(id));
  return { ...state, queues: { ...state.queues, [teamId]: queue } };
}
