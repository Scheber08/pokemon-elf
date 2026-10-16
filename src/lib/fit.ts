/**
 * Positions-Fit: Wie gut passt ein Pokémon auf eine Position? (0–100)
 *
 * 1. Jeder Faktor wird auf 0–1 normalisiert:
 *    - Basiswerte: Wert ÷ 255, geglättet mit Perzentil- und Wurzel-Skalierung über den Pool.
 *    - Größe: bei SCORING.height.cap gedeckelt, sonst wie ein Basiswert.
 *    - Gewicht: logarithmisch zwischen minKg und capKg (jede Verdopplung zählt gleich).
 * 2. Die Faktoren werden mit dem Profil gewichtet (Schlüssel 3, Hilft 2, Klein 1, Nicht 0).
 * 3. Das Ergebnis wird innerhalb des Pools in ein Perzentil (0–100) umgerechnet.
 * 4. Der Typ-Bonus (+3 % / +2 % / +1 %) wirkt nur als Tie-Breaker obendrauf.
 *
 * Eine „Scale" kapselt den Pool, über den normalisiert wird – alle 1.025 Pokémon
 * oder nur die Original-151 (Retro / 151 Challenge).
 */
import { FACTORS, POSITIONS, PROFILES } from '../config/positions';
import { SCORING } from '../config/scoring';
import type { FactorKey, PosCode, Pokemon, ProfileKey, StatKey } from '../types';

const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const PROFILE_KEYS = Object.keys(PROFILES) as ProfileKey[];

export interface Scale {
  id: string;
  size: number;
  /** Sortierte Rohwerte je Faktor (Größe bereits gedeckelt) für die Perzentile. */
  sortedFactors: Record<FactorKey, Float64Array>;
  /** Sortierte gewichtete Rohwerte je Profil für das Fit-Perzentil. */
  sortedComposite: Record<ProfileKey, Float64Array>;
  /** Cache: Pokémon-ID → Fit je Profil */
  cache: Map<number, Record<ProfileKey, number>>;
  /** Cache: Pokémon-ID → normalisierte Faktoren (Reihenfolge wie FACTORS) */
  factorCache: Map<number, Float64Array>;
}

/** Anteil der Werte im sortierten Array, die ≤ v sind (0–1). */
export function cdf(sorted: Float64Array, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= v + 1e-12) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 0;
}

function cappedHeight(p: Pokemon): number {
  return Math.min(p.h, SCORING.height.cap);
}

function rawFactor(p: Pokemon, f: FactorKey): number {
  if (f === 'height') return cappedHeight(p);
  if (f === 'weight') return p.w;
  return p[f];
}

/** Gewicht 0–1 auf logarithmischer Skala. */
export function weightScore(kg: number): number {
  const { minKg, capKg } = SCORING.weight;
  const v = Math.log(Math.max(kg, minKg) / minKg) / Math.log(capKg / minKg);
  return Math.min(1, Math.max(0, v));
}

/** Normalisierter Faktor 0–1 relativ zur Scale. */
export function factorScore(p: Pokemon, f: FactorKey, scale: Scale): number {
  if (f === 'weight') return weightScore(p.w);
  const pw = SCORING.percentileWeight;
  const raw = rawFactor(p, f);
  const max = f === 'height' ? SCORING.height.cap : 255;
  const root = Math.sqrt(Math.min(raw, max) / max);
  return pw * cdf(scale.sortedFactors[f], raw) + (1 - pw) * root;
}

/** Alle normalisierten Faktoren eines Pokémon – einmal je Scale berechnet. */
function factorScores(p: Pokemon, scale: Scale): Float64Array {
  let scores = scale.factorCache.get(p.id);
  if (!scores) {
    scores = Float64Array.from(FACTORS, (f) => factorScore(p, f, scale));
    scale.factorCache.set(p.id, scores);
  }
  return scores;
}

/** Gewichteter Durchschnitt der Faktoren für ein Profil (0–1), noch ohne Perzentil. */
export function compositeScore(p: Pokemon, profile: ProfileKey, scale: Scale): number {
  const weights = PROFILES[profile].weights;
  const scores = factorScores(p, scale);
  let sum = 0;
  let total = 0;
  for (let i = 0; i < FACTORS.length; i++) {
    const lvl = weights[FACTORS[i]];
    if (!lvl) continue;
    sum += lvl * scores[i];
    total += lvl;
  }
  return total ? sum / total : 0;
}

