/**
 * Schnellstart-Vorlagen für neue Online-Ligen: ein Klick setzt passende Pool- und Draft-Einstellungen
 * (Liganame, Teams, Sichtbarkeit bleiben; den Spielmodus setzt nur „KO-Turnier"). Reine Daten – geprüft
 * wird wie bei jeder Änderung.
 */
import { DRAFT_ALL_GENS, type DraftSettings } from '../lib/api/draftContract';
import { TYPE_KEYS } from './pokemonTypes';

export type DraftPresetId = 'classic' | 'allRegions' | 'megaChaos' | 'blitz' | 'cup';

export const DRAFT_PRESETS: Record<DraftPresetId, Partial<DraftSettings>> = {
  classic: {
    gens: [1],
    types: [...TYPE_KEYS],
    legendary: false,
    mythical: false,
    maxLegends: null,
    ultraBeasts: true,
    maxUltraBeasts: null,
    forms: false,
    megas: false,
    roll: 'off',
    pickSeconds: 60,
    snake: true,
  },
  allRegions: {
    gens: [...DRAFT_ALL_GENS],
    types: [...TYPE_KEYS],
    legendary: true,
    mythical: true,
    maxLegends: 1,
    ultraBeasts: true,
    maxUltraBeasts: 1,
    forms: true,
    megas: false,
    roll: 'off',
    pickSeconds: 60,
    snake: true,
  },
  megaChaos: {
    gens: [...DRAFT_ALL_GENS],
    types: [...TYPE_KEYS],
    legendary: true,
    mythical: false,
    maxLegends: 1,
    ultraBeasts: true,
    maxUltraBeasts: 1,
    forms: true,
    megas: true,
    maxMegas: 2,
    roll: 'pick',
    rerolls: { type: 1, region: 1 },
    pickSeconds: 60,
    snake: true,
  },
  blitz: {
    gens: [1, 2],
    types: [...TYPE_KEYS],
    legendary: false,
    mythical: false,
    maxLegends: null,
    ultraBeasts: true,
    maxUltraBeasts: null,
    forms: false,
    megas: false,
    roll: 'round',
    rerolls: { type: 0, region: 0 },
    pickSeconds: 30,
    snake: true,
  },
  cup: {
    gens: [1, 2, 3],
    types: [...TYPE_KEYS],
    legendary: true,
    mythical: false,
    maxLegends: 1,
    ultraBeasts: true,
    maxUltraBeasts: 1,
    forms: false,
    megas: false,
    roll: 'off',
    pickSeconds: 60,
    snake: true,
    format: 'cup',
    cupGroups: true,
  },
};

export const DRAFT_PRESET_IDS = Object.keys(DRAFT_PRESETS) as DraftPresetId[];
