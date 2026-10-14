/** Shinys im Draft: seltene Auslosung aus dem Seed, Team-Bonus umso größer, je schwächer das Pokémon. */
import { describe, expect, it } from 'vitest';
import { leagueTeams } from '../src/lib/draftEngine';
import { buildScale } from '../src/lib/fit';
import { SHINY_CHANCE, SHINY_TEAM_MAX, shinyRoll, shinyTeamBoost } from '../src/lib/shiny';
import { ALL, byName } from './helpers';

const BY_ID = new Map(ALL.map((p) => [p.id, p]));
const SCALE = buildScale(ALL, 'all');

describe('Shiny', () => {
  it('selten (etwa SHINY_CHANCE) und deterministisch je Seed und Pokémon', () => {
    const n = ALL.filter((p) => shinyRoll(12345, p.id)).length;
    expect(n / ALL.length).toBeGreaterThan(SHINY_CHANCE * 0.4);
    expect(n / ALL.length).toBeLessThan(SHINY_CHANCE * 2);
    expect(ALL.map((p) => shinyRoll(12345, p.id))).toEqual(ALL.map((p) => shinyRoll(12345, p.id)));
    expect(ALL.map((p) => shinyRoll(1, p.id))).not.toEqual(ALL.map((p) => shinyRoll(2, p.id)));
  });

  it('Team-Bonus: schwache Pokémon heben das Team viel mehr als starke', () => {
    const weak = shinyTeamBoost(byName('Karpador'));
    const strong = shinyTeamBoost(byName('Mewtu'));
    expect(weak).toBe(SHINY_TEAM_MAX);
    expect(strong).toBeLessThanOrEqual(SHINY_TEAM_MAX * 0.15);
    expect(strong).toBeGreaterThan(0);
  });

  it('in der Liga: ein Shiny hebt das Rating seines Teams', () => {
    const slots = ['Relaxo', 'Turtok', 'Stahlos', 'Geowaz', 'Garados', 'Simsala', 'Machomei', 'Gengar', 'Zapdos', 'Glurak', 'Karpador'].map((n) => byName(n).id);
    const state = {
      teams: [{ id: 'a', name: 'A', formation: '4-3-3' as const, cpu: false, online: true, slots, ss: null }],
      settings: {} as never,
    };
    const base = leagueTeams(state, BY_ID, SCALE)[0].rating;
    const shiny = leagueTeams({ ...state, shinies: [byName('Karpador').id] }, BY_ID, SCALE)[0].rating;
    expect(shiny).toBeGreaterThanOrEqual(base + SHINY_TEAM_MAX);
  });

  it('Einstellung „Shinys aus“: kein Pick schillert', async () => {
    const { createDraft, startDraft, applyPick, autoPickChoice, currentTeam, addCpuTeam } = await import('../src/lib/draftEngine');
    const run = (shinies: boolean) => {
      let s = createDraft({
        code: 'SHN234',
        seed: 'x',
        settings: { pickSeconds: 0, shinies, maxTeams: 8, gens: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
        host: { teamId: 'h', deviceId: 'dev-h', name: 'H', formation: '4-3-3' },
        now: 0,
        list: ALL,
      });
      for (let i = 0; i < 7; i++) s = addCpuTeam(s, 'dev-h', `c${i}`);
      s = startDraft(s, 'dev-h', 0, ALL);
      while (s.phase === 'drafting') {
        const cur = currentTeam(s)!;
        const c = autoPickChoice(s, cur.id, ALL, SCALE, true);
        s = applyPick(s, cur.id, c.pokemonId, c.slot, true, 1, ALL);
      }
      return s.shinies ?? [];
    };
    expect(run(false)).toEqual([]);
  });
});


describe('Shiny-Party', () => {
  it('10 % statt 2 %, nur mit Shinys an; Einstellung wird übernommen', async () => {
    const { shinyFor, upgradeSettings } = await import('../src/lib/draftEngine');
    const { DEFAULT_DRAFT_SETTINGS } = await import('../src/lib/api/draftContract');
    const count = (party: boolean, on = true) =>
      Array.from({ length: 2000 }, (_, i) => i + 1).filter((id) => shinyFor({ ...DEFAULT_DRAFT_SETTINGS, shinies: on, shinyParty: party }, 'seed-x', id)).length;
    const normal = count(false);
    const party = count(true);
    expect(normal).toBeGreaterThan(15);
    expect(normal).toBeLessThan(70);
    expect(party).toBeGreaterThan(140);
    expect(party).toBeLessThan(270);
    expect(count(true, false)).toBe(0);
    // Alte Einstellungen ohne Feld: keine Party
    const { shinyParty: _x, ...old } = DEFAULT_DRAFT_SETTINGS;
    expect(upgradeSettings(old as never).shinyParty).toBe(false);
  });
});
