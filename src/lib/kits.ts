/**
 * Trikotfarben: Jedes Team wählt eine Heim- und eine Auswärtsfarbe aus einer festen Palette.
 * In der 2D-Ansicht spielt das Heimteam in seiner Heimfarbe; das Gastteam ebenfalls – außer sie
 * gleicht der des Heimteams, dann in seiner Auswärtsfarbe (und notfalls in einer Ausweichfarbe).
 * Reine Optik.
 */

export interface KitColor {
  id: string;
  /** Trikot */
  fill: string;
  /** Rand / Kontrast */
  stroke: string;
  /** Schrift auf dem Trikot (Nummer im Punkt) */
  text: string;
}

export const KIT_COLORS: readonly KitColor[] = [
  { id: 'yellow', fill: '#ffcb05', stroke: '#7a5a00', text: '#0d1b2a' },
  { id: 'white', fill: '#e9eef5', stroke: '#2f62c9', text: '#0d1b2a' },
  { id: 'red', fill: '#d8342a', stroke: '#6e1410', text: '#ffffff' },
  { id: 'blue', fill: '#2f62c9', stroke: '#0d1b2a', text: '#ffffff' },
  { id: 'sky', fill: '#7ec4ef', stroke: '#1d4f73', text: '#0d1b2a' },
  { id: 'black', fill: '#26282e', stroke: '#c9ced6', text: '#ffffff' },
  { id: 'orange', fill: '#f08a2b', stroke: '#6b3300', text: '#0d1b2a' },
  { id: 'purple', fill: '#7b4bc4', stroke: '#2b1453', text: '#ffffff' },
  { id: 'pink', fill: '#e86fb4', stroke: '#6b1f4a', text: '#0d1b2a' },
  { id: 'teal', fill: '#2ec4b6', stroke: '#0b4a44', text: '#0d1b2a' },
];

export type KitColorId = string;

export interface Kit {
  home: KitColorId;
  away: KitColorId;
}

/** Ohne eigene Wahl: wie bisher Gelb (Heim) und Weiß (Auswärts) */
export const DEFAULT_KIT: Kit = { home: 'yellow', away: 'white' };

const byId = new Map(KIT_COLORS.map((c) => [c.id, c]));

export const kitColor = (id: string): KitColor => byId.get(id) ?? byId.get('yellow')!;

/** Gespeicherte bzw. gesendete Trikotfarben prüfen – null, wenn nichts Gültiges dabei ist. */
export function cleanKit(raw: unknown): Kit | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { home, away } = raw as Record<string, unknown>;
  if (typeof home !== 'string' || typeof away !== 'string' || !byId.has(home) || !byId.has(away)) return null;
  return { home, away };
}

/** Farben beider Teams in einem Spiel: [Heim, Gast] – nie zweimal dieselbe. */
export function matchKits(home: Kit | null | undefined, away: Kit | null | undefined): [KitColor, KitColor] {
  const h = kitColor((home ?? DEFAULT_KIT).home);
  const a = away ?? DEFAULT_KIT;
  const options = [a.home, a.away, DEFAULT_KIT.away, DEFAULT_KIT.home, ...KIT_COLORS.map((c) => c.id)];
  const g = options.map(kitColor).find((c) => c.id !== h.id)!;
  return [h, g];
}
