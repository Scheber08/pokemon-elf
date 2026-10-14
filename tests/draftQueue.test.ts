/**
 * Wunschliste im Online-Draft: Auto-Pick (Timer bzw. Klick) nimmt das erste erlaubte Pokémon
 * davon; vergebene fliegen von allen Listen; jedes Team sieht nur seine eigene.
 */
import { describe, expect, it } from 'vitest';
import {
  addCpuTeam,
  applyPick,
  autoPickChoice,
  createDraft,
  currentTeam,
  DraftError,
  joinDraft,
  setQueue,
  snapshotOf,
  startDraft,
  type DraftState,
} from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { ALL, byName } from './helpers';

const SCALE = buildScale(ALL, 'all');

function league(): DraftState {
  let s = createDraft({
    code: 'ABC234',
    seed: 7,
    settings: { order: 'host', gens: [1], roll: 'off' },
    host: { teamId: 'h', deviceId: 'dev-h', name: 'Host', formation: '4-3-3' },
    now: 0,
    list: ALL,
  });
  s = joinDraft(s, { teamId: 'g', deviceId: 'dev-g', name: 'Gast', formation: '4-4-2' });
  return addCpuTeam(s, 'dev-h', 'c');
}

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof DraftError) return e.code;
    throw e;
  }
}

describe('Wunschliste', () => {
  it('Auto-Pick nimmt die erste erlaubte – vergebene werden übersprungen und von allen Listen gestrichen', () => {
    let s = league();
    const [glurak, mewtu, rattfratz] = [byName('Glurak'), byName('Mewtu'), byName('Rattfratz')];
    // Mewtu ist legendär und ohne Legendäre nicht im Pool – wird beim Setzen verworfen
    s = setQueue(s, 'dev-h', [mewtu.id, rattfratz.id, glurak.id], ALL);
    expect(s.queues!.h).toEqual([rattfratz.id, glurak.id]);
    s = setQueue(s, 'dev-g', [rattfratz.id], ALL);
    s = startDraft(s, 'dev-h', 0, ALL);
    expect(currentTeam(s)!.id).toBe('h');
    const c = autoPickChoice(s, 'h', ALL, SCALE, false);
    expect(c.pokemonId).toBe(rattfratz.id);
    s = applyPick(s, 'h', c.pokemonId, c.slot, true, 1, ALL);
    expect(s.queues).toEqual({ h: [glurak.id], g: [] });
    // CPU (mit Zufall) ignoriert Wunschlisten
    expect(currentTeam(s)!.id).toBe('g');
    const g = autoPickChoice(s, 'g', ALL, SCALE, false);
    expect(g.pokemonId).not.toBe(rattfratz.id);
  });

  it('privat: nur das eigene Team sieht seine Liste', () => {
    let s = setQueue(league(), 'dev-h', [byName('Glurak').id], ALL);
    expect(snapshotOf(s, 'h', 0).queue).toEqual([byName('Glurak').id]);
    expect(snapshotOf(s, 'g', 0).queue).toBeUndefined();
    expect(snapshotOf(s, null, 0).queue).toBeUndefined();
    s = setQueue(s, 'dev-h', [], ALL);
    expect(snapshotOf(s, 'h', 0).queue).toBeUndefined();
  });

  it('nur Mitglieder, höchstens 20, keine Doppelten, nicht nach dem Draft', () => {
    const s = league();
    expect(code(() => setQueue(s, 'fremd', [1], ALL))).toBe('not_joined');
    expect(code(() => setQueue(s, 'dev-h', Array.from({ length: 21 }, (_, i) => i + 1), ALL))).toBe('bad_queue');
    expect(code(() => setQueue(s, 'dev-h', ['1'], ALL))).toBe('bad_queue');
    expect(setQueue(s, 'dev-h', [4, 4, 1, 99999], ALL).queues!.h).toEqual([4, 1]);
    expect(code(() => setQueue({ ...s, phase: 'done' }, 'dev-h', [1], ALL))).toBe('done');
  });
});
