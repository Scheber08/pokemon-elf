/**
 * Vereinswappen: Form, Muster, zwei Farben (Palette der Trikotfarben) und ein Symbol – ein Icon oder
 * ein Pokémon als Wappentier („p:25“). Reine Optik; gespeichert wie die Trikotfarben.
 */
import { KIT_COLORS } from './kits';

export const CREST_SHAPES = ['shield', 'round', 'square', 'diamond'] as const;
export const CREST_PATTERNS = ['plain', 'stripes', 'halves', 'hoop', 'diagonal'] as const;
export const CREST_ICONS = ['ball', 'star', 'bolt', 'flame', 'drop', 'leaf', 'crown'] as const;

export type CrestShape = (typeof CREST_SHAPES)[number];
export type CrestPattern = (typeof CREST_PATTERNS)[number];
export type CrestIcon = (typeof CREST_ICONS)[number];

export interface Crest {
  shape: CrestShape;
  pattern: CrestPattern;
  /** Farb-IDs aus KIT_COLORS */
  primary: string;
  secondary: string;
  /** Icon (CREST_ICONS) oder Pokémon als „p:<id>“ */
  symbol: string;
}

export const DEFAULT_CREST: Crest = { shape: 'shield', pattern: 'plain', primary: 'blue', secondary: 'white', symbol: 'ball' };

const COLOR_IDS = new Set(KIT_COLORS.map((c) => c.id));

/** Zufälliges Wappen (zwei verschiedene Farben; Wappentier aus `pokemon`, falls angegeben). */
export function randomCrest(rnd: () => number, pokemon: readonly number[] = []): Crest {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const colors = KIT_COLORS.map((c) => c.id);
  const primary = pick(colors);
  const secondary = pick(colors.filter((c) => c !== primary));
  const symbols = [...CREST_ICONS, ...pokemon.map((id) => `p:${id}`)];
  return { shape: pick(CREST_SHAPES), pattern: pick(CREST_PATTERNS), primary, secondary, symbol: pick(symbols) };
}

/** Pokémon-ID eines Wappentiers („p:25“ → 25), sonst null */
export function crestPokemon(symbol: string): number | null {
  const m = /^p:(\d{1,5})$/.exec(symbol);
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/** Gespeichertes bzw. gesendetes Wappen prüfen – null, wenn etwas nicht passt. */
export function cleanCrest(raw: unknown): Crest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { shape, pattern, primary, secondary, symbol } = r;
  if (!(CREST_SHAPES as readonly unknown[]).includes(shape)) return null;
  if (!(CREST_PATTERNS as readonly unknown[]).includes(pattern)) return null;
  if (typeof primary !== 'string' || typeof secondary !== 'string' || !COLOR_IDS.has(primary) || !COLOR_IDS.has(secondary)) return null;
  if (typeof symbol !== 'string' || !((CREST_ICONS as readonly string[]).includes(symbol) || crestPokemon(symbol) != null)) return null;
  return { shape: shape as CrestShape, pattern: pattern as CrestPattern, primary, secondary, symbol };
}
