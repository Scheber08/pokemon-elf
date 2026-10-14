/**
 * Trikotnummern: Jedes Team kann seinen Pokémon Nummern von 1 bis 99 geben (je Team eindeutig).
 * Die Nummer hängt am Pokémon, nicht an der Position – wer umgestellt wird, behält sie.
 * Ohne eigene Nummer gilt eine klassische Vorgabe nach Position (Torwart 1, Stürmer 9, Zehner 10 …).
 * Reine Optik: Wertung und Simulation kennen keine Nummern.
 */
import type { PosCode } from '../types';

export const JERSEY_MIN = 1;
export const JERSEY_MAX = 99;

/** Eigene Nummern eines Teams: Pokémon-ID (als Schlüssel) → Nummer */
export type Jerseys = Record<string, number>;

/** Vorgabe je Position – die erste freie gewinnt, sonst die kleinste freie Nummer */
const PREFERRED: Record<PosCode, number[]> = {
  TW: [1, 12, 23],
  RV: [2, 22],
  LV: [3, 13],
  RWB: [2, 22],
  LWB: [3, 13],
  IV: [4, 5, 15, 24],
  DM: [6, 16],
  ZM: [8, 14, 18],
  OM: [10, 20],
  RM: [7, 17],
  LM: [11, 17],
  RF: [7, 17],
  LF: [11, 21],
  ST: [9, 19, 21],
  SS: [],
};

export const isJerseyNumber = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= JERSEY_MIN && (n as number) <= JERSEY_MAX;

/**
 * Nummern für einen Kader: eigene (gültig, eindeutig, nur für Pokémon im Kader) zuerst, für alle
 * anderen die Vorgabe nach Position. players in Aufstellungsreihenfolge (Torwart zuerst …), Bank am Ende.
 */
export function jerseyNumbers(players: readonly { pokemonId: number; pos: PosCode | null }[], custom: Jerseys = {}): Map<number, number> {
  const out = new Map<number, number>();
  const used = new Set<number>();
  const ids = new Set(players.map((p) => p.pokemonId));
  for (const p of players) {
    const n = custom[String(p.pokemonId)];
    if (isJerseyNumber(n) && !used.has(n) && ids.has(p.pokemonId) && !out.has(p.pokemonId)) {
      out.set(p.pokemonId, n);
      used.add(n);
    }
  }
  const lowestFree = () => {
    for (let n = JERSEY_MIN; n <= JERSEY_MAX; n++) if (!used.has(n)) return n;
    return JERSEY_MAX;
  };
  for (const p of players) {
    if (out.has(p.pokemonId)) continue;
    const n = (p.pos ? PREFERRED[p.pos] : []).find((x) => !used.has(x)) ?? lowestFree();
    out.set(p.pokemonId, n);
    used.add(n);
  }
  return out;
}

/** Eigene Nummern bereinigen (Speicher, Server): nur gültige Nummern, je Nummer ein Pokémon, höchstens `max` Einträge. */
export function cleanJerseys(raw: unknown, allowedIds?: ReadonlySet<number>, max = 30): Jerseys {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Jerseys = {};
  const used = new Set<number>();
  for (const [key, n] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0 || !isJerseyNumber(n) || used.has(n)) continue;
    if (allowedIds && !allowedIds.has(id)) continue;
    out[String(id)] = n;
    used.add(n);
    if (used.size >= max) break;
  }
  return out;
}

/** Eine Nummer setzen (null = zurück zur Vorgabe). Hat schon ein anderes Pokémon diese Nummer, tauschen beide. */
export function setJersey(custom: Jerseys, pokemonId: number, n: number | null, current: ReadonlyMap<number, number>): Jerseys {
  const next: Jerseys = { ...custom };
  const key = String(pokemonId);
  if (n == null) {
    delete next[key];
    return next;
  }
  if (!isJerseyNumber(n)) return custom;
  // Gespeicherte Nummern gelten über Teams hinweg (z. B. je Challenge): wer außerhalb des
  // aktuellen Kaders dieselbe Nummer hat, gibt sie ab
  for (const [k, x] of Object.entries(next)) if (x === n && k !== key && !current.has(Number(k))) delete next[k];
  const holder = [...current.entries()].find(([id, x]) => x === n && id !== pokemonId)?.[0];
  if (holder != null) {
    const mine = current.get(pokemonId);
    if (mine != null) next[String(holder)] = mine;
    else delete next[String(holder)];
  }
  next[key] = n;
  return next;
}

/**
 * Pokédex-Nummern als Trikotnummern: die letzten beiden Ziffern der Pokédex-Nummer (Formen: die der Art).
 * Doppelte und 00 bekommen keine eigene Nummer (dort gilt die Vorgabe).
 */
export function dexJerseys(players: readonly { pokemonId: number; dex: number }[]): Jerseys {
  const out: Jerseys = {};
  const used = new Set<number>();
  for (const p of players) {
    const n = p.dex % 100;
    if (!isJerseyNumber(n) || used.has(n) || out[String(p.pokemonId)] != null) continue;
    out[String(p.pokemonId)] = n;
    used.add(n);
  }
  return out;
}
