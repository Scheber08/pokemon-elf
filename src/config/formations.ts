/**
 * Formationen. Koordinaten in Prozent des Spielfelds:
 * x = 0 (links) … 100 (rechts), y = 0 (gegnerisches Tor, oben) … 100 (eigenes Tor, unten).
 * Reihenfolge der Slots = von hinten nach vorne, innerhalb einer Reihe von links nach rechts.
 */
import type { FormationId, PosCode } from '../types';

export interface SlotDef {
  pos: PosCode;
  x: number;
  y: number;
}

export interface Formation {
  id: FormationId;
  label: string;
  slots: SlotDef[];
}

const TW: SlotDef = { pos: 'TW', x: 50, y: 88 };
const BACK4: SlotDef[] = [
  { pos: 'LV', x: 13, y: 67 },
  { pos: 'IV', x: 37, y: 71 },
  { pos: 'IV', x: 63, y: 71 },
  { pos: 'RV', x: 87, y: 67 },
];

export const FORMATIONS: Record<FormationId, Formation> = {
  '4-3-3': {
    id: '4-3-3',
    label: '4-3-3',
    slots: [
      TW,
      ...BACK4,
      { pos: 'ZM', x: 24, y: 45 },
      { pos: 'DM', x: 50, y: 53 },
      { pos: 'ZM', x: 76, y: 45 },
      { pos: 'LF', x: 17, y: 21 },
      { pos: 'ST', x: 50, y: 15 },
      { pos: 'RF', x: 83, y: 21 },
    ],
  },
  '4-4-2': {
    id: '4-4-2',
    label: '4-4-2',
    slots: [
      TW,
      ...BACK4,
      { pos: 'LM', x: 12, y: 43 },
      { pos: 'ZM', x: 37, y: 48 },
      { pos: 'ZM', x: 63, y: 48 },
      { pos: 'RM', x: 88, y: 43 },
      { pos: 'ST', x: 34, y: 18 },
      { pos: 'ST', x: 66, y: 18 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    label: '4-2-3-1',
    slots: [
      TW,
      ...BACK4,
      { pos: 'DM', x: 34, y: 53 },
      { pos: 'DM', x: 66, y: 53 },
      { pos: 'LF', x: 15, y: 32 },
      { pos: 'OM', x: 50, y: 35 },
      { pos: 'RF', x: 85, y: 32 },
      { pos: 'ST', x: 50, y: 14 },
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    label: '3-5-2',
    slots: [
      TW,
      { pos: 'IV', x: 25, y: 70 },
      { pos: 'IV', x: 50, y: 72 },
      { pos: 'IV', x: 75, y: 70 },
      { pos: 'LWB', x: 10, y: 44 },
      { pos: 'ZM', x: 30, y: 42 },
      { pos: 'DM', x: 50, y: 53 },
      { pos: 'ZM', x: 70, y: 42 },
      { pos: 'RWB', x: 90, y: 44 },
      { pos: 'ST', x: 34, y: 17 },
      { pos: 'ST', x: 66, y: 17 },
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    label: '5-3-2',
    slots: [
      TW,
      { pos: 'LWB', x: 10, y: 61 },
      { pos: 'IV', x: 30, y: 70 },
      { pos: 'IV', x: 50, y: 72 },
      { pos: 'IV', x: 70, y: 70 },
      { pos: 'RWB', x: 90, y: 61 },
      { pos: 'ZM', x: 26, y: 44 },
      { pos: 'DM', x: 50, y: 51 },
      { pos: 'ZM', x: 74, y: 44 },
      { pos: 'ST', x: 34, y: 18 },
      { pos: 'ST', x: 66, y: 18 },
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export const DEFAULT_FORMATION: FormationId = '4-3-3';