/** Typ-Bonus als Anteil (0.03 = +3 %). Mehrere passende Typen addieren sich. */
export function typeBonus(p: Pokemon, profile: ProfileKey): number {
  const list = PROFILES[profile].types;
  let bonus = 0;
  for (const t of p.types) {
    const idx = list.indexOf(t);
    if (idx >= 0) bonus += SCORING.typeBonus[Math.min(idx, SCORING.typeBonus.length - 1)];
  }
  return bonus;
}

export function buildScale(pool: Pokemon[], id = 'custom'): Scale {
  const sortedFactors = {} as Record<FactorKey, Float64Array>;
  for (const f of FACTORS) {
    const arr = Float64Array.from(pool, (p) => rawFactor(p, f));
    arr.sort();
    sortedFactors[f] = arr;
  }
  const scale: Scale = {
    id,
    size: pool.length,
    sortedFactors,
    sortedComposite: {} as Record<ProfileKey, Float64Array>,
    cache: new Map(),
    factorCache: new Map(),
  };
  for (const key of PROFILE_KEYS) {
    const arr = Float64Array.from(pool, (p) => compositeScore(p, key, scale));
    arr.sort();
    scale.sortedComposite[key] = arr;
  }
  return scale;
}

function computeProfileFit(p: Pokemon, profile: ProfileKey, scale: Scale): number {
  const pct = cdf(scale.sortedComposite[profile], compositeScore(p, profile, scale));
  const base = 100 * Math.pow(pct, SCORING.fitCurve);
  return Math.min(100, base * (1 + typeBonus(p, profile)));
}

/** Fit 0–100 eines Pokémon für ein Profil. */
export function profileFit(p: Pokemon, profile: ProfileKey, scale: Scale): number {
  let entry = scale.cache.get(p.id);
  if (!entry) {
    entry = {} as Record<ProfileKey, number>;
    for (const key of PROFILE_KEYS) entry[key] = computeProfileFit(p, key, scale);
    scale.cache.set(p.id, entry);
  }
  return entry[profile];
}

/** Fit 0–100 eines Pokémon für eine Position (z. B. „LV"). */
export function positionFit(p: Pokemon, pos: PosCode, scale: Scale): number {
  return profileFit(p, POSITIONS[pos].profile, scale);
}

export { STAT_KEYS };

/** Index des alleinigen Bestwerts (z. B. Ø Fit auf dem Draft-Board) – nur bei mindestens zwei Werten, sonst null */
export function soleTopIndex(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const max = Math.max(...present);
  return present.filter((v) => v === max).length === 1 ? values.indexOf(max) : null;
}

/**
 * Bester Pick jeder Draft-Runde: Index (in Pick-Reihenfolge) des höchsten Fits je Runde mit perRound Picks
 * (bei Gleichstand der frühere). Picks ohne Fit (Bank, unbekannt) zählen nicht; Runden ohne Fit bleiben leer.
 */
export function roundBestPicks(fits: readonly (number | null)[], perRound: number): Set<number> {
  const out = new Set<number>();
  if (perRound < 1) return out;
  for (let start = 0; start < fits.length; start += perRound) {
    let best = -1;
    let at = -1;
    for (let i = start; i < Math.min(start + perRound, fits.length); i++) {
      const f = fits[i];
      if (f != null && f > best) [best, at] = [f, i];
    }
    if (at >= 0) out.add(at);
  }
  return out;
}

/**
 * Auswahl-Vorschau im Draft: bester freier Feldplatz von p (Positions-Fit) und der Ø Fit der gesetzten Elf vorher
 * (null ohne gesetzte Spieler) und nachher. null, wenn kein Feldplatz mehr frei ist.
 */
export function fitImpact(
  p: Pokemon,
  defs: readonly { pos: PosCode }[],
  slots: readonly (number | null | undefined)[],
  byId: Map<number, Pokemon>,
  scale: Scale,
): { pos: PosCode; fit: number; before: number | null; after: number } | null {
  let sum = 0;
  let n = 0;
  let best: { pos: PosCode; fit: number } | null = null;
  defs.forEach((d, j) => {
    const id = slots[j];
    if (id != null) {
      const q = byId.get(id);
      if (q) {
        sum += positionFit(q, d.pos, scale);
        n++;
      }
      return;
    }
    const fit = positionFit(p, d.pos, scale);
    if (!best || fit > best.fit) best = { pos: d.pos, fit };
  });
  if (!best) return null;
  const b: { pos: PosCode; fit: number } = best;
  return { pos: b.pos, fit: Math.round(b.fit), before: n ? Math.round(sum / n) : null, after: Math.round((sum + b.fit) / (n + 1)) };
}

/** 💯 Volltreffer: ab diesem (gerundeten) Positions-Fit */
export const BULLSEYE_FIT = 95;
