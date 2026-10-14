/** Link-Vorschau einer Online-Liga: Pfad → Code, Meta-Angaben je Phase. */
import { describe, expect, it } from 'vitest';
import { draftPageCode, draftPageMeta } from '../server/preview';

const row = (phase: string, name = 'Pokal') => ({ name, host_name: 'Ash', teams: 3, max_teams: 6, phase });

describe('Liga-Vorschau', () => {
  it('erkennt nur gültige Liga-Pfade', () => {
    expect(draftPageCode('/draft/ABC234')).toBe('ABC234');
    expect(draftPageCode('/draft/abc234/')).toBe('ABC234');
    for (const p of ['/draft', '/draft/', '/draft/ABC23', '/draft/ABC2340', '/draft/ABC0O1', '/draft/ABC234/x', '/api/drafts/ABC234']) {
      expect(draftPageCode(p), p).toBeNull();
    }
  });

  it('Lobby, Draft, fertig, unbekannt – mit absoluten Adressen', () => {
    const o = 'https://elf.example';
    const lobby = draftPageMeta('ABC234', row('lobby'), o);
    expect(lobby.title).toBe('Online-Liga „Pokal“ · Pokémon Elf');
    expect(lobby.description).toContain('Ash lädt dich zum Fantasy-Draft ein – 3/6 Teams');
    expect(lobby.url).toBe('https://elf.example/draft/ABC234');
    expect(lobby.image).toBe('https://elf.example/og.png');
    expect(draftPageMeta('ABC234', row('drafting'), o).description).toContain('Der Draft läuft');
    expect(draftPageMeta('ABC234', row('done'), o).description).toContain('Saison beendet');
    expect(draftPageMeta('ABC234', row('lobby', ' '), o).title).toBe('Online-Liga ABC234 · Pokémon Elf');
    expect(draftPageMeta('ABC234', null, o).title).toBe('Online-Liga ABC234 · Pokémon Elf');
    expect(draftPageMeta('ABC234', row('closed'), o).description).not.toContain('Ash');
  });
});
