/** Schnellstart-Vorlagen: jede ergibt gültige Einstellungen, deren Pool für mindestens 2 Teams reicht. */
import { describe, expect, it } from 'vitest';
import { DRAFT_PRESET_IDS, DRAFT_PRESETS } from '../src/config/draftPresets';
import { DEFAULT_DRAFT_SETTINGS } from '../src/lib/api/draftContract';
import { maxTeamsForPool, normalizeSettings } from '../src/lib/draftEngine';
import { ALL, FORMS } from './helpers';

const LIST = [...ALL, ...FORMS];

describe('Schnellstart-Vorlagen', () => {
  it.each(DRAFT_PRESET_IDS)('%s ist gültig und trägt mindestens 4 Teams', (id) => {
    const s = normalizeSettings({ ...DRAFT_PRESETS[id], maxTeams: 2 }, DEFAULT_DRAFT_SETTINGS, LIST);
    expect(s).toMatchObject(DRAFT_PRESETS[id]);
    expect(maxTeamsForPool(s, LIST)).toBeGreaterThanOrEqual(4);
  });
});
